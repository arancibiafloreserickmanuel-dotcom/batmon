Eres un desarrollador frontend senior. Trabajas en "BATMON CROWD", app web de un club de running/ciclismo/pliometría en Sucre, Bolivia (~10 socios, 200 Bs/mes). El 90 % de los socios la usará DESDE EL CELULAR, así que todo se diseña MOBILE-FIRST (360–430 px de ancho primero, escritorio es secundario).

REPO: https://github.com/arancibiafloreserickmanuel-dotcom/batmon (rama main). Deploy: https://batmon.vercel.app (Vercel estático, se redespliega al hacer push).
Lee PRIMERO `PROGRESS.md` (estado, tablas, decisiones) y luego los archivos que vayas a tocar.

STACK (no lo cambies): Vite 5.4 multipágina, JS vanilla con módulos ES, sin frameworks, `@supabase/supabase-js`. Páginas: `index.html` (landing), `app.html` (socio), `admin.html` (admin). Código en `src/app/` (app.js, running.js, plyo.js, admin.js, common.js) y estilos SOLO en `src/app/app.css`. Backend: Supabase con RLS; ya está aplicado y probado.

REGLAS DURAS
1. NO toques la base de datos ni las políticas RLS. Si necesitas una columna/tabla nueva, crea `supabase/migrations/0003_<nombre>.sql` y avísame para aplicarla; no la asumas aplicada.
2. NO toques `src/fluid-cursor.js`, `src/shaders.js` ni `src/presets.js` (animación del cursor). En la landing solo puedes ajustar layout/tipografía/responsive; el efecto del cursor y su canvas se quedan como están (en móvil táctil debe seguir sin estorbar).
3. Mantén los nombres de tablas/columnas y los ids que usa el JS. Si renombras clases CSS, actualiza el JS que las usa.
4. Sin efecto glass/blur. Diseño limpio, alto contraste, tipografías actuales (Anton + Inter), identidad blanco/negro del club.
5. Todo texto en español. Nada de claves secretas; solo la publishable key que ya está en `.env`.
6. Trabaja en commits pequeños; al terminar ACTUALIZA `PROGRESS.md` (qué hiciste, archivos, qué falta). `npm run build` debe pasar sin errores.

TAREA 1 — REDISEÑO MOBILE-FIRST DE LA APP (`app.html`, `app.css`, y el HTML que generan los .js)
- Navegación inferior fija (bottom tab bar) con iconos SVG + etiqueta: Inicio · Running · Pliometría · Membresía. Zona táctil mínima 44 px, respetar `env(safe-area-inset-bottom)`. Cabecera compacta arriba.
- Tarjetas grandes, tipografía legible (≥16 px en inputs para que iOS no haga zoom), botones de ancho completo en móvil.
- Inicio: resumen de la semana de un vistazo + botón grande "Registrar" (acción rápida a running o pliometría) + aviso claro si el mes no está pagado.
- Running: formulario de registro rápido (km, minutos, tipo, esfuerzo) con teclado numérico (`inputmode="decimal"`), ritmo en vivo, lista de historial en tarjetas (no tabla) con editar/borrar, gráfico de 8 semanas legible en móvil.
- Pliometría: constructor de sesión pensado para usarse de pie y con una mano: selector de ejercicios como hoja inferior (bottom sheet) a pantalla casi completa, series como filas/tarjetas con inputs grandes y botones +/- para reps, botón "copiar serie anterior", cronómetro de descanso opcional. El historial en tarjetas.
- Membresía: QR grande, pasos numerados (1 paga, 2 sube comprobante, 3 espera aprobación), estado visible con color.
- Estados vacíos amables, indicadores de carga (skeleton), mensajes de error claros, y toasts en vez de `alert`.
- Accesibilidad básica (labels, foco visible, contraste) y soporte para modo oscuro con `prefers-color-scheme` si es barato.

TAREA 2 — REDISEÑO MOBILE-FIRST DEL ADMIN (`admin.html`, `src/app/admin.js`)
- Pagos / Socios / Ejercicios como pestañas con scroll horizontal o tab bar inferior.
- Tablas → tarjetas apilables en móvil. Acciones (aprobar, rechazar, reabrir, borrar, ver datos) como botones claros; confirmaciones con modal propio, no `confirm()` nativo.
- Ver el comprobante en pantalla completa con zoom (pellizcar o abrir en pestaña).
- Buscador de socios por nombre.

TAREA 3 — LANDING (`index.html`, `src/style.css`)
- Solo responsive y pulido en móvil: tamaños de títulos, espaciados, header con botón "Entrar" visible, CTA "Únete al Club" bien alcanzable con el pulgar. Sin cambiar el contenido ni la animación del cursor.

TAREA 4 — FUNCIONES PENDIENTES (solo frontend, o con migración 0003 si hace falta)
a) Bloqueo suave por pago: si el mes actual no está `approved`, mostrar aviso permanente y deshabilitar el registro de actividades/sesiones con un enlace a Membresía (lo mismo que verifica RLS no debe cambiar; esto es solo UX; si quieres imponerlo en BD, hazlo en una migración 0003 aparte y avísame).
b) Aviso al socio cuando su pago pasa a aprobado o rechazado (banner la próxima vez que entra).
c) "Olvidé mi contraseña": `supabase.auth.resetPasswordForEmail` + pantalla para fijar la nueva contraseña.
d) Habilitar Natación en running.js (el enum `swimming` ya existe en la BD): añadir `{ v: 'swimming', t: 'Natación' }` a `DISCIPLINES` y ajustar las unidades/ritmo (min/100 m opcional).
e) Traducción de los 61 ejercicios: generar un archivo `src/data/plyometrics_es.json` con `{ id, name_es }` y un botón en Admin → Ejercicios "Aplicar traducciones" que haga upsert de `name_es` (solo esa columna).

ORDEN: 1 → 2 → 4a/4b/4c → 3 → 4d/4e. Si te quedas sin contexto, termina lo que estés haciendo, haz commit y deja en `PROGRESS.md` la lista de lo que falta. Antes de empezar, resume en 5 líneas tu plan y espera mi "ok".
