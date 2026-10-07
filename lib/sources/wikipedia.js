// Wikipedia: biografía (introducción) en español, con fallback a inglés.
// Una sola consulta por idioma trae búsqueda + extracto + ID de Wikidata; si
// TheSportsDB nos dio el ID de Wikidata del jugador, lo usamos para elegir la
// página exacta (evita confundir homónimos).
const { createLimiter } = require('../limiter');

// Wikimedia limita fuerte a clientes no identificados: consultas espaciadas,
// User-Agent descriptivo y pausa automática ante un 429.
const CONTACT = process.env.WIKI_CONTACT || 'aplicación local sin fines de lucro';
const getJSON = createLimiter({ perMinute: 15, capacity: 2, reserve: 1 });
const headers = { 'User-Agent': `FutbolScout/1.0 (${CONTACT}) Node.js` };

const plain = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function lookup(lang, name, wikidata) {
  const term = lang === 'es' ? 'futbolista' : 'footballer';
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2` +
    `&generator=search&gsrlimit=5&gsrsearch=${encodeURIComponent(`${name} ${term}`)}` +
    `&prop=extracts|pageimages|info|pageprops&exintro=1&explaintext=1&exlimit=5` +
    `&inprop=url&pithumbsize=600&ppprop=wikibase_item&redirects=1`;
  const data = await getJSON(url, { headers });
  const pages = ((data && data.query && data.query.pages) || []).sort((a, b) => a.index - b.index);
  if (!pages.length) return null;

  let page = wikidata && pages.find(p => p.pageprops && p.pageprops.wikibase_item === wikidata);
  if (!page) {
    const last = plain(name.split(' ').pop());
    page = pages.find(
      p => plain(p.title).includes(last) && /futbol|football|soccer/i.test(p.extract || '')
    );
  }
  if (!page || !page.extract) return null;
  return {
    lang,
    title: page.title,
    extract: page.extract.trim(),
    url: page.fullurl,
    image: page.thumbnail && page.thumbnail.source,
  };
}

async function getBio({ name, wikidata }) {
  return (await lookup('es', name, wikidata)) || (await lookup('en', name, wikidata));
}

module.exports = { getBio };
