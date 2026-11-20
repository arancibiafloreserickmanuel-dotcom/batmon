// Páginas del Club: feed de eventos, página de evento (ya no es modal), retos en tarjetas y página de reto.
import { supabase, $, esc } from '../supabase.js';
import { notify, confirmDialog } from './common.js';
import { avatarSrc, avatarImg, initialsOf } from './avatar.js';
import { mountRouteMap, routeSummary } from './route-picker.js';
import { setPlannedRoute } from './route-tools.js';

const DISC = { running: 'Running', cycling: 'Ciclismo', swimming: 'Natación', plyo: 'Pliometría', training: 'Entrenamiento' };
const ICON = {
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M5 12v8h14v-8"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 3h10v5a5 5 0 0 1-10 0V3zM4 4h3v2H5a1 1 0 0 0 0 2h2.2A7 7 0 0 0 7.700 10H5a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2zm16 0a2 2 0 0 1 2 2v1a3 3 0 0 1-3 3h-2.700a7 7 0 0 0 .5-2H19a1 1 0 0 0 0-2h-2V4h3zM11 14h2v3h3v2H8v-2h3z"/></svg>',
};

const routeCardMarkup = (route, id, canRun) => `<section class="card route-card"><div class="profile-section-head"><div><span class="muted">${esc(routeSummary(route))}</span><h2>Ruta</h2></div></div><div class="route-map" id="${id}-map"></div>${canRun ? `<button type="button" class="btn" id="${id}-run">Usar esta ruta en Running</button>` : ''}</section>`;
function bindRouteCard(root, route, id, ctx) {
  mountRouteMap(root.querySelector(`#${id}-map`), route);
  const run = root.querySelector(`#${id}-run`);
  if (run) run.onclick = () => { setPlannedRoute(ctx.user.id, { ...route, set_at: Date.now() }); try { localStorage.setItem(`batmon_running_page_${ctx.user.id}`, 'run'); } catch { /* sin almacenamiento */ } notify('Ruta lista en Running.', 'success'); location.hash = '#running'; };
}
const fullDate = (d) => new Date(d).toLocaleDateString('es-BO', { day: 'numeric', month: 'long', year: 'numeric' });
const goBack = () => { if (history.length > 1) history.back(); else location.hash = '#club'; };

async function eventImage(ev) {
  if (!ev.image_path) return '';
  if (ev.image_path.startsWith('http')) return ev.image_path;
  const { data } = await supabase.storage.from('event-media').createSignedUrl(ev.image_path, 3600);
  return data?.signedUrl || '';
}

export const eventHref = (id, from) => { if (from) sessionStorage.setItem('batmon_event_from', from); return `#evento/${id}`; };

/* ───────────── Club → Eventos: scroll tipo red social ───────────── */
export async function renderEventsFeed(box) {
  const { data: events = [], error } = await supabase.from('events').select('id,title,description,event_date,location,image_path,category,created_at').order('event_date', { ascending: false });
  if (error) { box.innerHTML = `<div class="card warn">No se pudieron cargar los eventos: ${esc(error.message)}</div>`; return; }
  if (!events.length) { box.innerHTML = '<div class="card profile-empty">Todavía no hay eventos publicados.</div>'; return; }
  const now = Date.now();
  const upcoming = events.filter((e) => new Date(e.event_date) >= now).sort((a, b) => new Date(a.event_date) - new Date(b.event_date));
  const past = events.filter((e) => new Date(e.event_date) < now);
  const imgs = new Map(await Promise.all(events.map(async (e) => [e.id, await eventImage(e)])));
  const card = (e, isPast) => `<a class="card ev-card ${isPast ? 'is-past' : ''}" href="${eventHref(e.id, 'club')}">
    ${imgs.get(e.id) ? `<div class="ev-card__img"><img src="${esc(imgs.get(e.id))}" alt="" loading="lazy"></div>` : '<div class="ev-card__img ev-card__img--empty"></div>'}
    <div class="ev-card__body"><span class="ev-card__date">${esc(fullDate(e.event_date))}${isPast ? ' · Finalizado' : ''}</span><h2>${esc(e.title)}</h2>
      ${e.location ? `<p class="ev-card__line">${ICON.pin}${esc(e.location)}</p>` : ''}${e.category ? `<span class="ev-chip">${esc(e.category)}</span>` : ''}
      ${e.description ? `<p class="ev-card__desc">${esc(e.description)}</p>` : ''}</div></a>`;
  box.innerHTML = `<div class="ev-feed">${upcoming.length ? `<h3 class="ev-section">Próximos eventos</h3>${upcoming.map((e) => card(e, false)).join('')}` : ''}${past.length ? `<h3 class="ev-section">Eventos anteriores</h3>${past.map((e) => card(e, true)).join('')}` : ''}</div>`;
}

