# Acceso con usuario y contraseña, sin SMS

El registro y el inicio de sesión de Batmon usan usuario y contraseña. No requieren habilitar **Phone Auth**, confirmar teléfonos ni contratar un proveedor SMS. El teléfono boliviano de 8 dígitos se guarda en `profiles.recovery_phone` solo para la recuperación de contraseña.

## Aplicar cambios

1. Ejecuta `migrations/0009_username_auth_without_sms.sql` en Supabase SQL Editor, después de las migraciones anteriores.
2. Despliega estas funciones Edge:

```powershell
supabase functions deploy username-signup
supabase functions deploy username-login
supabase functions deploy account-recovery
```

3. Confirma que las Edge Functions tengan `SUPABASE_URL`, la clave pública (`SUPABASE_ANON_KEY` o `SUPABASE_PUBLISHABLE_KEYS`) y una clave secreta de servidor (`SUPABASE_SERVICE_ROLE_KEY` o `SUPABASE_SECRET_KEYS`). La clave secreta solo se usa en el servidor.
4. Phone Auth y el proveedor SMS pueden quedar desactivados. Google OAuth es independiente y sigue requiriendo su configuración de proveedor si se quiere ofrecer ese botón.

`username-signup` crea una cuenta Email/Password confirmada por servidor con un alias interno derivado del nombre de usuario, inicia la sesión y devuelve los tokens a la aplicación. El correo opcional real se guarda como dato de contacto en el perfil; el alias no se muestra en el perfil ni en el panel admin. `username-login` conserva compatibilidad con cuentas antiguas de teléfono y con el acceso previo por correo.

La recuperación pide el teléfono de 8 dígitos y una contraseña nueva. No se envía un SMS. Quien controle o conozca ese número puede cambiar la contraseña, así que esta recuperación no verifica que la persona sea titular de la línea. Para cuentas antiguas, la migración completa `recovery_phone` cuando el teléfono Auth tiene formato `+591` más 8 dígitos.
