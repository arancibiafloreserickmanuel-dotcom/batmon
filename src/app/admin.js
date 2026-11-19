import './app.css';
import { autoEnhanceFileInputs } from './upload-field.js';
import { supabase, $, esc, getProfile } from '../supabase.js';
import { fmt, monthStart, RUN_TYPE, DISC, paceStr, confirmDialog, notify, showDelayedLoading } from './common.js';
import baseCatalog from '../data/plyometrics.json';
import translations from '../data/plyometrics_es.json';
import trainingCatalog from '../data/training_exercises.json';

const view = $('#view');
const TABS = [
  ['pagos', 'Pagos', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></svg>'],
  ['socios', 'Socios', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 5.5a3.5 3.5 0 0 1 0 6.8M17 14a5.5 5.5 0 0 1 4.5 5.5"/></svg>'],
  ['modulos', 'Módulos', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>'],
  ['ejercicios', 'Ejercicios', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6m3-9v12m12-12v12m3-9v6M6 12h12"/></svg>'],
  ['eventos', 'Eventos', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h3m-3 3h6"/></svg>'],
  ['retos', 'Retos', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v4a4 4 0 0 1-8 0V4Zm4 8v5m-4 3h8m-8-3h8M8 6H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4"/></svg>'],
];
const STATUS = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' };
let me = null;

function decorateAdminBackButton(button,label='Cerrar',compact=false){
  if(!button)return;
  button.classList.add('animated-back');
  if(compact)button.classList.add('animated-back-compact');
  button.innerHTML=`<span class="animated-back-sweep" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H21z"/></svg></span><span class="animated-back-label">${esc(label)}</span>`;
}

function modal(html) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="sheet">${html}</div>`;
  m.querySelectorAll('[data-close]').forEach(button=>decorateAdminBackButton(button,'Cerrar',true));
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
  const proof = (m) => (urls[m.id] ? `<button class="link" data-proof="${m.id}">Ver comprobante</button>` : m.payment_method === 'cash' ? 'Solicitud de pago en efectivo' : 'Sin comprobante');
  const btn = (a, id, t, cls = '') => `<button class="btn sm ${cls}" data-a="${a}" data-id="${id}">${t}</button>`;

  $('#body').innerHTML = `
    <h2>Pendientes (${pending.length})</h2>
    <div class="admin-cards">${pending.length ? pending.map((m) => `<article class="card admin-item"><b>${esc(name[m.user_id] || '?')}</b><span>${m.period.slice(0, 7)} · Método: ${m.payment_method === 'cash' ? 'Efectivo' : 'QR'}</span><div>${proof(m)}</div><div class="quick-actions">${btn('approved', m.id, 'Aprobar')}${btn('rejected', m.id, 'Rechazar', 'ghost')}</div></article>`).join('') : '<p class="card muted">No hay pagos pendientes.</p>'}</div>
    <h2>Historial</h2>
    <div class="admin-cards">${rest.length ? rest.map((m) => `<article class="card admin-item"><b>${esc(name[m.user_id] || '?')}</b><span>${m.period.slice(0, 7)} · ${m.payment_method === 'cash' ? 'Efectivo' : 'QR'} · <span class="pill ${m.status}">${STATUS[m.status]}</span></span><div>${proof(m)}</div><div class="quick-actions"><button class="btn sm ghost" data-a="pending" data-id="${m.id}">Reabrir</button><button class="btn sm ghost" data-a="delete" data-id="${m.id}">Borrar</button></div></article>`).join('') : '<p class="card muted">Sin historial.</p>'}</div>`;

  $('#body').querySelectorAll('[data-proof]').forEach((b) => (b.onclick = () => {
    const id = b.dataset.proof; const overlay = document.createElement('div'); overlay.className = 'proof-viewer';
    overlay.innerHTML = `<button type="button" class="link" data-close>Cerrar</button><a class="btn ghost" href="${urls[id]}" target="_blank" rel="noopener">Abrir en pestaña</a><img src="${urls[id]}" alt="Comprobante de pago">`;
    decorateAdminBackButton(overlay.querySelector('[data-close]'),'Cerrar',true);
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
  const moduleState = { running: true, cycling: true, swimming: true, plyo: true, training: true };
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
    ${moduleError ? `<p class="msg">No disponible: aplica la migración 0004 para gestionar módulos.</p>` : `<div class="module-settings">${[['running','Running'],['cycling','Ciclismo'],['swimming','Natación'],['plyo','Pliometría'],['training','Entrenamiento']].map(([key,title]) => `<label class="module-toggle"><span>${title}</span><span class="module-check"><input type="checkbox" data-module="${key}" ${moduleState[key] ? 'checked' : ''} aria-label="Activar ${title}"><span class="module-checkmark" aria-hidden="true"></span></span></label>`).join('')}</div>`}
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
    const gone = [];
    for (const bucket of ['receipts', 'profile-media']) {
      const { data: files } = await supabase.storage.from(bucket).list(u.id, { limit: 1000 });
      const paths = (files || []).map((f) => `${u.id}/${f.name}`);
      if (paths.length) { const { error: rmError } = await supabase.storage.from(bucket).remove(paths); if (rmError) gone.push(rmError.message); }
    }
    const { error } = await supabase.rpc('admin_delete_user', { target: u.id });
    if (error) notify(error.message); else { notify(gone.length ? 'Cuenta borrada; algunos archivos no se pudieron borrar: ' + gone[0] : 'Cuenta y datos eliminados.', gone.length ? undefined : 'success'); refresh(); }
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

/* ------------------------------- Módulos ------------------------------- */
const MODULES = [['running','Running'],['cycling','Ciclismo'],['swimming','Natación'],['plyo','Pliometría'],['training','Entrenamiento']];
async function modulos() {
  const [{ data: globalRows = [], error: globalError }, { data: users = [], error: userError }, { data: appearance }] = await Promise.all([
    supabase.from('app_modules').select('module_key,enabled'), supabase.from('profiles').select('id,full_name').order('full_name'), supabase.from('site_settings').select('theme_policy').eq('id',true).maybeSingle(),
  ]);
  if (globalError || userError) { $('#body').innerHTML = `<h2>Módulos</h2><p class="msg">Aplica la migración 0004 para configurar módulos.</p>`; return; }
  const globals = Object.fromEntries(globalRows.map((r) => [r.module_key, r.enabled]));
  $('#body').innerHTML = `<h1>Módulos y apariencia</h1><p class="muted">Configura qué módulos y tema verá el club.</p><h2>Tema para todo el club</h2><label for="theme-policy">Apariencia</label><select id="theme-policy"><option value="choice" ${appearance?.theme_policy==='choice'?'selected':''}>Cada socio puede elegir</option><option value="dark" ${appearance?.theme_policy==='dark'?'selected':''}>Forzar modo oscuro</option><option value="light" ${appearance?.theme_policy==='light'?'selected':''}>Forzar modo claro</option></select><p class="muted">Los fondos de textura se aplicarán en ambos modos.</p><h2>Disponibilidad general</h2><div class="module-settings">${MODULES.map(([key,title]) => `<label class="module-toggle"><span>${title}</span><span class="module-check"><input type="checkbox" data-global="${key}" ${globals[key] !== false ? 'checked' : ''} aria-label="Activar ${title} para todos"><span class="module-checkmark" aria-hidden="true"></span></span></label>`).join('')}</div><h2>Acceso por socio</h2><input id="module-user-search" type="search" placeholder="Buscar socio…"><div class="admin-cards" id="module-users">${users.map(u => `<details class="card module-user" data-name="${esc(u.full_name)}"><summary><b>${esc(u.full_name)}</b></summary><div class="module-settings">${MODULES.map(([key,title])=>`<label class="module-toggle"><span>${title}</span><span class="module-check"><input type="checkbox" data-user="${u.id}" data-module="${key}" checked aria-label="Activar ${title} para ${esc(u.full_name)}"><span class="module-checkmark" aria-hidden="true"></span></span></label>`).join('')}</div></details>`).join('')}</div>`;
  $('#theme-policy').onchange=async e=>{const {error}=await supabase.from('site_settings').upsert({id:true,theme_policy:e.target.value,updated_by:me.id,updated_at:new Date().toISOString()},{onConflict:'id'});if(error)notify(error.message);};
  const userRows = await supabase.from('profile_modules').select('user_id,module_key,enabled');
  if (userRows.error) { notify(`No se pudieron leer excepciones: ${userRows.error.message}`); return; }
  userRows.data.forEach(r => { const input = $('#module-users').querySelector(`[data-user="${r.user_id}"][data-module="${r.module_key}"]`); if (input) input.checked = r.enabled; });
  $('#module-user-search').oninput = e => { const q=e.target.value.toLowerCase(); $('#module-users').querySelectorAll('[data-name]').forEach(card => card.hidden=!card.dataset.name.toLowerCase().includes(q)); };
  $('#body').querySelectorAll('[data-global]').forEach(input => input.onchange=async()=>{ const {error}=await supabase.from('app_modules').upsert({module_key:input.dataset.global,enabled:input.checked,updated_by:me.id,updated_at:new Date().toISOString()},{onConflict:'module_key'}); if(error){input.checked=!input.checked;notify(error.message);} });
  $('#body').querySelectorAll('[data-user]').forEach(input => input.onchange=async()=>{ const {error}=await supabase.from('profile_modules').upsert({user_id:input.dataset.user,module_key:input.dataset.module,enabled:input.checked,updated_by:me.id,updated_at:new Date().toISOString()},{onConflict:'user_id,module_key'}); if(error){input.checked=!input.checked;notify(error.message);} });
}

/* ------------------------------- Eventos ------------------------------- */
async function eventos() {
  const [{ data: evList = [], error: evErr }, { data: rsvpList = [] }, { data: members = [] }] = await Promise.all([
    supabase.from('events').select('*').order('event_date', { ascending: true }),
    supabase.from('event_rsvps').select('*, profiles(id, full_name, carnet_number)'),
    supabase.from('profiles').select('id, full_name'),
  ]);

  if (evErr) {
    $('#body').innerHTML = `<h2>Eventos</h2><p class="msg">${esc(evErr.message)}<br>¿Ejecutaste la migración 0012 en Supabase?</p>`;
    return;
  }

  const imgUrls = {};
  await Promise.all(evList.filter((e) => e.image_path).map(async (e) => {
    if (e.image_path.startsWith('http://') || e.image_path.startsWith('https://')) {
      imgUrls[e.id] = e.image_path;
    } else {
      const { data } = await supabase.storage.from('event-media').createSignedUrl(e.image_path, 3600);
      imgUrls[e.id] = data?.signedUrl || null;
    }
  }));

  const rsvpsByEvent = {};
  rsvpList.forEach((r) => {
    if (!rsvpsByEvent[r.event_id]) rsvpsByEvent[r.event_id] = [];
    rsvpsByEvent[r.event_id].push(r);
  });

  const now = new Date();
  const upcoming = evList.filter((e) => new Date(e.event_date) >= new Date(now.getTime() - 86400000));
  const past = evList.filter((e) => new Date(e.event_date) < new Date(now.getTime() - 86400000));

  const formatEventDate = (isoStr) => {
    const d = new Date(isoStr);
    return d.toLocaleDateString('es-BO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const renderCard = (e) => {
    const rsvps = rsvpsByEvent[e.id] || [];
    const confirmed = rsvps.filter((r) => r.status === 'confirmed');
    const cancelled = rsvps.filter((r) => r.status === 'cancelled');
    const img = imgUrls[e.id] ? `<img class="admin-event-thumb" src="${imgUrls[e.id]}" alt="${esc(e.title)}">` : '<div class="admin-event-thumb ph">📅</div>';

    return `<article class="card admin-event-card" data-event-id="${e.id}">
      <div class="admin-event-hero">
        ${img}
        <div class="admin-event-info">
          <h3>${esc(e.title)}</h3>
          <div class="admin-event-meta">
            <span>🗓 ${formatEventDate(e.event_date)}</span>
            ${e.location ? `<span>📍 ${esc(e.location)}</span>` : ''}
          </div>
          ${e.description ? `<p style="margin-top:6px;">${esc(e.description.slice(0, 120))}${e.description.length > 120 ? '…' : ''}</p>` : ''}
          <div class="admin-event-rsvps">
            <span class="admin-rsvp-pill confirmed">✓ ${confirmed.length} confirmados</span>
            <span class="admin-rsvp-pill cancelled">✕ ${cancelled.length} cancelaron</span>
          </div>
        </div>
      </div>
      <div class="admin-event-actions">
        <button class="btn sm ghost" data-action="rsvps" data-id="${e.id}">Ver asistentes</button>
        <button class="btn sm ghost" data-action="remind" data-id="${e.id}">Recordar evento</button>
        <button class="btn sm ghost" data-action="edit" data-id="${e.id}">Editar</button>
        <button class="btn sm ghost" data-action="delete" data-id="${e.id}" style="color:var(--red);">Borrar</button>
      </div>
    </article>`;
  };

  $('#body').innerHTML = `
    <div class="admin-events-header">
      <div>
        <h1>Eventos del Club</h1>
        <p class="muted">Organiza entrenamientos, salidas, competencias y gestiona asistencia.</p>
      </div>
      <button class="btn sm" id="create-event">+ Nuevo evento</button>
    </div>
    <h2>Próximos eventos (${upcoming.length})</h2>
    <div class="admin-cards">${upcoming.length ? upcoming.map(renderCard).join('') : '<p class="card muted">No hay eventos próximos programados.</p>'}</div>
    ${past.length ? `
      <details class="card" style="margin-top:20px;">
        <summary><b>Ver anteriores eventos (${past.length})</b></summary>
        <div class="admin-cards" style="margin-top:12px;">${past.map(renderCard).join('')}</div>
      </details>
    ` : ''}
  `;

  // Crear / Editar modal
  const openFormModal = (existing = null) => {
    const isEdit = Boolean(existing);
    let initDate = '';
    let initTime = '08:00';
    if (existing?.event_date) {
      const d = new Date(existing.event_date);
      initDate = d.toISOString().slice(0, 10);
      initTime = d.toTimeString().slice(0, 5);
    } else {
      const d = new Date();
      d.setDate(d.getDate() + 3);
      initDate = d.toISOString().slice(0, 10);
    }

    const m = modal(`
      <div class="sheet-h">
        <b>${isEdit ? 'Editar evento' : 'Nuevo evento del Club'}</b>
        <button class="link" data-close>Cerrar</button>
      </div>
      <form id="event-form" class="card" style="margin-top:12px;border:0;padding:0;">
        <label for="ef-title">Título del evento *</label>
        <input id="ef-title" value="${esc(existing?.title || '')}" required placeholder="Ej: Fondo de Running 15K Batmon">

        <label for="ef-desc">De qué trata (descripción)</label>
        <textarea id="ef-desc" rows="3" placeholder="Detalles de la ruta, ritmo, requerimientos…">${esc(existing?.description || '')}</textarea>

        <div class="row">
          <div>
            <label for="ef-date">Fecha *</label>
            <input id="ef-date" type="date" value="${initDate}" required>
          </div>
          <div>
            <label for="ef-time">Hora *</label>
            <input id="ef-time" type="time" value="${initTime}" required>
          </div>
        </div>

        <label for="ef-loc">Ubicación (opcional)</label>
        <input id="ef-loc" value="${esc(existing?.location || '')}" placeholder="Ej: Parque Central / Costanera">

        <label for="ef-img">Imagen del evento (foto)</label>
        <input id="ef-img" type="file" accept="image/*">
        ${existing?.image_path ? `<p class="muted" style="margin-top:4px;">Tiene imagen previa guardada.</p>` : ''}

        <label style="display:flex;align-items:center;gap:8px;margin-top:12px;cursor:pointer;">
          <input type="checkbox" id="ef-notify" ${isEdit ? '' : 'checked'}>
          <span>Enviar notificación a la campanita de los socios</span>
        </label>

        <button class="btn" type="submit" id="ef-submit" style="margin-top:16px;">${isEdit ? 'Guardar cambios' : 'Publicar evento'}</button>
        <p class="msg" id="ef-msg"></p>
      </form>
    `);
    m.querySelector('[data-close]').onclick = () => m.remove();

    const form = m.querySelector('#event-form');
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const submitBtn = m.querySelector('#ef-submit');
      const msg = m.querySelector('#ef-msg');
      submitBtn.disabled = true;
      msg.textContent = 'Guardando evento…';

      const title = m.querySelector('#ef-title').value.trim();
      const description = m.querySelector('#ef-desc').value.trim();
      const dateVal = m.querySelector('#ef-date').value;
      const timeVal = m.querySelector('#ef-time').value || '08:00';
      const location = m.querySelector('#ef-loc').value.trim();
      const file = m.querySelector('#ef-img').files[0];
      const notifyChecked = m.querySelector('#ef-notify').checked;

      const eventDateTime = new Date(`${dateVal}T${timeVal}:00`).toISOString();

      let imagePath = existing?.image_path || null;
      if (file) {
        if (file.size > 8 * 1024 * 1024) {
          submitBtn.disabled = false;
          msg.textContent = 'La imagen es mayor a 8 MB.';
          return;
        }
        const ext = file.name.split('.').pop();
        const path = `events/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
        const up = await supabase.storage.from('event-media').upload(path, file, { upsert: true });
        if (up.error) {
          submitBtn.disabled = false;
          msg.textContent = 'Error subiendo foto: ' + up.error.message;
          return;
        }
        imagePath = path;
      }

      const row = {
        title,
        description,
        event_date: eventDateTime,
        location: location || null,
        image_path: imagePath,
        notify_members: notifyChecked,
        updated_at: new Date().toISOString(),
      };

      let eventId = existing?.id;
      if (isEdit) {
        const { error } = await supabase.from('events').update(row).eq('id', existing.id);
        if (error) { submitBtn.disabled = false; msg.textContent = error.message; return; }
      } else {
        const { data: newRow, error } = await supabase.from('events').insert(row).select().single();
        if (error) { submitBtn.disabled = false; msg.textContent = error.message; return; }
        eventId = newRow.id;
      }

      // Si se activó notificar a los socios
      if (notifyChecked && eventId && members.length) {
        const notifs = members.map((mem) => ({
          event_id: eventId,
          user_id: mem.id,
          type: 'event',
          message: `Nuevo evento: ${title}`,
          is_read: false,
        }));
        const { error: notifError } = await supabase.from('event_notifications').insert(notifs); if (notifError) notify('Evento guardado, pero no se pudieron crear las notificaciones: ' + notifError.message);
      }

      notify(isEdit ? 'Evento actualizado correctamente.' : 'Evento publicado con éxito.', 'success');
      m.remove();
      eventos();
    };
  };

  $('#create-event').onclick = () => openFormModal();

  // Ver asistentes modal
  const openRsvpsModal = (eventId) => {
    const e = evList.find((x) => x.id === eventId);
    const rsvps = rsvpsByEvent[eventId] || [];
    const confirmed = rsvps.filter((r) => r.status === 'confirmed');
    const cancelled = rsvps.filter((r) => r.status === 'cancelled');

    const m = modal(`
      <div class="sheet-h">
        <b>Asistencia: ${esc(e.title)}</b>
        <button class="link" data-close>Cerrar</button>
      </div>
      <div style="margin:10px 0 14px;">
        <span class="admin-rsvp-pill confirmed">✓ ${confirmed.length} confirmados</span>
        <span class="admin-rsvp-pill cancelled" style="margin-left:8px;">✕ ${cancelled.length} cancelaron</span>
      </div>
      <h2>Confirmados (${confirmed.length})</h2>
      <div class="admin-rsvp-list">
        ${confirmed.length ? confirmed.map((r) => `
          <div class="admin-rsvp-item">
            <b>${esc(r.profiles?.full_name || 'Socio Batmon')}</b>
            <span class="muted">${r.profiles?.carnet_number ? 'CI: ' + esc(r.profiles.carnet_number) : ''} · ${new Date(r.updated_at || r.created_at).toLocaleDateString('es-BO')}</span>
          </div>
        `).join('') : '<p class="muted">Aún no hay socios confirmados.</p>'}
      </div>
      <h2>Cancelaron confirmación (${cancelled.length})</h2>
      <div class="admin-rsvp-list">
        ${cancelled.length ? cancelled.map((r) => `
          <div class="admin-rsvp-item">
            <b>${esc(r.profiles?.full_name || 'Socio Batmon')}</b>
            <span class="muted">${new Date(r.updated_at || r.created_at).toLocaleDateString('es-BO')}</span>
          </div>
        `).join('') : '<p class="muted">Ningún socio canceló.</p>'}
      </div>
    `);
    m.querySelector('[data-close]').onclick = () => m.remove();
  };

  // Recordar evento modal
  const openRemindModal = (eventId) => {
    const e = evList.find((x) => x.id === eventId);
    const m = modal(`
      <div class="sheet-h">
        <b>Recordar evento</b>
        <button class="link" data-close>Cerrar</button>
      </div>
      <p class="muted">Envía un recordatorio directo a la campana de notificaciones de los socios.</p>
      <div class="card" style="border:0;padding:0;margin-top:10px;">
        <p><b>Evento:</b> ${esc(e.title)}</p>
        <p class="muted">🗓 ${formatEventDate(e.event_date)}</p>
        <label for="remind-target">¿A quiénes enviar el recordatorio?</label>
        <select id="remind-target">
          <option value="all">A todos los socios</option>
          <option value="unconfirmed" selected>A los que no han confirmado</option>
          <option value="confirmed">A los que sí confirmaron</option>
        </select>
        <label for="remind-msg">Mensaje opcional</label>
        <input id="remind-msg" placeholder="¡No te olvides confirmar tu asistencia este fin de semana!">
        <button class="btn" id="remind-send" type="button" style="margin-top:14px;">Enviar recordatorio</button>
        <p class="msg" id="remind-res"></p>
      </div>
    `);
    m.querySelector('[data-close]').onclick = () => m.remove();

    $('#remind-send', m).onclick = async () => {
      const btn = $('#remind-send', m);
      const res = $('#remind-res', m);
      btn.disabled = true;
      res.textContent = 'Enviando…';
      const target = $('#remind-target', m).value;
      const customMsg = $('#remind-msg', m).value.trim();

      const { data: count, error } = await supabase.rpc('send_event_reminder', {
        p_event_id: eventId,
        p_target: target,
        p_message: customMsg || `Recordatorio: ${e.title}`,
      });

      if (error) {
        btn.disabled = false;
        res.textContent = error.message;
      } else {
        notify(`Recordatorio enviado a ${count || 0} socios.`, 'success');
        m.remove();
      }
    };
  };

  // Manejo de acciones en tarjetas
  $('#body').querySelectorAll('[data-action]').forEach((b) => {
    b.onclick = async () => {
      const act = b.dataset.action;
      const id = b.dataset.id;
      if (act === 'rsvps') {
        openRsvpsModal(id);
      } else if (act === 'remind') {
        openRemindModal(id);
      } else if (act === 'edit') {
        const e = evList.find((x) => x.id === id);
        openFormModal(e);
      } else if (act === 'delete') {
        if (!(await confirmDialog('¿Borrar este evento? Se eliminarán también las confirmaciones asociadas.', 'Borrar evento'))) return;
        b.disabled = true;
        const e = evList.find((x) => x.id === id);
        if (e?.image_path) {
          await supabase.storage.from('event-media').remove([e.image_path]);
        }
        const { error } = await supabase.from('events').delete().eq('id', id);
        if (error) notify(error.message);
        else {
          notify('Evento eliminado con éxito.', 'success');
          eventos();
        }
      }
    };
  });
}

async function retos() {
  const {data:rows=[],error}=await supabase.from('club_challenges').select('*').order('starts_on',{ascending:false});
  const body=$('#body');
  if(error){body.innerHTML=`<h1>Retos del club</h1><div class="card warn">No se pudieron cargar. Aplica la migración 0015 cuando esté lista: ${esc(error.message)}</div>`;return;}
  const disciplineLabel={running:'Running',cycling:'Ciclismo',swimming:'Natación',plyo:'Pliometría',training:'Entrenamiento'};
  body.innerHTML=`<h1>Retos del club</h1><p class="muted">Las clasificaciones usan sesiones y distancias reales guardadas en la app.</p><form class="card admin-challenge-form" id="challenge-form"><input type="hidden" name="id"><label>Título<input name="title" maxlength="100" required></label><label>Descripción<textarea name="description" maxlength="500" rows="3"></textarea></label><div class="row"><label>Disciplina<select name="discipline">${Object.entries(disciplineLabel).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><label>Medición<select name="metric"><option value="sessions">Sesiones</option><option value="distance_km">Distancia (km)</option></select></label></div><div class="row"><label>Meta<input name="goal_value" type="number" min="1" step="0.1" required></label><label>Inicio<input name="starts_on" type="date" required></label><label>Fin<input name="ends_on" type="date" required></label></div><div class="quick-actions"><button class="btn" type="submit">Crear reto</button><button class="btn ghost" type="button" id="challenge-cancel" hidden>Cancelar edición</button></div><p class="msg" aria-live="polite"></p></form><h2>Retos publicados (${rows.length})</h2><div class="admin-cards">${rows.map(row=>`<article class="card admin-challenge-row"><span class="notification-kind">${disciplineLabel[row.discipline]} · ${row.metric==='distance_km'?'Kilómetros':'Sesiones'} · meta ${row.goal_value}</span><h3>${esc(row.title)}</h3><p>${esc(row.description||'')}</p><small>${row.starts_on} – ${row.ends_on}</small><div class="quick-actions"><button class="btn sm ghost" data-edit-challenge="${row.id}">Editar</button><button class="btn sm ghost" data-delete-challenge="${row.id}">Eliminar</button></div></article>`).join('')||'<p class="card muted">Aún no hay retos.</p>'}</div>`;
  const form=$('#challenge-form',body);
  form.elements.discipline.onchange=()=>{if(form.elements.discipline.value==='plyo'||form.elements.discipline.value==='training'){form.elements.metric.value='sessions';form.elements.metric.querySelector('[value="distance_km"]').disabled=true;}else form.elements.metric.querySelector('[value="distance_km"]').disabled=false;};
  form.onsubmit=async event=>{
    event.preventDefault();const data=new FormData(form),id=data.get('id'),start=data.get('starts_on'),end=data.get('ends_on'),metric=data.get('metric'),discipline=data.get('discipline'),msg=form.querySelector('.msg'),button=form.querySelector('[type="submit"]');
    if(end<start){msg.textContent='La fecha final debe ser igual o posterior al inicio.';return;}
    if((discipline==='plyo'||discipline==='training')&&metric==='distance_km'){msg.textContent='Pliometría y Entrenamiento solo admiten retos por sesiones.';return;}
    button.disabled=true;const row={title:String(data.get('title')).trim(),description:String(data.get('description')||'').trim()||null,discipline,metric,goal_value:Number(data.get('goal_value')),starts_on:start,ends_on:end};
    const result=id?await supabase.from('club_challenges').update(row).eq('id',id):await supabase.from('club_challenges').insert({...row,created_by:me.id});
    button.disabled=false;if(result.error){msg.textContent=`No se guardó el reto: ${result.error.message}`;return;}notify(id?'Reto actualizado.':'Reto creado.','success');retos();
  };
  $('#challenge-cancel',body).onclick=()=>retos();
  body.querySelectorAll('[data-edit-challenge]').forEach(button=>button.onclick=()=>{
    const row=rows.find(item=>item.id===button.dataset.editChallenge);if(!row)return;
    for(const key of ['id','title','description','discipline','metric','goal_value','starts_on','ends_on'])form.elements[key].value=row[key]??'';
    form.elements.discipline.dispatchEvent(new Event('change'));
    $('#challenge-cancel',body).hidden=false;form.querySelector('[type="submit"]').textContent='Guardar cambios';form.scrollIntoView({behavior:'smooth',block:'start'});
  });
  body.querySelectorAll('[data-delete-challenge]').forEach(button=>button.onclick=async()=>{
    if(!(await confirmDialog('¿Eliminar el reto? También se borrará la participación asociada.','Eliminar reto')))return;
    const {error:deleteError}=await supabase.from('club_challenges').delete().eq('id',button.dataset.deleteChallenge);
    if(deleteError)notify(deleteError.message);else{notify('Reto eliminado.','success');retos();}
  });
}

/* ------------------------------- Shell ------------------------------- */
const SECTIONS = { pagos, socios, modulos, ejercicios, eventos, retos };
function route() {
  const t = SECTIONS[location.hash.slice(1)] ? location.hash.slice(1) : 'pagos';
  document.querySelectorAll('#tabs a').forEach((a) => {
    const active = a.getAttribute('href') === '#' + t;
    a.classList.toggle('on', active);
    a.setAttribute('aria-current', active ? 'page' : 'false');
  });
  const stopLoading=showDelayedLoading($('#body'));
  SECTIONS[t]().then(stopLoading).catch((e) => { stopLoading();$('#body').innerHTML = `<p class="msg">Error: ${esc(e.message)}</p>`; });
}

async function init() {
  const stopLoading=showDelayedLoading(view);
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { stopLoading();location.href = '/app.html'; return; }
    const { data: appearance } = await supabase.from('site_settings').select('theme_policy').eq('id',true).maybeSingle();
    const theme = appearance?.theme_policy === 'choice' ? localStorage.getItem(`batmon_theme_${session.user.id}`) || 'light' : appearance?.theme_policy || 'light';
    document.body.dataset.theme = theme;
    me = await getProfile(session.user.id);
    if (me?.role !== 'admin') { stopLoading();view.innerHTML = '<h1>Sin acceso</h1><p class="muted">Esta sección es solo para administradores.</p>'; return; }
    const adminName=me.full_name||session.user.user_metadata?.full_name||'Administrador';
    const nameNode=$('#admin-header-name');
    const avatarNode=$('#admin-header-avatar');
    if(nameNode)nameNode.textContent=adminName;
    if(avatarNode){
      const initials=adminName.split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase();
      avatarNode.textContent=initials;
      if(me.avatar_path){
        const {data:avatar}=await supabase.storage.from('profile-media').createSignedUrl(me.avatar_path,3600);
        if(avatar?.signedUrl)avatarNode.innerHTML=`<img src="${esc(avatar.signedUrl)}" alt="Foto de ${esc(adminName)}">`;
      }
    }
    stopLoading();
    view.innerHTML = '<div id="body"></div>';
    $('#tabs').hidden = false;
    $('#tabs').innerHTML = TABS.map(([h, t, icon]) => `<a href="#${h}" aria-label="${t}" aria-current="false"><span class="tab-icon">${icon}</span><span class="tab-label">${t}</span></a>`).join('');
    window.addEventListener('hashchange', route);
    route();
  } catch (error) {
    stopLoading();
    view.innerHTML = `<p class="msg">No se pudo cargar Administración: ${esc(error.message)}</p>`;
  }
}
void monthStart;
init();

autoEnhanceFileInputs();
