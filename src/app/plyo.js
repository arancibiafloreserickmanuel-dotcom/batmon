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
let restTimer = null, restLeft = 0, restRunning = false;
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
  if (ownerKey !== ctx.user.id) { ownerKey = ctx.user.id; W = null; section = 'train'; activeView = 'home'; }
  const [{ data: exData = [], error: exError }, { data: planRow }, { data: routineRows = [], error: routineError }] = await Promise.all([
    supabase.from('exercises').select('*').eq('category', 'plyometrics').eq('is_active', true).order('name'),
    supabase.from('plyo_plans').select('plan').eq('user_id', ctx.user.id).maybeSingle(),
    supabase.from('plyo_routines').select('*').eq('user_id', ctx.user.id).order('created_at'),
  ]);
  if (exError) { view.innerHTML = `<p class="msg">No se pudo cargar el catálogo: ${esc(exError.message)}</p>`; return; }
  catalog = exData; weekPlan = planRow?.plan || {}; routines = routineRows;
  if (routineError) notify('No se pudieron cargar tus rutinas guardadas: ' + routineError.message);
  W = W || draft.get(userDraftKey());

  view.innerHTML = `<h1>Pliometría</h1>
    <div class="tabs sub"><button data-sec="train">Entrenar</button><button data-sec="plan">Mi plan</button><button data-sec="progress">Progreso</button></div>
    <div id="sub"></div>`;
  view.querySelectorAll('[data-sec]').forEach((b) => { b.classList.toggle('on', b.dataset.sec === section); b.onclick = () => { section = b.dataset.sec; renderPlyo(view, ctx); }; });
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
  if (activeView === 'session' && W) { drawSession(box, view, ctx); return; }
  const todayDay = DAYS[(new Date().getDay() + 6) % 7];
  const entry = weekPlan[todayDay];
  const routine = entry?.routineId ? routines.find((r) => r.id === entry.routineId) : null;
  const hasPending = W && W.status !== 'done';
  box.innerHTML = `
    ${entry?.rest ? '<div class="card"><b>Hoy es tu día de descanso.</b><p class="muted">Consulta tu planificación en Mi plan.</p></div>'
      : routine ? `<article class="card plyo-today"><span class="muted">Sesión de hoy</span><h2>${name(routine)}</h2>${routine.focus ? `<p class="muted">${esc(routine.focus)}</p>` : ''}<p>${routine.items.length} ejercicios · ${routine.items.reduce((s, it) => s + (it.target_sets || 0), 0)} series programadas</p><button class="btn" id="start-today" type="button">Iniciar sesión</button></article>`
      : '<div class="card"><b>Sin rutina programada hoy.</b><p class="muted">Arma tu semana en Mi plan o inicia una sesión libre abajo.</p></div>'}
    <article class="card plyo-quickstart"><h2>Inicio rápido</h2><p class="muted">Empieza una sesión libre y agrega ejercicios sobre la marcha.</p>
      <button class="btn ghost" id="start-quick" type="button">Iniciar sesión rápida</button>
      ${routines.length ? `<div class="row"><select id="quick-routine"><option value="">Elegir una rutina guardada…</option>${routines.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select><button class="btn sm ghost" id="start-saved" type="button">Iniciar</button></div>` : ''}
      <p><button class="link" id="open-lib" type="button">Ver biblioteca de ejercicios</button></p></article>
    ${hasPending ? `<article class="card plyo-pending"><span class="muted">Sesión en curso</span><h2>${W.items.length} ejercicio${W.items.length === 1 ? '' : 's'} sin terminar</h2><div class="quick-actions"><button class="btn" id="continue-session" type="button">Continuar</button><button class="link" id="discard-session" type="button">Descartar</button></div></article>` : ''}`;
  $('#start-today', box)?.addEventListener('click', () => startRoutineSession(routine, todayDay, view, ctx));
  $('#start-quick', box)?.addEventListener('click', () => { W = blankW(); draft.set(userDraftKey(), W); activeView = 'session'; renderPlyo(view, ctx); });
  $('#start-saved', box)?.addEventListener('click', () => { const id = $('#quick-routine', box).value; if (!id) { notify('Elige una rutina.'); return; } startRoutineSession(routines.find((r) => r.id === id), null, view, ctx); });
  $('#open-lib', box)?.addEventListener('click', () => openLibrary(ctx, view));
  $('#continue-session', box)?.addEventListener('click', () => { activeView = 'session'; renderPlyo(view, ctx); });
  $('#discard-session', box)?.addEventListener('click', () => confirmDialog('¿Descartar esta sesión sin guardarla?', 'Descartar sesión').then((ok) => { if (ok) { clearInterval(restTimer); W = null; draft.del(userDraftKey()); renderPlyo(view, ctx); } }));
}

