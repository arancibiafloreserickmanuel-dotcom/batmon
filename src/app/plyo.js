import { supabase, $, esc } from '../supabase.js';
import { fmt, today, num, LEVEL, draft, confirmDialog, notify, weekStart, monthStart } from './common.js';

const DRAFT_KEY = 'batmon_plyo_draft_v2';
const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const FIELD_LABELS = { // clave BD -> [etiqueta corta, step]
  reps: ['Reps', 1], contacts: ['Contactos', 1], height_cm: ['Altura cm', 0.5],
  box_height_cm: ['Cajón cm', 1], distance_m: ['Dist. m', 0.1], weight_kg: ['Peso kg', 0.5], rest_sec: ['Desc. s', 5],
};
const REST_PRESETS = [30, 45, 60, 90, 120, 180];
const name = (e) => esc(e?.name_es || e?.name || '?');
const thumb = (e, cls = 'th') => (e?.images?.[0] ? `<img class="${cls}" loading="lazy" src="/exercises/${esc(e.images[0])}" alt="">` : `<div class="${cls} ph">?</div>`);
const fmtClock = (s) => { s = Math.max(0, Math.round(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

// Determina qué parámetros aplican a un ejercicio según su tipo de movimiento.
// Es una heurística por palabras clave: no exige una columna nueva en el catálogo
// y respeta los 61 ejercicios e imágenes ya importados.
function fieldsFor(exercise) {
  const s = `${exercise?.id || ''} ${exercise?.name || ''} ${exercise?.name_es || ''} ${exercise?.equipment || ''}`.toLowerCase();
  if (/caj[oó]n|\bbox\b/.test(s)) return ['reps', 'box_height_cm', 'rest_sec'];
  if (/drop/.test(s)) return ['contacts', 'height_cm', 'rest_sec'];
  if (/horizontal|broad|bound|salto largo|long jump/.test(s)) return ['contacts', 'distance_m', 'rest_sec'];
  if (/medic|bal[oó]n|throw|lanza|slam/.test(s)) return ['reps', 'weight_kg', 'distance_m', 'rest_sec'];
  if (/vertical|tuck|squat jump|cmj|depth|rebote|hop/.test(s)) return ['reps', 'height_cm', 'rest_sec'];
  return ['reps', 'rest_sec'];
}
const blankSetFor = (exercise) => Object.fromEntries(fieldsFor(exercise).map((k) => [k, '']));
const blankW = () => ({ date: today(), duration: '', rpe: '', notes: '', items: [], routineId: null, planDay: null, status: 'active' });

let catalog = [];          // ejercicios activos de pliometría
let section = 'train';     // train | plan | progress
let activeView = 'home';   // dentro de "train": home | session
let W = null;               // sesión en construcción/continuación
let ownerKey = '';
let weekPlan = {};          // { Lunes: {routineId} | {rest:true}, ... }
let routines = [];          // rutinas guardadas (plyo_routines)
let selectedPlanDay = DAYS[(new Date().getDay() + 6) % 7];
let copiedDay = null;       // {routineId:string|null, rest:boolean} | null
let progressPeriod = 'week';
const userDraftKey = () => `${DRAFT_KEY}_${ownerKey}`;

function modal(html) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="sheet">${html}</div>`;
  m.onclick = (e) => { if (e.target === m) m.remove(); };
  document.body.appendChild(m);
  return m;
}

export async function renderPlyo(view, ctx) {
  if (!ctx.canRegister) {
    view.innerHTML = '<h1>Pliometría</h1><div class="card warn">Tu membresía del mes aún no está aprobada. Cuando se apruebe podrás registrar sesiones. <a href="#pago">Ir a Membresía</a></div>';
    return;
  }
  if (ownerKey !== ctx.user.id) { ownerKey = ctx.user.id; W = null; section = 'train'; activeView = 'home'; planPage = null; dayDraft = null; }
  const [{ data: exData = [], error: exError }, { data: planRow }, { data: routineRows = [], error: routineError }] = await Promise.all([
    supabase.from('exercises').select('*').eq('category', 'plyometrics').eq('is_active', true).order('name'),
    supabase.from('plyo_plans').select('plan').eq('user_id', ctx.user.id).maybeSingle(),
    supabase.from('plyo_routines').select('*').eq('user_id', ctx.user.id).order('created_at'),
  ]);
  if (exError) { view.innerHTML = `<p class="msg">No se pudo cargar el catálogo: ${esc(exError.message)}</p>`; return; }
  catalog = exData; weekPlan = planRow?.plan || {}; routines = routineRows;
  if (routineError) notify('No se pudieron cargar tus rutinas guardadas: ' + routineError.message);
  W = W || draft.get(userDraftKey());

  const sub = (section === 'plan' && !!planPage) || (section === 'train' && activeView === 'session' && !!W);
  view.innerHTML = `${sub ? '' : '<h1>Pliometría</h1>'}
    <nav class="running-pages tabs-pill"${sub ? ' hidden' : ''} aria-label="Secciones de Pliometría">
      <input class="tabs-pill__input" type="radio" name="plyo-sec" id="plyo-sec-train" value="train"><label class="tabs-pill__label" for="plyo-sec-train">Entrenar</label>
      <input class="tabs-pill__input" type="radio" name="plyo-sec" id="plyo-sec-plan" value="plan"><label class="tabs-pill__label" for="plyo-sec-plan">Mi plan</label>
      <input class="tabs-pill__input" type="radio" name="plyo-sec" id="plyo-sec-progress" value="progress"><label class="tabs-pill__label" for="plyo-sec-progress">Progreso</label>
      <div class="tabs-pill__indicator" aria-hidden="true"></div>
    </nav>
    <div id="sub"></div>`;
  view.querySelectorAll('.tabs-pill__input').forEach((input) => { input.checked = input.value === section; input.onchange = () => { section = input.value; planPage = null; renderPlyo(view, ctx); }; });
  const box = $('#sub', view);
  if (!catalog.length) {
    box.innerHTML = `<div class="card"><p>El catálogo de ejercicios está vacío.</p><p class="muted">${ctx.isAdmin ? 'Ve a Admin → Ejercicios y pulsa “Importar catálogo base”.' : 'Pídele al administrador que importe el catálogo.'}</p></div>`;
    return;
  }
  if (section === 'train') renderTrain(box, view, ctx);
  else if (section === 'plan') renderPlan(box, view, ctx);
  else await renderProgress(box, view, ctx);
}

/* --------------------------------- Entrenar --------------------------------- */
function renderTrain(box, view, ctx) {
  if (activeView === 'session' && W) { box.innerHTML = '<i class="plyo-subpage-marker" hidden></i>'; const host = document.createElement('div'); box.appendChild(host); drawSession(host, view, ctx); return; }
  const todayDay = DAYS[(new Date().getDay() + 6) % 7];
  const entry = weekPlan[todayDay];
  const routine = entry?.routineId ? routines.find((r) => r.id === entry.routineId) : null;
  const isRest = !!entry?.rest && !routine;
  const hasPending = W && W.status !== 'done';
  const firstEx = routine ? catalog.find((e) => e.id === routine.items[0]?.exercise_id) : null;
  const photo = firstEx?.images?.[0] ? `/exercises/${encodeURI(firstEx.images[0])}` : '';
  const repsOf = (it) => { const t = it.targets || {}; if (t.reps) return `${t.reps}`; if (t.contacts) return `${t.contacts} cont.`; if (t.seconds) return `${t.seconds} s`; if (t.time_sec) return `${t.time_sec} s`; return '—'; };
  const rows = routine ? routine.items.map((it) => {
    const ex = catalog.find((e) => e.id === it.exercise_id);
    return `<div class="plyo-sum__row"><span>${name(ex)}</span><b>${it.target_sets || 1} × ${esc(repsOf(it))}</b></div>`;
  }).join('') : '';
  box.innerHTML = `
    <article class="card rest-card plyo-hero${photo ? ' has-photo' : ''}"${photo ? ` style="--plyo-photo:url('${photo}')"` : ''}>
      <div class="plyo-hero__body">
        <p class="plyo-hero__kicker">${isRest ? 'Hoy' : 'Inicio rápido'}</p>
        <h2 class="plyo-hero__title">${isRest ? 'Descansa' : routine ? name(routine) : 'Sesión libre'}</h2>
        ${isRest ? '<p class="plyo-hero__rest">Recuperación</p>' : routine ? `<button class="btn cal-btn-primary" id="start-today" type="button">Iniciar sesión</button>`
          : `<button class="btn cal-btn-primary" id="start-quick" type="button">Iniciar sesión rápida</button>
             ${routines.length ? `<div class="plyo-hero__saved"><select id="quick-routine" aria-label="Rutina guardada"><option value="">Elegir una rutina guardada…</option>${routines.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select><button class="btn sm ghost" id="start-saved" type="button">Iniciar</button></div>` : ''}`}
      </div>
    </article>
    ${routine ? `<section class="plyo-sum" aria-label="Ejercicios de hoy"><div class="plyo-sum__head"><span>Ejercicio</span><span>Ser/Reps</span></div><div class="plyo-sum__list">${rows}</div></section>`
      : isRest ? ''
      : '<p class="plyo-notice"><b>Sin rutina programada hoy.</b> Arma tu semana en Mi plan o inicia una sesión libre.</p>'}
    ${hasPending ? `<article class="card plyo-pending"><span class="muted">Sesión en curso</span><h2>${W.items.length} ejercicio${W.items.length === 1 ? '' : 's'} sin terminar</h2><div class="quick-actions"><button class="btn" id="continue-session" type="button">Continuar</button><button class="btn ghost" id="discard-session" type="button">Descartar</button></div></article>` : ''}`;
  $('#start-today', box)?.addEventListener('click', () => startRoutineSession(routine, todayDay, view, ctx));
  $('#start-quick', box)?.addEventListener('click', () => { sesReset(true); W = { ...blankW(), cur: 0, startedAt: Date.now() }; draft.set(userDraftKey(), W); activeView = 'session'; renderPlyo(view, ctx); });
  $('#start-saved', box)?.addEventListener('click', () => { const id = $('#quick-routine', box).value; if (!id) { notify('Elige una rutina.'); return; } startRoutineSession(routines.find((r) => r.id === id), null, view, ctx); });
  $('#continue-session', box)?.addEventListener('click', () => { sesReset(true); activeView = 'session'; renderPlyo(view, ctx); });
  $('#discard-session', box)?.addEventListener('click', () => confirmDialog('¿Descartar esta sesión sin guardarla?', 'Descartar sesión').then((ok) => { if (ok) { sesReset(true); W = null; draft.del(userDraftKey()); renderPlyo(view, ctx); } }));
}

async function startRoutineSession(routine, planDay, view, ctx) {
  if (!routine) return;
  const items = routine.items.map((it) => {
    const exercise = catalog.find((e) => e.id === it.exercise_id) || { id: it.exercise_id };
    const fields = fieldsFor(exercise);
    const count = Math.max(1, it.sets?.length || it.target_sets || 3);
    const sets = Array.from({ length: count }, (_, i) => {
      const s = {}; fields.forEach((f) => { s[f] = nz(it.sets?.[i]?.[f] ?? it.targets?.[f] ?? (f === 'contacts' ? it.sets?.[i]?.reps : undefined)); });
      return s;
    });
    return { ex: it.exercise_id, sets, done: false, restSec: it.rest_sec || 60, solo: !!it.solo_reps, note: it.note || '' };
  });
  sesReset(true);
  W = { ...blankW(), items, routineId: routine.id, planDay, cur: 0, startedAt: Date.now() };
  draft.set(userDraftKey(), W); activeView = 'session'; await renderPlyo(view, ctx);
}

/* --------------------------------- Sesión activa (página propia) --------------------------------- */
let sesRestEnd = 0, sesTransAt = 0, sesTick = 0, sesFinishing = false, sesNoteOpen = false, sesAudio = null, sesPrevReady = false;
const sesSave = () => draft.set(userDraftKey(), W);
function sesReset(full) { clearInterval(sesTick); sesRestEnd = 0; sesTransAt = 0; sesFinishing = false; sesNoteOpen = false; if (full) sesPrevReady = false; }
function unlockAudio() { try { sesAudio ||= new (window.AudioContext || window.webkitAudioContext)(); if (sesAudio.state === 'suspended') sesAudio.resume(); } catch { /* sin audio */ } }
function beep() {
  try {
    unlockAudio(); const c = sesAudio; if (!c) return;
    [0, 0.3, 0.6].forEach((t) => { const o = c.createOscillator(), g = c.createGain(), at = c.currentTime + t; o.frequency.value = 880; g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.4, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.24); o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + 0.26); });
  } catch { /* sin audio */ }
}
const sesFields = (it) => { let f = Object.keys(it.sets[0] || {}).filter((k) => k[0] !== '_' && k !== 'rest_sec'); if (it.solo) f = f.filter((k) => k !== 'weight_kg'); return f.length ? f : ['reps']; };
const nz = (v) => (v == null || v === '' || Number(v) === 0 ? '' : String(v));
const sesPrevVal = (it, j, k) => nz((prevSets[it.ex] || [])[j]?.[k]);
function sesRef(it, j, k) { if (j > 0) { const v = it.sets[j - 1][k]; if (v !== '' && v != null) return String(v); } return sesPrevVal(it, j, k); }
function sesPrevLabel(it, j) { const p = (prevSets[it.ex] || [])[j]; if (!p) return '-'; const main = p.reps ?? p.contacts; const w = Number(p.weight_kg) ? `${p.weight_kg}kg×` : ''; return `${w}${main ?? '?'}`; }
const blankSetsFor = (ex, n = 3) => Array.from({ length: n }, () => blankSetFor(ex));

function keypad(label, current, step, onSet) {
  let val = current == null ? '' : String(current), fresh = true;
  const m = modal(`<div class="sheet-h"><b>${esc(label)}</b><button class="link" data-close>Cerrar</button></div>
    <div class="ses-pad__val" id="kv"></div>
    <div class="ses-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '.', 0, '⌫'].map((k) => `<button type="button" data-k="${k}">${k}</button>`).join('')}</div>
    <div class="ses-pad__step"><button type="button" data-d="-1">− ${step}</button><button type="button" data-d="1">+ ${step}</button></div>
    <div class="sheet-f"><button class="btn" id="kok" type="button">Listo</button></div>`);
  const paint = () => { $('#kv', m).textContent = val === '' ? '0' : val; };
  m.querySelector('[data-close]').onclick = () => m.remove();
  m.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.k;
    if (k === '⌫') { val = val.slice(0, -1); fresh = false; }
    else { if (fresh) val = ''; fresh = false; if (k === '.' && val.includes('.')) return; if (val === '0' && k !== '.') val = ''; val += k; }
    paint();
  }));
  m.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { fresh = false; val = String(Math.max(0, +((Number(val || 0)) + Number(b.dataset.d) * step).toFixed(2))); paint(); }));
  $('#kok', m).onclick = () => { onSet(val); m.remove(); };
  paint();
}

function drawSession(box, view, ctx) {
  clearInterval(sesTick);
  if (!W.startedAt) { W.startedAt = Date.now(); sesSave(); }
  if (!sesPrevReady) { sesPrevReady = true; loadPrevSets().then(() => { if (box.isConnected && W && activeView === 'session') drawSession(box, view, ctx); }).catch(() => {}); }
  if (sesFinishing) { drawFinish(box, view, ctx); return; }
  W.cur = Math.min(Math.max(0, W.cur || 0), Math.max(0, W.items.length - 1));
  const redraw = () => drawSession(box, view, ctx);
  const it = W.items[W.cur]; const ex = it ? (catalog.find((c) => c.id === it.ex) || { id: it.ex, name: it.ex }) : null;
  const totalSets = W.items.reduce((n, x) => n + x.sets.length, 0), doneSets = W.items.reduce((n, x) => n + x.sets.filter((s) => s._ok).length, 0);
  const pct = totalSets ? Math.round((doneSets / totalSets) * 100) : 0;
  let table = '';
  if (it) {
    const fields = sesFields(it);
    const firstPending = it.sets.findIndex((s) => !s._ok);
    const shown = firstPending === -1 ? it.sets.length : firstPending + 1;
    table = `<div class="ses-table" style="--c:${fields.length}">
      <div class="ses-row ses-row--head"><span>Serie</span><span>Antes</span>${fields.map((k) => `<span>${FIELD_LABELS[k]?.[0] || k}</span>`).join('')}<span>Desc.</span><span></span></div>
      ${it.sets.slice(0, shown).map((s, j) => {
        const need = it.restSec || 60;
        const desc = s._rest == null ? '<span class="ses-desc">-</span>' : `<span class="ses-desc ${s._rest >= need ? 'ok' : 'low'}" title="Descansaste ${fmtClock(s._rest)} de ${fmtClock(need)}">${fmtClock(s._rest)}</span>`;
        return `<div class="ses-row${s._ok ? ' is-done' : ''}" data-j="${j}"><span class="ses-n">${j + 1}</span><span class="ses-prev">${esc(sesPrevLabel(it, j))}</span>${fields.map((k) => { const v = s[k], r = v === '' || v == null ? sesRef(it, j, k) : ''; return `<button type="button" class="ses-val" data-f="${k}" aria-label="${FIELD_LABELS[k]?.[0] || k}, serie ${j + 1}">${v !== '' && v != null ? esc(v) : r ? `<em>${esc(r)}</em>` : '0'}</button>`; }).join('')}${desc}<button type="button" class="ses-check${s._ok ? ' on' : ''}" data-chk="${j}" aria-label="${s._ok ? 'Desmarcar' : 'Completar'} serie ${j + 1}">${ICON.check}</button></div>`;
      }).join('')}
      ${firstPending === -1 ? '<button type="button" class="pd-addset" id="ses-addset">+ Añadir serie</button>' : ''}</div>`;
  }
  const pv = it ? (prevSets[it.ex] || []).slice(0, it.sets.length).map((s) => s.reps ?? s.contacts).filter((v) => v != null) : [];
  box.innerHTML = `<div class="ses-top">${backBtn('ses-back')}<b class="ses-clock" id="ses-clock">00:00</b><button type="button" class="btn sm" id="ses-finish">Terminar</button></div>
    <div class="plyo-progress ses-progress" aria-label="Avance ${pct}%"><i style="width:${pct}%"></i></div>
    <div class="pd-strip" id="pd-strip">${W.items.map((x, i) => { const e = catalog.find((c) => c.id === x.ex); const p = exPhoto(e); const done = x.sets.length && x.sets.every((s) => s._ok); return `<button type="button" class="pd-circle${i === W.cur ? ' on' : ''}${done ? ' ses-doneex' : ''}" data-id="${esc(x.ex)}" aria-label="${name(e)}">${p ? `<img src="${p}" alt="" draggable="false">` : '<span>?</span>'}<i>${i + 1}</i>${done ? `<u class="ses-tick">${ICON.check}</u>` : ''}</button>`; }).join('')}<button type="button" class="pd-circle pd-circle--add" id="ses-add" aria-label="Agregar ejercicio">${ICON.plus}</button></div>
    ${it ? `<article class="card pd-ex ses-card">
      <div class="pd-ex__img${exPhoto(ex) ? '' : ' ph'}">${exPhoto(ex) ? `<img src="${exPhoto(ex)}" alt="">` : '?'}</div>
      <div><h3>${name(ex)}</h3><p class="muted ses-sub">${it.sets.filter((s) => s._ok).length}/${it.sets.length} series completadas</p>
        ${pv.length ? `<p class="ses-hint">Última vez: <b>${pv.join(' · ')}</b> · intenta igualarlo o sumar 1</p>` : (ex.instructions || [])[0] ? `<p class="ses-hint">${esc(ex.instructions[0])}</p>` : ''}</div>
      <div class="pd-pills">
        <button type="button" class="pd-pill${it.solo ? ' on' : ''}" id="ses-solo">${ICON.reps}<span>Solo reps</span></button>
        <button type="button" class="pd-pill" id="ses-swap">${ICON.swap}<span>Reemplazar</span></button>
        <button type="button" class="pd-pill${it.note || sesNoteOpen ? ' on' : ''}" id="ses-note">${ICON.note}<span>Nota</span></button>
        <button type="button" class="pd-pill" id="ses-rest">${ICON.clock}<span>Descanso</span><em>${it.restSec || 60}s</em></button>
        <button type="button" class="pd-pill pd-pill--danger" id="ses-del" aria-label="Sacar ejercicio de hoy">${ICON.trash}</button>
      </div>
      ${sesNoteOpen ? `<textarea id="ses-note-text" rows="2" maxlength="300" placeholder="Agregar una nota…">${esc(it.note || '')}</textarea>` : ''}
      ${table}</article>` : `<div class="card pd-empty"><p class="muted">Aún no hay ejercicios en esta sesión.</p><button type="button" class="btn" id="ses-add2">+ Agregar ejercicios</button></div>`}
    <div id="ses-bars" class="ses-bars"></div>`;

  $('#ses-back', box).onclick = () => { clearInterval(sesTick); activeView = 'home'; renderPlyo(view, ctx); };
  $('#ses-finish', box).onclick = () => { sesFinishing = true; redraw(); };
  const addPick = () => picker(ctx, (ids) => {
    const first = W.items.length;
    ids.filter((id) => !W.items.some((x) => x.ex === id)).forEach((id) => { const e = catalog.find((c) => c.id === id) || { id }; W.items.push({ ex: id, sets: blankSetsFor(e), done: false, restSec: 60 }); });
    if (W.items.length > first) { W.cur = first; sesNoteOpen = false; }
    sesSave(); redraw();
  });
  $('#ses-add', box).onclick = addPick; $('#ses-add2', box)?.addEventListener('click', addPick);
  const strip = $('#pd-strip', box);
  strip.querySelectorAll('.pd-circle[data-id]').forEach((c) => (c.onclick = () => { if (strip._drag) return; W.cur = W.items.findIndex((x) => x.ex === c.dataset.id); sesNoteOpen = false; sesSave(); redraw(); }));
  bindStripDrag(strip, (ids) => { const cur = W.items[W.cur]?.ex; W.items = ids.map((id) => W.items.find((x) => x.ex === id)); W.cur = Math.max(0, W.items.findIndex((x) => x.ex === cur)); sesSave(); redraw(); });
  if (it) {
    $('#ses-solo', box).onclick = () => { it.solo = !it.solo; sesSave(); redraw(); };
    $('#ses-swap', box).onclick = () => picker(ctx, (ids) => { const id = ids.find((i) => !W.items.some((x) => x.ex === i)); if (!id) { notify('Ese ejercicio ya está en la sesión.'); return; } const e = catalog.find((c) => c.id === id) || { id }; it.ex = id; it.sets = blankSetsFor(e, it.sets.length); it.done = false; sesSave(); redraw(); });
    $('#ses-note', box).onclick = () => { sesNoteOpen = !sesNoteOpen; redraw(); };
    $('#ses-note-text', box)?.addEventListener('input', (e) => { it.note = e.target.value.trim(); sesSave(); });
    $('#ses-rest', box).onclick = () => restModal(it.restSec || 60, (v) => { it.restSec = v; sesSave(); redraw(); });
    $('#ses-del', box).onclick = () => confirmDialog(`«${ex.name_es || ex.name || 'Este ejercicio'}» se saca solo del entrenamiento de hoy; tu rutina no cambia.`, 'Sacar ejercicio').then((ok) => { if (!ok) return; W.items.splice(W.cur, 1); sesNoteOpen = false; sesSave(); redraw(); });
    box.querySelectorAll('.ses-val').forEach((b) => (b.onclick = () => {
      const j = +b.closest('.ses-row').dataset.j, k = b.dataset.f, s = it.sets[j];
      keypad(`Serie ${j + 1} · ${FIELD_LABELS[k]?.[0] || k}`, s[k], k === 'weight_kg' ? 2.5 : (FIELD_LABELS[k]?.[1] || 1), (v) => { s[k] = v; sesSave(); redraw(); });
    }));
    box.querySelectorAll('[data-chk]').forEach((b) => (b.onclick = () => sesToggle(it, +b.dataset.chk, box, view, ctx)));
    $('#ses-addset', box)?.addEventListener('click', () => { it.sets.push(Object.fromEntries(Object.keys(it.sets[0] || blankSetFor(ex)).filter((k) => k[0] !== '_').map((k) => [k, '']))); it.done = false; sesSave(); redraw(); });
  }
  sesBars(box);
  sesTickFn(box);
  sesTick = setInterval(() => sesTickFn(box), 250);
}

function sesToggle(it, j, box, view, ctx) {
  const s = it.sets[j]; const redraw = () => drawSession(box, view, ctx);
  unlockAudio();
  if (s._ok) { s._ok = false; delete s._t; delete s._rest; it.done = false; sesSave(); redraw(); return; }
  sesFields(it).forEach((k) => { if (s[k] === '' || s[k] == null) { const r = sesRef(it, j, k); if (r) s[k] = r; } });
  const now = Date.now(); s._ok = true; s._t = now;
  const prev = it.sets[j - 1];
  if (prev?._t) { s._rest = Math.round((now - prev._t) / 1000); s.rest_sec = String(s._rest); }
  const pending = it.sets.some((x) => !x._ok);
  it.done = !pending;
  const all = W.items.every((x) => x.sets.every((y) => y._ok));
  if (!all) sesRestEnd = now + (it.restSec || 60) * 1000;
  sesSave(); redraw();
  if (all) { sesRestEnd = 0; setTimeout(() => { if (W && box.isConnected && activeView === 'session') { sesFinishing = true; drawSession(box, view, ctx); } }, 700); }
  else if (!pending && W.cur < W.items.length - 1) {
    setTimeout(() => { if (!W || !box.isConnected || W.items[W.cur] !== it) return; W.cur += 1; sesTransAt = Date.now(); sesNoteOpen = false; sesSave(); redraw(); }, 500);
  }
}

function sesBars(box) {
  const host = $('#ses-bars', box); if (!host) return;
  const rem = Math.max(0, Math.round((sesRestEnd - Date.now()) / 1000));
  host.innerHTML = `${sesRestEnd ? `<div class="ses-bar ses-bar--rest"><span class="ses-bar__ic">${ICON.moon}</span><div><small>Descanso</small><b id="rest-left">${fmtClock(rem)}</b></div><button type="button" data-r="-15">-15s</button><button type="button" data-r="15">+15s</button><button type="button" class="ses-bar__go" data-r="skip" aria-label="Saltar descanso">${ICON.skip}</button></div>` : ''}
    ${sesTransAt ? `<div class="ses-bar ses-bar--trans"><span class="ses-bar__ic">${ICON.walk}</span><div><small>Pasando al siguiente ejercicio</small><b id="trans-left">${fmtClock((Date.now() - sesTransAt) / 1000)}</b></div><button type="button" class="ses-bar__ok" data-t="ok">Aceptar</button></div>` : ''}`;
  host.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { unlockAudio(); if (b.dataset.r === 'skip') sesRestEnd = 0; else sesRestEnd += Number(b.dataset.r) * 1000; sesBars(box); sesTickFn(box); }));
  host.querySelector('[data-t]')?.addEventListener('click', () => { const it = W.items[W.cur]; if (it) it.trans = Math.round((Date.now() - sesTransAt) / 1000); sesTransAt = 0; sesSave(); sesBars(box); });
}

function sesTickFn(box) {
  if (!box.isConnected || !W) { clearInterval(sesTick); return; }
  const clock = $('#ses-clock', box);
  if (clock) { const s = Math.floor((Date.now() - W.startedAt) / 1000); clock.textContent = s >= 3600 ? `${Math.floor(s / 3600)}:${fmtClock(s % 3600)}` : fmtClock(s); }
  if (sesRestEnd) {
    const rem = Math.max(0, Math.round((sesRestEnd - Date.now()) / 1000)); const el = $('#rest-left', box); if (el) el.textContent = fmtClock(rem);
    if (rem <= 0) { sesRestEnd = 0; navigator.vibrate?.([500, 200, 500, 200, 500, 200, 500]); beep(); notify('Descanso terminado', 'success'); sesBars(box); }
  }
  if (sesTransAt) { const el = $('#trans-left', box); if (el) el.textContent = fmtClock((Date.now() - sesTransAt) / 1000); }
}

function drawFinish(box, view, ctx) {
  const total = W.items.reduce((n, x) => n + x.sets.length, 0), done = W.items.reduce((n, x) => n + x.sets.filter((s) => s._ok).length, 0);
  if (!W.duration) { W.duration = String(Math.max(1, Math.round((Date.now() - (W.startedAt || Date.now())) / 60000))); sesSave(); }
  box.innerHTML = `<div class="pd-head">${backBtn('fin-back')}<h2>Terminar</h2></div>
    <section class="card pd-card"><p><b>${done}</b> de ${total} series completadas · ${W.items.length} ejercicio${W.items.length === 1 ? '' : 's'}</p>
      <label for="wd">Fecha</label><input id="wd" type="date" max="${today()}" value="${W.date}">
      <label for="wm">Duración (min)</label><input id="wm" type="number" min="1" inputmode="numeric" value="${W.duration}">
      <label for="wr">Esfuerzo (RPE 1-10)</label><input id="wr" type="number" min="1" max="10" inputmode="numeric" value="${W.rpe}">
      <label for="wn">Notas</label><input id="wn" type="text" maxlength="300" value="${esc(W.notes)}">
      <button class="btn" id="savew" type="button">Finalizar y guardar</button><button class="link" id="clr" type="button">Descartar sesión</button><p class="msg" id="wm2"></p></section>`;
  $('#fin-back', box).onclick = () => { sesFinishing = false; drawSession(box, view, ctx); };
  $('#wd', box).oninput = (e) => { W.date = e.target.value; sesSave(); };
  $('#wm', box).oninput = (e) => { W.duration = e.target.value; sesSave(); };
  $('#wr', box).oninput = (e) => { W.rpe = e.target.value; sesSave(); };
  $('#wn', box).oninput = (e) => { W.notes = e.target.value; sesSave(); };
  $('#clr', box).onclick = () => confirmDialog('¿Descartar esta sesión sin guardarla?', 'Descartar sesión').then((ok) => { if (ok) { sesReset(true); W = null; draft.del(userDraftKey()); activeView = 'home'; renderPlyo(view, ctx); } });
  $('#savew', box).onclick = () => finishSession(box, view, ctx);
}

async function finishSession(box, view, ctx) {
  const msg = $('#wm2', box); msg.textContent = '';
  const real = (s) => s._ok || Object.entries(s).some(([k, v]) => k[0] !== '_' && v !== '' && Number(v) > 0);
  const items = W.items.map((it, pos) => ({ ex: it.ex, pos, sets: it.sets.filter(real) })).filter((it) => it.sets.length);
  if (!items.length) { msg.textContent = 'Completa al menos una serie.'; return; }
  const btn = $('#savew', box); btn.disabled = true;
  const { data: w, error } = await supabase.from('workouts').insert({
    kind: 'plyometrics', performed_on: W.date, duration_min: num(W.duration), rpe: num(W.rpe), notes: W.notes.trim() || null,
    source_routine_id: W.routineId || null, plan_day: W.planDay || null,
  }).select('id').single();
  if (error) { msg.textContent = 'Error: ' + error.message; btn.disabled = false; return; }
  const rows = items.flatMap((it) => it.sets.map((s, j) => {
    const r = { workout_id: w.id, exercise_id: it.ex, position: it.pos, set_no: j + 1 };
    Object.entries(s).forEach(([k, v]) => { if (k[0] !== '_') r[k] = num(v); });
    return r;
  }));
  const { error: e2 } = await supabase.from('workout_sets').insert(rows);
  if (e2) { await supabase.from('workouts').delete().eq('id', w.id); msg.textContent = 'Error en las series: ' + e2.message; btn.disabled = false; return; }
  const finishedW = { ...W, items: W.items.map((it) => ({ ...it, sets: it.sets.filter(real) })).filter((it) => it.sets.length) };
  sesReset(true); W = null; draft.del(userDraftKey()); activeView = 'home';
  if (finishedW.routineId) await maybeUpdateRoutine(ctx, finishedW);
  notify('Sesión guardada.', 'success');
  await renderPlyo(view, ctx);
}

async function maybeUpdateRoutine(ctx, w) {
  const routine = routines.find((r) => r.id === w.routineId);
  if (!routine) return;
  const originalIds = routine.items.map((it) => it.exercise_id).sort().join(',');
  const newIds = w.items.map((it) => it.ex).sort().join(',');
  const countsChanged = routine.items.some((it) => { const live = w.items.find((x) => x.ex === it.exercise_id); return live && live.sets.length !== it.target_sets; });
  if (originalIds === newIds && !countsChanged) return;
  const update = await confirmDialog('Modificaste ejercicios o series respecto a la rutina guardada. ¿Actualizar la rutina con estos cambios?', 'Actualizar rutina');
  if (!update) return;
  const newItems = w.items.map((it) => {
    const exercise = catalog.find((e) => e.id === it.ex) || { id: it.ex };
    const fields = fieldsFor(exercise).filter((f) => f !== 'rest_sec');
    const last = it.sets[it.sets.length - 1] || {};
    const targets = {}; fields.forEach((f) => { if (last[f] !== '' && last[f] != null) targets[f] = Number(last[f]); });
    const prev = routine.items.find((x) => x.exercise_id === it.ex);
    const out = { exercise_id: it.ex, target_sets: it.sets.length, rest_sec: it.restSec || prev?.rest_sec || 60, targets, sets: it.sets.map((x) => ({ weight_kg: x.weight_kg ?? '', reps: x.reps ?? x.contacts ?? '' })) };
    if (it.solo) out.solo_reps = true; if (it.note) out.note = it.note;
    return out;
  });
  const { error } = await supabase.from('plyo_routines').update({ items: newItems, updated_at: new Date().toISOString() }).eq('id', routine.id);
  if (error) notify('No se pudo actualizar la rutina: ' + error.message); else notify('Rutina actualizada.', 'success');
}

/* ----------------------------------- Mi plan ----------------------------------- */
function weekDates() {
  const now = new Date(); const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return DAYS.map((_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
}

function renderPlan(box, view, ctx) {
  if (planPage) {
    box.innerHTML = '<i class="plyo-subpage-marker" hidden></i>';
    const host = document.createElement('div'); box.appendChild(host);
    if (planPage === 'days') drawDays(host, view, ctx);
    else if (dayDraft) drawDayEditor(host, view, ctx);
    else openDayEditor(planPage.day, host, view, ctx);
    return;
  }
  const firstDay = DAYS.find((d) => weekPlan[d]?.routineId && routines.some((r) => r.id === weekPlan[d].routineId));
  const firstRoutine = firstDay ? routines.find((r) => r.id === weekPlan[firstDay].routineId) : null;
  const chosen = routines.find((r) => r.id === weekPlan._active) || null;
  const activeR = chosen || firstRoutine;                 // nombre del plan activo
  const coverR = chosen || firstRoutine;                  // foto: primer ejercicio (de la elegida, o del primer día planificado)
  const coverEx = coverR ? catalog.find((e) => e.id === coverR.items[0]?.exercise_id) : null;
  const photo = coverEx?.images?.[0] ? `/exercises/${encodeURI(coverEx.images[0])}` : '';
  const plannedDays = DAYS.filter((d) => weekPlan[d]?.routineId).length;
  box.innerHTML = `<i class="plyo-subpage-marker" hidden></i>
    <button type="button" class="plyo-plan-card" id="plyo-plan-open" aria-label="Abrir mi plan: ver y editar los días">
      <span class="plyo-plan-card__cover${photo ? ' has-photo' : ''}"${photo ? ` style="--plyo-photo:url('${photo}')"` : ''}>
        <span class="plyo-plan-card__badge">${activeR ? 'Activo' : 'Sin plan'}</span>
        <b class="plyo-plan-card__title">${activeR ? name(activeR) : 'Arma tu semana'}</b>
        <small>${plannedDays ? `${plannedDays} día${plannedDays === 1 ? '' : 's'} con rutina · toca para ver y editar` : 'Asigna una rutina a tus días · toca para empezar'}</small>
        <svg class="plyo-plan-card__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
      </span>
    </button>
    <details class="card plyo-routines" id="plyo-routines">
      <summary><span>Mis rutinas guardadas</span><small>${routines.length}</small></summary>
      <div class="plyo-routines__list">${routines.length ? routines.map((r) => `<div class="plyo-routine-row${weekPlan._active === r.id ? ' is-active' : ''}">
        <div class="plyo-routine-row__info"><b>${esc(r.name)}</b><small>${r.items.length} ejercicio${r.items.length === 1 ? '' : 's'}${r.focus ? ` · ${esc(r.focus)}` : ''}</small>
          <span class="plyo-routine-row__links"><button class="link" data-routine-dup="${r.id}" type="button">Duplicar</button><button class="link" data-routine-del="${r.id}" type="button">Eliminar</button></span></div>
        <button class="plyo-icon-btn" data-routine-edit="${r.id}" type="button" aria-label="Editar ${esc(r.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17l-1 3Z"/><path d="m14 7 3 3"/></svg></button>
        <button class="btn sm ${weekPlan._active === r.id ? '' : 'ghost'}" data-routine-select="${r.id}" type="button">${weekPlan._active === r.id ? 'Activa' : 'Seleccionar'}</button>
      </div>`).join('') : '<p class="muted">Aún no tienes rutinas. Crea una desde cualquier día.</p>'}
      <button class="btn ghost" id="plyo-new-routine" type="button">+ Crear rutina nueva</button>
      <button class="link" id="open-lib-plan" type="button">Ver biblioteca de ejercicios</button></div>
    </details>`;
  $('#plyo-plan-open', box).onclick = () => { planPage = 'days'; renderPlyo(view, ctx); };
  box.querySelectorAll('[data-routine-edit]').forEach((b) => (b.onclick = () => routineForm(ctx, routines.find((r) => r.id === b.dataset.routineEdit), () => renderPlyo(view, ctx))));
  box.querySelectorAll('[data-routine-dup]').forEach((b) => (b.onclick = () => duplicateRoutine(ctx, b.dataset.routineDup, view)));
  box.querySelectorAll('[data-routine-del]').forEach((b) => (b.onclick = () => deleteRoutine(ctx, b.dataset.routineDel, view)));
  box.querySelectorAll('[data-routine-select]').forEach((b) => (b.onclick = async () => {
    weekPlan = { ...weekPlan, _active: b.dataset.routineSelect };
    const { error } = await supabase.from('plyo_plans').upsert({ user_id: ctx.user.id, plan: weekPlan, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) { notify('No se pudo guardar el plan: ' + error.message); return; }
    renderPlan(box, view, ctx);
  }));
  $('#plyo-new-routine', box).onclick = () => routineForm(ctx, null, () => renderPlyo(view, ctx));
  $('#open-lib-plan', box).onclick = () => openLibrary(ctx, view);
}

/* --------------------- Mi plan · página de días y editor de día --------------------- */
const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M21 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H21z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.4"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
  paste: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2.4"/><path d="M9 4h6v3H9z"/><path d="M9 13h6M9 17h4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h10l4 4v12H5z"/><path d="M14 4v5h5M8 13h8M8 17h5"/></svg>',
  reps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h14l-3-3M20 16H6l3 3"/></svg>',
  walk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13" cy="4.5" r="1.8"/><path d="M9 21l2-6 3 2v5M11 15l-1-5 4-2 2 3 3 1M9 12l-3 1"/></svg>',
  skip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 7 5 5-5 5M13 7l5 5-5 5"/></svg>',
};
const backBtn = (id) => `<button type="button" class="training-back-button animated-back animated-back-compact pd-back" id="${id}"><span class="animated-back-sweep" aria-hidden="true">${ICON.back}</span><span class="animated-back-label">Volver</span></button>`;

// Grupos de trabajo propios de la pliometría (se deducen del nombre/identificador del ejercicio).
const PLYO_GROUPS = [
  ['lanzamientos', 'Lanzamientos', /medicine|ball|throw|slam|toss|chest.?pass|overhead/],
  ['velocidad', 'Velocidad y agilidad', /sprint|speed|agility|cone|shuttle|skater|run|ladder|shuffle/],
  ['cajon', 'Cajón y banco', /box|bench|step|stair|platform/],
  ['superior', 'Tren superior', /push|clap|pull|row|chest|shoulder|burpee/],
  ['core', 'Core', /crunch|plank|sit.?up|core|twist|abdominal|v.?up|mountain/],
  ['rebotes', 'Rebotes y reactividad', /drop|hop|depth|rebound|pogo|rope|hurdle|bounce|ankle/],
  ['horizontal', 'Saltos horizontales', /bound|broad|horizontal|long|skip|lunge|diagonal|lateral|split/],
  ['vertical', 'Salto vertical', /jump|squat|tuck|vertical|cmj|leap|star|knee/],
];
const groupLabel = (id) => PLYO_GROUPS.find((g) => g[0] === id)?.[1] || id;
function plyoGroup(e) {
  const s = `${e?.id || ''} ${e?.name || ''} ${e?.name_es || ''}`.toLowerCase().replace(/_/g, ' ');
  return (PLYO_GROUPS.find((g) => g[2].test(s)) || ['otros'])[0];
}
const exPhoto = (e) => (e?.images?.[0] ? `/exercises/${encodeURI(e.images[0])}` : '');
const exById = (id) => catalog.find((e) => e.id === id);
const setSummary = (it) => { const s = it.sets?.[0]; return `${it.sets?.length || it.target_sets || 1} × ${s?.reps || it.targets?.reps || '—'}`; };

// Normaliza un ejercicio de rutina antiguo (series/targets) a la forma con tabla de series.
function normItem(it) {
  if (Array.isArray(it.sets) && it.sets.length) return { ...it };
  const n = Math.max(1, it.target_sets || 3);
  const base = { weight_kg: it.targets?.weight_kg ?? '', reps: it.targets?.reps ?? it.targets?.contacts ?? '' };
  return { ...it, sets: Array.from({ length: n }, () => ({ ...base })) };
}
// Deja el ejercicio listo para guardar, manteniendo los campos que ya usa la sesión en vivo.
function packItem(it) {
  const sets = it.sets.map((s) => ({ weight_kg: s.weight_kg === '' ? '' : Number(s.weight_kg) || 0, reps: s.reps === '' ? '' : Number(s.reps) || 0 }));
  const first = sets[0] || {};
  const targets = { ...(it.targets || {}) };
  if (first.reps !== '' && first.reps != null) targets.reps = first.reps; else delete targets.reps;
  if (first.weight_kg !== '' && first.weight_kg != null && !it.solo_reps) targets.weight_kg = first.weight_kg; else delete targets.weight_kg;
  const out = { exercise_id: it.exercise_id, target_sets: Math.max(1, sets.length), rest_sec: it.rest_sec ?? 60, targets, sets };
  if (it.solo_reps) out.solo_reps = true;
  if (it.note) out.note = it.note;
  return out;
}

let planPage = null;        // null | 'days' | { day }
let dayDraft = null;        // { day, name, groups:[], items:[], routineId }
let dayActive = 0;
let dayNoteOpen = false;
let prevSets = {};          // exercise_id -> series de la última sesión (columna "Antes")
let saveTimer = 0, saveChain = Promise.resolve();

async function loadPrevSets() {
  const { data = [] } = await supabase.from('workouts').select('id, performed_on, workout_sets(*)').eq('kind', 'plyometrics').order('performed_on', { ascending: false }).limit(40);
  prevSets = {};
  data.forEach((w) => (w.workout_sets || []).forEach((s) => { (prevSets[s.exercise_id] ||= []).push(s); }));
}

function dayPhoto(entry) {
  const r = entry?.routineId ? routines.find((x) => x.id === entry.routineId) : null;
  return exPhoto(exById(r?.items?.[0]?.exercise_id));
}
function daySubtitle(entry) {
  if (entry?.rest) return 'Recuperación';
  if (entry?.name) return esc(entry.name);
  const r = entry?.routineId ? routines.find((x) => x.id === entry.routineId) : null;
  const names = (r?.items || []).slice(0, 2).map((it) => name(exById(it.exercise_id)));
  return names.length ? names.join(' · ') + (r.items.length > 2 ? '…' : '') : 'Sin configurar';
}

/* ---- página: los 7 días en fila vertical ---- */
function drawDays(box, view, ctx) {
  const dates = weekDates();
  box.innerHTML = `<div class="pd-head">${backBtn('pd-back')}<h2>Mi plan</h2></div>
    <div class="pd-days">${DAYS.map((d, i) => {
      const entry = weekPlan[d]; const photo = dayPhoto(entry);
      return `<article class="pd-day${entry?.rest ? ' is-rest' : ''}">
        <button type="button" class="pd-day__main" data-open="${d}">
          <span class="pd-day__photo${photo ? ' has-photo' : ''}"${photo ? ` style="--p:url('${photo}')"` : ''}>${entry?.rest ? ICON.moon : photo ? '' : ICON.plus}</span>
          <span class="pd-day__text"><b>${d}</b><small>${dates[i].getDate()}/${dates[i].getMonth() + 1} · ${daySubtitle(entry)}</small></span>
        </button>
        <div class="pd-day__tools">
          <button type="button" class="plyo-icon-btn" data-copy="${d}" aria-label="Copiar ${d}">${ICON.copy}</button>
          <button type="button" class="plyo-icon-btn" data-paste="${d}" aria-label="Pegar en ${d}" ${copiedDay ? '' : 'disabled'}>${ICON.paste}</button>
          <button type="button" class="plyo-icon-btn${entry?.rest ? ' is-on' : ''}" data-rest="${d}" aria-label="Descanso ${d}">${ICON.moon}</button>
        </div></article>`;
    }).join('')}</div>`;
  $('#pd-back', box).onclick = () => { planPage = null; renderPlyo(view, ctx); };
  box.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => { if (weekPlan[b.dataset.open]?.rest) { notify('Es día de descanso: quita la luna para configurarlo.'); return; } openDayEditor(b.dataset.open, box, view, ctx); }));
  box.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => { const e = weekPlan[b.dataset.copy]; copiedDay = e ? JSON.parse(JSON.stringify(e)) : { empty: true }; notify(`${b.dataset.copy} copiado.`, 'success'); drawDays(box, view, ctx); }));
  box.querySelectorAll('[data-paste]').forEach((b) => (b.onclick = () => pasteDay(b.dataset.paste, box, view, ctx)));
  box.querySelectorAll('[data-rest]').forEach((b) => (b.onclick = async () => {
    const d = b.dataset.rest, e = weekPlan[d];
    if (e?.rest) await setDayPlan(ctx, d, null);
    else { if (e?.routineId && !(await confirmDialog(`${d} tiene una rutina. ¿Marcarlo como descanso? La rutina se conserva en “Mis rutinas”.`, 'Marcar descanso'))) return; await setDayPlan(ctx, d, { rest: true }); }
    drawDays(box, view, ctx);
  }));
}

async function pasteDay(day, box, view, ctx) {
  if (!copiedDay) return;
  if (weekPlan[day] && !(await confirmDialog(`${day} ya tiene una planificación. ¿Reemplazarla con la copiada?`, 'Reemplazar'))) return;
  if (copiedDay.empty) await setDayPlan(ctx, day, null);
  else if (copiedDay.rest) await setDayPlan(ctx, day, { rest: true });
  else {
    const src = routines.find((r) => r.id === copiedDay.routineId);
    let routineId = null;
    if (src) { // la rutina pegada es independiente de la original
      const { data, error } = await supabase.from('plyo_routines').insert({ user_id: ctx.user.id, name: `${src.name} (copia)`.slice(0, 80), focus: src.focus, items: JSON.parse(JSON.stringify(src.items)) }).select('*').single();
      if (error) { notify(error.message); return; }
      routines = [...routines, data]; routineId = data.id;
    }
    await setDayPlan(ctx, day, { ...(routineId ? { routineId } : {}), ...(copiedDay.name ? { name: copiedDay.name } : {}), ...(copiedDay.groups?.length ? { groups: copiedDay.groups } : {}) });
  }
  notify(`Pegado en ${day}.`, 'success'); drawDays(box, view, ctx);
}

/* ---- editor de un día ---- */
async function openDayEditor(day, box, view, ctx) {
  const entry = weekPlan[day] || {};
  const r = entry.routineId ? routines.find((x) => x.id === entry.routineId) : null;
  dayDraft = { day, name: entry.name || '', groups: [...(entry.groups || [])], items: (r?.items || []).map(normItem), routineId: r?.id || null };
  dayActive = 0; dayNoteOpen = false; planPage = { day };
  await loadPrevSets().catch(() => { prevSets = {}; });
  drawDayEditor(box, view, ctx);
}

function queueSave(ctx, delay = 500) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flushSave(ctx), delay);
}
function flushSave(ctx) {
  clearTimeout(saveTimer);
  saveChain = saveChain.then(() => persistDay(ctx)).catch((e) => notify('No se pudo guardar el día: ' + (e.message || e)));
  return saveChain;
}
async function persistDay(ctx) {
  const d = dayDraft; if (!d) return;
  const items = d.items.map(packItem);
  const groups = d.groups.length ? d.groups : [];
  let routineId = d.routineId;
  if (items.length || routineId) {
    const auto = d.name || `Rutina de ${d.day}`;
    const row = { name: auto.slice(0, 80), focus: groups.map(groupLabel).join(', ').slice(0, 200) || null, items, updated_at: new Date().toISOString() };
    if (routineId) {
      const { data, error } = await supabase.from('plyo_routines').update(row).eq('id', routineId).select('*').single();
      if (error) throw error;
      routines = routines.map((r) => (r.id === routineId ? data : r));
    } else {
      const { data, error } = await supabase.from('plyo_routines').insert({ user_id: ctx.user.id, ...row }).select('*').single();
      if (error) throw error;
      routines = [...routines, data]; routineId = data.id; d.routineId = routineId;
    }
  }
  const entry = { ...(routineId ? { routineId } : {}), ...(d.name ? { name: d.name } : {}), ...(groups.length ? { groups } : {}) };
  await setDayPlan(ctx, d.day, Object.keys(entry).length ? entry : null);
}

function drawDayEditor(box, view, ctx) {
  const d = dayDraft;
  if (dayActive >= d.items.length) dayActive = Math.max(0, d.items.length - 1);
  const it = d.items[dayActive];
  const ex = it ? exById(it.exercise_id) : null;
  const auto = (() => { const c = {}; d.items.forEach((x) => { const g = plyoGroup(exById(x.exercise_id)); c[g] = (c[g] || 0) + 1; }); const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return top ? groupLabel(top[0]) : '—'; })();
  const prevLabel = (j) => { const p = (prevSets[it.exercise_id] || [])[j]; if (!p) return '—'; const w = Number(p.weight_kg) ? `${p.weight_kg}kg×` : ''; return `${w}${p.reps ?? p.contacts ?? '?'}`; };
  box.innerHTML = `<div class="pd-head">${backBtn('pd-back')}<h2>Editar ${d.day}</h2></div>
    <section class="card pd-card">
      <label for="pd-name">Nombre del día</label>
      <input id="pd-name" maxlength="60" placeholder="${d.items.length ? `Ej. ${esc(name(exById(d.items[0].exercise_id)))}…` : 'Ej. Potencia de piernas'}" value="${esc(d.name)}">
      <label>Grupo que trabaja <span class="muted">· automático: ${esc(auto)}</span></label>
      <div class="pd-chips">${PLYO_GROUPS.map((g) => `<button type="button" class="pd-chip${d.groups.includes(g[0]) ? ' on' : ''}" data-group="${g[0]}">${g[1]}</button>`).join('')}</div>
    </section>
    <section class="pd-order">
      <div class="pd-order__head"><b>Orden de ejercicios</b><small>${d.items.length > 1 ? 'Mantén pulsado y arrastra' : ''}</small></div>
      <div class="pd-strip" id="pd-strip">${d.items.map((x, i) => { const e = exById(x.exercise_id); const p = exPhoto(e); return `<button type="button" class="pd-circle${i === dayActive ? ' on' : ''}" data-id="${esc(x.exercise_id)}" aria-label="${name(e)}">${p ? `<img src="${p}" alt="" draggable="false">` : '<span>?</span>'}<i>${i + 1}</i></button>`; }).join('')}<button type="button" class="pd-circle pd-circle--add" id="pd-add" aria-label="Agregar ejercicios">${ICON.plus}</button></div>
    </section>
    ${it ? `<article class="card pd-ex">
      <div class="pd-ex__img${exPhoto(ex) ? '' : ' ph'}">${exPhoto(ex) ? `<img src="${exPhoto(ex)}" alt="">` : '?'}</div>
      <h3>${name(ex)}</h3>
      <div class="pd-pills">
        <button type="button" class="pd-pill" id="pd-rest">${ICON.clock}<span>Descanso</span><em>${it.rest_sec ?? 60}s</em></button>
        <button type="button" class="pd-pill${it.note || dayNoteOpen ? ' on' : ''}" id="pd-note">${ICON.note}<span>Nota</span></button>
        <button type="button" class="pd-pill${it.solo_reps ? ' on' : ''}" id="pd-solo">${ICON.reps}<span>Solo reps</span></button>
        <button type="button" class="pd-pill pd-pill--danger" id="pd-del" aria-label="Quitar ejercicio">${ICON.trash}</button>
      </div>
      ${dayNoteOpen ? `<textarea id="pd-note-text" rows="2" maxlength="300" placeholder="Agregar una nota…">${esc(it.note || '')}</textarea>` : ''}
      <div class="pd-table${it.solo_reps ? ' solo' : ''}">
        <div class="pd-row pd-row--head"><span>Serie</span><span>Antes</span><span>${it.solo_reps ? '' : 'Peso'}</span><span>Reps</span><span></span></div>
        ${it.sets.map((s, j) => `<div class="pd-row" data-j="${j}"><span class="pd-n">${j + 1}</span><span class="pd-prev">${esc(prevLabel(j))}</span>${it.solo_reps ? '<span></span>' : `<input data-f="weight_kg" type="number" min="0" step="0.5" inputmode="decimal" placeholder="0" aria-label="Peso serie ${j + 1}" value="${s.weight_kg ?? ''}">`}<input data-f="reps" type="number" min="0" inputmode="numeric" placeholder="0" aria-label="Reps serie ${j + 1}" value="${s.reps ?? ''}"><button type="button" class="pd-x" data-rmset="${j}" aria-label="Quitar serie">${ICON.trash}</button></div>`).join('')}
        <button type="button" class="pd-addset" id="pd-addset">+ Añadir serie</button>
      </div></article>` : `<div class="card pd-empty"><p class="muted">Este día aún no tiene ejercicios.</p><button type="button" class="btn" id="pd-add2">+ Agregar ejercicios</button></div>`}`;

  const redraw = () => drawDayEditor(box, view, ctx);
  $('#pd-back', box).onclick = async () => { await flushSave(ctx); planPage = 'days'; dayDraft = null; renderPlyo(view, ctx); };
  $('#pd-name', box).oninput = (e) => { d.name = e.target.value.trim(); queueSave(ctx); };
  box.querySelectorAll('[data-group]').forEach((b) => (b.onclick = () => { const g = b.dataset.group; d.groups = d.groups.includes(g) ? d.groups.filter((x) => x !== g) : [...d.groups, g]; b.classList.toggle('on'); queueSave(ctx); }));
  const addPicker = () => picker(ctx, (ids) => {
    const firstNew = d.items.length;
    ids.filter((id) => !d.items.some((x) => x.exercise_id === id)).forEach((id) => { d.items.push(normItem({ exercise_id: id, target_sets: 3, rest_sec: 60, targets: {} })); });
    if (d.items.length > firstNew) dayActive = firstNew;
    dayNoteOpen = false; queueSave(ctx, 200); redraw();
  });
  $('#pd-add', box).onclick = addPicker; $('#pd-add2', box)?.addEventListener('click', addPicker);
  const strip = $('#pd-strip', box);
  strip.querySelectorAll('.pd-circle[data-id]').forEach((c) => (c.onclick = () => { if (strip._drag) return; dayActive = d.items.findIndex((x) => x.exercise_id === c.dataset.id); dayNoteOpen = false; redraw(); }));
  bindStripDrag(strip, (ids) => { const cur = d.items[dayActive]?.exercise_id; d.items = ids.map((id) => d.items.find((x) => x.exercise_id === id)); dayActive = Math.max(0, d.items.findIndex((x) => x.exercise_id === cur)); queueSave(ctx, 200); redraw(); });
  if (!it) return;
  $('#pd-rest', box).onclick = () => restModal(it.rest_sec ?? 60, (v) => { it.rest_sec = v; queueSave(ctx); redraw(); });
  $('#pd-note', box).onclick = () => { dayNoteOpen = !dayNoteOpen; redraw(); };
  $('#pd-note-text', box)?.addEventListener('input', (e) => { it.note = e.target.value.trim(); queueSave(ctx); });
  $('#pd-solo', box).onclick = () => { it.solo_reps = !it.solo_reps; queueSave(ctx); redraw(); };
  $('#pd-del', box).onclick = () => { d.items.splice(dayActive, 1); queueSave(ctx, 200); redraw(); };
  box.querySelectorAll('.pd-row[data-j] input').forEach((inp) => (inp.oninput = () => { it.sets[+inp.closest('.pd-row').dataset.j][inp.dataset.f] = inp.value; queueSave(ctx); }));
  box.querySelectorAll('[data-rmset]').forEach((b) => (b.onclick = () => { if (it.sets.length > 1) it.sets.splice(+b.dataset.rmset, 1); queueSave(ctx); redraw(); }));
  $('#pd-addset', box).onclick = () => { const last = it.sets[it.sets.length - 1] || {}; it.sets.push({ weight_kg: last.weight_kg ?? '', reps: last.reps ?? '' }); queueSave(ctx); redraw(); };
}

function restModal(current, onPick) {
  const m = modal(`<div class="sheet-h"><b>Descanso entre series</b><button class="link" data-close>Cerrar</button></div>
    <div class="rest-presets">${REST_PRESETS.map((s) => `<button type="button" class="btn sm ${s === current ? '' : 'ghost'}" data-s="${s}">${s} s</button>`).join('')}</div>
    <label for="rc">Personalizado (segundos)</label><input id="rc" type="number" min="0" step="5" inputmode="numeric" value="${current}">
    <div class="sheet-f"><button class="btn" id="rok" type="button">Listo</button></div>`);
  m.querySelector('[data-close]').onclick = () => m.remove();
  m.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { onPick(Number(b.dataset.s)); m.remove(); }));
  $('#rok', m).onclick = () => { onPick(Math.max(0, Number($('#rc', m).value) || 0)); m.remove(); };
}

// Arrastrar para cambiar el orden: mantener pulsado ~⅓ de segundo y mover; un toque corto selecciona.
function bindStripDrag(strip, onDrop) {
  let drag = null, timer = 0;
  strip.addEventListener('touchmove', (e) => { if (drag?.active) e.preventDefault(); }, { passive: false });
  strip.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.pd-circle[data-id]'); if (!el) return;
    const rect = el.getBoundingClientRect();
    drag = { el, pid: e.pointerId, x0: e.clientX, y0: e.clientY, grab: e.clientX - rect.left, active: false };
    timer = setTimeout(() => { if (!drag) return; drag.active = true; strip._drag = true; el.classList.add('is-dragging'); try { el.setPointerCapture(drag.pid); } catch { /* sin captura */ } navigator.vibrate?.(15); }, 320);
  });
  strip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.active) { if (Math.abs(e.clientX - drag.x0) > 8 || Math.abs(e.clientY - drag.y0) > 8) { clearTimeout(timer); drag = null; } return; }
    const el = drag.el;
    [...strip.querySelectorAll('.pd-circle[data-id]')].filter((s) => s !== el).forEach((s) => {
      const r = s.getBoundingClientRect();
      if (e.clientX > r.left && e.clientX < r.right) { if (el.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) s.after(el); else s.before(el); }
    });
    el.style.transform = ''; const left = el.getBoundingClientRect().left;
    el.style.transform = `translateX(${e.clientX - drag.grab - left}px) scale(1.12)`;
  });
  const end = () => {
    clearTimeout(timer);
    if (drag?.active) {
      const el = drag.el; el.classList.remove('is-dragging'); el.style.transform = '';
      const ids = [...strip.querySelectorAll('.pd-circle[data-id]')].map((x) => x.dataset.id);
      setTimeout(() => { strip._drag = false; }, 60);
      drag = null; onDrop(ids); return;
    }
    drag = null;
  };
  strip.addEventListener('pointerup', end); strip.addEventListener('pointercancel', end);
}

async function setDayPlan(ctx, day, value) {
  weekPlan = { ...weekPlan }; if (value) weekPlan[day] = value; else delete weekPlan[day];
  const { error } = await supabase.from('plyo_plans').upsert({ user_id: ctx.user.id, plan: weekPlan, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) notify('No se pudo guardar el plan: ' + error.message);
}

function routineForm(ctx, existing, onDone) {
  const selected = new Map((existing?.items || []).map((it) => [it.exercise_id, it]));
  const m = modal(`<div class="sheet-h"><b>${existing ? 'Editar rutina' : 'Nueva rutina'}</b><button class="link" data-close>Cerrar</button></div>
    <label for="rn">Nombre</label><input id="rn" maxlength="80" value="${esc(existing?.name || '')}" required>
    <label for="rf">Objetivo (opcional)</label><input id="rf" maxlength="200" value="${esc(existing?.focus || '')}">
    <label for="rq">Buscar ejercicio</label><input id="rq" type="search" placeholder="Buscar…">
    <div id="routine-exlist" class="plan-exercise-list"></div>
    <div class="sheet-f"><button class="btn" id="rsave" type="button">Guardar rutina</button></div><p class="msg" id="rmsg"></p>`);
  const list = $('#routine-exlist', m);
  const draw = () => {
    const q = $('#rq', m).value.trim().toLowerCase();
    const items = catalog.filter((e) => !q || `${e.name} ${e.name_es || ''}`.toLowerCase().includes(q));
    list.innerHTML = items.map((e) => {
      const cfg = selected.get(e.id);
      const fields = fieldsFor(e).filter((f) => f !== 'rest_sec');
      return `<article class="plan-pick" data-pick="${esc(e.id)}"><label><input type="checkbox" ${cfg ? 'checked' : ''}><span><b>${name(e)}</b><small>${esc((e.primary_muscles || []).join(', '))}</small></span></label>
        <div class="plan-target">
          <label>Series<input data-field="target_sets" type="number" min="1" max="20" inputmode="numeric" value="${cfg?.target_sets || 3}"></label>
          ${fields.map((f) => `<label>${FIELD_LABELS[f][0]}<input data-field="${f}" type="number" min="0" step="${FIELD_LABELS[f][1]}" inputmode="decimal" value="${cfg?.targets?.[f] ?? ''}"></label>`).join('')}
          <label>Descanso (s)<input data-field="rest_sec" type="number" min="0" step="5" inputmode="numeric" value="${cfg?.rest_sec || 60}"></label>
        </div></article>`;
    }).join('') || '<p class="muted">Sin resultados.</p>';
    list.querySelectorAll('.plan-pick').forEach((card) => {
      const id = card.dataset.pick, check = $('input[type=checkbox]', card);
      const readCfg = () => {
        const targets = {};
        fieldsFor(catalog.find((e) => e.id === id) || {}).filter((f) => f !== 'rest_sec').forEach((f) => { const v = card.querySelector(`[data-field="${f}"]`)?.value; if (v !== '' && v != null) targets[f] = Number(v); });
        return { exercise_id: id, target_sets: Math.max(1, Number(card.querySelector('[data-field=target_sets]').value) || 3), rest_sec: Math.max(0, Number(card.querySelector('[data-field=rest_sec]').value) || 60), targets };
      };
      check.onchange = () => { if (check.checked) selected.set(id, readCfg()); else selected.delete(id); };
      card.querySelectorAll('[data-field]').forEach((inp) => (inp.oninput = () => { if (check.checked) selected.set(id, readCfg()); }));
    });
  };
  $('#rq', m).oninput = draw; draw();
  m.querySelector('[data-close]').onclick = () => m.remove();
  $('#rsave', m).onclick = async () => {
    const nm = $('#rn', m).value.trim();
    if (!nm) { $('#rmsg', m).textContent = 'Ponle un nombre a la rutina.'; return; }
    if (!selected.size) { $('#rmsg', m).textContent = 'Agrega al menos un ejercicio.'; return; }
    const row = { user_id: ctx.user.id, name: nm, focus: $('#rf', m).value.trim() || null, items: [...selected.values()], updated_at: new Date().toISOString() };
    const saved = existing
      ? await supabase.from('plyo_routines').update(row).eq('id', existing.id).select('*').single()
      : await supabase.from('plyo_routines').insert(row).select('*').single();
    if (saved.error) { $('#rmsg', m).textContent = saved.error.message; return; }
    routines = existing ? routines.map((r) => (r.id === existing.id ? saved.data : r)) : [...routines, saved.data];
    m.remove(); notify('Rutina guardada.', 'success'); onDone(saved.data);
  };
}

async function duplicateRoutine(ctx, id, view) {
  const r = routines.find((x) => x.id === id); if (!r) return;
  const { data, error } = await supabase.from('plyo_routines').insert({ user_id: ctx.user.id, name: `${r.name} (copia)`, focus: r.focus, items: r.items }).select('*').single();
  if (error) { notify(error.message); return; }
  routines = [...routines, data]; notify('Rutina duplicada.', 'success'); renderPlyo(view, ctx);
}

async function deleteRoutine(ctx, id, view) {
  if (!(await confirmDialog('¿Eliminar esta rutina? Los días que la usan quedarán sin asignar.', 'Eliminar rutina'))) return;
  const { error } = await supabase.from('plyo_routines').delete().eq('id', id);
  if (error) { notify(error.message); return; }
  routines = routines.filter((r) => r.id !== id);
  Object.keys(weekPlan).forEach((d) => { if (weekPlan[d]?.routineId === id) delete weekPlan[d]; });
  await supabase.from('plyo_plans').upsert({ user_id: ctx.user.id, plan: weekPlan, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  notify('Rutina eliminada.', 'success'); renderPlyo(view, ctx);
}

/* ----------------------------------- Progreso ----------------------------------- */
async function renderProgress(box, view, ctx) {
  const [{ data: ws = [], error }, { data: assess = [], error: assessError }] = await Promise.all([
    supabase.from('workouts').select('*, workout_sets(*, exercises(name,name_es,images))').eq('kind', 'plyometrics').order('performed_on', { ascending: false }).order('created_at', { ascending: false }).limit(200),
    supabase.from('plyo_assessments').select('*').eq('user_id', ctx.user.id).order('measured_on', { ascending: false }).limit(100),
  ]);
  if (error) { box.innerHTML = `<p class="msg">${esc(error.message)}</p>`; return; }

  const since = progressPeriod === 'week' ? weekStart() : progressPeriod === 'month' ? monthStart() : '0000-01-01';
  const filtered = ws.filter((w) => w.performed_on >= since);
  const days = new Set(filtered.map((w) => w.performed_on)).size;
  const sets = filtered.reduce((s, w) => s + w.workout_sets.length, 0);
  const reps = filtered.reduce((s, w) => s + w.workout_sets.reduce((t, x) => t + (Number(x.reps) || 0), 0), 0);
  const contacts = filtered.reduce((s, w) => s + w.workout_sets.reduce((t, x) => t + (Number(x.contacts) || 0), 0), 0);
  const duration = filtered.reduce((s, w) => s + (Number(w.duration_min) || 0), 0);

  // récords personales por ejercicio (cada métrica se compara solo contra sí misma)
  const rec = {};
  ws.forEach((w) => w.workout_sets.forEach((s) => {
    const r = (rec[s.exercise_id] ||= { ex: s.exercises, h: 0, box: 0, kg: 0, dist: 0, maxReps: 0, maxContacts: 0 });
    r.h = Math.max(r.h, Number(s.height_cm) || 0); r.box = Math.max(r.box, Number(s.box_height_cm) || 0);
    r.kg = Math.max(r.kg, Number(s.weight_kg) || 0); r.dist = Math.max(r.dist, Number(s.distance_m) || 0);
    r.maxReps = Math.max(r.maxReps, Number(s.reps) || 0); r.maxContacts = Math.max(r.maxContacts, Number(s.contacts) || 0);
  }));
  const recs = Object.values(rec).filter((r) => r.h || r.box || r.kg || r.dist || r.maxReps || r.maxContacts);

  // frecuencia de sesiones por semana (últimas 8 semanas con datos)
  const weekBuckets = Array.from({ length: 8 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (7 - i) * 7); return weekStart(d); });
  const weekCounts = weekBuckets.map((wk, i) => { const next = weekBuckets[i + 1]; return ws.filter((w) => w.performed_on >= wk && (!next || w.performed_on < next)).length; });
  const maxWeek = Math.max(1, ...weekCounts);

  box.innerHTML = `
    <div class="period-switch">${[['week', 'Semana'], ['month', 'Mes'], ['all', 'Todo']].map(([k, t]) => `<button data-period="${k}" class="${progressPeriod === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="grid"><div class="card stat"><b>${filtered.length}</b><span>Sesiones</span></div>
    <div class="card stat"><b>${days}</b><span>Días entrenados</span></div>
    <div class="card stat"><b>${sets}</b><span>Series</span></div>
    <div class="card stat"><b>${fmt(reps, 0)}</b><span>Repeticiones</span></div>
    <div class="card stat"><b>${fmt(contacts, 0)}</b><span>Contactos</span></div>
    <div class="card stat"><b>${fmt(duration, 0)} min</b><span>Tiempo entrenado</span></div></div>
    ${ws.length ? `<h2>Frecuencia (últimas 8 semanas)</h2><div class="card profile-chart"><div class="profile-bars">${weekCounts.map((n, i) => `<div><i style="height:${Math.max(4, (n / maxWeek) * 100)}%"></i><small>S${i + 1}</small></div>`).join('')}</div><p class="muted">Sesiones de pliometría por semana</p></div>` : ''}
    ${recs.length ? `<h2>Récords personales</h2><div class="card scroll"><table><tr><th>Ejercicio</th><th>Altura</th><th>Cajón</th><th>Dist.</th><th>Peso</th><th>Reps</th><th>Contactos</th></tr>
      ${recs.map((r) => `<tr><td>${name(r.ex)}</td><td>${r.h ? r.h + ' cm' : '—'}</td><td>${r.box ? r.box + ' cm' : '—'}</td><td>${r.dist ? r.dist + ' m' : '—'}</td><td>${r.kg ? r.kg + ' kg' : '—'}</td><td>${r.maxReps || '—'}</td><td>${r.maxContacts || '—'}</td></tr>`).join('')}</table></div>` : ''}
    <h2>Historial de sesiones</h2>
    ${ws.length ? ws.map((w) => {
      const byEx = {};
      w.workout_sets.sort((a, b) => a.position - b.position || a.set_no - b.set_no).forEach((s) => (byEx[s.exercise_id] ||= { ex: s.exercises, sets: [] }).sets.push(s));
      return `<details class="card"><summary><b>${w.performed_on}</b> · ${Object.keys(byEx).length} ejercicios · ${w.workout_sets.length} series${w.duration_min ? ` · ${fmt(w.duration_min, 0)} min` : ''}${w.rpe ? ` · RPE ${w.rpe}` : ''}</summary>
        ${Object.values(byEx).map((g) => `<div class="exh">${thumb(g.ex)}<div><b>${name(g.ex)}</b><br><span class="muted">${g.sets.map((s) => [s.reps && s.reps + ' reps', s.contacts && s.contacts + ' contactos', s.height_cm && s.height_cm + ' cm', s.box_height_cm && 'cajón ' + s.box_height_cm, s.distance_m && s.distance_m + ' m', s.weight_kg && s.weight_kg + ' kg'].filter(Boolean).join(' · ')).join(' · ')}</span></div></div>`).join('')}
        ${w.notes ? `<p class="muted">${esc(w.notes)}</p>` : ''}<div class="quick-actions"><button class="link" data-edit-session="${w.id}">Editar datos</button><button class="link" data-del="${w.id}">Borrar sesión</button></div></details>`;
    }).join('') : '<p class="muted">Aún no registras sesiones.</p>'}
    <h2>Evaluaciones · CMJ, SJ y Drop Jump</h2>
    ${renderAssessmentsBlock(assess, assessError)}`;

  box.querySelectorAll('[data-period]').forEach((b) => (b.onclick = () => { progressPeriod = b.dataset.period; renderProgress(box, view, ctx); }));
  box.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog('¿Borrar esta sesión y sus series?', 'Borrar sesión'))) return;
    const { error: e } = await supabase.from('workouts').delete().eq('id', b.dataset.del);
    if (e) notify(e.message); else renderProgress(box, view, ctx);
  }));
  box.querySelectorAll('[data-edit-session]').forEach((b) => (b.onclick = () => editSessionMeta(ws.find((w) => w.id === b.dataset.editSession), box, view, ctx)));
  bindAssessmentForm(box, view, ctx);
}

