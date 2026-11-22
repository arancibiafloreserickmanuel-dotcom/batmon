-- Lugar del evento: enlace de mapa (Google Maps u otro) y punto marcado en el mapa. Todo opcional.
alter table public.events add column if not exists place_url text check (place_url is null or length(place_url) <= 500);
alter table public.events add column if not exists place_lat double precision check (place_lat is null or place_lat between -90 and 90);
alter table public.events add column if not exists place_lon double precision check (place_lon is null or place_lon between -180 and 180);
