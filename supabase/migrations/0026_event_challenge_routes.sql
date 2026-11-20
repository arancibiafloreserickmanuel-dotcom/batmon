-- Ruta marcada en el mapa (de dónde a dónde) para eventos (opcional) y retos (obligatoria si es de running).

alter table public.events
  add column if not exists route jsonb
  check (route is null or (jsonb_typeof(route) = 'object' and pg_column_size(route) < 120000));

alter table public.club_challenges
  add column if not exists route jsonb
  check (route is null or (jsonb_typeof(route) = 'object' and pg_column_size(route) < 120000));

-- Los retos de running nuevos o editados deben llevar ruta. "not valid": no revisa los retos que ya existían.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'club_challenges_running_needs_route') then
    alter table public.club_challenges
      add constraint club_challenges_running_needs_route check (discipline <> 'running' or route is not null) not valid;
  end if;
end $$;
