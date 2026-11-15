import { supabase, $, esc } from '../supabase.js';
import { fmt, today, weekStart, paceStr, num, RUN_TYPE, DISC, confirmDialog, notify } from './common.js';
import { createRunningTracker, distanceBetween } from './running-tracker.js';

const DISCIPLINES = [{ v: 'running', t: 'Running' }, { v: 'cycling', t: 'Ciclismo' }, { v: 'swimming', t: 'Natación' }];

function routePreview(points) {
  if(!Array.isArray(points)||points.length<2)return '';
  const valid=points.filter(point=>Number.isFinite(Number(point.lat))&&Number.isFinite(Number(point.lon)));
  if(valid.length<2)return '';
  const lats=valid.map(point=>Number(point.lat)),lons=valid.map(point=>Number(point.lon));
  const minLat=Math.min(...lats),maxLat=Math.max(...lats),minLon=Math.min(...lons),maxLon=Math.max(...lons);
  const coords=valid.map(point=>`${8+(maxLon===minLon?0:(Number(point.lon)-minLon)/(maxLon-minLon)*304)},${112-(maxLat===minLat?0:(maxLat-Number(point.lat))/(maxLat-minLat)*104)}`).join(' ');
  return `<svg class="run-route run-route-preview" viewBox="0 0 320 120" role="img" aria-label="Recorrido GPS guardado"><polyline points="${coords}"/></svg>`;
}

