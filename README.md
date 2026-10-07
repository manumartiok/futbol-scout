# Futbol Scout

Buscador de clubes y jugadores de 16 ligas, con un informe por jugador armado a partir de varias fuentes públicas.

## Cómo usarlo

Requiere Node.js 18 o superior. No hay dependencias que instalar.

```bash
npm start            # o doble clic en iniciar.bat
```

Después abrí <http://localhost:3000>. Para usar otro puerto: `set PORT=8080 && npm start`.

## Qué muestra

- **Inicio:** ligas disponibles y un buscador global de clubes.
- **Club:** plantel agrupado por puesto (arqueros, defensores, mediocampistas, delanteros), con partidos, goles y asistencias de la temporada. Se puede filtrar por puesto y por nombre.
- **Jugador:**
  - **Datos básicos:** edad, nacionalidad, altura, peso, pie hábil, lugar de nacimiento y puesto específico.
  - **Valoración general y atributos:** definición, creación, pase, desequilibrio, defensa, duelos y disciplina, comparados con referencias de su puesto.
  - **Forma reciente:** índice de rendimiento de los últimos 10 partidos, tendencia (en alza, estable o en baja) y detalle de cada partido.
  - **Rol y aporte al equipo:** tipo de jugador, si es titular o suplente, porcentaje de minutos jugados y de goles del equipo.
  - **Estadísticas:** promedios cada 90 minutos, tabla por temporada (actual y anterior) y por competición.
  - **Informe final** en texto, más biografía, próximo partido, noticias y enlaces a las fuentes.

## Fuentes

| Fuente | Qué aporta |
|---|---|
| ESPN | Clubes, planteles, estadísticas detalladas por temporada, partidos, noticias y próximo partido |
| TheSportsDB | Posición específica, pie hábil, lugar de nacimiento, fotos e ID de Wikidata |
| Wikipedia | Biografía en español (en inglés si no hay versión en español) |

## Actualización automática (2 veces por semana)

Mientras el servidor está encendido, los datos se vuelven a descargar de las mismas fuentes **los lunes y los jueves a las 04:00** (cada 3 o 4 días):

1. **Ligas, clubes y planteles.**
2. **Estadísticas y partidos de ESPN de todos los jugadores.** Tarda alrededor de una hora.
3. **Perfiles de TheSportsDB y Wikipedia.** Estas fuentes limitan cuántas consultas se les pueden hacer por minuto, así que esta fase sigue en segundo plano durante varias horas. Las consultas de quien está usando la página siempre tienen prioridad.

Detalles:

- Si la PC estaba apagada en el horario programado, la actualización arranca apenas se inicia el servidor.
- Si se corta a mitad de camino, se retoma donde quedó.
- El pie de página muestra la última actualización, la próxima y el avance si hay una en curso.
- Para forzar una actualización ahora: `npm run refresh`.
- Entre actualizaciones, todo lo descargado se sirve desde la caché (`data/cache`). Lo que todavía no se descargó se busca en el momento.

Para que la actualización corra aunque no abras la página, el servidor tiene que estar encendido. Podés agregar `iniciar.bat` al inicio de Windows (`Win + R` → `shell:startup`).

## Publicarlo en internet (Render, gratis)

1. Subí este repositorio a GitHub.
2. En <https://render.com>: **New → Blueprint** → elegí el repositorio. Render lee `render.yaml` y crea el servicio.
3. Al terminar te da una dirección del tipo `https://futbol-scout-xxxx.onrender.com`.

En el plan gratuito el servidor se duerme tras 15 minutos sin visitas: la primera visita después tarda alrededor de un minuto en despertarlo. Por eso ahí se usa `REFRESH_MODE=lazy`: los lunes y jueves a las 04:00 (hora de Argentina) los datos pasan a estar vencidos y cada club o jugador se vuelve a descargar de las fuentes en su próxima visita.

`POST /api/refresh` solo funciona con la variable `ADMIN_TOKEN` configurada y la cabecera `Authorization: Bearer <clave>`.

## Cómo se calcula el informe

- **Promedios:** se suman la temporada actual y la anterior, y se normalizan cada 90 minutos. Las métricas que una liga no releva se ignoran en lugar de contarse como cero.
- **Atributos (escala 25–97):** cada métrica se ubica entre un nivel bajo y uno de élite según el puesto. Con menos de 900 minutos, la nota se acerca a la media y se muestra el nivel de confianza.
- **Índice por partido (4–10):** es una estimación propia, no una nota oficial. Se basa en goles, asistencias, remates, faltas, tarjetas y resultado. En defensores y mediocampistas también cuentan los goles que recibió el equipo, y en arqueros las atajadas.

## Estructura

```
server.js            servidor HTTP (API + frontend)
refresh.js           actualización manual (npm run refresh)
lib/fetcher.js       descargas con caché persistente
lib/limiter.js       límite de consultas por fuente, con prioridad para usuarios
lib/refresh.js       programación y ejecución de las actualizaciones
lib/api.js           arma las respuestas combinando las fuentes
lib/analysis.js      motor de análisis (valoraciones, forma, rol, veredicto)
lib/sources/         ESPN, TheSportsDB, Wikipedia
public/              frontend (HTML, CSS y JS sin dependencias)
data/                caché y estado de actualización (se genera solo)
```
