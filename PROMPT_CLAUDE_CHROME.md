Necesito que configures TODO el backend de mi app "Batmon Crowd" en Supabase, de principio a fin, y me avises cuando esté lista. Yo ya tengo la sesión iniciada en supabase.com, GitHub y Vercel en este Chrome. Trabaja solo; pregúntame únicamente lo que no puedas saber (marcado con [PREGUNTAR]).

El código está en mi PC en D:\Erick\batmon. El SQL completo está en el archivo `supabase/schema.sql`; te lo pego abajo entre las marcas ===SQL=== (si no está pegado, pídemelo). El plan gratis de Supabase es suficiente.

PASOS (en orden):

1. PROYECTO. En supabase.com crea un proyecto nuevo llamado `batmon-crowd` (región más cercana a Bolivia: South America / São Paulo). Genera una contraseña de base de datos fuerte y guárdala en un lugar que yo vea al final (no la pierdas). Espera a que termine de crearse.

2. SQL. Abre SQL Editor > New query, pega TODO el contenido de `schema.sql` y ejecútalo (Run). Debe terminar sin errores. Si hay un error, corrígelo y vuelve a ejecutar. Luego verifica en Table Editor que existen `profiles`, `activities`, `memberships` y que las tres tienen RLS activado (candado/“RLS enabled”), y en Storage que existe el bucket privado `receipts`.

3. AUTH. En Authentication > Providers > Email: deja Email activo, DESACTIVA "Allow new users to sign up" (solo yo creo usuarios) y DESACTIVA "Confirm email". En Authentication > URL Configuration pon como Site URL la URL de producción de Vercel si ya existe; si no, `http://localhost:5173` por ahora.

4. USUARIOS. En Authentication > Users > Add user > Create new user (con "Auto Confirm User" marcado) crea los 10 socios. [PREGUNTAR] la lista de 10 correos y la contraseña inicial de cada uno (o una contraseña temporal común). El primer usuario será MI cuenta de admin: [PREGUNTAR] mi correo y contraseña.
   Después, en SQL Editor ejecuta (con mi correo real):
   `update public.profiles set role='admin' where id = (select id from auth.users where email='MI-CORREO');`
   y confirma con `select id, full_name, role from public.profiles;` que hay 10 filas y solo una es admin.

5. PRUEBA DE SEGURIDAD (RLS). En SQL Editor verifica que las políticas existan: `select tablename, policyname from pg_policies where schemaname in ('public','storage');`. Debe haber políticas en profiles, activities, memberships y storage.objects (receipts_*).

6. CLAVES. En Project Settings > API copia la Project URL y la clave `anon` (public). NUNCA uses ni copies la `service_role`. Crea el archivo `D:\Erick\batmon\.env` con:
   VITE_SUPABASE_URL=<Project URL>
   VITE_SUPABASE_ANON_KEY=<anon key>
   (si no puedes escribir en mi disco, muéstrame las dos líneas listas para pegar).

7. VERCEL. En vercel.com importa/abre el proyecto de este repo (si aún no hay repo en GitHub, [PREGUNTAR] si lo creo). En Project Settings > Environment Variables agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (Production, Preview y Development) y haz Redeploy. Framework: Vite, Output: `dist`.

8. KEEP-ALIVE. En el repo de GitHub > Settings > Secrets and variables > Actions crea los secrets `SUPABASE_URL` (Project URL) y `SUPABASE_ANON_KEY` (anon). Ve a Actions > "supabase-keepalive" > Run workflow y confirma que termina en verde.

9. PRUEBA FINAL. Abre la URL de la app (`/app.html`), inicia sesión con un socio de prueba, registra una actividad de running (5 km, 30 min), verifica que aparece en el historial y en Supabase > Table Editor > activities. Sube una foto de comprobante en Membresía y confirma que aparece una fila `pending` en `memberships`. Luego entra a `/admin.html` con mi cuenta admin, aprueba ese pago y confirma que el estado cambia a `approved`. Cierra el navegador/recarga y confirma que NO vuelve a pedir login.