export async function renderRunning(view, ctx, discipline = 'running') {
  if (!ctx.canRegister) {
    view.innerHTML = '<h1>Running</h1><div class="card warn">Tu membresía del mes aún no está aprobada. Cuando se apruebe podrás registrar actividades. <a href="#pago">Ir a Membresía</a></div>';
    return;
  }
  let { data: acts = [] } = await supabase.from('activities').select('*')
    .order('performed_on', { ascending: false }).order('created_at', { ascending: false });
  const tracker = discipline === 'running' ? createRunningTracker(ctx.user.id) : null;
  const sum = (arr) => arr.reduce((s, a) => s + Number(a.distance_km), 0);
  acts = acts.filter((a) => a.discipline === discipline);
  const runs = acts.filter((a) => a.discipline === 'running');
  const ws = weekStart();
  const ms = today().slice(0, 7);
  const week = (d) => sum(acts.filter((a) => a.discipline === d && a.performed_on >= ws));
  const month = (d) => sum(acts.filter((a) => a.discipline === d && a.performed_on.startsWith(ms)));

  // récords de running: tirada más larga y mejor ritmo (en salidas de ≥3 km)
  const longest = [...acts].sort((a, b) => b.distance_km - a.distance_km)[0];
  const fastest = runs.filter((a) => a.distance_km >= 3).sort((a, b) => a.duration_min / a.distance_km - b.duration_min / b.distance_km)[0];
  const totRunKm = sum(acts), totRunMin = acts.reduce((s, a) => s + Number(a.duration_min), 0);

  // km por semana, últimas 8 semanas (running)
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i * 7);
    const s = weekStart(d), e = new Date(s + 'T12:00:00'); e.setDate(e.getDate() + 7);
    const km = sum(acts.filter((a) => a.performed_on >= s && a.performed_on < e.toISOString().slice(0, 10)));
    weeks.push({ s: s.slice(5), km });
  }
  const maxKm = Math.max(1, ...weeks.map((w) => w.km));
  const pageStorageKey=`batmon_${discipline}_page`;
  let runningPage=localStorage.getItem(pageStorageKey)||'summary';

  const liveMarkup = tracker ? `<section class="card run-live" aria-labelledby="run-live-title"><div class="profile-section-head"><div><span class="muted">Seguimiento GPS en primer plano</span><h2 id="run-live-title">Carrera rápida</h2></div><span class="run-gps-state" id="run-gps-state">${tracker.state?.gps_status || 'Preparada'}</span></div><div class="run-live-stats"><div><b id="run-live-time">00:00:00</b><span>Tiempo</span></div><div><b id="run-live-distance">${fmt(tracker.distanceKm(),2)} km</b><span>Distancia</span></div><div><b id="run-live-current-pace">—</b><span>Ritmo actual</span></div><div><b id="run-live-pace">—</b><span>Ritmo medio</span></div></div><svg class="run-route" id="run-route" viewBox="0 0 320 120" role="img" aria-label="Recorrido GPS registrado"><polyline points=""/></svg><p class="muted">Mantén esta pestaña abierta durante la carrera. El GPS requiere HTTPS y permiso de ubicación; el navegador puede suspenderlo en segundo plano.</p><div class="quick-actions" id="run-live-actions">${tracker.state?.status==='running'?'<button class="btn ghost" id="run-pause" type="button">Pausar</button><button class="btn" id="run-finish" type="button">Finalizar carrera</button>':tracker.state?.status==='paused'?'<button class="btn" id="run-resume" type="button">Reanudar</button><button class="btn ghost" id="run-finish" type="button">Finalizar carrera</button><button class="link" id="run-discard" type="button">Descartar</button>':'<button class="btn" id="run-start" type="button">Iniciar carrera</button>'}</div><p class="msg" id="run-live-msg" aria-live="polite"></p></section>` : '';
  view.innerHTML = `
    <h1>${DISC[discipline]}</h1>
    <div class="tabs sub running-pages" aria-label="Secciones de ${DISC[discipline]}"><button data-running-page="summary">Resumen</button><button data-running-page="start">${tracker?.state?.status==='running'?'En curso':'Iniciar'}</button><button data-running-page="history">Historial (${acts.length})</button></div>
    <section data-running-content="summary">
    <div class="grid"><div class="card stat"><b>${fmt(week(discipline))} km</b><span>${DISC[discipline]} · semana</span></div><div class="card stat"><b>${fmt(month(discipline))} km</b><span>${DISC[discipline]} · mes</span></div></div>
    <div class="card"><span class="muted">${discipline==='running'?'Récords running':`Resumen de ${DISC[discipline]}`}</span><br>
      Mayor distancia: ${longest ? `<b>${fmt(longest.distance_km)} km</b> (${longest.performed_on})` : '—'}<br>
      ${discipline==='running'?`Mejor ritmo (≥3 km): ${fastest ? `<b>${paceStr(fastest.distance_km, fastest.duration_min)}</b> en ${fmt(fastest.distance_km)} km (${fastest.performed_on})` : '—'}<br>Ritmo medio total: <b>${paceStr(totRunKm, totRunMin)}</b>`:discipline==='swimming'?`Ritmo promedio: <b>${totRunKm?fmt(totRunMin/(totRunKm*10),2):'—'}</b> min/100 m`:`Velocidad media: <b>${fmt(totRunMin?totRunKm/totRunMin*60:0,1)} km/h</b>`} · ${fmt(totRunKm)} km en ${acts.length} registros</div>
    <div class="card"><span class="muted">Km por semana (${DISC[discipline]})</span>
      <div class="bars">${weeks.map((w) => `<div class="week-bar"><i style="height:${Math.round((w.km / maxKm) * 100)}%"></i><small>${fmt(w.km, 0)}</small><em>${w.s}</em></div>`).join('')}</div></div>
    <button class="btn" type="button" id="go-start">Registrar actividad</button></section>

    <section data-running-content="start" hidden>${liveMarkup}
    <h2 id="ftitle">Registrar salida</h2>
    <form id="af" class="card">
      <input type="hidden" id="eid">
      <div class="row"><div><label for="d">Disciplina</label><select id="d">${DISCIPLINES.filter((d) => d.v === discipline).map((d) => `<option value="${d.v}">${d.t}</option>`).join('')}</select></div>
      <div><label for="f">Fecha</label><input id="f" type="date" value="${today()}" max="${today()}" required></div></div>
      <div class="row"><div><label for="k">Distancia (km)</label><input id="k" type="number" step="0.01" min="0.01" inputmode="decimal" required></div>
      <div><label for="m">Duración (min)</label><input id="m" type="number" step="0.1" min="0.1" inputmode="decimal" required></div></div>
      ${discipline==='running'?`<div class="row3"><div><label for="t">Tipo</label><select id="t"><option value="">—</option>${Object.entries(RUN_TYPE).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>
      <div><label for="el">Desnivel + (m)</label><input id="el" type="number" min="0" inputmode="numeric"></div>
      <div><label for="rp">Esfuerzo (1-10)</label><input id="rp" type="number" min="1" max="10" inputmode="numeric"></div></div>`:''}
      <label for="n">Notas</label><input id="n" type="text" maxlength="300">
      <p class="muted" id="pv"></p>
      <button class="btn" type="submit" id="sv">Guardar</button> <button class="btn ghost" type="button" id="cn" hidden>Cancelar edición</button><p class="msg" id="am"></p>
    </form></section>

    <section data-running-content="history" hidden><h2>Historial · ${DISC[discipline]}</h2>
    <div class="activity-list">${acts.length ? acts.slice(0, 80).map((a) => `<article class="card activity-card"><div><b>${DISC[a.discipline]}${a.run_type ? ` · ${RUN_TYPE[a.run_type]}` : ''}</b><span>${a.performed_on}</span></div><strong>${fmt(a.distance_km)} km</strong><p>${fmt(a.duration_min)} min · ${a.discipline === 'running' ? paceStr(a.distance_km, a.duration_min) : a.discipline === 'swimming' ? `${fmt(a.duration_min / (a.distance_km * 10), 2)} min/100 m` : fmt((a.distance_km / a.duration_min) * 60) + ' km/h'}</p>${a.tracking_source==='gps'?routePreview(a.route_points):''}<div class="activity-actions"><button class="btn sm ghost" data-edit="${a.id}">Editar</button><button class="btn sm ghost" data-del="${a.id}">Borrar</button></div></article>`).join('') : '<p class="card muted">Aún no registras salidas. Tu historial aparecerá aquí.</p>'}</div></section>`;

  const selectPage=(name)=>{runningPage=name;localStorage.setItem(pageStorageKey,name);view.querySelectorAll('[data-running-content]').forEach(s=>s.hidden=s.dataset.runningContent!==name);view.querySelectorAll('[data-running-page]').forEach(b=>b.classList.toggle('on',b.dataset.runningPage===name));};
  view.querySelectorAll('[data-running-page]').forEach(b=>b.onclick=()=>selectPage(b.dataset.runningPage));
  $('#go-start').onclick=()=>selectPage('start');
  selectPage(tracker?.state&&['running','paused'].includes(tracker.state.status)?'start':runningPage);

  const live = () => { const k = +$('#k').value, m = +$('#m').value, d = $('#d').value; $('#pv').textContent = k > 0 && m > 0 ? (d === 'running' ? `Ritmo: ${paceStr(k, m)}` : d === 'swimming' ? `Ritmo: ${fmt(m / (k * 10), 2)} min/100 m` : `Velocidad: ${fmt((k / m) * 60)} km/h`) : ''; };
  $('#k').oninput = live; $('#m').oninput = live;
  $('#d').onchange = live;

  if(tracker){
    const paint=()=>{if(!tracker.state||!$('#run-live-time'))return;const seconds=tracker.elapsedSeconds(),distance=tracker.distanceKm(),pts=tracker.state.points||[];$('#run-live-time').textContent=`${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds%3600/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;$('#run-live-distance').textContent=`${fmt(distance,2)} km`;$('#run-live-pace').textContent=distance>0?paceStr(distance,seconds/60):'—';const end=pts.at(-1),start=pts[Math.max(0,pts.length-4)],segmentKm=end&&start?(distanceBetween(start,end)/1000):0,segmentMin=end&&start?Math.max(0,(end.at-start.at)/60000):0;$('#run-live-current-pace').textContent=segmentKm>0&&segmentMin>0?paceStr(segmentKm,segmentMin):'—';$('#run-gps-state').textContent=tracker.state.gps_status;if(pts.length>1){const lats=pts.map(p=>p.lat),lons=pts.map(p=>p.lon),minLat=Math.min(...lats),maxLat=Math.max(...lats),minLon=Math.min(...lons),maxLon=Math.max(...lons);const coords=pts.map(p=>`${8+(maxLon===minLon?0:(p.lon-minLon)/(maxLon-minLon)*304)},${112-(maxLat===minLat?0:(p.lat-minLat)/(maxLat-minLat)*104)}`).join(' ');$('#run-route polyline').setAttribute('points',coords);}};
    tracker.restore(paint,(message)=>{const msg=$('#run-live-msg');if(msg)msg.textContent=message;});
    if(!tracker.state&&navigator.permissions?.query)navigator.permissions.query({name:'geolocation'}).then(permission=>{const gps=$('#run-gps-state');if(!gps||tracker.state)return;const show=()=>{gps.textContent=permission.state==='granted'?'Permiso concedido · GPS listo':permission.state==='denied'?'Ubicación bloqueada en el navegador':'Se pedirá permiso al iniciar';};show();permission.onchange=show;}).catch(()=>{});
    const rebindActions=()=>{const start=$('#run-start');if(start)start.onclick=()=>{const ok=tracker.start(paint,(message)=>{const msg=$('#run-live-msg');if(msg)msg.textContent=message;});if(ok)renderRunning(view,ctx,'running');};const pause=$('#run-pause');if(pause)pause.onclick=()=>{tracker.pause();renderRunning(view,ctx,'running');};const resume=$('#run-resume');if(resume)resume.onclick=()=>{tracker.resume(paint,(message)=>{const msg=$('#run-live-msg');if(msg)msg.textContent=message;});renderRunning(view,ctx,'running');};const discard=$('#run-discard');if(discard)discard.onclick=async()=>{if(await confirmDialog('¿Descartar la carrera sin guardarla?','Descartar carrera')){tracker.discard();renderRunning(view,ctx,'running');}};const finish=$('#run-finish');if(finish)finish.onclick=async()=>{if(!(await confirmDialog('¿Finalizar y guardar esta carrera?','Finalizar carrera')))return;if(tracker.distanceKm()<0.01){$('#run-live-msg').textContent='Registra al menos 10 metros de GPS antes de guardar.';return;}const result=tracker.finish();if(!result)return;const {error}=await supabase.from('activities').insert({discipline:'running',performed_on:today(),distance_km:Number(result.distance_km.toFixed(2)),duration_min:Number(result.duration_min.toFixed(1)),notes:'Carrera GPS',route_points:result.route_points,tracking_source:'gps'});if(error){tracker.reopenAfterSaveError();notify(`No se guardó la carrera; quedó pausada para reintentar. ${error.message}`);renderRunning(view,ctx,'running');return;}tracker.discard();notify('Carrera guardada.','success');renderRunning(view,ctx,'running');};};
    rebindActions();paint();
  }

  $('#af').onsubmit = async (e) => {
    e.preventDefault();
    const row = { discipline: $('#d').value, performed_on: $('#f').value, distance_km: +$('#k').value, duration_min: +$('#m').value,
      run_type: discipline==='running'?($('#t').value||null):null, elevation_m: discipline==='running'?num($('#el').value):null, rpe: discipline==='running'?num($('#rp').value):null, notes: $('#n').value.trim() || null };
    const id = $('#eid').value;
    const { error } = id ? await supabase.from('activities').update(row).eq('id', id) : await supabase.from('activities').insert(row);
    if (error) $('#am').textContent = 'No se pudo guardar: ' + error.message; else renderRunning(view, ctx, discipline);
  };
  $('#cn').onclick = () => renderRunning(view, ctx, discipline);
  view.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog('¿Borrar este registro?', 'Borrar'))) return;
    const { error } = await supabase.from('activities').delete().eq('id', b.dataset.del);
    if (error) notify(error.message); else renderRunning(view, ctx, discipline);
  }));
  view.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => {
    const a = acts.find((x) => x.id === b.dataset.edit);
    $('#eid').value = a.id; $('#d').value = a.discipline; $('#f').value = a.performed_on; $('#k').value = a.distance_km; $('#m').value = a.duration_min;
    if(discipline==='running'){$('#t').value = a.run_type || ''; $('#el').value = a.elevation_m ?? ''; $('#rp').value = a.rpe ?? '';} $('#n').value = a.notes || '';
    $('#ftitle').textContent = 'Editar salida'; $('#sv').textContent = 'Guardar cambios'; $('#cn').hidden = false; live(); selectPage('start');
    $('#ftitle').scrollIntoView({ behavior: 'smooth' });
  }));
  void esc;
}
