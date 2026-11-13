-- Preferencia global de apariencia administrable.
create table if not exists public.site_settings (
  id boolean primary key default true check (id),
  theme_policy text not null default 'choice' check (theme_policy in ('choice','light','dark')),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.site_settings enable row level security;
drop policy if exists site_settings_read on public.site_settings;
create policy site_settings_read on public.site_settings for select to authenticated using (true);
drop policy if exists site_settings_admin_write on public.site_settings;
create policy site_settings_admin_write on public.site_settings for all to authenticated using(public.is_admin()) with check(public.is_admin());
grant select,insert,update on public.site_settings to authenticated;
revoke all on public.site_settings from anon;
insert into public.site_settings(id,theme_policy) values(true,'choice') on conflict(id) do nothing;
