-- Running review, accurate timestamps, split storage and route gap preservation.
-- Apply this migration before deploying the updated Running UI.
-- Does not loosen/change the existing activities RLS policies.

alter table public.activities
  add column if not exists activity_name text not null default 'Running',
  add column if not exists started_at timestamptz,
  add column if not exists duration_seconds integer,
  add column if not exists moving_time_sec integer,
  add column if not exists route_segments jsonb not null default '[]'::jsonb,
  add column if not exists split_data jsonb not null default '[]'::jsonb,
  add column if not exists activity_photos text[] not null default '{}',
  add column if not exists surface text;

alter table public.activities
  drop constraint if exists activities_running_details_valid;
alter table public.activities
  add constraint activities_running_details_valid check (
    length(activity_name) between 1 and 100
    and (duration_seconds is null or duration_seconds > 0)
    and (moving_time_sec is null or moving_time_sec >= 0)
    and (surface is null or surface in ('Asfalto','Tierra','Pista','Montaña','Otra'))
    and jsonb_typeof(route_segments) = 'array'
    and jsonb_typeof(split_data) = 'array'
    and cardinality(activity_photos) <= 3
  ) not valid;

create index if not exists activities_user_running_started_idx
  on public.activities(user_id, started_at desc)
  where discipline = 'running';

comment on column public.activities.route_segments is
  'GPS line segments; each inner array starts after a pause or signal gap so maps never connect across interruptions.';
comment on column public.activities.split_data is
  'Kilometer split records derived from valid GPS points; manual records use an empty array.';
comment on column public.activities.activity_photos is
  'Private image paths in profile-media storage owned by the activity author.';

-- Endurecimiento (revisión): límites de tamaño.
alter table public.activities drop constraint if exists activities_running_sizes;
alter table public.activities add constraint activities_running_sizes check (
  pg_column_size(route_segments) <= 2000000
  and pg_column_size(split_data) <= 200000
  and jsonb_array_length(split_data) <= 1000
) not valid;