/* ───────────── Página de evento (#evento/<id>) ───────────── */
export async function renderEventPage(view, ctx, eventId) {
  view.innerHTML = '<p class="card muted">Cargando evento…</p>';
  const { data: event, error } = await supabase.from('events').select('*').eq('id', eventId).single();
  if (error || !event) { view.innerHTML = `<div class="card warn">No se pudo abrir el evento.</div><button class="btn ghost" type="button" id="ev-back-err">Volver</button>`; $('#ev-back-err', view).onclick = goBack; return; }
  const [{ data: rsvp }, { data: confirmedRows }, { data: directoryRows }, image] = await Promise.all([
    supabase.from('event_rsvps').select('id,status').eq('event_id', eventId).eq('user_id', ctx.user.id).maybeSingle(),
    supabase.from('event_rsvps').select('user_id').eq('event_id', eventId).eq('status', 'confirmed'),
    supabase.rpc('profile_directory'),
    eventImage(event),
  ]);
  const confirmed = confirmedRows || [], directory = directoryRows || [];
  const people = await Promise.all(confirmed.map(async (row) => {
    const person = row.user_id === ctx.user.id ? ctx.profile : directory.find((p) => p.id === row.user_id);
    return { name: person?.full_name || 'Socio Batmon', avatar: await avatarSrc(person, 1800) };
  }));
  const d = new Date(event.event_date);
  const timeLabel = d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
  const facts = [['Terreno', event.terrain], ['Precio', event.price], ['Desnivel', event.elevation], ['Temperatura', event.temperature], ['Humedad', event.humidity], ['Viento', event.wind]].filter(([, v]) => v);
  const desc = event.description || '', longDesc = desc.length > 180, hasMore = !!(event.more_info || longDesc);
  const isUrl = /^https?:\/\//i.test(event.more_info || '');
  const past = d < new Date();

  view.innerHTML = `<article class="event-page">
    <div class="event-page__cover ${image ? '' : 'is-empty'}">${image ? `<img src="${esc(image)}" alt="">` : ''}<button type="button" class="event-page__round event-page__round--back" id="ev-back" aria-label="Volver">${ICON.back}</button><button type="button" class="event-page__round event-page__round--share" id="ev-share" aria-label="Compartir evento">${ICON.share}</button></div>
    <div class="event-page__body">
      <span class="event-page__date">${esc(fullDate(event.event_date))}${past ? ' · Finalizado' : ''}</span>
      <h1 class="event-page__title">${esc(event.title)}</h1>
      ${event.location ? `<p class="event-page__line">${ICON.pin}${esc(event.location)}</p>` : ''}
      <p class="event-page__line">${event.category ? esc(event.category) + ' · ' : ''}${people.length} confirmado${people.length === 1 ? '' : 's'} del club</p>
      ${event.category ? `<span class="ev-chip">${esc(event.category)}</span>` : ''}
      ${desc ? `<p class="event-page__desc ${longDesc ? 'is-clamped' : ''}" id="ev-desc">${esc(desc)}</p>` : ''}
      ${hasMore ? '<button type="button" class="btn ghost event-page__more" id="ev-more">Más información</button>' : ''}
      <div class="event-detail-meta"><div class="event-detail-info-card"><small>HORA</small><b>${timeLabel}</b></div><div class="event-detail-info-card"><small>LUGAR</small><b>${esc(event.location || 'Por confirmar')}</b></div></div>
      ${event.route ? routeCardMarkup(event.route, 'ev-route', !!ctx.modules?.running) : ''}
      ${facts.length ? `<div class="event-facts">${facts.map(([k, v]) => `<div><small>${k}</small><b>${esc(v)}</b></div>`).join('')}</div>` : ''}
      <div class="event-detail-actions"><button class="btn ${rsvp?.status === 'confirmed' ? 'is-confirmed' : ''}" data-confirm>${rsvp?.status === 'confirmed' ? 'Voy ✓' : 'Voy'}</button><button class="btn ghost" data-cancel>No voy</button></div>
      <section class="event-attendees" aria-label="Personas confirmadas"><p><b>${people.length} confirmados</b></p><div class="event-attendee-list">${people.length ? people.map((p) => `<div class="event-attendee">${p.avatar ? avatarImg(p.avatar) : `<span class="event-attendee-initials">${esc(initialsOf(p.name))}</span>`}<small>${esc(p.name)}</small></div>`).join('') : '<span class="muted">Aún no hay confirmaciones.</span>'}</div></section>
    </div></article>`;

  $('#ev-back', view).onclick = goBack;
  if (event.route) bindRouteCard(view, event.route, 'ev-route', ctx);
  $('#ev-share', view).onclick = async () => {
    const url = `${location.origin}/app.html#evento/${eventId}`;
    try { if (navigator.share) await navigator.share({ title: event.title, url }); else { await navigator.clipboard.writeText(url); notify('Enlace listo para pegar.', 'success'); } } catch { /* cancelado */ }
  };
  const more = $('#ev-more', view);
  if (more) more.onclick = () => {
    const el = $('#ev-desc', view);
    if (event.more_info && isUrl) { window.open(event.more_info, '_blank', 'noopener'); return; }
    const open = more.dataset.open !== '1';
    more.dataset.open = open ? '1' : '0';
    more.textContent = open ? 'Mostrar menos' : 'Más información';
    if (el) el.classList.toggle('is-clamped', !open && longDesc);
    let extra = $('#ev-extra', view);
    if (open && event.more_info && !isUrl) { if (!extra) { extra = document.createElement('div'); extra.id = 'ev-extra'; extra.className = 'event-page__extra'; more.before(extra); } extra.textContent = event.more_info; }
    else if (extra) extra.remove();
  };
  const save = async (status, okMsg) => {
    const { error: e } = await supabase.from('event_rsvps').upsert({ event_id: eventId, user_id: ctx.user.id, status, updated_at: new Date().toISOString() }, { onConflict: 'event_id,user_id' });
    if (e) { notify('No se pudo actualizar: ' + e.message); return; }
    notify(okMsg, 'success'); renderEventPage(view, ctx, eventId);
  };
  $('[data-confirm]', view).onclick = (e) => { e.currentTarget.disabled = true; save('confirmed', 'Asistencia confirmada.'); };
  $('[data-cancel]', view).onclick = async (e) => {
    const msg = rsvp?.status === 'confirmed' ? '¿Confirmas que no asistirás a este evento? Se quitará tu confirmación.' : '¿Quieres indicar que no asistirás a este evento?';
    if (!(await confirmDialog(msg, 'No voy'))) return;
    e.currentTarget.disabled = true; save('cancelled', 'Tu respuesta quedó registrada.');
  };
}

