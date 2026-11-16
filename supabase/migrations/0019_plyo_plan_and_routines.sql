-- =====================================================================
-- 0019 — Pliometría: rutinas reutilizables y plan semanal por socio.
-- No toca exercises/workouts/workout_sets existentes ni sus políticas.
-- Solo agrega tablas nuevas y dos columnas nullable en workouts.
-- =====================================================================

-- ---------- RUTINAS REUTILIZABLES ----------
create table if not exists public.plyo_routines (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  name       text not null check (length(trim(name)) between 1 and 80),
  focus      text check (focus is null or length(focus) <= 200),
  items      jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and pg_column_size(items) <= 200000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plyo_routines_user_idx on public.plyo_routines(user_id);
alter table public.plyo_routines enable row level security;
drop policy if exists plyo_routines_select on public.plyo_routines;
create policy plyo_routines_select on public.plyo_routines for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists plyo_routines_insert on public.plyo_routines;
create policy plyo_routines_insert on public.plyo_routines for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists plyo_routines_update on public.plyo_routines;
create policy plyo_routines_update on public.plyo_routines for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists plyo_routines_delete on public.plyo_routines;
create policy plyo_routines_delete on public.plyo_routines for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());
grant select, insert, update, delete on public.plyo_routines to authenticated;
revoke all on public.plyo_routines from anon;

-- ---------- PLAN SEMANAL (una fila por socio, igual patrón que training_plans) ----------
create table if not exists public.plyo_plans (
  user_id    uuid primary key references public.profiles(id) on delete cascade default auth.uid(),
  plan       jsonb not null default '{}'::jsonb check (jsonb_typeof(plan) = 'object' and pg_column_size(plan) <= 50000),
  updated_at timestamptz not null default now()
);
alter table public.plyo_plans enable row level security;
drop policy if exists plyo_plans_select on public.plyo_plans;
create policy plyo_plans_select on public.plyo_plans for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists plyo_plans_insert on public.plyo_plans;
create policy plyo_plans_insert on public.plyo_plans for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists plyo_plans_update on public.plyo_plans;
create policy plyo_plans_update on public.plyo_plans for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists plyo_plans_delete on public.plyo_plans;
create policy plyo_plans_delete on public.plyo_plans for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());
grant select, insert, update, delete on public.plyo_plans to authenticated;
revoke all on public.plyo_plans from anon;

-- ---------- Enlace opcional sesión -> rutina usada (no rompe nada existente) ----------
alter table public.workouts add column if not exists source_routine_id uuid references public.plyo_routines(id) on delete set null;
alter table public.workouts add column if not exists plan_day text
  check (plan_day is null or plan_day in ('Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'));
