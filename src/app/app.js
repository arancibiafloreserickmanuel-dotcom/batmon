import './app.css';
import { supabase, $, esc, getProfile } from '../supabase.js';
import { fmt, today, monthStart, weekStart, paceStr, DISC } from './common.js';
import { renderRunning } from './running.js';
import { renderPlyo } from './plyo.js';

const STATUS = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' };
const view = $('#view');
const TABS = [['inicio', 'Inicio'], ['running', 'Running'], ['plyo', 'Pliometría'], ['pago', 'Membresía']];
let ctx = null;

/* ---------------- Login / registro ---------------- */
function showLogin(signup = false) {
  ctx = null; $('#logout').hidden = true; $('#admin-link').hidden = true; $('#tabs').hidden = true;
  view.innerHTML = `
    <h1>Bienvenido<br>al Crowd</h1><p class="muted">${signup ? 'Crea tu cuenta de socio.' : 'Ingresa con tu correo.'}</p>
    <form id="lf" class="card" style="margin-top:20px">
      ${signup ? '<label for="nm">Nombre</label><input id="nm" type="text" autocomplete="name" required>' : ''}
      <label for="em">Correo</label><input id="em" type="email" autocomplete="email" required>
      <label for="pw">Contraseña</label><input id="pw" type="password" minlength="6" autocomplete="${signup ? 'new-password' : 'current-password'}" required>
      <button class="btn" type="submit">${signup ? 'Crear cuenta' : 'Entrar'}</button><p class="msg" id="lm"></p>
      <button class="link" type="button" id="tg" style="margin-top:14px">${signup ? 'Ya tengo cuenta' : 'Crear cuenta'}</button>
    </form>`;
  $('#tg').onclick = () => showLogin(!signup);
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#em').value.trim(), password = $('#pw').value;
    const { error } = signup
      ? await supabase.auth.signUp({ email, password, options: { data: { full_name: $('#nm').value.trim() } } })
      : await supabase.auth.signInWithPassword({ email, password });
    if (error) $('#lm').textContent = signup ? 'No se pudo crear: ' + error.message : 'Correo o contraseña incorrectos.';
  };
}

/* ---------------- Shell con pestañas ---------------- */
async function boot(user) {
  const profile = await getProfile(user.id);
  ctx = { user, profile, isAdmin: profile?.role === 'admin' };
  $('#logout').hidden = false; $('#admin-link').hidden = !ctx.isAdmin; $('#tabs').hidden = false;
  route();
}

function route() {
  if (!ctx) return;
  const tab = (location.hash.slice(1) || 'inicio');
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + tab));
  view.innerHTML = '<p class="muted center">Cargando…</p>';
  const fn = { inicio: renderHome, running: renderRunning, plyo: renderPlyo, pago: renderMembership }[tab] || renderHome;
  Promise.resolve(fn(view, ctx)).catch((e) => { view.innerHTML = `<p class="msg">Error: ${esc(e.message)}</p>`; });
}

