-- Mejores amigos (visibilidad) y foto de la cuenta de Google.

-- 1) Foto de Google: se guarda la URL de la cuenta para que también la vean los demás socios.
alter table public.profiles add column if not exists avatar_url text;
grant update (avatar_url) on public.profiles to authenticated;

drop function if exists public.profile_directory();
create or replace function public.profile_directory()
returns table(id uuid, full_name text, avatar_path text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.avatar_path, p.avatar_url from public.profiles p where p.id <> auth.uid() order by p.full_name;
$$;
revoke all on function public.profile_directory() from public, anon;
grant execute on function public.profile_directory() to authenticated;

-- 2) Mejores amigos: cada socio marca a quién de sus amigos incluye. Solo el dueño ve su lista.
create table if not exists public.close_friends (
  owner uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  friend uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner, friend),
  constraint close_friends_not_self check (owner <> friend)
);
alter table public.close_friends enable row level security;
drop policy if exists close_friends_own on public.close_friends;
create policy close_friends_own on public.close_friends for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
grant select, insert, delete on public.close_friends to authenticated;

-- Función para las políticas: ¿el usuario actual es mejor amigo de `p_owner`?
create or replace function public.is_close_friend_of(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.close_friends c where c.owner = p_owner and c.friend = auth.uid());
$$;
revoke all on function public.is_close_friend_of(uuid) from public, anon;
grant execute on function public.is_close_friend_of(uuid) to authenticated;

-- 3) Visibilidad de publicaciones del muro y de actividades compartidas.
alter table public.profile_posts add column if not exists visibility text not null default 'friends'
  check (visibility in ('friends', 'close'));
alter table public.shared_activities add column if not exists visibility text not null default 'friends'
  check (visibility in ('friends', 'close'));

drop policy if exists profile_posts_read on public.profile_posts;
create policy profile_posts_read on public.profile_posts for select to authenticated using (
  user_id = auth.uid() or (
    exists (select 1 from public.friendships f where f.status = 'accepted'
      and ((f.requester = auth.uid() and f.addressee = user_id) or (f.addressee = auth.uid() and f.requester = user_id)))
    and (visibility = 'friends' or public.is_close_friend_of(user_id))
  )
);

drop policy if exists shared_activities_read on public.shared_activities;
create policy shared_activities_read on public.shared_activities for select to authenticated using (
  user_id = auth.uid() or (
    exists (select 1 from public.friendships f where f.status = 'accepted'
      and ((f.requester = auth.uid() and f.addressee = user_id) or (f.addressee = auth.uid() and f.requester = user_id)))
    and (visibility = 'friends' or public.is_close_friend_of(user_id))
  )
);
