import './app.css';
import { supabase, $, esc, getProfile } from '../supabase.js';
import { fmt, monthStart, RUN_TYPE, DISC, paceStr } from './common.js';
import baseCatalog from '../data/plyometrics.json';

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
  const proof = (m) => (urls[m.id] ? `<a href="${urls[m.id]}" target="_blank" rel="noopener">Ver</a>` : '—');
  const btn = (a, id, t, cls = '') => `<button class="btn sm ${cls}" data-a="${a}" data-id="${id}">${t}</button>`;

  $('#body').innerHTML = `
    <h2>Pendientes (${pending.length})</h2>
    <div class="card scroll">${pending.length ? `<table><tr><th>Socio</th><th>Mes</th><th>Comprobante</th><th></th></tr>
      ${pending.map((m) => `<tr><td>${esc(name[m.user_id] || '?')}</td><td>${m.period.slice(0, 7)}</td><td>${proof(m)}</td>
      <td class="nw">${btn('approved', m.id, 'Aprobar')}${btn('rejected', m.id, 'Rechazar', 'ghost')}</td></tr>`).join('')}</table>` : '<p class="muted">Nada pendiente.</p>'}</div>
    <h2>Historial</h2>
    <div class="card scroll">${rest.length ? `<table><tr><th>Socio</th><th>Mes</th><th>Comprobante</th><th>Estado</th><th></th></tr>
      ${rest.map((m) => `<tr><td>${esc(name[m.user_id] || '?')}</td><td>${m.period.slice(0, 7)}</td><td>${proof(m)}</td><td><span class="pill ${m.status}">${STATUS[m.status]}</span></td>
      <td class="nw"><button class="link" data-a="pending" data-id="${m.id}">Reabrir</button> <button class="link" data-a="delete" data-id="${m.id}">Borrar</button></td></tr>`).join('')}</table>` : '<p class="muted">Sin historial.</p>'}</div>`;

  $('#body').querySelectorAll('[data-a]').forEach((b) => (b.onclick = async () => {
    const a = b.dataset.a, id = b.dataset.id;
    if (a === 'delete' && !confirm('¿Borrar este pago del historial? No se puede deshacer.')) return;
    b.disabled = true;
    const { error } = a === 'delete'
      ? await supabase.from('memberships').delete().eq('id', id)
      : await supabase.from('memberships').update({ status: a, approved_at: a === 'approved' ? new Date().toISOString() : null, approved_by: a === 'approved' ? me.id : null }).eq('id', id);
    if (error) alert(error.message); else pagos();
  }));
}

/* ------------------------------- Socios ------------------------------- */
async function socios() {
  const { data = [], error } = await supabase.rpc('admin_member_overview');
  if (error) { $('#body').innerHTML = `<p class="msg">${esc(error.message)}<br>¿Ejecutaste la migración 0002?</p>`; return; }
  $('#body').innerHTML = `<h2>Socios (${data.length})</h2><div class="card scroll"><table>
    <tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Km</th><th>Pliom.</th><th>Último</th><th>Pago mes</th><th></th></tr>
    ${data.map((u) => `<tr><td>${esc(u.full_name)}</td><td>${esc(u.email)}</td><td>${u.role}</td><td>${fmt(u.total_km)}</td><td>${u.plyo_sessions}</td>
      <td>${u.last_activity || '—'}</td><td>${u.membership ? `<span class="pill ${u.membership}">${STATUS[u.membership]}</span>` : '—'}</td>
      <td class="nw"><button class="link" data-d="${u.id}">Ver datos</button></td></tr>`).join('')}</table></div>`;
  $('#body').querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => detalle(data.find((u) => u.id === b.dataset.d))));
}

