-- 0017: límites de tamaño para evitar abuso de almacenamiento (revisión de 0013-0016).
-- No cambia políticas de acceso. Usa NOT VALID para no fallar con filas antiguas.

-- Ruta GPS: máximo 20000 puntos y ~2 MB por registro.
alter table public.activities drop constraint if exists activities_route_points_size;
alter table public.activities add constraint activities_route_points_size
  check (jsonb_array_length(route_points) <= 20000 and pg_column_size(route_points) <= 2000000) not valid;

-- Notas de actividades y evaluaciones pliométricas: máximo 1000 caracteres.
alter table public.activities drop constraint if exists activities_notes_len;
alter table public.activities add constraint activities_notes_len
  check (notes is null or length(notes) <= 1000) not valid;

alter table public.plyo_assessments drop constraint if exists plyo_assessments_notes_len;
alter table public.plyo_assessments add constraint plyo_assessments_notes_len
  check (notes is null or length(notes) <= 1000) not valid;
