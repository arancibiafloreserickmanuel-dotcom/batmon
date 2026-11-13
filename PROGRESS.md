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
