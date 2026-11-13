import { supabase, $, esc } from '../supabase.js';
import { fmt, today, num, draft, confirmDialog, notify } from './common.js';

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const FIELDS = [['reps', 'Repeticiones', 1], ['weight_kg', 'Peso (kg)', 0.5], ['duration_sec', 'Tiempo (s)', 5], ['rest_sec', 'Descanso (s)', 5]];
let exercises = [], currentPlan = {}, state = 'plan', W = null, restInterval = null;
let ownerKey = '';
const label = (e) => esc(e?.name_es || e?.name || 'Ejercicio');
const blankSet = () => ({ reps: '', weight_kg: '', duration_sec: '', rest_sec: '60' });
const draftKey = () => `batmon_training_draft_${ownerKey}`;

function modal(html) {
  const node = document.createElement('div'); node.className = 'modal';
  node.innerHTML = `<div class="sheet">${html}</div>`;
  node.onclick = (e) => { if (e.target === node) node.remove(); };
  document.body.append(node); return node;
}

export async function renderTraining(view, ctx) {
  if (!ctx.modules?.training) { view.innerHTML = '<h1>Entrenamiento</h1><p class="card muted">Este módulo está desactivado para tu cuenta. Consulta con el administrador del club.</p>'; return; }
  ownerKey = ctx.user.id;
  const [{ data: catalog = [], error: exError }, { data: planRow, error: planError }] = await Promise.all([
    supabase.from('exercises').select('*').eq('category', 'training').eq('is_active', true).order('name_es'),
    supabase.from('training_plans').select('plan').eq('user_id', ctx.user.id).maybeSingle(),
  ]);
  if (exError || planError) {
    view.innerHTML = `<h1>Entrenamiento</h1><div class="card warn">No se pudo cargar el módulo. El administrador debe aplicar la migración 0003 y agregar el catálogo de ejercicios.<p class="msg">${esc(exError?.message || planError?.message || '')}</p></div>`; return;
  }
  exercises = catalog; currentPlan = planRow?.plan || {};
  W = draft.get(draftKey()) || null;
  view.innerHTML = `<h1>Entrenamiento</h1><p class="muted">Organiza tu semana, sigue tus series y compara con tu última sesión.</p>
    <div class="tabs sub training-sub"><button data-state="plan">Mi plan</button><button data-state="session">Entrenar</button><button data-state="history">Historial</button></div><div id="training-content"></div>`;
  const box = $('#training-content', view);
  view.querySelectorAll('[data-state]').forEach((b) => { b.classList.toggle('on', b.dataset.state === state); b.onclick = () => { state = b.dataset.state; renderTraining(view, ctx); }; });
  if (!exercises.length) { box.innerHTML = '<div class="card">Aún no hay ejercicios para este módulo. Pide al administrador que importe el catálogo base desde Admin → Ejercicios.</div>'; return; }
  if (state === 'plan') renderPlan(box, view, ctx);
  else if (state === 'session' && W) drawWorkout(box, view, ctx);
  else if (state === 'session') renderSessionStart(box, view, ctx);
  else await renderHistory(box, view, ctx);
}

function renderPlan(box, view, ctx) {
  box.innerHTML = `<div class="week-plan">${DAYS.map((day) => {
    const rows = currentPlan[day] || [];
    return `<article class="card plan-day"><div class="plan-day-head"><div><span class="muted">Plan semanal</span><h3>${day}</h3></div><button class="btn sm ghost" data-edit-day="${day}">Editar</button></div>
      ${rows.length ? `<ul>${rows.map((r) => `<li>${label(exercises.find((e) => e.id === r.exercise_id))} <span>${r.sets} × ${r.reps || (r.duration_sec ? `${r.duration_sec} s` : '—')}</span></li>`).join('')}</ul>` : '<p class="muted">Día de descanso</p>'}</article>`;
  }).join('')}</div>`;
  box.querySelectorAll('[data-edit-day]').forEach((b) => (b.onclick = () => editPlanDay(b.dataset.editDay, view, ctx)));
}