10. REPORTE FINAL. Dime en una lista corta: "LISTA ✅" o qué falló, la Project URL, la URL de la app en Vercel, y qué pasos dejaste pendientes. No incluyas contraseñas en el reporte.

REGLAS: no borres nada que ya exista; no uses la service_role key; no desactives RLS en ninguna tabla; si algo pide pagar o subir de plan, detente y pregúntame.

===SQL===
-- =====================================================================
-- BATMON CROWD — esquema Supabase (Postgres). Ejecutar completo en
-- Supabase Dashboard > SQL Editor. Es idempotente en lo posible.
-- =====================================================================

-- ---------- Tipos ----------
do $$ begin
  create type public.discipline as enum ('running', 'cycling', 'swimming');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.membership_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- ---------- profiles (1:1 con auth.users) ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  role       text not null default 'member' check (role in ('member','admin')),
  created_at timestamptz not null default now()
);

-- Crea el profile automáticamente al crear un usuario en Auth
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- activities ----------
-- swimming ya está en el enum; la UI aún no lo expone. Para agregarlo: solo
-- habilitar la opción en el formulario (src/app/app.js, DISCIPLINES).
create table if not exists public.activities (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  discipline   public.discipline not null,
  distance_km  numeric(7,2) not null check (distance_km > 0 and distance_km < 1000),
  duration_min numeric(7,1) not null check (duration_min > 0 and duration_min < 5000),
  performed_on date not null default current_date,
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists activities_user_date_idx on public.activities (user_id, performed_on desc);

-- ---------- memberships (un registro por pago mensual) ----------
create table if not exists public.memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  period      date not null default date_trunc('month', current_date)::date, -- mes que se paga
  amount_bs   numeric(8,2) not null default 200,
  status      public.membership_status not null default 'pending',
  proof_path  text,                       -- ruta en storage: <user_id>/<archivo>
  created_at  timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id)
);
create index if not exists memberships_user_idx on public.memberships (user_id, period desc);

-- ---------- helper: ¿es admin? (security definer evita recursión de RLS) ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------- ping para keep-alive (público, no expone datos) ----------
create or replace function public.ping()
returns text language sql stable as $$ select 'ok'::text; $$;
grant execute on function public.ping() to anon, authenticated;

-- =====================================================================
-- RLS — el filtrado vive en la BASE DE DATOS, no en el frontend
-- =====================================================================
alter table public.profiles    enable row level security;
alter table public.activities  enable row level security;
alter table public.memberships enable row level security;

-- profiles: cada uno ve el suyo; admin ve todos. Nadie cambia su rol.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;   -- role NO editable por el usuario

-- activities: solo las propias (admin solo lectura)
drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists activities_update on public.activities;
create policy activities_update on public.activities for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists activities_delete on public.activities;
create policy activities_delete on public.activities for delete to authenticated
  using (user_id = auth.uid());

-- memberships: el usuario crea SOLO en 'pending' y ve las suyas; solo admin aprueba
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists memberships_insert on public.memberships;
create policy memberships_insert on public.memberships for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and approved_at is null and approved_by is null);
drop policy if exists memberships_admin_update on public.memberships;
create policy memberships_admin_update on public.memberships for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- (el usuario no tiene política de update/delete => no puede auto-aprobarse)

-- =====================================================================
-- Storage: bucket privado "receipts" (comprobantes). Ruta: <user_id>/<archivo>
-- =====================================================================
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists receipts_insert_own on storage.objects;
create policy receipts_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists receipts_select on storage.objects;
create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- =====================================================================
-- Vistas para el dashboard (security_invoker => respetan RLS del usuario)
-- =====================================================================
create or replace view public.weekly_km with (security_invoker = true) as
  select user_id, discipline, date_trunc('week', performed_on)::date as week_start,
         sum(distance_km) as km, count(*) as sessions
  from public.activities group by 1,2,3;

-- =====================================================================
-- DESPUÉS de crear tu usuario en Auth > Users, hazte admin:
--   update public.profiles set role='admin' where id = '<TU-UUID>';
-- =====================================================================

===FIN SQL===
