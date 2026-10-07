// Cliente HTTP con caché en memoria + disco.
//
// Los datos NO vencen por tiempo: se mantienen hasta la próxima actualización
// programada (ver lib/refresh.js). Durante una actualización, el código corre
// dentro de un contexto `{ since }` y cualquier dato descargado antes de `since`
// se vuelve a pedir a la fuente. Esto hace que la actualización sea reanudable:
// si se corta, al reanudar con el mismo `since` lo ya actualizado no se repite.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const refreshContext = new AsyncLocalStorage();
const mem = new Map();
const inflight = new Map();

const UA = 'FutbolScout/1.0 (proyecto personal)';
const NOT_FOUND_TTL = 24 * 3600 * 1000; // reintentar "no encontrado" al día siguiente
const MEM_MAX = +process.env.CACHE_MEM_ENTRIES || 5000;

// Modo "perezoso" (hosting): todo lo descargado antes de esta fecha se
// considera vencido y se vuelve a pedir a la fuente en la próxima visita.
let staleBefore = 0;
const setStaleBefore = ts => (staleBefore = ts);

const keyFor = url => crypto.createHash('sha1').update(url).digest('hex');
const fileFor = key => path.join(CACHE_DIR, key.slice(0, 2), key + '.json');

async function readDisk(key) {
  try {
    return JSON.parse(await fs.promises.readFile(fileFor(key), 'utf8'));
  } catch {
    return null;
  }
}

async function writeDisk(key, entry) {
  const f = fileFor(key);
  try {
    await fs.promises.mkdir(path.dirname(f), { recursive: true });
    await fs.promises.writeFile(f, JSON.stringify(entry));
  } catch {}
}

async function doFetch(url, { headers, timeout, noRetryOn429 }) {
  // Con un usuario esperando fallamos rápido; en la actualización en segundo
  // plano tenemos paciencia (y respetamos Retry-After de la fuente).
  const background = !!refreshContext.getStore();
  const attempts = background ? 5 : 2;
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let wait = background ? 5000 * (attempt + 1) ** 2 : 800;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(timeout),
      });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        const ra = +res.headers.get('retry-after');
        const e = new Error(`HTTP ${res.status} ${url}`);
        e.retryAfter = ra > 0 ? Math.min(ra, 300) : null;
        if (res.status === 429 && noRetryOn429) {
          e.final = true; // el limitador de la fuente se encarga
          throw e;
        }
        if (background && e.retryAfter) wait = e.retryAfter * 1000;
        throw e;
      }
      if (!res.ok) return null;
      const data = await res.json();
      // ESPN a veces responde 200 con un cuerpo de error
      if (data && (data.code === 404 || (data.error && data.error.code === 404))) return null;
      return data;
    } catch (err) {
      lastErr = err;
      if (err.final) break;
      if (attempt < attempts - 1) await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

function isFresh(entry, now) {
  if (!entry) return false;
  const ctx = refreshContext.getStore();
  if (ctx && entry.t < ctx.since) return false;
  if (entry.t < staleBefore) return false;
  if (entry.data === null && now - entry.t > NOT_FOUND_TTL) return false;
  return true;
}

/**
 * Obtiene JSON de una URL usando la caché.
 * @returns {Promise<any|null>} null si el recurso no existe
 */
async function getJSON(url, { headers = {}, timeout = 15000, noRetryOn429 = false } = {}) {
  const key = keyFor(url);
  const now = Date.now();

  const m = mem.get(key);
  if (isFresh(m, now)) return m.data;

  const disk = m || (await readDisk(key));
  if (isFresh(disk, now)) {
    mem.set(key, disk);
    return disk.data;
  }

  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    try {
      const data = await doFetch(url, { headers, timeout, noRetryOn429 });
      const entry = { t: Date.now(), data };
      mem.set(key, entry);
      if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value);
      await writeDisk(key, entry);
      return data;
    } catch (err) {
      if (disk) return disk.data; // dato anterior mejor que nada
      throw err;
    }
  })().finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}

/** Devuelve { hit, data } consultando solo la caché (sin red). */
async function peek(url) {
  const key = keyFor(url);
  const now = Date.now();
  const entry = mem.get(key) || (await readDisk(key));
  if (isFresh(entry, now)) {
    mem.set(key, entry);
    return { hit: true, data: entry.data };
  }
  return { hit: false };
}

/** true si el código actual corre dentro de una actualización programada. */
const inRefresh = () => !!refreshContext.getStore();

/** Ejecuta fn forzando a re-descargar todo lo obtenido antes de `since`. */
const runRefresh = (since, fn) => refreshContext.run({ since }, fn);

/** Envuelve una promesa para que nunca rechace (devuelve null en error). */
function safe(promise) {
  return Promise.resolve(promise).catch(err => {
    console.warn('[fuente]', err && err.message);
    return null;
  });
}

module.exports = { getJSON, peek, safe, inRefresh, runRefresh, setStaleBefore };
