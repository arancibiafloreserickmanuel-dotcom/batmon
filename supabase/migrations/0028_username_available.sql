-- ¿Está libre este nombre de usuario? Se usa en el registro para avisar "Ese nombre ya existe" antes de enviar el formulario.
create or replace function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.profiles
    where lower(username) = lower(trim(coalesce(p_username, '')))
      and id is distinct from auth.uid()
  );
$$;
revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
