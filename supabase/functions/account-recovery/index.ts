import { adminClient, corsHeaders, json } from '../_shared/auth.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  try {
    const payload = await request.json();
    const action = payload?.action;
    const phone = typeof payload?.phone === 'string' ? payload.phone.replace(/\D/g, '') : '';
    const password = typeof payload?.new_password === 'string' ? payload.new_password : '';
    if (action !== 'change') return json({ error: 'Acción no válida.' }, 400);
    if (!/^\d{8}$/.test(phone)) return json({ error: 'El número debe tener exactamente 8 dígitos.' }, 400);
    if (password.length < 8 || password.length > 128) return json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, 400);

    const admin = adminClient();
    const { data: profile, error: lookupError } = await admin
      .from('profiles')
      .select('id, role')
      .eq('recovery_phone', phone)
      .maybeSingle();
    if (lookupError) {
      console.error('No se pudo buscar número de recuperación:', lookupError.message);
      return json({ error: 'No se pudo verificar el número. Inténtalo de nuevo.' }, 503);
    }
    if (!profile) return json({ error: 'El número no coincide con una cuenta registrada.' }, 404);
    // Para proteger el perfil administrativo, exige el proveedor con el que se creó.
    if (profile.role === 'admin') return json({ error: 'La cuenta admin debe entrar con Google. Después configura una contraseña en Perfil → Configuración.' }, 403);

    const { error: updateError } = await admin.auth.admin.updateUserById(profile.id, { password });
    if (updateError) {
      console.error('No se pudo actualizar la contraseña:', updateError.message);
      return json({ error: 'No se pudo cambiar la contraseña. Inténtalo de nuevo.' }, 503);
    }
    return json({ ok: true, message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  } catch (error) {
    console.error('Error en recuperación de cuenta:', error instanceof Error ? error.message : 'error desconocido');
    return json({ error: 'No se pudo procesar la solicitud. Inténtalo de nuevo.' }, 503);
  }
});