function editSessionMeta(w, box, view, ctx) {
  const m = modal(`<div class="sheet-h"><b>Editar sesión</b><button class="link" data-close>Cerrar</button></div>
    <p class="muted">Solo puedes editar la fecha, duración, esfuerzo y notas. Las series se editan borrando y repitiendo la sesión.</p>
    <label for="em-date">Fecha</label><input id="em-date" type="date" max="${today()}" value="${w.performed_on}">
    <label for="em-dur">Duración (min)</label><input id="em-dur" type="number" min="1" inputmode="numeric" value="${w.duration_min || ''}">
    <label for="em-rpe">Esfuerzo (1-10)</label><input id="em-rpe" type="number" min="1" max="10" inputmode="numeric" value="${w.rpe || ''}">
    <label for="em-notes">Notas</label><textarea id="em-notes" maxlength="300" rows="2">${esc(w.notes || '')}</textarea>
    <div class="sheet-f"><button class="btn" id="em-save" type="button">Guardar</button></div><p class="msg" id="em-msg"></p>`);
  m.querySelector('[data-close]').onclick = () => m.remove();
  $('#em-save', m).onclick = async () => {
    const { error } = await supabase.from('workouts').update({ performed_on: $('#em-date', m).value, duration_min: num($('#em-dur', m).value), rpe: num($('#em-rpe', m).value), notes: $('#em-notes', m).value.trim() || null }).eq('id', w.id);
    if (error) { $('#em-msg', m).textContent = error.message; return; }
    m.remove(); notify('Sesión actualizada.', 'success'); renderProgress(box, view, ctx);
  };
}

