-- Módulos globales y permisos/visibilidad específicos por socio.
alter table public.profile_modules drop constraint if exists profile_modules_module_key_check;
alter table public.profile_modules add constraint profile_modules_module_key_check
  check (module_key in ('running','cycling','swimming','plyo','training'));

create table if not exists public.app_modules (
  module_key text primary key check (module_key in ('running','cycling','swimming','plyo','training')),
  enabled boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.app_modules enable row level security;
drop policy if exists app_modules_select on public.app_modules;
create policy app_modules_select on public.app_modules for select to authenticated using (true);
drop policy if exists app_modules_admin_write on public.app_modules;
create policy app_modules_admin_write on public.app_modules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.app_modules to authenticated;
revoke all on public.app_modules from anon;

insert into public.app_modules(module_key,enabled) values
 ('running',true),('cycling',true),('swimming',true),('plyo',true),('training',true)
on conflict (module_key) do nothing;
