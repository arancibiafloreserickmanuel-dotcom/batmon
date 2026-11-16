# PROGRESS — Batmon Crowd (entrega 18 nov)

Todo vive en `D:\Erick\batmon`. Nada en C:. (`.npmrc` manda el caché de npm a `D:\Erick\batmon\.npm-cache`.)

## Stack / decisión
Vite (JS vanilla) multipágina + `@supabase/supabase-js` directo. **Sin Prisma ni Next**: la landing ya era Vite y la seguridad
vive en RLS de Postgres, así que no hace falta capa de servidor. Despliega en Vercel como sitio estático.
Inspiración de `bjarkeef/runnr` (MIT): modelo "usuario → actividades" y dashboard (última actividad, km semanal, récords,
historial). Reescrito, sin copiar código. Se omitió Strava/planes de entrenamiento (fuera de alcance).

## HECHO
- `index.html`, `src/main.js`, `src/style.css`: landing + cursor fluido (repo fluid-cursor). **No tocar** diseño (lo retoca ChatGPT).
- `supabase/schema.sql` (ejecutar entero en SQL Editor):
  - `profiles(id→auth.users, full_name, role member|admin)` + trigger que lo crea al registrar usuario.
  - `activities(id, user_id, discipline enum running|cycling|swimming, distance_km, duration_min, performed_on, notes)`.
    `swimming` ya existe en el enum; falta solo habilitarlo en la UI (`DISCIPLINES` en `src/app/app.js`).
  - `memberships(id, user_id, period (1er día del mes), amount_bs=200, status pending|approved|rejected, proof_path, approved_at, approved_by)`.
  - RLS: activities solo propias (CRUD); memberships el usuario solo INSERTA en `pending` y lee las suyas; solo admin hace UPDATE (nadie se auto-aprueba);
    profiles: update solo de `full_name` (grant por columna → no puede cambiarse el rol). `is_admin()` security definer.
  - Storage bucket privado `receipts`, ruta `<user_id>/<archivo>`; el usuario sube/lee lo suyo, admin lee todo.
  - Vista `weekly_km` (security_invoker) y función pública `ping()` para keep-alive.
- `app.html` + `src/app/app.js`: login email/contraseña con **sesión persistente** (`persistSession`, `autoRefreshToken`), dashboard
  (km semanales running/ciclismo, total, última actividad, récords, historial con ritmo, borrar), formulario de actividad, pago por QR.
- Pago manual: muestra `public/qr-pago.webp` (QR real ya cargado), sube comprobante al bucket y crea membresía `pending`.
- `admin.html` + `src/app/admin.js`: lista pendientes con link firmado (1 h) al comprobante, botones Aprobar/Rechazar.
- `.github/workflows/keepalive.yml`: cron cada 3 días → `POST /rest/v1/rpc/ping`.

## ESTADO (12 nov)
- Supabase creado (São Paulo), schema ejecutado, RLS activo, bucket receipts privado. Registro público ACTIVO (apagar cuando se registren los 10 socios).
- Vercel: https://batmon.vercel.app (repo arancibiafloreserickmanuel-dotcom/batmon, rama main). Site URL de Supabase = esa URL.
- Keep-alive GitHub Action cada 3 días con secrets SUPABASE_URL / SUPABASE_ANON_KEY (probado en verde).
- QR real en public/qr-pago.webp. Landing enlaza a app.html (Entrar / Únete al Club).

## FASE 2 (12 nov) — Pliometría + running ampliado + admin detallado
Código hecho, **migración 0002 aún NO aplicada en Supabase** (usar PROMPT_CLAUDE_CHROME_2.md).
- `supabase/migrations/0002_plyometrics_running_admin.sql`:
  - activities += run_type (easy|long|tempo|intervals|race|recovery), rpe, elevation_m.
  - exercises(id text pk, name, name_es, category, level, equipment, primary/secondary_muscles[], instructions[], images[], source dataset|custom, created_by, is_active). RLS: ver activos; crear/editar/borrar propios custom; admin todo.
  - workouts(user_id, kind='plyometrics', performed_on, duration_min, rpe, notes) + workout_sets(workout_id, user_id, exercise_id, position, set_no, reps, contacts, height_cm, box_height_cm, distance_m, weight_kg, rest_sec, duration_sec). RLS propio; admin ver/editar/borrar.
  - RPC admin: admin_member_overview(), admin_set_role(), admin_delete_user() (security definer, validan is_admin()). Policies admin: borrar/editar activities, borrar memberships, update profiles.
- Dataset: yuhonas/free-exercise-db (dominio público, LICENSE en public/exercises/). 61 ejercicios categoría plyometrics: src/data/plyometrics.json + 122 fotos en public/exercises/<id>/0|1.jpg. Se importan a la BD desde Admin → Ejercicios → "Importar catálogo base" (upsert; no pisa name_es ni is_active).
- App (`app.html`): pestañas Inicio | Running | Pliometría | Membresía (hash routing). Archivos: src/app/app.js (shell, login, inicio, pago), running.js (stats, récords, gráfico 8 semanas, form con tipo/desnivel/esfuerzo, editar/borrar), plyo.js (constructor de sesión con selector de ejercicios con fotos, series con reps/contactos/altura/cajón/distancia/peso/descanso, borrador en localStorage, historial, récords, biblioteca, ejercicio propio), common.js.
- Admin (`admin.html`): Pagos (aprobar/rechazar/reabrir/borrar), Socios (resumen, ver/borrar datos, hacer/quitar admin, eliminar socio con confirmación), Ejercicios (importar, traducir name_es, activar/desactivar, borrar).
- Referencia revisada solo lectura: `D:\Erick\app movil\vida-total-web` (picker de ejercicios con filtros, ficha con instrucciones/imagen, ejercicios propios). Allí el estado vive en un store de cliente; aquí es relacional con RLS. No se copió código ni estilos glass.
- Decisión: tabla workouts.kind permite añadir 'strength' después sin migrar de nuevo la estructura de series.

