-- 0016: permitir que los socios vean únicamente el avatar de quienes confirmaron un evento.
-- El directorio de perfiles ya expone nombre y ruta de avatar a usuarios autenticados;
-- esta política permite firmar solo archivos avatar-* de asistentes confirmados.
drop policy if exists profile_media_read_event_attendees on storage.objects;
create policy profile_media_read_event_attendees
  on storage.objects for select to authenticated
  using (
    bucket_id = 'profile-media'
    and storage.filename(name) like 'avatar-%'
    and exists (
      select 1
      from public.event_rsvps r
      where r.user_id::text = (storage.foldername(name))[1]
        and r.status = 'confirmed'
    )
  );
