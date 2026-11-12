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

## FALTA
1. Registrar cuenta admin en /app.html y ejecutar: update public.profiles set role='admin' where id=(select id from auth.users where email='CORREO');
2. Prueba final: registrar km, subir comprobante, aprobar en /admin.html, comprobar sesión persistente.
3. Variables de Vercel también en Development (opcional).
4. Opcional: bloquear funciones si el mes no está aprobado; habilitar natación.

## Correr local
`npm install` → `npm run dev` → `/app.html`, `/admin.html`.
