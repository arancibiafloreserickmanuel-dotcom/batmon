-- =====================================================================
-- 0012 — Eventos del club, confirmación de asistencia (RSVP) y notificaciones
-- Idempotente. Cumple RLS para miembros y administradores.
-- =====================================================================

-- ---------- 1) TABLA: events ----------
create table if not exists public.events (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  description    text,
  event_date     timestamptz not null,
  location       text,
  image_path     text,
  notify_members boolean not null default false,
  created_by     uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists events_date_idx on public.events (event_date asc);

alter table public.events enable row level security;

drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated
  using (true);

drop policy if exists events_admin_insert on public.events;
create policy events_admin_insert on public.events for insert to authenticated
  with check (public.is_admin());

drop policy if exists events_admin_update on public.events;
create policy events_admin_update on public.events for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists events_admin_delete on public.events;
create policy events_admin_delete on public.events for delete to authenticated
  using (public.is_admin());

-- ---------- 2) TABLA: event_rsvps ----------
create table if not exists public.event_rsvps (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  status     text not null check (status in ('confirmed', 'cancelled')) default 'confirmed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_rsvps_user_event_unique unique(event_id, user_id)
);
create index if not exists event_rsvps_event_idx on public.event_rsvps (event_id, status);
create index if not exists event_rsvps_user_idx on public.event_rsvps (user_id);

alter table public.event_rsvps enable row level security;

drop policy if exists event_rsvps_select on public.event_rsvps;
create policy event_rsvps_select on public.event_rsvps for select to authenticated
  using (true);

drop policy if exists event_rsvps_insert on public.event_rsvps;
create policy event_rsvps_insert on public.event_rsvps for insert to authenticated
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists event_rsvps_update on public.event_rsvps;
create policy event_rsvps_update on public.event_rsvps for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists event_rsvps_delete on public.event_rsvps;
create policy event_rsvps_delete on public.event_rsvps for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------- 3) TABLA: event_notifications ----------
create table if not exists public.event_notifications (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null default 'event' check (type in ('event', 'reminder')),
  message    text,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists event_notifications_user_idx on public.event_notifications (user_id, is_read);

alter table public.event_notifications enable row level security;

drop policy if exists event_notifications_select on public.event_notifications;
create policy event_notifications_select on public.event_notifications for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists event_notifications_update on public.event_notifications;
create policy event_notifications_update on public.event_notifications for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists event_notifications_insert on public.event_notifications;
create policy event_notifications_insert on public.event_notifications for insert to authenticated
  with check (public.is_admin());

drop policy if exists event_notifications_delete on public.event_notifications;
create policy event_notifications_delete on public.event_notifications for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------- 4) STORAGE BUCKET: event-media ----------
insert into storage.buckets (id, name, public)
values ('event-media', 'event-media', true)
on conflict (id) do update set public = true;

drop policy if exists event_media_public_read on storage.objects;
create policy event_media_public_read on storage.objects for select to authenticated, anon
  using (bucket_id = 'event-media');

drop policy if exists event_media_admin_write on storage.objects;
create policy event_media_admin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'event-media' and public.is_admin());

drop policy if exists event_media_admin_update on storage.objects;
create policy event_media_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'event-media' and public.is_admin())
  with check (bucket_id = 'event-media' and public.is_admin());

drop policy if exists event_media_admin_delete on storage.objects;
create policy event_media_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'event-media' and public.is_admin());

-- ---------- 5) RPC: send_event_reminder ----------
create or replace function public.send_event_reminder(
  p_event_id uuid,
  p_target   text default 'all',
  p_message  text default null
) returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  v_rec record;
  v_event record;
begin
  if not public.is_admin() then
    raise exception 'Solo administradores pueden enviar recordatorios.';
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'Evento no encontrado.';
  end if;

  for v_rec in
    select p.id as uid
    from public.profiles p
    where
      case
        when p_target = 'confirmed' then
          exists (select 1 from public.event_rsvps r where r.event_id = p_event_id and r.user_id = p.id and r.status = 'confirmed')
        when p_target = 'unconfirmed' then
          not exists (select 1 from public.event_rsvps r where r.event_id = p_event_id and r.user_id = p.id and r.status = 'confirmed')
        else true -- 'all'
      end
  loop
    insert into public.event_notifications (event_id, user_id, type, message, is_read)
    values (p_event_id, v_rec.uid, 'reminder', coalesce(p_message, 'Recordatorio: ' || v_event.title), false);
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;
revoke all on function public.send_event_reminder(uuid, text, text) from public, anon;
grant execute on function public.send_event_reminder(uuid, text, text) to authenticated;

-- ---------- 6) ENDURECIMIENTO (revisión de seguridad) ----------
-- Solo se puede marcar como leída una notificación (no editar message/type/event_id).
revoke update on public.event_notifications from authenticated;
grant update (is_read) on public.event_notifications to authenticated;

-- Límites de datos
alter table public.events drop constraint if exists events_title_len;
alter table public.events add constraint events_title_len check (length(trim(title)) between 2 and 120);
alter table public.event_notifications drop constraint if exists event_notifications_message_len;
alter table public.event_notifications add constraint event_notifications_message_len check (message is null or length(message) <= 500);

-- Bucket de imágenes: solo imágenes, máx. 5 MB (lectura pública, escritura solo admin)
update storage.buckets set file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp']
where id = 'event-media';

-- El recordatorio valida su destino y evita duplicar el mismo mensaje el mismo día
create or replace function public.send_event_reminder(
  p_event_id uuid, p_target text default 'all', p_message text default null
) returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer := 0; v_event record; v_msg text;
begin
  if not public.is_admin() then raise exception 'Solo administradores pueden enviar recordatorios.'; end if;
  if p_target not in ('all','confirmed','unconfirmed') then raise exception 'Destino no válido.'; end if;
  select * into v_event from public.events where id = p_event_id;
  if not found then raise exception 'Evento no encontrado.'; end if;
  v_msg := left(coalesce(nullif(trim(p_message), ''), 'Recordatorio: ' || v_event.title), 500);

  insert into public.event_notifications (event_id, user_id, type, message)
  select p_event_id, p.id, 'reminder', v_msg
  from public.profiles p
  where case p_target
          when 'confirmed'   then exists (select 1 from public.event_rsvps r where r.event_id = p_event_id and r.user_id = p.id and r.status = 'confirmed')
          when 'unconfirmed' then not exists (select 1 from public.event_rsvps r where r.event_id = p_event_id and r.user_id = p.id and r.status = 'confirmed')
          else true end
    and not exists (select 1 from public.event_notifications n
                    where n.event_id = p_event_id and n.user_id = p.id and n.type = 'reminder'
                      and n.message = v_msg and n.created_at::date = current_date);
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.send_event_reminder(uuid, text, text) from public, anon;
grant execute on function public.send_event_reminder(uuid, text, text) to authenticated;
