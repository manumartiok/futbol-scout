// Actualización programada: dos veces por semana (lunes y jueves a las 04:00,
// es decir cada 3-4 días) vuelve a descargar ligas, clubes, planteles y el
// informe de cada jugador desde las mismas fuentes.
//
// - Si el servidor estaba apagado en el horario programado, la actualización
//   corre apenas se inicia.
// - Es reanudable: si se interrumpe, continúa donde quedó (lo ya descargado en
//   esta corrida no se vuelve a pedir).
// - Un "latido" en el archivo de estado evita que dos procesos actualicen a la vez.
const fs = require('fs');
const path = require('path');
const api = require('./api');
const { runRefresh, setStaleBefore } = require('./fetcher');

// "full" (por defecto): descarga todo en segundo plano en cada horario.
// "lazy" (hosting gratuito, donde el servidor se duerme y el disco es efímero):
// en cada horario los datos pasan a estar vencidos y se renuevan desde las
// fuentes en la próxima visita a cada club o jugador.
const MODE = process.env.REFRESH_MODE === 'lazy' ? 'lazy' : 'full';

const STATE_FILE = path.join(__dirname, '..', 'data', 'refresh-state.json');
const SLOT_DAYS = [1, 4]; // 1 = lunes, 4 = jueves
const SLOT_HOUR = 4;
const HEARTBEAT_STALE = 3 * 60 * 1000;
const CONCURRENCY = 6;

let current = null; // promesa de la corrida en curso en este proceso

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(s) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function updateState(patch) {
  const s = { ...readState(), ...patch };
  writeState(s);
  return s;
}

/** Último horario programado <= now. */
function lastSlot(now = new Date()) {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(SLOT_HOUR, 0, 0, 0);
    if (SLOT_DAYS.includes(d.getDay()) && d <= now) return d;
  }
  return null;
}

/** Próximo horario programado > now. */
function nextSlot(now = new Date()) {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    d.setHours(SLOT_HOUR, 0, 0, 0);
    if (SLOT_DAYS.includes(d.getDay()) && d > now) return d;
  }
  return null;
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

async function job(since, reason) {
  const log = (...a) => console.log(`[actualización]`, ...a);
  const state = updateState({
    running: { since, reason, pid: process.pid, heartbeat: Date.now(), phase: 'clubes', done: 0, total: 0, errors: 0 },
  });
  const progress = { ...state.running };
  const beat = setInterval(() => {
    progress.heartbeat = Date.now();
    updateState({ running: progress });
  }, 20_000);

  log(`inicio (${reason})`);
  try {
    await runRefresh(since, async () => {
      // 1) Ligas y clubes
      const leagues = await api.leagues();
      const teams = [];
      for (const l of leagues) for (const t of l.teams) teams.push({ slug: l.slug, id: t.id });
      log(`${leagues.length} ligas, ${teams.length} clubes`);

      // 2) Planteles
      const players = [];
      progress.phase = 'planteles';
      progress.total = teams.length;
      progress.done = 0;
      await pool(teams, CONCURRENCY, async t => {
        try {
          const r = await api.team(t.slug, t.id);
          for (const p of r.players) players.push({ slug: t.slug, teamId: t.id, id: p.id });
        } catch (e) {
          progress.errors++;
          log('error plantel', t.slug, t.id, e.message);
        }
        progress.done++;
      });
      log(`${players.length} jugadores`);

      // 3) Estadísticas y partidos de cada jugador (ESPN): rápido, así el
      //    rendimiento queda al día en todas las ligas en la primera hora.
      progress.phase = 'estadísticas';
      progress.total = players.length;
      progress.done = 0;
      await pool(players, CONCURRENCY, async p => {
        try {
          await api.espnBundle(p.slug, p.teamId, p.id);
        } catch (e) {
          progress.errors++;
        }
        progress.done++;
        if (progress.done % 500 === 0) log(`estadísticas ${progress.done}/${progress.total}`);
      });

      // 4) Perfiles (TheSportsDB + Wikipedia). Estas fuentes limitan las
      //    consultas por minuto, así que esta fase avanza más lento (horas) y
      //    siempre deja lugar a las consultas de quien está usando la página.
      progress.phase = 'perfiles';
      progress.done = 0;
      await pool(players, 3, async p => {
        try {
          await api.player(p.slug, p.teamId, p.id);
        } catch (e) {
          progress.errors++;
        }
        progress.done++;
        if (progress.done % 250 === 0) log(`perfiles ${progress.done}/${progress.total}`);
      });
    });
    log(`fin: ${progress.done} jugadores, ${progress.errors} errores`);
    updateState({
      running: null,
      lastStart: since,
      lastEnd: Date.now(),
      lastSummary: { players: progress.done, errors: progress.errors },
    });
  } finally {
    clearInterval(beat);
  }
}

/** Arranca una actualización si corresponde (o si se fuerza). */
function check({ force = false } = {}) {
  if (current) return current;
  const s = readState();
  const now = Date.now();

  if (s.running && s.running.pid !== process.pid && now - s.running.heartbeat < HEARTBEAT_STALE) {
    return null; // otro proceso está actualizando
  }

  let since = null, reason = null;
  if (s.running) {
    since = s.running.since; // reanudar corrida interrumpida
    reason = 'reanudación';
  } else if (force) {
    since = now;
    reason = 'manual';
  } else if (!s.lastStart) {
    // Primera ejecución: los datos se descargan a demanda; la primera
    // actualización completa será en el próximo horario programado.
    updateState({ lastStart: now, lastEnd: now, firstRun: true });
    return null;
  } else {
    const slot = lastSlot(new Date(now));
    if (slot && s.lastStart < slot.getTime()) {
      since = now;
      reason = 'programada';
    }
  }
  if (!since) return null;

  current = job(since, reason)
    .catch(e => console.error('[actualización] falló:', e))
    .finally(() => (current = null));
  return current;
}

function startScheduler() {
  if (MODE === 'lazy') {
    const tick = () => setStaleBefore(lastSlot().getTime());
    tick();
    setInterval(tick, 60 * 1000).unref();
    console.log('[actualización] modo lazy: datos vencen lunes y jueves 04:00');
    return;
  }
  check();
  setInterval(check, 10 * 60 * 1000).unref();
}

function status() {
  if (MODE === 'lazy') {
    return {
      mode: MODE,
      lastUpdate: lastSlot().getTime(),
      nextUpdate: nextSlot().getTime(),
      schedule: 'Lunes y jueves a las 04:00',
      running: null,
    };
  }
  const s = readState();
  return {
    mode: MODE,
    lastUpdate: s.firstRun && s.lastStart === s.lastEnd ? null : s.lastEnd || null,
    nextUpdate: nextSlot().getTime(),
    schedule: 'Lunes y jueves a las 04:00',
    running: s.running
      ? { phase: s.running.phase, done: s.running.done, total: s.running.total, since: s.running.since }
      : null,
    lastSummary: s.lastSummary || null,
  };
}

module.exports = { startScheduler, check, status, MODE };
