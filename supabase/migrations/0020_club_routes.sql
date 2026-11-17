-- =====================================================================
-- 0020 — Rutas del club: rutas oficiales (admin) y rutas compartidas por socios.
-- Tabla nueva; no modifica ninguna tabla ni política existente.
-- =====================================================================

create table if not exists public.club_routes (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  author_name      text check (author_name is null or length(author_name) <= 80),
  name             text not null check (length(trim(name)) between 1 and 80),
  description      text check (description is null or length(description) <= 500),
  difficulty       text not null default 'moderada' check (difficulty in ('facil','moderada','dificil')),
  surface          text not null default 'asfalto' check (surface in ('asfalto','tierra','pista','montana','mixta')),
  distance_km      numeric(7,2) not null check (distance_km >= 0 and distance_km <= 1000),
  elevation_gain_m integer check (elevation_gain_m is null or (elevation_gain_m >= 0 and elevation_gain_m <= 10000)),
  -- Puntos de la ruta como [[lat, lon], ...]
  points           jsonb not null check (
                     jsonb_typeof(points) = 'array'
                     and jsonb_array_length(points) between 2 and 5000
                     and pg_column_size(points) <= 400000),
  is_official      boolean not null default false,
  shared           boolean not null default true,
  created_at       timestamptz not null default now()
);
create index if not exists club_routes_created_idx on public.club_routes(created_at desc);
create index if not exists club_routes_user_idx on public.club_routes(user_id);
alter table public.club_routes enable row level security;

-- Ven la ruta: todos los socios si está compartida, su autora/autor y el admin.
drop policy if exists club_routes_select on public.club_routes;
create policy club_routes_select on public.club_routes for select to authenticated
  using (shared or user_id = auth.uid() or public.is_admin());

-- Crea cada socio las suyas; solo el admin puede marcarlas como oficiales.
drop policy if exists club_routes_insert on public.club_routes;
create policy club_routes_insert on public.club_routes for insert to authenticated
  with check (user_id = auth.uid() and (is_official = false or public.is_admin()));

drop policy if exists club_routes_update on public.club_routes;
create policy club_routes_update on public.club_routes for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check ((user_id = auth.uid() and is_official = false) or public.is_admin());

drop policy if exists club_routes_delete on public.club_routes;
create policy club_routes_delete on public.club_routes for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

grant select, insert, update, delete on public.club_routes to authenticated;
revoke all on public.club_routes from anon;
