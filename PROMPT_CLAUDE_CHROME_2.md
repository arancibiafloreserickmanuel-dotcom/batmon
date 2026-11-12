Necesito que apliques una migración de base de datos y pruebes las funciones nuevas de mi app "Batmon Crowd". Ya tengo sesión iniciada en Supabase, GitHub y Vercel en este Chrome. Proyecto Supabase: `batmon-crowd`. App: https://batmon.vercel.app

PASO 1 — MIGRACIÓN. Abre el archivo del repo en GitHub: `supabase/migrations/0002_plyometrics_running_admin.sql` (repo arancibiafloreserickmanuel-dotcom/batmon, rama main; usa el botón "Raw" para copiarlo). En Supabase > SQL Editor > New query, pega TODO su contenido y ejecútalo. Debe terminar con "Success". Si el autocompletado del editor corrompe el texto, pégalo por la API del editor como hiciste la vez anterior y verifica que los paréntesis y los `$$` estén balanceados. NO modifiques el SQL.

PASO 2 — VERIFICAR. En SQL Editor ejecuta y confírmame los resultados:
- `select table_name from information_schema.tables where table_schema='public' order by 1;` → deben aparecer activities, exercises, memberships, profiles, workout_sets, workouts.
- `select tablename, rowsecurity from pg_tables where schemaname='public';` → TODAS con rowsecurity = true.
- `select proname from pg_proc where proname in ('admin_member_overview','admin_set_role','admin_delete_user');` → 3 filas.
- `select column_name from information_schema.columns where table_name='activities' and column_name in ('run_type','rpe','elevation_m');` → 3 filas.

PASO 3 — ESPERA EL DEPLOY. En Vercel confirma que el último commit de main ("Pliometría…") está en estado Listo.

PASO 4 — PRUEBA FUNCIONAL en https://batmon.vercel.app/app.html con mi cuenta admin (ya está logueada):
a) Admin → https://batmon.vercel.app/admin.html#ejercicios: pulsa "Importar catálogo base". Debe decir 61 ejercicios y verse la lista con miniaturas. Verifica en Table Editor > exercises que hay 61 filas con source='dataset'.
b) En la app, pestaña Pliometría > Nueva sesión: "+ Agregar ejercicio", elige 2 ejercicios (deben verse las fotos), completa 3 series con reps, altura (cm) y descanso, pon duración 40 y esfuerzo 7, y "Guardar sesión". Debe pasar al Historial y mostrar la sesión. Verifica en Table Editor que hay 1 fila en workouts y las series en workout_sets.
c) Running: registra una salida de 5 km en 30 min con tipo "Tempo", desnivel 40 y esfuerzo 6. Luego pulsa "Editar" en ese registro, cámbialo a 5.5 km y guarda. Verifica que cambió y que muestra el ritmo.
d) Pliometría > Ejercicios: abre uno (debe mostrar 2 fotos e instrucciones) y crea un "ejercicio propio" de prueba; luego bórralo desde su detalle.
e) Admin → Socios: debe aparecer mi fila con km, nº de sesiones de pliometría y estado de pago. Abre "Ver datos" y comprueba que lista mis actividades y sesiones.
f) Admin → Pagos: debe mostrar mi historial con botones "Reabrir" y "Borrar" (NO borres mi pago aprobado).
g) Borra la sesión de prueba y la salida de prueba al terminar (desde la app).

PASO 5 — SEGURIDAD (RLS). Si puedes, crea una segunda cuenta de prueba desde /app.html (correo de prueba que yo te indique [PREGUNTAR]) y confirma que NO ve mis actividades, mis sesiones ni mis pagos, y que /admin.html le dice "Sin acceso". Después elimina esa cuenta desde Admin → Socios → Ver datos → "Eliminar socio" (pide escribir ELIMINAR).

REPORTE: lista corta con ✅/❌ por cada paso (1–5) y el error exacto de lo que falle. No uses la service_role key. No borres datos que no sean de prueba.
