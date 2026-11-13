-- Registro e inicio por usuario/contraseña sin depender del proveedor Phone Auth.
-- El teléfono se guarda como dato de recuperación en el perfil (8 dígitos).
alter table public.profiles
  add column if not exists recovery_phone text;

do $$ begin
  alter table public.profiles add constraint profiles_recovery_phone_format
    check (recovery_phone is null or recovery_phone ~ '^\d{8}$');
exception when duplicate_object then null; end $$;

-- Conserva los números de cuentas antiguas de Phone Auth cuando ya están en formato Bolivia.
with normalized as (
  select p.id,
         substring(regexp_replace(u.phone, '\D', '', 'g') from 4 for 8) as digits,
         row_number() over (
           partition by substring(regexp_replace(u.phone, '\D', '', 'g') from 4 for 8)
           order by p.created_at, p.id
         ) as number_rank
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.recovery_phone is null
    and regexp_replace(u.phone, '\D', '', 'g') ~ '^591\d{8}$'
)
update public.profiles p
set recovery_phone = n.digits
from normalized n
where n.id = p.id and n.number_rank = 1;

create unique index if not exists profiles_recovery_phone_unique
  on public.profiles (recovery_phone) where recovery_phone is not null;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, username, carnet_number, contact_email, recovery_phone)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), nullif(split_part(coalesce(new.email, new.phone, ''), '@', 1), ''), 'Socio Batmon'),
    nullif(lower(trim(new.raw_user_meta_data->>'username')), ''),
    nullif(upper(trim(new.raw_user_meta_data->>'carnet_number')), ''),
    nullif(trim(new.raw_user_meta_data->>'contact_email'), ''),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'recovery_phone', ''), '\D', '', 'g'), '')
  );
  return new;
end $$;

-- El RPC heredado de identidad ya no exige phone_confirmed_at ni un OTP.
create or replace function public.complete_member_identity(
  p_username text,
  p_carnet_number text,
  p_contact_email text default null
)
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  current_user_id uuid := auth.uid();
  normalized_username text := lower(trim(p_username));
  normalized_carnet text := upper(trim(p_carnet_number));
begin
  if current_user_id is null then raise exception 'Debes iniciar sesión.'; end if;
  if normalized_username is null or normalized_username !~ '^[a-z0-9_.-]{3,24}$' then
    raise exception 'El usuario debe tener entre 3 y 24 caracteres: letras, números, punto, guion o guion bajo.';
  end if;
  if normalized_carnet is null or length(normalized_carnet) not between 3 and 32 then
    raise exception 'Revisa el número de carnet.';
  end if;
  update public.profiles
  set username = coalesce(username, normalized_username),
      carnet_number = coalesce(carnet_number, normalized_carnet),
      contact_email = coalesce(nullif(trim(p_contact_email), ''), contact_email)
  where id = current_user_id
    and (username is null or username = normalized_username)
    and (carnet_number is null or carnet_number = normalized_carnet);
  if not found then raise exception 'El usuario o carnet ya está asociado a otra cuenta.'; end if;
end $$;

-- El email de Auth de las cuentas nuevas es solo un alias interno; mostrar únicamente
-- el correo real opcional guardado en el perfil al administrador.
create or replace function public.admin_member_overview()
returns table (id uuid, full_name text, email text, role text, created_at timestamptz,
               total_km numeric, last_activity date, plyo_sessions bigint, membership public.membership_status)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'solo admin'; end if;
  return query
  select p.id, p.full_name, coalesce(p.contact_email, ''::text), p.role, p.created_at,
         coalesce((select sum(a.distance_km) from public.activities a where a.user_id = p.id), 0),
         (select max(a.performed_on) from public.activities a where a.user_id = p.id),
         (select count(*) from public.workouts w where w.user_id = p.id),
         (select m.status from public.memberships m where m.user_id = p.id
            and m.period = date_trunc('month', current_date)::date order by m.created_at desc limit 1)
  from public.profiles p
  order by p.created_at;
end $$;
revoke all on function public.admin_member_overview() from public, anon;
grant execute on function public.admin_member_overview() to authenticated;
