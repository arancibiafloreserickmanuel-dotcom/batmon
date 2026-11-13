Aplica 3 migraciones de base de datos en mi proyecto Supabase `batmon-crowd` y NO me hagas preguntas: ejecuta todo de corrido y al final dame un reporte. Ya tengo sesión iniciada en Supabase, GitHub y Vercel en este Chrome. App: https://batmon.vercel.app

La migración 0002 YA está aplicada: NO la ejecutes de nuevo.

Para cada archivo: abre el link RAW, copia TODO el texto, ve a Supabase > SQL Editor > New query, pega el contenido completo, ejecuta y confirma "Success" antes de pasar al siguiente. Si el editor corrompe el texto al pegar, pégalo por la API del editor y verifica que los `$$` y paréntesis estén balanceados. NO modifiques el SQL. Orden obligatorio:

1) 0003 — https://raw.githubusercontent.com/arancibiafloreserickmanuel-dotcom/batmon/main/supabase/migrations/0003_training_modules.sql
2) 0004 — https://raw.githubusercontent.com/arancibiafloreserickmanuel-dotcom/batmon/main/supabase/migrations/0004_module_controls.sql
3) 0005 — https://raw.githubusercontent.com/arancibiafloreserickmanuel-dotcom/batmon/main/supabase/migrations/0005_social_profile.sql

Si un link RAW diera 404 por caché, espera 30 s y reintenta, o usa el mismo archivo desde github.com/arancibiafloreserickmanuel-dotcom/batmon/blob/main/supabase/migrations/ con el botón "Raw".
Si una migración falla, copia el error EXACTO, no sigas con la siguiente y repórtalo.

VERIFICACIÓN (SQL Editor):
- select table_name from information_schema.tables where table_schema='public' order by 1;  → deben aparecer además: app_modules, body_measurements, friendships, profile_modules, profile_posts, training_plans.
- select tablename, rowsecurity from pg_tables where schemaname='public';  → TODAS true.
- select id, public from storage.buckets;  → debe existir profile-media con public=false (y receipts).
- select count(*) from public.app_modules;  → 5.
- select grantee, privilege_type, column_name from information_schema.column_privileges where table_name='friendships' and grantee='authenticated' and privilege_type='UPDATE';  → solo la columna status.
- select polname from pg_policy where polname='profile_media_read_friends';  → 1 fila.

IMPORTACIÓN: en https://batmon.vercel.app/admin.html#ejercicios (usa mi sesión de admin ya iniciada; si hay que esperar a que Vercel termine el deploy del último commit de main, espera a "Ready"): pulsa "Importar catálogo base" (Pliometría) si faltan ejercicios, y luego "Importar ejercicios de entrenamiento". Confirma los totales y, en Table Editor > exercises, cuenta filas con category='plyometrics' (esperado 61) y category='training'. Si existe el botón de aplicar traducciones, púlsalo.

PRUEBA RÁPIDA: en https://batmon.vercel.app/app.html confirma que carga sin errores de consola y que las pestañas Running, Pliometría, Entrenamiento y Perfil abren. En Admin > Socios confirma que se ven los interruptores de módulos (ya no debe salir "aplica la migración 0004").

REPORTE: lista corta ✅/❌ por migración (0003, 0004, 0005), verificaciones, importaciones y prueba rápida, con el error exacto de lo que falle. No uses la service_role key. No borres datos.
