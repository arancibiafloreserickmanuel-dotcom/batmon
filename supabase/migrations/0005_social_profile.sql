-- Perfil social: avatar, amistades, publicaciones y medidas físicas.
alter table public.profiles add column if not exists avatar_path text;
grant update (full_name, avatar_path) on public.profiles to authenticated;

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references public.profiles(id) on delete cascade,
  addressee uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  unique(requester, addressee), check (requester <> addressee)
);
alter table public.friendships enable row level security;
drop policy if exists friendships_read on public.friendships;
create policy friendships_read on public.friendships for select to authenticated using (requester=auth.uid() or addressee=auth.uid());
drop policy if exists friendships_request on public.friendships;
create policy friendships_request on public.friendships for insert to authenticated with check (requester=auth.uid() and status='pending');
drop policy if exists friendships_accept on public.friendships;
create policy friendships_accept on public.friendships for update to authenticated using (addressee=auth.uid()) with check (addressee=auth.uid());
drop policy if exists friendships_remove on public.friendships;
create policy friendships_remove on public.friendships for delete to authenticated using (requester=auth.uid() or addressee=auth.uid());
grant select,insert,update,delete on public.friendships to authenticated;

create table if not exists public.profile_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  module_key text not null check (module_key in ('running','plyo','training','swimming')),
  media_path text not null,
  media_type text not null check (media_type in ('image','video')),
  caption text not null default '',
  created_at timestamptz not null default now()
);
alter table public.profile_posts enable row level security;
drop policy if exists profile_posts_read on public.profile_posts;
create policy profile_posts_read on public.profile_posts for select to authenticated using (
 user_id=auth.uid() or exists(select 1 from public.friendships f where f.status='accepted'
 and ((f.requester=auth.uid() and f.addressee=user_id) or (f.addressee=auth.uid() and f.requester=user_id)))
);
drop policy if exists profile_posts_insert on public.profile_posts;
create policy profile_posts_insert on public.profile_posts for insert to authenticated with check (user_id=auth.uid());
drop policy if exists profile_posts_delete on public.profile_posts;
create policy profile_posts_delete on public.profile_posts for delete to authenticated using (user_id=auth.uid());
grant select,insert,delete on public.profile_posts to authenticated;

create table if not exists public.body_measurements (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
 measured_on date not null default current_date,
 weight_kg numeric(5,2) check(weight_kg between 20 and 400),
 height_cm numeric(5,1) check(height_cm between 80 and 250),
 body_fat_pct numeric(4,1) check(body_fat_pct between 1 and 80),
 waist_cm numeric(5,1), chest_cm numeric(5,1), hips_cm numeric(5,1),
 created_at timestamptz not null default now()
);
alter table public.body_measurements enable row level security;
drop policy if exists body_measurements_own on public.body_measurements;
create policy body_measurements_own on public.body_measurements for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select,insert,update,delete on public.body_measurements to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-media','profile-media',false,52428800,array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime'])
on conflict(id) do nothing;
drop policy if exists profile_media_upload on storage.objects;
create policy profile_media_upload on storage.objects for insert to authenticated with check(bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists profile_media_read on storage.objects;
create policy profile_media_read on storage.objects for select to authenticated using(bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists profile_media_delete on storage.objects;
create policy profile_media_delete on storage.objects for delete to authenticated using(bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text);

create or replace function public.profile_directory()
returns table(id uuid, full_name text, avatar_path text)
language sql stable security definer set search_path=public as $$
 select p.id,p.full_name,p.avatar_path from public.profiles p where p.id<>auth.uid() order by p.full_name;
$$;
revoke all on function public.profile_directory() from public,anon;
grant execute on function public.profile_directory() to authenticated;

-- ---- Correcciones de seguridad/funcionalidad (revisión) ----
-- 1) El destinatario solo puede cambiar `status` (si pudiera editar requester,
--    se haría "amigo" de cualquiera y leería sus publicaciones).
revoke update on public.friendships from authenticated;
grant update (status) on public.friendships to authenticated;

-- 2) Los amigos aceptados pueden leer los archivos (avatar/fotos/videos) del otro;
--    sin esto las publicaciones de amigos no se podían ver.
drop policy if exists profile_media_read_friends on storage.objects;
create policy profile_media_read_friends on storage.objects for select to authenticated using (
  bucket_id='profile-media' and exists (
    select 1 from public.friendships f where f.status='accepted' and (
      (f.requester=auth.uid() and f.addressee::text=(storage.foldername(name))[1]) or
      (f.addressee=auth.uid() and f.requester::text=(storage.foldername(name))[1])
    )
  )
);
