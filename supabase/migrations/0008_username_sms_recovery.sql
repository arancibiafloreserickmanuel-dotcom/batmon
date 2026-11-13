-- Identidad de socio por nombre de usuario y carnet; el teléfono de Auth es
-- obligatorio para verificación SMS. El correo de contacto es opcional.
alter table public.profiles
  add column if not exists username text,
  add column if not exists carnet_number text,
  add column if not exists contact_email text;

do $$ begin
  alter table public.profiles add constraint profiles_username_format
    check (username is null or username ~ '^[a-z0-9_.-]{3,24}$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles add constraint profiles_carnet_length
    check (carnet_number is null or length(trim(carnet_number)) between 3 and 32);
exception when duplicate_object then null; end $$;

create unique index if not exists profiles_username_unique
  on public.profiles (lower(username)) where username is not null;
create unique index if not exists profiles_carnet_unique
  on public.profiles (upper(trim(carnet_number))) where carnet_number is not null;

-- Conserva el correo de las cuentas existentes como dato de contacto opcional.
update public.profiles p
set contact_email = u.email
from auth.users u
where u.id = p.id and p.contact_email is null and u.email is not null;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, username, carnet_number, contact_email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), nullif(split_part(coalesce(new.email, new.phone, ''), '@', 1), ''), 'Socio Batmon'),
    nullif(lower(trim(new.raw_user_meta_data->>'username')), ''),
    nullif(upper(trim(new.raw_user_meta_data->>'carnet_number')), ''),
    nullif(trim(new.raw_user_meta_data->>'contact_email'), '')
  );
  return new;
end $$;

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
  if current_user_id is null then
    raise exception 'Debes iniciar sesión.';
  end if;
  if normalized_username is null or normalized_username !~ '^[a-z0-9_.-]{3,24}$' then
    raise exception 'El usuario debe tener entre 3 y 24 caracteres: letras, números, punto, guion o guion bajo.';
  end if;
  if normalized_carnet is null or length(normalized_carnet) not between 3 and 32 then
    raise exception 'Revisa el número de carnet.';
  end if;
  if not exists (
    select 1 from auth.users
    where id = current_user_id and phone is not null and phone_confirmed_at is not null
  ) then
    raise exception 'Primero verifica tu teléfono por SMS.';
  end if;

  update public.profiles
  set username = coalesce(username, normalized_username),
      carnet_number = coalesce(carnet_number, normalized_carnet),
      contact_email = coalesce(nullif(trim(p_contact_email), ''), contact_email)
  where id = current_user_id
    and (username is null or username = normalized_username)
    and (carnet_number is null or carnet_number = normalized_carnet);

  if not found then
    raise exception 'El usuario o carnet ya está asociado a otra cuenta.';
  end if;
end $$;

revoke all on function public.complete_member_identity(text, text, text) from public, anon;
grant execute on function public.complete_member_identity(text, text, text) to authenticated;

-- Muestra el correo opcional de contacto en el panel admin cuando la cuenta
-- autentica con teléfono y auth.users.email queda vacío.
create or replace function public.admin_member_overview()
returns table (id uuid, full_name text, email text, role text, created_at timestamptz,
               total_km numeric, last_activity date, plyo_sessions bigint, membership public.membership_status)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'solo admin'; end if;
  return query
  select p.id, p.full_name, coalesce(u.email::text, p.contact_email, ''::text), p.role, p.created_at,
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
