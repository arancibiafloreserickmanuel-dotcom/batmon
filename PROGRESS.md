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

## PENDIENTE DE DISEÑO (para ChatGPT/Cursor/Antigravity)
UI deliberadamente básica: estilos solo en src/app/app.css. Traducir nombres al español (admin → Ejercicios → columna ES). Bloqueo por pago, avisos al socio, natación, recuperación de contraseña, subir foto en ejercicio propio.

## FALTA
1. Registrar cuenta admin en /app.html y ejecutar: update public.profiles set role='admin' where id=(select id from auth.users where email='CORREO');
2. Prueba final: registrar km, subir comprobante, aprobar en /admin.html, comprobar sesión persistente.
3. Variables de Vercel también en Development (opcional).
4. Opcional: bloquear funciones si el mes no está aprobado; habilitar natación.

## Correr local
`npm install` → `npm run dev` → `/app.html`, `/admin.html`.