function renderAssessmentsBlock(rows, assessError) {
  if (assessError) return `<div class="card warn">No se pudieron cargar las evaluaciones: ${esc(assessError.message)}. Si aparece que la tabla no existe, aplica la migración 0013.</div>`;
  const byType = { cmj: [], sj: [], drop_jump: [] };
  rows.forEach((r) => byType[r.test_type]?.push(r));
  const last = (type) => byType[type][0]; const prev = (type) => byType[type][1];
  const diff = (a, b) => (a != null && b != null ? (Number(a) - Number(b)) : null);
  const compareLine = (type, label) => {
    const l = last(type), p = prev(type);
    if (!l) return '';
    const h = l.jump_height_cm ?? estimatedHeight(l);
    const ph = p ? (p.jump_height_cm ?? estimatedHeight(p)) : null;
    const d = diff(h, ph);
    return `<p><b>${label}:</b> ${h != null ? fmt(h, 1) + ' cm' : '—'}${d != null ? ` <span class="muted">(${d >= 0 ? '+' : ''}${fmt(d, 1)} cm vs. anterior)</span>` : ''}</p>`;
  };
  return `<div class="card"><h3>Comparación</h3>${compareLine('cmj', 'CMJ')}${compareLine('sj', 'SJ')}${compareLine('drop_jump', 'Drop Jump')}${!rows.length ? '<p class="muted">Registra al menos dos evaluaciones del mismo tipo para comparar.</p>' : ''}</div>
  <div class="card"><h3>Registrar evaluación</h3><p class="muted">Ingresa resultados medidos con una plataforma de contacto, alfombra de salto u otra herramienta. La altura se calcula sola a partir del tiempo de vuelo si no la mides directamente; el RSI se calcula solo si faltan ambos datos.</p><form id="plyo-assessment-form"><label for="assessment-type">Prueba</label><select id="assessment-type"><option value="cmj">CMJ · Countermovement Jump</option><option value="sj">SJ · Squat Jump</option><option value="drop_jump">Drop Jump</option></select><label for="assessment-date">Fecha</label><input id="assessment-date" type="date" value="${today()}" max="${today()}" required><div class="row"><div><label for="assessment-height">Altura medida (cm)</label><input id="assessment-height" type="number" min="0" max="250" step="0.1" inputmode="decimal"></div><div><label for="assessment-flight">Vuelo (ms)</label><input id="assessment-flight" type="number" min="0" max="3000" step="1" inputmode="decimal"></div></div><div class="row"><div><label for="assessment-contact">Contacto (ms)</label><input id="assessment-contact" type="number" min="0" max="3000" step="1" inputmode="decimal"></div><div><label for="assessment-rsi">RSI medido (opcional)</label><input id="assessment-rsi" type="number" min="0" max="20" step="0.001" inputmode="decimal"></div></div><label for="assessment-notes">Notas</label><textarea id="assessment-notes" maxlength="500" rows="2"></textarea><button class="btn" type="submit">Guardar evaluación</button><p class="msg" id="assessment-msg"></p></form></div>
  <h3>Evaluaciones anteriores</h3><div class="activity-list">${rows.map((r) => {
    const h = r.jump_height_cm ?? estimatedHeight(r); const estimated = r.jump_height_cm == null && h != null;
    const rsi = r.rsi ?? estimatedRsi(r, h);
    return `<article class="card"><b>${({ cmj: 'CMJ', sj: 'SJ', drop_jump: 'Drop Jump' })[r.test_type]}</b><span>${r.measured_on}</span><p>${h != null ? `Altura: ${fmt(h, 1)} cm${estimated ? ' (estimada)' : ''} · ` : ''}${r.flight_time_ms != null ? `Vuelo: ${fmt(r.flight_time_ms, 0)} ms · ` : ''}${r.contact_time_ms != null ? `Contacto: ${fmt(r.contact_time_ms, 0)} ms · ` : ''}${rsi != null ? `RSI: ${fmt(rsi, 3)}${r.rsi == null ? ' (calculado)' : ''}` : ''}</p>${r.notes ? `<p class="muted">${esc(r.notes)}</p>` : ''}<button type="button" class="link" data-assessment-delete="${r.id}">Borrar evaluación</button></article>`;
  }).join('') || '<p class="card muted">Aún no hay evaluaciones registradas.</p>'}</div>`;
}

