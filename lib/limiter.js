// Limitador de consultas por fuente ("token bucket") con dos prioridades:
// las consultas de usuarios pasan primero y la actualización en segundo plano
// solo usa cupo cuando sobra (deja `reserve` tokens libres para usuarios).
// Las respuestas que ya están en caché no consumen cupo.
// Si la fuente responde 429, se pausa: los usuarios no esperan (la sección
// queda vacía y se reintenta en la próxima visita) y el segundo plano espera.
const { getJSON, peek, inRefresh } = require('./fetcher');

const PAUSE_MS = 30_000;

function createLimiter({ perMinute, capacity = 5, reserve = 2 }) {
  const rate = perMinute / 60_000;
  let tokens = capacity;
  let last = Date.now();
  let pausedUntil = 0;
  const queues = { user: [], bg: [] };
  let timer = null;

  function schedule(ms) {
    if (!timer) timer = setTimeout(pump, ms);
  }

  function pump() {
    timer = null;
    const now = Date.now();
    if (now < pausedUntil) {
      // Con la fuente en pausa, a los usuarios se les avisa enseguida
      while (queues.user.length) queues.user.shift().reject(new Error('fuente en pausa (429)'));
      if (queues.bg.length) schedule(pausedUntil - now);
      return;
    }
    tokens = Math.min(capacity, tokens + (now - last) * rate);
    last = now;
    while (tokens >= 1) {
      if (queues.user.length) queues.user.shift().resolve();
      else if (queues.bg.length && tokens >= reserve) queues.bg.shift().resolve();
      else break;
      tokens -= 1;
    }
    if (queues.user.length || queues.bg.length) schedule(250);
  }

  return async function limitedGet(url, opts, tries = 0) {
    const c = await peek(url);
    if (c.hit) return c.data;
    const bg = inRefresh();
    if (!bg && Date.now() < pausedUntil) throw new Error('fuente en pausa (429)');
    await new Promise((resolve, reject) => {
      queues[bg ? 'bg' : 'user'].push({ resolve, reject });
      schedule(0);
    });
    try {
      return await getJSON(url, { ...opts, noRetryOn429: true });
    } catch (err) {
      if (/HTTP 429/.test(err.message)) {
        pausedUntil = Date.now() + (err.retryAfter ? err.retryAfter * 1000 : PAUSE_MS);
        if (bg && tries < 4) return limitedGet(url, opts, tries + 1); // reintenta tras la pausa
      }
      throw err;
    }
  };
}

module.exports = { createLimiter };