async function startRoutineSession(routine, planDay, view, ctx) {
  if (!routine) return;
  const exIds = routine.items.map((it) => it.exercise_id);
  const { data: last = [] } = await supabase.from('workouts').select('id, performed_on, workout_sets(*)').eq('kind', 'plyometrics').order('performed_on', { ascending: false }).limit(40);
  const items = routine.items.map((it) => {
    const exercise = catalog.find((e) => e.id === it.exercise_id) || { id: it.exercise_id };
    const fields = fieldsFor(exercise);
    const oldSets = last.flatMap((w) => w.workout_sets.filter((s) => s.exercise_id === it.exercise_id).map((s) => ({ ...s, date: w.performed_on })));
    const count = Math.max(1, it.target_sets || 3);
    const sets = Array.from({ length: count }, (_, i) => {
      const recent = oldSets[i] || oldSets.at(-1);
      const s = {}; fields.forEach((f) => { s[f] = String(recent?.[f] ?? it.targets?.[f] ?? ''); });
      return s;
    });
    return { ex: it.exercise_id, sets, done: false, restSec: it.rest_sec || 60 };
  });
  void exIds;
  W = { ...blankW(), items, routineId: routine.id, planDay };
  draft.set(userDraftKey(), W); activeView = 'session'; await renderPlyo(view, ctx);
}

