import './app.css';
import { autoEnhanceFileInputs } from './upload-field.js';
import { supabase, $, esc, getProfile } from '../supabase.js';
import { fmt, monthStart, RUN_TYPE, DISC, paceStr, confirmDialog, notify, showDelayedLoading, exerciseImgUrl } from './common.js';
import { openRoutePicker, routeSummary } from './route-picker.js';

const view = $('#view');
const TABS = [
  ['pagos', 'Pagos', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></svg>'],
  ['clientes', 'Clientes', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 5.5a3.5 3.5 0 0 1 0 6.8M17 14a5.5 5.5 0 0 1 4.5 5.5"/></svg>'],
  ['socios', 'Socios', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.9L12 16.4 6.8 19.2l1-5.9L3.5 9.2l5.9-.9L12 3Z"/></svg>'],
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

/* ------------------------- Clientes, socios y fichas ------------------------- */
const PERMS = [['pagos', 'Pagos'], ['clientes', 'Clientes'], ['modulos', 'Módulos y apariencia'], ['ejercicios', 'Ejercicios'], ['eventos', 'Eventos'], ['retos', 'Retos']];
const isOwner = () => me?.role === 'admin';
const can = (key) => isOwner() || me?.staff_permissions?.[key] === true;
const sw = (attrs, on, label, hint = '') => `<label class="adm-sw"><span><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span><input type="checkbox" class="share-switch" ${attrs} ${on ? 'checked' : ''} aria-label="${esc(label)}"><span><i></i></span></label>`;
const ROLE_LABEL = { member: 'Cliente', socio: 'Socio', admin: 'Administrador' };
const MIGRATION_HINT = '¿Aplicaste la migración 0031?';

function openProof(url) {
  const overlay = document.createElement('div'); overlay.className = 'proof-viewer';
  overlay.innerHTML = `<button type="button" class="link" data-close>Cerrar</button><a class="btn ghost" href="${url}" target="_blank" rel="noopener">Abrir en pestaña</a><img src="${url}" alt="Comprobante de pago">`;
  decorateAdminBackButton(overlay.querySelector('[data-close]'), 'Cerrar', true);
  overlay.onclick = (e) => { if (e.target === overlay || e.target.closest('[data-close]')) overlay.remove(); };
  document.body.append(overlay);
}

const clientCard = (u) => `<article class="card admin-item" data-q="${esc(((u.full_name || '') + ' ' + (u.username || '') + ' ' + (u.email || '')).toLowerCase())}"><b>${esc(u.full_name)}</b><span>${u.username ? '@' + esc(u.username) + ' · ' : ''}${esc(u.email)}</span><span>${fmt(u.total_km)} km · ${u.plyo_sessions} sesiones · Última actividad: ${u.last_activity || '—'}</span><span>Pago del mes: ${u.membership ? STATUS[u.membership] : '—'}${u.access_override ? ` · <b>Acceso sin pago${u.access_until ? ' hasta ' + u.access_until : ''}</b>` : ''}</span><button class="btn sm ghost" data-d="${u.id}">Abrir ficha</button></article>`;

async function clientes() {
  const { data = [], error } = await supabase.rpc('admin_member_overview');
  if (error) { $('#body').innerHTML = `<p class="msg">${esc(error.message)}<br>${MIGRATION_HINT}</p>`; return; }
  const list = data.filter((u) => u.role === 'member');
  $('#body').innerHTML = `<h2>Clientes (${list.length})</h2><p class="muted">Todos los que se registran empiezan aquí. Abre su ficha para ver sus datos, pagos y módulos, darles acceso o subirlos a socio.</p>
    <label class="sr-only" for="member-search">Buscar cliente</label><input id="member-search" type="search" placeholder="Buscar por nombre, usuario o correo…"><div class="admin-cards" id="member-cards">${list.map(clientCard).join('') || '<p class="card muted">Aún no hay clientes.</p>'}</div>`;
  $('#member-search').oninput = (e) => { const q = e.target.value.trim().toLowerCase(); $('#member-cards').querySelectorAll('[data-q]').forEach((card) => { card.hidden = !card.dataset.q.includes(q); }); };
  $('#body').querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => detalle(list.find((u) => u.id === b.dataset.d))));
}

async function socios() {
  if (!isOwner()) { $('#body').innerHTML = '<p class="card muted">Solo el administrador puede gestionar a los socios.</p>'; return; }
  const { data = [], error } = await supabase.rpc('admin_member_overview');
  if (error) { $('#body').innerHTML = `<p class="msg">${esc(error.message)}<br>${MIGRATION_HINT}</p>`; return; }
  const staff = data.filter((u) => u.role !== 'member');
  $('#body').innerHTML = `<h2>Socios (${staff.filter((u) => u.role === 'socio').length})</h2><p class="muted">Un socio es un cliente que tú subiste de nivel: puede ayudar en el panel solo con los permisos que actives. Para crear uno abre la ficha de un cliente y pulsa “Subir a socio”.</p>
    <div class="admin-cards">${staff.map((u) => `<article class="card admin-item" data-uid="${u.id}"><b>${esc(u.full_name)}</b><span>${esc(u.email)} · <span class="pill ${u.role === 'admin' ? 'approved' : 'pending'}">${ROLE_LABEL[u.role]}</span></span>
      ${u.role === 'admin' ? '<span class="muted">Administrador: acceso total.</span>' : `<div class="adm-perms">${PERMS.map(([k, t]) => sw(`data-perm="${k}"`, u.staff_permissions?.[k] === true, t)).join('')}</div><button class="btn sm ghost" data-demote="${u.id}">Bajar a cliente</button>`}</article>`).join('') || '<p class="card muted">Aún no hay socios.</p>'}</div>`;
  $('#body').querySelectorAll('[data-perm]').forEach((input) => (input.onchange = async () => {
    const card = input.closest('[data-uid]'), perms = {};
    card.querySelectorAll('[data-perm]').forEach((i) => { perms[i.dataset.perm] = i.checked; });
    const { error: er } = await supabase.rpc('admin_set_permissions', { target: card.dataset.uid, perms });
    if (er) { input.checked = !input.checked; notify(er.message); } else notify('Permisos actualizados.', 'success');
  }));
  $('#body').querySelectorAll('[data-demote]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog('¿Bajar a este socio a cliente? Perderá sus permisos del panel.', 'Bajar a cliente'))) return;
    const { error: er } = await supabase.rpc('admin_set_role', { target: b.dataset.demote, new_role: 'member' });
    if (er) notify(er.message); else socios();
  }));
}

