-- Borra los datos de prueba creados por prueba_reto_actividad.sql
delete from public.shared_activities where title like '[PRUEBA]%';
delete from public.activities where activity_name like '[PRUEBA]%';
delete from public.club_challenges where title like '[PRUEBA]%';
