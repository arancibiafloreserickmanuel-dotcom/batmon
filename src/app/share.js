// Actividades compartidas: formulario de "Compartir" al terminar, feed en tarjetas y logros.
import { supabase, $, esc } from '../supabase.js';
import { notify, confirmDialog, fmt, paceStr } from './common.js';
import { openShredder } from './shredder.js';
import { TALK_ICON } from './talk-icon.js';
import { openComments } from './comments-sheet.js';
import './comments-sheet.css';
import { avatarSrc, avatarImg, initialsOf, openPhotoViewer } from './avatar.js';
import { rankFor, TIER_POINTS } from './ranks.js';
import { likeMarkup, mountLike } from './like-button.js';

const EFFORT = [[2, 'Muy fácil'], [4, 'Fácil'], [6, 'Moderado'], [8, 'Duro'], [10, 'Máximo esfuerzo']];
const EFFORT_LABEL = Object.fromEntries(EFFORT);
const ICON = {
  run: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 16l3-1 2-5 4 2 3 3h4v3H4z"/><path d="M9 10l1-3"/></svg>',
  dumbbell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8v8M3 10v4M18 8v8M21 10v4M6 12h12"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  like: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 11v9H4v-9zM7 11l4-7c1.5 0 2.5 1 2.5 2.5V9h5.2a1.8 1.8 0 0 1 1.8 2.1l-1.3 7A2 2 0 0 1 17.2 20H7"/></svg>',
  comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg>',
  share: '<svg class="sh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="sh-arrow" d="M12 15V3M8 7l4-4 4 4"/><path d="M5 12v8h14v-8"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 3h10v5a5 5 0 0 1-10 0V3zM4 4h3v2H5a1 1 0 0 0 0 2h2.2A7 7 0 0 0 7.7 10H5a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2zm16 0a2 2 0 0 1 2 2v1a3 3 0 0 1-3 3h-2.7a7 7 0 0 0 .5-2H19a1 1 0 0 0 0-2h-2V4h3zM11 14h2v3h3v2H8v-2h3z"/></svg>',
};

/* ───────────── Formulario "Compartir" (preguntas al terminar) ───────────── */

export function shareSectionMarkup({ titlePlaceholder = 'Mi actividad' } = {}) {
  return `<section class="share-box" data-share>
    <label class="share-toggle"><span><b>Compartir actividad</b><small>Tus amigos del club la verán en Actividades. Solo se comparte si lo activas.</small></span><input type="checkbox" class="share-switch" data-share-on><span><i></i></span></label>
    <div class="share-fields" data-share-fields hidden>
      <label>Título<input data-share-title maxlength="100" placeholder="${esc(titlePlaceholder)}"></label>
      <label>Descripción<textarea data-share-desc rows="3" maxlength="1000" placeholder="¿Cómo te ha ido? Comparte más detalles sobre tu actividad."></textarea></label>
      <label>Lugar<input data-share-place maxlength="120" placeholder="Ej. Sucre, Chuquisaca"></label>
      <label>Añadir fotos · hasta 3<input type="file" data-share-photos accept="image/jpeg,image/png,image/webp" multiple></label>
      <label>¿Cómo autoevalúas esta actividad?<select data-share-effort><option value="">Elegir</option>${EFFORT.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select></label>
      <label>¿Quién puede verlo?<select data-share-vis><option value="friends">Mis amigos</option><option value="close">Solo mejores amigos</option></select></label>
      
    </div>
  </section>`;
}

export function bindShareSection(root, { route = [], onPlace } = {}) {
  const box = root.querySelector('[data-share]');
  if (!box) return;
  const toggle = box.querySelector('[data-share-on]'), fields = box.querySelector('[data-share-fields]');
  let guessed = false;
  const host = (sel) => root.querySelector(sel);
  const hide = (sel, on) => { const el = box.querySelector(sel)?.closest('label'); if (el) el.hidden = on; };
  hide('[data-share-effort]', !!host('[name=rpe]')); hide('[data-share-photos]', !!host('[name=photos]'));
  toggle.onchange = () => {
    fields.hidden = !toggle.checked;
    if (toggle.checked) { // lo que ya escribiste arriba se trae solo (puedes editarlo)
      const t = box.querySelector('[data-share-title]'), d = box.querySelector('[data-share-desc]');
      if (!t.value) t.value = host('[name=activity_name]')?.value.trim() || '';
      if (!d.value) d.value = host('[name=notes]')?.value.trim() || '';
    }
    if (toggle.checked && !guessed && route.length) {
      guessed = true;
      guessPlace(route).then((place) => { const input = box.querySelector('[data-share-place]'); if (place && input && !input.value) input.value = place; });
    }
  };
}

