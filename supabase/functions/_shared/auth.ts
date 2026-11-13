import { createClient } from 'npm:@supabase/supabase-js@2';

function keyFromSet(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  try {
    const values = JSON.parse(raw);
    const selected = values.default ?? Object.values(values)[0];
    return typeof selected === 'string' ? selected : undefined;
  } catch {
    return raw;
  }
}

export const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
export const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? keyFromSet('SUPABASE_PUBLISHABLE_KEYS');
export const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? keyFromSet('SUPABASE_SECRET_KEYS');

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function adminClient() {
  if (!supabaseUrl || !serviceKey) throw new Error('Faltan secretos de Supabase para el backend.');
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function publicClient() {
  if (!supabaseUrl || !anonKey) throw new Error('Falta la clave pública de Supabase.');
  return createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function normalizeUsername(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// Supabase Auth requires an email or phone for password sessions. New Batmon
// accounts use a deterministic internal email alias so signup never needs the
// Phone provider or an SMS. The member's real contact email stays in profiles.
export function authEmailForUsername(username: string) {
  const domain = new URL(supabaseUrl).hostname;
  return `${normalizeUsername(username)}@${domain}`;
}
