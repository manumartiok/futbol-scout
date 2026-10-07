// ESPN: clubes, planteles, ficha, estadísticas detalladas, partidos y noticias.
const { getJSON } = require('../fetcher');

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const WEB = 'https://site.web.api.espn.com/apis/common/v3/sports/soccer';
const CORE = 'https://sports.core.api.espn.com/v2/sports/soccer/leagues';

module.exports = {
  teams: league => getJSON(`${SITE}/${league}/teams`),
  team: (league, id) => getJSON(`${SITE}/${league}/teams/${id}`),
  roster: (league, id) => getJSON(`${SITE}/${league}/teams/${id}/roster`),
  athlete: (league, id) => getJSON(`${WEB}/${league}/athletes/${id}`),
  overview: (league, id) => getJSON(`${WEB}/${league}/athletes/${id}/overview`),
  gamelog: (league, id, season) => getJSON(`${WEB}/${league}/athletes/${id}/gamelog?season=${season}`),
  seasonStats: (league, season, id) =>
    getJSON(`${CORE}/${league}/seasons/${season}/types/1/athletes/${id}/statistics`),
};
