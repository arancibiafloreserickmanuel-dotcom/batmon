-- =====================================================================
-- 0002 — Pliometría + running ampliado + herramientas de admin
-- Requiere haber ejecutado supabase/schema.sql (0001). Idempotente.
-- El catálogo de ejercicios (61 de pliometría) se importa desde el panel
-- admin (botón "Importar catálogo base"), no desde SQL.
-- =====================================================================

-- ---------- RUNNING: más datos por salida ----------
alter table public.activities add column if not exists run_type text
  check (run_type in ('easy','long','tempo','intervals','race','recovery'));
alter table public.activities add column if not exists rpe smallint check (rpe between 1 and 10);
alter table public.activities add column if not exists elevation_m integer check (elevation_m >= 0);

-- admin puede corregir/borrar actividades de cualquiera
drop policy if exists activities_admin_update on public.activities;
create policy activities_admin_update on public.activities for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists activities_admin_delete on public.activities;
create policy activities_admin_delete on public.activities for delete to authenticated
  using (public.is_admin());

-- ---------- CATÁLOGO DE EJERCICIOS ----------
create table if not exists public.exercises (
  id                text primary key,                 -- slug del dataset o 'custom-<uuid>'
  name              text not null,
  name_es           text,                             -- traducción (pendiente de completar)
  category          text not null default 'plyometrics',
  level             text,
  equipment         text,
  primary_muscles   text[] not null default '{}',
  secondary_muscles text[] not null default '{}',
  instructions      text[] not null default '{}',
  images            text[] not null default '{}',     -- rutas relativas: /exercises/<imagen>
  source            text not null default 'custom' check (source in ('dataset','custom')),
  created_by        uuid references public.profiles(id) on delete set null default auth.uid(),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);
create index if not exists exercises_category_idx on public.exercises (category, is_active);

alter table public.exercises enable row level security;
drop policy if exists exercises_select on public.exercises;
create policy exercises_select on public.exercises for select to authenticated
  using (is_active or public.is_admin());
drop policy if exists exercises_insert on public.exercises;
create policy exercises_insert on public.exercises for insert to authenticated
  with check (public.is_admin() or (source = 'custom' and created_by = auth.uid()));
drop policy if exists exercises_update on public.exercises;
create policy exercises_update on public.exercises for update to authenticated
  using (public.is_admin() or (source = 'custom' and created_by = auth.uid()))
  with check (public.is_admin() or (source = 'custom' and created_by = auth.uid()));
drop policy if exists exercises_delete on public.exercises;
create policy exercises_delete on public.exercises for delete to authenticated
  using (public.is_admin() or (source = 'custom' and created_by = auth.uid()));

-- ---------- ENTRENAMIENTOS (sesión) + SERIES ----------
create table if not exists public.workouts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  kind         text not null default 'plyometrics' check (kind in ('plyometrics')), -- ampliable (fuerza, etc.)
  performed_on date not null default current_date,
  duration_min numeric(6,1) check (duration_min > 0 and duration_min < 1000),
  rpe          smallint check (rpe between 1 and 10),
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists workouts_user_date_idx on public.workouts (user_id, performed_on desc);

create table if not exists public.workout_sets (
  id            uuid primary key default gen_random_uuid(),
  workout_id    uuid not null references public.workouts(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  exercise_id   text not null references public.exercises(id) on delete restrict,
  position      smallint not null default 0,          -- orden del ejercicio dentro de la sesión
  set_no        smallint not null default 1,          -- nº de serie
  reps          integer check (reps > 0 and reps < 1000),
  contacts      integer check (contacts >= 0),         -- contactos con el suelo
  height_cm     numeric(5,1) check (height_cm >= 0),   -- altura de salto alcanzada
  box_height_cm numeric(5,1) check (box_height_cm >= 0),
  distance_m    numeric(6,2) check (distance_m >= 0),  -- saltos horizontales / bounds
  weight_kg     numeric(6,1) check (weight_kg >= 0),   -- balón medicinal, chaleco, mancuerna
  rest_sec      integer check (rest_sec >= 0),
  duration_sec  integer check (duration_sec >= 0),
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists workout_sets_workout_idx on public.workout_sets (workout_id, position, set_no);
create index if not exists workout_sets_user_ex_idx on public.workout_sets (user_id, exercise_id);

alter table public.workouts     enable row level security;
alter table public.workout_sets enable row level security;

drop policy if exists workouts_select on public.workouts;
create policy workouts_select on public.workouts for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists workouts_insert on public.workouts;
create policy workouts_insert on public.workouts for insert to authenticated with check (user_id = auth.uid());
drop policy if exists workouts_update on public.workouts;
create policy workouts_update on public.workouts for update to authenticated
  using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
drop policy if exists workouts_delete on public.workouts;
create policy workouts_delete on public.workouts for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists sets_select on public.workout_sets;
create policy sets_select on public.workout_sets for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists sets_insert on public.workout_sets;
create policy sets_insert on public.workout_sets for insert to authenticated
  with check (user_id = auth.uid()
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid()));
drop policy if exists sets_update on public.workout_sets;
create policy sets_update on public.workout_sets for update to authenticated
  using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
drop policy if exists sets_delete on public.workout_sets;
create policy sets_delete on public.workout_sets for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------- ADMIN: gestión de socios y pagos ----------
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());      -- (grant de columna: solo full_name)
drop policy if exists memberships_admin_delete on public.memberships;
create policy memberships_admin_delete on public.memberships for delete to authenticated
  using (public.is_admin());

-- Resumen por socio para el panel admin (incluye correo, que no está en profiles)
create or replace function public.admin_member_overview()
returns table (id uuid, full_name text, email text, role text, created_at timestamptz,
               total_km numeric, last_activity date, plyo_sessions bigint, membership public.membership_status)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'solo admin'; end if;
  return query
  select p.id, p.full_name, u.email::text, p.role, p.created_at,
         coalesce((select sum(a.distance_km) from public.activities a where a.user_id = p.id), 0),
         (select max(a.performed_on) from public.activities a where a.user_id = p.id),
         (select count(*) from public.workouts w where w.user_id = p.id),
         (select m.status from public.memberships m where m.user_id = p.id
            and m.period = date_trunc('month', current_date)::date order by m.created_at desc limit 1)
  from public.profiles p join auth.users u on u.id = p.id
  order by p.created_at;
end $$;
revoke all on function public.admin_member_overview() from public, anon;
grant execute on function public.admin_member_overview() to authenticated;

create or replace function public.admin_set_role(target uuid, new_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'solo admin'; end if;
  if new_role not in ('member','admin') then raise exception 'rol invalido'; end if;
  if target = auth.uid() then raise exception 'no puedes cambiar tu propio rol'; end if;
  update public.profiles set role = new_role where id = target;
end $$;
revoke all on function public.admin_set_role(uuid, text) from public, anon;
grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- Borra al socio y TODOS sus datos (cascada desde auth.users)
create or replace function public.admin_delete_user(target uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'solo admin'; end if;
  if target = auth.uid() then raise exception 'no puedes borrarte a ti mismo'; end if;
  delete from auth.users where id = target;
end $$;
revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;
