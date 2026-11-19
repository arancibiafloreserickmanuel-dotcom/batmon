-- Datos extra de los eventos, recompensa en logros de los retos y logros ganados por retos.

-- 1) Eventos: ficha técnica que se muestra en la página del evento.
alter table public.events
  add column if not exists category text check (category is null or length(category) <= 40),
  add column if not exists terrain text check (terrain is null or length(terrain) <= 40),
  add column if not exists price text check (price is null or length(price) <= 40),
  add column if not exists elevation text check (elevation is null or length(elevation) <= 40),
  add column if not exists temperature text check (temperature is null or length(temperature) <= 40),
  add column if not exists humidity text check (humidity is null or length(humidity) <= 40),
  add column if not exists wind text check (wind is null or length(wind) <= 40),
  add column if not exists more_info text check (more_info is null or length(more_info) <= 4000);

-- 2) Retos: cuántos logros da completarlos y una insignia corta (p. ej. "400'" o "10x").
alter table public.club_challenges
  add column if not exists reward_logros integer not null default 50 check (reward_logros between 0 and 5000),
  add column if not exists badge text check (badge is null or length(badge) <= 6);

-- 3) Logros ganados por retos completados por el usuario actual (se calculan con datos reales).
create or replace function public.my_challenge_logros()
returns table(challenge_id uuid, title text, reward integer)
language sql stable security definer set search_path = public as $$
  select c.id, c.title, c.reward_logros
  from public.club_challenges c
  join lateral public.club_challenge_leaderboard(c.id) l on l.user_id = auth.uid()
  where l.completed;
$$;
revoke all on function public.my_challenge_logros() from public, anon;
grant execute on function public.my_challenge_logros() to authenticated;
