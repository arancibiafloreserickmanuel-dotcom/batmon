import { supabase, $, esc } from '../supabase.js';
import { fmt, today, num, LEVEL, draft, confirmDialog, notify } from './common.js';

const DRAFT_KEY = 'batmon_plyo_draft_v1';
const FIELDS = [ // columnas de cada serie (clave BD, etiqueta corta, step)
  ['reps', 'Reps', 1], ['contacts', 'Contactos', 1], ['height_cm', 'Altura cm', 0.5],
  ['box_height_cm', 'Cajón cm', 1], ['distance_m', 'Dist. m', 0.1], ['weight_kg', 'Peso kg', 0.5], ['rest_sec', 'Desc. s', 5],
];
const name = (e) => esc(e?.name_es || e?.name || '?');
const thumb = (e, cls = 'th') => (e?.images?.[0] ? `<img class="${cls}" loading="lazy" src="/exercises/${esc(e.images[0])}" alt="">` : `<div class="${cls} ph">?</div>`);

let catalog = [];          // ejercicios activos de pliometría
let sub = 'new';           // new | hist | lib
let W = null;              // sesión en construcción
let restTimer = null;
const blankSet = () => Object.fromEntries(FIELDS.map(([k]) => [k, '']));
const blankW = () => ({ date: today(), duration: '', rpe: '', notes: '', items: [] });

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
  const { data = [], error } = await supabase.from('exercises').select('*').eq('category', 'plyometrics').eq('is_active', true).order('name');
  if (error) { view.innerHTML = `<p class="msg">No se pudo cargar el catálogo: ${esc(error.message)}</p>`; return; }
  catalog = data;
  W = W || draft.get(DRAFT_KEY) || blankW();

  view.innerHTML = `<h1>Pliometría</h1>
    <div class="tabs sub"><button data-s="new">Nueva sesión</button><button data-s="hist">Historial</button><button data-s="lib">Ejercicios (${catalog.length})</button></div>
    <div id="sub"></div>`;
  view.querySelectorAll('[data-s]').forEach((b) => { b.classList.toggle('on', b.dataset.s === sub); b.onclick = () => { sub = b.dataset.s; renderPlyo(view, ctx); }; });
  const box = $('#sub', view);
  if (!catalog.length && sub !== 'hist') {
    box.innerHTML = `<div class="card"><p>El catálogo de ejercicios está vacío.</p><p class="muted">${ctx.isAdmin ? 'Ve a Admin → Ejercicios y pulsa “Importar catálogo base”.' : 'Pídele al administrador que importe el catálogo.'}</p></div>`;
    return;
  }
  if (sub === 'new') builder(box, view, ctx); else if (sub === 'hist') await history(box); else library(box, view, ctx);
}

