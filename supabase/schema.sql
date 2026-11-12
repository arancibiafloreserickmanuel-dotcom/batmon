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
