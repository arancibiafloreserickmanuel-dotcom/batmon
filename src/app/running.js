import { supabase, $, esc } from '../supabase.js';
import { fmt, today, weekStart, paceStr, num, RUN_TYPE, DISC, confirmDialog, notify } from './common.js';

const DISCIPLINES = [{ v: 'running', t: 'Running' }, { v: 'cycling', t: 'Ciclismo' }, { v: 'swimming', t: 'Natación' }];

export async function renderRunning(view, ctx) {
  if (!ctx.canRegister) {
    view.innerHTML = '<h1>Running</h1><div class="card warn">Tu membresía del mes aún no está aprobada. Cuando se apruebe podrás registrar actividades. <a href="#pago">Ir a Membresía</a></div>';
    return;
  }
  const { data: acts = [] } = await supabase.from('activities').select('*')
    .order('performed_on', { ascending: false }).order('created_at', { ascending: false });
  const sum = (arr) => arr.reduce((s, a) => s + Number(a.distance_km), 0);
  const runs = acts.filter((a) => a.discipline === 'running');
  const ws = weekStart();
  const ms = today().slice(0, 7);
  const week = (d) => sum(acts.filter((a) => a.discipline === d && a.performed_on >= ws));
  const month = (d) => sum(acts.filter((a) => a.discipline === d && a.performed_on.startsWith(ms)));

  // récords de running: tirada más larga y mejor ritmo (en salidas de ≥3 km)
  const longest = [...runs].sort((a, b) => b.distance_km - a.distance_km)[0];
  const fastest = runs.filter((a) => a.distance_km >= 3).sort((a, b) => a.duration_min / a.distance_km - b.duration_min / b.distance_km)[0];
  const totRunKm = sum(runs), totRunMin = runs.reduce((s, a) => s + Number(a.duration_min), 0);

  // km por semana, últimas 8 semanas (running)
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i * 7);
    const s = weekStart(d), e = new Date(s + 'T12:00:00'); e.setDate(e.getDate() + 7);
    const km = sum(runs.filter((a) => a.performed_on >= s && a.performed_on < e.toISOString().slice(0, 10)));
    weeks.push({ s: s.slice(5), km });
  }
  const maxKm = Math.max(1, ...weeks.map((w) => w.km));

  view.innerHTML = `
    <h1>Running &amp; Ciclismo</h1>
    <div class="grid">
      <div class="card stat"><b>${fmt(week('running'))} km</b><span>Running · semana</span></div>
      <div class="card stat"><b>${fmt(month('running'))} km</b><span>Running · mes</span></div>
      <div class="card stat"><b>${fmt(week('cycling'))} km</b><span>Ciclismo · semana</span></div>
    </div>
    <div class="card"><span class="muted">Récords running</span><br>
      Más larga: ${longest ? `<b>${fmt(longest.distance_km)} km</b> (${longest.performed_on})` : '—'}<br>
      Mejor ritmo (≥3 km): ${fastest ? `<b>${paceStr(fastest.distance_km, fastest.duration_min)}</b> en ${fmt(fastest.distance_km)} km (${fastest.performed_on})` : '—'}<br>
      Ritmo medio total: <b>${paceStr(totRunKm, totRunMin)}</b> · ${fmt(totRunKm)} km en ${runs.length} salidas</div>
    <div class="card"><span class="muted">Km por semana (running)</span>
      <div class="bars">${weeks.map((w) => `<div class="week-bar"><i style="height:${Math.round((w.km / maxKm) * 100)}%"></i><small>${fmt(w.km, 0)}</small><em>${w.s}</em></div>`).join('')}</div></div>

    <h2 id="ftitle">Registrar salida</h2>
    <form id="af" class="card">
      <input type="hidden" id="eid">
      <div class="row"><div><label for="d">Disciplina</label><select id="d">${DISCIPLINES.map((d) => `<option value="${d.v}">${d.t}</option>`).join('')}</select></div>
      <div><label for="f">Fecha</label><input id="f" type="date" value="${today()}" max="${today()}" required></div></div>
      <div class="row"><div><label for="k">Distancia (km)</label><input id="k" type="number" step="0.01" min="0.01" inputmode="decimal" required></div>
      <div><label for="m">Duración (min)</label><input id="m" type="number" step="0.1" min="0.1" inputmode="decimal" required></div></div>
      <div class="row3"><div><label for="t">Tipo</label><select id="t"><option value="">—</option>${Object.entries(RUN_TYPE).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>
      <div><label for="el">Desnivel + (m)</label><input id="el" type="number" min="0" inputmode="numeric"></div>
      <div><label for="rp">Esfuerzo (1-10)</label><input id="rp" type="number" min="1" max="10" inputmode="numeric"></div></div>
      <label for="n">Notas</label><input id="n" type="text" maxlength="300">
      <p class="muted" id="pv"></p>
      <button class="btn" type="submit" id="sv">Guardar</button> <button class="btn ghost" type="button" id="cn" hidden>Cancelar edición</button><p class="msg" id="am"></p>
    </form>

    <h2>Historial</h2>
    <div class="activity-list">${acts.length ? acts.slice(0, 80).map((a) => `<article class="card activity-card"><div><b>${DISC[a.discipline]}${a.run_type ? ` · ${RUN_TYPE[a.run_type]}` : ''}</b><span>${a.performed_on}</span></div><strong>${fmt(a.distance_km)} km</strong><p>${fmt(a.duration_min)} min · ${a.discipline === 'running' ? paceStr(a.distance_km, a.duration_min) : a.discipline === 'swimming' ? `${fmt(a.duration_min / (a.distance_km * 10), 2)} min/100 m` : fmt((a.distance_km / a.duration_min) * 60) + ' km/h'}</p><div class="activity-actions"><button class="btn sm ghost" data-edit="${a.id}">Editar</button><button class="btn sm ghost" data-del="${a.id}">Borrar</button></div></article>`).join('') : '<p class="card muted">Aún no registras salidas. Tu historial aparecerá aquí.</p>'}</div>`;

  const live = () => { const k = +$('#k').value, m = +$('#m').value, d = $('#d').value; $('#pv').textContent = k > 0 && m > 0 ? (d === 'running' ? `Ritmo: ${paceStr(k, m)}` : d === 'swimming' ? `Ritmo: ${fmt(m / (k * 10), 2)} min/100 m` : `Velocidad: ${fmt((k / m) * 60)} km/h`) : ''; };
  $('#k').oninput = live; $('#m').oninput = live;
  $('#d').onchange = live;

  $('#af').onsubmit = async (e) => {
    e.preventDefault();
    const row = { discipline: $('#d').value, performed_on: $('#f').value, distance_km: +$('#k').value, duration_min: +$('#m').value,
      run_type: $('#t').value || null, elevation_m: num($('#el').value), rpe: num($('#rp').value), notes: $('#n').value.trim() || null };
    const id = $('#eid').value;
    const { error } = id ? await supabase.from('activities').update(row).eq('id', id) : await supabase.from('activities').insert(row);
    if (error) $('#am').textContent = 'No se pudo guardar: ' + error.message; else renderRunning(view, ctx);
  };
  $('#cn').onclick = () => renderRunning(view, ctx);
  view.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog('¿Borrar este registro?', 'Borrar'))) return;
    const { error } = await supabase.from('activities').delete().eq('id', b.dataset.del);
    if (error) notify(error.message); else renderRunning(view, ctx);
  }));
  view.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => {
    const a = acts.find((x) => x.id === b.dataset.edit);
    $('#eid').value = a.id; $('#d').value = a.discipline; $('#f').value = a.performed_on; $('#k').value = a.distance_km; $('#m').value = a.duration_min;
    $('#t').value = a.run_type || ''; $('#el').value = a.elevation_m ?? ''; $('#rp').value = a.rpe ?? ''; $('#n').value = a.notes || '';
    $('#ftitle').textContent = 'Editar salida'; $('#sv').textContent = 'Guardar cambios'; $('#cn').hidden = false; live();
    $('#ftitle').scrollIntoView({ behavior: 'smooth' });
  }));
  void esc;
}