/* ---------------------------- Nueva sesión ---------------------------- */
function builder(box, view, ctx) {
  const save = () => draft.set(DRAFT_KEY, W);
  const draw = () => {
    box.innerHTML = `
      <div class="card"><div class="row3">
        <div><label for="wd">Fecha</label><input id="wd" type="date" max="${today()}" value="${W.date}"></div>
        <div><label for="wm">Duración (min)</label><input id="wm" type="number" min="1" inputmode="numeric" value="${W.duration}"></div>
        <div><label for="wr">Esfuerzo (1-10)</label><input id="wr" type="number" min="1" max="10" inputmode="numeric" value="${W.rpe}"></div></div>
        <label for="wn">Notas</label><input id="wn" type="text" maxlength="300" value="${esc(W.notes)}"></div>
      ${W.items.map((it, i) => {
        const e = catalog.find((c) => c.id === it.ex) || { name: it.ex, images: [] };
        return `<div class="card ex" data-i="${i}">
          <div class="exh">${thumb(e)}<div><b>${name(e)}</b><br><span class="muted">${esc((e.primary_muscles || []).join(', '))}</span></div>
          <button class="link" data-act="rmex" aria-label="Quitar ejercicio">✕</button></div>
          <div class="set-list">${it.sets.map((s, j) => `<div class="set-card" data-j="${j}"><b>Serie ${j + 1}</b>${FIELDS.map(([k, l, st]) => `<label>${l}<span class="stepper"><button type="button" data-step="-" data-k="${k}" aria-label="Restar ${l}">−</button><input aria-label="${l}, serie ${j + 1}" type="number" min="0" step="${st}" inputmode="decimal" data-k="${k}" value="${s[k]}"><button type="button" data-step="+" data-k="${k}" aria-label="Sumar ${l}">+</button></span></label>`).join('')}</div>`).join('')}</div>
          <button class="btn sm ghost" data-act="addset">+ Serie</button><button class="btn sm ghost" data-act="rmset">− Serie</button><button class="btn sm ghost" data-act="copyset">Copiar serie anterior</button></div>`;
      }).join('')}
      <button class="btn ghost" id="addex" type="button">+ Agregar ejercicio</button>
      <div class="card rest-control"><b>Descanso opcional</b><div class="quick-actions"><button class="btn sm ghost" id="reststart" type="button">Iniciar 60 s</button><button class="btn sm ghost" id="reststop" type="button">Detener</button><strong id="restleft" aria-live="polite">01:00</strong></div></div>
      <div><button class="btn" id="savew" type="button">Guardar sesión</button> <button class="link" id="clr" type="button">Vaciar</button><p class="msg" id="wm2"></p></div>`;

    $('#wd', box).oninput = (e) => { W.date = e.target.value; save(); };
    $('#wm', box).oninput = (e) => { W.duration = e.target.value; save(); };
    $('#wr', box).oninput = (e) => { W.rpe = e.target.value; save(); };
    $('#wn', box).oninput = (e) => { W.notes = e.target.value; save(); };
    box.querySelectorAll('.ex').forEach((card) => {
      const it = W.items[+card.dataset.i];
      card.querySelectorAll('input[data-k]').forEach((inp) => (inp.oninput = () => { it.sets[+inp.closest('.set-card').dataset.j][inp.dataset.k] = inp.value; save(); }));
      card.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => {
        const input = b.parentElement.querySelector('input'); const step = Number(input.step) || 1;
        const value = Math.max(0, (Number(input.value) || 0) + (b.dataset.step === '+' ? step : -step));
        input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
      }));
      card.querySelector('[data-act=addset]').onclick = () => { const last = it.sets[it.sets.length - 1]; it.sets.push(last ? { ...last } : blankSet()); save(); draw(); };
      card.querySelector('[data-act=rmset]').onclick = () => { if (it.sets.length > 1) it.sets.pop(); save(); draw(); };
      card.querySelector('[data-act=copyset]').onclick = () => { if (it.sets.length > 1) it.sets[it.sets.length - 1] = { ...it.sets[it.sets.length - 2] }; save(); draw(); };
      card.querySelector('[data-act=rmex]').onclick = () => { W.items.splice(+card.dataset.i, 1); save(); draw(); };
    });
    $('#addex', box).onclick = () => picker(ctx, (ids) => { ids.forEach((id) => W.items.push({ ex: id, sets: [blankSet(), blankSet(), blankSet()] })); save(); draw(); });
    $('#reststart', box).onclick = () => {
      clearInterval(restTimer); let left = 60; $('#restleft', box).textContent = '01:00';
      restTimer = setInterval(() => { left -= 1; const out = $('#restleft', box); if (out) out.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`; if (left <= 0) { clearInterval(restTimer); notify('Descanso terminado', 'success'); } }, 1000);
    };
    $('#reststop', box).onclick = () => { clearInterval(restTimer); $('#restleft', box).textContent = '01:00'; };
    $('#clr', box).onclick = () => confirmDialog('¿Vaciar la sesión en curso?', 'Vaciar sesión').then((ok) => { if (ok) { W = blankW(); draft.del(DRAFT_KEY); draw(); } });
    $('#savew', box).onclick = () => saveWorkout(box, () => { W = blankW(); draft.del(DRAFT_KEY); sub = 'hist'; renderPlyo(view, ctx); });
  };
  draw();
}

async function saveWorkout(box, done) {
  const msg = $('#wm2', box); msg.textContent = '';
  const items = W.items.map((it, pos) => ({
    ex: it.ex, pos,
    sets: it.sets.filter((s) => FIELDS.some(([k]) => s[k] !== '' && Number(s[k]) > 0)),
  })).filter((it) => it.sets.length);
  if (!items.length) { msg.textContent = 'Agrega al menos un ejercicio con una serie completada.'; return; }
  const btn = $('#savew', box); btn.disabled = true;
  const { data: w, error } = await supabase.from('workouts').insert({
    performed_on: W.date, duration_min: num(W.duration), rpe: num(W.rpe), notes: W.notes.trim() || null,
  }).select('id').single();
  if (error) { msg.textContent = 'Error: ' + error.message; btn.disabled = false; return; }
  const rows = items.flatMap((it) => it.sets.map((s, j) => {
    const r = { workout_id: w.id, exercise_id: it.ex, position: it.pos, set_no: j + 1 };
    FIELDS.forEach(([k]) => { r[k] = num(s[k]) || null; });
    return r;
  }));
  const { error: e2 } = await supabase.from('workout_sets').insert(rows);
  if (e2) { await supabase.from('workouts').delete().eq('id', w.id); msg.textContent = 'Error en las series: ' + e2.message; btn.disabled = false; return; }
  done();
}

/* ------------------------- Selector de ejercicios ------------------------- */
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

/* ------------------------------ Historial ------------------------------ */
async function history(box) {
  const { data: ws = [], error } = await supabase.from('workouts')
    .select('*, workout_sets(*, exercises(name,name_es,images))').order('performed_on', { ascending: false }).order('created_at', { ascending: false }).limit(60);
  if (error) { box.innerHTML = `<p class="msg">${esc(error.message)}</p>`; return; }

  // récords personales por ejercicio
  const rec = {};
  ws.forEach((w) => w.workout_sets.forEach((s) => {
    const r = (rec[s.exercise_id] ||= { ex: s.exercises, h: 0, box: 0, kg: 0, dist: 0 });
    r.h = Math.max(r.h, Number(s.height_cm) || 0); r.box = Math.max(r.box, Number(s.box_height_cm) || 0);
    r.kg = Math.max(r.kg, Number(s.weight_kg) || 0); r.dist = Math.max(r.dist, Number(s.distance_m) || 0);
  }));
  const recs = Object.values(rec).filter((r) => r.h || r.box || r.kg || r.dist);

  box.innerHTML = `
    <div class="grid"><div class="card stat"><b>${ws.length}</b><span>Sesiones</span></div>
    <div class="card stat"><b>${ws.reduce((s, w) => s + w.workout_sets.length, 0)}</b><span>Series</span></div>
    <div class="card stat"><b>${fmt(ws.reduce((s, w) => s + w.workout_sets.reduce((t, x) => t + (x.contacts || x.reps || 0), 0), 0), 0)}</b><span>Contactos/reps</span></div></div>
    ${recs.length ? `<h2>Récords personales</h2><div class="card scroll"><table><tr><th>Ejercicio</th><th>Altura</th><th>Cajón</th><th>Dist.</th><th>Peso</th></tr>
      ${recs.map((r) => `<tr><td>${name(r.ex)}</td><td>${r.h ? r.h + ' cm' : '—'}</td><td>${r.box ? r.box + ' cm' : '—'}</td><td>${r.dist ? r.dist + ' m' : '—'}</td><td>${r.kg ? r.kg + ' kg' : '—'}</td></tr>`).join('')}</table></div>` : ''}
    <h2>Sesiones</h2>
    ${ws.length ? ws.map((w) => {
      const byEx = {};
      w.workout_sets.sort((a, b) => a.position - b.position || a.set_no - b.set_no).forEach((s) => (byEx[s.exercise_id] ||= { ex: s.exercises, sets: [] }).sets.push(s));
      return `<details class="card"><summary><b>${w.performed_on}</b> · ${Object.keys(byEx).length} ejercicios · ${w.workout_sets.length} series${w.duration_min ? ` · ${fmt(w.duration_min, 0)} min` : ''}${w.rpe ? ` · RPE ${w.rpe}` : ''}</summary>
        ${Object.values(byEx).map((g) => `<div class="exh">${thumb(g.ex)}<div><b>${name(g.ex)}</b><br><span class="muted">${g.sets.map((s) => [s.reps && s.reps + ' reps', s.height_cm && s.height_cm + ' cm', s.box_height_cm && 'cajón ' + s.box_height_cm, s.distance_m && s.distance_m + ' m', s.weight_kg && s.weight_kg + ' kg'].filter(Boolean).join(' ')).join(' · ')}</span></div></div>`).join('')}
        ${w.notes ? `<p class="muted">${esc(w.notes)}</p>` : ''}<button class="link" data-del="${w.id}">Borrar sesión</button></details>`;
    }).join('') : '<p class="muted">Aún no registras sesiones.</p>'}`;
  box.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog('¿Borrar esta sesión y sus series?', 'Borrar sesión'))) return;
    const { error: e } = await supabase.from('workouts').delete().eq('id', b.dataset.del);
    if (e) notify(e.message); else history(box);
  }));
}

/* ------------------------------ Biblioteca ------------------------------ */
function library(box, view, ctx) {
  box.innerHTML = `<div class="egrid">${catalog.map((e) => `<button type="button" class="ecard" data-id="${esc(e.id)}">${thumb(e, 'th big')}<span>${name(e)}</span></button>`).join('')}</div>
    <p><button class="link" id="newex">+ Crear ejercicio propio</button></p>`;
  box.querySelectorAll('.ecard').forEach((c) => (c.onclick = () => detail(catalog.find((e) => e.id === c.dataset.id), ctx, view)));
  $('#newex', box).onclick = () => customForm(ctx, () => renderPlyo(view, ctx));
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
