/* Futbol Scout — frontend (SPA sin dependencias) */
(() => {
  'use strict';

  const $app = document.getElementById('app');
  const $tooltip = document.getElementById('tooltip');

  // ------------------------------------------------------------ utilidades
  const esc = v =>
    String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const attr = esc;
  const nf = (v, d = 0) =>
    v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (v, d = 0) => (v == null ? '—' : `${nf(v * 100, d)}%`);
  const dateFmt = (d, opts) => (d ? new Date(d).toLocaleDateString('es-AR', opts || { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
  const initials = n => (n || '?').split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase();
  const hex = c => (c && /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : null);

  // Las fuentes dan nacionalidades en inglés: armamos un diccionario inglés → español
  // a partir de los códigos de país que conoce el navegador.
  const country = (() => {
    const map = {
      england: 'Inglaterra', scotland: 'Escocia', wales: 'Gales', 'northern ireland': 'Irlanda del Norte',
      usa: 'Estados Unidos', 'republic of ireland': 'Irlanda', 'korea republic': 'Corea del Sur', 'south korea': 'Corea del Sur',
      'ivory coast': 'Costa de Marfil', "cote d'ivoire": 'Costa de Marfil', turkey: 'Turquía', czechia: 'Chequia',
      'czech republic': 'Chequia', 'bosnia-herzegovina': 'Bosnia y Herzegovina', 'congo dr': 'RD del Congo',
      'dr congo': 'RD del Congo', 'cape verde islands': 'Cabo Verde', curacao: 'Curazao', kosovo: 'Kosovo',
    };
    try {
      const en = new Intl.DisplayNames(['en'], { type: 'region' });
      const es = new Intl.DisplayNames(['es'], { type: 'region' });
      const A = 65;
      for (let i = 0; i < 26; i++)
        for (let j = 0; j < 26; j++) {
          const code = String.fromCharCode(A + i, A + j);
          const name = en.of(code);
          if (name && name !== code && !map[name.toLowerCase()]) map[name.toLowerCase()] = es.of(code);
        }
    } catch {}
    return name => (name && map[name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')]) || map[(name || '').toLowerCase()] || name;
  })();

  // Colores de club muy oscuros o blancos no se ven sobre el fondo: los ajustamos
  function teamColor(c, alt) {
    const lum = h => {
      if (!h) return -1;
      const n = parseInt(h.slice(1), 16);
      return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    };
    for (const x of [hex(c), hex(alt)]) {
      const l = lum(x);
      if (l > 0.12 && l < 0.92) return x;
    }
    return '#3ddc84';
  }

  let navId = 0; // evita que una vista lenta pise a la siguiente
  const cache = new Map();
  async function api(path) {
    if (cache.has(path)) return cache.get(path);
    const p = fetch(`/api/${path}`).then(async r => {
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `Error ${r.status}`);
      return body;
    });
    cache.set(path, p);
    p.catch(() => cache.delete(path));
    return p;
  }

  const loading = (msg = 'Cargando…') => `<div class="state"><div class="spinner"></div>${esc(msg)}</div>`;
  const errorView = err =>
    `<div class="state"><h2>No se pudo cargar</h2><p>${esc(err.message)}</p><p><a class="link-btn" href="javascript:location.reload()">Reintentar</a></p></div>`;
  const crumbs = items =>
    `<nav class="crumbs" aria-label="Ruta">${items
      .map((it, i) => (it.href ? `<a href="${attr(it.href)}">${esc(it.label)}</a>` : `<span>${esc(it.label)}</span>`) + (i < items.length - 1 ? '<span class="sep">/</span>' : ''))
      .join('')}</nav>`;

  // ------------------------------------------------------------ tooltip
  function showTip(html, x, y) {
    $tooltip.innerHTML = html;
    $tooltip.hidden = false;
    const r = $tooltip.getBoundingClientRect();
    let left = x + 14, top = y - r.height - 12;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top < 8) top = y + 16;
    $tooltip.style.left = `${left}px`;
    $tooltip.style.top = `${top}px`;
  }
  const hideTip = () => ($tooltip.hidden = true);

  // ------------------------------------------------------------ datos globales
  let leaguesData = null;
  const getLeagues = () => (leaguesData ||= api('leagues'));

  // ------------------------------------------------------------ buscador
  const $search = document.getElementById('search');
  const $results = document.getElementById('search-results');
  let searchIndex = [];
  let activeIdx = 0;
  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  getLeagues()
    .then(ls => {
      searchIndex = ls.flatMap(l =>
        l.teams.map(t => ({ ...t, league: l.slug, leagueName: l.name, country: l.country, key: norm(`${t.name} ${t.shortName} ${t.abbr}`) }))
      );
    })
    .catch(() => {});

  function renderResults() {
    const q = norm($search.value.trim());
    if (!q) return ($results.hidden = true);
    const words = q.split(/\s+/);
    const hits = searchIndex
      .filter(t => words.every(w => t.key.includes(w)))
      .sort((a, b) => (a.key.startsWith(q) ? 0 : 1) - (b.key.startsWith(q) ? 0 : 1) || a.name.localeCompare(b.name))
      .slice(0, 12);
    activeIdx = 0;
    $results.innerHTML = hits.length
      ? hits
          .map(
            (t, i) => `<a class="search-item${i === 0 ? ' active' : ''}" href="#/club/${t.league}/${t.id}">
              <img src="${attr(t.logo || '')}" alt="" loading="lazy">
              <div><div>${esc(t.name)}</div><div class="sub">${esc(t.leagueName)} · ${esc(t.country)}</div></div></a>`
          )
          .join('')
      : `<div class="search-empty">${searchIndex.length ? 'No se encontraron clubes' : 'Cargando clubes…'}</div>`;
    $results.hidden = false;
  }

  $search.addEventListener('input', renderResults);
  $search.addEventListener('focus', renderResults);
  $search.addEventListener('keydown', e => {
    const items = [...$results.querySelectorAll('.search-item')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      items[activeIdx].classList.remove('active');
      activeIdx = (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[activeIdx].classList.add('active');
      items[activeIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && items[activeIdx]) {
      location.hash = items[activeIdx].getAttribute('href');
      closeSearch();
    } else if (e.key === 'Escape') closeSearch();
  });
  $results.addEventListener('click', () => closeSearch());
  document.addEventListener('click', e => {
    if (!e.target.closest('.search')) $results.hidden = true;
  });
  function closeSearch() {
    $results.hidden = true;
    $search.value = '';
    $search.blur();
  }

  // ------------------------------------------------------------ estado de actualización
  async function loadStatus() {
    const $s = document.getElementById('update-status');
    try {
      const s = await fetch('/api/status').then(r => r.json());
      const when = d => new Date(d).toLocaleString('es-AR', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      if (s.running) {
        const p = s.running.total ? ` — ${s.running.phase}: ${nf(s.running.done)} de ${nf(s.running.total)}` : '';
        $s.innerHTML = `<span class="dot busy"></span>Actualizando datos desde las fuentes${esc(p)}`;
      } else if (s.mode === 'lazy') {
        $s.innerHTML =
          `<span class="dot"></span>Datos renovados desde las fuentes a partir del ${esc(when(s.lastUpdate))} · ` +
          `Próxima renovación: ${esc(when(s.nextUpdate))} <span class="muted">(${esc(s.schedule.toLowerCase())})</span>`;
      } else {
        $s.innerHTML =
          `<span class="dot"></span>` +
          (s.lastUpdate ? `Última actualización completa: ${esc(when(s.lastUpdate))} · ` : '') +
          `Próxima: ${esc(when(s.nextUpdate))} <span class="muted">(${esc(s.schedule.toLowerCase())})</span>`;
      }
    } catch {
      $s.textContent = '';
    }
  }
  loadStatus();
  setInterval(loadStatus, 60_000);

  // ------------------------------------------------------------ vistas
  async function viewHome() {
    document.title = 'Futbol Scout';
    $app.innerHTML = loading('Cargando ligas…');
    const nav = navId;
    const leagues = await getLeagues();
    if (nav !== navId) return;
    const totalClubs = leagues.reduce((s, l) => s + l.teams.length, 0);
    $app.innerHTML = `
      <section class="hero">
        <h1>Scouting de <em>jugadores</em><br>de las mejores ligas</h1>
        <p>Buscá cualquier club, recorré su plantel y abrí el informe de cada jugador: estadísticas promedio, forma reciente, rol en el equipo y un veredicto final armado con datos de ESPN, TheSportsDB y Wikipedia.</p>
        <div class="hero-stats">
          <div>${leagues.length}<span>Ligas</span></div>
          <div>${nf(totalClubs)}<span>Clubes</span></div>
          <div>2×<span>Actualizaciones por semana</span></div>
        </div>
      </section>
      <h2 class="section-title">Ligas</h2>
      <div class="grid leagues">
        ${leagues
          .map(
            l => `<a class="league-card" href="#/liga/${l.slug}">
              <img src="${attr(l.flag)}" alt="">
              <div><h3>${esc(l.name)}</h3><p>${esc(l.country)} · ${l.available ? `${l.teams.length} clubes` : 'no disponible'}</p></div></a>`
          )
          .join('')}
      </div>`;
  }

  async function viewLeague(slug) {
    $app.innerHTML = loading('Cargando clubes…');
    const nav = navId;
    const leagues = await getLeagues();
    if (nav !== navId) return;
    const l = leagues.find(x => x.slug === slug);
    if (!l) throw new Error('Liga no encontrada');
    document.title = `${l.name} — Futbol Scout`;
    $app.innerHTML = `
      ${crumbs([{ label: 'Inicio', href: '#/' }, { label: l.name }])}
      <div class="league-head">
        <img src="${attr(l.flag)}" alt="">
        <div><h1 class="page-title">${esc(l.name)}</h1><div class="muted">${esc(l.country)} · Temporada ${esc(l.season || '')}</div></div>
        <input class="filter" id="club-filter" type="search" placeholder="Filtrar clubes…" aria-label="Filtrar clubes">
      </div>
      <div class="grid clubs" id="clubs">
        ${l.teams
          .map(
            t => `<a class="club-card" href="#/club/${l.slug}/${t.id}" data-k="${attr(norm(t.name))}" style="--c:${teamColor(t.color)}">
              <img src="${attr(t.logo || '')}" alt="" loading="lazy"><span>${esc(t.name)}</span></a>`
          )
          .join('')}
      </div>`;
    document.getElementById('club-filter').addEventListener('input', e => {
      const q = norm(e.target.value);
      document.querySelectorAll('#clubs .club-card').forEach(c => (c.hidden = !c.dataset.k.includes(q)));
    });
  }

  const GROUPS = { G: 'Arqueros', D: 'Defensores', M: 'Mediocampistas', F: 'Delanteros' };

  async function viewClub(slug, id) {
    $app.innerHTML = loading('Cargando plantel…');
    const nav = navId;
    const d = await api(`team/${slug}/${id}`);
    if (nav !== navId) return;
    const color = teamColor(d.team.color, d.team.altColor);
    document.title = `${d.team.name} — Futbol Scout`;

    const card = p => {
      const gk = p.group === 'G';
      const nums = gk
        ? [[p.stats.apps, 'PJ'], [p.stats.saves ?? '—', 'ATAJ'], [p.stats.conceded ?? '—', 'GC']]
        : [[p.stats.apps, 'PJ'], [p.stats.goals, 'G'], [p.stats.assists, 'A']];
      return `<a class="player-card" href="#/jugador/${slug}/${id}/${p.id}" data-k="${attr(norm(p.name))}" data-g="${p.group}">
        <div class="jersey" style="border-color:${color}55">${esc(p.jersey || '–')}</div>
        <div><div class="name">${esc(p.name)} ${p.injured ? '<span class="inj" title="Lesionado">✚ LES</span>' : ''}</div>
          <div class="sub">${p.flag ? `<img src="${attr(p.flag)}" alt="">` : ''}${esc(country(p.nationality) || '')}${p.age ? ` · ${p.age} años` : ''}</div></div>
        <div class="nums">${nums.map(([v, l]) => `<div>${esc(v)}<span>${l}</span></div>`).join('')}</div></a>`;
    };

    $app.innerHTML = `
      ${crumbs([{ label: 'Inicio', href: '#/' }, { label: d.league.name, href: `#/liga/${slug}` }, { label: d.team.name }])}
      <section class="club-hero" style="--team:${color}">
        <img class="big-logo" src="${attr(d.team.logo || '')}" alt="">
        <img src="${attr(d.team.logo || '')}" alt="">
        <div>
          <h1 class="page-title">${esc(d.team.name)}</h1>
          <div class="meta">
            <span class="chip"><img src="${attr(d.league.flag)}" alt="">${esc(d.league.name)}</span>
            ${d.team.standing ? `<span class="chip accent">${esc(translateStanding(d.team.standing))}</span>` : ''}
            ${d.team.record ? `<span class="chip">Récord (G-E-P): ${esc(d.team.record)}</span>` : ''}
            <span class="chip">${d.players.length} jugadores</span>
          </div>
        </div>
      </section>
      <div class="roster-tools">
        <div class="seg" role="tablist" id="pos-seg">
          <button class="on" data-g="all">Todos</button>
          ${Object.entries(GROUPS).map(([g, l]) => `<button data-g="${g}">${l}</button>`).join('')}
        </div>
        <input class="filter" id="player-filter" type="search" placeholder="Buscar jugador…" aria-label="Buscar jugador">
      </div>
      <div id="roster">
        ${Object.entries(GROUPS)
          .map(([g, label]) => {
            const ps = d.players.filter(p => p.group === g);
            return ps.length
              ? `<section class="pos-group" data-g="${g}"><h2 class="section-title">${label}<small>${ps.length}</small></h2>
                  <div class="grid players">${ps.map(card).join('')}</div></section>`
              : '';
          })
          .join('')}
      </div>`;

    let group = 'all', q = '';
    const apply = () => {
      document.querySelectorAll('#roster .pos-group').forEach(sec => {
        let visible = 0;
        sec.querySelectorAll('.player-card').forEach(c => {
          const show = (group === 'all' || c.dataset.g === group) && c.dataset.k.includes(q);
          c.hidden = !show;
          if (show) visible++;
        });
        sec.hidden = !visible;
      });
    };
    document.getElementById('pos-seg').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      document.querySelectorAll('#pos-seg button').forEach(x => x.classList.toggle('on', x === b));
      group = b.dataset.g;
      apply();
    });
    document.getElementById('player-filter').addEventListener('input', e => {
      q = norm(e.target.value);
      apply();
    });
  }

  function translateStanding(s) {
    const m = s.match(/^(\d+)\w* in (.+)$/);
    return m ? `${m[1]}º en ${m[2].replace(/^English |^Spanish |^Italian |^German |^French /, '')}` : s;
  }

  // ------------------------------------------------------------ jugador
  const COMP_LABELS = {
    starts: 'Titular', appearances: 'PJ', foulsCommitted: 'Faltas', foulsSuffered: 'Faltas rec.', yellowCards: 'TA', redCards: 'TR',
    totalGoals: 'Goles', goalAssists: 'Asist.', totalShots: 'Tiros', shotsOnTarget: 'Al arco', offsides: 'Offside',
    saves: 'Atajadas', goalsConceded: 'GC', cleanSheet: 'Vallas inv.', shotsFaced: 'Tiros rec.', subIns: 'Ingresos',
  };

  const ROLE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7l3.5 2.5-1.3 4h-4.4l-1.3-4z"/><path d="M12 3v4M20.5 9.5l-5 0M17 19l-2.8-5.5M7 19l2.8-5.5M3.5 9.5h5"/></svg>`;

  function ring(value) {
    const r = 62, c = 2 * Math.PI * r, v = value == null ? 0 : value;
    return `<div class="ovr-ring">
      <svg viewBox="0 0 150 150" aria-hidden="true">
        <circle cx="75" cy="75" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="10"/>
        <circle cx="75" cy="75" r="${r}" fill="none" stroke="var(--accent)" stroke-width="10" stroke-linecap="round"
          stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - v / 100)}"/>
      </svg>
      <div class="val"><b>${value == null ? '—' : value}</b><span>Valoración</span></div></div>`;
  }

  function attributesBlock(p) {
    if (!p.rating.attributes.length) return `<p class="muted">Sin estadísticas detalladas suficientes para valorar atributos.</p>`;
    return `<div class="attrs">${p.rating.attributes
      .map(
        a => `<div class="attr"><span class="label">${esc(a.label)}</span>
          <div class="track" role="img" aria-label="${attr(a.label)}: ${a.value} de 99"><div class="fill" style="width:${a.value}%"></div></div>
          <span class="v">${a.value}</span></div>`
      )
      .join('')}</div>
      <p class="legend-note">Escala 25–97 respecto de referencias para su puesto (${esc(p.groupLabel.toLowerCase())}). La línea central marca el nivel promedio (≈55).</p>`;
  }

  // Gráfico de barras: índice de rendimiento por partido (cronológico)
  function formChart(p) {
    const ms = [...p.matches].reverse();
    if (!ms.length) return '<p class="muted">Sin partidos recientes registrados.</p>';
    const W = 640, H = 230, padL = 30, padR = 8, padT = 22, padB = 46;
    const min = 4, max = 10;
    const iw = W - padL - padR, ih = H - padT - padB;
    const step = iw / ms.length, bw = Math.min(38, step * 0.56);
    const y = v => padT + ih - ((v - min) / (max - min)) * ih;
    const ticks = [4, 6, 8, 10];
    const best = Math.max(...ms.map(m => m.rating));
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Índice de rendimiento en los últimos ${ms.length} partidos">`;
    for (const t of ticks)
      svg += `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/><text class="axis-label" x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
    ms.forEach((m, i) => {
      const cx = padL + step * i + step / 2;
      const top = y(m.rating), base = y(min);
      const h = Math.max(2, base - top), r = Math.min(4, h / 2);
      // barra con extremo superior redondeado y base recta
      svg += `<path class="bar" data-i="${i}" d="M${cx - bw / 2},${base} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${base} Z"/>`;
      if (m.rating === best || i === ms.length - 1)
        svg += `<text class="val-label" x="${cx}" y="${top - 6}" text-anchor="middle">${nf(m.rating, 1)}</text>`;
      if (m.opponentLogo) svg += `<image class="opp-logo" href="${attr(m.opponentLogo)}" x="${cx - 9}" y="${base + 7}" width="18" height="18"/>`;
      svg += `<text class="axis-label" x="${cx}" y="${base + 40}" text-anchor="middle">${esc(dateFmt(m.date, { day: '2-digit', month: '2-digit' }))}</text>`;
      svg += `<rect class="hit" data-i="${i}" x="${cx - step / 2}" y="${padT}" width="${step}" height="${ih + padB}"/>`;
    });
    if (p.form && p.form.baseline) {
      const by = y(p.form.baseline);
      svg += `<line class="baseline" x1="${padL}" x2="${W - padR}" y1="${by}" y2="${by}"/>`;
    }
    svg += '</svg>';
    return `<div class="chart" id="form-chart">${svg}</div>`;
  }

  function bindFormChart(p) {
    const el = document.getElementById('form-chart');
    if (!el) return;
    const ms = [...p.matches].reverse();
    const bars = el.querySelectorAll('.bar');
    const gk = p.group === 'G';
    el.addEventListener('mousemove', e => {
      const hit = e.target.closest('.hit');
      if (!hit) return hideTip(), bars.forEach(b => b.classList.remove('dim'));
      const i = +hit.dataset.i, m = ms[i], s = m.stats || {};
      bars.forEach((b, j) => b.classList.toggle('dim', j !== i));
      const rows = gk
        ? [['Atajadas', s.saves], ['Goles recibidos', s.goalsConceded]]
        : [['Goles', s.totalGoals], ['Asistencias', s.goalAssists], ['Tiros (al arco)', s.totalShots != null ? `${s.totalShots} (${s.shotsOnTarget ?? 0})` : null]];
      showTip(
        `<div class="t-title">${m.atVs === '@' ? '@' : 'vs'} ${esc(m.opponent)}</div>
         <div class="t-row"><span>${esc(m.competition || '')}</span><span>${esc(dateFmt(m.date))}</span></div>
         <div class="t-row"><span>Resultado</span><b>${esc({ W: 'Victoria', D: 'Empate', L: 'Derrota' }[m.result] || '')} ${esc(m.score || '')}</b></div>
         ${rows.filter(r => r[1] != null).map(r => `<div class="t-row"><span>${r[0]}</span><b>${esc(r[1])}</b></div>`).join('')}
         <div class="t-row"><span>Índice de rendimiento</span><b>${nf(m.rating, 1)}</b></div>`,
        e.clientX,
        e.clientY
      );
    });
    el.addEventListener('mouseleave', () => {
      hideTip();
      bars.forEach(b => b.classList.remove('dim'));
    });
  }

  function matchesTable(p) {
    return `<div class="table-wrap"><table class="matches">${p.matches
      .map(
        m => `<tr>
          <td class="muted">${esc(dateFmt(m.date, { day: '2-digit', month: 'short' }))}</td>
          <td class="opp">${m.opponentLogo ? `<img src="${attr(m.opponentLogo)}" alt="">` : ''}${m.atVs === '@' ? '@ ' : ''}${esc(m.opponent)}<div class="muted" style="font-size:11.5px">${esc(m.competition || '')}</div></td>
          <td><span class="res ${esc(m.result)}">${esc({ W: 'G', D: 'E', L: 'P' }[m.result] || '–')}</span> ${esc(m.score || '')}</td>
          <td>${p.group === 'G' ? `${m.stats.saves ?? 0} atj.` : `${m.stats.totalGoals || 0} G · ${m.stats.goalAssists || 0} A`}</td>
          <td><span class="rating-pill">${nf(m.rating, 1)}</span></td></tr>`
      )
      .join('')}</table></div>`;
  }

  function per90Tiles(p) {
    const m = p.metrics;
    const list =
      p.group === 'G'
        ? [
            ['% de atajadas', pct(m.savePct), true],
            ['Atajadas / 90', nf(m.saves90, 2)],
            ['Goles recibidos / 90', nf(m.conceded90, 2)],
            ['Vallas invictas', nf(m.cleanSheets)],
            ['% vallas invictas', pct(m.cleanSheetRate)],
            ['Precisión de pase', pct(m.passAcc)],
            ['Pelotas largas', pct(m.longBallAcc)],
            ['Partidos', nf(m.apps)],
          ]
        : [
            ['Goles / 90', nf(m.goals90, 2), true],
            ['Asistencias / 90', nf(m.assists90, 2), true],
            ['Tiros / 90', nf(m.shots90, 2)],
            ['Pases clave / 90', nf(m.keyPasses90, 2)],
            ['Pases completos / 90', nf(m.passes90, 1)],
            ['Precisión de pase', pct(m.passAcc)],
            ['Tiros al arco', pct(m.sotPct)],
            ['Conversión', pct(m.conversion)],
            ['Conducciones prog. / 90', nf(m.progCarries90, 2)],
            ['Quites / 90', nf(m.tackles90, 2)],
            ['Intercepciones / 90', nf(m.interceptions90, 2)],
            ['Recuperaciones / 90', nf(m.recoveries90, 2)],
            ['Despejes / 90', nf(m.clearances90, 2)],
            ['Duelos ganados', pct(m.duelPct)],
            ['Faltas recibidas / 90', nf(m.foulsSuffered90, 2)],
            ['Tarjetas (A / R)', m.yellow == null ? '—' : `${nf(m.yellow)} / ${nf(m.red)}`],
          ];
    return `<div class="tiles">${list
      .filter(([, v]) => v !== '—')
      .map(([l, v, hl]) => `<div class="tile${hl ? ' hl' : ''}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`)
      .join('')}</div>`;
  }

  function seasonsTable(p) {
    if (!p.seasons.length) return '<p class="muted">Sin estadísticas de temporada disponibles.</p>';
    const gk = p.group === 'G';
    const rows = [
      ['Minutos', 'minutes'], ['Partidos', 'appearances'], ['Titular', 'starts'], ['Ingresos', 'subIns'],
      ...(gk
        ? [['Atajadas', 'saves'], ['Goles recibidos', 'goalsConceded'], ['Vallas invictas', 'cleanSheets']]
        : [['Goles', 'goals'], ['Asistencias', 'assists'], ['Tiros', 'shots'], ['Tiros al arco', 'shotsOnTarget'], ['Pases clave', 'keyPasses']]),
      ['Pases completos', 'accuratePasses'], ['Pases intentados', 'passes'],
      ['Quites', 'tackles'], ['Intercepciones', 'interceptions'], ['Despejes', 'clearances'], ['Recuperaciones', 'recoveries'],
      ['Duelos ganados', 'duelsWon'], ['Faltas cometidas', 'foulsCommitted'], ['Faltas recibidas', 'foulsSuffered'],
      ['Amarillas', 'yellowCards'], ['Rojas', 'redCards'],
    ].filter(([, k]) => p.seasons.some(s => s[k] != null));
    return `<div class="table-wrap"><table class="data">
      <thead><tr><th>Estadística</th>${p.seasons.map(s => `<th>${esc(s.label)}<br><span style="text-transform:none;font-weight:500">${esc(s.league || '')}</span></th>`).join('')}</tr></thead>
      <tbody>${rows.map(([l, k]) => `<tr><td>${l}</td>${p.seasons.map(s => `<td>${nf(s[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function competitionsTable(p) {
    const c = p.competitions;
    if (!c || !c.rows.length) return '';
    const rows = c.rows.filter(r => r.stats.some(v => v));
    if (!rows.length) return '';
    return `<section class="card"><h2 class="section-title">Temporada por competición</h2>
      <div class="table-wrap"><table class="data"><thead><tr><th>Competición</th>${c.names
        .map((n, i) => `<th title="${attr(n)}">${esc(COMP_LABELS[n] || c.labels[i])}</th>`)
        .join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td>${r.stats.map(v => `<td>${nf(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  }

  function contributionBlock(p) {
    const c = p.contribution || {};
    const meter = (label, v) =>
      v == null
        ? ''
        : `<div class="meter"><div class="meter-row"><span>${label}</span><b>${pct(v)}</b></div>
           <div class="meter-track" role="img" aria-label="${attr(label)} ${pct(v)}"><div class="meter-fill" style="width:${Math.max(1, v * 100)}%"></div></div></div>`;
    return `<section class="card">
      <h2 class="section-title">Rol y aporte al equipo</h2>
      <div class="role-box"><div class="role-icon">${ROLE_ICON}</div>
        <div><h3>${esc(p.role.label)}</h3><p>${esc(p.role.desc)}</p></div></div>
      ${c.usage ? `<div style="margin-bottom:6px"><span class="chip accent">${esc(c.usage)}</span> ${c.teamGames ? `<span class="chip">${c.teamGames} partidos del equipo en liga</span>` : ''}</div>` : ''}
      ${meter('Minutos jugados de la temporada', c.minuteShare ?? c.appShare)}
      ${p.group !== 'G' ? meter('Goles del equipo que convirtió', c.goalShare) : ''}
      ${p.group !== 'G' ? meter('Participación en goles (G + A)', c.gaShare) : ''}
    </section>`;
  }

  function bioBlock(p) {
    const text = (p.bio && p.bio.text) || p.bioFallback;
    if (!text) return '';
    const long = text.length > 700;
    return `<section class="card"><h2 class="section-title">Biografía${(p.bio && p.bio.lang === 'en') || !p.bio ? '<small>en inglés</small>' : ''}</h2>
      <div class="bio${long ? ' clamped' : ''}" id="bio">${esc(text)}</div>
      ${long ? '<button class="link-btn" id="bio-more">Leer más</button>' : ''}</section>`;
  }

  function newsBlock(p) {
    if (!p.news.length) return '';
    return `<section class="card"><h2 class="section-title">Últimas noticias<small>ESPN</small></h2><div class="news">
      ${p.news
        .map(
          n => `<a href="${attr(n.url || '#')}" target="_blank" rel="noopener">
            ${n.image ? `<img src="${attr(n.image)}" alt="" loading="lazy">` : '<img alt="">'}
            <div><h4>${esc(n.headline)}</h4><span>${esc(dateFmt(n.date))}</span></div></a>`
        )
        .join('')}</div></section>`;
  }

  function nextGameBlock(p) {
    const g = p.nextGame;
    if (!g) return '';
    const d = new Date(g.date);
    return `<section class="card"><h2 class="section-title">Próximo partido</h2>
      <div class="next-game"><div class="date"><b>${d.getDate()}</b><span>${esc(d.toLocaleDateString('es-AR', { month: 'short' }))}</span></div>
      <div><div style="font-weight:600">${esc(g.name)}</div><div class="muted" style="font-size:13px">${esc(g.competition || '')} · ${esc(d.toLocaleString('es-AR', { weekday: 'long', hour: '2-digit', minute: '2-digit' }))}${g.venue ? ` · ${esc(g.venue)}` : ''}</div></div></div></section>`;
  }

  async function viewPlayer(slug, teamId, id) {
    $app.innerHTML = `<div class="skeleton" style="height:300px;margin-bottom:22px"></div>${loading('Recopilando información de ESPN, TheSportsDB y Wikipedia…')}`;
    const nav = navId;
    const p = await api(`player/${slug}/${teamId}/${id}`);
    if (nav !== navId) return;
    const color = teamColor(p.team.color, p.team.altColor);
    document.title = `${p.name} — Futbol Scout`;

    const facts = [
      ['Edad', p.age ? `${p.age} años` : null],
      ['Nacimiento', p.dob ? dateFmt(p.dob) : null],
      ['Nacionalidad', p.nationality ? `${p.flag ? `<img src="${attr(p.flag)}" alt="">` : ''}${esc(country(p.nationality))}` : null, true],
      ['Lugar de nacimiento', p.birthPlace],
      ['Altura', p.height ? `${p.height} cm` : null],
      ['Peso', p.weight ? `${p.weight} kg` : null],
      ['Pie hábil', p.foot],
      ['Puesto', p.position],
    ].filter(f => f[1]);

    const form = p.form;
    const trendChip = form
      ? `<span class="chip ${form.trend === 'up' ? 'accent' : form.trend === 'down' ? 'bad' : ''}">${form.trend === 'up' ? '▲' : form.trend === 'down' ? '▼' : '▬'} ${esc(form.trendLabel)}</span>`
      : '';

    $app.innerHTML = `
      ${crumbs([{ label: 'Inicio', href: '#/' }, { label: p.leagueName, href: `#/liga/${slug}` }, { label: p.team.name, href: `#/club/${slug}/${teamId}` }, { label: p.name }])}
      <section class="p-hero" style="--team:${color}">
        <div class="watermark">${esc(p.jersey || '')}</div>
        <div class="p-photo">${p.photo ? `<img src="${attr(p.photo)}" alt="${attr(p.name)}" onerror="this.outerHTML='<div class=ph-fallback>${attr(initials(p.name))}</div>'">` : `<div class="ph-fallback">${esc(initials(p.name))}</div>`}</div>
        <div class="p-info">
          <a class="team-line" href="#/club/${slug}/${teamId}">${p.team.logo ? `<img src="${attr(p.team.logo)}" alt="">` : ''}${esc(p.team.name)}${p.jersey ? ` · #${esc(p.jersey)}` : ''}</a>
          <h1>${esc(p.name)}${p.fullName && p.fullName !== p.name ? `<small>${esc(p.fullName)}</small>` : ''}</h1>
          <div class="chips">
            <span class="chip accent">${esc(p.position)}</span>
            <span class="chip">${esc(p.role.label)}</span>
            ${p.contribution && p.contribution.usage ? `<span class="chip">${esc(p.contribution.usage)}</span>` : ''}
            ${p.injuries.length ? `<span class="chip bad">✚ ${esc(p.injuries[0].status || 'Lesionado')}${p.injuries[0].detail ? ` — ${esc(p.injuries[0].detail)}` : ''}</span>` : ''}
          </div>
          <dl class="facts">${facts.map(([k, v, raw]) => `<div><dt>${k}</dt><dd>${raw ? v : esc(v)}</dd></div>`).join('')}</dl>
        </div>
        <div class="ovr">${ring(p.rating.overall)}
          <div class="conf">${p.rating.confidence < 1 ? `Confianza ${pct(p.rating.confidence)} (pocos minutos)` : `Basado en ${nf(p.metrics.minutes)} min`}</div></div>
      </section>

      <div class="layout">
        <div class="col">
          <section class="card">
            <h2 class="section-title">Informe final</h2>
            <div class="verdict-head">
              ${form ? `<span class="chip">Forma: ${esc(form.level)}</span>${trendChip}` : ''}
              <span class="chip">${nf(p.metrics.minutes)} min analizados</span>
            </div>
            <p class="verdict">${esc(p.verdict)}</p>
          </section>

          <section class="card">
            <h2 class="section-title">Forma reciente<small>últimos ${p.matches.length} partidos</small></h2>
            ${form ? `<div class="tiles" style="margin-bottom:16px">
              <div class="tile hl"><b>${nf(form.average, 2)}</b><span>Índice prom. últimos 5</span></div>
              ${p.group === 'G' ? '' : `<div class="tile"><b>${form.last5.goals}</b><span>Goles (últ. 5)</span></div><div class="tile"><b>${form.last5.assists}</b><span>Asistencias (últ. 5)</span></div>`}
              <div class="tile"><b>${form.last5.wins}-${form.last5.draws}-${form.last5.losses}</b><span>G-E-P del equipo</span></div>
            </div>` : ''}
            ${formChart(p)}
            <p class="legend-note">Índice de rendimiento estimado por partido (escala 4–10) a partir de goles, asistencias, remates, faltas, tarjetas, resultado${p.group === 'G' ? ', atajadas y goles recibidos' : p.group === 'F' ? '' : ' y goles recibidos por el equipo'}. La línea punteada es su nivel previo de referencia.</p>
            ${matchesTable(p)}
          </section>

          <section class="card">
            <h2 class="section-title">Promedios por 90 minutos<small>últimas 2 temporadas</small></h2>
            ${per90Tiles(p)}
          </section>

          <section class="card">
            <h2 class="section-title">Estadísticas por temporada</h2>
            ${seasonsTable(p)}
          </section>

          ${competitionsTable(p)}
        </div>

        <div class="col">
          <section class="card">
            <h2 class="section-title">Atributos</h2>
            ${attributesBlock(p)}
          </section>
          ${contributionBlock(p)}
          ${nextGameBlock(p)}
          ${bioBlock(p)}
          ${newsBlock(p)}
          <section class="card">
            <h2 class="section-title">Fuentes</h2>
            <ul class="sources">${p.sources.map(s => `<li><a href="${attr(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></li>`).join('')}</ul>
          </section>
        </div>
      </div>`;

    bindFormChart(p);
    const more = document.getElementById('bio-more');
    if (more)
      more.addEventListener('click', () => {
        const b = document.getElementById('bio');
        const open = b.classList.toggle('clamped');
        more.textContent = open ? 'Leer más' : 'Leer menos';
      });
  }

  // ------------------------------------------------------------ router
  const routes = [
    [/^#?\/?$/, () => viewHome()],
    [/^#\/liga\/([a-z]{3}\.\d)$/, m => viewLeague(m[1])],
    [/^#\/club\/([a-z]{3}\.\d)\/(\d+)$/, m => viewClub(m[1], m[2])],
    [/^#\/jugador\/([a-z]{3}\.\d)\/(\d+)\/(\d+)$/, m => viewPlayer(m[1], m[2], m[3])],
  ];

  async function router() {
    hideTip();
    navId++;
    const h = location.hash || '#/';
    window.scrollTo(0, 0);
    for (const [re, fn] of routes) {
      const m = h.match(re);
      if (m) {
        const nav = navId;
        try {
          await fn(m);
        } catch (err) {
          if (nav === navId) $app.innerHTML = errorView(err);
        }
        return;
      }
    }
    $app.innerHTML = `<div class="state"><h2>Página no encontrada</h2><p><a class="link-btn" href="#/">Volver al inicio</a></p></div>`;
  }

  window.addEventListener('hashchange', router);
  router();
})();
