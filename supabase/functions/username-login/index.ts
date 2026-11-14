import { adminClient, anonKey, authEmailForUsername, corsHeaders, json, normalizeUsername, supabaseUrl } from '../_shared/auth.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  try {
    const payload = await request.json();
    const identifier = typeof payload?.username === 'string' ? payload.username.trim() : '';
    const username = normalizeUsername(identifier);
    const isEmail = identifier.includes('@');
    const validIdentifier = isEmail
      ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier) && identifier.length <= 254
      : /^[a-z0-9_.-]{3,24}$/.test(username);
    const password = payload?.password;
    if (!validIdentifier || typeof password !== 'string' || password.length < 1 || password.length > 256) {
      return json({ error: 'Usuario o contraseña incorrectos.' }, 401);
    }
    if (!anonKey) return json({ error: 'La autenticación no está configurada.' }, 503);

    const admin = adminClient();
    const profileQuery = admin.from('profiles').select('id,username');
    const { data: profile } = isEmail
      ? await profileQuery.eq('contact_email', identifier.toLowerCase()).maybeSingle()
      : await profileQuery.eq('username', username).maybeSingle();
    if (!profile) return json({ error: 'Usuario o contraseña incorrectos.' }, 401);

    const { data: account, error: accountError } = await admin.auth.admin.getUserById(profile.id);
    if (accountError || !account?.user) return json({ error: 'Usuario o contraseña incorrectos.' }, 401);

    // Existing phone-auth accounts keep working while new accounts use a
    // project-local email alias and no longer depend on Phone Auth.
    const legacyPhone = account.user.phone && account.user.user_metadata?.auth_mode !== 'username';
    const credentials = legacyPhone
      ? { phone: account.user.phone, password }
      : { email: account.user.email || authEmailForUsername(username), password };

    const authResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    if (!authResponse.ok) {
      const status = authResponse.status === 429 ? 429 : 401;
      return json({ error: 'Usuario o contraseña incorrectos.' }, status);
    }
    const session = await authResponse.json();
    return json({ access_token: session.access_token, refresh_token: session.refresh_token });
  } catch (error) {
    console.error('Error al iniciar sesión por usuario:', error instanceof Error ? error.message : 'error desconocido');
    return json({ error: 'No se pudo iniciar sesión. Inténtalo de nuevo.' }, 503);
  }
});
