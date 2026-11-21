-- Clientes (member), Socios (socio: personal con permisos limitados) y Administrador (admin: dueño).
-- + acceso sin pago por cliente + imágenes propias para ejercicios.

-- 1) Rol 'socio' y permisos por socio.
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%role%' loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.profiles add constraint profiles_role_check check (role in ('member', 'socio', 'admin'));
alter table public.profiles add column if not exists staff_permissions jsonb not null default '{}'::jsonb;
-- Acceso sin pago: el administrador puede dejar a un cliente usar la app aunque no haya pagado (con fecha opcional).
alter table public.profiles add column if not exists access_override boolean not null default false;
alter table public.profiles add column if not exists access_until date;

-- 2) ¿Quién es staff? admin y socio pasan las políticas "is_admin"; los permisos finos se aplican en el panel.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'socio'));
$$;
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- 3) Solo el administrador sube a un cliente a socio (o lo baja), y fija sus permisos.
create or replace function public.admin_set_role(target uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'solo el administrador'; end if;
  if new_role not in ('member', 'socio', 'admin') then raise exception 'rol invalido'; end if;
  if target = auth.uid() then raise exception 'no puedes cambiar tu propio rol'; end if;
  update public.profiles set role = new_role,
    staff_permissions = case when new_role = 'member' then '{}'::jsonb else staff_permissions end
  where id = target;
end $$;

create or replace function public.admin_set_permissions(target uuid, perms jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'solo el administrador'; end if;
  update public.profiles set staff_permissions = coalesce(perms, '{}'::jsonb) where id = target and role = 'socio';
end $$;
revoke all on function public.admin_set_permissions(uuid, jsonb) from public, anon;
grant execute on function public.admin_set_permissions(uuid, jsonb) to authenticated;

create or replace function public.admin_set_access(target uuid, p_override boolean, p_until date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'solo personal autorizado'; end if;
  update public.profiles set access_override = coalesce(p_override, false), access_until = p_until where id = target;
end $$;
revoke all on function public.admin_set_access(uuid, boolean, date) from public, anon;
grant execute on function public.admin_set_access(uuid, boolean, date) to authenticated;

-- 4) Resumen para el panel (con permisos y acceso).
drop function if exists public.admin_member_overview();
create or replace function public.admin_member_overview()
returns table (id uuid, full_name text, email text, role text, created_at timestamptz,
               total_km numeric, last_activity date, plyo_sessions bigint, membership public.membership_status,
               staff_permissions jsonb, access_override boolean, access_until date, username text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'solo admin'; end if;
  return query
  select p.id, p.full_name, u.email::text, p.role, p.created_at,
         coalesce((select sum(a.distance_km) from public.activities a where a.user_id = p.id), 0),
         (select max(a.performed_on) from public.activities a where a.user_id = p.id),
         (select count(*) from public.workouts w where w.user_id = p.id),
         (select m.status from public.memberships m where m.user_id = p.id
            and m.period = date_trunc('month', current_date)::date order by m.created_at desc limit 1),
         p.staff_permissions, p.access_override, p.access_until, p.username
  from public.profiles p join auth.users u on u.id = p.id
  order by p.created_at;
end $$;
revoke all on function public.admin_member_overview() from public, anon;
grant execute on function public.admin_member_overview() to authenticated;

-- 5) Borrar cuentas: un socio solo puede borrar clientes; al administrador solo lo borra otro administrador.
create or replace function public.admin_delete_user(target uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare r text;
begin
  if not public.is_admin() then raise exception 'solo admin'; end if;
  if target = auth.uid() then raise exception 'no puedes borrarte a ti mismo'; end if;
  select role into r from public.profiles where id = target;
  if r is distinct from 'member' and not public.is_owner() then raise exception 'solo el administrador puede borrar a un socio o administrador'; end if;
  delete from auth.users where id = target;
end $$;

-- 6) Imágenes de ejercicios propios.
insert into storage.buckets (id, name, public) values ('exercise-media', 'exercise-media', true)
on conflict (id) do update set public = true;
drop policy if exists exercise_media_read on storage.objects;
create policy exercise_media_read on storage.objects for select to authenticated, anon using (bucket_id = 'exercise-media');
drop policy if exists exercise_media_write on storage.objects;
create policy exercise_media_write on storage.objects for insert to authenticated with check (bucket_id = 'exercise-media' and public.is_admin());
drop policy if exists exercise_media_update on storage.objects;
create policy exercise_media_update on storage.objects for update to authenticated using (bucket_id = 'exercise-media' and public.is_admin()) with check (bucket_id = 'exercise-media' and public.is_admin());
drop policy if exists exercise_media_delete on storage.objects;
create policy exercise_media_delete on storage.objects for delete to authenticated using (bucket_id = 'exercise-media' and public.is_admin());