// Altura (cm) = 9.81 × (vuelo en s)² / 8 × 100, asumiendo despegue y aterrizaje a la misma altura.
// Es una estimación de protocolo, no una medición directa de fuerza.
function estimatedHeight(r) {
  if (r.jump_height_cm != null) return Number(r.jump_height_cm);
  if (r.flight_time_ms == null) return null;
  const t = Number(r.flight_time_ms) / 1000;
  return (9.81 * t * t) / 8 * 100;
}
// RSI = altura de salto (m) / tiempo de contacto (s); solo se calcula si faltan ambos.
function estimatedRsi(r, height) {
  if (r.rsi != null) return Number(r.rsi);
  if (height == null || r.contact_time_ms == null) return null;
  const contactS = Number(r.contact_time_ms) / 1000;
  if (!contactS) return null;
  return (height / 100) / contactS;
}

function bindAssessmentForm(box, view, ctx) {
  const form = $('#plyo-assessment-form', box); if (!form) return;
  $('#assessment-type', box).onchange = (e) => { const drop = e.target.value === 'drop_jump'; $('#assessment-contact', box).required = drop; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = e.currentTarget.querySelector('[type=submit]'), msg = $('#assessment-msg', box); button.disabled = true;
    const val = (id) => $('#' + id, box).value;
    const row = { test_type: val('assessment-type'), measured_on: val('assessment-date'), jump_height_cm: num(val('assessment-height')), flight_time_ms: num(val('assessment-flight')), contact_time_ms: num(val('assessment-contact')), rsi: num(val('assessment-rsi')), notes: val('assessment-notes').trim() || null };
    if (!Object.entries(row).some(([k, value]) => ['jump_height_cm', 'flight_time_ms', 'contact_time_ms', 'rsi'].includes(k) && typeof value === 'number' && value > 0)) { msg.textContent = 'Registra al menos una medición real.'; button.disabled = false; return; }
    const { error: saveError } = await supabase.from('plyo_assessments').insert(row);
    if (saveError) { msg.textContent = 'No se pudo guardar: ' + saveError.message; button.disabled = false; return; }
    notify('Evaluación guardada.', 'success'); await renderProgress(box, view, ctx);
  };
  box.querySelectorAll('[data-assessment-delete]').forEach((button) => (button.onclick = async () => {
    if (!(await confirmDialog('¿Borrar esta evaluación?', 'Borrar evaluación'))) return;
    const { error: deleteError } = await supabase.from('plyo_assessments').delete().eq('id', button.dataset.assessmentDelete).eq('user_id', ctx.user.id);
    if (deleteError) notify(deleteError.message); else await renderProgress(box, view, ctx);
  }));
}