## FASE 3 — DISEÑO MOBILE-FIRST Y FUNCIONES FRONTEND (13 nov)
- App móvil: navegación inferior fija con zonas táctiles grandes y safe area; tarjetas/inputs accesibles, contraste y modo oscuro; registro rápido, historial running en tarjetas y métricas semanales; constructor de pliometría con tarjetas por serie, controles +/- , copiar serie y cronómetro de descanso.
- Membresía: QR y pasos numerados; bloqueo de formularios running/pliometría hasta aprobación del periodo actual; aviso en Inicio cuando el estado cambia a aprobado/rechazado.
- Cuenta: recuperación por email con `resetPasswordForEmail` y formulario para fijar contraseña; Natación habilitada con ritmo opcional en min/100 m.
- Admin: pestañas inferiores; pagos, socios y catálogo en tarjetas; búsqueda de socios; confirmaciones propias, vista ampliada de comprobantes con opción de abrir en pestaña y aplicar las 61 traducciones actualizando solo `name_es`.
- Landing: ajustes responsive para móvil, botón Entrar visible y CTA Únete al Club alcanzable; no se modificó la animación ni sus módulos. Sin blur en la cabecera/controles.
- Archivos: `app.html`, `admin.html`, `src/app/app.css`, `src/app/app.js`, `src/app/running.js`, `src/app/plyo.js`, `src/app/admin.js`, `src/app/common.js`, `src/data/plyometrics_es.json`, `src/style.css`.
- Verificación: `npm run build` pasó el 13 nov; dataset y traducciones tienen 61 IDs coincidentes.

