// Capa de API: arma las respuestas que consume el frontend a partir de las fuentes.
const LEAGUES = require('./leagues');
const espn = require('./sources/espn');
const tsdb = require('./sources/thesportsdb');
const wikipedia = require('./sources/wikipedia');
const { safe } = require('./fetcher');
const analysis = require('./analysis');

const leagueBySlug = Object.fromEntries(LEAGUES.map(l => [l.slug, l]));

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function assertLeague(slug) {
  const l = leagueBySlug[slug];
  if (!l) throw httpError(404, 'Liga no encontrada');
  return l;
}

function mapTeam(t) {
  return {
    id: t.id,
    name: t.displayName,
    shortName: t.shortDisplayName,
    abbr: t.abbreviation,
    logo: t.logos && t.logos[0] && t.logos[0].href,
    color: t.color,
  };
}

async function leagueTeams(slug) {
  const data = await safe(espn.teams(slug));
  const lg = data && data.sports && data.sports[0] && data.sports[0].leagues && data.sports[0].leagues[0];
  if (!lg) return null;
  return {
    season: lg.season && lg.season.displayName,
    teams: (lg.teams || []).map(t => mapTeam(t.team)).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Todas las ligas con sus clubes (sirve para el buscador global). */
async function leagues() {
  const results = await Promise.all(LEAGUES.map(l => leagueTeams(l.slug)));
  return LEAGUES.map((l, i) => ({
    ...l,
    season: results[i] && results[i].season,
    teams: results[i] ? results[i].teams : [],
    available: !!results[i],
  }));
}

async function league(slug) {
  const l = assertLeague(slug);
  const data = await leagueTeams(slug);
  if (!data) throw httpError(502, 'No se pudo obtener la liga');
  return { ...l, ...data };
}

/** Plantel de un club con estadísticas básicas por jugador. */
async function team(slug, id) {
  const l = assertLeague(slug);
  const [roster, info] = await Promise.all([espn.roster(slug, id), safe(espn.team(slug, id))]);
  if (!roster || !roster.athletes) throw httpError(404, 'Club no encontrado');

  const t = (info && info.team) || roster.team || {};
  const players = roster.athletes.map(a => {
    const s = analysis.flattenRoster(a);
    return {
      id: a.id,
      name: a.displayName,
      shortName: a.shortName,
      jersey: a.jersey || null,
      age: a.age || null,
      nationality: a.citizenship || null,
      flag: a.flag && a.flag.href,
      height: analysis.inchesToCm(a.height),
      group: analysis.groupOf(a.position),
      injured: !!(a.injuries && a.injuries.length),
      stats: {
        apps: s.appearances || 0,
        subIns: s.subIns || 0,
        goals: s.totalGoals || 0,
        assists: s.goalAssists || 0,
        yellow: s.yellowCards || 0,
        red: s.redCards || 0,
        saves: s.saves,
        conceded: s.goalsConceded,
      },
    };
  });

  const order = { G: 0, D: 1, M: 2, F: 3 };
  players.sort((a, b) => order[a.group] - order[b.group] || b.stats.apps - a.stats.apps || a.name.localeCompare(b.name));

  return {
    league: { slug, name: l.name, country: l.country, flag: l.flag },
    season: roster.season && roster.season.displayName,
    team: {
      id: t.id || id,
      name: t.displayName,
      abbr: t.abbreviation,
      logo: (t.logos && t.logos[0] && t.logos[0].href) || t.logo,
      color: t.color,
      altColor: t.alternateColor,
      standing: t.standingSummary || null,
      record: t.record && t.record.items && t.record.items[0] && t.record.items[0].summary,
    },
    players,
  };
}

/** Busca en qué liga jugó la temporada anterior (puede haber cambiado de liga). */
function prevLeagueFrom(gamelogPrev, currentSlug) {
  const f = gamelogPrev && (gamelogPrev.filters || []).find(x => x.name === 'league');
  const opts = (f && f.options) || [];
  const known = opts.find(o => leagueBySlug[o.value]);
  if (known) return { slug: known.value, name: leagueBySlug[known.value].name };
  const domestic = opts.find(o => /^[a-z]{3}\.\d$/.test(o.value));
  if (domestic) return { slug: domestic.value, name: domestic.displayValue };
  return { slug: currentSlug, name: leagueBySlug[currentSlug].name };
}

/** Datos de ESPN de un jugador (ficha, partidos y estadísticas de 2 temporadas). */
async function espnBundle(slug, teamId, id) {
  const [rosterData, teamData, athlete, overview] = await Promise.all([
    safe(espn.roster(slug, teamId)),
    safe(espn.team(slug, teamId)),
    safe(espn.athlete(slug, id)),
    safe(espn.overview(slug, id)),
  ]);
  const rosterAthletes = (rosterData && rosterData.athletes) || [];
  const rosterAthlete = rosterAthletes.find(a => String(a.id) === String(id));
  if (!rosterAthlete) throw httpError(404, 'El jugador no figura en el plantel actual de este club');

  const season = (rosterData && rosterData.season && rosterData.season.year) || new Date().getFullYear();
  const [glCur, glPrev, coreCur] = await Promise.all([
    safe(espn.gamelog(slug, id, season)),
    safe(espn.gamelog(slug, id, season - 1)),
    safe(espn.seasonStats(slug, season, id)),
  ]);
  const prevLeague = prevLeagueFrom(glPrev, slug);
  let corePrev = await safe(espn.seasonStats(prevLeague.slug, season - 1, id));
  if (!corePrev && prevLeague.slug !== slug) corePrev = await safe(espn.seasonStats(slug, season - 1, id));

  return {
    rosterData, teamData, athlete, overview, rosterAthletes, rosterAthlete,
    season, glCur, glPrev, coreCur, corePrev, prevLeague,
  };
}

/** Perfil externo: TheSportsDB (datos personales, fotos) + Wikipedia (biografía). */
async function externalProfile(e) {
  const ath = (e.athlete && e.athlete.athlete) || e.rosterAthlete;
  const teamName =
    (e.teamData && e.teamData.team && e.teamData.team.displayName) || (ath.team && ath.team.displayName) || '';
  const profile = await safe(
    tsdb.findPlayer({ name: ath.displayName, lastName: ath.lastName, dob: e.rosterAthlete.dateOfBirth || null, team: teamName })
  );
  const wiki = await safe(wikipedia.getBio({ name: ath.displayName, wikidata: profile && profile.idWikidata }));
  return { profile, wiki };
}

/** Informe completo de un jugador, combinando todas las fuentes. */
async function player(slug, teamId, id) {
  const l = assertLeague(slug);
  const e = await espnBundle(slug, teamId, id);
  const { profile, wiki } = await externalProfile(e);
  return analysis.build({
    ...e,
    league: slug,
    leagueName: l.name,
    seasonName: e.rosterData && e.rosterData.season && e.rosterData.season.displayName,
    teamId,
    tsdb: profile,
    wiki,
  });
}

module.exports = { leagues, league, team, player, espnBundle, LEAGUES };
