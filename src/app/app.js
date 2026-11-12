import './app.css';
import { supabase, $, esc, getProfile } from '../supabase.js';

// Para activar natación: agregar { v: 'swimming', t: 'Natación' } aquí (el enum de la BD ya lo tiene).
const DISCIPLINES = [
  { v: 'running', t: 'Running' },
  { v: 'cycling', t: 'Ciclismo' },
];
const NAME = Object.fromEntries([...DISCIPLINES, { v: 'swimming', t: 'Natación' }].map((d) => [d.v, d.t]));
const STATUS = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' };
const view = $('#view');
const fmt = (n) => (Math.round(n * 10) / 10).toLocaleString('es-BO');
const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const pace = (km, min) => { const p = min / km; return `${Math.floor(p)}:${String(Math.round((p % 1) * 60)).padStart(2, '0')} /km`; };
const weekStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

/* ---------------- Login ---------------- */
function showLogin(signup = false) {
  $('#logout').hidden = true; $('#admin-link').hidden = true;
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

/* ---------------- Dashboard ---------------- */
async function showApp(user) {
  const profile = await getProfile(user.id);
  $('#logout').hidden = false;
  $('#admin-link').hidden = profile?.role !== 'admin';

  const [{ data: acts = [] }, { data: mems = [] }] = await Promise.all([
    supabase.from('activities').select('*').order('performed_on', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('memberships').select('*').order('period', { ascending: false }),
  ]);

  const ws = weekStart();
  const weekKm = {};
  DISCIPLINES.forEach((d) => (weekKm[d.v] = 0));
  acts.filter((a) => a.performed_on >= ws).forEach((a) => (weekKm[a.discipline] = (weekKm[a.discipline] || 0) + Number(a.distance_km)));
  const best = (disc) => acts.filter((a) => a.discipline === disc).sort((a, b) => b.distance_km - a.distance_km)[0];
  const last = acts[0];
  const total = acts.reduce((s, a) => s + Number(a.distance_km), 0);
  const cur = mems.find((m) => m.period === monthStart());

  view.innerHTML = `
    <h1>Hola, ${esc(profile?.full_name || '')}</h1><p class="muted">Tu progreso en el Crowd</p>

    <h2>Resumen</h2>
    <div class="grid">
      <div class="card stat"><b>${fmt(weekKm.running)} km</b><span>Running · semana</span></div>
      <div class="card stat"><b>${fmt(weekKm.cycling)} km</b><span>Ciclismo · semana</span></div>
      <div class="card stat"><b>${fmt(total)} km</b><span>Total</span></div>
    </div>
    <div class="card"><span class="muted">Última actividad</span><br>${last ? `<b>${NAME[last.discipline]}</b> · ${fmt(last.distance_km)} km · ${fmt(last.duration_min)} min · ${last.performed_on}` : 'Aún no registras nada.'}</div>
    <div class="card"><span class="muted">Récords (distancia más larga)</span><br>
      ${DISCIPLINES.map((d) => { const b = best(d.v); return `${d.t}: ${b ? `<b>${fmt(b.distance_km)} km</b> (${b.performed_on})` : '—'}`; }).join('<br>')}</div>

    <h2>Registrar actividad</h2>
    <form id="af" class="card">
      <div class="row"><div><label for="d">Disciplina</label><select id="d">${DISCIPLINES.map((d) => `<option value="${d.v}">${d.t}</option>`).join('')}</select></div>
      <div><label for="f">Fecha</label><input id="f" type="date" value="${today()}" max="${today()}" required></div></div>
      <div class="row"><div><label for="k">Distancia (km)</label><input id="k" type="number" step="0.01" min="0.01" inputmode="decimal" required></div>
      <div><label for="m">Duración (min)</label><input id="m" type="number" step="0.1" min="0.1" inputmode="decimal" required></div></div>
      <button class="btn" type="submit">Guardar</button><p class="msg" id="am"></p>
    </form>

    <h2>Historial</h2>
    <div class="card">${acts.length ? `<table><tr><th>Fecha</th><th>Tipo</th><th>Km</th><th>Min</th><th>Ritmo</th><th></th></tr>
      ${acts.slice(0, 50).map((a) => `<tr><td>${a.performed_on}</td><td>${NAME[a.discipline]}</td><td>${fmt(a.distance_km)}</td><td>${fmt(a.duration_min)}</td>
      <td>${a.discipline === 'running' ? pace(a.distance_km, a.duration_min) : ''}</td><td><button class="link" data-del="${a.id}" aria-label="Borrar">✕</button></td></tr>`).join('')}</table>` : '<p class="muted">Sin registros.</p>'}</div>

    <h2>Membresía · 200 Bs/mes</h2>
    <div class="card" id="mem"></div>`;

  $('#af').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await supabase.from('activities').insert({
      discipline: $('#d').value, performed_on: $('#f').value,
      distance_km: +$('#k').value, duration_min: +$('#m').value,
    });
    if (error) $('#am').textContent = 'No se pudo guardar: ' + error.message; else showApp(user);
  };
  view.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (confirm('¿Borrar este registro?')) { await supabase.from('activities').delete().eq('id', b.dataset.del); showApp(user); }
  }));
  renderMembership(user, cur);
}

function renderMembership(user, cur) {
  const box = $('#mem');
  const status = cur ? `<p>Estado de este mes: <span class="pill ${cur.status}">${STATUS[cur.status]}</span></p>` : '<p class="muted">Aún no pagaste este mes.</p>';
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
    const path = `${user.id}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, '_')}`;
    const up = await supabase.storage.from('receipts').upload(path, file);
    if (up.error) { $('#pm').textContent = 'Error subiendo: ' + up.error.message; return; }
    const ins = await supabase.from('memberships').insert({ period: monthStart(), proof_path: path });
    if (ins.error) $('#pm').textContent = 'Error: ' + ins.error.message; else showApp(user);
  };
}

/* ---------------- Arranque: sesión persistente ---------------- */
$('#logout').onclick = () => supabase.auth.signOut();
supabase.auth.onAuthStateChange((_ev, session) => { session ? showApp(session.user) : showLogin(); });