/* ------------------------- Selector de ejercicios (sesión) ------------------------- */
function picker(ctx, onPick) {
  const chosen = new Set();
  const levels = [...new Set(catalog.map((e) => e.level).filter(Boolean))];
  const equips = [...new Set(catalog.map((e) => e.equipment || 'none'))].sort();
  const m = modal(`<div class="sheet-h"><b>Agregar ejercicios</b><button class="link" data-close>Cerrar</button></div>
    <input id="q" type="search" placeholder="Buscar ejercicio…">
    <div class="pd-cats" id="cats"><button type="button" class="pd-chip on" data-cat="">Todos</button>${PLYO_GROUPS.map((g) => `<button type="button" class="pd-chip" data-cat="${g[0]}">${g[1]}</button>`).join('')}</div>
    <div class="row"><select id="lv"><option value="">Todos los niveles</option>${levels.map((l) => `<option value="${l}">${LEVEL[l] || l}</option>`).join('')}</select>
    <select id="eq"><option value="">Todo el equipo</option>${equips.map((l) => `<option value="${l}">${l === 'none' ? 'Sin equipo' : l}</option>`).join('')}</select></div>
    <div id="grid" class="egrid"></div>
    <div class="sheet-f"><button class="btn" id="ok">Agregar</button> <button class="link" id="newex">Crear ejercicio propio</button></div>`);
  const grid = $('#grid', m);
  let cat = '';
  m.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => { cat = b.dataset.cat; m.querySelectorAll('[data-cat]').forEach((c) => c.classList.toggle('on', c === b)); draw(); }));
  const draw = () => {
    const q = $('#q', m).value.trim().toLowerCase(), lv = $('#lv', m).value, eq = $('#eq', m).value;
    const list = catalog.filter((e) => (!q || (e.name + ' ' + (e.name_es || '')).toLowerCase().includes(q)) && (!lv || e.level === lv) && (!eq || (e.equipment || 'none') === eq) && (!cat || plyoGroup(e) === cat));
    grid.innerHTML = list.length ? list.map((e) => `<button type="button" class="ecard ${chosen.has(e.id) ? 'sel' : ''}" data-id="${esc(e.id)}">${thumb(e, 'th big')}<span>${name(e)}</span></button>`).join('') : '<p class="muted">Sin resultados.</p>';
    grid.querySelectorAll('.ecard').forEach((c) => (c.onclick = () => { chosen.has(c.dataset.id) ? chosen.delete(c.dataset.id) : chosen.add(c.dataset.id); c.classList.toggle('sel'); $('#ok', m).textContent = chosen.size ? `Agregar ${chosen.size}` : 'Agregar'; }));
  };
  ['q', 'lv', 'eq'].forEach((id) => ($('#' + id, m).oninput = draw));
  m.querySelector('[data-close]').onclick = () => m.remove();
  $('#ok', m).onclick = () => { if (chosen.size) onPick([...chosen]); m.remove(); };
  $('#newex', m).onclick = () => customForm(ctx, (e) => { catalog.push(e); chosen.add(e.id); draw(); });
  draw();
}

