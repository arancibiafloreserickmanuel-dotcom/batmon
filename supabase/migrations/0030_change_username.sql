-- Cambiar el nombre de usuario desde Editar perfil (único, sin importar mayúsculas).
create or replace function public.set_my_username(p_username text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := lower(trim(coalesce(p_username, '')));
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if v !~ '^[a-z0-9_.-]{3,24}$' then raise exception 'Usa de 3 a 24 caracteres: letras, números, punto, guion o guion bajo.'; end if;
  if exists (select 1 from public.profiles where lower(username) = v and id <> auth.uid()) then raise exception 'Ese nombre de usuario ya existe.'; end if;
  update public.profiles set username = v where id = auth.uid();
exception when unique_violation then
  raise exception 'Ese nombre de usuario ya existe.';
end $$;
revoke all on function public.set_my_username(text) from public, anon;
grant execute on function public.set_my_username(text) to authenticated;
