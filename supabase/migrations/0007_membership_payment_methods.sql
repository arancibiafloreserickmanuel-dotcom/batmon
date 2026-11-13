-- Identifica pagos de membresía enviados por QR o como solicitud de pago en efectivo.
alter table public.memberships
  add column if not exists payment_method text not null default 'qr';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'memberships_payment_method_check'
      and conrelid = 'public.memberships'::regclass
  ) then
    alter table public.memberships
      add constraint memberships_payment_method_check
      check (payment_method in ('qr', 'cash'));
  end if;
end;
$$;