function customForm(ctx, onDone) {
  const m = modal(`<div class="sheet-h"><b>Ejercicio propio</b><button class="link" data-close>Cerrar</button></div>
    <form id="cf"><label for="cn">Nombre</label><input id="cn" required maxlength="80">
    <div class="row"><div><label for="cl">Nivel</label><select id="cl"><option value="beginner">Principiante</option><option value="intermediate">Intermedio</option><option value="expert">Avanzado</option></select></div>
    <div><label for="ce">Equipo</label><input id="ce" placeholder="cajón, balón…" maxlength="40"></div></div>
    <label for="cm">Músculos (separados por coma)</label><input id="cm" maxlength="120">
    <label for="ci">Cómo se hace (un paso por línea)</label><textarea id="ci" rows="4" maxlength="1200"></textarea>
    <button class="btn" type="submit">Crear</button><p class="msg" id="cmsg"></p></form>`);
  m.querySelector('[data-close]').onclick = () => m.remove();
  $('#cf', m).onsubmit = async (e) => {
    e.preventDefault();
    const row = { id: 'custom-' + crypto.randomUUID(), name: $('#cn', m).value.trim(), category: 'plyometrics', source: 'custom',
      level: $('#cl', m).value, equipment: $('#ce', m).value.trim() || null,
      primary_muscles: $('#cm', m).value.split(',').map((s) => s.trim()).filter(Boolean),
      instructions: $('#ci', m).value.split('\n').map((s) => s.trim()).filter(Boolean) };
    const { error } = await supabase.from('exercises').insert(row);
    if (error) { $('#cmsg', m).textContent = error.message; return; }
    onDone({ ...row, images: [], secondary_muscles: [] }); m.remove();
  };
  void ctx;
}

