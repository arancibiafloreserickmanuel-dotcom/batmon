import './app.css';
import { supabase, $, esc, getProfile } from '../supabase.js';
import { fmt, today, monthStart, weekStart, paceStr, DISC } from './common.js';
import { renderRunning } from './running.js';
import { renderPlyo } from './plyo.js';

const STATUS = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' };
const view = $('#view');
const TABS = [
  ['inicio', 'Inicio', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg>'],
  ['running', 'Running', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="16.5" cy="4.5" r="2"/><path d="m13 8 3 2 2 4-4 2-2 5m4-11-4 3-4 1-3 4m8-8-3-3-4 1"/></svg>'],
  ['plyo', 'Pliometría', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16"/><circle cx="7" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="10" cy="19" r="1"/></svg>'],
  ['pago', 'Membresía', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18m-14 5h4"/></svg>'],
];
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
      ${!signup ? '<button class="link" type="button" id="forgot">Olvidé mi contraseña</button>' : ''}
      <button class="link" type="button" id="tg" style="margin-top:14px">${signup ? 'Ya tengo cuenta' : 'Crear cuenta'}</button>
    </form>`;
  $('#tg').onclick = () => showLogin(!signup);
  const forgot = $('#forgot');
  if (forgot) forgot.onclick = async () => {
    const email = $('#em').value.trim();
    if (!email) { $('#lm').textContent = 'Escribe tu correo para enviarte el enlace de recuperación.'; $('#em').focus(); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/app.html` });
    $('#lm').textContent = error ? 'No se pudo enviar el enlace: ' + error.message : 'Te enviamos un enlace para restablecer tu contraseña.';
  };
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#em').value.trim(), password = $('#pw').value;
    const { error } = signup
      ? await supabase.auth.signUp({ email, password, options: { data: { full_name: $('#nm').value.trim() } } })
      : await supabase.auth.signInWithPassword({ email, password });
    if (error) $('#lm').textContent = signup ? 'No se pudo crear: ' + error.message : 'Correo o contraseña incorrectos.';
  };
}

function showNewPassword() {
  view.innerHTML = `<h1>Nueva contraseña</h1><p class="muted">Elige una contraseña de al menos 6 caracteres.</p><form id="newpass" class="card"><label for="np">Contraseña nueva</label><input id="np" type="password" minlength="6" autocomplete="new-password" required><button class="btn" type="submit">Guardar contraseña</button><p class="msg" id="npm"></p></form>`;
  $('#newpass').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password: $('#np').value });
    $('#npm').textContent = error ? 'No se pudo actualizar: ' + error.message : 'Contraseña actualizada. Ya puedes ingresar.';
    if (!error) setTimeout(() => showLogin(), 1200);
  };
}

/* ---------------- Shell con pestañas ---------------- */
async function boot(user) {
  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('memberships').select('status').eq('user_id', user.id).eq('period', monthStart()).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  ctx = { user, profile, isAdmin: profile?.role === 'admin', canRegister: membership?.status === 'approved' };
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

  const seenKey = `batmon_membership_status_${ctx.user.id}`;
  const previousStatus = localStorage.getItem(seenKey);
  if (cur?.status) localStorage.setItem(seenKey, cur.status);
  const statusNotice = previousStatus && cur?.status && previousStatus !== cur.status && ['approved', 'rejected'].includes(cur.status)
    ? `<div class="card ${cur.status === 'approved' ? 'okbox' : 'warn'}">${cur.status === 'approved' ? '¡Tu pago fue aprobado! Ya puedes registrar entrenamientos.' : 'Tu pago fue rechazado. Revisa el comprobante y vuelve a enviarlo desde Membresía.'}</div>` : '';
  v.innerHTML = `<h1>Hola, ${esc(ctx.profile?.full_name || '')}</h1><p class="muted">Tu semana en el Crowd</p>${statusNotice}
    ${!cur || cur.status === 'rejected' ? `<div class="card warn">Aún no tienes la membresía de este mes aprobada. <a href="#pago">Pagar ahora</a></div>` : cur.status === 'pending' ? '<div class="card warn">Tu pago está pendiente de aprobación.</div>' : ''}
    <div class="grid">
      <div class="card stat"><b>${fmt(km('running'))} km</b><span>Running · semana</span></div>
      <div class="card stat"><b>${fmt(km('cycling'))} km</b><span>Ciclismo · semana</span></div>
      <div class="card stat"><b>${fmt(km('swimming'))} km</b><span>Natación · semana</span></div>
      <div class="card stat"><b>${plyoWeek}</b><span>Pliometría · sesiones</span></div>
    </div>
    <div class="card"><span class="muted">Última salida</span><br>${last ? `<b>${DISC[last.discipline]}</b> · ${fmt(last.distance_km)} km · ${fmt(last.duration_min)} min${last.discipline === 'running' ? ' · ' + paceStr(last.distance_km, last.duration_min) : ''} · ${last.performed_on}` : 'Aún no registras nada.'}</div>
    <div class="card"><span class="muted">Última sesión de pliometría</span><br>${ws[0] ? `<b>${ws[0].performed_on}</b> · ${ws[0].workout_sets.length} series${ws[0].duration_min ? ' · ' + fmt(ws[0].duration_min, 0) + ' min' : ''}` : 'Aún no registras nada.'}</div>
    <div class="quick-actions"><a class="btn" href="#running">Registrar running</a><a class="btn ghost" href="#plyo">Registrar pliometría</a></div>`;
}

/* ---------------- Membresía (pago por QR manual) ---------------- */
async function renderMembership(v) {
  const { data: mems = [] } = await supabase.from('memberships').select('*').order('period', { ascending: false }).order('created_at', { ascending: false });
  const cur = mems.find((m) => m.period === monthStart() && m.status !== 'rejected') || mems.find((m) => m.period === monthStart());
  const status = cur ? `<p>Estado de este mes: <span class="pill ${cur.status}">${STATUS[cur.status]}</span></p>` : '<p class="muted">Aún no pagaste este mes.</p>';
  v.innerHTML = `<h1>Membresía</h1><p class="muted">200 Bs / mes</p><div class="card" id="mem"></div>
    ${mems.length ? `<h2>Mis pagos</h2><div class="activity-list">${mems.map((m) => `<div class="card activity-card"><b>${m.period.slice(0, 7)}</b><span class="pill ${m.status}">${STATUS[m.status]}</span></div>`).join('')}</div>` : ''}`;
  const box = $('#mem');
  if (cur && cur.status !== 'rejected') { box.innerHTML = status + (cur.status === 'pending' ? '<p class="muted">Recibimos tu comprobante. El administrador lo aprobará pronto.</p>' : ''); return; }
  box.innerHTML = `${status}
    <ol class="pay-steps"><li>Paga 200 Bs escaneando este QR.</li><li>Sube una foto del comprobante.</li><li>Espera la aprobación del administrador.</li></ol>
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
$('#tabs').innerHTML = TABS.map(([h, t, icon]) => `<a href="#${h}" aria-label="${t}"><span class="tab-icon">${icon}</span><span>${t}</span></a>`).join('');
$('#logout').onclick = () => supabase.auth.signOut();
window.addEventListener('hashchange', route);
let booted = null;
supabase.auth.onAuthStateChange((_ev, session) => {
  if (!session) { booted = null; showLogin(); return; }
  if (booted !== session.user.id) { booted = session.user.id; boot(session.user); }  // evita recargar en cada refresh de token
});
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY' && session) showNewPassword();
});
void today;
