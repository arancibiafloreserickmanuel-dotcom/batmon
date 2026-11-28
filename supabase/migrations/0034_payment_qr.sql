-- QR de pago de la membresía: foto recortada, día en que vence y animación que ve el cliente.

-- Solo el administrador, o un socio con el permiso "pagos", puede cambiar el QR (es a donde llega el dinero).
create or replace function public.can_manage_payments() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
    where id = auth.uid() and (role = 'admin' or (role = 'socio' and staff_permissions->>'pagos' = 'true')));
$$;
revoke all on function public.can_manage_payments() from public, anon;
grant execute on function public.can_manage_payments() to authenticated;

-- Una sola fila (id = 1).
create table if not exists public.payment_qr (
  id int primary key default 1 check (id = 1),
  image_path text check (image_path is null or length(image_path) <= 200),
  expires_on date,
  animation text not null default 'scan' check (animation in ('scan', 'focus', 'orbit', 'mosaic')),
  animation_on boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.payment_qr enable row level security;
grant select, insert, update on public.payment_qr to authenticated;

drop policy if exists payment_qr_read on public.payment_qr;
create policy payment_qr_read on public.payment_qr for select to authenticated using (true);
drop policy if exists payment_qr_insert on public.payment_qr;
create policy payment_qr_insert on public.payment_qr for insert to authenticated with check (public.can_manage_payments());
drop policy if exists payment_qr_update on public.payment_qr;
create policy payment_qr_update on public.payment_qr for update to authenticated
  using (public.can_manage_payments()) with check (public.can_manage_payments());

-- Imagen del QR (pública para mostrarla; solo la cambia quien gestiona pagos).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-qr', 'payment-qr', true, 5242880, array['image/png'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/png'];
drop policy if exists payment_qr_file_read on storage.objects;
create policy payment_qr_file_read on storage.objects for select to authenticated using (bucket_id = 'payment-qr');
drop policy if exists payment_qr_file_insert on storage.objects;
create policy payment_qr_file_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-qr' and public.can_manage_payments());
drop policy if exists payment_qr_file_delete on storage.objects;
create policy payment_qr_file_delete on storage.objects for delete to authenticated
  using (bucket_id = 'payment-qr' and public.can_manage_payments());
