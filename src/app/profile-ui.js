// Perfil: progreso interactivo, galería de fotos/videos (mantén presionado para gestionar), fotos de sesión,
// privacidad y perfil de otro socio al estilo Instagram. Todo con el diseño Soft UI del club.
import { supabase, esc } from '../supabase.js';
import { notify, confirmDialog, fmt, iso } from './common.js';
import { avatarSrc, avatarImg, initialsOf, openPhotoViewer } from './avatar.js';
import { computeLogros, logrosMarkup } from './share.js';
import { rankFor } from './ranks.js';

export const MOD = { running: 'Running', cycling: 'Ciclismo', swimming: 'Natación', plyo: 'Pliometría', training: 'Gym' };
export const LOOKS = [['orig', 'Original'], ['bn', 'B/N'], ['calido', 'Cálido'], ['suave', 'Suave'], ['contraste', 'Contraste']];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const enabledModules = (ctx) => Object.keys(MOD).filter((k) => ctx.modules?.[k]);
const rankByName = (name) => { for (let p = 0; p < 2000; p += 5) { const r = rankFor(p); if (r.name === name) return r; } return null; };
const signed = async (path, s = 3600) => (path ? (await supabase.storage.from('profile-media').createSignedUrl(path, s)).data?.signedUrl || '' : '');

/* ───────────────────────── Progreso general interactivo ───────────────────────── */

const toEvents = (activities = [], workouts = []) => [
  ...activities.map((a) => ({ d: a.performed_on, mod: a.discipline, km: Number(a.distance_km) || 0, min: Number(a.duration_min) || 0 })),
  ...workouts.map((w) => ({ d: w.performed_on, mod: w.kind === 'plyometrics' ? 'plyo' : w.kind, km: 0, min: Number(w.duration_min) || 0 })),
].filter((e) => e.d);

function windowKeys(period, back = 0) {
  const now = new Date(), out = [];
  if (period === 'year') {
    for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i - back * 12, 1); out.push({ key: iso(d).slice(0, 7), label: MONTHS[d.getMonth()], full: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }); }
  } else {
    const n = period === 'week' ? 7 : 30;
    for (let i = n - 1; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i - back * n); out.push({ key: iso(d), label: period === 'week' ? DAYS[d.getDay()] : String(d.getDate()), full: `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}` }); }
  }
  return out;
}

const metricOf = (list, metric) => (metric === 'km' ? list.reduce((n, e) => n + e.km, 0) : metric === 'min' ? list.reduce((n, e) => n + e.min, 0) : list.length);
const metricText = (v, metric) => (metric === 'km' ? `${fmt(v, 1)} km` : metric === 'min' ? (v >= 60 ? `${Math.floor(v / 60)} h ${Math.round(v % 60)} min` : `${Math.round(v)} min`) : `${v} ${v === 1 ? 'sesión' : 'sesiones'}`);

function streakOf(events) {
  const days = new Set(events.map((e) => e.d));
  let n = 0; const d = new Date();
  if (!days.has(iso(d))) d.setDate(d.getDate() - 1);
  while (days.has(iso(d))) { n++; d.setDate(d.getDate() - 1); }
  return { streak: n, active: days.size };
}

