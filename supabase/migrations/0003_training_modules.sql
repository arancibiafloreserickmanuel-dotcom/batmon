-- =====================================================================
-- 0003 — módulo Entrenamiento y visibilidad de módulos por socio
-- Aplicar manualmente en Supabase SQL Editor después de 0002.
-- No altera policies existentes de activities, workouts ni memberships.
-- =====================================================================

-- La tabla workouts/series ya admite las medidas necesarias para fuerza.
alter table public.workouts drop constraint if exists workouts_kind_check;
alter table public.workouts add constraint workouts_kind_check
  check (kind in ('plyometrics', 'training'));

-- Preferencias durables del plan semanal de entrenamiento, por socio.
create table if not exists public.training_plans (
  user_id uuid primary key references public.profiles(id) on delete cascade default auth.uid(),
  plan jsonb not null default '{}'::jsonb check (jsonb_typeof(plan) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.training_plans enable row level security;
drop policy if exists training_plans_select on public.training_plans;
create policy training_plans_select on public.training_plans for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists training_plans_insert on public.training_plans;
create policy training_plans_insert on public.training_plans for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists training_plans_update on public.training_plans;
create policy training_plans_update on public.training_plans for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists training_plans_delete on public.training_plans;
create policy training_plans_delete on public.training_plans for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());
grant select, insert, update, delete on public.training_plans to authenticated;
revoke all on public.training_plans from anon;

-- El admin controla qué módulos aparecen para cada socio. Una fila ausente
-- significa habilitado para conservar la experiencia actual de socios.
create table if not exists public.profile_modules (
  user_id uuid not null references public.profiles(id) on delete cascade,
  module_key text not null check (module_key in ('running', 'plyo', 'training')),
  enabled boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (user_id, module_key)
);
alter table public.profile_modules enable row level security;
drop policy if exists profile_modules_select on public.profile_modules;
create policy profile_modules_select on public.profile_modules for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists profile_modules_admin_insert on public.profile_modules;
create policy profile_modules_admin_insert on public.profile_modules for insert to authenticated
  with check (public.is_admin());
drop policy if exists profile_modules_admin_update on public.profile_modules;
create policy profile_modules_admin_update on public.profile_modules for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists profile_modules_admin_delete on public.profile_modules;
create policy profile_modules_admin_delete on public.profile_modules for delete to authenticated
  using (public.is_admin());
grant select, insert, update, delete on public.profile_modules to authenticated;
revoke all on public.profile_modules from anon;
