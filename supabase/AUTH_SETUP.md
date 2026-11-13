# Acceso con usuario y recuperación SMS

El socio inicia sesión con su nombre de usuario y contraseña; el correo queda como dato de contacto opcional. La recuperación ahora pide solo el teléfono asociado a Supabase Auth, envía un código por SMS y permite elegir una contraseña nueva. No se pide completar o verificar el teléfono al volver a iniciar sesión en una cuenta existente.

## Configuración necesaria en Supabase

1. Ejecuta `migrations/0008_username_sms_recovery.sql` en el SQL Editor del proyecto, después de las migraciones anteriores.
2. En **Authentication → Providers → Phone**, habilita el proveedor Teléfono y permite registros nuevos. Desactiva **Confirm phone** para que el alta vincule el número sin enviar un código SMS.
3. La recuperación actual sí envía un código SMS para comprobar que la persona controla el número antes de cambiar la contraseña. Para usar esa recuperación, configura un proveedor SMS en **Authentication → SMS Provider** y una plantilla que incluya `{{ .Code }}`. Supabase usa el largo y los límites de OTP configurados en Auth; la interfaz está preparada para códigos de seis dígitos.
4. Despliega las funciones de Edge. `supabase/config.toml` desactiva la validación de JWT de estas dos funciones porque deben aceptar solicitudes antes de iniciar sesión; las contraseñas se validan contra Supabase Auth y el secreto de servidor nunca llega al navegador.

```powershell
supabase functions deploy username-login
supabase functions deploy account-recovery
```

Las funciones leen `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` (o las claves equivalentes que Supabase inyecta en Edge Functions). No copies la clave `service_role`/secret a `.env` del frontend.

## Cuentas existentes

Las cuentas previas todavía pueden entrar con su correo y contraseña durante la migración. Si falta información de perfil, aparece un aviso de bienvenida que se cierra con **Aceptar**; ya no bloquea el acceso para pedir teléfono o carnet. La recuperación por SMS funciona para números vinculados a la cuenta en Supabase Auth. Si una cuenta de Google/correo aún no tiene teléfono asociado, debe seguir entrando con ese proveedor hasta que se habilite una forma de vincular un teléfono.

Las nuevas cuentas usan usuario, carnet, teléfono y contraseña; el correo es opcional. El registro se confirma por código SMS.