/** Pinta el progreso dentro de `box` y gestiona toda la interacción (periodo, métrica, disciplina, barra tocada). */
export function mountProgress(box, { activities = [], workouts = [] }) {
  const all = toEvents(activities, workouts);
  const st = { period: 'week', metric: 'sessions', mod: 'all', sel: -1 };
  const present = Object.keys(MOD).filter((k) => all.some((e) => e.mod === k));
  const draw = () => {
    const events = all.filter((e) => st.mod === 'all' || e.mod === st.mod);
    const cur = windowKeys(st.period), prev = windowKeys(st.period, 1);
    const inWin = (win) => events.filter((e) => win.some((w) => e.d.startsWith(w.key)));
    const curEv = inWin(cur), prevEv = inWin(prev);
    const bars = cur.map((w) => metricOf(events.filter((e) => e.d.startsWith(w.key)), st.metric));
    const max = Math.max(1e-9, ...bars);
    const tiles = [['sessions', 'Sesiones'], ['km', 'Distancia'], ['min', 'Tiempo']].map(([k, label]) => {
      const a = metricOf(curEv, k), b = metricOf(prevEv, k), diff = b ? Math.round(((a - b) / b) * 100) : null;
      const shown = k === 'sessions' ? String(a) : k === 'km' ? fmt(a, 1) : a >= 60 ? `${Math.floor(a / 60)}h ${Math.round(a % 60)}m` : `${Math.round(a)}m`;
      return `<button type="button" class="pf-tile ${st.metric === k ? 'on' : ''}" data-metric="${k}"><b>${shown}${k === 'km' ? '<i>km</i>' : ''}</b><span>${label}</span><small>${diff === null ? 'sin datos previos' : diff === 0 ? 'igual que antes' : `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}%`}</small></button>`;
    }).join('');
    const sel = st.sel >= 0 && st.sel < cur.length ? st.sel : -1;
    const read = sel >= 0 ? `<b>${cur[sel].full}</b> · ${metricText(bars[sel], st.metric)}` : `<b>${{ week: 'Últimos 7 días', month: 'Últimos 30 días', year: 'Últimos 12 meses' }[st.period]}</b> · ${metricText(metricOf(curEv, st.metric), st.metric)} · toca una barra`;
    const { streak, active } = streakOf(events);
    const dist = present.map((k) => ({ k, n: curEv.filter((e) => e.mod === k).length })).filter((x) => x.n || st.mod === 'all').filter((x) => x.n);
    const total = dist.reduce((n, x) => n + x.n, 0) || 1;
    box.innerHTML = `<section class="pf-progress">
      ${present.length > 1 ? `<div class="pf-chips" role="tablist" aria-label="Disciplina"><button type="button" class="${st.mod === 'all' ? 'on' : ''}" data-mod="all">Todo</button>${present.map((k) => `<button type="button" class="${st.mod === k ? 'on' : ''}" data-mod="${k}">${MOD[k]}</button>`).join('')}</div>` : ''}
      <div class="pf-seg" role="tablist" aria-label="Periodo">${[['week', 'Semana'], ['month', 'Mes'], ['year', 'Año']].map(([k, t]) => `<button type="button" class="${st.period === k ? 'on' : ''}" data-period="${k}">${t}</button>`).join('')}</div>
      <div class="pf-tiles">${tiles}</div>
      <div class="pf-chart" role="group" aria-label="Gráfica de progreso">${bars.map((v, i) => `<button type="button" class="pf-bar ${i === sel ? 'on' : ''}" data-bar="${i}" aria-label="${cur[i].full}: ${metricText(v, st.metric)}"><i style="height:${Math.max(v ? 6 : 2, (v / max) * 100)}%"></i><small>${st.period === 'month' && i % 5 !== 0 && i !== cur.length - 1 ? '' : cur[i].label}</small></button>`).join('')}</div>
      <p class="pf-read">${read}</p>
      <div class="pf-streak"><div><b>${streak}</b><span>${streak === 1 ? 'día de racha' : 'días de racha'}</span></div><div><b>${active}</b><span>días activos</span></div></div>
      ${dist.length > 1 ? `<div class="pf-dist"><h3>Por disciplina</h3>${dist.map((x) => `<button type="button" class="pf-dist__row" data-mod="${x.k}"><span>${MOD[x.k]}</span><i><u style="width:${Math.round((x.n / total) * 100)}%"></u></i><b>${x.n}</b></button>`).join('')}</div>` : ''}
      ${!all.length ? '<p class="muted pf-empty">Aún no hay entrenamientos registrados.</p>' : ''}
    </section>`;
    box.querySelectorAll('[data-period]').forEach((b) => (b.onclick = () => { st.period = b.dataset.period; st.sel = -1; draw(); }));
    box.querySelectorAll('[data-metric]').forEach((b) => (b.onclick = () => { st.metric = b.dataset.metric; draw(); }));
    box.querySelectorAll('[data-mod]').forEach((b) => (b.onclick = () => { st.mod = st.mod === b.dataset.mod ? 'all' : b.dataset.mod; st.sel = -1; draw(); }));
    box.querySelectorAll('[data-bar]').forEach((b) => (b.onclick = () => { st.sel = st.sel === Number(b.dataset.bar) ? -1 : Number(b.dataset.bar); draw(); }));
  };
  draw();
}

/* ───────────────────────── Galería (estilo Instagram) ───────────────────────── */

const lookClass = (p) => `look-${p.look || 'orig'}`;

