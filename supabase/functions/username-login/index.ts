import { adminClient, anonKey, corsHeaders, json, normalizeUsername, supabaseUrl } from '../_shared/auth.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  try {
    const { username: rawUsername, password } = await request.json();
    const username = normalizeUsername(rawUsername);
    if (!/^[a-z0-9_.-]{3,24}$/.test(username) || typeof password !== 'string' || password.length < 1 || password.length > 256) {
      return json({ error: 'Usuario o contraseña incorrectos.' }, 401);
    }
    if (!anonKey) return json({ error: 'La autenticación no está configurada.' }, 503);

    const admin = adminClient();
    const { data: profile } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
    if (!profile) return json({ error: 'Usuario o contraseña incorrectos.' }, 401);

    const { data: account, error: accountError } = await admin.auth.admin.getUserById(profile.id);
    const phone = account?.user?.phone;
    if (accountError || !phone) return json({ error: 'Usuario o contraseña incorrectos.' }, 401);

    const authResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password }),
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
