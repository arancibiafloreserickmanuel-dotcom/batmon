-- Notificaciones sociales (te siguió, vio tu perfil, subió de rango, completó un reto) y fotos de perfil visibles en Miembros.

-- 1) Tabla de notificaciones. Solo se crean desde triggers/funciones (no hay política de insert).
create table if not exists public.user_notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,     -- quien recibe
  actor_id   uuid references public.profiles(id) on delete cascade,              -- quien la provoca
  kind       text not null check (kind in ('follow', 'profile_view', 'rank_up', 'challenge_done')),
  ref_id     uuid,
  payload    jsonb not null default '{}'::jsonb,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists user_notifications_user_idx on public.user_notifications (user_id, is_read, created_at desc);
alter table public.user_notifications enable row level security;
drop policy if exists user_notifications_select on public.user_notifications;
create policy user_notifications_select on public.user_notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists user_notifications_update on public.user_notifications;
create policy user_notifications_update on public.user_notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists user_notifications_delete on public.user_notifications;
create policy user_notifications_delete on public.user_notifications for delete to authenticated using (user_id = auth.uid());
grant select, update, delete on public.user_notifications to authenticated;

-- 2) "Te comenzó a seguir": al crear la relación se avisa a la otra persona.
create or replace function public.notify_on_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.requester is distinct from new.addressee then
    insert into public.user_notifications (user_id, actor_id, kind, ref_id) values (new.addressee, new.requester, 'follow', new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_notify_on_follow on public.friendships;
create trigger trg_notify_on_follow after insert on public.friendships for each row execute function public.notify_on_follow();

-- 3) "Vio tu perfil": como máximo una vez al día por persona.
create or replace function public.notify_profile_view(p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_target is null or p_target = auth.uid() then return; end if;
  if exists (select 1 from public.user_notifications where user_id = p_target and actor_id = auth.uid() and kind = 'profile_view' and created_at > now() - interval '1 day') then return; end if;
  insert into public.user_notifications (user_id, actor_id, kind) values (p_target, auth.uid(), 'profile_view');
end $$;
revoke all on function public.notify_profile_view(uuid) from public, anon;
grant execute on function public.notify_profile_view(uuid) to authenticated;

-- 4) Rango: el cliente calcula el rango con los logros y lo reporta; si sube, se avisa a quienes te tienen en "mejores amigos".
alter table public.profiles add column if not exists rank_name text check (rank_name is null or length(rank_name) <= 30);
create or replace function public.report_rank(p_rank text) returns void
language plpgsql security definer set search_path = public as $$
declare old_rank text;
begin
  if auth.uid() is null or p_rank is null or length(p_rank) > 30 then return; end if;
  select rank_name into old_rank from public.profiles where id = auth.uid();
  if old_rank is not distinct from p_rank then return; end if;
  update public.profiles set rank_name = p_rank where id = auth.uid();
  if old_rank is not null then
    insert into public.user_notifications (user_id, actor_id, kind, payload)
    select c.owner, auth.uid(), 'rank_up', jsonb_build_object('rank', p_rank) from public.close_friends c where c.friend = auth.uid();
  end if;
end $$;
revoke all on function public.report_rank(text) from public, anon;
grant execute on function public.report_rank(text) to authenticated;

-- 5) Reto completado: se verifica con la clasificación real y se avisa una sola vez a tus mejores amigos.
create or replace function public.report_challenge_done(p_challenge uuid) returns void
language plpgsql security definer set search_path = public as $$
declare done boolean; ttl text;
begin
  if auth.uid() is null then return; end if;
  select l.completed into done from public.club_challenge_leaderboard(p_challenge) l where l.user_id = auth.uid();
  if not coalesce(done, false) then return; end if;
  if not exists (select 1 from public.club_challenges where id = p_challenge and ends_on >= current_date - 7) then return; end if;   -- solo retos recientes
  if exists (select 1 from public.user_notifications where actor_id = auth.uid() and kind = 'challenge_done' and ref_id = p_challenge) then return; end if;
  select title into ttl from public.club_challenges where id = p_challenge;
  insert into public.user_notifications (user_id, actor_id, kind, ref_id, payload)
  select c.owner, auth.uid(), 'challenge_done', p_challenge, jsonb_build_object('title', ttl) from public.close_friends c where c.friend = auth.uid();
end $$;
revoke all on function public.report_challenge_done(uuid) from public, anon;
grant execute on function public.report_challenge_done(uuid) to authenticated;

-- 6) Fotos de perfil (solo los archivos avatar-*) visibles para todos los socios: así se ven en Miembros.
drop policy if exists profile_media_avatars_read on storage.objects;
create policy profile_media_avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'profile-media' and name ~ '^[0-9a-fA-F-]{36}/avatar-[^/]+$');