/* ───────────── Retos: tarjetas con filtros ───────────── */
let discFilter = 'all';
const status = (c) => { const now = new Date(); return now < new Date(`${c.starts_on}T00:00:00`) ? 'Próximamente' : now > new Date(`${c.ends_on}T23:59:59`) ? 'Finalizado' : 'En curso'; };
const unitOf = (c) => (c.metric === 'distance_km' ? 'km' : 'sesiones');
const badgeMarkup = (c) => `<span class="reto-badge" aria-hidden="true">${c.badge ? esc(c.badge) : ICON.trophy}</span>`;
export const challengeHref = (id) => `#reto/${id}`;

export async function renderChallenges(box, ctx) {
  const [{ data: challenges = [], error }, { data: joined = [] }, { data: parts = [] }] = await Promise.all([
    supabase.from('club_challenges').select('*').order('starts_on', { ascending: false }),
    supabase.from('challenge_participants').select('challenge_id').eq('user_id', ctx.user.id),
    supabase.from('challenge_participants').select('challenge_id'),
  ]);
  if (error) { box.innerHTML = `<div class="card warn">No se pudieron cargar los retos. Comprueba que esté aplicada la migración 0015: ${esc(error.message)}</div>`; return; }
  const joinedIds = new Set(joined.map((r) => r.challenge_id)), counts = new Map();
  parts.forEach((r) => counts.set(r.challenge_id, (counts.get(r.challenge_id) || 0) + 1));
  const draw = () => {
    const list = challenges.filter((c) => discFilter === 'all' || c.discipline === discFilter);
    box.innerHTML = `<div class="reto-filters" role="group" aria-label="Filtrar retos">${[['all', 'Todos'], ...Object.entries(DISC)].map(([k, l]) => `<button type="button" class="${discFilter === k ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
      ${list.length ? `<div class="reto-grid">${list.map((c) => { const st = status(c), mine = joinedIds.has(c.id);
        return `<article class="card reto-card" data-reto="${c.id}" tabindex="0">${badgeMarkup(c)}<h2>${esc(c.title)}</h2><p class="reto-meta"><span>${esc(DISC[c.discipline] || c.discipline)}</span><span>${st}</span>${c.route ? '<span>Con ruta</span>' : ''}${c.reward_logros ? `<span class="reto-reward">${ICON.trophy}+${c.reward_logros}</span>` : ''}</p>${c.description ? `<p class="reto-desc">${esc(c.description)}</p>` : ''}<p class="reto-dates">${esc(fullDate(c.starts_on + 'T12:00:00'))} – ${esc(fullDate(c.ends_on + 'T12:00:00'))} · Meta ${c.goal_value} ${unitOf(c)}</p><span class="reto-count">${counts.get(c.id) || 0} participantes</span>${mine ? '<span class="reto-joined">Ya participas</span>' : st === 'Finalizado' ? '<span class="reto-joined">Reto finalizado</span>' : `<button type="button" class="btn sm" data-join="${c.id}">Unirse</button>`}</article>`; }).join('')}</div>` : '<div class="card profile-empty">No hay retos en esta categoría.</div>'}`;
    box.querySelectorAll('[data-filter]').forEach((b) => { b.onclick = () => { discFilter = b.dataset.filter; draw(); }; });
    box.querySelectorAll('[data-reto]').forEach((card) => {
      const open = () => { location.hash = challengeHref(card.dataset.reto); };
      card.onclick = (e) => { if (!e.target.closest('[data-join]')) open(); };
      card.onkeydown = (e) => { if (e.key === 'Enter') open(); };
    });
    box.querySelectorAll('[data-join]').forEach((b) => { b.onclick = async () => {
      b.disabled = true;
      const { error: e } = await supabase.from('challenge_participants').insert({ challenge_id: b.dataset.join, user_id: ctx.user.id });
      if (e) { b.disabled = false; notify('No se pudo registrar tu participación: ' + e.message); return; }
      joinedIds.add(b.dataset.join); counts.set(b.dataset.join, (counts.get(b.dataset.join) || 0) + 1); notify('Ya participas en el reto.', 'success'); draw();
    }; });
  };
  draw();
}

/* ───────────── Página de reto (#reto/<id>) ───────────── */
export async function renderChallengePage(view, ctx, id) {
  view.innerHTML = '<p class="card muted">Cargando reto…</p>';
  const [{ data: c, error }, { data: ranking = [] }, { data: mine }] = await Promise.all([
    supabase.from('club_challenges').select('*').eq('id', id).single(),
    supabase.rpc('club_challenge_leaderboard', { p_challenge_id: id }),
    supabase.from('challenge_participants').select('id').eq('challenge_id', id).eq('user_id', ctx.user.id).maybeSingle(),
  ]);
  if (error || !c) { view.innerHTML = '<div class="card warn">No se pudo abrir el reto.</div><button class="btn ghost" type="button" id="rp-back-err">Volver</button>'; $('#rp-back-err', view).onclick = goBack; return; }
  const st = status(c), me = ranking.find((r) => r.user_id === ctx.user.id), score = Number(me?.score || 0), goal = Number(c.goal_value), pct = Math.min(100, Math.round(score / goal * 100));
  view.innerHTML = `<article class="reto-page"><div class="reto-page__top"><button type="button" class="event-page__round" id="rp-back" aria-label="Volver">${ICON.back}</button></div>
    <div class="reto-page__head">${badgeMarkup(c)}<span class="ev-chip">${esc(DISC[c.discipline] || c.discipline)} · ${st}</span><h1 class="event-page__title">${esc(c.title)}</h1></div>
    <div class="event-facts"><div><small>Meta</small><b>${goal} ${unitOf(c)}</b></div><div><small>Recompensa</small><b>+${c.reward_logros ?? 0} logros</b></div><div><small>Participantes</small><b>${ranking.length}</b></div></div>
    ${c.route ? routeCardMarkup(c.route, 'rp-route', !!ctx.modules?.running && c.discipline === 'running') : ''}
    ${c.description ? `<p class="event-page__desc">${esc(c.description)}</p>` : ''}
    <p class="muted">${esc(fullDate(c.starts_on + 'T12:00:00'))} – ${esc(fullDate(c.ends_on + 'T12:00:00'))}. Los logros ganados cuentan para subir de rango.</p>
    ${mine ? `<section class="card reto-progress"><b>Tu progreso</b><span>${fmtNum(score)} / ${goal} ${unitOf(c)}${me?.completed ? ' · ¡Completado!' : ''}</span><i class="rank-card__bar"><u style="width:${pct}%"></u></i></section>` : ''}
    <div class="event-detail-actions">${mine ? (st !== 'Finalizado' ? '<button class="btn ghost" id="rp-leave" type="button">Salir del reto</button>' : '') : st === 'Finalizado' ? '' : '<button class="btn" id="rp-join" type="button">Unirse al reto</button>'}</div>
    <section class="card"><h2>Clasificación</h2>${ranking.length ? `<ol class="reto-rank">${[...ranking].sort((a, b) => b.score - a.score).map((r) => `<li><b>${esc(r.full_name || 'Socio')}</b><span>${fmtNum(r.score)} ${unitOf(c)}${r.completed ? ' · Meta cumplida' : ''}</span></li>`).join('')}</ol>` : '<p class="muted">Aún no hay participantes.</p>'}</section></article>`;
  $('#rp-back', view).onclick = goBack;
  if (c.route) bindRouteCard(view, c.route, 'rp-route', ctx);
  const join = $('#rp-join', view);
  if (join) join.onclick = async () => { join.disabled = true; const { error: e } = await supabase.from('challenge_participants').insert({ challenge_id: id, user_id: ctx.user.id }); if (e) { join.disabled = false; notify('No se pudo unir: ' + e.message); return; } notify('Ya participas en el reto.', 'success'); renderChallengePage(view, ctx, id); };
  const leave = $('#rp-leave', view);
  if (leave) leave.onclick = async () => { if (!(await confirmDialog('¿Salir de este reto?', 'Salir'))) return; const { error: e } = await supabase.from('challenge_participants').delete().eq('challenge_id', id).eq('user_id', ctx.user.id); if (e) { notify(e.message); return; } renderChallengePage(view, ctx, id); };
}
const fmtNum = (n) => (Math.round(Number(n || 0) * 10) / 10).toLocaleString('es-BO');