async function detalle(u) {
  const [{ data: acts = [] }, { data: ws = [] }] = await Promise.all([
    supabase.from('activities').select('*').eq('user_id', u.id).order('performed_on', { ascending: false }).limit(100),
    supabase.from('workouts').select('*, workout_sets(id)').eq('user_id', u.id).order('performed_on', { ascending: false }).limit(100),
  ]);
  const self = u.id === me.id;
  const m = modal(`<div class="sheet-h"><b>${esc(u.full_name)}</b><button class="link" data-close>Cerrar</button></div>
    <p class="muted">${esc(u.email)} · alta ${u.created_at.slice(0, 10)} · rol <b>${u.role}</b></p>
    <h2>Running / ciclismo (${acts.length})</h2><div class="card scroll">${acts.length ? `<table>${acts.map((a) => `<tr><td>${a.performed_on}</td><td>${DISC[a.discipline]}${a.run_type ? ' · ' + RUN_TYPE[a.run_type] : ''}</td><td>${fmt(a.distance_km)} km</td><td>${fmt(a.duration_min)} min</td><td>${a.discipline === 'running' ? paceStr(a.distance_km, a.duration_min) : ''}</td><td><button class="link" data-da="${a.id}">Borrar</button></td></tr>`).join('')}</table>` : '<p class="muted">Sin datos.</p>'}</div>
    <h2>Pliometría (${ws.length})</h2><div class="card scroll">${ws.length ? `<table>${ws.map((w) => `<tr><td>${w.performed_on}</td><td>${w.workout_sets.length} series</td><td>${w.duration_min ? fmt(w.duration_min, 0) + ' min' : ''}</td><td><button class="link" data-dw="${w.id}">Borrar</button></td></tr>`).join('')}</table>` : '<p class="muted">Sin datos.</p>'}</div>
    <h2>Acciones</h2>
    ${self ? '<p class="muted">Eres tú: no puedes cambiar tu rol ni borrarte.</p>' : `<button class="btn sm ghost" id="role">${u.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}</button>
      <button class="btn sm" id="rmuser" style="background:#a00;border-color:#a00">Eliminar socio y sus datos</button>`}`);
  m.querySelector('[data-close]').onclick = () => m.remove();
  const refresh = () => { m.remove(); socios(); };
  m.querySelectorAll('[data-da]').forEach((b) => (b.onclick = async () => { if (!confirm('¿Borrar esta actividad?')) return; const { error } = await supabase.from('activities').delete().eq('id', b.dataset.da); if (error) alert(error.message); else { m.remove(); detalle(u); } }));
  m.querySelectorAll('[data-dw]').forEach((b) => (b.onclick = async () => { if (!confirm('¿Borrar esta sesión?')) return; const { error } = await supabase.from('workouts').delete().eq('id', b.dataset.dw); if (error) alert(error.message); else { m.remove(); detalle(u); } }));
  const role = $('#role', m); if (role) role.onclick = async () => { const { error } = await supabase.rpc('admin_set_role', { target: u.id, new_role: u.role === 'admin' ? 'member' : 'admin' }); if (error) alert(error.message); else refresh(); };
  const rm = $('#rmuser', m); if (rm) rm.onclick = async () => {
    if (prompt(`Esto borra la cuenta de ${u.full_name} y TODOS sus datos (km, sesiones, pagos).\nEscribe ELIMINAR para confirmar:`) !== 'ELIMINAR') return;
    const { error } = await supabase.rpc('admin_delete_user', { target: u.id }); if (error) alert(error.message); else refresh();
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
    <input id="q" type="search" placeholder="Buscar…" style="margin:10px 0">
    <div class="card scroll"><table id="tb"></table></div>`;

  const draw = () => {
    const q = $('#q').value.trim().toLowerCase();
    $('#tb').innerHTML = `<tr><th></th><th>Nombre (EN)</th><th>Nombre (ES)</th><th>Origen</th><th>Activo</th><th></th></tr>` +
      data.filter((e) => !q || (e.name + (e.name_es || '')).toLowerCase().includes(q)).map((e) => `<tr>
        <td>${e.images?.[0] ? `<img class="th" loading="lazy" src="/exercises/${esc(e.images[0])}" alt="">` : ''}</td>
        <td>${esc(e.name)}</td><td><input data-es="${esc(e.id)}" value="${esc(e.name_es || '')}" placeholder="traducir…"></td>
        <td>${e.source}</td><td><input type="checkbox" data-act="${esc(e.id)}" ${e.is_active ? 'checked' : ''}></td>
        <td><button class="link" data-rm="${esc(e.id)}">Borrar</button></td></tr>`).join('');
    $('#tb').querySelectorAll('[data-es]').forEach((i) => (i.onchange = async () => { const { error: er } = await supabase.from('exercises').update({ name_es: i.value.trim() || null }).eq('id', i.dataset.es); if (er) alert(er.message); else data.find((e) => e.id === i.dataset.es).name_es = i.value.trim() || null; }));
    $('#tb').querySelectorAll('[data-act]').forEach((i) => (i.onchange = async () => { const { error: er } = await supabase.from('exercises').update({ is_active: i.checked }).eq('id', i.dataset.act); if (er) { alert(er.message); i.checked = !i.checked; } }));
    $('#tb').querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => {
      if (!confirm('¿Borrar este ejercicio del catálogo?')) return;
      const { error: er } = await supabase.from('exercises').delete().eq('id', b.dataset.rm);
      if (er) alert('No se puede borrar (¿ya se usó en sesiones?). Mejor desactívalo.\n' + er.message); else ejercicios();
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