/* ---------------- Inicio ---------------- */
async function renderHome(v) {
  const [{ data: acts = [] }, { data: ws = [] }, { data: mems = [] }] = await Promise.all([
    supabase.from('activities').select('*').order('performed_on', { ascending: false }).limit(200),
    supabase.from('workouts').select('id, performed_on, duration_min, workout_sets(id)').order('performed_on', { ascending: false }).limit(100),
    supabase.from('memberships').select('*').eq('period', monthStart()).order('created_at', { ascending: false }),
  ]);
  const ws0 = weekStart();
  const km = (d) => acts.filter((a) => a.discipline === d && a.performed_on >= ws0).reduce((s, a) => s + Number(a.distance_km), 0);
  const last = acts[0];
  const cur = mems[0];
  const plyoWeek = ws.filter((w) => w.performed_on >= ws0).length;

  v.innerHTML = `<h1>Hola, ${esc(ctx.profile?.full_name || '')}</h1><p class="muted">Tu semana en el Crowd</p>
    ${!cur || cur.status === 'rejected' ? `<div class="card warn">Aún no tienes la membresía de este mes aprobada. <a href="#pago">Pagar ahora</a></div>` : cur.status === 'pending' ? '<div class="card warn">Tu pago está pendiente de aprobación.</div>' : ''}
    <div class="grid">
      <div class="card stat"><b>${fmt(km('running'))} km</b><span>Running · semana</span></div>
      <div class="card stat"><b>${fmt(km('cycling'))} km</b><span>Ciclismo · semana</span></div>
      <div class="card stat"><b>${plyoWeek}</b><span>Pliometría · sesiones</span></div>
    </div>
    <div class="card"><span class="muted">Última salida</span><br>${last ? `<b>${DISC[last.discipline]}</b> · ${fmt(last.distance_km)} km · ${fmt(last.duration_min)} min${last.discipline === 'running' ? ' · ' + paceStr(last.distance_km, last.duration_min) : ''} · ${last.performed_on}` : 'Aún no registras nada.'}</div>
    <div class="card"><span class="muted">Última sesión de pliometría</span><br>${ws[0] ? `<b>${ws[0].performed_on}</b> · ${ws[0].workout_sets.length} series${ws[0].duration_min ? ' · ' + fmt(ws[0].duration_min, 0) + ' min' : ''}` : 'Aún no registras nada.'}</div>
    <p><a class="btn" href="#running" style="text-decoration:none">Registrar running</a> <a class="btn ghost" href="#plyo" style="text-decoration:none">Registrar pliometría</a></p>`;
}

/* ---------------- Membresía (pago por QR manual) ---------------- */
async function renderMembership(v) {
  const { data: mems = [] } = await supabase.from('memberships').select('*').order('period', { ascending: false }).order('created_at', { ascending: false });
  const cur = mems.find((m) => m.period === monthStart() && m.status !== 'rejected') || mems.find((m) => m.period === monthStart());
  const status = cur ? `<p>Estado de este mes: <span class="pill ${cur.status}">${STATUS[cur.status]}</span></p>` : '<p class="muted">Aún no pagaste este mes.</p>';
  v.innerHTML = `<h1>Membresía</h1><p class="muted">200 Bs / mes</p><div class="card" id="mem"></div>
    ${mems.length ? `<h2>Mis pagos</h2><div class="card"><table><tr><th>Mes</th><th>Estado</th></tr>${mems.map((m) => `<tr><td>${m.period.slice(0, 7)}</td><td><span class="pill ${m.status}">${STATUS[m.status]}</span></td></tr>`).join('')}</table></div>` : ''}`;
  const box = $('#mem');
  if (cur && cur.status !== 'rejected') { box.innerHTML = status + (cur.status === 'pending' ? '<p class="muted">Recibimos tu comprobante. El administrador lo aprobará pronto.</p>' : ''); return; }
  box.innerHTML = `${status}
    <p class="muted">1. Paga 200 Bs escaneando este QR. 2. Sube la foto del comprobante.</p>
    <img class="qr" src="/qr-pago.webp" alt="QR de pago">
    <form id="pf"><label for="fl">Comprobante (foto)</label><input id="fl" type="file" accept="image/*" required>
    <button class="btn" type="submit">Enviar comprobante</button><p class="msg" id="pm"></p></form>`;
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    const file = $('#fl').files[0]; if (!file) return;
    if (file.size > 5 * 1024 * 1024) { $('#pm').textContent = 'La foto pesa más de 5 MB.'; return; }
    const path = `${ctx.user.id}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, '_')}`;
    const up = await supabase.storage.from('receipts').upload(path, file);
    if (up.error) { $('#pm').textContent = 'Error subiendo: ' + up.error.message; return; }
    const ins = await supabase.from('memberships').insert({ period: monthStart(), proof_path: path });
    if (ins.error) $('#pm').textContent = 'Error: ' + ins.error.message; else renderMembership(v);
  };
}

/* ---------------- Arranque: sesión persistente ---------------- */
$('#tabs').innerHTML = TABS.map(([h, t]) => `<a href="#${h}">${t}</a>`).join('');
$('#logout').onclick = () => supabase.auth.signOut();
window.addEventListener('hashchange', route);
let booted = null;
supabase.auth.onAuthStateChange((_ev, session) => {
  if (!session) { booted = null; showLogin(); return; }
  if (booted !== session.user.id) { booted = session.user.id; boot(session.user); }  // evita recargar en cada refresh de token
});
void today;
