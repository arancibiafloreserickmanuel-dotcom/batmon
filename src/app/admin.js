import './app.css';
import { supabase, $, esc, getProfile } from '../supabase.js';

const view = $('#view');

async function load() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { location.href = '/app.html'; return; }
  const me = await getProfile(session.user.id);
  if (me?.role !== 'admin') { view.innerHTML = '<h1>Sin acceso</h1><p class="muted">Esta sección es solo para administradores.</p>'; return; }

  const [{ data: mems = [] }, { data: profs = [] }] = await Promise.all([
    supabase.from('memberships').select('*').order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, full_name'),
  ]);
  const name = Object.fromEntries(profs.map((p) => [p.id, p.full_name]));
  const pending = mems.filter((m) => m.status === 'pending');
  const rest = mems.filter((m) => m.status !== 'pending');

  // URLs firmadas (1h) para ver los comprobantes del bucket privado
  const urls = {};
  await Promise.all(mems.filter((m) => m.proof_path).map(async (m) => {
    const { data } = await supabase.storage.from('receipts').createSignedUrl(m.proof_path, 3600);
    urls[m.id] = data?.signedUrl;
  }));

  const row = (m, actions) => `<tr><td>${esc(name[m.user_id] || m.user_id.slice(0, 8))}</td><td>${m.period.slice(0, 7)}</td>
    <td>${urls[m.id] ? `<a href="${urls[m.id]}" target="_blank" rel="noopener">Ver</a>` : '—'}</td><td>${actions}</td></tr>`;

  view.innerHTML = `<h1>Pagos</h1>
    <h2>Pendientes (${pending.length})</h2>
    <div class="card">${pending.length ? `<table><tr><th>Socio</th><th>Mes</th><th>Comprobante</th><th></th></tr>
      ${pending.map((m) => row(m, `<button class="btn sm" data-a="approved" data-id="${m.id}">Aprobar</button><button class="btn sm ghost" data-a="rejected" data-id="${m.id}">Rechazar</button>`)).join('')}</table>` : '<p class="muted">Nada pendiente.</p>'}</div>
    <h2>Historial</h2>
    <div class="card">${rest.length ? `<table><tr><th>Socio</th><th>Mes</th><th>Comprobante</th><th>Estado</th></tr>
      ${rest.map((m) => row(m, `<span class="pill ${m.status}">${m.status === 'approved' ? 'Aprobado' : 'Rechazado'}</span>`)).join('')}</table>` : '<p class="muted">Sin historial.</p>'}</div>`;

  view.querySelectorAll('[data-a]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    const status = b.dataset.a;
    const { error } = await supabase.from('memberships').update({
      status, approved_at: status === 'approved' ? new Date().toISOString() : null, approved_by: session.user.id,
    }).eq('id', b.dataset.id);
    if (error) alert(error.message); else load();
  }));
}
load();