/* ------------------------------ Biblioteca ------------------------------ */
function openLibrary(ctx, view) {
  const m = modal(`<div class="sheet-h"><b>Biblioteca de ejercicios (${catalog.length})</b><button class="link" data-close>Cerrar</button></div><div id="lib-body"></div>`);
  library($('#lib-body', m), view, ctx);
  m.querySelector('[data-close]').onclick = () => m.remove();
}

function library(box, view, ctx) {
  box.innerHTML = `<input id="lib-q" type="search" placeholder="Buscar por nombre, músculo o equipo…">
    <div id="lib-grid" class="egrid"></div>
    <p><button class="link" id="newex">+ Crear ejercicio propio</button></p>`;
  const grid = $('#lib-grid', box);
  const draw = () => {
    const q = $('#lib-q', box).value.trim().toLowerCase();
    const list = catalog.filter((e) => !q || `${e.name} ${e.name_es || ''} ${(e.primary_muscles || []).join(' ')} ${e.equipment || ''} ${e.level || ''}`.toLowerCase().includes(q));
    grid.innerHTML = list.length ? list.map((e) => `<button type="button" class="ecard" data-id="${esc(e.id)}">${thumb(e, 'th big')}<span>${name(e)}</span></button>`).join('') : '<p class="muted">Sin resultados.</p>';
    grid.querySelectorAll('.ecard').forEach((c) => (c.onclick = () => detail(catalog.find((e) => e.id === c.dataset.id), ctx, view)));
  };
  $('#lib-q', box).oninput = draw; draw();
  $('#newex', box).onclick = () => customForm(ctx, () => draw());
}

