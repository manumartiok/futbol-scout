// Servidor HTTP sin dependencias: API JSON + archivos estáticos del frontend.
const http = require('http');
const fs = require('fs');
const path = require('path');
const api = require('./lib/api');
const refresh = require('./lib/refresh');

const PORT = +process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const SLUG = '([a-z]{3}\\.\\d)';
const routes = [
  ['GET', /^\/api\/leagues$/, () => api.leagues()],
  ['GET', new RegExp(`^/api/league/${SLUG}$`), m => api.league(m[1])],
  ['GET', new RegExp(`^/api/team/${SLUG}/(\\d+)$`), m => api.team(m[1], m[2])],
  ['GET', new RegExp(`^/api/player/${SLUG}/(\\d+)/(\\d+)$`), m => api.player(m[1], m[2], m[3])],
  ['GET', /^\/api\/status$/, () => refresh.status()],
  [
    'POST',
    /^\/api\/refresh$/,
    (m, req) => {
      // Solo con la clave ADMIN_TOKEN (cabecera "Authorization: Bearer <clave>"),
      // para que nadie pueda disparar actualizaciones en la versión pública.
      const token = process.env.ADMIN_TOKEN;
      if (!token || req.headers.authorization !== `Bearer ${token}`) {
        const e = new Error('No autorizado');
        e.status = 403;
        throw e;
      }
      if (refresh.MODE === 'lazy') {
        const e = new Error('En modo lazy los datos se renuevan solos en cada visita');
        e.status = 400;
        throw e;
      }
      refresh.check({ force: true });
      return refresh.status();
    },
  ],
];

function sendJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC)) return sendJSON(res, 403, { error: 'Prohibido' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) file = path.join(PUBLIC, 'index.html'); // SPA
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  for (const [method, re, handler] of routes) {
    const m = pathname.match(re);
    if (!m || req.method !== method) continue;
    try {
      return sendJSON(res, 200, await handler(m, req));
    } catch (err) {
      console.error(pathname, err.message);
      return sendJSON(res, err.status || 502, { error: err.status ? err.message : 'No se pudo obtener la información de las fuentes' });
    }
  }
  sendJSON(res, 404, { error: 'Ruta no encontrada' });
});

server.listen(PORT, () => {
  console.log(`\n  ⚽ Futbol Scout listo en http://localhost:${PORT}\n`);
  refresh.startScheduler();
});