async function detalle(u) {
  const [{ data: acts = [] }, { data: ws = [] }, { data: moduleRows, error: moduleError }, { data: mems = [] }] = await Promise.all([
    supabase.from('activities').select('*').eq('user_id', u.id).order('performed_on', { ascending: false }).limit(100),
    supabase.from('workouts').select('*, workout_sets(id)').eq('user_id', u.id).order('performed_on', { ascending: false }).limit(100),
    supabase.from('profile_modules').select('module_key, enabled').eq('user_id', u.id),
    supabase.from('memberships').select('*').eq('user_id', u.id).order('period', { ascending: false }).order('created_at', { ascending: false }),
  ]);
  const proofUrls = {};
  await Promise.all(mems.filter((x) => x.proof_path).map(async (x) => { const { data } = await supabase.storage.from('receipts').createSignedUrl(x.proof_path, 3600); proofUrls[x.id] = data?.signedUrl; }));
  const moduleState = { running: true, cycling: true, swimming: true, plyo: true, training: true };
  (moduleRows || []).forEach((row) => { moduleState[row.module_key] = row.enabled; });
  const plyoSessions = ws.filter((w) => w.kind === 'plyometrics'), trainingSessions = ws.filter((w) => w.kind === 'training');
  const self = u.id === me.id;
  const acc = (title, hint, inner, open = false) => `<details class="card pf-acc"${open ? ' open' : ''}><summary><b>${title}</b><small>${hint}</small></summary><div class="pf-acc__body">${inner}</div></details>`;
  const payRows = mems.map((x) => `<article class="card admin-item"><b>${x.period.slice(0, 7)} · ${x.payment_method === 'cash' ? 'Efectivo' : 'QR'} · <span class="pill ${x.status}">${STATUS[x.status]}</span></b>${proofUrls[x.id] ? `<button class="link" data-proof="${x.id}">Ver comprobante</button>` : ''}<div class="quick-actions">${x.status !== 'approved' ? `<button class="btn sm" data-ma="approved" data-id="${x.id}">Aprobar</button>` : ''}${x.status !== 'rejected' ? `<button class="btn sm ghost" data-ma="rejected" data-id="${x.id}">Desaprobar</button>` : ''}${x.status !== 'pending' ? `<button class="btn sm ghost" data-ma="pending" data-id="${x.id}">Reabrir</button>` : ''}<button class="btn sm ghost" data-ma="delete" data-id="${x.id}">Borrar</button></div></article>`).join('');
  const m = modal(`<div class="sheet-h"><b>${esc(u.full_name)}</b><button class="link" data-close>Cerrar</button></div>
    <p class="muted">${u.username ? '@' + esc(u.username) + ' · ' : ''}${esc(u.email)} · alta ${u.created_at.slice(0, 10)} · <b>${ROLE_LABEL[u.role]}</b></p>
    <div class="pf-accs">
    ${acc('Acceso y pagos', 'Aprobar, desaprobar o dar acceso sin pago', `${sw('id="acc-on"', u.access_override, 'Dar acceso sin pago', 'Puede registrar entrenamientos aunque no haya pagado')}<label class="adm-date">Acceso hasta (opcional)<input id="acc-until" type="date" value="${u.access_until || ''}"></label><button class="btn sm" id="acc-save">Guardar acceso</button><h3 class="pf-sub">Pagos de este cliente</h3><div class="admin-cards">${payRows || '<p class="card muted">Sin pagos registrados.</p>'}</div>`, true)}
    ${acc('Módulos de este cliente', 'Qué disciplinas ve y puede usar', moduleError ? '<p class="msg">No disponible: aplica la migración 0004.</p>' : `<div class="module-settings">${[['running', 'Running'], ['cycling', 'Ciclismo'], ['swimming', 'Natación'], ['plyo', 'Pliometría'], ['training', 'Entrenamiento']].map(([key, title]) => sw(`data-module="${key}"`, moduleState[key], title)).join('')}</div>`)}
    ${acc(`Actividades (${acts.length})`, 'Running, ciclismo y natación', `<div class="admin-cards">${acts.length ? acts.map((a) => `<article class="card admin-item"><b>${a.performed_on} · ${DISC[a.discipline]}${a.run_type ? ' · ' + RUN_TYPE[a.run_type] : ''}</b><span>${fmt(a.distance_km)} km · ${fmt(a.duration_min)} min${a.discipline === 'running' ? ' · ' + paceStr(a.distance_km, a.duration_min) : ''}</span><button class="btn sm ghost" data-da="${a.id}">Borrar actividad</button></article>`).join('') : '<p class="card muted">Sin datos.</p>'}</div>`)}
    ${acc(`Pliometría (${plyoSessions.length})`, 'Sesiones registradas', `<div class="admin-cards">${plyoSessions.length ? plyoSessions.map((w) => `<article class="card admin-item"><b>${w.performed_on}</b><span>${w.workout_sets.length} series${w.duration_min ? ' · ' + fmt(w.duration_min, 0) + ' min' : ''}</span><button class="btn sm ghost" data-dw="${w.id}">Borrar sesión</button></article>`).join('') : '<p class="card muted">Sin datos.</p>'}</div>`)}
    ${acc(`Entrenamiento (${trainingSessions.length})`, 'Sesiones de gimnasio', `<div class="admin-cards">${trainingSessions.length ? trainingSessions.map((w) => `<article class="card admin-item"><b>${w.performed_on}</b><span>${w.workout_sets.length} series${w.duration_min ? ' · ' + fmt(w.duration_min, 0) + ' min' : ''}</span><button class="btn sm ghost" data-dw="${w.id}">Borrar entrenamiento</button></article>`).join('') : '<p class="card muted">Sin datos.</p>'}</div>`)}
    ${acc('Cuenta', 'Nivel y eliminación', self ? '<p class="muted">Eres tú: no puedes cambiar tu nivel ni borrarte.</p>' : `${isOwner() && u.role === 'member' ? '<button class="btn sm" id="promote">Subir a socio</button><p class="muted">Un socio podrá usar el panel solo con los permisos que le actives en la sección Socios.</p>' : ''}${isOwner() && u.role === 'socio' ? '<button class="btn sm ghost" id="demote">Bajar a cliente</button>' : ''}${u.role === 'member' || isOwner() ? '<button class="btn sm" id="rmuser" style="background:#a00;border-color:#a00">Eliminar cuenta y sus datos</button>' : ''}`)}
    </div>`);
  m.querySelector('[data-close]').onclick = () => m.remove();
  const refresh = () => { m.remove(); (location.hash === '#socios' ? socios : clientes)(); };
  m.querySelectorAll('[data-proof]').forEach((b) => (b.onclick = () => openProof(proofUrls[b.dataset.proof])));
  m.querySelectorAll('[data-ma]').forEach((b) => (b.onclick = async () => {
    const a = b.dataset.ma, id = b.dataset.id;
    if (a === 'delete' && !(await confirmDialog('¿Borrar este pago? No se puede deshacer.', 'Borrar pago'))) return;
    b.disabled = true;
    const { error } = a === 'delete' ? await supabase.from('memberships').delete().eq('id', id)
      : await supabase.from('memberships').update({ status: a, approved_at: a === 'approved' ? new Date().toISOString() : null, approved_by: a === 'approved' ? me.id : null }).eq('id', id);
    if (error) { notify(error.message); b.disabled = false; } else { m.remove(); detalle(u); }
  }));
  $('#acc-save', m).onclick = async () => {
    const { error } = await supabase.rpc('admin_set_access', { target: u.id, p_override: $('#acc-on', m).checked, p_until: $('#acc-until', m).value || null });
    if (error) notify(error.message + ' ' + MIGRATION_HINT); else { u.access_override = $('#acc-on', m).checked; u.access_until = $('#acc-until', m).value || null; notify('Acceso actualizado.', 'success'); }
  };
  m.querySelectorAll('[data-da]').forEach((b) => (b.onclick = async () => { if (!(await confirmDialog('¿Borrar esta actividad?', 'Borrar actividad'))) return; const { error } = await supabase.from('activities').delete().eq('id', b.dataset.da); if (error) notify(error.message); else { m.remove(); detalle(u); } }));
  m.querySelectorAll('[data-dw]').forEach((b) => (b.onclick = async () => { if (!(await confirmDialog('¿Borrar esta sesión?', 'Borrar sesión'))) return; const { error } = await supabase.from('workouts').delete().eq('id', b.dataset.dw); if (error) notify(error.message); else { m.remove(); detalle(u); } }));
  m.querySelectorAll('[data-module]').forEach((input) => (input.onchange = async () => {
    const key = input.dataset.module; const { error } = await supabase.from('profile_modules').upsert({ user_id: u.id, module_key: key, enabled: input.checked, updated_by: me.id, updated_at: new Date().toISOString() }, { onConflict: 'user_id,module_key' });
    if (error) { input.checked = !input.checked; notify(`No se pudo actualizar el módulo: ${error.message}`); }
    else notify(`Módulo ${input.checked ? 'activado' : 'oculto'} para ${u.full_name}`, 'success');
  }));
  const setRole = (id, next, text, ok) => { const b = $(id, m); if (b) b.onclick = async () => { if (!(await confirmDialog(text, ok))) return; const { error } = await supabase.rpc('admin_set_role', { target: u.id, new_role: next }); if (error) notify(error.message + ' ' + MIGRATION_HINT); else { notify(next === 'socio' ? 'Ahora es socio. Configura sus permisos en la sección Socios.' : 'Ahora es cliente.', 'success'); refresh(); } }; };
  setRole('#promote', 'socio', `¿Subir a ${u.full_name} de cliente a socio?`, 'Subir a socio');
  setRole('#demote', 'member', `¿Bajar a ${u.full_name} a cliente?`, 'Bajar a cliente');
  const rm = $('#rmuser', m); if (rm) rm.onclick = async () => {
    if (!(await confirmDialog(`Se borrará la cuenta de ${u.full_name} y todos sus datos.`, 'Eliminar cuenta'))) return;
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

/* ------------------------------- Módulos ------------------------------- */
const MODULES = [['running', 'Running'], ['cycling', 'Ciclismo'], ['swimming', 'Natación'], ['plyo', 'Pliometría'], ['training', 'Entrenamiento']];
async function modulos() {
  const [{ data: globalRows = [], error: globalError }, { data: appearance }] = await Promise.all([
    supabase.from('app_modules').select('module_key,enabled'), supabase.from('site_settings').select('theme_policy').eq('id', true).maybeSingle(),
  ]);
  if (globalError) { $('#body').innerHTML = '<h2>Módulos</h2><p class="msg">Aplica la migración 0004 para configurar módulos.</p>'; return; }
  const globals = Object.fromEntries(globalRows.map((r) => [r.module_key, r.enabled]));
  $('#body').innerHTML = `<h1>Módulos y apariencia</h1><p class="muted">Ajustes generales del club. Los módulos de cada cliente se configuran dentro de su ficha, en Clientes.</p>
    <h2>Tema para todo el club</h2><label for="theme-policy">Apariencia</label><select id="theme-policy"><option value="choice" ${appearance?.theme_policy === 'choice' ? 'selected' : ''}>Cada socio puede elegir</option><option value="dark" ${appearance?.theme_policy === 'dark' ? 'selected' : ''}>Forzar modo oscuro</option><option value="light" ${appearance?.theme_policy === 'light' ? 'selected' : ''}>Forzar modo claro</option></select><p class="muted">Los fondos de textura se aplicarán en ambos modos.</p>
    <h2>Disponibilidad general</h2><div class="module-settings">${MODULES.map(([key, title]) => sw(`data-global="${key}"`, globals[key] !== false, title, 'Para todos los clientes')).join('')}</div>`;
  $('#theme-policy').onchange = async (e) => { const { error } = await supabase.from('site_settings').upsert({ id: true, theme_policy: e.target.value, updated_by: me.id, updated_at: new Date().toISOString() }, { onConflict: 'id' }); if (error) notify(error.message); };
  $('#body').querySelectorAll('[data-global]').forEach((input) => (input.onchange = async () => { const { error } = await supabase.from('app_modules').upsert({ module_key: input.dataset.global, enabled: input.checked, updated_by: me.id, updated_at: new Date().toISOString() }, { onConflict: 'module_key' }); if (error) { input.checked = !input.checked; notify(error.message); } }));
}

/* ----------------------------- Ejercicios ----------------------------- */
const CAT_LABEL = { plyometrics: 'Pliometría', training: 'Entrenamiento' };
const LEVEL_LABEL = { beginner: 'Principiante', intermediate: 'Intermedio', expert: 'Avanzado' };
const exState = { cat: 'plyometrics', q: '', muscle: '', equip: '', level: '', active: 'all', shown: 40 };
const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const lev = (a, b) => {
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
};
/** Busca ejercicios iguales o parecidos dentro de la misma categoría (no se mezclan categorías). */
function findSimilar(name, pool, selfId = null) {
  const n = normName(name); if (!n) return { exact: [], near: [] };
  const toks = new Set(n.split(' ').filter((t) => t.length > 2)), exact = [], near = [];
  for (const e of pool) {
    if (e.id === selfId) continue;
    for (const cand of [e.name, e.name_es].filter(Boolean)) {
      const c = normName(cand); if (!c) continue;
      if (c === n) { exact.push(e); break; }
      const ct = new Set(c.split(' ').filter((t) => t.length > 2)), inter = [...toks].filter((t) => ct.has(t)).length, jac = inter / Math.max(1, new Set([...toks, ...ct]).size);
      if ((n.length >= 5 && (c.includes(n) || n.includes(c))) || jac >= 0.6 || (n.length >= 5 && lev(n, c) <= 2)) { near.push(e); break; }
    }
  }
  return { exact, near: near.slice(0, 5) };
}
const exName = (e) => e.name_es || e.name;
const cleanFileName = (file) => { const t = file.replace(/\.[^.]+$/, '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
const splitList = (s) => String(s || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
async function uploadExerciseImage(file, category) {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('Usa imágenes JPG, PNG, WebP o GIF.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Cada imagen debe pesar menos de 5 MB.');
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg', path = `${category}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('exercise-media').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message + (/bucket|not found/i.test(error.message) ? ' (aplica la migración 0031)' : ''));
  return supabase.storage.from('exercise-media').getPublicUrl(path).data.publicUrl;
}
const removeExerciseImage = async (url) => { const i = String(url || '').indexOf('/exercise-media/'); if (i >= 0) await supabase.storage.from('exercise-media').remove([decodeURIComponent(url.slice(i + 16).split('?')[0])]); };
const simNote = (sim) => (sim.exact.length ? `<span class="adm-warn adm-warn--bad">Ya existe: ${esc(exName(sim.exact[0]))}</span>` : sim.near.length ? `<span class="adm-warn">Parecido a: ${sim.near.map((e) => esc(exName(e))).join(', ')}</span>` : '');

async function ejercicios() {
  const { data = [], error } = await supabase.from('exercises').select('*').order('name');
  if (error) { $('#body').innerHTML = `<p class="msg">${esc(error.message)}<br>¿Ejecutaste la migración 0002?</p>`; return; }
  const cats = [...new Set([...Object.keys(CAT_LABEL), ...data.map((e) => e.category)])];
  if (!cats.includes(exState.cat)) exState.cat = cats[0];
  const pool = () => data.filter((e) => e.category === exState.cat);
  const body = $('#body');
  const catName = () => CAT_LABEL[exState.cat] || exState.cat;

  const list = () => {
    const q = normName(exState.q);
    const rows = pool().filter((e) => (!q || normName(e.name + ' ' + (e.name_es || '')).includes(q)) && (!exState.muscle || (e.primary_muscles || []).includes(exState.muscle)) && (!exState.equip || e.equipment === exState.equip) && (!exState.level || e.level === exState.level) && (exState.active === 'all' || (exState.active === 'on') === !!e.is_active));
    const shown = rows.slice(0, exState.shown);
    $('#ex-count').textContent = `${rows.length} ejercicio${rows.length === 1 ? '' : 's'} en ${catName()}`;
    $('#ex-list').innerHTML = shown.map((e) => `<article class="card admin-item adm-ex ${e.is_active ? '' : 'is-off'}"><div class="adm-ex__img">${e.images?.[0] ? `<img loading="lazy" src="${esc(exerciseImgUrl(e.images[0]))}" alt="">` : '<span>—</span>'}</div><div class="adm-ex__body"><b>${esc(exName(e))}</b><span>${esc([(e.primary_muscles || []).join(', '), e.equipment, LEVEL_LABEL[e.level]].filter(Boolean).join(' · ') || 'Sin datos')}</span>${e.is_active ? '' : '<em class="adm-warn">Inactivo</em>'}</div><div class="adm-ex__btns"><button class="btn sm ghost" data-edit="${esc(e.id)}">Editar</button></div></article>`).join('') || '<p class="card muted">No hay ejercicios que coincidan.</p>';
    $('#ex-more').innerHTML = rows.length > shown.length ? `<button class="btn ghost sm" id="ex-more-btn">Ver más (${rows.length - shown.length})</button>` : '';
    const more = $('#ex-more-btn'); if (more) more.onclick = () => { exState.shown += 40; list(); };
    $('#ex-list').querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => openForm(data.find((e) => e.id === b.dataset.edit))));
  };

  const top = () => {
    const p = pool(), muscles = [...new Set(p.flatMap((e) => e.primary_muscles || []))].sort(), equips = [...new Set(p.map((e) => e.equipment).filter(Boolean))].sort();
    const opts = (items, cur, all) => `<option value="">${all}</option>${items.map(([v, t]) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}`;
    body.innerHTML = `<div class="adm-head"><h2>Ejercicios</h2></div>
      <div class="adm-chips" role="tablist" aria-label="Categoría">${cats.map((c) => `<button type="button" class="${c === exState.cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(CAT_LABEL[c] || c)} <small>${data.filter((e) => e.category === c).length}</small></button>`).join('')}</div>
      <div class="adm-head__btns"><button class="btn sm" id="ex-add">+ Agregar ejercicio de ${esc(catName())}</button><button class="btn sm ghost" id="ex-bulk">Agregar en masa</button></div>
      <div class="adm-filters"><input id="ex-q" type="search" placeholder="Buscar en ${esc(catName())}…" value="${esc(exState.q)}" aria-label="Buscar ejercicio">
        <select id="ex-muscle" aria-label="Músculo">${opts(muscles.map((m) => [m, m]), exState.muscle, 'Músculo: todos')}</select>
        <select id="ex-equip" aria-label="Equipo">${opts(equips.map((m) => [m, m]), exState.equip, 'Equipo: todos')}</select>
        <select id="ex-level" aria-label="Nivel">${opts(Object.entries(LEVEL_LABEL), exState.level, 'Nivel: todos')}</select>
        <select id="ex-active" aria-label="Estado">${opts([['on', 'Activos'], ['off', 'Inactivos']], exState.active === 'all' ? '' : exState.active, 'Estado: todos')}</select></div>
      <p class="muted" id="ex-count"></p><div id="ex-list" class="admin-cards"></div><div id="ex-more"></div>`;
    body.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => { exState.cat = b.dataset.cat; Object.assign(exState, { q: '', muscle: '', equip: '', level: '', active: 'all', shown: 40 }); top(); }));
    $('#ex-q').oninput = (e) => { exState.q = e.target.value; exState.shown = 40; list(); };
    for (const [id, key] of [['#ex-muscle', 'muscle'], ['#ex-equip', 'equip'], ['#ex-level', 'level']]) $(id).onchange = (e) => { exState[key] = e.target.value; exState.shown = 40; list(); };
    $('#ex-active').onchange = (e) => { exState.active = e.target.value || 'all'; exState.shown = 40; list(); };
    $('#ex-add').onclick = () => openForm(null);
    $('#ex-bulk').onclick = () => openBulk();
    list();
  };

  const datalists = () => { const p = pool(); return `<datalist id="dl-muscle">${[...new Set(p.flatMap((e) => e.primary_muscles || []))].sort().map((m) => `<option value="${esc(m)}">`).join('')}</datalist><datalist id="dl-equip">${[...new Set(p.map((e) => e.equipment).filter(Boolean))].sort().map((m) => `<option value="${esc(m)}">`).join('')}</datalist>`; };

  function openForm(ex) {
    const isNew = !ex, cat = ex ? ex.category : exState.cat;
    const m = modal(`<div class="sheet-h"><b>${isNew ? 'Agregar ejercicio' : 'Editar ejercicio'} · ${esc(CAT_LABEL[cat] || cat)}</b><button class="link" data-close>Cerrar</button></div>
      <form id="ex-form" class="adm-form">${datalists()}
        <label>Nombre<input name="name" maxlength="120" required value="${esc(ex ? exName(ex) : '')}" autocomplete="off"></label><div id="ex-sim" class="adm-sim"></div>
        <label>Nivel<select name="level">${Object.entries(LEVEL_LABEL).map(([v, t]) => `<option value="${v}" ${(ex?.level || 'beginner') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Equipo<input name="equipment" list="dl-equip" maxlength="80" value="${esc(ex?.equipment || '')}" placeholder="Ej: mancuernas, banco, ninguno"></label>
        <label>Músculos principales<input name="primary" list="dl-muscle" value="${esc((ex?.primary_muscles || []).join(', '))}" placeholder="Separados por coma"></label>
        <label>Músculos secundarios<input name="secondary" value="${esc((ex?.secondary_muscles || []).join(', '))}" placeholder="Separados por coma"></label>
        <label>Instrucciones<textarea name="instructions" rows="4" placeholder="Un paso por línea">${esc((ex?.instructions || []).join('\n'))}</textarea></label>
        <label>Imagen${ex?.images?.[0] ? `<img class="adm-form__img" src="${esc(exerciseImgUrl(ex.images[0]))}" alt="">` : ''}<input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>
        ${sw('name="active"', ex ? ex.is_active : true, 'Activo en la biblioteca', 'Si lo apagas deja de aparecer a los clientes')}
        <div class="quick-actions"><button class="btn" type="submit">${isNew ? 'Agregar' : 'Guardar cambios'}</button>${isNew ? '' : '<button class="btn ghost" type="button" id="ex-del">Borrar</button>'}</div><p class="msg" role="status"></p></form>`);
    m.querySelector('[data-close]').onclick = () => m.remove();
    const form = $('#ex-form', m), msg = form.querySelector('.msg');
    const catPool = data.filter((e) => e.category === cat);
    const check = () => { const sim = findSimilar(form.elements.name.value, catPool, ex?.id); $('#ex-sim', m).innerHTML = simNote(sim); return sim; };
    form.elements.name.oninput = check; check();
    form.onsubmit = async (event) => {
      event.preventDefault(); const name = form.elements.name.value.trim(), sim = check(), btn = form.querySelector('[type=submit]');
      if (!name) return;
      if (sim.exact.length) { msg.textContent = `Ya existe un ejercicio llamado “${exName(sim.exact[0])}” en ${CAT_LABEL[cat] || cat}. Cambia el nombre.`; return; }
      if (sim.near.length && !(await confirmDialog(`Hay ejercicios parecidos: ${sim.near.map(exName).join(', ')}. ¿Guardar de todos modos?`, 'Guardar igual'))) return;
      btn.disabled = true; msg.textContent = 'Guardando…';
      try {
        const file = form.elements.image.files[0]; let images = ex?.images || [];
        if (file) { const url = await uploadExerciseImage(file, cat); if (ex?.images?.[0]) await removeExerciseImage(ex.images[0]); images = [url, ...images.slice(1)]; }
        const fields = { name, name_es: name, level: form.elements.level.value, equipment: form.elements.equipment.value.trim() || null, primary_muscles: splitList(form.elements.primary.value), secondary_muscles: splitList(form.elements.secondary.value), instructions: String(form.elements.instructions.value).split('\n').map((x) => x.trim()).filter(Boolean), images, is_active: form.elements.active.checked };
        const res = isNew ? await supabase.from('exercises').insert({ id: 'custom-' + crypto.randomUUID(), category: cat, source: 'custom', created_by: me.id, ...fields }) : await supabase.from('exercises').update(fields).eq('id', ex.id);
        if (res.error) throw new Error(res.error.message);
        notify(isNew ? 'Ejercicio agregado.' : 'Ejercicio actualizado.', 'success'); m.remove(); ejercicios();
      } catch (err) { msg.textContent = err.message; btn.disabled = false; }
    };
    const del = $('#ex-del', m);
    if (del) del.onclick = async () => {
      if (!(await confirmDialog('¿Borrar este ejercicio del catálogo?', 'Borrar ejercicio'))) return;
      const { error: er } = await supabase.from('exercises').delete().eq('id', ex.id);
      if (er) { msg.textContent = 'No se puede borrar (¿ya se usó en sesiones?). Mejor desactívalo. ' + er.message; return; }
      if (ex.images?.[0]) await removeExerciseImage(ex.images[0]);
      m.remove(); ejercicios();
    };
  }

  function openBulk() {
    const cat = exState.cat, catPool = data.filter((e) => e.category === cat);
    let drafts = [];
    const m = modal(`<div class="sheet-h"><b>Agregar en masa · ${esc(CAT_LABEL[cat] || cat)}</b><button class="link" data-close>Cerrar</button></div>
      <p class="muted">Elige varias fotos: cada una será un ejercicio y su nombre sale del nombre del archivo (puedes cambiarlo). También puedes pegar una lista de nombres.</p>${datalists()}
      <label>Fotos<input id="bk-files" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple></label>
      <label>O pega nombres (uno por línea)<textarea id="bk-names" rows="3" placeholder="Salto vertical&#10;Sentadilla con salto"></textarea></label><button class="btn sm ghost" id="bk-addnames" type="button">Agregar nombres a la lista</button>
      <div class="adm-bulkall" id="bk-all" hidden><b>Aplicar a todos</b><select id="bk-level"><option value="">Nivel</option>${Object.entries(LEVEL_LABEL).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select><input id="bk-equip" list="dl-equip" placeholder="Equipo"><input id="bk-muscle" list="dl-muscle" placeholder="Músculo principal"><button class="btn sm ghost" id="bk-apply" type="button">Aplicar</button></div>
      <div id="bk-rows" class="adm-bulk"></div><div class="quick-actions"><button class="btn" id="bk-save" type="button" hidden>Guardar todos</button></div><p class="msg" id="bk-msg" role="status"></p>`);
    m.querySelector('[data-close]').onclick = () => { drafts.forEach((d) => d.preview && URL.revokeObjectURL(d.preview)); m.remove(); };
    const warnFor = (d, i) => {
      const nn = normName(d.name), dup = nn && drafts.some((o, j) => j < i && normName(o.name) === nn);
      return dup ? '<span class="adm-warn adm-warn--bad">Repetido en esta lista</span>' : simNote(findSimilar(d.name, catPool));
    };
    const draw = () => {
      $('#bk-all', m).hidden = !drafts.length; $('#bk-save', m).hidden = !drafts.length;
      $('#bk-rows', m).innerHTML = drafts.map((d, i) => `<article class="card adm-bulk__row" data-i="${i}"><div class="adm-bulk__img">${d.preview ? `<img src="${d.preview}" alt="">` : '<span>—</span>'}</div><div class="adm-bulk__fields"><input data-f="name" value="${esc(d.name)}" placeholder="Nombre" aria-label="Nombre"><div class="adm-bulk__two"><select data-f="level" aria-label="Nivel">${Object.entries(LEVEL_LABEL).map(([v, t]) => `<option value="${v}" ${d.level === v ? 'selected' : ''}>${t}</option>`).join('')}</select><input data-f="equipment" list="dl-equip" value="${esc(d.equipment)}" placeholder="Equipo" aria-label="Equipo"></div><input data-f="muscle" list="dl-muscle" value="${esc(d.muscle)}" placeholder="Músculo principal" aria-label="Músculo principal"><div class="adm-sim" data-warn>${warnFor(d, i)}</div></div><button class="link" data-rmrow="${i}" aria-label="Quitar">Quitar</button></article>`).join('');
      $('#bk-rows', m).querySelectorAll('[data-i]').forEach((row) => {
        const i = Number(row.dataset.i);
        row.querySelectorAll('[data-f]').forEach((inp) => (inp.oninput = () => { drafts[i][inp.dataset.f] = inp.value; if (inp.dataset.f === 'name') $('#bk-rows', m).querySelectorAll('[data-i]').forEach((r2) => { r2.querySelector('[data-warn]').innerHTML = warnFor(drafts[Number(r2.dataset.i)], Number(r2.dataset.i)); }); }));
        row.querySelector('[data-rmrow]').onclick = () => { const [gone] = drafts.splice(i, 1); if (gone.preview) URL.revokeObjectURL(gone.preview); draw(); };
      });
    };
    const blank = (extra) => ({ name: '', level: 'beginner', equipment: '', muscle: '', file: null, preview: '', ...extra });
    $('#bk-files', m).onchange = (e) => { for (const f of e.target.files) drafts.push(blank({ name: cleanFileName(f.name), file: f, preview: URL.createObjectURL(f) })); e.target.value = ''; draw(); };
    $('#bk-addnames', m).onclick = () => { String($('#bk-names', m).value).split('\n').map((x) => x.trim()).filter(Boolean).forEach((n) => drafts.push(blank({ name: n }))); $('#bk-names', m).value = ''; draw(); };
    $('#bk-apply', m).onclick = () => { const l = $('#bk-level', m).value, q = $('#bk-equip', m).value.trim(), mu = $('#bk-muscle', m).value.trim(); drafts.forEach((d) => { if (l) d.level = l; if (q) d.equipment = q; if (mu) d.muscle = mu; }); draw(); };
    $('#bk-save', m).onclick = async () => {
      const btn = $('#bk-save', m), msg = $('#bk-msg', m); btn.disabled = true;
      const seen = new Set(catPool.flatMap((e) => [normName(e.name), normName(e.name_es)]).filter(Boolean)); let ok = 0; const skipped = [], failed = [], rows = [];
      for (let i = 0; i < drafts.length; i++) {
        const d = drafts[i], name = d.name.trim(), nn = normName(name);
        if (!name) { skipped.push('(sin nombre)'); continue; }
        if (seen.has(nn)) { skipped.push(name); continue; }
        msg.textContent = `Subiendo ${i + 1} de ${drafts.length}…`;
        try {
          const url = d.file ? await uploadExerciseImage(d.file, cat) : null;
          rows.push({ id: 'custom-' + crypto.randomUUID(), name, name_es: name, category: cat, level: d.level, equipment: d.equipment.trim() || null, primary_muscles: splitList(d.muscle), secondary_muscles: [], instructions: [], images: url ? [url] : [], source: 'custom', created_by: me.id, is_active: true });
          seen.add(nn);
        } catch (err) { failed.push(`${name}: ${err.message}`); }
      }
      if (rows.length) { const { error: er } = await supabase.from('exercises').insert(rows); if (er) { msg.textContent = 'No se pudo guardar: ' + er.message; btn.disabled = false; return; } ok = rows.length; }
      const parts = [`Se agregaron ${ok}.`]; if (skipped.length) parts.push(`Omitidos por existir o estar vacíos: ${skipped.join(', ')}.`); if (failed.length) parts.push(`Con error: ${failed.join(' | ')}.`);
      notify(parts.join(' '), ok ? 'success' : undefined); drafts.forEach((d) => d.preview && URL.revokeObjectURL(d.preview)); m.remove(); ejercicios();
    };
    draw();
  }

  top();
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


        <label for="ef-category">Categoría (ej. Carrera 10K) (opcional)</label>
        <input id="ef-category" maxlength="40" value="${esc(existing?.category || '')}">
        <label for="ef-terrain">Terreno (opcional)</label>
        <input id="ef-terrain" maxlength="40" value="${esc(existing?.terrain || '')}">
        <label for="ef-price">Precio (opcional)</label>
        <input id="ef-price" maxlength="40" value="${esc(existing?.price || '')}">
        <label for="ef-elevation">Desnivel (opcional)</label>
        <input id="ef-elevation" maxlength="40" value="${esc(existing?.elevation || '')}">
        <label for="ef-temperature">Temperatura (opcional)</label>
        <input id="ef-temperature" maxlength="40" value="${esc(existing?.temperature || '')}">
        <label for="ef-humidity">Humedad (opcional)</label>
        <input id="ef-humidity" maxlength="40" value="${esc(existing?.humidity || '')}">
        <label for="ef-wind">Viento (opcional)</label>
        <input id="ef-wind" maxlength="40" value="${esc(existing?.wind || '')}">
        <label for="ef-more">Más información (texto o enlace, opcional)</label>
        <textarea id="ef-more" rows="3" maxlength="4000">${esc(existing?.more_info || '')}</textarea>

        <label>Ruta en el mapa (opcional)</label>
        <div class="route-field"><span class="muted" id="ef-route-info">${esc(routeSummary(existing?.route))}</span><button type="button" class="btn ghost sm" id="ef-route-btn">Marcar de dónde a dónde</button></div>

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

    let routeVal = existing?.route ?? null, routeTouched = false;
    m.querySelector('#ef-route-btn').onclick = async () => {
      const out = await openRoutePicker({ route: routeVal, title: 'Ruta del evento', allowRemove: true });
      if (!out) return;
      routeVal = out.route; routeTouched = true;
      m.querySelector('#ef-route-info').textContent = routeSummary(routeVal);
    };
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
      const extra = {};
      for (const k of ['category','terrain','price','elevation','temperature','humidity','wind']) { const v = m.querySelector('#ef-' + k).value.trim(); if (v || existing?.[k]) extra[k] = v || null; }
      { const v = m.querySelector('#ef-more').value.trim(); if (v || existing?.more_info) extra.more_info = v || null; }
      if (routeTouched) extra.route = routeVal;

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
        ...extra,
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
  const { data: rows = [], error } = await supabase.from('club_challenges').select('*').order('starts_on', { ascending: false });
  const body = $('#body');
  if (error) { body.innerHTML = `<h1>Retos del club</h1><div class="card warn">No se pudieron cargar. Aplica la migración 0015 cuando esté lista: ${esc(error.message)}</div>`; return; }
  const disciplineLabel = { running: 'Running', cycling: 'Ciclismo', swimming: 'Natación', plyo: 'Pliometría', training: 'Entrenamiento' };
  body.innerHTML = `<div class="adm-head"><h1>Retos del club</h1><button class="btn sm" id="ch-new">+ Nuevo reto</button></div><p class="muted">Las clasificaciones usan sesiones y distancias reales guardadas en la app.</p>
    <h2>Retos publicados (${rows.length})</h2><div class="admin-cards">${rows.map((row) => `<article class="card admin-challenge-row"><span class="notification-kind">${disciplineLabel[row.discipline]} · ${row.metric === 'distance_km' ? 'Kilómetros' : 'Sesiones'} · meta ${row.goal_value}</span><h3>${esc(row.title)}</h3><p>${esc(row.description || '')}</p><small>${row.starts_on} – ${row.ends_on}</small><div class="quick-actions"><button class="btn sm ghost" data-edit-challenge="${row.id}">Editar</button><button class="btn sm ghost" data-delete-challenge="${row.id}">Eliminar</button></div></article>`).join('') || '<p class="card muted">Aún no hay retos. Pulsa “Nuevo reto” para crear el primero.</p>'}</div>`;

  function openForm(row) {
    const v = (k) => esc(row?.[k] ?? '');
    const m = modal(`<div class="sheet-h"><b>${row ? 'Editar reto' : 'Nuevo reto'}</b><button class="link" data-close>Cerrar</button></div>
      <form class="admin-challenge-form adm-form" id="challenge-form"><input type="hidden" name="id" value="${v('id')}">
        <label>Título<input name="title" maxlength="100" required value="${v('title')}"></label>
        <label>Descripción<textarea name="description" maxlength="500" rows="3">${v('description')}</textarea></label>
        <div class="row"><label>Disciplina<select name="discipline">${Object.entries(disciplineLabel).map(([value, label]) => `<option value="${value}" ${row?.discipline === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label>Medición<select name="metric"><option value="sessions" ${row?.metric === 'sessions' ? 'selected' : ''}>Sesiones</option><option value="distance_km" ${row?.metric === 'distance_km' ? 'selected' : ''}>Distancia (km)</option></select></label></div>
        <div class="route-field route-field--full"><span><b>Ruta</b> <small class="muted" id="ch-route-info">Sin ruta</small></span><button type="button" class="btn ghost sm" id="ch-route-btn">Marcar de dónde a dónde</button><input type="hidden" name="route_json"></div>
        <div class="row"><label>Meta<input name="goal_value" type="number" min="1" step="0.1" required value="${v('goal_value')}"></label>
        <label>Logros de recompensa<input name="reward_logros" type="number" min="0" max="5000" step="1" placeholder="50" value="${v('reward_logros')}"></label></div>
        <label>Insignia (máx. 6 caracteres)<input name="badge" maxlength="6" placeholder="400'" value="${v('badge')}"></label>
        <div class="row"><label>Inicio<input name="starts_on" type="date" required value="${v('starts_on')}"></label><label>Fin<input name="ends_on" type="date" required value="${v('ends_on')}"></label></div>
        <div class="quick-actions"><button class="btn" type="submit">${row ? 'Guardar cambios' : 'Crear reto'}</button></div><p class="msg" aria-live="polite"></p></form>`);
    m.querySelector('[data-close]').onclick = () => m.remove();
    const form = $('#challenge-form', m);
    form.elements.route_json.value = row?.route ? JSON.stringify(row.route) : '';
    const readRoute = () => { try { return JSON.parse(form.elements.route_json.value || 'null'); } catch { return null; } };
    const paintRoute = () => { const r = readRoute(), d = form.elements.discipline.value; $('#ch-route-info', m).textContent = r ? routeSummary(r) : d === 'running' ? 'Obligatoria en retos de running' : 'Opcional'; };
    $('#ch-route-btn', m).onclick = async () => { const d = form.elements.discipline.value, out = await openRoutePicker({ route: readRoute(), profile: d === 'cycling' ? 'bike' : 'foot', title: 'Ruta del reto', allowRemove: true }); if (!out) return; form.elements.route_json.value = out.route ? JSON.stringify(out.route) : ''; if (out.route && form.elements.metric.value === 'distance_km' && !form.elements.goal_value.value) form.elements.goal_value.value = out.route.distance_km; paintRoute(); };
    const syncMetric = () => { const d = form.elements.discipline.value, dist = form.elements.metric.querySelector('[value="distance_km"]'); if (d === 'plyo' || d === 'training') { form.elements.metric.value = 'sessions'; dist.disabled = true; } else dist.disabled = false; paintRoute(); };
    form.elements.discipline.onchange = syncMetric; syncMetric();
    form.onsubmit = async (event) => {
      event.preventDefault(); const data = new FormData(form), id = data.get('id'), start = data.get('starts_on'), end = data.get('ends_on'), metric = data.get('metric'), discipline = data.get('discipline'), msg = form.querySelector('.msg'), button = form.querySelector('[type="submit"]');
      if (end < start) { msg.textContent = 'La fecha final debe ser igual o posterior al inicio.'; return; }
      const routeObj = readRoute(); if (discipline === 'running' && !routeObj) { msg.textContent = 'En los retos de running la ruta es obligatoria: márcala de dónde a dónde.'; return; }
      if ((discipline === 'plyo' || discipline === 'training') && metric === 'distance_km') { msg.textContent = 'Pliometría y Entrenamiento solo admiten retos por sesiones.'; return; }
      button.disabled = true;
      const payload = { title: String(data.get('title')).trim(), description: String(data.get('description') || '').trim() || null, discipline, metric, goal_value: Number(data.get('goal_value')), starts_on: start, ends_on: end };
      if (routeObj || row?.route) payload.route = routeObj;
      { const r = String(data.get('reward_logros') || '').trim(), bd = String(data.get('badge') || '').trim(); if (r !== '') payload.reward_logros = Number(r); if (bd || row?.badge) payload.badge = bd || null; }
      const result = id ? await supabase.from('club_challenges').update(payload).eq('id', id) : await supabase.from('club_challenges').insert({ ...payload, created_by: me.id });
      button.disabled = false; if (result.error) { msg.textContent = `No se guardó el reto: ${result.error.message}`; return; }
      notify(id ? 'Reto actualizado.' : 'Reto creado.', 'success'); m.remove(); retos();
    };
  }

  $('#ch-new', body).onclick = () => openForm(null);
  body.querySelectorAll('[data-edit-challenge]').forEach((button) => (button.onclick = () => { const row = rows.find((item) => item.id === button.dataset.editChallenge); if (row) openForm(row); }));
  body.querySelectorAll('[data-delete-challenge]').forEach((button) => (button.onclick = async () => {
    if (!(await confirmDialog('¿Eliminar el reto? También se borrará la participación asociada.', 'Eliminar reto'))) return;
    const { error: deleteError } = await supabase.from('club_challenges').delete().eq('id', button.dataset.deleteChallenge);
    if (deleteError) notify(deleteError.message); else { notify('Reto eliminado.', 'success'); retos(); }
  }));
}

/* ------------------------------- Shell ------------------------------- */
const SECTIONS = { pagos, clientes, socios, modulos, ejercicios, eventos, retos };
const allowedTabs = () => TABS.filter(([h]) => (h === 'socios' ? isOwner() : can(h)));
function route() {
  const allowed = allowedTabs().map(([h]) => h);
  if (!allowed.length) { $('#body').innerHTML = '<h2>Sin permisos</h2><p class="muted">Aún no tienes permisos asignados en el panel. Pídele al administrador que te los active.</p>'; return; }
  const asked = location.hash.slice(1), t = SECTIONS[asked] && allowed.includes(asked) ? asked : allowed[0];
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
    if (!['admin', 'socio'].includes(me?.role)) { stopLoading();view.innerHTML = '<h1>Sin acceso</h1><p class="muted">Esta sección es solo para el equipo del club.</p>'; return; }
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
    $('#tabs').innerHTML = allowedTabs().map(([h, t, icon]) => `<a href="#${h}" aria-label="${t}" aria-current="false"><span class="tab-icon">${icon}</span><span class="tab-label">${t}</span></a>`).join('');
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
