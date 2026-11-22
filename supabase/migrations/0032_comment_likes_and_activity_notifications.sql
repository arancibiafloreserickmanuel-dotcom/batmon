-- Me gusta en comentarios + notificaciones de interacción (comentarios, me gusta, asistencia a eventos).
-- Todo es aditivo: no modifica datos existentes.

-- 1) Me gusta de comentarios (de actividades compartidas y de publicaciones del muro)
create table if not exists public.comment_likes (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('activity', 'post')),
  comment_id uuid not null,
  user_id    uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  constraint comment_likes_unique unique (kind, comment_id, user_id)
);
create index if not exists comment_likes_comment_idx on public.comment_likes (kind, comment_id);
alter table public.comment_likes enable row level security;

drop policy if exists comment_likes_read on public.comment_likes;
create policy comment_likes_read on public.comment_likes for select to authenticated using (
  (kind = 'activity' and exists (select 1 from public.activity_comments c where c.id = comment_id))
  or (kind = 'post' and exists (select 1 from public.post_comments c where c.id = comment_id))
);
drop policy if exists comment_likes_insert on public.comment_likes;
create policy comment_likes_insert on public.comment_likes for insert to authenticated with check (
  user_id = auth.uid() and (
    (kind = 'activity' and exists (select 1 from public.activity_comments c where c.id = comment_id))
    or (kind = 'post' and exists (select 1 from public.post_comments c where c.id = comment_id))
  )
);
drop policy if exists comment_likes_delete on public.comment_likes;
create policy comment_likes_delete on public.comment_likes for delete to authenticated using (user_id = auth.uid());
grant select, insert, delete on public.comment_likes to authenticated;

-- 2) Nuevos tipos de notificación
alter table public.user_notifications drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications add constraint user_notifications_kind_check check (kind in (
  'follow', 'profile_view', 'rank_up', 'challenge_done',
  'comment_like', 'activity_comment', 'post_comment', 'activity_like', 'post_like', 'event_going'
));

-- Ayuda interna: crea la notificación sin avisarte de tus propias acciones y sin repetir el mismo aviso en un día.
create or replace function public.push_notification(p_user uuid, p_actor uuid, p_kind text, p_ref uuid, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_actor is null or p_user = p_actor then return; end if;
  if exists (select 1 from public.user_notifications where user_id = p_user and actor_id = p_actor and kind = p_kind
             and ref_id is not distinct from p_ref and created_at > now() - interval '1 day') then return; end if;
  insert into public.user_notifications (user_id, actor_id, kind, ref_id, payload) values (p_user, p_actor, p_kind, p_ref, coalesce(p_payload, '{}'::jsonb));
end $$;
revoke all on function public.push_notification(uuid, uuid, text, uuid, jsonb) from public, anon, authenticated;

-- 3) Le dieron me gusta a tu comentario
create or replace function public.notify_on_comment_like() returns trigger
language plpgsql security definer set search_path = public as $$
declare author uuid; txt text; src uuid;
begin
  if new.kind = 'activity' then
    select c.user_id, c.body, c.activity_id into author, txt, src from public.activity_comments c where c.id = new.comment_id;
  else
    select c.user_id, c.body, c.post_id into author, txt, src from public.post_comments c where c.id = new.comment_id;
  end if;
  perform public.push_notification(author, new.user_id, 'comment_like', new.comment_id, jsonb_build_object('body', left(coalesce(txt, ''), 80), 'on', new.kind, 'target', src));
  return new;
end $$;
drop trigger if exists trg_notify_comment_like on public.comment_likes;
create trigger trg_notify_comment_like after insert on public.comment_likes for each row execute function public.notify_on_comment_like();

-- 4) Comentaron tu actividad compartida
create or replace function public.notify_on_activity_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid; ttl text;
begin
  select a.user_id, a.title into owner, ttl from public.shared_activities a where a.id = new.activity_id;
  perform public.push_notification(owner, new.user_id, 'activity_comment', new.activity_id, jsonb_build_object('body', left(new.body, 80), 'title', ttl));
  return new;
end $$;
drop trigger if exists trg_notify_activity_comment on public.activity_comments;
create trigger trg_notify_activity_comment after insert on public.activity_comments for each row execute function public.notify_on_activity_comment();

-- 5) Comentaron tu publicación del muro
create or replace function public.notify_on_post_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select p.user_id into owner from public.profile_posts p where p.id = new.post_id;
  perform public.push_notification(owner, new.user_id, 'post_comment', new.post_id, jsonb_build_object('body', left(new.body, 80)));
  return new;
end $$;
drop trigger if exists trg_notify_post_comment on public.post_comments;
create trigger trg_notify_post_comment after insert on public.post_comments for each row execute function public.notify_on_post_comment();

-- 6) Le dieron me gusta a tu actividad
create or replace function public.notify_on_activity_like() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid; ttl text;
begin
  select a.user_id, a.title into owner, ttl from public.shared_activities a where a.id = new.activity_id;
  perform public.push_notification(owner, new.user_id, 'activity_like', new.activity_id, jsonb_build_object('title', ttl));
  return new;
end $$;
drop trigger if exists trg_notify_activity_like on public.activity_likes;
create trigger trg_notify_activity_like after insert on public.activity_likes for each row execute function public.notify_on_activity_like();

-- 7) Le dieron me gusta a tu publicación
create or replace function public.notify_on_post_like() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select p.user_id into owner from public.profile_posts p where p.id = new.post_id;
  perform public.push_notification(owner, new.user_id, 'post_like', new.post_id, '{}'::jsonb);
  return new;
end $$;
drop trigger if exists trg_notify_post_like on public.post_reactions;
create trigger trg_notify_post_like after insert on public.post_reactions for each row execute function public.notify_on_post_like();

-- 8) Un amigo irá a un evento: se avisa a sus amigos (relaciones aceptadas)
create or replace function public.notify_on_event_going() returns trigger
language plpgsql security definer set search_path = public as $$
declare ttl text; friend uuid;
begin
  if new.status <> 'confirmed' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'confirmed' then return new; end if;
  select e.title into ttl from public.events e where e.id = new.event_id;
  for friend in
    select case when f.requester = new.user_id then f.addressee else f.requester end
    from public.friendships f where f.status = 'accepted' and (f.requester = new.user_id or f.addressee = new.user_id)
  loop
    perform public.push_notification(friend, new.user_id, 'event_going', new.event_id, jsonb_build_object('title', ttl));
  end loop;
  return new;
end $$;
drop trigger if exists trg_notify_event_going on public.event_rsvps;
create trigger trg_notify_event_going after insert or update of status on public.event_rsvps for each row execute function public.notify_on_event_going();
