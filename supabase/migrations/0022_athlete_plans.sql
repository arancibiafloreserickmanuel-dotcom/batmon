-- =====================================================================
-- 0022 — Datos del atleta (compartidos entre disciplinas) y plan de Running.
-- Solo agrega tablas nuevas; no toca nada existente.
-- =====================================================================

-- ---------- DATOS DEL ATLETA (edad, peso, estatura, salud, respuestas por disciplina) ----------
create table if not exists public.athlete_profiles (
  user_id    uuid primary key references public.profiles(id) on delete cascade default auth.uid(),
  data       jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 60000),
  updated_at timestamptz not null default now()
);
alter table public.athlete_profiles enable row level security;
drop policy if exists athlete_profiles_select on public.athlete_profiles;
create policy athlete_profiles_select on public.athlete_profiles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists athlete_profiles_insert on public.athlete_profiles;
create policy athlete_profiles_insert on public.athlete_profiles for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists athlete_profiles_update on public.athlete_profiles;
create policy athlete_profiles_update on public.athlete_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists athlete_profiles_delete on public.athlete_profiles;
create policy athlete_profiles_delete on public.athlete_profiles for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());
grant select, insert, update, delete on public.athlete_profiles to authenticated;
revoke all on public.athlete_profiles from anon;

-- ---------- PLAN DE RUNNING (una fila por socio) ----------
create table if not exists public.run_plans (
  user_id    uuid primary key references public.profiles(id) on delete cascade default auth.uid(),
  plan       jsonb not null default '{}'::jsonb check (jsonb_typeof(plan) = 'object' and pg_column_size(plan) <= 200000),
  updated_at timestamptz not null default now()
);
alter table public.run_plans enable row level security;
drop policy if exists run_plans_select on public.run_plans;
create policy run_plans_select on public.run_plans for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists run_plans_insert on public.run_plans;
create policy run_plans_insert on public.run_plans for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists run_plans_update on public.run_plans;
create policy run_plans_update on public.run_plans for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists run_plans_delete on public.run_plans;
create policy run_plans_delete on public.run_plans for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());
grant select, insert, update, delete on public.run_plans to authenticated;
revoke all on public.run_plans from anon;
