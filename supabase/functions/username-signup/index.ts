import { adminClient, authEmailForUsername, corsHeaders, json, normalizeUsername, publicClient } from '../_shared/auth.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  try {
    const payload = await request.json();
    const fullName = typeof payload?.full_name === 'string' ? payload.full_name.trim() : '';
    const username = normalizeUsername(payload?.username);
    const carnet = typeof payload?.carnet_number === 'string' ? payload.carnet_number.trim().toUpperCase() : '';
    const phone = typeof payload?.recovery_phone === 'string' ? payload.recovery_phone.replace(/\D/g, '') : '';
    const contactEmail = typeof payload?.contact_email === 'string' ? payload.contact_email.trim().toLowerCase() : '';
    const password = typeof payload?.password === 'string' ? payload.password : '';

    if (fullName.length < 2 || fullName.length > 100) return json({ error: 'Escribe tu nombre completo.' }, 400);
    if (!/^[a-z0-9_.-]{3,24}$/.test(username)) return json({ error: 'El usuario debe tener entre 3 y 24 caracteres: letras, números, punto, guion o guion bajo.' }, 400);
    if (carnet.length < 3 || carnet.length > 32) return json({ error: 'Revisa el número de carnet.' }, 400);
    if (!/^\d{8}$/.test(phone)) return json({ error: 'El número debe tener exactamente 8 dígitos.' }, 400);
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return json({ error: 'Escribe un correo válido o deja el campo vacío.' }, 400);
    if (password.length < 8 || password.length > 128) return json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, 400);

    const email = authEmailForUsername(username);
    const admin = adminClient();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
      user_metadata: {
        auth_mode: 'username',
        full_name: fullName,
        username,
        carnet_number: carnet,
        recovery_phone: phone,
        contact_email: contactEmail || null,
      },
    });

    if (createError || !created.user) {
      const authError = createError?.message || '';
      const duplicate = /already|registered|unique|duplicate/i.test(authError);
      const schemaNotReady = /database error|schema cache|column .* does not exist|relation .* does not exist/i.test(authError);
      const errorMessage = duplicate
        ? 'Ese usuario, carnet o número ya está registrado.'
        : schemaNotReady
          ? 'Falta actualizar la base de datos de Batmon. Ejecuta las migraciones 0008 y 0009 en Supabase.'
          : 'No se pudo crear la cuenta. Revisa los datos e inténtalo de nuevo.';
      console.error('No se pudo crear usuario Auth:', authError);
      return json({ error: errorMessage }, duplicate ? 409 : schemaNotReady ? 503 : 400);
    }

    const { data: signedIn, error: signInError } = await publicClient().auth.signInWithPassword({ email, password });
    if (signInError || !signedIn.session) {
      await admin.auth.admin.deleteUser(created.user.id);
      console.error('No se pudo iniciar sesión después del registro:', signInError?.message);
      return json({ error: 'La cuenta no pudo iniciar sesión. Inténtalo de nuevo.' }, 503);
    }
    return json({ access_token: signedIn.session.access_token, refresh_token: signedIn.session.refresh_token });
  } catch (error) {
    console.error('Error al crear cuenta:', error instanceof Error ? error.message : 'error desconocido');
    return json({ error: 'No se pudo crear la cuenta. Revisa los datos e inténtalo de nuevo.' }, 503);
  }
});