function editPlanDay(day, view, ctx) {
  const previous = currentPlan[day] || [];
  const selected = new Map(previous.map((row) => [row.exercise_id, { sets: row.sets || 3, reps: row.reps || 10 }]));
  const m = modal(`<div class="sheet-h"><b>Plan · ${day}</b><button class="link" data-close>Cerrar</button></div>
    <label for="exercise-filter">Buscar ejercicio</label><input id="exercise-filter" type="search" placeholder="Ej. sentadilla, flexión…">
    <div class="plan-exercise-list" id="plan-exercise-list"></div>
    <div class="sheet-f quick-actions"><button class="btn ghost" id="rest-day">Marcar descanso</button><button class="btn" id="save-day">Guardar plan</button></div>`);
  const list = $('#plan-exercise-list', m);
  const draw = () => {
    const q = $('#exercise-filter', m).value.trim().toLowerCase();
    list.innerHTML = exercises.filter((e) => !q || `${e.name} ${e.name_es || ''}`.toLowerCase().includes(q)).map((e) => {
      const old = selected.get(e.id);
      return `<article class="plan-pick" data-pick="${esc(e.id)}"><label><input type="checkbox" ${old ? 'checked' : ''}><span><b>${label(e)}</b><small>${esc((e.primary_muscles || []).join(', '))}</small></span></label>
        <div class="plan-target"><label>Series<input data-field="sets" type="number" min="1" max="20" inputmode="numeric" value="${old?.sets || 3}"></label><label>Reps objetivo<input data-field="reps" type="number" min="1" max="999" inputmode="numeric" value="${old?.reps || 10}"></label></div></article>`;
    }).join('') || '<p class="muted">No hay ejercicios con ese nombre.</p>';
    list.querySelectorAll('.plan-pick').forEach((card) => {
      const check = $('input[type=checkbox]', card), id = card.dataset.pick;
      check.onchange = () => { if (check.checked) selected.set(id, { sets: num($('[data-field=sets]', card).value) || 3, reps: num($('[data-field=reps]', card).value) || 10 }); else selected.delete(id); };
      card.querySelectorAll('[data-field]').forEach((input) => (input.oninput = () => { if (check.checked) selected.set(id, { sets: num($('[data-field=sets]', card).value) || 3, reps: num($('[data-field=reps]', card).value) || 10 }); }));
    });
  };
  $('#exercise-filter', m).oninput = draw; draw();
  m.querySelector('[data-close]').onclick = () => m.remove();
  $('#rest-day', m).onclick = () => { currentPlan[day] = []; savePlan(view, ctx, m); };
  $('#save-day', m).onclick = () => {
    currentPlan[day] = [...selected.entries()].map(([exercise_id, config]) => ({ exercise_id, sets: Math.max(1, config.sets || 3), reps: Math.max(1, config.reps || 10) }));
    savePlan(view, ctx, m);
  };
}

