-- Retos de comunidad con puntuaciones calculadas desde los registros reales.
create table if not exists public.club_challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 2 and 100),
  description text check (description is null or length(description)<=500),
  discipline text not null check (discipline in ('running','cycling','swimming','plyo','training')),
  metric text not null check (metric in ('distance_km','sessions')),
  goal_value numeric(10,2) not null check (goal_value>0),
  starts_on date not null,
  ends_on date not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint club_challenges_date_order check (ends_on>=starts_on),
  constraint club_challenges_metric_for_discipline check (
    discipline in ('running','cycling','swimming') or metric='sessions'
  )
);
create index if not exists club_challenges_dates_idx on public.club_challenges(starts_on,ends_on);
alter table public.club_challenges enable row level security;
drop policy if exists club_challenges_read on public.club_challenges;
create policy club_challenges_read on public.club_challenges for select to authenticated using (true);
drop policy if exists club_challenges_admin_insert on public.club_challenges;
create policy club_challenges_admin_insert on public.club_challenges for insert to authenticated with check (public.is_admin());
drop policy if exists club_challenges_admin_update on public.club_challenges;
create policy club_challenges_admin_update on public.club_challenges for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists club_challenges_admin_delete on public.club_challenges;
create policy club_challenges_admin_delete on public.club_challenges for delete to authenticated using (public.is_admin());
grant select,insert,update,delete on public.club_challenges to authenticated;

create table if not exists public.challenge_participants (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.club_challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  joined_at timestamptz not null default now(),
  constraint challenge_participants_unique unique(challenge_id,user_id)
);
create index if not exists challenge_participants_challenge_idx on public.challenge_participants(challenge_id);
alter table public.challenge_participants enable row level security;
drop policy if exists challenge_participants_read on public.challenge_participants;
create policy challenge_participants_read on public.challenge_participants for select to authenticated using (true);
drop policy if exists challenge_participants_join on public.challenge_participants;
create policy challenge_participants_join on public.challenge_participants for insert to authenticated with check (
  user_id=auth.uid() and exists (select 1 from public.club_challenges c where c.id=challenge_id and c.ends_on>=current_date)
);
drop policy if exists challenge_participants_leave on public.challenge_participants;
create policy challenge_participants_leave on public.challenge_participants for delete to authenticated using (user_id=auth.uid() or public.is_admin());
grant select,insert,delete on public.challenge_participants to authenticated;

create or replace function public.club_challenge_leaderboard(p_challenge_id uuid)
returns table(challenge_id uuid,user_id uuid,full_name text,score numeric,goal_value numeric,completed boolean)
language sql stable security definer set search_path=public as $$
  select c.id, cp.user_id, p.full_name,
    case
      when c.metric='distance_km' then coalesce((
        select sum(a.distance_km)::numeric from public.activities a
        where a.user_id=cp.user_id and a.discipline::text=c.discipline
          and a.performed_on between c.starts_on and c.ends_on
      ),0)
      when c.discipline in ('running','cycling','swimming') then (
        select count(*)::numeric from public.activities a
        where a.user_id=cp.user_id and a.discipline::text=c.discipline
          and a.performed_on between c.starts_on and c.ends_on
      )
      when c.discipline='plyo' then (
        select count(*)::numeric from public.workouts w
        where w.user_id=cp.user_id and w.kind='plyometrics'
          and w.performed_on between c.starts_on and c.ends_on
      )
      else (
        select count(*)::numeric from public.workouts w
        where w.user_id=cp.user_id and w.kind='training'
          and w.performed_on between c.starts_on and c.ends_on
      )
    end as score,
    c.goal_value,
    case
      when c.metric='distance_km' then coalesce((
        select sum(a.distance_km)::numeric from public.activities a
        where a.user_id=cp.user_id and a.discipline::text=c.discipline
          and a.performed_on between c.starts_on and c.ends_on
      ),0)>=c.goal_value
      when c.discipline in ('running','cycling','swimming') then (
        select count(*)::numeric from public.activities a
        where a.user_id=cp.user_id and a.discipline::text=c.discipline
          and a.performed_on between c.starts_on and c.ends_on
      )>=c.goal_value
      when c.discipline='plyo' then (
        select count(*)::numeric from public.workouts w
        where w.user_id=cp.user_id and w.kind='plyometrics'
          and w.performed_on between c.starts_on and c.ends_on
      )>=c.goal_value
      else (
        select count(*)::numeric from public.workouts w
        where w.user_id=cp.user_id and w.kind='training'
          and w.performed_on between c.starts_on and c.ends_on
      )>=c.goal_value
    end as completed
  from public.club_challenges c
  join public.challenge_participants cp on cp.challenge_id=c.id
  join public.profiles p on p.id=cp.user_id
  where c.id=p_challenge_id and auth.uid() is not null
  order by score desc,p.full_name asc
$$;
revoke all on function public.club_challenge_leaderboard(uuid) from public,anon;
grant execute on function public.club_challenge_leaderboard(uuid) to authenticated;
