-- 0011 — Datos de cuenta editables por el propio usuario (admin incluido),
-- primer ingreso con Google y borrado total sin restos de datos.

-- 1) Un usuario completa/edita SUS datos. Sin SMS ni OTP: el teléfono es solo para recuperar la contraseña.
create or replace function public.update_my_account(
  p_full_name text, p_username text, p_carnet_number text, p_recovery_phone text, p_contact_email text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_name text := trim(coalesce(p_full_name, ''));
  v_user text := lower(trim(coalesce(p_username, '')));
  v_carnet text := upper(trim(coalesce(p_carnet_number, '')));
  v_phone text := regexp_replace(coalesce(p_recovery_phone, ''), '\D', '', 'g');
  v_mail text := nullif(lower(trim(coalesce(p_contact_email, ''))), '');
begin
  if uid is null then raise exception 'Debes iniciar sesión.'; end if;
  if length(v_name) not between 2 and 100 then raise exception 'Escribe tu nombre completo.'; end if;
  if v_user !~ '^[a-z0-9_.-]{3,24}$' then raise exception 'El usuario debe tener entre 3 y 24 caracteres: letras, números, punto, guion o guion bajo.'; end if;
  if length(v_carnet) not between 3 and 32 then raise exception 'Revisa el número de carnet.'; end if;
  if v_phone !~ '^\d{8}$' then raise exception 'El teléfono debe tener exactamente 8 dígitos.'; end if;
  if v_mail is not null and v_mail !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Escribe un correo válido o deja el campo vacío.'; end if;

  update public.profiles
     set full_name = v_name, username = v_user, carnet_number = v_carnet,
         recovery_phone = v_phone, contact_email = v_mail
   where id = uid;
  if not found then raise exception 'No existe tu perfil.'; end if;
exception when unique_violation then
  raise exception 'Ese usuario, carnet o teléfono ya pertenece a otra cuenta.';
end $$;
revoke all on function public.update_my_account(text, text, text, text, text) from public, anon;
grant execute on function public.update_my_account(text, text, text, text, text) to authenticated;

-- 2) Borrado total. approved_by bloqueaba borrar a un admin que hubiera aprobado pagos.
alter table public.memberships drop constraint if exists memberships_approved_by_fkey;
alter table public.memberships add constraint memberships_approved_by_fkey
  foreign key (approved_by) references public.profiles(id) on delete set null;

-- 3) El admin puede borrar los archivos de un socio eliminado (se llama desde el panel antes del RPC).
drop policy if exists receipts_admin_delete on storage.objects;
create policy receipts_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.is_admin());
drop policy if exists profile_media_admin_read on storage.objects;
create policy profile_media_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'profile-media' and public.is_admin());
drop policy if exists profile_media_admin_delete on storage.objects;
create policy profile_media_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'profile-media' and public.is_admin());

-- 4) admin_delete_user: borra sesiones, ejercicios propios sin uso ajeno y la cuenta (cascada al resto).
create or replace function public.admin_delete_user(target uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'solo admin'; end if;
  if target = auth.uid() then raise exception 'no puedes borrarte a ti mismo'; end if;
  if (select role from public.profiles where id = target) = 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'no puedes borrar al único administrador';
  end if;
  delete from public.workouts where user_id = target;  -- cascada a workout_sets
  delete from public.exercises e
   where e.created_by = target and e.source = 'custom'
     and not exists (select 1 from public.workout_sets s where s.exercise_id = e.id);
  delete from auth.users where id = target;            -- cascada: perfil, actividades, pagos, amistades, posts, medidas...
end $$;
revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;
