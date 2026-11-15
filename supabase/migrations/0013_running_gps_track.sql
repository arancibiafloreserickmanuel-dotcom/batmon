-- Guarda puntos GPS opcionales para carreras registradas desde navegador.
-- No modifica registros existentes ni altera políticas de acceso.
alter table public.activities
  add column if not exists route_points jsonb not null default '[]'::jsonb,
  add column if not exists tracking_source text not null default 'manual'
    check (tracking_source in ('manual','gps'));

alter table public.activities
  drop constraint if exists activities_route_points_array;
alter table public.activities
  add constraint activities_route_points_array
    check (jsonb_typeof(route_points) = 'array');

create table if not exists public.plyo_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  test_type text not null check (test_type in ('cmj','sj','drop_jump')),
  measured_on date not null default current_date,
  jump_height_cm numeric(6,2) check (jump_height_cm between 0 and 250),
  flight_time_ms numeric(8,2) check (flight_time_ms between 0 and 3000),
  contact_time_ms numeric(8,2) check (contact_time_ms between 0 and 3000),
  rsi numeric(7,3) check (rsi between 0 and 20),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists plyo_assessments_user_date_idx on public.plyo_assessments(user_id, measured_on desc);
alter table public.plyo_assessments enable row level security;
drop policy if exists plyo_assessments_select on public.plyo_assessments;
create policy plyo_assessments_select on public.plyo_assessments for select to authenticated using(user_id=auth.uid() or public.is_admin());
drop policy if exists plyo_assessments_insert on public.plyo_assessments;
create policy plyo_assessments_insert on public.plyo_assessments for insert to authenticated with check(user_id=auth.uid());
drop policy if exists plyo_assessments_update on public.plyo_assessments;
create policy plyo_assessments_update on public.plyo_assessments for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists plyo_assessments_delete on public.plyo_assessments;
create policy plyo_assessments_delete on public.plyo_assessments for delete to authenticated using(user_id=auth.uid() or public.is_admin());
grant select,insert,update,delete on public.plyo_assessments to authenticated;
