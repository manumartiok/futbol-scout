// TheSportsDB: posición específica, pie hábil, lugar de nacimiento, fotos,
// redes sociales e ID de Wikidata (que usamos para encontrar la página de Wikipedia).
const { createLimiter } = require('../limiter');

const BASE = 'https://www.thesportsdb.com/api/v1/json/3';

// La API gratuita permite ~30 consultas por minuto.
const throttled = createLimiter({ perMinute: 28, capacity: 8, reserve: 4 });

const norm = s =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

async function search(name) {
  const q = encodeURIComponent(norm(name).replace(/ /g, '_'));
  const data = await throttled(`${BASE}/searchplayers.php?p=${q}`);
  return (data && data.player) || [];
}

/**
 * Busca al jugador y valida coincidencia por fecha de nacimiento o club.
 * @param {{name:string, lastName?:string, dob?:string, team?:string}} p
 */
async function findPlayer({ name, lastName, dob, team }) {
  let results = (await search(name)).filter(r => r.strSport === 'Soccer');
  if (!results.length && lastName && lastName !== name) {
    results = (await search(lastName)).filter(r => r.strSport === 'Soccer');
  }
  if (!results.length) return null;

  const day = dob ? dob.slice(0, 10) : null;
  const teamN = norm(team);
  const score = r => {
    let s = 0;
    if (day && r.dateBorn === day) s += 10;
    const rt = norm(r.strTeam);
    if (teamN && rt && (rt.includes(teamN) || teamN.includes(rt))) s += 5;
    if (norm(r.strPlayer) === norm(name)) s += 2;
    return s;
  };
  const best = results.map(r => [score(r), r]).sort((a, b) => b[0] - a[0])[0];
  // Sin coincidencia de nacimiento ni club, no nos arriesgamos a mezclar jugadores
  if (best[0] < 5) return null;

  const full = await throttled(`${BASE}/lookupplayer.php?id=${best[1].idPlayer}`);
  return (full && full.players && full.players[0]) || best[1];
}

module.exports = { findPlayer };