async function savePlan(view, ctx, dialog) {
  const { error } = await supabase.from('training_plans').upsert({ user_id: ctx.user.id, plan: currentPlan, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) { notify(`No se pudo guardar el plan: ${error.message}`); return; }
  dialog.remove(); notify('Plan semanal guardado', 'success'); renderTraining(view, ctx);
}

function renderSessionStart(box, view, ctx) {
  const dayName = DAYS[(new Date().getDay() + 6) % 7];
  const todaysPlan = currentPlan[dayName] || [];
  box.innerHTML = `<article class="card start-session"><span class="muted">${dayName} · entrenamiento previsto</span><h2>${todaysPlan.length ? `${todaysPlan.length} ejercicios en tu plan` : 'Sesión libre'}</h2>
    ${todaysPlan.length ? `<ul>${todaysPlan.map((r) => `<li>${label(exercises.find((e) => e.id === r.exercise_id))} · ${r.sets} × ${r.reps}</li>`).join('')}</ul>` : '<p class="muted">No asignaste ejercicios hoy. Puedes iniciar una sesión libre y elegirlos.</p>'}
    <button class="btn" id="start-training">Comenzar sesión</button></article>
    <div class="card"><b>Cómo funciona</b><p class="muted">Cada ejercicio muestra tus valores recientes como punto de partida. Ajusta las series, registra el esfuerzo y guarda la sesión al terminar.</p></div>`;
  $('#start-training', box).onclick = () => startSession(box, view, ctx, dayName);
}

async function startSession(box, view, ctx, dayName) {
  const planItems = currentPlan[dayName] || [];
  const { data: last = [] } = await supabase.from('workouts').select('id, performed_on, workout_sets(*)').eq('kind', 'training').order('performed_on', { ascending: false }).limit(40);
  const entries = planItems.map((p) => {
    const oldSets = last.flatMap((w) => w.workout_sets.filter((s) => s.exercise_id === p.exercise_id).map((s) => ({ ...s, date: w.performed_on })));
    const sets = Array.from({ length: p.sets || 3 }, (_, index) => {
      const recent = oldSets[index] || oldSets.at(-1);
      return { ...blankSet(), reps: String(recent?.reps ?? p.reps ?? ''), weight_kg: String(recent?.weight_kg ?? ''), duration_sec: String(recent?.duration_sec ?? ''), rest_sec: String(recent?.rest_sec ?? 60), previousDate: recent?.date || '' };
    });
    return { exercise_id: p.exercise_id, sets };
  });
  W = { date: today(), duration: '', rpe: '', notes: '', items: entries };
  draft.set(draftKey(), W); state = 'session'; await renderTraining(view, ctx);
}

function drawWorkout(box, view, ctx) {
  const save = () => draft.set(draftKey(), W);
  box.innerHTML = `<div class="card"><div class="row"><div><label for="training-date">Fecha</label><input id="training-date" type="date" max="${today()}" value="${W.date}"></div><div><label for="training-duration">Duración (min)</label><input id="training-duration" type="number" min="1" inputmode="numeric" value="${W.duration}"></div></div>
    <label for="training-rpe">Esfuerzo (RPE 1–10)</label><input id="training-rpe" type="number" min="1" max="10" inputmode="numeric" value="${W.rpe}"><label for="training-notes">Notas de la sesión</label><input id="training-notes" maxlength="300" value="${esc(W.notes)}"></div>
    ${W.items.map((item, i) => drawExerciseCard(item, i)).join('')}
    <button class="btn ghost" id="add-training-exercise" type="button">+ Agregar ejercicio</button>
    <div class="card rest-control"><b>Temporizador de descanso</b><div class="quick-actions"><button class="btn sm ghost" id="start-rest" type="button">Iniciar 60 s</button><button class="btn sm ghost" id="stop-rest" type="button">Detener</button><strong id="rest-clock" aria-live="polite">01:00</strong></div></div>
    <button class="btn" id="save-training" type="button">Guardar entrenamiento</button><p class="msg" id="training-msg"></p>`;
  $('#training-date', box).oninput = (e) => { W.date = e.target.value; save(); };
  $('#training-duration', box).oninput = (e) => { W.duration = e.target.value; save(); };
  $('#training-rpe', box).oninput = (e) => { W.rpe = e.target.value; save(); };
  $('#training-notes', box).oninput = (e) => { W.notes = e.target.value; save(); };
  box.querySelectorAll('[data-training-item]').forEach((card) => {
    const item = W.items[Number(card.dataset.trainingItem)];
    card.querySelectorAll('[data-training-field]').forEach((input) => (input.oninput = () => { item.sets[Number(input.closest('[data-set-index]').dataset.setIndex)][input.dataset.trainingField] = input.value; save(); }));
    card.querySelectorAll('[data-count]').forEach((button) => (button.onclick = () => {
      if (button.dataset.count === 'add') item.sets.push({ ...item.sets.at(-1) });
      else if (item.sets.length > 1) item.sets.pop();
      save(); drawWorkout(box, view, ctx);
    }));
    card.querySelector('[data-remove-exercise]').onclick = () => { W.items.splice(Number(card.dataset.trainingItem), 1); save(); drawWorkout(box, view, ctx); };
  });
  $('#add-training-exercise', box).onclick = () => pickTrainingExercise((id) => { W.items.push({ exercise_id: id, sets: [{ ...blankSet() }, { ...blankSet() }, { ...blankSet() }] }); save(); drawWorkout(box, view, ctx); });
  $('#start-rest', box).onclick = () => runRestTimer(box);
  $('#stop-rest', box).onclick = () => { clearInterval(restInterval); $('#rest-clock', box).textContent = '01:00'; };
  $('#save-training', box).onclick = () => saveWorkout(box, view, ctx);
}

function drawExerciseCard(item, i) {
  const exercise = exercises.find((e) => e.id === item.exercise_id);
  return `<article class="card training-exercise" data-training-item="${i}"><div class="training-exercise-head"><div><b>${label(exercise)}</b><span class="muted">${esc((exercise?.primary_muscles || []).join(', '))}</span></div><button class="link" type="button" data-remove-exercise aria-label="Quitar ejercicio">Quitar</button></div>
    ${item.sets.map((set, j) => `<div class="training-set" data-set-index="${j}"><b>Serie ${j + 1}</b>${set.previousDate ? `<small class="muted">Última vez: ${set.previousDate}</small>` : ''}<div class="training-fields">${FIELDS.map(([key, title, step]) => `<label>${title}<input data-training-field="${key}" type="number" min="0" step="${step}" inputmode="decimal" value="${set[key]}"></label>`).join('')}</div></div>`).join('')}
    <div class="quick-actions"><button class="btn sm ghost" data-count="add" type="button">+ Serie</button><button class="btn sm ghost" data-count="remove" type="button">− Serie</button></div></article>`;
}

function pickTrainingExercise(onPick) {
  const m = modal(`<div class="sheet-h"><b>Agregar ejercicio</b><button class="link" data-close>Cerrar</button></div><label for="training-search">Buscar</label><input id="training-search" type="search" placeholder="Filtrar ejercicios…"><div class="plan-exercise-list" id="training-choices"></div>`);
  const draw = () => {
    const q = $('#training-search', m).value.trim().toLowerCase();
    $('#training-choices', m).innerHTML = exercises.filter((e) => !q || `${e.name} ${e.name_es || ''}`.toLowerCase().includes(q)).map((e) => `<button class="card exercise-choice" type="button" data-ex="${esc(e.id)}"><b>${label(e)}</b><small>${esc((e.primary_muscles || []).join(', '))}</small></button>`).join('');
    m.querySelectorAll('[data-ex]').forEach((b) => (b.onclick = () => { onPick(b.dataset.ex); m.remove(); }));
  };
  $('#training-search', m).oninput = draw; m.querySelector('[data-close]').onclick = () => m.remove(); draw();
}

function runRestTimer(box) {
  clearInterval(restInterval); let remaining = 60;
  const render = () => { const clock = $('#rest-clock', box); if (clock) clock.textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`; };
  render(); restInterval = setInterval(() => { remaining -= 1; render(); if (remaining <= 0) { clearInterval(restInterval); notify('Descanso terminado', 'success'); } }, 1000);
}

async function saveWorkout(box, view, ctx) {
  const msg = $('#training-msg', box); const completed = W.items.map((item, position) => ({ ...item, position, sets: item.sets.filter((s) => num(s.reps) > 0 || num(s.weight_kg) > 0 || num(s.duration_sec) > 0) })).filter((i) => i.sets.length);
  if (!completed.length) { msg.textContent = 'Registra al menos una serie con repeticiones, peso o tiempo.'; return; }
  const button = $('#save-training', box); button.disabled = true;
  const { data: workout, error } = await supabase.from('workouts').insert({ kind: 'training', performed_on: W.date, duration_min: num(W.duration), rpe: num(W.rpe), notes: W.notes.trim() || null }).select('id').single();
  if (error) { msg.textContent = `No se pudo guardar: ${error.message}`; button.disabled = false; return; }
  const rows = completed.flatMap((item) => item.sets.map((set, index) => ({ workout_id: workout.id, exercise_id: item.exercise_id, position: item.position, set_no: index + 1, reps: num(set.reps), weight_kg: num(set.weight_kg), duration_sec: num(set.duration_sec), rest_sec: num(set.rest_sec) })));
  const { error: setError } = await supabase.from('workout_sets').insert(rows);
  if (setError) { await supabase.from('workouts').delete().eq('id', workout.id); msg.textContent = `No se pudieron guardar las series: ${setError.message}`; button.disabled = false; return; }
  draft.del(draftKey()); W = null; state = 'history'; notify('Entrenamiento guardado', 'success'); renderTraining(view, ctx);
}

async function renderHistory(box, view, ctx) {
  const { data: sessions = [], error } = await supabase.from('workouts').select('id, performed_on, duration_min, rpe, notes, workout_sets(*, exercises(name,name_es))').eq('kind', 'training').order('performed_on', { ascending: false }).limit(60);
  if (error) { box.innerHTML = `<p class="msg">${esc(error.message)}</p>`; return; }
  const setCount = sessions.reduce((sum, s) => sum + s.workout_sets.length, 0);
  const volume = sessions.reduce((sum, s) => sum + s.workout_sets.reduce((n, x) => n + (Number(x.weight_kg) || 0) * (Number(x.reps) || 0), 0), 0);
  box.innerHTML = `<div class="grid"><div class="card stat"><b>${sessions.length}</b><span>Sesiones</span></div><div class="card stat"><b>${setCount}</b><span>Series</span></div><div class="card stat"><b>${fmt(volume, 0)} kg</b><span>Volumen registrado</span></div></div>
    <h2>Sesiones guardadas</h2>${sessions.length ? `<div class="activity-list">${sessions.map((s) => `<details class="card training-history"><summary><b>${s.performed_on}</b> · ${s.workout_sets.length} series${s.duration_min ? ` · ${fmt(s.duration_min, 0)} min` : ''}${s.rpe ? ` · RPE ${s.rpe}` : ''}</summary><div class="history-exercises">${groupSets(s.workout_sets).map((group) => `<div class="history-exercise"><b>${label(group.exercise)}</b><span>${group.sets.map((x) => `${x.reps ? `${x.reps} reps` : ''}${x.weight_kg ? ` × ${x.weight_kg} kg` : ''}${x.duration_sec ? ` ${x.duration_sec} s` : ''}`.trim()).join(' · ')}</span></div>`).join('')}</div>${s.notes ? `<p class="muted">${esc(s.notes)}</p>` : ''}<button class="btn sm ghost" type="button" data-delete-session="${s.id}">Borrar sesión</button></details>`).join('')}</div>` : '<p class="card muted">Aún no hay entrenamientos registrados. Arma un plan semanal y empieza tu primera sesión.</p>'}`;
  box.querySelectorAll('[data-delete-session]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog('¿Borrar este entrenamiento y todas sus series?', 'Borrar entrenamiento'))) return;
    const { error: deleteError } = await supabase.from('workouts').delete().eq('id', b.dataset.deleteSession);
    if (deleteError) notify(deleteError.message); else renderTraining(view, ctx);
  }));
  void view;
}

function groupSets(sets) {
  const groups = new Map();
  sets.forEach((set) => { if (!groups.has(set.exercise_id)) groups.set(set.exercise_id, { exercise: set.exercises, sets: [] }); groups.get(set.exercise_id).sets.push(set); });
  return [...groups.values()];
}