function bindLongPress(el, onLong, onTap) {
  let timer = null, fired = false, sx = 0, sy = 0;
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerdown', (e) => { fired = false; sx = e.clientX; sy = e.clientY; timer = setTimeout(() => { fired = true; try { navigator.vibrate?.(15); } catch { /* sin vibración */ } onLong(); }, 520); });
  el.addEventListener('pointermove', (e) => { if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) cancel(); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((n) => el.addEventListener(n, cancel));
  el.addEventListener('click', (e) => { if (fired) { e.preventDefault(); fired = false; return; } onTap(); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function openViewer(post, url) {
  if (post.media_type !== 'video') { openPhotoViewer(url, post.caption || ''); return; }
  const m = document.createElement('div'); m.className = 'modal pf-viewer';
  m.innerHTML = `<section class="sheet" role="dialog" aria-modal="true"><div class="sheet-h"><b>${esc(MOD[post.module_key] || 'Video')}</b><button class="link" type="button" data-close>Cerrar</button></div><video src="${esc(url)}" controls playsinline autoplay></video>${post.caption ? `<p>${esc(post.caption)}</p>` : ''}</section>`;
  document.body.append(m);
  m.onclick = (e) => { if (e.target === m || e.target.closest('[data-close]')) m.remove(); };
}

/** Rejilla 3 columnas. Con `own`, mantener presionado abre el gestor (publicar/ocultar, categoría, filtro, formato). */
export async function mountMediaGrid(box, ctx, { posts, own = false, onChange = () => {}, emptyText = 'Aún no hay publicaciones.' }) {
  if (!posts.length) { box.innerHTML = `<div class="profile-empty">${esc(emptyText)}</div>`; return; }
  const urls = await Promise.all(posts.map((p) => signed(p.media_path, 3600)));
  box.innerHTML = `<div class="ig-grid">${posts.map((p, i) => `<button type="button" class="ig-tile ${p.aspect === 'port' ? 'ig-tile--port' : ''} ${p.published === false ? 'is-hidden' : ''}" data-i="${i}" aria-label="${esc(p.caption || MOD[p.module_key] || 'Publicación')}">${urls[i] ? (p.media_type === 'video' ? `<video src="${esc(urls[i])}#t=0.1" muted playsinline preload="metadata" class="${lookClass(p)}"></video><em class="ig-tile__badge">▷</em>` : `<img src="${esc(urls[i])}" alt="" loading="lazy" draggable="false" class="${lookClass(p)}">`) : '<span class="ig-tile__miss">—</span>'}${own && p.published === false ? '<em class="ig-tile__hid">Oculta</em>' : ''}${p.module_key ? `<small class="ig-tile__cat">${esc(MOD[p.module_key] || '')}</small>` : ''}</button>`).join('')}</div>${own ? '<p class="muted ig-hint">Mantén presionada una foto o video para publicarla, ocultarla o editarla.</p>' : ''}`;
  box.querySelectorAll('.ig-tile').forEach((el) => {
    const i = Number(el.dataset.i);
    if (own) bindLongPress(el, () => openMediaSheet(ctx, posts[i], urls[i], onChange), () => openViewer(posts[i], urls[i]));
    else el.onclick = () => openViewer(posts[i], urls[i]);
  });
}

/** Hoja para gestionar un medio (existente o foto de sesión aún no publicada). */
export function openMediaSheet(ctx, post, url, onChange = () => {}) {
  const st = { published: post.published !== false && !post._new, module_key: post.module_key || enabledModules(ctx)[0] || 'running', look: post.look || 'orig', aspect: post.aspect || 'sq', visibility: post.visibility || 'friends', caption: post.caption || '' };
  const m = document.createElement('div'); m.className = 'modal pf-sheet';
  const mods = enabledModules(ctx);
  if (!mods.includes(st.module_key)) mods.push(st.module_key);
  const draw = () => {
    m.innerHTML = `<section class="sheet" role="dialog" aria-modal="true" aria-label="Gestionar publicación"><div class="sheet-h"><b>${post._new ? 'Foto de sesión' : 'Mi publicación'}</b><button class="link" type="button" data-close>Cerrar</button></div>
      <div class="pf-preview pf-preview--${st.aspect}">${post.media_type === 'video' ? `<video src="${esc(url)}" controls playsinline class="${'look-' + st.look}"></video>` : `<img src="${esc(url)}" alt="" class="${'look-' + st.look}">`}</div>
      <div class="pf-opt"><span>Estado</span><div class="pf-seg pf-seg--sm"><button type="button" class="${st.published ? 'on' : ''}" data-pub="1">Publicada</button><button type="button" class="${!st.published ? 'on' : ''}" data-pub="0">Oculta</button></div></div>
      <div class="pf-opt"><span>Categoría</span><div class="pf-chips">${mods.map((k) => `<button type="button" class="${st.module_key === k ? 'on' : ''}" data-cat="${k}">${MOD[k]}</button>`).join('')}</div></div>
      ${post.media_type !== 'video' ? `<div class="pf-opt"><span>Filtro</span><div class="pf-chips">${LOOKS.map(([k, t]) => `<button type="button" class="${st.look === k ? 'on' : ''}" data-look="${k}">${t}</button>`).join('')}</div></div>` : ''}
      <div class="pf-opt"><span>Formato</span><div class="pf-seg pf-seg--sm"><button type="button" class="${st.aspect === 'sq' ? 'on' : ''}" data-aspect="sq">Cuadrado</button><button type="button" class="${st.aspect === 'port' ? 'on' : ''}" data-aspect="port">Vertical 4:5</button></div></div>
      <div class="pf-opt"><span>Quién la ve</span><div class="pf-seg pf-seg--sm"><button type="button" class="${st.visibility === 'friends' ? 'on' : ''}" data-vis="friends">Mis amigos</button><button type="button" class="${st.visibility === 'close' ? 'on' : ''}" data-vis="close">Mejores amigos</button></div></div>
      <label class="pf-opt pf-opt--col"><span>Descripción</span><input data-caption maxlength="500" value="${esc(st.caption)}" placeholder="Opcional"></label>
      <div class="pf-actions"><button type="button" class="btn" data-save>Guardar</button>${post._new ? '' : '<button type="button" class="btn ghost" data-del>Eliminar</button>'}</div><p class="msg" data-msg></p></section>`;
    const on = (sel, fn) => m.querySelectorAll(sel).forEach((b) => (b.onclick = () => { st.caption = m.querySelector('[data-caption]').value; fn(b); draw(); }));
    on('[data-pub]', (b) => { st.published = b.dataset.pub === '1'; });
    on('[data-cat]', (b) => { st.module_key = b.dataset.cat; });
    on('[data-look]', (b) => { st.look = b.dataset.look; });
    on('[data-aspect]', (b) => { st.aspect = b.dataset.aspect; });
    on('[data-vis]', (b) => { st.visibility = b.dataset.vis; });
    m.querySelector('[data-close]').onclick = () => m.remove();
    m.querySelector('[data-save]').onclick = async (e) => {
      const btn = e.currentTarget, msg = m.querySelector('[data-msg]'); btn.disabled = true;
      const fields = { published: st.published, module_key: st.module_key, look: st.look, aspect: st.aspect, visibility: st.visibility, caption: m.querySelector('[data-caption]').value.trim() };
      const { error } = post._new
        ? await supabase.from('profile_posts').insert({ user_id: ctx.user.id, media_path: post.media_path, media_type: post.media_type || 'image', source: 'session', session_kind: post.session_kind || null, session_ref: post.session_ref || null, ...fields })
        : await supabase.from('profile_posts').update(fields).eq('id', post.id).eq('user_id', ctx.user.id);
      if (error) { btn.disabled = false; msg.textContent = `No se guardó: ${error.message}${/column|schema/i.test(error.message) ? ' (aplica la migración 0029)' : ''}`; return; }
      notify(st.published ? 'Publicada en tu perfil.' : 'Guardada como oculta.', 'success'); m.remove(); onChange();
    };
    const del = m.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      if (!(await confirmDialog('¿Eliminar esta foto o video de tu perfil?', 'Eliminar'))) return;
      const { error } = await supabase.from('profile_posts').delete().eq('id', post.id).eq('user_id', ctx.user.id);
      if (error) { notify(error.message); return; }
      if (/\/(posts|session)\//.test(post.media_path)) await supabase.storage.from('profile-media').remove([post.media_path]);
      m.remove(); onChange();
    };
  };
  document.body.append(m);
  m.onclick = (e) => { if (e.target === m) m.remove(); };
  draw();
}

/** Mis fotos y videos (Editar perfil): lo publicado, lo oculto y las fotos tomadas en sesiones que aún no están en el perfil. */
export async function mountMediaManager(box, ctx) {
  box.innerHTML = '<p class="muted">Cargando…</p>';
  const [postsRes, actRes] = await Promise.all([
    supabase.from('profile_posts').select('*').eq('user_id', ctx.user.id).order('created_at', { ascending: false }).limit(120),
    supabase.from('activities').select('id,discipline,activity_photos,performed_on').order('performed_on', { ascending: false }).limit(80),
  ]);
  const posts = postsRes.data || [], used = new Set(posts.map((p) => p.media_path));
  const candidates = (actRes.data || []).flatMap((a) => (a.activity_photos || []).filter((path) => !used.has(path)).map((path) => ({ _new: true, published: false, media_path: path, media_type: 'image', session_kind: a.discipline, session_ref: a.id, module_key: a.discipline, created_at: a.performed_on })));
  const refresh = () => mountMediaManager(box, ctx);
  box.innerHTML = `<p class="muted">Aquí está todo lo que tomaste. Toca una para ver; mantén presionada para publicarla, ocultarla o cambiar su categoría y filtro.</p>
    <label class="pf-upload">Subir foto o video<input type="file" data-up accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"></label>
    <h3 class="pf-sub">En mi perfil (${posts.length})</h3><div data-own></div>
    <h3 class="pf-sub">Tomadas en sesiones (${candidates.length})</h3><div data-cand></div>`;
  box.querySelector('[data-up]').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'].includes(file.type)) { notify('Formato no permitido (JPG, PNG, WebP, MP4 o MOV).'); return; }
    if (file.size > 30 * 1024 * 1024) { notify('El archivo supera 30 MB.'); return; }
    const ext = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg', path = `${ctx.user.id}/posts/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from('profile-media').upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) { notify(up.error.message); return; }
    const { error } = await supabase.from('profile_posts').insert({ user_id: ctx.user.id, module_key: enabledModules(ctx)[0] || 'running', media_path: path, media_type: file.type.startsWith('video/') ? 'video' : 'image', caption: '', published: false, source: 'manual' });
    if (error) { await supabase.storage.from('profile-media').remove([path]); notify(`${error.message}${/column|schema/i.test(error.message) ? ' (aplica la migración 0029)' : ''}`); return; }
    notify('Subida. Mantenla presionada para publicarla.', 'success'); refresh();
  };
  await Promise.all([
    mountMediaGrid(box.querySelector('[data-own]'), ctx, { posts, own: true, onChange: refresh, emptyText: 'Aún no tienes fotos ni videos.' }),
    mountMediaGrid(box.querySelector('[data-cand]'), ctx, { posts: candidates, own: true, onChange: refresh, emptyText: 'Las fotos que tomes en tus sesiones aparecerán aquí.' }),
  ]);
}

/* ───────────────────────── Foto/video al terminar una sesión ───────────────────────── */

export function sessionMediaMarkup(ctx, kind) {
  const mods = enabledModules(ctx), cur = mods.includes(kind) ? kind : mods[0];
  return `<fieldset class="sess-media"><legend>Foto o video de la sesión</legend>
    <label class="sess-media__pick">Tomar o elegir<input type="file" name="sess_media" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"></label>
    <label class="sess-media__row"><span>Publicar en mi perfil</span><input type="checkbox" class="share-switch" name="sess_pub" aria-label="Publicar en mi perfil"></label>
    <label>Categoría<select name="sess_cat">${mods.map((k) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${MOD[k]}</option>`).join('')}</select></label>
    <small class="muted">Si no la publicas, queda guardada y podrás publicarla después desde Editar perfil.</small></fieldset>`;
}

export function readSessionMedia(root) {
  const file = root.querySelector('[name=sess_media]')?.files?.[0];
  if (!file) return null;
  return { file, publish: !!root.querySelector('[name=sess_pub]')?.checked, category: root.querySelector('[name=sess_cat]')?.value || 'running' };
}

export async function saveSessionMedia(ctx, sm, { kind, ref }) {
  if (!sm) return { error: null };
  const { file } = sm;
  if (!['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'].includes(file.type)) return { error: { message: 'Formato no permitido (JPG, PNG, WebP, MP4 o MOV).' } };
  if (file.size > 30 * 1024 * 1024) return { error: { message: 'El archivo supera 30 MB.' } };
  const ext = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${ctx.user.id}/session/${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage.from('profile-media').upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) return { error: up.error };
  const { error } = await supabase.from('profile_posts').insert({ user_id: ctx.user.id, module_key: sm.category, media_path: path, media_type: file.type.startsWith('video/') ? 'video' : 'image', caption: '', published: sm.publish, source: 'session', session_kind: kind, session_ref: ref || null });
  if (error) await supabase.storage.from('profile-media').remove([path]);
  return { error };
}

/* ───────────────────────── Privacidad ───────────────────────── */

export const PRIVACY_ITEMS = [['photos', 'Fotos'], ['videos', 'Videos'], ['progress', 'Mi progreso'], ['logros', 'Mis logros']];
export const privacyOf = (profile) => ({ photos: true, videos: true, progress: false, logros: false, ...(profile?.profile_privacy || {}) });

export function mountPrivacy(box, ctx) {
  const priv = privacyOf(ctx.profile);
  box.innerHTML = `<p class="muted">Elige qué ven los socios que te siguen cuando abren tu perfil. Tu membresía, ajustes y notificaciones nunca se muestran.</p>${PRIVACY_ITEMS.map(([k, t]) => `<label class="bf-row pf-priv"><b>${t}</b><input type="checkbox" class="share-switch" data-priv="${k}" ${priv[k] ? 'checked' : ''} aria-label="${t}"></label>`).join('')}<p class="msg" data-msg></p>`;
  box.querySelectorAll('[data-priv]').forEach((input) => {
    input.onchange = async () => {
      input.disabled = true;
      const next = { ...privacyOf(ctx.profile), [input.dataset.priv]: input.checked };
      const { error } = await supabase.rpc('set_profile_privacy', { p: next });
      input.disabled = false;
      if (error) { input.checked = !input.checked; box.querySelector('[data-msg]').textContent = `No se guardó: ${error.message}${/function|schema/i.test(error.message) ? ' (aplica la migración 0029)' : ''}`; return; }
      ctx.profile.profile_privacy = next; notify('Privacidad actualizada.', 'success');
    };
  });
}

/* ───────────────────────── Perfil de otro socio (tipo Instagram) ───────────────────────── */

export async function renderPublicProfile(v, ctx, personId) {
  v.innerHTML = '<section class="ig"><p class="muted">Cargando perfil…</p></section>';
  const me = ctx.user.id;
  const [{ data: info, error }, { data: edges = [] }] = await Promise.all([
    supabase.rpc('public_profile', { p_user: personId }),
    supabase.from('friendships').select('id,requester,addressee,status').or(`requester.eq.${me},addressee.eq.${me}`),
  ]);
  const back = () => { const from = sessionStorage.getItem('batmon_profile_from'); location.hash = '#' + (from || 'club'); };
  if (error || !info) { v.innerHTML = `<section class="ig"><button class="link" id="ig-back" type="button">← Volver</button><div class="card warn">${error ? `No se pudo cargar el perfil. ${/function|schema/i.test(error.message) ? 'Aplica la migración 0029.' : esc(error.message)}` : 'No se encontró este perfil.'}</div></section>`; v.querySelector('#ig-back').onclick = back; return; }
  if (personId === me) { location.hash = '#perfil'; return; }
  const edge = edges.find((e) => (e.requester === personId && e.addressee === me) || (e.requester === me && e.addressee === personId));
  const accepted = edge?.status === 'accepted', incoming = edge?.status === 'pending' && edge.addressee === me, outgoing = edge?.status === 'pending' && edge.requester === me;
  const priv = { photos: true, videos: true, progress: false, logros: false, ...(info.privacy || {}) };
  const name = info.full_name || 'Socio Batmon', avatar = await avatarSrc(info, 1800), rank = info.rank_name ? rankByName(info.rank_name) : null;
  const tabs = accepted ? [['photos', 'Fotos', '▦'], ['videos', 'Videos', '▷'], ['progress', 'Progreso', '▥'], ['logros', 'Logros', '★']].filter(([k]) => priv[k]) : [];
  let tab = tabs[0]?.[0] || '';
  const action = incoming ? '<button class="btn" data-accept>Aceptar</button>' : accepted ? '<button class="btn ghost" data-unfollow>Siguiendo</button>' : outgoing ? '<button class="btn ghost" disabled>Solicitud enviada</button>' : '<button class="btn" data-follow>Seguir</button>';
  v.innerHTML = `<section class="ig"><div class="ig-top"><button class="link" id="ig-back" type="button" aria-label="Volver">←</button><b>${esc(name)}</b><span></span></div>
    <div class="ig-head"><button type="button" class="ig-avatar" id="ig-avatar" aria-label="Ver foto">${avatar ? avatarImg(avatar) : esc(initialsOf(name))}</button><div class="ig-counts"><div><b>${info.posts ?? 0}</b><span>Publicaciones</span></div><div><b>${info.friends ?? 0}</b><span>Amigos</span></div></div></div>
    <div class="ig-bio"><b>${esc(name)}</b>${rank ? `<span class="ig-rank"><img src="${rank.icon}" alt="" width="18" height="18">${esc(rank.name)}</span>` : ''}</div>
    <div class="ig-actions">${action}</div>
    ${tabs.length ? `<nav class="ig-tabs" aria-label="Contenido">${tabs.map(([k, t, ic]) => `<button type="button" data-tab="${k}" class="${tab === k ? 'on' : ''}" aria-label="${t}">${ic}</button>`).join('')}</nav>` : ''}
    <div id="ig-body">${accepted ? (tabs.length ? '' : '<div class="profile-empty">Este socio no compartió contenido en su perfil.</div>') : '<div class="profile-empty">Sigue a este socio y, cuando acepte, verás lo que comparte.</div>'}</div></section>`;
  v.querySelector('#ig-back').onclick = back;
  v.querySelector('#ig-avatar').onclick = () => (avatar ? openPhotoViewer(avatar, name) : notify('Aún no tiene foto.', 'info'));
  const run = (sel, fn, ok) => { const b = v.querySelector(sel); if (b) b.onclick = async () => { b.disabled = true; const { error: e } = await fn(); if (e) { b.disabled = false; notify('No se pudo completar: ' + e.message); return; } if (ok) notify(ok, 'success'); renderPublicProfile(v, ctx, personId); }; };
  run('[data-follow]', () => supabase.from('friendships').insert({ requester: me, addressee: personId, status: 'pending' }), 'Ahora sigues a esta persona.');
  run('[data-accept]', () => supabase.from('friendships').update({ status: 'accepted' }).eq('id', edge.id).eq('addressee', me), 'Ahora son amigos.');
  const un = v.querySelector('[data-unfollow]');
  if (un) un.onclick = async () => { if (!(await confirmDialog('¿Dejar de seguir a esta persona?', 'Dejar de seguir'))) return; const { error: e } = await supabase.from('friendships').delete().eq('id', edge.id); if (e) { notify(e.message); return; } renderPublicProfile(v, ctx, personId); };
  const body = v.querySelector('#ig-body');
  const showTab = async () => {
    v.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (!tab) return;
    if (tab === 'photos' || tab === 'videos') {
      const { data = [] } = await supabase.from('profile_posts').select('*').eq('user_id', personId).eq('media_type', tab === 'videos' ? 'video' : 'image').order('created_at', { ascending: false }).limit(60);
      await mountMediaGrid(body, ctx, { posts: data.filter((p) => p.published !== false), emptyText: tab === 'videos' ? 'Aún no hay videos.' : 'Aún no hay fotos.' });
    } else {
      body.innerHTML = '<p class="muted">Cargando…</p>';
      const { data: s, error: e } = await supabase.rpc('profile_stats', { p_user: personId });
      if (e || !s || !s[tab]) { body.innerHTML = '<div class="profile-empty">No disponible.</div>'; return; }
      if (tab === 'progress') mountProgress(body, { activities: s.activities, workouts: s.workouts });
      else body.innerHTML = logrosMarkup(computeLogros({ activities: s.activities || [], workouts: s.workouts || [], shared: s.shared || 0 }), { points: Number(s.challenge_points) || 0, items: [] }, { whose: name.split(' ')[0] });
    }
  };
  v.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; showTab(); }));
  showTab();
  supabase.rpc('notify_profile_view', { p_target: personId }).then(() => {}, () => {});
}

export const openPublicProfile = (personId, from = '') => { try { sessionStorage.setItem('batmon_profile_from', from || (location.hash.slice(1).split('/')[0] || 'club')); } catch { /* sin almacenamiento */ } location.hash = `#perfil/${personId}`; };
