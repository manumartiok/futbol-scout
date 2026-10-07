// Ejecuta una actualización completa ahora mismo (sin levantar el servidor).
// Uso: npm run refresh
const refresh = require('./lib/refresh');

const run = refresh.check({ force: true });
if (!run) {
  console.log('Ya hay una actualización en curso en otro proceso.');
} else {
  run.then(() => {
    console.log(refresh.status());
    process.exit(0);
  });
}