function detail(e, ctx, view) {
  const mine = e.source === 'custom' && e.created_by === ctx.user.id;
  const m = modal(`<div class="sheet-h"><b>${name(e)}</b><button class="link" data-close>Cerrar</button></div>
    <div class="imgs">${(e.images || []).map((i) => `<img src="/exercises/${esc(i)}" alt="" loading="lazy">`).join('')}</div>
    <p class="muted">${esc(LEVEL[e.level] || e.level || '')} · ${esc(e.equipment || 'sin equipo')}</p>
    <p><b>Músculos:</b> ${esc((e.primary_muscles || []).join(', ') || '—')}${e.secondary_muscles?.length ? ` <span class="muted">(+ ${esc(e.secondary_muscles.join(', '))})</span>` : ''}</p>
    <ol>${(e.instructions || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    ${mine ? '<button class="link" id="del">Borrar mi ejercicio</button>' : ''}`);
  m.querySelector('[data-close]').onclick = () => m.remove();
  const d = $('#del', m);
  if (d) d.onclick = async () => {
    if (!(await confirmDialog('¿Borrar este ejercicio?', 'Borrar ejercicio'))) return;
    const { error } = await supabase.from('exercises').delete().eq('id', e.id);
    if (error) notify('No se puede borrar (¿ya está en una sesión?): ' + error.message); else { m.remove(); renderPlyo(view, ctx); }
  };
}
