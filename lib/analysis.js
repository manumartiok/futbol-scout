// Motor de análisis: combina los datos crudos de todas las fuentes y produce
// el informe final de cada jugador (valoraciones, forma, rol, aporte, veredicto).

// ---------------------------------------------------------------- utilidades
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 2) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const num = v => (v == null || v === '' || isNaN(+v) ? null : +v);
const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

// Métricas que ESPN informa como 0 cuando no las releva en esa liga: con
// minutos suficientes, un 0 en estas significa "sin dato", no "cero".
const ZERO_IS_MISSING = ['recoveries', 'duels', 'duelsWon', 'duelsLost', 'progressiveCarries', 'touchesInOppBox', 'touches'];

/** Aplana las categorías de estadísticas de ESPN Core en { nombre: valor }. */
function flattenCore(core) {
  const cats = core && core.splits && core.splits.categories;
  if (!cats) return null;
  const out = {};
  for (const c of cats) for (const s of c.stats || []) out[s.name] = num(s.value);
  if (out.minutes >= 270) {
    for (const k of ZERO_IS_MISSING) if (out[k] === 0) out[k] = null;
    // Familias completas sin relevar (todos sus indicadores en 0)
    for (const f of UNTRACKED_FAMILIES) {
      if (f.indicators.every(k => !out[k])) for (const k of f.keys) if (k in out) out[k] = null;
    }
  }
  return out;
}

const UNTRACKED_FAMILIES = [
  {
    indicators: ['totalPasses', 'accuratePasses'],
    keys: ['totalPasses', 'accuratePasses', 'inaccuratePasses', 'passPct', 'totalLongBalls', 'accurateLongBalls',
      'inaccurateLongBalls', 'longballPct', 'totalCrosses', 'accurateCrosses', 'inaccurateCrosses', 'crossPct',
      'totalThroughBalls', 'accurateThroughBalls', 'inaccurateThroughBalls', 'throughBallPct'],
  },
  {
    indicators: ['totalTackles', 'interceptions', 'totalClearance'],
    keys: ['totalTackles', 'effectiveTackles', 'inneffectiveTackles', 'tacklesLost', 'tacklePct', 'interceptions',
      'totalClearance', 'effectiveClearance', 'blockedShots', 'recoveries'],
  },
];

/** Aplana las estadísticas que vienen en el plantel. */
function flattenRoster(a) {
  const cats = a && a.statistics && a.statistics.splits && a.statistics.splits.categories;
  const out = {};
  for (const c of cats || []) for (const s of c.stats || []) out[s.name] = num(s.value);
  return out;
}

// ---------------------------------------------------------------- posiciones
const POS_ES = {
  goalkeeper: 'Arquero',
  'centre-back': 'Defensor central',
  'center-back': 'Defensor central',
  'left-back': 'Lateral izquierdo',
  'right-back': 'Lateral derecho',
  'left wing-back': 'Carrilero izquierdo',
  'right wing-back': 'Carrilero derecho',
  'defensive midfield': 'Mediocentro defensivo',
  'central midfield': 'Mediocentro',
  'centre midfield': 'Mediocentro',
  'attacking midfield': 'Mediapunta',
  'left midfield': 'Volante izquierdo',
  'right midfield': 'Volante derecho',
  'left wing': 'Extremo izquierdo',
  'left winger': 'Extremo izquierdo',
  'right wing': 'Extremo derecho',
  'right winger': 'Extremo derecho',
  'centre-forward': 'Delantero centro',
  'center-forward': 'Delantero centro',
  'second striker': 'Segundo delantero',
  striker: 'Delantero centro',
  forward: 'Delantero',
  midfielder: 'Mediocampista',
  defender: 'Defensor',
  defence: 'Defensor',
  midfield: 'Mediocampista',
  attack: 'Delantero',
};

const GROUP_ES = { G: 'Arquero', D: 'Defensor', M: 'Mediocampista', F: 'Delantero' };

function groupOf(pos) {
  const n = ((pos && (pos.name || pos.displayName)) || '').toLowerCase();
  const ab = ((pos && pos.abbreviation) || '').toUpperCase();
  if (n.includes('goal') || ab === 'G' || ab === 'GK') return 'G';
  if (n.includes('def') || ab.startsWith('D') || ab.startsWith('CB') || /^[LR]B$/.test(ab)) return 'D';
  if (n.includes('mid') || ab.startsWith('M') || ab.startsWith('CM') || ab.startsWith('DM') || ab.startsWith('AM')) return 'M';
  return 'F';
}