## FASE 4 — TRACKER DE ENTRENAMIENTO Y MÓDULOS POR SOCIO (13 nov)
- Revisión de referencia: [hugogtab/opengym](https://github.com/hugogtab/opengym), fork del tracker openGym. Se adaptaron conceptos de plan semanal, sesión guiada, precarga de la última sesión, registro de series, RPE, descanso e historial; no se reutilizó código ni multimedia del proyecto.
- Nuevo `src/app/training.js`: plan semanal persistente por día, sesión libre/planificada, series de repeticiones/peso/tiempo/descanso, valores recientes precargados, temporizador, volumen resumido e historial.
- Catálogo inicial propio de 20 movimientos en `src/data/training_exercises.json`, con importación desde Admin → Ejercicios. No incluye imágenes de terceros.
- Admin → Socios → Ver datos: switches para mostrar/ocultar Running (incluye ciclismo/natación), Pliometría y Entrenamiento para cada socio.
- Shell de la app: navegación, resumen semanal y accesos rápidos se filtran según los módulos habilitados. Pestaña manual de un módulo desactivado muestra el estado deshabilitado.
- `supabase/migrations/0003_training_modules.sql`: amplía `workouts.kind`, añade plan JSONB individual y preferencias de módulo con RLS: el socio gestiona su plan; solo admin cambia preferencias de módulos.
- Archivos: `src/app/training.js`, `src/data/training_exercises.json`, `src/app/app.js`, `src/app/admin.js`, `src/app/app.css`, `supabase/migrations/0003_training_modules.sql`.
- Verificación: `npm run build` pasó; el catálogo tiene 20 IDs únicos.
- Ajuste solicitado: menú separado para Running, Ciclismo, Natación, Pliometría y Entrenamiento; página Admin → Módulos con controles globales y combinaciones individuales por socio. La barra inferior permite desplazarse horizontalmente cuando los módulos visibles superan el ancho móvil.
- `supabase/migrations/0004_module_controls.sql`: catálogo global de módulos y claves granulares por socio. Los módulos globalmente apagados quedan deshabilitados incluso si un socio tiene una excepción activa.

## PENDIENTE
- La migración `supabase/migrations/0002_plyometrics_running_admin.sql` sigue pendiente de aplicar; las pantallas de pliometría/admin dependen de ella. No se aplicó ninguna migración directamente en Supabase; 0003 solo define RLS para sus dos tablas nuevas y no cambia las policies existentes.
- Para Entrenamiento y los switches por socio también hay que aplicar `supabase/migrations/0003_training_modules.sql` después de 0002. Después importar el catálogo desde Admin → Ejercicios.
- Para la página Admin → Módulos y el menú granular se requiere aplicar además `supabase/migrations/0004_module_controls.sql`, después de 0003.
- Pendiente comprobación con Supabase real: registro de actividad/sesión con membresía aprobada, bloqueo con pago pendiente/rechazado, ciclo aprobar/rechazar y recuperación de contraseña.
- Registrar cuenta admin y ejecutar el SQL de asignación de rol del paso 1 arriba; confirmar credenciales y variables de entorno en Vercel antes del despliegue.
- El dataset de traducciones cubre los 61 ejercicios base; ejercicios propios se siguen nombrando por su creador.

## Correr local
`npm install` → `npm run dev` → `/app.html`, `/admin.html`.

## Cuentas y acceso (13 nov)
- Migración 0011: `update_my_account` (el usuario edita nombre/usuario/carnet/teléfono/correo; también la usa el formulario de primer ingreso), FK `memberships.approved_by` ahora `on delete set null` (antes impedía borrar a un admin), políticas de borrado de storage para admin, `admin_delete_user` borra sesiones + ejercicios propios y la cuenta (cascada); no permite borrar al único admin.
- App: si falta usuario/carnet/teléfono (p. ej. 1.ª vez con Google) aparece `showProfileSetup` (src/app/auth.js) y no se puede entrar sin completarlo. Perfil → Configuración: "Mis datos" y "Cambiar contraseña" para todos (admin incluido).
- Recuperación de contraseña: usuario + teléfono de 8 dígitos (sin SMS); cuentas admin deben entrar con Google. Sin límite de intentos (pendiente).
- Admin → Socios → Eliminar: borra archivos de storage del socio y luego el RPC.
- Google OAuth: configuración en PROMPT_CLAUDE_CHROME_4.md.

## Inicio — calendario unificado mobile-first cal10 (14 nov)
- Botón de filtro cambiado a "Hoy" (Hoy / Semana / Mes).
- Círculo de selección reducido a 28px centrado y discreto con tipografía idéntica a las cards (Inter para números y texto, Anton para el mes).
- Calendario neumórfico con fondo y color idéntico a las cards de la app, texto y fecha en blanco.
- Celda seleccionada con círculo negro sólido sin colores morados.
- Campana de notificaciones agregada a la derecha de los botones de navegación en la cabecera.
- Barra tiradora de despliegue posicionada hasta el fondo (abajo de la semana cuando está encogido y abajo de los eventos cuando se despliega), con mayor margen vertical en modo encogido.
- Modo encogido (Semana): muestra únicamente la fila de 7 días de la semana activa y la barra tiradora inferior, sin botones ni eventos visibles.
- Modo desplegado (Mes): muestra el mes completo y abajo el drawer con los eventos/planes del periodo y los toggles Hoy / Semana / Mes.
- Sin punto en el día 12 y puntos de actividad exclusivos para registros reales.
- Tarjeta de descanso separada ("Descansa, [Nombre]") ubicada abajo fuera del calendario, con acceso directo a Registrar entrenamiento.
- Archivos: `src/app/app.js`, `src/app/app.css`.

## Eventos — corrección de asistencia (15 nov)
- Se agregó import explícito de `notify` en `src/app/app.js`, que faltaba en los handlers de eventos y otros avisos de perfil.
- La confirmación ahora deshabilita temporalmente el botón y comunica éxito/error sin dejar el modal en un estado engañoso.
- La cancelación usa el modal de confirmación compartido y restringe el UPDATE por ID y usuario; éxito/error se comunica con toast.
- Según el reporte de verificación adjunto, la migración 0012 está aplicada y el despliegue anterior estaba Ready. Esta corrección aún debe desplegarse.
- Verificación: `npm run build` pasó. Pendiente: desplegar este cambio y repetir confirmación/cancelación con una cuenta de socio.

## Eventos del club (15 nov)
- Migración 0012 (`events`, `event_rsvps`, `event_notifications`, bucket público `event-media`, RPC `send_event_reminder`). Endurecida en revisión: notificaciones solo permiten UPDATE de `is_read`, bucket limitado a imágenes ≤5 MB, recordatorio valida destino y evita duplicados.
- App: calendario con eventos reales, confirmar/cancelar asistencia, notificaciones. Admin → Eventos: crear/editar, imagen, notificar, asistentes.
- Pendiente: aplicar 0012 en Supabase y probar flujos (RSVP, notificación, recordatorio, imagen).

## Auditoría integral + primera entrega Running/Pliometría (15 nov)
- Diagnóstico del código real en `AUDITORIA_PLATAFORMA.md`: arquitectura Vite/JS vanilla + Supabase, inventario por áreas, funciones existentes, brechas y orden recomendado. Se conserva el calendario único de Inicio y Progreso dentro de Perfil.
- Running: añadido tracker GPS foreground con iniciar/pausar/reanudar/finalizar, cronómetro, distancia/ritmo, trazo local de ruta y borrador persistente por usuario. El guardado de la actividad conserva los puntos GPS; ante fallo de BD queda pausada para reintentar.
- Pliometría: nueva pestaña de evaluación manual para CMJ, SJ y Drop Jump, con mediciones e historial. No estima resultados ni simula sensores.
- El usuario confirma que `supabase/migrations/0013_running_gps_track.sql` ya está aplicada: columnas de ruta/fuente GPS y tabla/RLS para evaluaciones pliométricas.
- Verificación local: `npm run build` pasó el 15 nov. Sin validación de GPS físico, sesión real, RLS o Supabase conectado en este entorno. GPS web requiere HTTPS/permisos y mantener la pestaña disponible.
- Nota de auditoría: el historial de migraciones en este archivo contiene estados que no coinciden entre secciones (por ejemplo, 0012 se marca aplicada según reporte del usuario y más abajo pendiente). No se puede confirmar el estado remoto desde este repositorio; revisar con el listado de migraciones de Supabase antes de aplicar cualquier SQL.

## Organización por páginas + Club (15 nov)
- Running/Ciclismo/Natación: separadas dentro de cada disciplina en Resumen, Iniciar/Registrar e Historial; las métricas de resumen semanal usan la disciplina seleccionada. El historial muestra el trazo GPS cuando existe.
- Corregido un cruce de datos: el historial de Pliometría filtra `workouts.kind='plyometrics'`; los borradores locales pliométricos ahora quedan separados por usuario.
- Se agregó la página Club con subsecciones Actividad, Miembros y Retos. Actividad reutiliza `profile_posts` y `profile-media`, visibilidad del autor y sus amigos aceptados; permite publicar fotos/videos, comentar, reaccionar y borrar publicaciones propias. Miembros usa el directorio/amistades existentes. Los eventos siguen en el calendario único de Inicio.
- Admin tiene gestión CRUD de retos. Las clasificaciones se calculan con registros reales y separan disciplinas/unidades; Running/Ciclismo/Natación pueden puntuar kilómetros o sesiones y Pliometría/Entrenamiento sesiones.
- Nuevas migraciones `0014_club_community.sql` y `0015_club_challenges.sql`: ampliar claves de publicación a Ciclismo; añadir reacciones/comentarios y retos/participantes/RPC de clasificación con RLS. Pendientes de aplicar por el usuario; no se ejecutó SQL remoto.
- Perfil: se conserva y no se duplicó Progreso. Natación, Ciclismo y Entrenamiento conservan sus páginas existentes; Running ahora presenta los registros de Ciclismo/Natación en vistas internas separadas.
- Verificación: `npm run build` pasó el 15 nov y `git diff --check` no reportó errores. No se validó con sesión real, datos Supabase ni dispositivos.

## Navegación inferior con efecto dock (15 nov)
- Se aplicó la expansión del icono al pasar el cursor, con crecimiento gradual de los iconos vecinos y realce moderado de la pestaña activa.
- En pantallas táctiles se resalta la opción activa sin depender de hover. Se respeta `prefers-reduced-motion`.
- Se renovaron los iconos de Pliometría y Entrenamiento para que representen mejor sus disciplinas.
- Archivos: `src/app/app.js`, `src/app/app.css`. Compilación `npm run build` correcta; queda pendiente revisar visualmente en móvil y escritorio.
- Las migraciones 0014 y 0015 siguen pendientes de aplicación según la última confirmación del usuario.

## Dock BATMON: etiquetas y relieve (15 nov)
- Ajustado según la referencia: en reposo se muestran solo iconos; etiqueta flotante al pasar/enfocar y para la página activa. La selección eleva el icono en una base circular con relieve.
- La barra inferior ahora va en una cápsula con bordes y sombras parecidos al calendario, adaptados a tema claro/oscuro. Al pasar por una opción, aumenta su tamaño y el de las vecinas.
- Se añadió `aria-current` a la pestaña activa; el cambio conserva navegación y rutas existentes.
- Archivos: `src/app/app.js`, `src/app/app.css`. `npm run build` y `git diff --check` correctos.

## Dock BATMON: relieve hundido y etiqueta activa (15 nov)
- El círculo de la pestaña seleccionada ahora es fijo y redondo, con sombras hacia dentro en ambos temas siguiendo el relieve hundido del calendario.
- La etiqueta activa aparece debajo del icono y fuera del círculo; al pasar o enfocar, se desplaza arriba como tooltip. Se mantiene la expansión del icono y sus vecinos.
- Compilación `npm run build` correcta; `git diff --check` limpio.

## Alineación del icono activo del dock (15 nov)
- Centrado el icono dentro del círculo seleccionado mediante un ajuste vertical de su posición.
- `npm run build` correcto; `git diff --check` limpio.

## Campanita de Inicio abre calendario (15 nov)
- La campanita ahora expande el calendario completo existente y desplaza la vista hasta él; ya no abre el modal duplicado de notificaciones/eventos.
- Se conserva el contador de notificaciones sin leer y se sincroniza `aria-expanded` con el estado del calendario.
- Compilación `npm run build` correcta; `git diff --check` limpio.

## Dock y checks en Administración (15 nov)
- Corregida navegación Admin: Pagos, Socios, Módulos, Ejercicios, Eventos y Retos tienen iconos SVG; nombres solo visibles en selección/hover, con círculo activo hundido y animación de vecinos.
- Los checks de módulos globales, excepciones por socio y ficha de socio usan el control circular neumórfico con marca verde oscuro; estilos limitados a `.module-toggle`.
- `npm run build` pasó; `git diff --check` limpio.

## Checks compartidos en la app (15 nov)
- Se extendió el diseño circular neumórfico con check verde oscuro a los checkbox de toda la app (planes, catálogo, notificación de eventos y otros formularios), conservando el switch ilustrado de tema.
- Estados seleccionado, foco de teclado y deshabilitado quedan visibles; se mantienen eventos/valores nativos de cada input.
- `npm run build` correcto; `git diff --check` limpio.

## Diseño y asistentes de eventos (15 nov)
- La lista del calendario muestra la imagen configurada por el admin. La ficha de evento reorganiza portada con fecha/título, descripción, hora, ubicación, acciones Voy/No voy y lista horizontal de avatares/nombres confirmados. Respuesta RSVP refresca Inicio.
- Los avatares están en `profile-media` privado. Nueva migración `0016_event_attendee_avatars.sql` permite leer solo archivos `avatar-*` de socios confirmados; debe aplicarse en Supabase antes de que aparezcan fotos ajenas. No se ejecutó SQL remoto.
- Indicador de evento verde actualizado a verde oscuro. Hora de eventos del calendario formateada desde `event_date`.
- Archivos: `src/app/app.js`, `src/app/app.css`, `supabase/migrations/0016_event_attendee_avatars.sql`. `npm run build` correcto; `git diff --check` limpio.

## Animación compacta de volver/cerrar y cabecera admin (15 nov)
- Se reutiliza la animación de volver en cierres de modales, en tamaño compacto; se mantienen tamaños normales en páginas completas.
- Cabecera admin ordenada con marca ADMIN, nombre y avatar del administrador, y botón animado «Volver a la app», adaptado a móvil.
- `npm run build` pasó; `git diff --check` limpio.

## Ajustes visuales de eventos en móvil (15 nov)
- La etiqueta genérica «Evento» usa fondo blanco/negro según el tema y texto verde oscuro; las etiquetas de prioridad amarilla/roja conservan sus colores.
- El detalle del evento se centra en móvil, respeta las áreas seguras y limita su alto al viewport. Descripción, hora y lugar usan superficie/sombras de cards.
- `npm run build` pasó; `git diff --check` limpio.

## Posición del cierre del modal de eventos (15 nov)
- Se subió el control animado «Cerrar» en la portada del evento, con margen compacto adaptado a móvil. La ficha conserva scroll interno y respeta safe areas.
- `npm run build` correcto; `git diff --check` limpio.

## Seguimiento táctil del cursor fluido (15 nov)
- El seguimiento táctil identifica el dedo activo desde `touchstart`, ignora `touchend` de otros contactos y limpia/recupera el estado correctamente en `touchend`/`touchcancel`.
- Coordenadas limitadas al canvas y sensibilidad táctil aumentada 20%; no se cambió radio, presets ni aspecto.
- `npm run build` pasó; `git diff --check` limpio. Pendiente verificar físicamente en un teléfono.

## Animación de entrada de imagen en móvil (15 nov)
- La imagen de «En cada ruta, un Crowd» ahora inicia en aproximadamente el 48 % del ancho final en móvil, con límites para pantallas pequeñas, y crece progresivamente con el scroll.
- El comportamiento y tamaño inicial de escritorio no cambiaron. Pendiente de confirmar en un teléfono real.

## Carrusel de complejos integrado al scroll móvil (15 nov)
- En móvil, el carrusel queda sticky mientras el scroll vertical recorre su tramo; el avance vertical sincroniza las imágenes y al llegar a la última se libera la página para continuar normalmente.
- Se conserva el gesto horizontal directo y el comportamiento de escritorio. Build correcto; pendiente validar en dispositivo táctil real.

## Nueva primera imagen del carrusel (15 nov)
- Se agregó la foto del futuro centro de entrenamiento como primera diapositiva. Se actualizaron los cinco indicadores y el resto de imágenes conserva su orden.
- `npm run build` pasó; `git diff --check` limpio.

## Galería animada de indumentaria (15 nov)
- Se reemplazó el bloque promocional bajo el carrusel por «Indumentaria» y una galería 3D de scroll inspirada en Curved Scroll Gallery, adaptada a Vite/Three.js y con el fondo original de la landing.
- Las líneas NEW POLERA, NUEVA PIEL y BATMON CROWD animan con el desplazamiento. Se añadieron las cinco imágenes solicitadas en orden; las dos prendas PNG conservan transparencia y se muestran completas.
- El enlace del menú ahora apunta a Indumentaria. `npm run build` pasó; `git diff --check` limpio. Pendiente revisar en teléfono real.

## Correcciones de scroll y galería responsive (15 nov)
- El carrusel de complejos ahora avanza con el scroll vertical de página en escritorio y móvil dentro de su runway sticky; rueda horizontal/trackpad horizontal sigue moviendo las tarjetas directamente y la página continúa al terminar.
- Las fotos de complejos se pasaron a JPEG, reduciendo su conjunto de unos 6.2 MB a cerca de 0.95 MB. Las prendas transparentes se redujeron de tamaño conservando el canal alfa; la galería de indumentaria usa escala y tarjetas mayores en móvil.
- «Indumentaria» usa texto negro y tamaño/estilo como «Complejos de entrenamiento». El título de complejos se acercó al carrusel en móvil.
- Se aumentó la respuesta táctil del cursor de 1.2x a 2.2x, sin alterar presets ni radio.
- `npm run build` pasó; `git diff --check` limpio. Pendiente validar gestos y encuadre en dispositivos reales.

## Indicadores de fecha para eventos en calendario (15 nov)
- Se añadieron estilos visibles para el círculo de evento con tonos oscuros: verde a más de 7 días, amarillo de 3 a 7 días y rojo en los últimos 2 días o en fechas pasadas.
- La fecha del evento se compara en hora local, evitando desplazar al día siguiente eventos próximos a medianoche. El calendario carga eventos pasados y futuros para marcar todas sus fechas.
- `npm run build` pasó; `git diff --check` limpio. No requiere migración.

## Inicio: agenda y resumen semanal (15 nov)
- Inicio conserva el calendario existente y suma saludo/fecha compactos, cumplimiento de los días configurados en `training_plans` y resumen real del día.
- El calendario combina eventos actuales, fechas de inicio/fin de retos de `club_challenges`, rutinas semanales de Gimnasio y actividades/sesiones guardadas. Los indicadores tienen leyenda; al elegir un día, la agenda separa rutinas, eventos/retos y actividad completada. Los eventos siguen abriendo su ficha actual.
- Se conservó el bloque visual de «Entrenamiento de hoy», ahora sin acciones simuladas y basado en el plan existente. Resumen semanal presenta métricas por disciplina (km solo para Running/Ciclismo/Natación; sesiones para Pliometría/Gimnasio), duración disponible y estados sin registros. «Actividad reciente» es un desplegable limitado a la semana actual.
- Respeta módulos habilitados y temas existentes. No se agregó esquema ni migración. Competiciones y recordatorios personales no tienen una fuente/categoría independiente en el modelo actual; no se inventan. Si la consulta de retos falla (p. ej. la 0015 aún no está aplicada), Inicio lo informa y sigue funcionando con el calendario/eventos disponibles.
- Archivos: `src/app/app.js`, `src/app/app.css`. `npm run build` pasó y `git diff --check` limpio; no existe script de pruebas en `package.json`. Pendiente validación visual y con sesión real en móvil/escritorio.

## Ajustes visuales posteriores de Inicio (15 nov)
- Se quitó la fecha del saludo y se movió a ese espacio el estado de hoy. Se retiró la leyenda de puntos bajo el calendario; los indicadores en las fechas permanecen.
- Los avisos de planificación/eventos/retos ahora aparecen dentro de su sección correspondiente en la agenda del calendario, sin tarjeta de aviso separada.
- Se restauró el tamaño y contenido previo de la tarjeta de descanso, incluido su acceso para registrar entrenamiento. Resumen semanal y actividad reciente no se modificaron.

## Menú único de Entrenamiento (15 nov)
- El menú inferior agrupa Running, Ciclismo, Natación, Pliometría y Gimnasio bajo una única pestaña «Entrenamiento».
- La pantalla de selección muestra únicamente las disciplinas habilitadas globalmente y para el socio. Cada una conserva su página, datos, estadísticas e historial; se añadió un acceso para volver al selector.
- Las rutas existentes para Running, Ciclismo, Natación y Pliometría se conservan. El módulo anterior de fuerza se abre con `#gym`; `#training` ahora es el selector.
- Cambio solo de frontend; no requiere migración. En el directorio local figuran 0014, 0015 y 0016 como migraciones que requieren verificación/aplicación. Hay notas históricas contradictorias sobre 0002 y 0012; confirmar el historial real de Supabase antes de ejecutar pendientes.
- Archivos: `src/app/app.js`, `src/app/app.css`. Build y revisión manual de rutas pendientes.


## Entrenar — centro de disciplinas (15 nov)
- La página unificada de Entrenar presenta las disciplinas habilitadas en este orden: Running, Pliometría, Natación, Ciclismo y Entrenamiento físico.
- Se ajustaron encabezado, descripciones y distribución adaptable de tarjetas; en escritorio la quinta tarjeta queda centrada y en móvil se conserva una columna legible.
- Se mantienen los destinos existentes y el filtrado por permisos individuales/globales; no se alteraron los módulos ni se agregaron estadísticas ficticias.
- Se omitió “Continuar entrenamiento”: los borradores de sesiones no garantizan una reanudación directa fiable desde la portada, especialmente tras recargar; implementarlo requeriría cambiar el funcionamiento interno de los módulos, fuera del alcance de esta fase.
- No requiere migraciones ni dependencias nuevas.

## Corrección migración 0015 y cancelar asistencia en eventos (15 nov)
- **0015_club_challenges.sql**: Corregida la comparación de tipos `operator does not exist: discipline = text` en la función `club_challenge_leaderboard`, aplicando cast explícito `a.discipline::text = c.discipline` en las consultas de `activities`. Lista para reejecutar en Supabase.
- **Cancelación de asistencia en eventos (`src/app/app.js`)**: Solucionado el bug `Cannot set properties of null (setting 'disabled')` al pulsar "No voy". El objeto `eventClick.currentTarget` se volvía `null` tras la espera asíncrona del `await confirmDialog(...)`. Ahora se captura la referencia al botón antes del `await` y con selector de respaldo.
- Verificación: `npm run build` ejecutado exitosamente con 0 errores.


## Running — auditoría e implementación de fases 1–7 (15 nov)
- Auditoría: Running ya usaba la tabla `activities`, `watchPosition`, puntos GPS y registro manual; conservé esas bases y la navegación existente. La pantalla anterior tenía la finalización sin revisión, cortes potencialmente unidos en mapa, historial básico y mapas no geográficos.
- Correr: ahora es la pestaña inicial; mapa real interactivo Leaflet/OpenStreetMap, centrar/zoom, marcas de inicio/último punto, estado y precisión GPS, objetivo libre/distancia/tiempo, aviso por km, pausa, reanudación y finalización hacia revisión. El mapa no espera la ubicación para aparecer.
- GPS: filtra posiciones por precisión, saltos y velocidad; persiste puntos localmente por usuario; pausa sin sumar tiempo/distancia; reanudación y pérdida de señal abren tramos separados. Conserva el borrador si falla el guardado. Se advierte que el navegador puede suspender ubicación en segundo plano.
- Revisión: presenta fecha/hora, mapa, distancia, tiempo total/en movimiento, ritmo, parciales y desnivel estimado; permite nombre, tipo, RPE, superficie, notas y hasta 3 fotos. Guardar es explícito; descartar pide confirmación; volver a correr permite reanudar. Los objetivos muestran si se alcanzaron.
- Manual: el formulario no está permanentemente bajo el mapa; abre desde Correr/Historial, usa fecha anterior o actual, duración h:mm:ss, distancia decimal y ritmo calculado; edición reutiliza el formulario. GPS conserva su ruta y sus métricas al editar detalles.
- Progreso: periodos semana/mes/todo; distancia, carreras, duración y ritmo; récord de distancia y duración con fecha y récord GPS verificable para 1/5/10 km con fecha; gráfico de 8 semanas seleccionable. No se inventan récords para salidas manuales sin ruta verificable.
- Historial: filtros por fuente/tipo y periodo, orden por fecha, carga incremental de 25 filas en interfaz, trazo miniatura del GPS, detalle con mapa/fotos/parciales, edición, compartir resumen mediante API del dispositivo/portapapeles y eliminación confirmada. El cliente aún consulta la lista del socio completa para que Progreso y récords sean exactos; la paginación progresiva es visual y se debe convertir a paginación backend si el volumen crece mucho.
- Persistencia: `0018_running_activity_review.sql` añade campos para nombre, inicio, duración exacta, tiempo móvil, segmentos, parciales, fotos y superficie; mantiene RLS actual. El usuario confirmó el 16 nov que 0014–0017 estaban aplicadas y ejecutó 0018; verificó las 8 columnas nuevas.
- Leaflet se añade como dependencia. OpenStreetMap muestra atribución y usa el servicio público de mosaicos, que no garantiza SLA; para uso/volumen mayor conviene configurar un proveedor de mapas.
- Archivos: `src/app/running.js`, `src/app/running-tracker.js`, `src/app/app.css`, `package.json`, `package-lock.json`, `tests/running-tracker.test.js`, migración 0018.
- Verificación: `npm run build` pasó; 3 pruebas Node del tracker pasaron; `npm audit --omit=dev` reportó 0 vulnerabilidades. GPS físico y sesión real aún sin probar.
- Riesgo de dependencias detectado por `npm audit`: Vite 5 y esbuild tienen avisos de seguridad del servidor de desarrollo (1 alto, 1 moderado, desarrollo solamente); la solución sugerida eleva a Vite 6, cambio mayor fuera del alcance del stack fijado. Producción tiene 0 vulnerabilidades reportadas por `npm audit --omit=dev`.
- Limitaciones: no publicar automáticamente en Club (el detalle explica que compartir envía un resumen fuera de la app); el perfil de elevación no se grafica porque los datos de altitud no son suficientemente confiables; sin GPS físico no se puede validar precisión y consumo real. La compilación conserva el aviso preexistente de chunk Three.js >500 KB.

## Running — error al renderizar controles de configuración (16 nov)
- Corregido `Cannot set properties of null (setting 'value')`: la pantalla activa/pausada no crea el selector de unidades y el render intentaba configurarlo. También se protegieron los handlers de unidades, avisos, ajustes y registro manual cuando esos controles no están en el DOM.
- El usuario confirmó que 0014–0017 están aplicadas y que ejecutó 0018; indicó que verificó las ocho columnas nuevas en Supabase.
- Verificación posterior: compilación y pruebas del tracker.

## Pliometría — reorganización completa: Entrenar / Mi plan / Progreso (16 nov)
- **Auditoría:** se conservó el catálogo de 61 ejercicios, traducciones, imágenes, ejercicios personalizados y las tablas `exercises`, `workouts`, `workout_sets`, `plyo_assessments`. No se reimportó ni se perdió ningún dato.
- **Migración `0019_plyo_plan_and_routines.sql` (sin aplicar):** agrega `plyo_routines` (rutinas reutilizables por socio) y `plyo_plans` (plan semanal, un día → una rutina o descanso), con RLS igual que `training_plans`. Agrega `workouts.source_routine_id` y `workouts.plan_day` (nullable, no rompe nada existente).
- **`src/app/plyo.js` reescrito por completo** en tres pestañas:
  - **Entrenar:** sesión de hoy (si hay rutina programada o descanso), inicio rápido (libre o desde una rutina guardada), tarjeta de "sesión en curso" con Continuar/Descartar (usa y mejora el borrador de `localStorage` existente).
  - **Mi plan:** selector horizontal de 7 días con estado (configurado/descanso/vacío), panel de detalle por día (asignar, crear, editar, marcar descanso, quitar), copiar/pegar día (con confirmación si el destino ya tiene algo) y lista de rutinas guardadas (crear/editar/duplicar/eliminar). Se integró con el calendario de Inicio (`getPlanForDate`/`getCompletedForDate` en `app.js`): la rutina o el descanso de Pliometría ahora aparece en la agenda central junto al de Gimnasio, sin crear un calendario paralelo.
  - **Progreso:** resumen por periodo (semana/mes/todo), récords personales separando reps/contactos de altura/distancia/peso, gráfico de frecuencia semanal (reutiliza `.profile-bars`), historial completo con edición de metadatos (fecha/duración/RPE/notas) y borrado, y las evaluaciones CMJ/SJ/Drop Jump integradas (ya no es pestaña aparte) con cálculo automático de altura por tiempo de vuelo y de RSI cuando faltan, y comparación contra la evaluación anterior del mismo tipo.
  - Campos de cada serie ahora son dinámicos por ejercicio (heurística por palabras clave en nombre/equipo: salto con cajón, drop jump, horizontal/bounding, balón medicinal, salto vertical) en vez de mostrar siempre las 7 columnas.
  - Temporizador de descanso configurable (30/45/60/90/120/180 s o personalizado) con pausar/reanudar/±15 s/saltar, por ejercicio.
  - Biblioteca de ejercicios accesible desde Entrenar, Mi plan y la sesión activa (modal con buscador); se conserva "Crear ejercicio propio".
  - Si al finalizar una sesión los ejercicios o el número de series difieren de la rutina guardada, se pregunta si se quiere actualizar la rutina (nunca se sobrescribe en silencio).
- **Simplificaciones conocidas** (documentadas, no son errores): "pegar día" reemplaza el día destino (no ofrece "añadir a lo existente"); no hay un asistente de pantalla completa un-ejercicio-a-la-vez, se mantiene una lista de tarjetas con checkbox "Hecho" por ejercicio y barra de progreso, consistente con el resto de la app; la edición de una sesión histórica cubre fecha/duración/RPE/notas, no las series ya guardadas (para cambiar series hay que borrar y repetir la sesión).
- **Pruebas:** `npm run build` pasa. No se pudo probar en el navegador real ni en Supabase (la migración 0019 no está aplicada); falta que el usuario la aplique y pruebe el flujo completo.
- **Archivos:** `supabase/migrations/0019_plyo_plan_and_routines.sql` (nuevo), `src/app/plyo.js` (reescrito), `src/app/app.js` (integración de `plyo_plans`/`plyo_routines` en el calendario de Inicio), `src/app/app.css` (estilos nuevos de Pliometría).

## Running — pantalla de carrera a pantalla completa (16 nov)
- **Corrección del solape:** en la pantalla "Correr" (prep y carrera activa), el dock inferior de disciplinas y la cabecera "RUNNING · BATMON CROWD" ya no se muestran a la vez: entran en "modo pantalla completa" (`body.run-takeover`, controlado desde `route()` en `app.js` y desde `render()` en `running.js`). El dock se oculta y la cabecera se quita; la navegación Correr/Progreso/Historial queda flotando arriba como píldora para no chocar con nada. Al salir a Progreso o Historial, el dock y la cabecera normales vuelven.
- **Pestañas en píldora deslizante:** la subnavegación de Running (`Correr/Progreso/Historial`) ahora es una píldora con un indicador que se desliza al cambiar de pestaña (CSS + `addPageNav` en `running.js`), en vez de los botones planos anteriores.
- **Mapa a pantalla completa sin bordes:** antes de iniciar y durante la carrera, el mapa ocupa toda la pantalla (`position:fixed`), sin el borde/tarjeta anterior, con un desvanecido hacia el color de fondo en los bordes (`box-shadow` inset).
- **Pantalla previa ("prep"):** botón "COMENZAR" negro con letra blanca (fijo, no cambia con el tema), dos botones circulares flotantes (Ajustes a la izquierda, Objetivo a la derecha) y una píldora "Establece un objetivo" / "Meta: X km" que abre el selector de objetivo. "Registrar manualmente" quedó como enlace flotante arriba a la izquierda.
- **Ajustes y objetivo en diálogos:** se quitaron los paneles desplegables en línea; ahora "Ajustes" (unidad, aviso por kilómetro, registro manual) y "Objetivo" (Libre/Distancia/Duración) abren un `<dialog>` propio, reutilizando el estilo ya existente de las hojas de detalle de Running.
- **Cuenta regresiva:** al pulsar "COMENZAR" aparece una cuenta 3‑2‑1 a pantalla completa (fondo según el tema claro/oscuro) y recién entonces arranca el GPS.
- **Carrera activa en 3 paneles deslizables:** mapa (de fondo, se seguía pudiendo mover) · contador grande (distancia, ritmo, tiempo, acciones de pausar/finalizar/descartar) · detalle (kilómetro, ritmo promedio, variación de ritmo, tiempo en movimiento, precisión GPS). Se desliza horizontalmente con scroll nativo (`scroll-snap`) y puntos indicadores; al arrancar se abre directamente en el panel del contador.
- **Limitación conocida:** desde el panel del mapa (el primero), si el dedo toca justo sobre el mapa, el gesto lo captura Leaflet para desplazar el mapa en vez de cambiar de panel; se puede volver a deslizar sin problema desde el panel del contador o el de detalle. No se implementó el menú radial de iconos en forma de abanico que se mostró como referencia (muy arriesgado de replicar fielmente en el tiempo disponible); se usan diálogos con el estilo propio de la app para Ajustes y Objetivo, con el mismo resultado funcional.
- **Pruebas:** `npm run build` pasa. No se pudo probar en vivo (requiere iniciar sesión con una cuenta real; no se usaron credenciales). El usuario debe probar en su teléfono: iniciar/pausar/reanudar/finalizar una carrera, deslizar entre los tres paneles, abrir Ajustes y Objetivo, y confirmar que el dock inferior no vuelve a tapar nada.
- **Archivos:** `src/app/running.js`, `src/app/app.js` (reseteo de `run-takeover` en `route()`), `src/app/app.css` (estilos nuevos).
