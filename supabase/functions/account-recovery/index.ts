import { adminClient, corsHeaders, json, publicClient } from '../_shared/auth.ts';

const genericStartMessage = 'Si el número está asociado a una cuenta, recibirás un código SMS.';
const invalidCodeMessage = 'El código no es válido o venció. Solicita uno nuevo e inténtalo otra vez.';
const validPhone = (phone: string) => /^\+[1-9]\d{7,14}$/.test(phone);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  try {
    const payload = await request.json();
    const action = payload?.action;
    const phone = typeof payload?.phone === 'string' ? payload.phone.trim() : '';
    if (!validPhone(phone)) {
      return action === 'start'
        ? json({ ok: true, message: genericStartMessage })
        : json({ error: invalidCodeMessage }, 400);
    }

    if (action === 'start') {
      const { error } = await publicClient().auth.signInWithOtp({
        phone,
        options: { shouldCreateUser: false },
      });
      if (error) {
        // Do not reveal whether a phone number is registered.
        console.error('No se pudo iniciar recuperación por SMS:', error.message);
      }
      return json({ ok: true, message: genericStartMessage });
    }

    if (action === 'verify') {
      const token = typeof payload?.token === 'string' ? payload.token.trim() : '';
      const newPassword = typeof payload?.new_password === 'string' ? payload.new_password : '';
      if (!/^\d{4,8}$/.test(token) || newPassword.length < 8 || newPassword.length > 128) {
        return json({ error: invalidCodeMessage }, 400);
      }

      const { data: verified, error: verifyError } = await publicClient().auth.verifyOtp({
        phone,
        token,
        type: 'sms',
      });
      if (verifyError || !verified.user?.id) return json({ error: invalidCodeMessage }, 400);

      const { error: updateError } = await adminClient().auth.admin.updateUserById(verified.user.id, {
        password: newPassword,
      });
      if (updateError) {
        console.error('No se pudo actualizar la contraseña:', updateError.message);
        return json({ error: 'No se pudo cambiar la contraseña. Solicita un código nuevo.' }, 503);
      }
      return json({ ok: true, message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
    }

    return json({ error: 'Acción no válida.' }, 400);
  } catch (error) {
    console.error('Error en recuperación de cuenta:', error instanceof Error ? error.message : 'error desconocido');
    return json({ error: 'No se pudo procesar la solicitud. Inténtalo de nuevo.' }, 503);
  }
});