/* --------------------------------- Sesión activa --------------------------------- */
function drawSession(box, view, ctx) {
  const save = () => draft.set(userDraftKey(), W);
  const completedCount = W.items.filter((it) => it.done).length;
  const routineName = W.routineId ? routines.find((r) => r.id === W.routineId)?.name : '';
  box.innerHTML = `
    <div class="card plyo-session-head"><div class="plyo-progress"><i style="width:${W.items.length ? (completedCount / W.items.length) * 100 : 0}%"></i></div><span class="muted">${completedCount} de ${W.items.length} ejercicios completados${routineName ? ` · ${esc(routineName)}` : ' · Sesión libre'}</span></div>
    ${W.items.map((it, i) => drawExerciseCard(it, i)).join('')}
    <button class="btn ghost" id="addex" type="button">+ Agregar ejercicio</button>
    <div class="card rest-control"><b>Temporizador de descanso</b>
      <div class="rest-presets">${REST_PRESETS.map((s) => `<button type="button" class="btn sm ghost" data-rest-start="${s}">${s} s</button>`).join('')}<input id="rest-custom" type="number" min="5" max="900" step="5" inputmode="numeric" placeholder="Personalizado"><button class="btn sm ghost" id="rest-custom-start" type="button">Iniciar</button></div>
      <div class="quick-actions"><button class="btn sm ghost" id="rest-pause" type="button">Pausar</button><button class="btn sm ghost" id="rest-resume" type="button">Reanudar</button><button class="btn sm ghost" id="rest-minus" type="button">−15 s</button><button class="btn sm ghost" id="rest-plus" type="button">+15 s</button><button class="btn sm ghost" id="rest-skip" type="button">Saltar</button><strong id="restleft" aria-live="polite">${fmtClock(restLeft)}</strong></div></div>
    <div class="card"><label for="wd">Fecha</label><input id="wd" type="date" max="${today()}" value="${W.date}">
      <label for="wm">Duración (min)</label><input id="wm" type="number" min="1" inputmode="numeric" value="${W.duration}">
      <label for="wr">Esfuerzo (RPE 1-10)</label><input id="wr" type="number" min="1" max="10" inputmode="numeric" value="${W.rpe}">
      <label for="wn">Notas</label><input id="wn" type="text" maxlength="300" value="${esc(W.notes)}"></div>
    <div><button class="btn" id="savew" type="button">Finalizar y guardar</button> <button class="link" id="clr" type="button">Descartar sesión</button></div><p class="msg" id="wm2"></p>`;

  box.querySelectorAll('.ex').forEach((card) => {
    const it = W.items[+card.dataset.i];
    card.querySelectorAll('input[data-k]').forEach((inp) => (inp.oninput = () => { it.sets[+inp.closest('.set-card').dataset.j][inp.dataset.k] = inp.value; save(); }));
    card.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => {
      const input = b.parentElement.querySelector('input'); const step = Number(input.step) || 1;
      const value = Math.max(0, (Number(input.value) || 0) + (b.dataset.step === '+' ? step : -step));
      input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
    }));
    card.querySelector('[data-act=addset]').onclick = () => { const last = it.sets[it.sets.length - 1]; it.sets.push(last ? { ...last } : blankSetFor(catalog.find((c) => c.id === it.ex) || {})); save(); drawSession(box, view, ctx); };
    card.querySelector('[data-act=rmset]').onclick = () => { if (it.sets.length > 1) it.sets.pop(); save(); drawSession(box, view, ctx); };
    card.querySelector('[data-act=copyset]').onclick = () => { if (it.sets.length > 1) it.sets[it.sets.length - 1] = { ...it.sets[it.sets.length - 2] }; save(); drawSession(box, view, ctx); };
    card.querySelector('[data-act=rmex]').onclick = () => { W.items.splice(+card.dataset.i, 1); save(); drawSession(box, view, ctx); };
    card.querySelector('[data-act=done]').onchange = (e) => { it.done = e.target.checked; if (it.done) startRest(box, it.restSec || 60); save(); drawSession(box, view, ctx); };
  });
  $('#addex', box).onclick = () => picker(ctx, (ids) => { ids.forEach((id) => { const ex = catalog.find((c) => c.id === id) || { id }; W.items.push({ ex: id, sets: [blankSetFor(ex), blankSetFor(ex), blankSetFor(ex)], done: false, restSec: 60 }); }); save(); drawSession(box, view, ctx); });
  box.querySelectorAll('[data-rest-start]').forEach((b) => (b.onclick = () => startRest(box, Number(b.dataset.restStart))));
  $('#rest-custom-start', box).onclick = () => { const v = Number($('#rest-custom', box).value); if (v > 0) startRest(box, v); };
  $('#rest-pause', box).onclick = () => { restRunning = false; };
  $('#rest-resume', box).onclick = () => { if (restLeft > 0) restRunning = true; };
  $('#rest-minus', box).onclick = () => { restLeft = Math.max(0, restLeft - 15); const el = $('#restleft', box); if (el) el.textContent = fmtClock(restLeft); };
  $('#rest-plus', box).onclick = () => { restLeft += 15; const el = $('#restleft', box); if (el) el.textContent = fmtClock(restLeft); };
  $('#rest-skip', box).onclick = () => { clearInterval(restTimer); restRunning = false; restLeft = 0; const el = $('#restleft', box); if (el) el.textContent = fmtClock(0); };
  $('#wd', box).oninput = (e) => { W.date = e.target.value; save(); };
  $('#wm', box).oninput = (e) => { W.duration = e.target.value; save(); };
  $('#wr', box).oninput = (e) => { W.rpe = e.target.value; save(); };
  $('#wn', box).oninput = (e) => { W.notes = e.target.value; save(); };
  $('#clr', box).onclick = () => confirmDialog('¿Descartar esta sesión sin guardarla?', 'Descartar sesión').then((ok) => { if (ok) { clearInterval(restTimer); W = null; draft.del(userDraftKey()); activeView = 'home'; renderPlyo(view, ctx); } });
  $('#savew', box).onclick = () => finishSession(box, view, ctx);
}