export function readShare(root, fallbackTitle) {
  const box = root.querySelector('[data-share]');
  if (!box || !box.querySelector('[data-share-on]').checked) return null;
  const effort = Number(box.querySelector('[data-share-effort]').value) || Number(root.querySelector('[name=rpe]')?.value) || null;
  const own = Array.from(box.querySelector('[data-share-photos]').files || []), hostFiles = Array.from(root.querySelector('[name=photos]')?.files || []).filter((f) => f.type.startsWith('image/'));
  return {
    title: box.querySelector('[data-share-title]').value.trim() || root.querySelector('[name=activity_name]')?.value.trim() || fallbackTitle,
    description: box.querySelector('[data-share-desc]').value.trim() || root.querySelector('[name=notes]')?.value.trim() || '',
    place: box.querySelector('[data-share-place]').value.trim(),
    effort,
    visibility: box.querySelector('[data-share-vis]').value === 'close' ? 'close' : 'friends',
    files: (own.length ? own : hostFiles).slice(0, 3),
  };
}

async function guessPlace(route) {
  const first = route.flat().find((p) => Number.isFinite(+p.lat) && Number.isFinite(+p.lon));
  if (!first) return '';
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&accept-language=es&lat=${(+first.lat).toFixed(3)}&lon=${(+first.lon).toFixed(3)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return '';
    const a = (await res.json()).address || {};
    return [a.city || a.town || a.village || a.municipality || a.county, a.state].filter(Boolean).join(', ');
  } catch { return ''; }
}

function compactRoute(route) {
  const segs = (Array.isArray(route?.[0]) ? route : [route || []]).filter((s) => s?.length);
  const total = segs.reduce((n, s) => n + s.length, 0), step = Math.max(1, Math.ceil(total / 240));
  return segs.map((s) => s.filter((_, i) => i % step === 0 || i === s.length - 1)
    .filter((p) => Number.isFinite(+p.lat) && Number.isFinite(+p.lon))
    .map((p) => [Number((+p.lat).toFixed(5)), Number((+p.lon).toFixed(5))])).filter((s) => s.length > 1);
}

