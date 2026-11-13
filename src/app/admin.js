import './app.css';
import { supabase, $, esc, getProfile } from '../supabase.js';
import { fmt, monthStart, RUN_TYPE, DISC, paceStr, confirmDialog, notify } from './common.js';
import baseCatalog from '../data/plyometrics.json';
import translations from '../data/plyometrics_es.json';
import trainingCatalog from '../data/training_exercises.json';

const view = $('#view');
const TABS = [['pagos', 'Pagos'], ['socios', 'Socios'], ['ejercicios', 'Ejercicios']];
const STATUS = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' };
let me = null;

function modal(html) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="sheet">${html}</div>`;
  m.onclick = (e) => { if (e.target === m) m.remove(); };
  document.body.appendChild(m);
  return m;
}

/* ------------------------------- Pagos ------------------------------- */
async function pagos() {
  const [{ data: mems = [] }, { data: profs = [] }] = await Promise.all([
    supabase.from('memberships').select('*').order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, full_name'),
  ]);
  const name = Object.fromEntries(profs.map((p) => [p.id, p.full_name]));
  const urls = {};
  await Promise.all(mems.filter((m) => m.proof_path).map(async (m) => {
    const { data } = await supabase.storage.from('receipts').createSignedUrl(m.proof_path, 3600);
    urls[m.id] = data?.signedUrl;
  }));
  const pending = mems.filter((m) => m.status === 'pending');
  const rest = mems.filter((m) => m.status !== 'pending');
  const proof = (m) => (urls[m.id] ? `<button class="link" data-proof="${m.id}">Ver comprobante</button>` : 'Sin comprobante');
  const btn = (a, id, t, cls = '') => `<button class="btn sm ${cls}" data-a="${a}" data-id="${id}">${t}</button>`;

  $('#body').innerHTML = `
    <h2>Pendientes (${pending.length})</h2>
    <div class="admin-cards">${pending.length ? pending.map((m) => `<article class="card admin-item"><b>${esc(name[m.user_id] || '?')}</b><span>${m.period.slice(0, 7)}</span><div>${proof(m)}</div><div class="quick-actions">${btn('approved', m.id, 'Aprobar')}${btn('rejected', m.id, 'Rechazar', 'ghost')}</div></article>`).join('') : '<p class="card muted">No hay pagos pendientes.</p>'}</div>
    <h2>Historial</h2>
    <div class="admin-cards">${rest.length ? rest.map((m) => `<article class="card admin-item"><b>${esc(name[m.user_id] || '?')}</b><span>${m.period.slice(0, 7)} · <span class="pill ${m.status}">${STATUS[m.status]}</span></span><div>${proof(m)}</div><div class="quick-actions"><button class="btn sm ghost" data-a="pending" data-id="${m.id}">Reabrir</button><button class="btn sm ghost" data-a="delete" data-id="${m.id}">Borrar</button></div></article>`).join('') : '<p class="card muted">Sin historial.</p>'}</div>`;

  $('#body').querySelectorAll('[data-proof]').forEach((b) => (b.onclick = () => {
    const id = b.dataset.proof; const overlay = document.createElement('div'); overlay.className = 'proof-viewer';
    overlay.innerHTML = `<button type="button" class="btn" data-close>Cerrar</button><a class="btn ghost" href="${urls[id]}" target="_blank" rel="noopener">Abrir en pestaña</a><img src="${urls[id]}" alt="Comprobante de pago">`;
    overlay.onclick = (e) => { if (e.target === overlay || e.target.closest('[data-close]')) overlay.remove(); };
    document.body.append(overlay);
  }));

  $('#body').querySelectorAll('[data-a]').forEach((b) => (b.onclick = async () => {
    const a = b.dataset.a, id = b.dataset.id;
    if (a === 'delete' && !(await confirmDialog('¿Borrar este pago del historial? No se puede deshacer.', 'Borrar pago'))) return;
    if (a === 'approved' && !(await confirmDialog('¿Aprobar el pago de este socio?', 'Aprobar pago'))) return;
    if (a === 'rejected' && !(await confirmDialog('¿Rechazar el comprobante de este socio?', 'Rechazar pago'))) return;
    b.disabled = true;
    const { error } = a === 'delete'
      ? await supabase.from('memberships').delete().eq('id', id)
      : await supabase.from('memberships').update({ status: a, approved_at: a === 'approved' ? new Date().toISOString() : null, approved_by: a === 'approved' ? me.id : null }).eq('id', id);
    if (error) notify(error.message); else pagos();
  }));
}

/* ------------------------------- Socios ------------------------------- */
async function socios() {
  const { data = [], error } = await supabase.rpc('admin_member_overview');
  if (error) { $('#body').innerHTML = `<p class="msg">${esc(error.message)}<br>¿Ejecutaste la migración 0002?</p>`; return; }
  $('#body').innerHTML = `<h2>Socios (${data.length})</h2><label class="sr-only" for="member-search">Buscar socio por nombre</label><input id="member-search" type="search" placeholder="Buscar socio por nombre…"><div class="admin-cards" id="member-cards">
    ${data.map((u) => `<article class="card admin-item" data-member="${esc(u.full_name)}"><b>${esc(u.full_name)}</b><span>${esc(u.email)}</span><span>Rol: ${u.role} · ${fmt(u.total_km)} km · ${u.plyo_sessions} sesiones</span><span>Última actividad: ${u.last_activity || '—'} · Pago: ${u.membership ? STATUS[u.membership] : '—'}</span><button class="btn sm ghost" data-d="${u.id}">Ver datos</button></article>`).join('')}
  </div>`;
  $('#member-search').oninput = (e) => { const q = e.target.value.trim().toLowerCase(); $('#member-cards').querySelectorAll('[data-member]').forEach((card) => { card.hidden = !card.dataset.member.toLowerCase().includes(q); }); };
  $('#body').querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => detalle(data.find((u) => u.id === b.dataset.d))));
}

async function detalle(u) {
  const [{ data: acts = [] }, { data: ws = [] }, { data: moduleRows, error: moduleError }] = await Promise.all([
    supabase.from('activities').select('*').eq('user_id', u.id).order('performed_on', { ascending: false }).limit(100),
    supabase.from('workouts').select('*, workout_sets(id)').eq('user_id', u.id).order('performed_on', { ascending: false }).limit(100),
    supabase.from('profile_modules').select('module_key, enabled').eq('user_id', u.id),
  ]);
  const moduleState = { running: true, plyo: true, training: true };
  (moduleRows || []).forEach((row) => { moduleState[row.module_key] = row.enabled; });
  const plyoSessions = ws.filter((w) => w.kind === 'plyometrics');
  const trainingSessions = ws.filter((w) => w.kind === 'training');
  const self = u.id === me.id;
  const m = modal(`<div class="sheet-h"><b>${esc(u.full_name)}</b><button class="link" data-close>Cerrar</button></div>
    <p class="muted">${esc(u.email)} · alta ${u.created_at.slice(0, 10)} · rol <b>${u.role}</b></p>
    <h2>Actividades (${acts.length})</h2><div class="admin-cards">${acts.length ? acts.map((a) => `<article class="card admin-item"><b>${a.performed_on} · ${DISC[a.discipline]}${a.run_type ? ' · ' + RUN_TYPE[a.run_type] : ''}</b><span>${fmt(a.distance_km)} km · ${fmt(a.duration_min)} min${a.discipline === 'running' ? ' · ' + paceStr(a.distance_km, a.duration_min) : ''}</span><button class="btn sm ghost" data-da="${a.id}">Borrar actividad</button></article>`).join('') : '<p class="card muted">Sin datos.</p>'}</div>
    <h2>Pliometría (${plyoSessions.length})</h2><div class="admin-cards">${plyoSessions.length ? plyoSessions.map((w) => `<article class="card admin-item"><b>${w.performed_on}</b><span>${w.workout_sets.length} series${w.duration_min ? ' · ' + fmt(w.duration_min, 0) + ' min' : ''}</span><button class="btn sm ghost" data-dw="${w.id}">Borrar sesión</button></article>`).join('') : '<p class="card muted">Sin datos.</p>'}</div>
    <h2>Entrenamiento (${trainingSessions.length})</h2><div class="admin-cards">${trainingSessions.length ? trainingSessions.map((w) => `<article class="card admin-item"><b>${w.performed_on}</b><span>${w.workout_sets.length} series${w.duration_min ? ' · ' + fmt(w.duration_min, 0) + ' min' : ''}</span><button class="btn sm ghost" data-dw="${w.id}">Borrar entrenamiento</button></article>`).join('') : '<p class="card muted">Sin datos.</p>'}</div>
    <h2>Módulos de este socio</h2><p class="muted">Los módulos desactivados se ocultan en su navegación y accesos directos.</p>
    ${moduleError ? `<p class="msg">No disponible: aplica la migración 0003 para gestionar módulos.</p>` : `<div class="module-settings">${[['running','Running / Ciclismo / Natación'],['plyo','Pliometría'],['training','Entrenamiento']].map(([key,title]) => `<label class="module-toggle"><span>${title}</span><input type="checkbox" data-module="${key}" ${moduleState[key] ? 'checked' : ''} aria-label="Activar ${title}"></label>`).join('')}</div>`}
    <h2>Acciones</h2>
    ${self ? '<p class="muted">Eres tú: no puedes cambiar tu rol ni borrarte.</p>' : `<button class="btn sm ghost" id="role">${u.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}</button>
      <button class="btn sm" id="rmuser" style="background:#a00;border-color:#a00">Eliminar socio y sus datos</button>`}`);
  m.querySelector('[data-close]').onclick = () => m.remove();
  const refresh = () => { m.remove(); socios(); };
  m.querySelectorAll('[data-da]').forEach((b) => (b.onclick = async () => { if (!(await confirmDialog('¿Borrar esta actividad?', 'Borrar actividad'))) return; const { error } = await supabase.from('activities').delete().eq('id', b.dataset.da); if (error) notify(error.message); else { m.remove(); detalle(u); } }));
  m.querySelectorAll('[data-dw]').forEach((b) => (b.onclick = async () => { if (!(await confirmDialog('¿Borrar esta sesión?', 'Borrar sesión'))) return; const { error } = await supabase.from('workouts').delete().eq('id', b.dataset.dw); if (error) notify(error.message); else { m.remove(); detalle(u); } }));
  m.querySelectorAll('[data-module]').forEach((input) => (input.onchange = async () => {
    const key = input.dataset.module; const { error } = await supabase.from('profile_modules').upsert({ user_id: u.id, module_key: key, enabled: input.checked, updated_by: me.id, updated_at: new Date().toISOString() }, { onConflict: 'user_id,module_key' });
    if (error) { input.checked = !input.checked; notify(`No se pudo actualizar el módulo: ${error.message}`); }
    else notify(`Módulo ${input.checked ? 'activado' : 'oculto'} para ${u.full_name}`, 'success');
  }));
  const role = $('#role', m); if (role) role.onclick = async () => {
    const next = u.role === 'admin' ? 'member' : 'admin';
    if (!(await confirmDialog(`¿Cambiar el rol de ${u.full_name} a ${next === 'admin' ? 'administrador' : 'socio'}?`, 'Cambiar rol'))) return;
    const { error } = await supabase.rpc('admin_set_role', { target: u.id, new_role: next }); if (error) notify(error.message); else refresh();
  };
  const rm = $('#rmuser', m); if (rm) rm.onclick = async () => {
    if (!(await confirmDialog(`Se borrará la cuenta de ${u.full_name} y todos sus datos.`, 'Eliminar socio'))) return;
    const { error } = await supabase.rpc('admin_delete_user', { target: u.id }); if (error) notify(error.message); else refresh();
  };
}

/* ----------------------------- Ejercicios ----------------------------- */
async function ejercicios() {
  const { data = [], error } = await supabase.from('exercises').select('*').order('name');
  if (error) { $('#body').innerHTML = `<p class="msg">${esc(error.message)}<br>¿Ejecutaste la migración 0002?</p>`; return; }
  const have = new Set(data.map((e) => e.id));
  const missing = baseCatalog.filter((e) => !have.has(e.id)).length;

  $('#body').innerHTML = `<h2>Catálogo (${data.length})</h2>
    <div class="card"><p class="muted">Dataset base: ${baseCatalog.length} ejercicios de pliometría (free-exercise-db, dominio público). Faltan por importar: <b>${missing}</b>.</p>
      <button class="btn sm" id="imp">${missing ? 'Importar catálogo base' : 'Actualizar catálogo base'}</button><p class="msg" id="im"></p></div>
    <div class="card"><p class="muted">Catálogo inicial de entrenamiento: ${trainingCatalog.length} movimientos. Faltan por importar: <b>${trainingCatalog.filter((e) => !have.has(e.id)).length}</b>.</p><button class="btn sm ghost" id="imp-training">Importar ejercicios de entrenamiento</button><p class="msg" id="training-import-msg"></p></div>
    <div class="card"><p class="muted">Traducciones al español: ${translations.length} nombres.</p><button class="btn sm ghost" id="apply-es">Aplicar traducciones</button><p class="msg" id="es-msg"></p></div>
    <input id="q" type="search" placeholder="Buscar…" style="margin:10px 0">
    <div id="tb" class="admin-cards"></div>`;

  const draw = () => {
    const q = $('#q').value.trim().toLowerCase();
    $('#tb').innerHTML = data.filter((e) => !q || (e.name + (e.name_es || '')).toLowerCase().includes(q)).map((e) => `<article class="card admin-item exercise-admin-card">
        <div class="exh">${e.images?.[0] ? `<img class="th" loading="lazy" src="/exercises/${esc(e.images[0])}" alt="">` : ''}<div><b>${esc(e.name)}</b><span>${esc(e.source)}</span></div></div>
        <label>Nombre en español<input data-es="${esc(e.id)}" value="${esc(e.name_es || '')}" placeholder="Traducción"></label>
        <label class="active-toggle"><input type="checkbox" data-act="${esc(e.id)}" ${e.is_active ? 'checked' : ''}> Activo en la biblioteca</label>
        <button class="btn sm ghost" data-rm="${esc(e.id)}">Borrar ejercicio</button></article>`).join('') || '<p class="card muted">No hay ejercicios que coincidan.</p>';
    $('#tb').querySelectorAll('[data-es]').forEach((i) => (i.onchange = async () => { const { error: er } = await supabase.from('exercises').update({ name_es: i.value.trim() || null }).eq('id', i.dataset.es); if (er) notify(er.message); else data.find((e) => e.id === i.dataset.es).name_es = i.value.trim() || null; }));
    $('#tb').querySelectorAll('[data-act]').forEach((i) => (i.onchange = async () => { const { error: er } = await supabase.from('exercises').update({ is_active: i.checked }).eq('id', i.dataset.act); if (er) { notify(er.message); i.checked = !i.checked; } }));
    $('#tb').querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => {
      if (!(await confirmDialog('¿Borrar este ejercicio del catálogo?', 'Borrar ejercicio'))) return;
      const { error: er } = await supabase.from('exercises').delete().eq('id', b.dataset.rm);
      if (er) notify('No se puede borrar (¿ya se usó en sesiones?). Mejor desactívalo. ' + er.message); else ejercicios();
    }));
  };
  $('#q').oninput = draw; draw();

  $('#imp').onclick = async () => {
    $('#imp').disabled = true; $('#im').textContent = 'Importando…';
    // name_es / is_active NO se envían, así que un upsert no pisa traducciones ni desactivaciones
    const rows = baseCatalog.map((e) => ({ id: e.id, name: e.name, category: 'plyometrics', level: e.level, equipment: e.equipment,
      primary_muscles: e.primary_muscles, secondary_muscles: e.secondary_muscles, instructions: e.instructions, images: e.images, source: 'dataset', created_by: null }));
    const { error: er } = await supabase.from('exercises').upsert(rows, { onConflict: 'id' });
    if (er) { $('#im').textContent = 'Error: ' + er.message; $('#imp').disabled = false; } else ejercicios();
  };
  $('#imp-training').onclick = async () => {
    const button = $('#imp-training'); button.disabled = true; $('#training-import-msg').textContent = 'Importando…';
    const rows = trainingCatalog.filter((e) => !have.has(e.id)).map((e) => ({ id: e.id, name: e.name, name_es: e.name_es, category: 'training', level: 'beginner', equipment: e.equipment, primary_muscles: e.primary_muscles, secondary_muscles: [], instructions: e.instructions, images: [], source: 'dataset', created_by: null }));
    if (!rows.length) { $('#training-import-msg').textContent = 'El catálogo ya está completo.'; button.disabled = false; return; }
    const { error: importError } = await supabase.from('exercises').insert(rows);
    if (importError) { $('#training-import-msg').textContent = `No se pudo importar: ${importError.message}`; button.disabled = false; }
    else ejercicios();
  };
  $('#apply-es').onclick = async () => {
    const button = $('#apply-es'); button.disabled = true; $('#es-msg').textContent = 'Aplicando traducciones…';
    const results = await Promise.all(translations.map(({ id, name_es }) => supabase.from('exercises').update({ name_es }).eq('id', id)));
    const failed = results.filter((r) => r.error);
    if (failed.length) { $('#es-msg').textContent = `No se pudieron actualizar ${failed.length} traducciones: ${failed[0].error.message}`; button.disabled = false; }
    else ejercicios();
  };
}

/* ------------------------------- Shell ------------------------------- */
const SECTIONS = { pagos, socios, ejercicios };
function route() {
  const t = SECTIONS[location.hash.slice(1)] ? location.hash.slice(1) : 'pagos';
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + t));
  $('#body').innerHTML = '<p class="muted center">Cargando…</p>';
  SECTIONS[t]().catch((e) => { $('#body').innerHTML = `<p class="msg">Error: ${esc(e.message)}</p>`; });
}

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { location.href = '/app.html'; return; }
  me = await getProfile(session.user.id);
  if (me?.role !== 'admin') { view.innerHTML = '<h1>Sin acceso</h1><p class="muted">Esta sección es solo para administradores.</p>'; return; }
  view.innerHTML = '<div id="body"></div>';
  $('#tabs').hidden = false;
  $('#tabs').innerHTML = TABS.map(([h, t]) => `<a href="#${h}">${t}</a>`).join('');
  window.addEventListener('hashchange', route);
  route();
}
void monthStart;
init();
