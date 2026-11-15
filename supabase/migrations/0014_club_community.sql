-- Comunidad: amplía las publicaciones existentes y añade comentarios/reacciones.
-- Las publicaciones solo son visibles para su autor y sus amistades aceptadas.

alter table public.profile_posts
  drop constraint if exists profile_posts_module_key_check;
alter table public.profile_posts
  add constraint profile_posts_module_key_check
  check (module_key in ('running','cycling','plyo','training','swimming'));

create table if not exists public.post_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.profile_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  constraint post_reactions_one_per_user unique(post_id,user_id)
);
create index if not exists post_reactions_post_idx on public.post_reactions(post_id);
alter table public.post_reactions enable row level security;
drop policy if exists post_reactions_read_visible on public.post_reactions;
create policy post_reactions_read_visible on public.post_reactions for select to authenticated using (
  exists (select 1 from public.profile_posts p where p.id=post_id)
);
drop policy if exists post_reactions_insert_visible on public.post_reactions;
create policy post_reactions_insert_visible on public.post_reactions for insert to authenticated with check (
  user_id=auth.uid() and exists (select 1 from public.profile_posts p where p.id=post_id)
);
drop policy if exists post_reactions_delete_own on public.post_reactions;
create policy post_reactions_delete_own on public.post_reactions for delete to authenticated using (user_id=auth.uid());
grant select,insert,delete on public.post_reactions to authenticated;

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.profile_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body text not null check (length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists post_comments_post_date_idx on public.post_comments(post_id,created_at);
alter table public.post_comments enable row level security;
drop policy if exists post_comments_read_visible on public.post_comments;
create policy post_comments_read_visible on public.post_comments for select to authenticated using (
  exists (select 1 from public.profile_posts p where p.id=post_id)
);
drop policy if exists post_comments_insert_visible on public.post_comments;
create policy post_comments_insert_visible on public.post_comments for insert to authenticated with check (
  user_id=auth.uid() and exists (select 1 from public.profile_posts p where p.id=post_id)
);
drop policy if exists post_comments_delete_own on public.post_comments;
create policy post_comments_delete_own on public.post_comments for delete to authenticated using (
  user_id=auth.uid() or public.is_admin()
);
grant select,insert,delete on public.post_comments to authenticated;