function drawExerciseCard(it, i) {
  const e = catalog.find((c) => c.id === it.ex) || { id: it.ex, name: it.ex, images: [] };
  const fields = it.sets[0] ? Object.keys(it.sets[0]) : fieldsFor(e);
  return `<article class="card ex ${it.done ? 'is-done' : ''}" data-i="${i}">
    <div class="exh">${thumb(e)}<div><b>${name(e)}</b><br><span class="muted">${esc((e.primary_muscles || []).join(', '))}</span></div>
      <label class="plyo-done-toggle"><input type="checkbox" data-act="done" ${it.done ? 'checked' : ''}> Hecho</label>
      <button class="link" data-act="rmex" aria-label="Quitar ejercicio">✕</button></div>
    ${(e.instructions || [])[0] ? `<p class="muted plyo-hint">${esc(e.instructions[0])}</p>` : ''}
    <div class="set-list">${it.sets.map((s, j) => `<div class="set-card" data-j="${j}"><b>Serie ${j + 1}</b>${fields.map((k) => `<label>${FIELD_LABELS[k][0]}<span class="stepper"><button type="button" data-step="-" data-k="${k}" aria-label="Restar">−</button><input aria-label="${FIELD_LABELS[k][0]}, serie ${j + 1}" type="number" min="0" step="${FIELD_LABELS[k][1]}" inputmode="decimal" data-k="${k}" value="${s[k]}"><button type="button" data-step="+" data-k="${k}" aria-label="Sumar">+</button></span></label>`).join('')}</div>`).join('')}</div>
    <div class="quick-actions"><button class="btn sm ghost" data-act="addset">+ Serie</button><button class="btn sm ghost" data-act="rmset">− Serie</button><button class="btn sm ghost" data-act="copyset">Copiar serie anterior</button></div></article>`;
}

function startRest(box, seconds) {
  clearInterval(restTimer); restLeft = Math.max(0, seconds); restRunning = true;
  const paint = () => { const el = $('#restleft', box); if (el) el.textContent = fmtClock(restLeft); };
  paint();
  restTimer = setInterval(() => {
    if (!restRunning) return;
    restLeft -= 1; paint();
    if (restLeft <= 0) { clearInterval(restTimer); restRunning = false; notify('Descanso terminado', 'success'); }
  }, 1000);
}

async function finishSession(box, view, ctx) {
  const msg = $('#wm2', box); msg.textContent = '';
  const items = W.items.map((it, pos) => ({ ex: it.ex, pos, sets: it.sets.filter((s) => Object.values(s).some((v) => v !== '' && Number(v) > 0)) })).filter((it) => it.sets.length);
  if (!items.length) { msg.textContent = 'Agrega al menos un ejercicio con una serie completada.'; return; }
  const btn = $('#savew', box); btn.disabled = true;
  const { data: w, error } = await supabase.from('workouts').insert({
    kind: 'plyometrics', performed_on: W.date, duration_min: num(W.duration), rpe: num(W.rpe), notes: W.notes.trim() || null,
    source_routine_id: W.routineId || null, plan_day: W.planDay || null,
  }).select('id').single();
  if (error) { msg.textContent = 'Error: ' + error.message; btn.disabled = false; return; }
  const rows = items.flatMap((it) => it.sets.map((s, j) => {
    const r = { workout_id: w.id, exercise_id: it.ex, position: it.pos, set_no: j + 1 };
    Object.entries(s).forEach(([k, v]) => { r[k] = num(v); });
    return r;
  }));
  const { error: e2 } = await supabase.from('workout_sets').insert(rows);
  if (e2) { await supabase.from('workouts').delete().eq('id', w.id); msg.textContent = 'Error en las series: ' + e2.message; btn.disabled = false; return; }
  const finishedW = { ...W, items };
  W = null; draft.del(userDraftKey()); activeView = 'home';
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
    return { exercise_id: it.ex, target_sets: it.sets.length, rest_sec: prev?.rest_sec || 60, targets };
  });
  const { error } = await supabase.from('plyo_routines').update({ items: newItems, updated_at: new Date().toISOString() }).eq('id', routine.id);
  if (error) notify('No se pudo actualizar la rutina: ' + error.message); else notify('Rutina actualizada.', 'success');
}

