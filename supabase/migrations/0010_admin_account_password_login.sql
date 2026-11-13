-- Permite que una cuenta existente autenticada (por ejemplo, Google) asigne
-- su primer nombre de usuario. La contraseña se cambia con Auth desde el cliente.
create or replace function public.set_my_login_username(p_username text)
returns void language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  normalized_username text := lower(trim(p_username));
begin
  if current_user_id is null then raise exception 'Debes iniciar sesión.'; end if;
  if normalized_username is null or normalized_username !~ '^[a-z0-9_.-]{3,24}$' then
    raise exception 'El usuario debe tener entre 3 y 24 caracteres: letras, números, punto, guion o guion bajo.';
  end if;

  update public.profiles
  set username = normalized_username
  where id = current_user_id
    and (username is null or username = normalized_username);
  if not found then raise exception 'Ese usuario ya está ocupado o no se puede cambiar.'; end if;
exception
  when unique_violation then raise exception 'Ese usuario ya está ocupado. Elige otro.';
end $$;

revoke all on function public.set_my_login_username(text) from public, anon;
grant execute on function public.set_my_login_username(text) to authenticated;
