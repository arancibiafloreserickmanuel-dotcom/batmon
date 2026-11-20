-- Fotos/videos de perfil publicables u ocultos, privacidad del perfil y datos para ver el perfil de otro socio.

-- 1) Medios: publicados (visibles para amigos) u ocultos (solo tú). Los existentes siguen publicados.
alter table public.profile_posts add column if not exists published boolean not null default true;
alter table public.profile_posts add column if not exists source text not null default 'manual' check (source in ('manual', 'session'));
alter table public.profile_posts add column if not exists session_kind text check (session_kind is null or session_kind in ('running', 'cycling', 'swimming', 'plyo', 'training'));
alter table public.profile_posts add column if not exists session_ref uuid;
-- Cómo se ve la foto en el perfil (estilo Instagram): filtro y formato.
alter table public.profile_posts add column if not exists look text not null default 'orig' check (look in ('orig', 'bn', 'calido', 'suave', 'contraste'));
alter table public.profile_posts add column if not exists aspect text not null default 'sq' check (aspect in ('sq', 'port'));

-- 2) Privacidad: qué ven tus amigos de tu perfil (fotos y videos visibles por defecto; progreso y logros, no).
alter table public.profiles add column if not exists profile_privacy jsonb not null default '{"photos":true,"videos":true,"progress":false,"logros":false}'::jsonb;

create or replace function public.set_profile_privacy(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  update public.profiles set profile_privacy = jsonb_build_object(
    'photos',   coalesce((p->>'photos')::boolean, true),
    'videos',   coalesce((p->>'videos')::boolean, true),
    'progress', coalesce((p->>'progress')::boolean, false),
    'logros',   coalesce((p->>'logros')::boolean, false)
  ) where id = auth.uid();
end $$;
revoke all on function public.set_profile_privacy(jsonb) from public, anon;
grant execute on function public.set_profile_privacy(jsonb) to authenticated;

-- 3) Ayudas.
create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friendships f where f.status = 'accepted'
    and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a)));
$$;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

create or replace function public.can_see_post(p_owner uuid, p_type text, p_visibility text, p_published boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select p_owner = auth.uid() or (
    p_published
    and public.are_friends(auth.uid(), p_owner)
    and (p_visibility = 'friends' or public.is_close_friend_of(p_owner))
    and coalesce((select (profile_privacy ->> (case when p_type = 'video' then 'videos' else 'photos' end))::boolean from public.profiles where id = p_owner), true)
  );
$$;
grant execute on function public.can_see_post(uuid, text, text, boolean) to authenticated;

-- 4) Lectura y edición de medios.
drop policy if exists profile_posts_read on public.profile_posts;
create policy profile_posts_read on public.profile_posts for select to authenticated
  using (public.can_see_post(user_id, media_type, visibility, published));
drop policy if exists profile_posts_update on public.profile_posts;
create policy profile_posts_update on public.profile_posts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant update on public.profile_posts to authenticated;

-- 5) Perfil de otro socio (tipo Instagram): datos básicos, contadores y permisos.
create or replace function public.public_profile(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'avatar_path', p.avatar_path, 'avatar_url', p.avatar_url, 'rank_name', p.rank_name,
    'privacy', p.profile_privacy,
    'is_friend', (p.id = auth.uid() or public.are_friends(auth.uid(), p.id)),
    'friends', (select count(*) from public.friendships f where f.status = 'accepted' and (f.requester = p.id or f.addressee = p.id)),
    'posts', (select count(*) from public.profile_posts x where x.user_id = p.id and public.can_see_post(x.user_id, x.media_type, x.visibility, x.published))
  ) from public.profiles p where p.id = p_user;
$$;
revoke all on function public.public_profile(uuid) from public, anon;
grant execute on function public.public_profile(uuid) to authenticated;

-- Progreso y logros de un amigo, solo si te dio permiso (o son los tuyos).
create or replace function public.profile_stats(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare priv jsonb; me uuid := auth.uid(); can_p boolean := false; can_l boolean := false;
begin
  if me is null then return null; end if;
  select profile_privacy into priv from public.profiles where id = p_user;
  if p_user = me then can_p := true; can_l := true;
  elsif public.are_friends(me, p_user) then
    can_p := coalesce((priv ->> 'progress')::boolean, false);
    can_l := coalesce((priv ->> 'logros')::boolean, false);
  else return null;
  end if;
  if not (can_p or can_l) then return jsonb_build_object('progress', false, 'logros', false); end if;
  return jsonb_build_object(
    'progress', can_p, 'logros', can_l,
    'activities', (select coalesce(jsonb_agg(jsonb_build_object('discipline', a.discipline, 'distance_km', a.distance_km, 'duration_min', a.duration_min, 'performed_on', a.performed_on)), '[]'::jsonb)
                   from (select discipline, distance_km, duration_min, performed_on from public.activities where user_id = p_user order by performed_on desc limit 400) a),
    'workouts', (select coalesce(jsonb_agg(jsonb_build_object('kind', w.kind, 'duration_min', w.duration_min, 'performed_on', w.performed_on)), '[]'::jsonb)
                 from (select kind, duration_min, performed_on from public.workouts where user_id = p_user order by performed_on desc limit 300) w),
    'shared', (select count(*) from public.shared_activities where user_id = p_user),
    'challenge_points', (select coalesce(sum(c.reward_logros), 0) from public.club_challenges c
                         join lateral public.club_challenge_leaderboard(c.id) l on l.user_id = p_user where l.completed)
  );
end $$;
revoke all on function public.profile_stats(uuid) from public, anon;
grant execute on function public.profile_stats(uuid) to authenticated;