/* ----------------------------------- Mi plan ----------------------------------- */
function renderPlan(box, view, ctx) {
  box.innerHTML = `
    <div class="card plyo-week-nav" role="tablist" aria-label="Días de la semana">${DAYS.map((d) => {
      const entry = weekPlan[d];
      const state = entry?.rest ? 'rest' : entry?.routineId ? 'set' : 'empty';
      return `<button type="button" class="plyo-day-chip ${state} ${d === selectedPlanDay ? 'sel' : ''}" data-day="${d}">${d.slice(0, 3)}</button>`;
    }).join('')}</div>
    <div id="plyo-day-detail"></div>
    <h2>Mis rutinas guardadas</h2>
    <div class="activity-list" id="plyo-routine-list">${routines.length ? routines.map((r) => `<article class="card"><b>${esc(r.name)}</b>${r.focus ? ` <span class="muted">· ${esc(r.focus)}</span>` : ''}<p class="muted">${r.items.length} ejercicios</p><div class="quick-actions"><button class="btn sm ghost" data-routine-edit="${r.id}">Editar</button><button class="btn sm ghost" data-routine-dup="${r.id}">Duplicar</button><button class="link" data-routine-del="${r.id}">Eliminar</button></div></article>`).join('') : '<p class="card muted">Aún no tienes rutinas. Crea una desde cualquier día.</p>'}</div>
    <button class="btn ghost" id="plyo-new-routine" type="button">+ Crear rutina nueva</button>
    <p><button class="link" id="open-lib-plan" type="button">Ver biblioteca de ejercicios</button></p>`;
  drawDayDetail(box, view, ctx);
  box.querySelectorAll('[data-day]').forEach((b) => (b.onclick = () => { selectedPlanDay = b.dataset.day; drawDayDetail(box, view, ctx); box.querySelectorAll('[data-day]').forEach((c) => c.classList.toggle('sel', c.dataset.day === selectedPlanDay)); }));
  box.querySelectorAll('[data-routine-edit]').forEach((b) => (b.onclick = () => routineForm(ctx, routines.find((r) => r.id === b.dataset.routineEdit), () => renderPlyo(view, ctx))));
  box.querySelectorAll('[data-routine-dup]').forEach((b) => (b.onclick = () => duplicateRoutine(ctx, b.dataset.routineDup, view)));
  box.querySelectorAll('[data-routine-del]').forEach((b) => (b.onclick = () => deleteRoutine(ctx, b.dataset.routineDel, view)));
  $('#plyo-new-routine', box).onclick = () => routineForm(ctx, null, () => renderPlyo(view, ctx));
  $('#open-lib-plan', box).onclick = () => openLibrary(ctx, view);
}

