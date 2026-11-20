// Social: perfil de otro socio, mejores amigos (en Editar perfil) y avisos de rango/retos para tus mejores amigos.
import { supabase, esc } from '../supabase.js';
import { notify, confirmDialog } from './common.js';
import { avatarSrc, avatarImg, initialsOf, openPhotoViewer } from './avatar.js';
import { computeLogros, logrosPoints } from './share.js';
import { rankFor } from './ranks.js';

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

/** Perfil de otro socio: foto, seguir/siguiendo y sus publicaciones (solo si ya son amigos). */
export async function openProfileCard(ctx, personId) {
  const modal = document.createElement('div');
  modal.className = 'modal profile-card-modal';
  modal.innerHTML = '<section class="sheet" role="dialog" aria-modal="true" aria-label="Perfil"><div class="sheet-h"><b>Perfil</b><button class="link" type="button" data-close>Cerrar</button></div><div data-body><p class="muted">Cargando perfil…</p></div></section>';
  document.body.append(modal);
  const close = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) close(); };
  modal.querySelector('[data-close]').onclick = close;
  const body = modal.querySelector('[data-body]'), me = ctx.user.id, self = personId === me;

  const draw = async () => {
    const [{ data: dir = [] }, { data: edges = [] }] = await Promise.all([
      supabase.rpc('profile_directory'),
      supabase.from('friendships').select('id,requester,addressee,status').or(`requester.eq.${me},addressee.eq.${me}`),
    ]);
    const person = self ? ctx.profile : dir.find((p) => p.id === personId);
    if (!person) { body.innerHTML = '<p class="card muted">No se encontró este perfil.</p>'; return; }
    const edge = edges.find((e) => (e.requester === personId && e.addressee === me) || (e.requester === me && e.addressee === personId));
    const accepted = edge?.status === 'accepted', incoming = edge?.status === 'pending' && edge.addressee === me, outgoing = edge?.status === 'pending' && edge.requester === me;
    const avatar = await avatarSrc(person, 1800), name = person.full_name || 'Socio Batmon';
    let posts = [];
    if (accepted || self) {
      const { data = [] } = await supabase.from('profile_posts').select('id,media_path,media_type,caption').eq('user_id', personId).order('created_at', { ascending: false }).limit(9);
      posts = (await Promise.all(data.map(async (p) => { const { data: u } = await supabase.storage.from('profile-media').createSignedUrl(p.media_path, 1800); return { ...p, url: u?.signedUrl || '' }; }))).filter((p) => p.url);
    }
    const action = self ? '' : incoming ? '<button class="btn" data-accept>Aceptar</button>' : accepted ? '<button class="btn ghost" data-unfollow>Siguiendo · Dejar de seguir</button>' : outgoing ? '<span class="muted">Solicitud enviada</span>' : '<button class="btn" data-follow>Seguir</button>';
    body.innerHTML = `<div class="pc-head"><button type="button" class="community-avatar pc-avatar" data-avatar aria-label="Ver foto">${avatar ? avatarImg(avatar) : esc(initialsOf(name))}</button><div><h2>${esc(name)}</h2>${accepted ? '<span class="muted">Amigos</span>' : ''}</div></div>
      <div class="pc-actions">${action}</div>
      ${posts.length ? `<div class="pc-posts">${posts.map((p) => (p.media_type === 'video' ? `<video src="${esc(p.url)}" muted playsinline preload="metadata"></video>` : `<img src="${esc(p.url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`)).join('')}</div>` : accepted || self ? '<p class="muted">Aún no hay publicaciones.</p>' : '<p class="muted">Sigue a este socio y, cuando acepte, verás sus publicaciones.</p>'}`;
    body.querySelector('[data-avatar]').onclick = () => (avatar ? openPhotoViewer(avatar, name) : notify('Aún no tiene foto.', 'info'));
    const run = (sel, fn, okMsg) => { const b = body.querySelector(sel); if (b) b.onclick = async () => { b.disabled = true; const { error } = await fn(); if (error) { b.disabled = false; notify('No se pudo completar: ' + error.message); return; } if (okMsg) notify(okMsg, 'success'); draw(); }; };
    run('[data-follow]', () => supabase.from('friendships').insert({ requester: me, addressee: personId, status: 'pending' }), 'Listo, ahora sigues a esta persona.');
    run('[data-accept]', () => supabase.from('friendships').update({ status: 'accepted' }).eq('id', edge.id).eq('addressee', me), 'Ahora son amigos.');
    const un = body.querySelector('[data-unfollow]');
    if (un) un.onclick = async () => { if (!(await confirmDialog('¿Dejar de seguir a esta persona?', 'Dejar de seguir'))) return; const { error } = await supabase.from('friendships').delete().eq('id', edge.id); if (error) { notify(error.message); return; } draw(); };
  };
  draw();
  if (!self) supabase.rpc('notify_profile_view', { p_target: personId }).then(() => {}, () => {});
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
    ${people.length ? `<div class="bf-list">${people.map((p) => `<label class="bf-row"><span class="community-avatar bf-avatar">${avatars.get(p.id) ? avatarImg(avatars.get(p.id)) : esc(initialsOf(p.full_name))}</span><b>${esc(p.full_name || 'Socio Batmon')}</b><input type="checkbox" class="share-switch" data-bf="${p.id}" ${closeSet.has(p.id) ? 'checked' : ''} aria-label="Mejor amigo: ${esc(p.full_name || '')}"></label>`).join('')}</div>` : '<p class="card muted">Aún no sigues a nadie. Búscalos en Club → Miembros.</p>'}`;
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
