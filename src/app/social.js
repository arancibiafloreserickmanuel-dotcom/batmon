// Social: perfil de otro socio, mejores amigos (en Editar perfil) y avisos de rango/retos para tus mejores amigos.
import { supabase, esc } from '../supabase.js';
import { notify, confirmDialog } from './common.js';
import { avatarSrc, avatarImg, initialsOf, openPhotoViewer } from './avatar.js';
import { computeLogros, logrosPoints } from './share.js';
import { rankFor } from './ranks.js';
import { openPublicProfile } from './profile-ui.js';

const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

/** Reporta tu rango y los retos completados: la base de datos avisa a quienes te tienen en "mejores amigos". */
export async function reportProgress(ctx, activities = [], workouts = []) {
  try {
    const [shared, ch] = await Promise.all([
      supabase.from('shared_activities').select('id', { count: 'exact', head: true }).eq('user_id', ctx.user.id),
      supabase.rpc('my_challenge_logros'),
    ]);
    const items = ch.data || [];
    const total = logrosPoints(computeLogros({ activities, workouts, shared: shared.count || 0 }), items.reduce((n, r) => n + (r.reward || 0), 0));
    const rank = rankFor(total).name, rankKey = `batmon_rank_reported_${ctx.user.id}`;
    if (safeGet(rankKey) !== rank) { const { error } = await supabase.rpc('report_rank', { p_rank: rank }); if (!error) safeSet(rankKey, rank); }
    const seenKey = `batmon_challenges_reported_${ctx.user.id}`;
    let seen; try { seen = new Set(JSON.parse(safeGet(seenKey) || '[]')); } catch { seen = new Set(); }
    for (const r of items) if (!seen.has(r.challenge_id)) { const { error } = await supabase.rpc('report_challenge_done', { p_challenge: r.challenge_id }); if (!error) seen.add(r.challenge_id); }
    safeSet(seenKey, JSON.stringify([...seen]));
  } catch { /* las notificaciones sociales no deben romper la app */ }
}

/** Perfil de otro socio: ahora es una página (#perfil/<id>) con aspecto de Instagram. */
export function openProfileCard(ctx, personId) {
  openPublicProfile(personId);
}

/** Lista para elegir mejores amigos entre las personas que ya sigues (se usa en Editar perfil). */
export async function mountBestFriends(box, ctx) {
  if (!box) return;
  const me = ctx.user.id;
  const [{ data: edges = [] }, { data: dir = [] }, { data: closeRows = [], error }] = await Promise.all([
    supabase.from('friendships').select('requester,addressee,status').eq('status', 'accepted').or(`requester.eq.${me},addressee.eq.${me}`),
    supabase.rpc('profile_directory'),
    supabase.from('close_friends').select('friend'),
  ]);
  if (error) { box.innerHTML = '<p class="muted">Aplica la migración 0024 para usar mejores amigos.</p>'; return; }
  const ids = edges.map((e) => (e.requester === me ? e.addressee : e.requester)), closeSet = new Set(closeRows.map((r) => r.friend));
  const people = dir.filter((p) => ids.includes(p.id));
  const avatars = new Map(await Promise.all(people.map(async (p) => [p.id, await avatarSrc(p, 1800)])));
  box.innerHTML = `<h2>Mejores amigos</h2><p class="muted">Elige entre las personas que ya sigues. Solo ellos verán lo que compartas como “Mejores amigos” y recibirás avisos cuando suban de rango o completen un reto, y ellos los tuyos.</p>
    ${people.length ? `<div class="bf-list">${people.map((p) => `<label class="bf-row"><span class="community-avatar bf-avatar">${avatars.get(p.id) ? avatarImg(avatars.get(p.id)) : esc(initialsOf(p.full_name))}</span><b>${esc(p.full_name || 'Socio Batmon')}</b><input type="checkbox" class="share-switch" data-bf="${p.id}" ${closeSet.has(p.id) ? 'checked' : ''} aria-label="Mejor amigo: ${esc(p.full_name || '')}"><span><i></i></span></label>`).join('')}</div>` : '<p class="card muted">Aún no sigues a nadie. Búscalos en Club → Miembros.</p>'}`;
  box.querySelectorAll('[data-bf]').forEach((input) => {
    input.onchange = async () => {
      const id = input.dataset.bf, on = input.checked; input.disabled = true;
      const { error: e } = on ? await supabase.from('close_friends').insert({ friend: id }) : await supabase.from('close_friends').delete().eq('owner', me).eq('friend', id);
      input.disabled = false;
      if (e) { input.checked = !on; notify('No se pudo actualizar: ' + e.message); return; }
      notify(on ? 'Añadido a mejores amigos.' : 'Quitado de mejores amigos.', 'success');
    };
  });
}