function drawDayDetail(box, view, ctx) {
  const host = $('#plyo-day-detail', box);
  const entry = weekPlan[selectedPlanDay];
  const routine = entry?.routineId ? routines.find((r) => r.id === entry.routineId) : null;
  host.innerHTML = `<div class="card plyo-day-detail">
    <h3>${selectedPlanDay}</h3>
    ${entry?.rest ? '<p class="muted">Día de descanso.</p>' : routine ? `<p><b>${esc(routine.name)}</b>${routine.focus ? ` · ${esc(routine.focus)}` : ''}</p><p class="muted">${routine.items.length} ejercicios</p>` : '<p class="muted">Sin configurar.</p>'}
    <div class="quick-actions">
      ${routine ? '<button class="btn sm ghost" data-day-edit type="button">Editar rutina</button><button class="btn sm ghost" data-day-clear type="button">Quitar</button>' : ''}
      ${!entry?.rest ? '<button class="btn sm ghost" data-day-assign type="button">Asignar rutina</button><button class="btn sm ghost" data-day-newroutine type="button">Crear rutina</button>' : ''}
      <button class="btn sm ghost" data-day-rest type="button">${entry?.rest ? 'Quitar descanso' : 'Marcar descanso'}</button>
      <button class="btn sm ghost" data-day-copy type="button">Copiar día</button>
      <button class="btn sm ghost" data-day-paste type="button" ${copiedDay ? '' : 'disabled'}>Pegar día</button>
    </div></div>`;
  host.querySelector('[data-day-assign]')?.addEventListener('click', () => assignRoutineModal(async (routineId) => { await setDayPlan(ctx, selectedPlanDay, { routineId }); drawDayDetail(box, view, ctx); }));
  host.querySelector('[data-day-newroutine]')?.addEventListener('click', () => routineForm(ctx, null, async (newRoutine) => { await setDayPlan(ctx, selectedPlanDay, { routineId: newRoutine.id }); renderPlyo(view, ctx); }));
  host.querySelector('[data-day-edit]')?.addEventListener('click', () => routineForm(ctx, routine, () => renderPlyo(view, ctx)));
  host.querySelector('[data-day-clear]')?.addEventListener('click', async () => { if (!(await confirmDialog('¿Quitar la rutina de este día?', 'Quitar'))) return; await setDayPlan(ctx, selectedPlanDay, null); drawDayDetail(box, view, ctx); });
  host.querySelector('[data-day-rest]')?.addEventListener('click', async () => { const isRest = !!entry?.rest; await setDayPlan(ctx, selectedPlanDay, isRest ? null : { rest: true }); renderPlan(box, view, ctx); });
  host.querySelector('[data-day-copy]')?.addEventListener('click', () => { copiedDay = entry ? { ...entry } : { rest: false, routineId: null }; notify(`${selectedPlanDay} copiado.`, 'success'); renderPlan(box, view, ctx); });
  host.querySelector('[data-day-paste]')?.addEventListener('click', async () => {
    if (!copiedDay) return;
    if (weekPlan[selectedPlanDay]) { const ok = await confirmDialog(`${selectedPlanDay} ya tiene una planificación. ¿Reemplazarla con la copiada?`, 'Reemplazar'); if (!ok) return; }
    await setDayPlan(ctx, selectedPlanDay, copiedDay.rest ? { rest: true } : copiedDay.routineId ? { routineId: copiedDay.routineId } : null);
    renderPlan(box, view, ctx);
  });
}

async function setDayPlan(ctx, day, value) {
  weekPlan = { ...weekPlan }; if (value) weekPlan[day] = value; else delete weekPlan[day];
  const { error } = await supabase.from('plyo_plans').upsert({ user_id: ctx.user.id, plan: weekPlan, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) notify('No se pudo guardar el plan: ' + error.message);
}

function assignRoutineModal(onPick) {
  if (!routines.length) { notify('Primero crea una rutina.'); return; }
  const m = modal(`<div class="sheet-h"><b>Asignar rutina</b><button class="link" data-close>Cerrar</button></div>
    <div class="activity-list">${routines.map((r) => `<button type="button" class="card" data-pick="${r.id}"><b>${esc(r.name)}</b><p class="muted">${r.items.length} ejercicios</p></button>`).join('')}</div>`);
  m.querySelector('[data-close]').onclick = () => m.remove();
  m.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => { onPick(b.dataset.pick); m.remove(); }));
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
    <div class="row"><select id="lv"><option value="">Todos los niveles</option>${levels.map((l) => `<option value="${l}">${LEVEL[l] || l}</option>`).join('')}</select>
    <select id="eq"><option value="">Todo el equipo</option>${equips.map((l) => `<option value="${l}">${l === 'none' ? 'Sin equipo' : l}</option>`).join('')}</select></div>
    <div id="grid" class="egrid"></div>
    <div class="sheet-f"><button class="btn" id="ok">Agregar</button> <button class="link" id="newex">Crear ejercicio propio</button></div>`);
  const grid = $('#grid', m);
  const draw = () => {
    const q = $('#q', m).value.trim().toLowerCase(), lv = $('#lv', m).value, eq = $('#eq', m).value;
    const list = catalog.filter((e) => (!q || (e.name + ' ' + (e.name_es || '')).toLowerCase().includes(q)) && (!lv || e.level === lv) && (!eq || (e.equipment || 'none') === eq));
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