const posEs = s => (s ? POS_ES[s.toLowerCase().trim()] || null : null);

// ---------------------------------------------------------------- unidades
const inchesToCm = i => (i ? Math.round(i * 2.54) : null);
const lbsToKg = l => (l ? Math.round(l * 0.4536) : null);
function parseHeight(s) {
  if (!s) return null;
  let cm = null;
  const c = s.match(/(\d{3})\s*cm/i);
  const m = s.match(/(\d)[.,](\d{2})\s*m/i);
  const ft = s.match(/(\d)\s*(?:ft|')\s*(\d{1,2})?/i);
  if (c) cm = +c[1];
  else if (m) cm = +m[1] * 100 + +m[2];
  else if (ft) cm = Math.round((+ft[1] * 12 + +(ft[2] || 0)) * 2.54);
  return cm && cm >= 145 && cm <= 215 ? cm : null; // descartar valores absurdos
}
function parseWeight(s) {
  if (!s) return null;
  const kg = s.match(/(\d{2,3})\s*kg/i);
  if (kg) return +kg[1];
  const lb = s.match(/(\d{2,3})\s*lb/i);
  return lb ? lbsToKg(+lb[1]) : null;
}
const FOOT_ES = { left: 'Zurdo', right: 'Diestro', both: 'Ambidiestro' };

// ---------------------------------------------------------------- métricas
// Combina temporadas: cada métrica suma solo en las temporadas donde existe,
// junto con los minutos de esas temporadas (así un campo ausente en una liga
// no diluye el promedio).
function combineSeasons(seasons) {
  const acc = {};
  for (const s of seasons) {
    if (!s || !s.minutes) continue;
    for (const [k, v] of Object.entries(s)) {
      if (v == null) continue;
      acc[k] = acc[k] || { v: 0, min: 0, n: 0 };
      acc[k].v += v;
      acc[k].min += s.minutes;
      acc[k].n++;
    }
  }
  return acc;
}

function metricsFrom(acc) {
  const total = k => (acc[k] ? acc[k].v : null);
  const p90 = k => (acc[k] && acc[k].min > 0 ? (acc[k].v / acc[k].min) * 90 : null);
  const ratio = (a, b, minB = 1) => {
    const x = total(a), y = total(b);
    return x != null && y != null && y >= minB ? x / y : null;
  };
  const minutes = total('minutes') || 0;
  const apps = total('appearances') || 0;
  const discipline =
    p90('foulsCommitted') != null
      ? p90('foulsCommitted') + 3 * (p90('yellowCards') || 0) + 8 * (p90('redCards') || 0)
      : null;
  const saves = total('saves'), conc = total('goalsConceded');

  return {
    minutes,
    apps,
    starts: total('starts'),
    goals: total('totalGoals'),
    assists: total('goalAssists'),
    goals90: p90('totalGoals'),
    assists90: p90('goalAssists'),
    shots90: p90('totalShots'),
    sotPct: ratio('shotsOnTarget', 'totalShots', 5),
    conversion: ratio('totalGoals', 'totalShots', 5),
    keyPasses90: p90('shotAssists'),
    bigChances90: p90('bigChanceCreated'),
    passes90: p90('accuratePasses'),
    passAcc: ratio('accuratePasses', 'totalPasses', 30),
    longBallAcc: ratio('accurateLongBalls', 'totalLongBalls', 8),
    crossAcc: ratio('accurateCrosses', 'totalCrosses', 8),
    progCarries90: p90('progressiveCarries'),
    foulsSuffered90: p90('foulsSuffered'),
    boxTouches90: p90('touchesInOppBox'),
    tackles90: p90('totalTackles'),
    tacklePct: ratio('effectiveTackles', 'totalTackles', 5),
    interceptions90: p90('interceptions'),
    clearances90: p90('totalClearance'),
    blocks90: p90('blockedShots'),
    recoveries90: p90('recoveries'),
    duelPct: ratio('duelsWon', 'duels', 10),
    discipline90: discipline,
    yellow: total('yellowCards'),
    red: total('redCards'),
    saves90: p90('saves'),
    savePct: saves != null && conc != null && saves + conc >= 5 ? saves / (saves + conc) : null,
    conceded90: p90('goalsConceded'),
    cleanSheetRate: apps && total('cleanSheet') != null ? total('cleanSheet') / apps : null,
    cleanSheets: total('cleanSheet'),
  };
}

// Referencias por puesto: [nivel bajo, nivel élite] para cada métrica.
// `inv` indica que menos es mejor.
const BENCH = {
  F: {
    goals90: [0.1, 0.75], shots90: [1, 3.8], sotPct: [0.25, 0.55], conversion: [0.06, 0.25],
    assists90: [0.03, 0.35], keyPasses90: [0.5, 2.5], bigChances90: [0, 0.5],
    passes90: [10, 35], passAcc: [0.6, 0.85], longBallAcc: [0.25, 0.65],
    progCarries90: [1, 5], foulsSuffered90: [0.4, 2.5], boxTouches90: [2, 8], crossAcc: [0.12, 0.4],
    tackles90: [0.3, 1.8], tacklePct: [0.35, 0.75], interceptions90: [0.1, 0.8],
    clearances90: [0, 1], blocks90: [0.05, 0.6], recoveries90: [2, 6],
    duelPct: [0.33, 0.6], discipline90: [3, 0.4, 'inv'],
  },
  M: {
    goals90: [0.03, 0.4], shots90: [0.4, 2.5], sotPct: [0.2, 0.5], conversion: [0.04, 0.2],
    assists90: [0.03, 0.35], keyPasses90: [0.5, 2.8], bigChances90: [0, 0.5],
    passes90: [25, 70], passAcc: [0.72, 0.92], longBallAcc: [0.3, 0.7],
    progCarries90: [1, 5], foulsSuffered90: [0.4, 2.2], boxTouches90: [0.5, 4], crossAcc: [0.15, 0.4],
    tackles90: [1, 3.5], tacklePct: [0.4, 0.75], interceptions90: [0.4, 1.8],
    clearances90: [0.2, 2], blocks90: [0.1, 1], recoveries90: [4, 9],
    duelPct: [0.38, 0.62], discipline90: [3, 0.5, 'inv'],
  },
  D: {
    goals90: [0, 0.15], shots90: [0.2, 1.2], sotPct: [0.15, 0.5], conversion: [0.03, 0.2],
    assists90: [0, 0.2], keyPasses90: [0.2, 1.5], bigChances90: [0, 0.3],
    passes90: [25, 65], passAcc: [0.72, 0.92], longBallAcc: [0.35, 0.7],
    progCarries90: [0.5, 3.5], foulsSuffered90: [0.2, 1.5], boxTouches90: [0.2, 2], crossAcc: [0.15, 0.4],
    tackles90: [1, 3], tacklePct: [0.45, 0.8], interceptions90: [0.6, 2],
    clearances90: [1.5, 6], blocks90: [0.2, 1.3], recoveries90: [4, 8],
    duelPct: [0.42, 0.68], discipline90: [2.8, 0.5, 'inv'],
  },
  G: {
    savePct: [0.55, 0.8], saves90: [1.5, 4], conceded90: [1.8, 0.7, 'inv'], cleanSheetRate: [0.1, 0.45],
    passAcc: [0.5, 0.85], longBallAcc: [0.3, 0.6], discipline90: [0.6, 0, 'inv'],
  },
};

const ATTRS = {
  outfield: [
    { key: 'finishing', label: 'Definición', metrics: { goals90: 3, conversion: 2, sotPct: 1, shots90: 1 } },
    { key: 'creation', label: 'Creación', metrics: { assists90: 2, keyPasses90: 3, bigChances90: 1 } },
    { key: 'passing', label: 'Pase', metrics: { passAcc: 3, passes90: 2, longBallAcc: 1 } },
    { key: 'progression', label: 'Desequilibrio', metrics: { progCarries90: 3, foulsSuffered90: 1, boxTouches90: 2, crossAcc: 1 } },
    { key: 'defending', label: 'Defensa', metrics: { tackles90: 2, interceptions90: 2, clearances90: 1, blocks90: 1, recoveries90: 2, tacklePct: 1 } },
    { key: 'duels', label: 'Duelos', metrics: { duelPct: 1 } },
    { key: 'discipline', label: 'Disciplina', metrics: { discipline90: 1 } },
  ],
  G: [
    { key: 'shotStopping', label: 'Atajadas', metrics: { savePct: 3, saves90: 1 } },
    { key: 'solidity', label: 'Solidez', metrics: { conceded90: 2, cleanSheetRate: 2 } },
    { key: 'distribution', label: 'Juego con los pies', metrics: { passAcc: 2, longBallAcc: 1 } },
    { key: 'discipline', label: 'Disciplina', metrics: { discipline90: 1 } },
  ],
};

const WEIGHTS = {
  F: { finishing: 0.32, creation: 0.18, passing: 0.08, progression: 0.2, defending: 0.05, duels: 0.1, discipline: 0.07 },
  M: { finishing: 0.12, creation: 0.22, passing: 0.22, progression: 0.14, defending: 0.16, duels: 0.1, discipline: 0.04 },
  D: { finishing: 0.04, creation: 0.08, passing: 0.2, progression: 0.1, defending: 0.36, duels: 0.16, discipline: 0.06 },
  G: { shotStopping: 0.45, solidity: 0.3, distribution: 0.15, discipline: 0.1 },
};

function scoreMetric(v, b) {
  if (v == null || !b) return null;
  const [lo, hi] = b;
  const t = clamp((v - lo) / (hi - lo), 0, 1); // funciona también invertido (lo > hi)
  return 25 + 72 * t;
}

function rateAttributes(group, m) {
  const defs = group === 'G' ? ATTRS.G : ATTRS.outfield;
  const bench = BENCH[group];
  // Con pocos minutos la muestra es poco fiable: acercamos las notas a la media.
  const confidence = clamp(m.minutes / 900, 0, 1);
  const attrs = [];
  for (const a of defs) {
    let sum = 0, w = 0;
    for (const [k, wk] of Object.entries(a.metrics)) {
      const s = scoreMetric(m[k], bench[k]);
      if (s != null) { sum += s * wk; w += wk; }
    }
    if (!w) continue;
    const raw = sum / w;
    attrs.push({ key: a.key, label: a.label, value: Math.round(55 + (raw - 55) * confidence) });
  }
  let tot = 0, tw = 0;
  for (const a of attrs) {
    const w = WEIGHTS[group][a.key] || 0;
    tot += a.value * w;
    tw += w;
  }
  return { attributes: attrs, overall: tw ? Math.round(tot / tw) : null, confidence: round(confidence, 2) };
}

// ---------------------------------------------------------------- forma reciente
// El registro por partido de ESPN no trae acciones defensivas, así que para
// defensores y mediocampistas usamos los goles recibidos por el equipo como
// aproximación de su rendimiento sin pelota.
function matchRating(st, result, group, conceded) {
  const g = st.totalGoals || 0, a = st.goalAssists || 0;
  const base = { G: 6.3, D: 6.4, M: 6.35, F: 6.2 }[group];
  let r = base + g * 1.0 + a * 0.7;
  if (conceded != null && (group === 'D' || group === 'M')) {
    const w = group === 'D' ? 1 : 0.5;
    r += conceded === 0 ? 0.5 * w : -Math.min(3, conceded) * 0.15 * w;
  }
  r += (st.shotsOnTarget || 0) * 0.15 + Math.max(0, (st.totalShots || 0) - (st.shotsOnTarget || 0)) * 0.03;
  r += (st.foulsSuffered || 0) * 0.05 - (st.foulsCommitted || 0) * 0.06 - (st.offsides || 0) * 0.03;
  r -= (st.yellowCards || 0) * 0.3 + (st.redCards || 0) * 1.5;
  if (group === 'G') {
    r += (st.saves || 0) * 0.2 - (st.goalsConceded || 0) * 0.3 + (st.cleanSheet ? 0.5 : 0);
  }
  if (result === 'W') r += 0.25;
  if (result === 'L') r -= 0.25;
  return round(clamp(r, 4, 10), 1);
}

/** Une gamelog (temporada actual y anterior) y "últimos 5" del overview. */
function collectMatches(logs, overview, group) {
  const byId = new Map();
  const add = (eventId, names, stats, ev, extra = {}) => {
    if (!ev) return;
    const st = {};
    names.forEach((n, i) => (st[n] = num(stats[i])));
    const prev = byId.get(eventId);
    const home = ev.team && ev.homeTeamId === ev.team.id;
    const conceded = num(home ? ev.awayTeamScore : ev.homeTeamScore);
    byId.set(eventId, {
      id: eventId,
      date: ev.gameDate,
      opponent: ev.opponent && ev.opponent.displayName,
      opponentLogo: ev.opponent && ev.opponent.logo,
      atVs: ev.atVs,
      score: ev.homeTeamScore != null ? `${ev.homeTeamScore}-${ev.awayTeamScore}` : ev.score,
      home,
      conceded,
      result: ev.gameResult,
      competition: ev.leagueShortName || ev.leagueName,
      stats: { ...(prev && prev.stats), ...st },
      started: extra.started != null ? extra.started : prev && prev.started,
    });
  };

  for (const gl of logs) {
    if (!gl || !gl.seasonTypes) continue;
    for (const stype of gl.seasonTypes)
      for (const cat of stype.categories || [])
        for (const e of cat.events || []) add(e.eventId, gl.names, e.stats, gl.events[e.eventId]);
  }
  const ovLog = overview && overview.gameLog;
  if (ovLog && ovLog.statistics && ovLog.statistics[0]) {
    const s = ovLog.statistics[0];
    for (const e of s.events || []) {
      const names = s.names.slice(), stats = e.stats.slice();
      let started = null;
      const i = names.indexOf('appearances');
      if (i >= 0) {
        started = /start/i.test(stats[i]);
        names.splice(i, 1);
        stats.splice(i, 1);
      }
      add(e.eventId, names, stats, ovLog.events && ovLog.events[e.eventId], { started });
    }
  }

  const matches = [...byId.values()]
    .filter(m => m.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10);
  for (const m of matches) m.rating = matchRating(m.stats, m.result, group, m.conceded);
  return matches;
}

function analyzeForm(matches) {
  if (!matches.length) return null;
  const last5 = matches.slice(0, 5), prev5 = matches.slice(5, 10);
  const a5 = avg(last5.map(m => m.rating));
  const base = prev5.length >= 3 ? avg(prev5.map(m => m.rating)) : 6.6;
  const diff = a5 - base;
  const trend = diff > 0.3 ? 'up' : diff < -0.3 ? 'down' : 'flat';
  const level = a5 >= 7.25 ? 'Excelente' : a5 >= 6.8 ? 'Buena' : a5 >= 6.3 ? 'Regular' : 'Baja';
  const sum = k => last5.reduce((s, m) => s + (m.stats[k] || 0), 0);
  return {
    average: round(a5, 2),
    baseline: round(base, 2),
    trend,
    trendLabel: { up: 'En alza', down: 'En baja', flat: 'Estable' }[trend],
    level,
    last5: {
      games: last5.length,
      goals: sum('totalGoals'),
      assists: sum('goalAssists'),
      shots: sum('totalShots'),
      wins: last5.filter(m => m.result === 'W').length,
      draws: last5.filter(m => m.result === 'D').length,
      losses: last5.filter(m => m.result === 'L').length,
    },
  };
}

// ---------------------------------------------------------------- rol y aporte
function detectRole(group, specific, A) {
  const s = (specific || '').toLowerCase();
  const v = k => (A[k] == null ? 50 : A[k]);
  if (group === 'G') {
    if (v('shotStopping') >= 75) return { label: 'Arquero atajador', desc: 'Se destaca bajo los tres palos: sostiene al equipo con atajadas y un alto porcentaje de remates detenidos.' };
    if (v('distribution') >= 72) return { label: 'Arquero de juego con los pies', desc: 'Participa de la salida del equipo; su distribución es parte del plan de juego.' };
    return { label: 'Arquero', desc: 'Responsable del arco; su aporte se mide en atajadas, vallas invictas y seguridad.' };
  }
  if (group === 'D') {
    const fullback = /back|lateral|wing|left|right/.test(s) && !/centre|center/.test(s);
    if (fullback) {
      if (v('progression') >= 62 || v('creation') >= 62) return { label: 'Lateral ofensivo', desc: 'Lateral de proyección: suma en ataque con conducciones y centros además de cumplir en defensa.' };
      return { label: 'Lateral defensivo', desc: 'Lateral de perfil conservador, prioriza el orden defensivo y los duelos por su banda.' };
    }
    if (v('passing') >= 72 && v('defending') >= 60) return { label: 'Central con salida', desc: 'Defensor central que además inicia el juego con pases limpios desde el fondo.' };
    if (v('defending') >= 70 || v('duels') >= 70) return { label: 'Central dominante', desc: 'Fuerte en el uno contra uno y en el juego aéreo; limpia el área con despejes, quites e intercepciones.' };
    if (v('passing') >= 62) return { label: 'Central de salida limpia', desc: 'Defensor central que prioriza la circulación segura de la pelota desde el fondo.' };
    if (v('defending') >= 55) return { label: 'Central de marca', desc: 'Defensor central de perfil marcador, enfocado en cerrar espacios y ganar duelos.' };
    return { label: 'Defensor central', desc: 'Cumple funciones defensivas dentro del bloque del equipo, sin un rasgo estadístico dominante.' };
  }
  if (group === 'M') {
    if ((v('defending') >= 70 && v('creation') < 60) || (/defensive/.test(s) && v('defending') >= 55 && v('creation') < 65)) return { label: 'Mediocentro de contención', desc: 'Protege a la defensa: recupera pelotas, corta líneas de pase y equilibra al equipo.' };
    if (v('passing') >= 70 && v('creation') >= 62) return { label: 'Organizador', desc: 'Dicta el ritmo del equipo con volumen y precisión de pase, y genera situaciones para sus compañeros.' };
    if (v('creation') >= 70 || /attacking/.test(s)) return { label: 'Mediapunta creativo', desc: 'Juega entre líneas y es el encargado del último pase.' };
    if (v('defending') >= 60 && (v('progression') >= 58 || v('finishing') >= 58)) return { label: 'Box-to-box', desc: 'Mediocampista de ida y vuelta: recupera, conduce y llega al área rival.' };
    return { label: 'Mediocampista de equilibrio', desc: 'Aporta orden y circulación en el medio sin un rasgo dominante.' };
  }
  const winger = /wing|extremo/.test(s);
  if (winger && v('progression') >= 60) return { label: 'Extremo desequilibrante', desc: 'Encara, conduce hacia adelante y genera ventajas por su banda.' };
  if (v('finishing') >= 72) return { label: 'Goleador', desc: 'Referencia ofensiva: su principal aporte es el gol y la presencia en el área.' };
  if (v('creation') >= 68) return { label: 'Delantero asociativo', desc: 'Atacante que participa en la generación, baja a asociarse y habilita a sus compañeros.' };
  if (v('defending') >= 55) return { label: 'Delantero de presión', desc: 'Trabaja sin pelota y presiona la salida rival además de sus tareas ofensivas.' };
  if (winger) return { label: 'Extremo', desc: 'Atacante de banda.' };
  return { label: 'Delantero', desc: 'Jugador de ataque.' };
}

function usageLabel(share) {
  if (share == null) return null;
  if (share >= 0.85) return 'Titular indiscutido';
  if (share >= 0.6) return 'Titular habitual';
  if (share >= 0.35) return 'Rotación';
  if (share >= 0.1) return 'Suplente / revulsivo';
  return 'Poco utilizado';
}

function contribution({ cur, rosterStats, teamGames, rosterAthletes }) {
  let teamGoals = 0;
  for (const a of rosterAthletes) teamGoals += flattenRoster(a).totalGoals || 0;
  const g = (cur && cur.totalGoals) || 0, as = (cur && cur.goalAssists) || 0;
  const minutes = cur && cur.minutes;
  const minuteShare = teamGames && minutes != null ? clamp(minutes / (teamGames * 90), 0, 1) : null;
  const appShare = teamGames && rosterStats.appearances != null ? clamp(rosterStats.appearances / teamGames, 0, 1) : null;
  const share = minuteShare != null ? minuteShare : appShare;
  return {
    teamGames,
    teamGoals,
    minuteShare: round(minuteShare, 3),
    appShare: round(appShare, 3),
    goalShare: teamGoals ? round(g / teamGoals, 3) : null,
    gaShare: teamGoals ? round(Math.min(1, (g + as) / teamGoals), 3) : null,
    usage: usageLabel(share),
  };
}

// ---------------------------------------------------------------- veredicto
const fmt = (v, d = 2) => (v == null ? '—' : v.toFixed(d).replace('.', ','));
const pct = v => (v == null ? '—' : `${Math.round(v * 100)}%`);

function verdict({ name, age, group, role, team, metrics, rating, form, contrib }) {
  const parts = [];
  const sorted = [...rating.attributes].filter(a => a.key !== 'discipline').sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 2).map(a => a.label.toLowerCase());
  const low = sorted.length > 2 ? sorted[sorted.length - 1] : null;

  parts.push(`${name}${age ? ` (${age} años)` : ''} es un ${role.label.toLowerCase()} de ${team}.`);

  if (metrics.minutes > 0) {
    if (group === 'G') {
      parts.push(
        `En ${metrics.minutes.toLocaleString('es')} minutos analizados ataja el ${pct(metrics.savePct)} de los remates al arco` +
          `, recibe ${fmt(metrics.conceded90)} goles cada 90 minutos y mantuvo la valla invicta en ${metrics.cleanSheets ?? '—'} partidos.`
      );
    } else {
      parts.push(
        `En ${metrics.minutes.toLocaleString('es')} minutos analizados promedia ${fmt(metrics.goals90)} goles y ${fmt(metrics.assists90)} asistencias cada 90 minutos` +
          (metrics.passAcc != null ? `, con un ${pct(metrics.passAcc)} de precisión en el pase.` : '.')
      );
    }
  } else {
    parts.push('Todavía no registra minutos suficientes en las competiciones analizadas para evaluarlo con números.');
  }

  if (top.length && metrics.minutes > 0) {
    parts.push(`Sus puntos fuertes son ${top.join(' y ')}${low && low.value < 50 ? `, mientras que ${low.label.toLowerCase()} es el aspecto a mejorar` : ''}.`);
  }

  if (form) {
    const l = form.last5;
    const gaTxt = group === 'G' ? '' : `: ${l.goals} gol${l.goals === 1 ? '' : 'es'} y ${l.assists} asistencia${l.assists === 1 ? '' : 's'} en sus últimos ${l.games} partidos`;
    parts.push(`Llega en forma ${form.level.toLowerCase()} y con tendencia ${form.trendLabel.toLowerCase()}${gaTxt}.`);
  }

  if (contrib && contrib.usage) {
    let s = `En el equipo es ${contrib.usage.toLowerCase()}`;
    if (contrib.minuteShare != null) s += ` (jugó el ${pct(contrib.minuteShare)} de los minutos de la temporada)`;
    if (group !== 'G' && contrib.gaShare) s += ` y participó en el ${pct(contrib.gaShare)} de los goles del equipo`;
    parts.push(s + '.');
  }

  if (rating.confidence < 0.5) parts.push('Atención: la muestra de minutos es chica, las valoraciones son orientativas.');
  return parts.join(' ');
}

// ---------------------------------------------------------------- informe
function build(ctx) {
  const {
    league, leagueName, season, seasonName, teamId, rosterAthlete, rosterAthletes, teamData, athlete, overview,
    glCur, glPrev, coreCur, corePrev, prevLeague, tsdb, wiki,
  } = ctx;

  const ath = (athlete && athlete.athlete) || {};
  const ra = rosterAthlete || {};
  const name = ath.displayName || ra.displayName;
  const group = groupOf(ath.position || ra.position || (tsdb && { name: tsdb.strPosition }));
  const specific = (tsdb && tsdb.strPosition) || null;
  const team = (teamData && teamData.team) || {};

  const cur = flattenCore(coreCur);
  const prev = flattenCore(corePrev);
  const rosterStats = flattenRoster(ra);

  // Si no hay estadísticas detalladas, usamos las básicas del plantel
  const curForCalc = cur || (rosterStats.appearances ? { ...rosterStats, minutes: null } : null);

  const combined = combineSeasons([cur, prev]);
  const metrics = metricsFrom(combined);
  const rating = rateAttributes(group, metrics);
  const A = Object.fromEntries(rating.attributes.map(a => [a.key, a.value]));
  const role = detectRole(group, specific, A);

  const matches = collectMatches([glCur, glPrev], overview, group);
  const form = analyzeForm(matches);

  const recordStats = team.record && team.record.items && team.record.items[0] && team.record.items[0].stats;
  const rs = k => recordStats && (recordStats.find(s => s.name === k) || {}).value;
  let teamGames = rs('gamesPlayed');
  if (!teamGames)
    teamGames = Math.max(0, ...rosterAthletes.map(a => flattenRoster(a).appearances || 0)) || null;
  const contrib = contribution({ cur: curForCalc, rosterStats, teamGames, rosterAthletes });

  const age = ath.age || ra.age || null;
  const dob = ra.dateOfBirth || (tsdb && tsdb.dateBorn) || null;
  const height = parseHeight(tsdb && tsdb.strHeight) || inchesToCm(ra.height);
  const weight = parseWeight(tsdb && tsdb.strWeight) || lbsToKg(ra.weight);

  const photo =
    (tsdb && (tsdb.strCutout || tsdb.strRender || tsdb.strThumb)) || (wiki && wiki.image) || null;

  // Estadísticas por competición (temporada actual, todas las competiciones)
  let competitions = null;
  if (overview && overview.statistics && overview.statistics.splits) {
    const s = overview.statistics;
    competitions = {
      labels: s.labels,
      names: s.names,
      rows: s.splits.map(r => ({ name: r.displayName, stats: r.stats.map(num) })),
    };
  }

  const news = ((overview && overview.news) || []).slice(0, 6).map(n => ({
    headline: n.headline,
    description: n.description,
    date: n.published || n.lastModified,
    url: n.links && n.links.web && n.links.web.href,
    image: n.images && n.images[0] && n.images[0].url,
  }));

  let nextGame = null;
  const ng = overview && overview.nextGame && overview.nextGame.league;
  if (ng && ng.events && ng.events[0]) {
    const e = ng.events[0];
    nextGame = { name: e.name, shortName: e.shortName, date: e.date, venue: e.location, competition: ng.shortName || ng.name };
  }

  // Ligas europeas: "2026-27"; ligas de año calendario (Argentina, Brasil, MLS): "2026"
  const splitYears = !seasonName || /\d{4}-\d{2}/.test(seasonName);
  const seasonLabel = (y, split) => (split ? `${y}-${String(y + 1).slice(2)}` : String(y));
  const seasonTable = (s, label, lg) =>
    s && {
      label,
      league: lg,
      minutes: s.minutes, appearances: s.appearances, starts: s.starts, subIns: s.subIns,
      goals: s.totalGoals, assists: s.goalAssists, shots: s.totalShots, shotsOnTarget: s.shotsOnTarget,
      keyPasses: s.shotAssists, passes: s.totalPasses, accuratePasses: s.accuratePasses,
      tackles: s.totalTackles, interceptions: s.interceptions, clearances: s.totalClearance,
      recoveries: s.recoveries, duelsWon: s.duelsWon, duels: s.duels,
      foulsCommitted: s.foulsCommitted, foulsSuffered: s.foulsSuffered,
      yellowCards: s.yellowCards, redCards: s.redCards,
      saves: s.saves, goalsConceded: s.goalsConceded, cleanSheets: s.cleanSheet,
    };

  const injuries = (ra.injuries || []).map(i => ({
    status: i.status, date: i.date, detail: i.details && (i.details.type || i.details.detail),
  }));

  const sources = [
    { name: 'ESPN — ficha, plantel, estadísticas y partidos', url: (ath.links || []).find(l => l.rel.includes('playercard'))?.href || 'https://www.espn.com/soccer/' },
  ];
  if (tsdb) sources.push({ name: 'TheSportsDB — perfil, posición, pie hábil y fotos', url: `https://www.thesportsdb.com/player/${tsdb.idPlayer}` });
  if (wiki) sources.push({ name: `Wikipedia (${wiki.lang}) — biografía`, url: wiki.url });

  const report = {
    id: String(ath.id || ra.id),
    league, leagueName, season, teamId,
    name,
    fullName: ath.fullName || ra.fullName,
    firstName: ath.firstName || ra.firstName,
    lastName: ath.lastName || ra.lastName,
    jersey: ath.jersey || ra.jersey || null,
    photo,
    age, dob,
    birthPlace: (tsdb && tsdb.strBirthLocation) || null,
    nationality: ath.citizenship || ra.citizenship || (tsdb && tsdb.strNationality) || null,
    flag: (ath.flag && ath.flag.href) || (ra.flag && ra.flag.href) || null,
    height, weight,
    foot: tsdb && tsdb.strSide ? FOOT_ES[tsdb.strSide.toLowerCase()] || tsdb.strSide : null,
    group,
    groupLabel: GROUP_ES[group],
    position: posEs(specific) || GROUP_ES[group],
    signing: (tsdb && tsdb.strSigning) || null,
    wage: (tsdb && tsdb.strWage) || null,
    kit: (tsdb && tsdb.strKit) || null,
    social: tsdb
      ? ['strInstagram', 'strTwitter', 'strFacebook'].map(k => tsdb[k]).filter(Boolean).map(u => (u.startsWith('http') ? u : `https://${u}`))
      : [],
    injuries,
    team: {
      id: teamId, name: team.displayName || (ath.team && ath.team.displayName),
      logo: team.logos && team.logos[0] && team.logos[0].href,
      color: team.color, altColor: team.alternateColor,
      standing: team.standingSummary || null,
    },
    rating,
    role,
    contribution: contrib,
    metrics: Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, typeof v === 'number' ? round(v, 3) : v])),
    seasons: [
      seasonTable(cur, seasonLabel(season, splitYears), leagueName),
      seasonTable(prev, seasonLabel(season - 1, splitYears), prevLeague && prevLeague.name),
    ].filter(Boolean),
    form,
    matches,
    competitions,
    nextGame,
    news,
    bio: wiki ? { text: wiki.extract, url: wiki.url, lang: wiki.lang } : null,
    bioFallback: !wiki && tsdb && tsdb.strDescriptionEN ? tsdb.strDescriptionEN : null,
    sources,
  };
  report.verdict = verdict({
    name, age, group, role, team: report.team.name, metrics: report.metrics, rating, form, contrib,
  });
  return report;
}

module.exports = { build, flattenRoster, groupOf, GROUP_ES, inchesToCm };