async function uploadSharePhotos(userId, files) {
  if (!files.length) return [];
  if (files.length > 3) throw new Error('Puedes subir hasta 3 fotos.');
  const out = [];
  for (const [i, file] of files.entries()) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Usa imágenes JPG, PNG o WebP.');
    if (file.size > 8 * 1024 * 1024) throw new Error('Cada foto debe pesar menos de 8 MB.');
    const ext = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${userId}/shared-${Date.now()}-${i}.${ext}`;
    const { error } = await supabase.storage.from('profile-media').upload(path, file, { contentType: file.type });
    if (error) { if (out.length) await supabase.storage.from('profile-media').remove(out); throw new Error(error.message); }
    out.push(path);
  }
  return out;
}

/** Publica la actividad ya guardada. Devuelve { error } sin lanzar nunca: la actividad privada no debe perderse. */
export async function publishShare(userId, { kind, sourceId, performedOn, stats, route = [], share }) {
  let photos = [];
  try { photos = await uploadSharePhotos(userId, share.files); } catch (e) { return { error: e }; }
  const { error } = await supabase.from('shared_activities').insert({
    kind, source_id: sourceId || null, title: share.title, description: share.description, place: share.place || null,
    performed_on: performedOn, stats, route: compactRoute(route), photos, effort: share.effort,
    ...(share.visibility === 'close' ? { visibility: 'close' } : {}), // sin la migración 0024 la columna no existe
  });
  if (error && photos.length) await supabase.storage.from('profile-media').remove(photos);
  return { error };
}

/* ───────────── Logros ───────────── */

const mondayKey = (iso) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

/** Logros de la cuenta, calculados con los datos reales del socio (sin tabla propia). */
export function computeLogros({ activities = [], workouts = [], shared = 0 }) {
  const runs = activities.filter((a) => a.discipline === 'running');
  const plyo = workouts.filter((w) => w.kind === 'plyometrics');
  const km = runs.reduce((n, a) => n + Number(a.distance_km || 0), 0);
  const maxKm = Math.max(0, ...runs.map((a) => Number(a.distance_km || 0)));
  const weeks = new Map();
  runs.forEach((a) => weeks.set(mondayKey(a.performed_on), (weeks.get(mondayKey(a.performed_on)) || 0) + 1));
  const bestWeek = Math.max(0, ...weeks.values());
  const days = [...new Set([...runs, ...workouts].map((x) => x.performed_on))].sort();
  let streak = 0, best = 0, prev = null;
  for (const d of days) {
    const gap = prev ? Math.round((new Date(`${d}T12:00:00`) - new Date(`${prev}T12:00:00`)) / 86400000) : 0;
    streak = prev && gap === 1 ? streak + 1 : 1; best = Math.max(best, streak); prev = d;
  }
  const list = [];
  const add = (id, title, desc, tier, have, need, unit = '') => list.push({ id, title, desc, tier, have: Math.min(have, need), need, unit, earned: have >= need });
  add('run1', 'Primer paso', 'Registra tu primera carrera', 'bronze', runs.length, 1);
  add('run10', 'Corredor constante', '10 carreras registradas', 'silver', runs.length, 10);
  add('run50', 'Fondista', '50 carreras registradas', 'gold', runs.length, 50);
  add('km25', '25 kilómetros', 'Acumula 25 km corriendo', 'bronze', km, 25, 'km');
  add('km100', '100 kilómetros', 'Acumula 100 km corriendo', 'silver', km, 100, 'km');
  add('km500', '500 kilómetros', 'Acumula 500 km corriendo', 'gold', km, 500, 'km');
  add('d5', 'Cinco mil', 'Una carrera de 5 km o más', 'bronze', maxKm, 5, 'km');
  add('d10', 'Diez mil', 'Una carrera de 10 km o más', 'silver', maxKm, 10, 'km');
  add('d21', 'Media maratón', 'Una carrera de 21 km o más', 'gold', maxKm, 21, 'km');
  add('week3', 'Semana activa', '3 carreras en una misma semana', 'bronze', bestWeek, 3);
  add('streak7', 'Racha de 7 días', 'Entrena 7 días seguidos', 'gold', best, 7);
  add('plyo1', 'Primer salto', 'Primera sesión de pliometría', 'bronze', plyo.length, 1);
  add('plyo10', 'Explosivo', '10 sesiones de pliometría', 'silver', plyo.length, 10);
  add('plyo30', 'Potencia total', '30 sesiones de pliometría', 'gold', plyo.length, 30);
  add('plyo100', 'Leyenda explosiva', '100 sesiones de pliometría', 'gold', plyo.length, 100);
  const bike = activities.filter((a) => a.discipline === 'cycling'), swim = activities.filter((a) => a.discipline === 'swimming'), gym = workouts.filter((w) => w.kind === 'training');
  const sum = (l) => l.reduce((n, a) => n + Number(a.distance_km || 0), 0);
  add('bike1', 'Primera pedalada', 'Registra tu primera salida en bici', 'bronze', bike.length, 1);
  add('bike100', 'Cien en bici', 'Acumula 100 km en bicicleta', 'silver', sum(bike), 100, 'km');
  add('bike500', 'Rutero', 'Acumula 500 km en bicicleta', 'gold', sum(bike), 500, 'km');
  add('swim1', 'Al agua', 'Registra tu primera sesión de natación', 'bronze', swim.length, 1);
  add('swim10', 'Diez kilómetros nadados', 'Acumula 10 km de natación', 'silver', sum(swim), 10, 'km');
  add('swim50', 'Delfín', 'Acumula 50 km de natación', 'gold', sum(swim), 50, 'km');
  add('gym1', 'Primera serie', 'Primer entrenamiento de fuerza', 'bronze', gym.length, 1);
  add('gym25', 'Hierro constante', '25 entrenamientos de fuerza', 'silver', gym.length, 25);
  add('gym100', 'Rutina de acero', '100 entrenamientos de fuerza', 'gold', gym.length, 100);
  add('multi', 'Atleta completo', 'Entrena running, pliometría y fuerza o bici/natación', 'silver', [runs.length, plyo.length, gym.length + bike.length + swim.length].filter((n) => n > 0).length, 3);
  add('share1', 'Compartido', 'Comparte tu primera actividad', 'bronze', shared, 1);
  add('share10', 'Referente del club', 'Comparte 10 actividades', 'silver', shared, 10);
  return list;
}

/** Total de logros (la moneda): logros de cuenta conseguidos + logros ganados en retos. */
export const logrosPoints = (list, challengePoints = 0) => list.filter((l) => l.earned).reduce((n, l) => n + (TIER_POINTS[l.tier] || 0), 0) + challengePoints;

export function logrosMarkup(list, extra = { points: 0, items: [] }, { whose = '' } = {}) {
  const done = list.filter((l) => l.earned).length, account = logrosPoints(list, 0), total = account + extra.points, rank = rankFor(total);
  const tone = `color-mix(in srgb, ${rank.tier.color} 52%, #000)`;
  const coin = (n) => `<span class="lg-pts"><img src="/logro-coin.webp" alt="" width="18" height="18">+${n}</span>`;
  const summary = `<section class="lg-sum" style="--tone:${tone}">
    <p class="lg-sum__who">${whose ? `Logros de ${esc(whose)}` : 'Tus logros'}</p>
    <div class="lg-sum__row"><img class="lg-sum__coin" src="/logro-coin.webp" alt="" width="44" height="44"><b class="lg-sum__n">${total}</b><span class="lg-sum__unit">${total === 1 ? 'moneda' : 'monedas'}</span><span class="lg-sum__rank"><img src="${rank.icon}" alt="" width="26" height="26">${esc(rank.name)}</span></div>
    <i class="lg-bar lg-bar--rank"><u style="width:${Math.max(3, Math.round(rank.progress * 100))}%"></u></i>
    <p class="lg-sum__next">${rank.next ? `${whose ? 'Faltan' : 'Te faltan'} <b>${rank.missing}</b> para ${esc(rank.nextName)}` : 'Rango máximo'}</p>
    <small>Cuenta: ${account} · Retos: ${extra.points}</small></section>`;
  const items = list.map((l) => `<article class="lg-item lg-item--${l.tier} ${l.earned ? 'is-earned' : ''}" title="${esc(l.desc)}"><span class="lg-ico">${ICON.trophy}</span><div class="lg-body"><b>${esc(l.title)}</b><small>${esc(l.desc)}</small>${l.earned ? '<em>Conseguido</em>' : `<i class="lg-bar"><u style="width:${Math.max(2, Math.round(l.have / l.need * 100))}%"></u></i><em>${fmt(l.have, l.unit ? 1 : 0)} / ${l.need}${l.unit ? ' ' + l.unit : ''}</em>`}</div>${coin(TIER_POINTS[l.tier])}</article>`).join('');
  const retos = extra.items.length ? `<section class="lg-list"><h3 class="lg-h">Retos completados</h3>${extra.items.map((r) => `<article class="lg-item is-earned"><span class="lg-ico">${ICON.trophy}</span><div class="lg-body"><b>${esc(r.title)}</b></div>${coin(r.reward)}</article>`).join('')}</section>` : '';
  return `${summary}<section class="lg-list"><h3 class="lg-h">Logros <small>${done} de ${list.length}</small></h3>${items}</section>${retos}`;
}

/** Logros de una sola actividad (se guardan al compartir y salen en la tarjeta). */
export function activityLogros({ kind, distanceKm = 0, durationMin = 0, previous = [] }) {
  const out = [];
  if (kind === 'running') {
    const before = previous.filter((a) => a.discipline === 'running');
    if (!before.length) out.push({ tier: 'gold', text: '¡Tu primera carrera registrada!' });
    const prevMax = Math.max(0, ...before.map((a) => Number(a.distance_km || 0)));
    if (before.length && distanceKm > prevMax) out.push({ tier: 'gold', text: '¡Tu carrera más larga hasta hoy!' });
    const pace = distanceKm >= 1 && durationMin > 0 ? durationMin / distanceKm : 0;
    const prevPaces = before.filter((a) => Number(a.distance_km) >= 1 && Number(a.duration_min) > 0).map((a) => a.duration_min / a.distance_km);
    if (pace && prevPaces.length && pace < Math.min(...prevPaces)) out.push({ tier: 'silver', text: '¡Tu ritmo medio más rápido!' });
    for (const k of [5, 10, 21]) if (distanceKm >= k && !before.some((a) => Number(a.distance_km) >= k)) out.push({ tier: 'bronze', text: `¡Tu primera carrera de ${k} km!` });
  } else if (kind === 'plyo') {
    const n = previous.filter((w) => w.kind === 'plyometrics').length + 1;
    if (n === 1) out.push({ tier: 'gold', text: '¡Tu primera sesión de pliometría!' });
    else if ([10, 25, 50, 100].includes(n)) out.push({ tier: 'silver', text: `¡Sesión ${n} de pliometría!` });
  }
  return out.slice(0, 3);
}

/* ───────────── Feed de tarjetas ───────────── */

const dateLabel = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-BO', { day: 'numeric', month: 'long', year: 'numeric' });
const clock = (sec) => { sec = Math.round(sec || 0); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(s).padStart(2, '0')} s`; };
const initials = (name) => (name || 'BC').split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

function statsMarkup(a) {
  const s = a.stats || {}, main = [], extra = [];
  if (a.kind === 'running') {
    main.push(['Distancia', `${fmt(s.distance_km, 2)} km`]);
    main.push(['Ritmo', s.distance_km && s.duration_sec ? `${paceStr(Number(s.distance_km), s.duration_sec / 60)} /km` : '—']);
    main.push(['Tiempo', clock(s.duration_sec)]);
    if (s.elevation_m) extra.push(['Desnivel', `${fmt(s.elevation_m, 0)} m`]);
  } else {
    main.push(['Tiempo', clock(s.duration_sec)]);
    if (s.sets) main.push(['Series', String(s.sets)]);
    if (s.exercises) main.push(['Ejercicios', String(s.exercises)]);
  }
  if (a.effort) extra.unshift(['Esfuerzo', EFFORT_LABEL[a.effort] || String(a.effort)]);
  const cell = ([k, v]) => `<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`;
  return `<div class="act-stats">${main.map(cell).join('')}</div><div class="act-stats act-stats--sub">${extra.map(cell).join('')}</div>`;
}

async function mountRouteMap(el, route) {
  try {
    const [{ default: L }] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
    if (!el.isConnected) return;
    el.innerHTML = '';
    const map = L.map(el, { zoomControl: false, attributionControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    const lines = route.map((seg) => L.polyline(seg, { color: '#10100e', weight: 4, opacity: .95, lineJoin: 'round' }).addTo(map));
    map.fitBounds(L.featureGroup(lines).getBounds(), { padding: [24, 24], maxZoom: 16 });
  } catch { el.innerHTML = '<p class="muted act-map__err">No se pudo cargar el mapa.</p>'; }
}

export async function renderSharedFeed(box, ctx) {
  box.innerHTML = '<p class="muted">Cargando actividades…</p>';
  const me = ctx.user.id;
  const { data: edges = [], error: fe } = await supabase.from('friendships').select('requester,addressee').eq('status', 'accepted').or(`requester.eq.${me},addressee.eq.${me}`);
  if (fe) { box.innerHTML = `<div class="card warn">No se pudieron cargar las actividades: ${esc(fe.message)}</div>`; return; }
  const owners = [me, ...edges.map((e) => (e.requester === me ? e.addressee : e.requester))];
  const [{ data: acts, error }, { data: directory = [] }] = await Promise.all([
    supabase.from('shared_activities').select('*').in('user_id', owners).order('created_at', { ascending: false }).limit(40),
    supabase.rpc('profile_directory'),
  ]);
  if (error) { box.innerHTML = `<div class="card warn">Aún no se pueden mostrar actividades compartidas. Falta aplicar la migración 0023 en Supabase. (${esc(error.message)})</div>`; return; }
  if (!acts.length) { box.innerHTML = '<div class="card profile-empty">Todavía no hay actividades compartidas. Al terminar una carrera o sesión puedes activar «Compartir actividad» y aparecerá aquí para ti y tus amigos.</div>'; return; }

  // Las que compartiste antes pueden venir con datos incompletos: se completan con la carrera original (solo se puede leer la tuya).
  const srcIds = acts.filter((a) => a.user_id === me && a.kind === 'running' && a.source_id).map((a) => a.source_id);
  if (srcIds.length) {
    const { data: src = [] } = await supabase.from('activities').select('*').in('id', srcIds);
    const byId = new Map((src || []).map((r) => [r.id, r]));
    acts.forEach((a) => {
      const r = byId.get(a.source_id); if (!r) return;
      const st = { ...(a.stats || {}) }, dur = st.duration_sec || r.duration_sec || r.duration_seconds || (r.duration_min ? Math.round(Number(r.duration_min) * 60) : 0);
      if (!st.distance_km && r.distance_km) st.distance_km = Number(r.distance_km);
      if (!st.duration_sec && dur) st.duration_sec = dur;
      if (!st.elevation_m && r.elevation_gain_m) st.elevation_m = r.elevation_gain_m;
      a.stats = st;
      if (!a.effort && r.rpe) a.effort = r.rpe;
      if (!a.route?.length) { const rc = compactRoute(Array.isArray(r.route_segments) && r.route_segments.length ? r.route_segments : r.route_points || []); if (rc.length) a.route = rc; }
      if (!(a.photos || []).length && (r.activity_photos || []).length) a._srcPhotos = r.activity_photos.slice(0, 3); // solo para mostrar: al quitar la actividad no se borran las fotos de la carrera
    });
  }

  const ids = acts.map((a) => a.id);
  const [likesRes, commentsRes] = await Promise.all([
    supabase.from('activity_likes').select('activity_id,user_id').in('activity_id', ids),
    supabase.from('activity_comments').select('id,activity_id,user_id,body,created_at').in('activity_id', ids).order('created_at', { ascending: true }),
  ]);
  let likes = likesRes.data || [], comments = commentsRes.data || [];
  // Me gusta de comentarios (si aún no existe la tabla, simplemente no se muestran)
  const clRes = comments.length ? await supabase.from('comment_likes').select('comment_id,user_id').eq('kind', 'activity').in('comment_id', comments.map((x) => x.id)) : { data: [] };
  let commentLikes = clRes.error ? null : clRes.data || [];
  const people = new Map(directory.map((p) => [p.id, p]));
  people.set(me, { id: me, full_name: ctx.profile?.full_name || 'Tú', avatar_path: ctx.profile?.avatar_path, avatar_url: ctx.profile?.avatar_url });
  const sign = async (path) => (path ? (await supabase.storage.from('profile-media').createSignedUrl(path, 1800)).data?.signedUrl || '' : '');
  const avatars = new Map(await Promise.all([...new Set(acts.map((a) => a.user_id))].map(async (id) => [id, await avatarSrc(people.get(id), 1800)])));
  const photos = new Map(await Promise.all(acts.map(async (a) => [a.id, await Promise.all((a.photos?.length ? a.photos : a._srcPhotos || []).map(sign))])));
  const nameOf = (id) => people.get(id)?.full_name || 'Socio Batmon';

  // Se desliza hacia un lado: primero las fotos, después el mapa del recorrido.
  const mediaMarkup = (a) => {
    const pics = (photos.get(a.id) || []).filter(Boolean), hasMap = !!a.route?.length, n = pics.length + (hasMap ? 1 : 0);
    if (!n) return '';
    return `<div class="act-media"><div class="act-slides" data-slides>${pics.map((u) => `<div class="act-slide"><img src="${esc(u)}" alt="Foto de la actividad" loading="lazy"></div>`).join('')}${hasMap ? '<div class="act-slide"><div class="act-map" data-route aria-label="Mapa del recorrido"></div></div>' : ''}</div>${n > 1 ? `<div class="act-dots" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('')}</div>` : ''}</div>`;
  };

  const cardMarkup = (a) => {
    const own = a.user_id === me, name = nameOf(a.user_id), logros = a.stats?.logros || [];
    return `<article class="card act-card" data-act="${a.id}">
      <header class="act-head"><button type="button" class="act-avatar" data-avatar aria-label="Ver foto de ${esc(name)}">${avatars.get(a.user_id) ? avatarImg(avatars.get(a.user_id)) : esc(initialsOf(name))}</button>
        <div class="act-who"><b>${esc(own ? `${name} (tú)` : name)}</b><small>${esc(dateLabel(a.performed_on))}${a.visibility === 'close' ? ' · Mejores amigos' : ''}</small><small class="act-place"><span class="act-kind">${a.kind === 'running' ? ICON.run : ICON.dumbbell}</span>${a.place ? esc(a.place) : a.kind === 'running' ? 'Carrera' : 'Pliometría'}</small></div>
        <span class="act-tools">${own ? '<button type="button" class="act-del" data-del aria-label="Eliminar actividad" title="Eliminar"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g class="tr-lid"><path d="M4 6.5h16"/><path d="M9.5 6.5V4.25h5V6.5"/></g><path d="M6.2 6.5l.9 13.25h9.8l.9-13.25"/><path d="M10.25 10.5v5.5M13.75 10.5v5.5"/></svg></button>' : ''}</span></header>
      ${mediaMarkup(a)}
      <h2 class="act-title">${esc(a.title)}</h2>
      ${statsMarkup(a)}
      ${own && logros.length ? `<div class="act-logros">${logros.map((l) => `<div class="act-logro act-logro--${esc(l.tier)}"><span>${ICON.trophy}</span><b>${esc(l.text)}</b></div>`).join('')}</div>` : ''}
      ${a.description ? `<p class="act-desc">${esc(a.description)}</p>` : ''}
      <div class="act-foot" data-foot></div></article>`;
  };

  const likesLine = (a) => {
    const l = likes.filter((x) => x.activity_id === a.id), liked = l.some((x) => x.user_id === me), c = comments.filter((x) => x.activity_id === a.id);
    const others = l.filter((x) => x.user_id !== me).map((x) => nameOf(x.user_id).split(' ')[0]);
    const text = !l.length ? '' : liked ? (others.length ? `Te gusta a ti y a ${others.length} más` : 'Te gusta a ti') : `Les gusta a ${others.slice(0, 2).join(', ')}${others.length > 2 ? ` y ${others.length - 2} más` : ''}`;
    return text;
  };
  const footMarkup = (a) => {
    const l = likes.filter((x) => x.activity_id === a.id), liked = l.some((x) => x.user_id === me), c = comments.filter((x) => x.activity_id === a.id);
    return `<div class="act-actions">${likeMarkup(liked, l.length)}<button type="button" class="act-talk" data-comments aria-label="Comentarios">${TALK_ICON}<span class="act-count">${c.length || ''}</span></button><button type="button" data-native aria-label="Compartir">${ICON.share}</button></div>
      <p class="act-likes"${likesLine(a) ? '' : ' hidden'}>${esc(likesLine(a))}</p>`;
  };

  box.innerHTML = `<div class="act-list">${acts.map(cardMarkup).join('')}</div>`;
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { observer.unobserve(e.target); const a = acts.find((x) => x.id === e.target.closest('[data-act]').dataset.act); mountRouteMap(e.target, a.route); } }), { rootMargin: '200px' }) : null;

  const paintFoot = (card) => {
    const a = acts.find((x) => x.id === card.dataset.act), foot = $('[data-foot]', card);
    foot.innerHTML = footMarkup(a);
    const likeBtn = foot.querySelector('[data-like]'), countOf = () => likes.filter((x) => x.activity_id === a.id).length, isLiked = () => likes.some((x) => x.activity_id === a.id && x.user_id === me);
    const ctl = mountLike(likeBtn, { liked: isLiked(), count: countOf() }), setLine = () => { const p = foot.querySelector('.act-likes'); p.textContent = likesLine(a); p.hidden = !p.textContent; };
    likeBtn.onclick = async () => {
      const was = isLiked();
      if (was) likes = likes.filter((x) => !(x.activity_id === a.id && x.user_id === me)); else likes.push({ activity_id: a.id, user_id: me });
      ctl.set(!was, countOf()); setLine(); // la animación corre sobre el mismo botón: no se vuelve a dibujar todo
      const { error: e } = was ? await supabase.from('activity_likes').delete().eq('activity_id', a.id).eq('user_id', me) : await supabase.from('activity_likes').insert({ activity_id: a.id });
      if (e) { notify(e.message); if (was) likes.push({ activity_id: a.id, user_id: me }); else likes = likes.filter((x) => !(x.activity_id === a.id && x.user_id === me)); ctl.set(was, countOf()); setLine(); }
    };
    const openSheet = () => openComments({
      getList: () => comments.filter((x) => x.activity_id === a.id).map((x) => ({ id: x.id, name: nameOf(x.user_id), body: x.body, at: x.created_at, mine: x.user_id === me, ...(commentLikes ? { likes: commentLikes.filter((l) => l.comment_id === x.id).length, liked: commentLikes.some((l) => l.comment_id === x.id && l.user_id === me) } : {}) })),
      onLike: async (id, want) => {
        const { error: err } = want ? await supabase.from('comment_likes').insert({ kind: 'activity', comment_id: id }) : await supabase.from('comment_likes').delete().eq('kind', 'activity').eq('comment_id', id).eq('user_id', me);
        if (err) { notify(err.message); return false; }
        commentLikes = want ? [...commentLikes, { comment_id: id, user_id: me }] : commentLikes.filter((l) => !(l.comment_id === id && l.user_id === me)); return true;
      },
      canDelete: (x) => x.mine || ctx.isAdmin,
      onSend: async (body) => {
        const { data, error: err } = await supabase.from('activity_comments').insert({ activity_id: a.id, body }).select('id,activity_id,user_id,body,created_at').single();
        if (err) { notify(err.message); return false; }
        comments.push(data); return true;
      },
      onDelete: async (id) => {
        const { error: err } = await supabase.from('activity_comments').delete().eq('id', id);
        if (err) { notify(err.message); return false; }
        comments = comments.filter((x) => x.id !== id); return true;
      },
      onClose: () => paintFoot(card),
    });
    foot.querySelector('[data-comments]').onclick = openSheet;
    foot.querySelector('[data-native]').onclick = async () => {
      const text = `${a.title} · ${nameOf(a.user_id)} en Batmon Crowd`;
      try { if (navigator.share) await navigator.share({ title: a.title, text, url: location.origin }); else { await navigator.clipboard.writeText(`${text} ${location.origin}`); notify('Enlace listo para pegar.', 'success'); } } catch { /* cancelado */ }
    };
  };

  box.querySelectorAll('[data-act]').forEach((card) => {
    paintFoot(card);
    const slides = card.querySelector('[data-slides]');
    if (slides) slides.addEventListener('scroll', () => { const i = Math.round(slides.scrollLeft / slides.clientWidth); card.querySelectorAll('.act-dots i').forEach((d, k) => d.classList.toggle('on', k === i)); }, { passive: true });
    const mapEl = card.querySelector('[data-route]'), a = acts.find((x) => x.id === card.dataset.act);
    if (mapEl) { if (observer) observer.observe(mapEl); else mountRouteMap(mapEl, a.route); }
    const av = card.querySelector('[data-avatar]');
    if (av) av.onclick = () => openPhotoViewer(avatars.get(a.user_id), nameOf(a.user_id));
    const del = card.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      const remove = async () => {
      const { error: err } = await supabase.from('shared_activities').delete().eq('id', a.id);
      if (err) { notify(err.message); return; }
      const removed = a.photos || []; if (removed.length) await supabase.storage.from('profile-media').remove(removed);
      card.remove(); notify('Actividad quitada.', 'success');
      };
      const pic = (photos.get(a.id) || []).find(Boolean);
      if (pic) { openShredder({ name: 'actividad', image: pic, onCommit: remove }); return; } // con foto: se tritura la foto publicada
      if (await confirmDialog('La actividad dejará de verse en el club. Seguirá guardada en tu historial.', '¿Eliminar actividad?')) remove(); // sin foto: confirmación normal
    };
  });
}
