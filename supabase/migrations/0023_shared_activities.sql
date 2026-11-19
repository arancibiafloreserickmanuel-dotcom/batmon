-- Actividades compartidas: tarjetas tipo feed (nombre, lugar, mapa), kudos y comentarios.
-- Nada se comparte solo: el socio lo activa al terminar su carrera o sesión.
-- Visibles para el autor y sus amistades aceptadas (igual que las publicaciones del muro).

create table if not exists public.shared_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('running','plyo','training','cycling','swimming')),
  source_id uuid,
  title text not null check (length(trim(title)) between 1 and 100),
  description text not null default '' check (length(description) <= 1000),
  place text check (place is null or length(place) <= 120),
  performed_on date not null default current_date,
  stats jsonb not null default '{}'::jsonb,
  route jsonb not null default '[]'::jsonb,
  photos text[] not null default '{}',
  effort smallint check (effort between 1 and 10),
  created_at timestamptz not null default now(),
  constraint shared_activities_sizes check (
    jsonb_typeof(stats) = 'object' and jsonb_typeof(route) = 'array'
    and pg_column_size(route) <= 300000 and pg_column_size(stats) <= 20000
    and cardinality(photos) <= 3
  ),
  constraint shared_activities_one_per_source unique (kind, source_id)
);
create index if not exists shared_activities_user_date_idx on public.shared_activities(user_id, created_at desc);
alter table public.shared_activities enable row level security;

drop policy if exists shared_activities_read on public.shared_activities;
create policy shared_activities_read on public.shared_activities for select to authenticated using (
  user_id = auth.uid() or exists (
    select 1 from public.friendships f where f.status = 'accepted' and (
      (f.requester = auth.uid() and f.addressee = user_id) or (f.addressee = auth.uid() and f.requester = user_id)
    )
  )
);
drop policy if exists shared_activities_insert on public.shared_activities;
create policy shared_activities_insert on public.shared_activities for insert to authenticated with check (user_id = auth.uid());
drop policy if exists shared_activities_update on public.shared_activities;
create policy shared_activities_update on public.shared_activities for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists shared_activities_delete on public.shared_activities;
create policy shared_activities_delete on public.shared_activities for delete to authenticated using (user_id = auth.uid() or public.is_admin());
grant select, insert, update, delete on public.shared_activities to authenticated;

create table if not exists public.activity_likes (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.shared_activities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  constraint activity_likes_one_per_user unique (activity_id, user_id)
);
create index if not exists activity_likes_activity_idx on public.activity_likes(activity_id);
alter table public.activity_likes enable row level security;
drop policy if exists activity_likes_read on public.activity_likes;
create policy activity_likes_read on public.activity_likes for select to authenticated using (
  exists (select 1 from public.shared_activities a where a.id = activity_id)
);
drop policy if exists activity_likes_insert on public.activity_likes;
create policy activity_likes_insert on public.activity_likes for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.shared_activities a where a.id = activity_id)
);
drop policy if exists activity_likes_delete on public.activity_likes;
create policy activity_likes_delete on public.activity_likes for delete to authenticated using (user_id = auth.uid());
grant select, insert, delete on public.activity_likes to authenticated;

create table if not exists public.activity_comments (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.shared_activities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body text not null check (length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists activity_comments_activity_idx on public.activity_comments(activity_id, created_at);
alter table public.activity_comments enable row level security;
drop policy if exists activity_comments_read on public.activity_comments;
create policy activity_comments_read on public.activity_comments for select to authenticated using (
  exists (select 1 from public.shared_activities a where a.id = activity_id)
);
drop policy if exists activity_comments_insert on public.activity_comments;
create policy activity_comments_insert on public.activity_comments for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.shared_activities a where a.id = activity_id)
);
drop policy if exists activity_comments_delete on public.activity_comments;
create policy activity_comments_delete on public.activity_comments for delete to authenticated using (user_id = auth.uid() or public.is_admin());
grant select, insert, delete on public.activity_comments to authenticated;
