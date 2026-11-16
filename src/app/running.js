import { supabase, $, esc } from '../supabase.js';

import { fmt, today, paceStr, num, RUN_TYPE, DISC, confirmDialog, notify } from './common.js';

import { createRunningTracker, distanceBetween } from './running-tracker.js';



const RUN_TYPES = Object.entries(RUN_TYPE);

const PER_PAGE = 25;

const preferenceKey = (id) => `batmon_running_preferences_${id}`;

const byDate = (a, b) => String(b.performed_on).localeCompare(String(a.performed_on)) || String(b.created_at).localeCompare(String(a.created_at));

const kmPace = (km, min) => Number(km) > 0 && Number(min) > 0 ? paceStr(Number(km), Number(min)) : '—';

const localDate = (timestamp) => { const d=new Date(timestamp); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

const durationLabel = (sec) => `${Math.floor(sec / 3600)}:${String(Math.floor(sec % 3600 / 60)).padStart(2,'0')}:${String(Math.floor(sec % 60)).padStart(2,'0')}`;

const durationOf = (activity) => Number(activity.duration_seconds) || Math.round(Number(activity.duration_min || 0) * 60);



function readPreferences(userId) {

  try { return { unit: 'km', announce: true, ...(JSON.parse(localStorage.getItem(preferenceKey(userId))) || {}) }; }

  catch { return { unit: 'km', announce: true }; }

}

function savePreferences(userId, prefs) { localStorage.setItem(preferenceKey(userId), JSON.stringify(prefs)); }

function manualPace(row) { return kmPace(row.distance_km, durationOf(row)/60); }

function routeSegments(activity) {

  if (Array.isArray(activity?.route_segments) && activity.route_segments.length) return activity.route_segments;

  if (Array.isArray(activity?.route_points) && activity.route_points.length) return [activity.route_points];

  return [];

}

function routeThumbnail(activity) {
  const segments=routeSegments(activity).map((segment)=>segment.filter((p)=>Number.isFinite(+p.lat)&&Number.isFinite(+p.lon))).filter((s)=>s.length);
  const points=segments.flat();if(!points.length)return '';
  const minLat=Math.min(...points.map(p=>+p.lat)),maxLat=Math.max(...points.map(p=>+p.lat)),minLon=Math.min(...points.map(p=>+p.lon)),maxLon=Math.max(...points.map(p=>+p.lon));
  const xRange=maxLon-minLon||1e-6,yRange=maxLat-minLat||1e-6;
  const paths=segments.map((segment)=>segment.map((p,i)=>`${i?'L':'M'} ${(5+(+p.lon-minLon)/xRange*62).toFixed(1)} ${(35-(+p.lat-minLat)/yRange*30).toFixed(1)}`).join(' '));
  return `<svg class="run-history-route" viewBox="0 0 72 40" aria-label="Vista previa del recorrido GPS" role="img">${paths.map(d=>`<path d="${d}"/>`).join('')}</svg>`;
}

async function uploadRunPhotos(userId, files, existing = []) {

  const selected = Array.from(files || []);

  if (!selected.length) return existing || [];

  if (selected.length + (existing?.length || 0) > 3) throw new Error('Cada actividad permite hasta 3 fotografías.');

  const uploaded = [];

  for (const file of selected) {

    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Usa imágenes JPG, PNG o WebP.');

    if (file.size > 8 * 1024 * 1024) throw new Error('Cada fotografía debe pesar menos de 8 MB.');

    const ext = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'') || 'jpg';

    const path = `${userId}/running/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage.from('profile-media').upload(path,file,{contentType:file.type,upsert:false});

    if (error) { if (uploaded.length) await supabase.storage.from('profile-media').remove(uploaded); throw new Error(`No se pudieron subir las fotos: ${error.message}`); }

    uploaded.push(path);

  }

  return [...(existing || []), ...uploaded];

}

function splitRuns(points) {

  const segments = Array.isArray(points?.[0]) ? points : [points || []];

  const splits = []; let distance = 0, seconds = 0, lapDistance = 0, lapSeconds = 0, index = 1;

  for (const seg of segments) for (let i = 1; i < seg.length; i++) {

    const a = seg[i - 1], b = seg[i], step = distanceBetween(a,b);

    const elapsed = Math.max(0, (b.at-a.at)/1000);

    if (!Number.isFinite(step) || !Number.isFinite(elapsed) || step < 2 || step > 250 || elapsed <= 0) continue;

    let remain = step, timeRemain = elapsed;

    while (remain > 0) {

      const target = 1000 - lapDistance, part = Math.min(remain, target), partTime = elapsed * part / step;

      distance += part; seconds += partTime; lapDistance += part; lapSeconds += partTime; remain -= part; timeRemain -= partTime;

      if (lapDistance >= 999.99) { splits.push({ km: index++, distance_m: 1000, seconds: lapSeconds }); lapDistance = 0; lapSeconds = 0; }

    }

  }

  if (lapDistance >= 80) splits.push({ km: 'Final', distance_m: lapDistance, seconds: lapSeconds });

  return { splits, distance_m: distance, moving_sec: seconds };

}



async function mountMap(el, segments, { center = null, locate = null } = {}) {

  if (!el) return { map: null, recenter() {} };

  el.innerHTML = '<div class="run-map__loading">Cargando mapa…</div>';

  try {

    const [{ default: L }] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);

    if (!el.isConnected) return { map: null, recenter() {} };

    el.innerHTML = '';

    const first = segments.flat().find((p) => Number.isFinite(+p.lat) && Number.isFinite(+p.lon));

    const startAt = center || (first ? [+first.lat, +first.lon] : [-19.0196, -65.2619]);

    const map = L.map(el, { zoomControl: false, attributionControl: true, scrollWheelZoom: true }).setView(startAt, first || center ? 16 : 13);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>' }).addTo(map);

    L.control.zoom({ position: 'topright' }).addTo(map);

    map.on('tileerror', () => { const msg = el.parentElement?.querySelector('.run-map__error'); if (msg) msg.hidden = false; });

    const routeLayer=L.featureGroup().addTo(map);

    const drawSegments=(allSegments)=>{routeLayer.clearLayers();const valid=allSegments.filter((s)=>s.length).map((s)=>s.map((p)=>[+p.lat,+p.lon]).filter((p)=>p.every(Number.isFinite))).filter((s)=>s.length);valid.forEach((latlngs)=>{if(latlngs.length>1)L.polyline(latlngs,{color:getComputedStyle(document.body).getPropertyValue('--ink').trim()||'#151515',weight:5,opacity:.9,lineCap:'round'}).addTo(routeLayer);});if(valid.length){L.circleMarker(valid[0][0],{radius:7,color:'#fff',weight:3,fillColor:'#24553a',fillOpacity:1}).bindTooltip('Inicio').addTo(routeLayer);const last=valid.at(-1);if(last.length>1)L.circleMarker(last.at(-1),{radius:7,color:'#fff',weight:3,fillColor:'#171717',fillOpacity:1}).bindTooltip('Última posición').addTo(routeLayer);}};

    drawSegments(segments);

    const routePoints = segments.flat();

    if (routePoints.length) {

      if (!center && routePoints.length > 1) map.fitBounds(L.latLngBounds(routePoints.map((p) => [p.lat,p.lon])), { padding: [36,36], maxZoom: 16 });

    }

    if (locate) {

      navigator.geolocation?.getCurrentPosition((p) => { if (!map.getContainer().isConnected) return; const position=[p.coords.latitude,p.coords.longitude]; const marker=L.circleMarker(position,{radius:8,color:'#fff',weight:3,fillColor:'#24553a',fillOpacity:1}).bindTooltip('Tu ubicación').addTo(map); if (!routePoints.length) map.setView(position,16); marker.bringToFront(); }, () => {}, { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 });

    }

    requestAnimationFrame(() => map.invalidateSize());

    return { map, update:drawSegments, recenter: () => { const latest=routeLayer.getBounds();if(latest.isValid())map.fitBounds(latest,{padding:[36,36],maxZoom:16});else {const point=segments.flat().at(-1);if(point)map.setView([point.lat,point.lon],16);else if(center)map.setView(center,16);} } };

  } catch (error) {

    el.innerHTML = `<div class="run-map__fallback"><b>No se pudo cargar el mapa</b><span>El GPS y la actividad siguen disponibles. Revisa tu conexión.</span><small>${esc(error.message)}</small></div>`;

    return { map: null, recenter() {} };

  }

}



function addPageNav(view, selected, active) {

  view.querySelectorAll('[data-run-page]').forEach((button) => {

    button.classList.toggle('on', button.dataset.runPage === selected);

    button.onclick = () => active(button.dataset.runPage);

  });

}



async function renderRun(view, ctx) {

  const userId = ctx.user.id, tracker = createRunningTracker(userId), prefs = readPreferences(userId);

  let { data: activities = [], error } = await supabase.from('activities').select('*').eq('discipline','running').order('performed_on',{ascending:false}).order('created_at',{ascending:false});

  if (error) activities = [];

  const savedPage = localStorage.getItem(`batmon_running_page_${userId}`);

  let page = tracker.state?.status === 'finished' ? 'review' : tracker.state?.status === 'running' || tracker.state?.status === 'paused' ? 'run' : (['run','progress','history'].includes(savedPage) ? savedPage : 'run');

  let historyCount = PER_PAGE, historyFilter = 'all', historyPeriod = 'all', sortAsc = false, period = 'week', selectedWeek = '';

  let mapController = null, saving = false;

  const setPage = (next) => { page = next; localStorage.setItem(`batmon_running_page_${userId}`, next); render(); };

  const summary = (periodKey) => {

    const now = new Date(); let start = '';

    if (periodKey === 'week') { const monday = new Date(now); monday.setHours(12,0,0,0); monday.setDate(now.getDate() - ((now.getDay()+6)%7)); start = localDate(monday); }

    if (periodKey === 'month') start = `${today().slice(0,7)}-01`;

    return activities.filter((a) => !start || a.performed_on >= start);

  };

  const render = () => {

    const active = tracker.state && ['running','paused','finished'].includes(tracker.state.status);

    const title = page === 'run' ? (active ? 'Carrera en curso' : 'Correr') : page === 'progress' ? 'Progreso' : page === 'history' ? 'Historial' : 'Revisar carrera';

    view.innerHTML = `<section class="run-module"><header class="run-module__head"><div><p class="run-kicker">RUNNING · BATMON CROWD</p><h1>${title}</h1></div>${active ? `<span class="run-state run-state--${tracker.state.status}">${tracker.state.status === 'paused' ? 'Pausada' : tracker.state.status === 'finished' ? 'Por guardar' : 'En curso'}</span>` : ''}</header>

      ${page !== 'review' ? `<nav class="tabs sub running-pages" aria-label="Secciones de Running"><button data-run-page="run">${active ? 'En curso' : 'Correr'}</button><button data-run-page="progress">Progreso</button><button data-run-page="history">Historial</button></nav>` : ''}

      ${error?`<p class="msg" role="status">No se pudo cargar el historial: ${esc(error.message)}</p>`:''}<div id="run-page-content"></div></section>`;

    const content = $('#run-page-content',view);

    addPageNav(view,page,(next)=>setPage(next));

    if (page === 'run') renderRunScreen(content);

    if (page === 'progress') renderProgress(content);

    if (page === 'history') renderHistory(content);

    if (page === 'review') renderReview(content);

  };



  function renderRunScreen(box) {

    const state = tracker.state;

    box.innerHTML = `<div class="run-live-layout"><div class="run-map-wrap"><div id="run-map-live" class="run-map" role="application" aria-label="Mapa de ubicación y recorrido"></div><div class="run-map__tools"><span id="run-gps-status" class="run-gps-state">${esc(state?.gps_status || 'Ubicación lista al iniciar')}</span><button type="button" class="run-map__locate" id="run-center" aria-label="Centrar mapa">◎</button></div><p class="run-map__error" hidden>No se pudieron cargar los mosaicos del mapa. Intenta de nuevo con conexión.</p></div>

      ${state ? `<section class="card run-live run-live--active"><div class="run-live__top"><span class="run-live__label">${state.status==='paused'?'ACTIVIDAD PAUSADA':'SEGUIMIENTO GPS'}</span><span class="run-gps-precision" id="run-accuracy"></span></div><div class="run-live-stats"><div class="run-live-stat run-live-stat--primary"><b id="run-live-distance">${fmt(tracker.distanceKm(),2)}</b><span>km</span></div><div class="run-live-stat"><b id="run-live-time">${durationLabel(tracker.elapsedSeconds())}</b><span>Tiempo total</span></div><div class="run-live-stat"><b id="run-live-moving">${durationLabel(tracker.elapsedSeconds())}</b><span>En movimiento*</span></div><div class="run-live-stat"><b id="run-live-pace">${kmPace(tracker.distanceKm(),tracker.elapsedSeconds()/60)}</b><span>Ritmo medio</span></div><div class="run-live-stat"><b id="run-live-current-pace">—</b><span>Ritmo actual</span></div></div>${renderGoalProgress(state)}<p class="run-note">* El tiempo en movimiento se estima con puntos GPS válidos. Mantén esta pestaña visible: el navegador puede suspender el GPS en segundo plano.</p><div class="run-actions">${state.status==='running'?'<button class="btn ghost" id="run-pause" type="button">Pausar</button>':''}${state.status==='paused'?'<button class="btn" id="run-resume" type="button">Reanudar</button>':''}<button class="btn" id="run-finish" type="button">Finalizar y revisar</button><button class="link run-discard" id="run-discard" type="button">Descartar</button></div><p class="msg" id="run-live-msg" aria-live="polite"></p></section>` : `<section class="card run-prep"><div class="run-prep__top"><div><span class="run-live__label">PREPARA TU SALIDA</span><p>Una carrera libre comienza con un toque.</p></div><label class="run-setting-inline">Objetivo<select id="run-goal-type"><option value="none">Libre</option><option value="distance">Distancia</option><option value="duration">Duración</option></select></label></div><div id="run-goal-fields" class="run-goal-fields" hidden></div><div class="run-prep__actions"><button class="btn" id="run-start" type="button">Iniciar carrera</button><button class="btn ghost" id="run-manual-open" type="button">Registrar manualmente</button><button class="link" id="run-settings-open" type="button" aria-expanded="false">Ajustes</button></div><div id="run-settings" class="run-settings" hidden><label>Distancia<select id="run-unit"><option value="km">Kilómetros</option><option value="mi">Millas</option></select></label><label class="run-check"><input id="run-announce" type="checkbox" ${prefs.announce?'checked':''}> Avisar cada kilómetro</label></div><p id="run-gps-hint" class="run-note">GPS requiere HTTPS y permiso de ubicación.</p><form id="run-manual-form" class="run-manual card" hidden></form><p id="run-manual-msg" class="msg"></p></section>`}`;

    mapController = mountMap($('#run-map-live',box),state?.segments || [],{ locate: !state });

    const center = $('#run-center',box); center.onclick = async () => { if (navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => { mapController?.then(({map})=>map?.setView([p.coords.latitude,p.coords.longitude],16)); }, () => notify('No se pudo obtener tu ubicación. Revisa el permiso GPS.'), {enableHighAccuracy:true,timeout:10000}); };

    const unitSelect = $('#run-unit',box);
    if (unitSelect) unitSelect.value = prefs.unit;

    const start = $('#run-start',box);

    if (start) start.onclick = () => {

      const type = $('#run-goal-type',box).value, value = Number($('#run-goal-value',box)?.value);

      if (type !== 'none' && !(value > 0)) { notify('Indica un objetivo válido.'); return; }

      prefs.goal = type === 'none' ? null : { type, value }; prefs.unit = $('#run-unit',box).value; prefs.announce = $('#run-announce',box).checked; savePreferences(userId,prefs);

      const ok = tracker.start(paint,(message)=>{ const m=$('#run-live-msg',view); if(m)m.textContent=message; });

      if (ok) { page='run'; render(); }

    };

    const goalType = $('#run-goal-type',box);

    if (goalType) goalType.onchange = () => { const wrap=$('#run-goal-fields',box), type=goalType.value; wrap.hidden=type==='none'; wrap.innerHTML=type==='distance'?'<label>Distancia objetivo (km)<input id="run-goal-value" type="number" min="0.1" step="0.1" inputmode="decimal" placeholder="5"></label>':type==='duration'?'<label>Duración objetivo (minutos)<input id="run-goal-value" type="number" min="1" step="1" inputmode="numeric" placeholder="30"></label>':''; };

    const settingsButton = $('#run-settings-open',box);
    if (settingsButton) settingsButton.onclick = (e) => { const panel=$('#run-settings',box); panel.hidden=!panel.hidden; e.currentTarget.setAttribute('aria-expanded',String(!panel.hidden)); };

    if (unitSelect) unitSelect.onchange=()=>{prefs.unit=unitSelect.value;savePreferences(userId,prefs);};

    const announceToggle = $('#run-announce',box);
    if (announceToggle) announceToggle.onchange=()=>{prefs.announce=announceToggle.checked;savePreferences(userId,prefs);};

    const manualButton = $('#run-manual-open',box);
    if (manualButton) manualButton.onclick=()=>{ const form=$('#run-manual-form',box); form.hidden=!form.hidden; if(!form.innerHTML) form.innerHTML=manualFormMarkup(); bindManual(form, null); };

    if (state) {

      $('#run-pause',box)?.addEventListener('click',()=>{tracker.pause();render();});

      $('#run-resume',box)?.addEventListener('click',()=>{tracker.resume(paint,showGpsError);render();});

      $('#run-finish',box).onclick=async()=>{if(!(await confirmDialog('Finalizar y revisar esta carrera. Todavía podrás descartarla antes de guardar.','Finalizar carrera')))return;const result=tracker.finish();if(!result){notify('No se pudo finalizar la carrera.');return;}if(result.distance_km<.01){notify('La ruta tiene menos de 10 metros válidos. Puedes descartarla o revisar los datos GPS.');}page='review';render();};

      $('#run-discard',box).onclick=async()=>{if(await confirmDialog('Se eliminará el borrador local de esta carrera.','Descartar actividad')){tracker.discard();page='run';render();}};

      tracker.restore(paint,showGpsError); paint();

      document.addEventListener('visibilitychange',onVisibility,{once:true});

    } else {

      if(navigator.permissions?.query) navigator.permissions.query({name:'geolocation'}).then((p)=>{const hint=$('#run-gps-hint',view);if(hint)hint.textContent=p.state==='denied'?'Ubicación bloqueada. Habilítala en los permisos del navegador.':p.state==='granted'?'Permiso GPS concedido · se activará al iniciar.':'GPS listo · se pedirá permiso al iniciar.';}).catch(()=>{});

    }

  }

  function renderGoalProgress(state) {

    const goal=prefs.goal;if(!goal)return '';

    const current=goal.type==='distance'?tracker.distanceKm():tracker.elapsedSeconds()/60,ratio=Math.min(100,current/goal.value*100);

    return `<div class="run-goal-progress"><div><b>Objetivo ${goal.type==='distance'?'de distancia':'de duración'}</b><span>${fmt(current,1)} / ${fmt(goal.value,1)} ${goal.type==='distance'?'km':'min'}</span></div><progress max="100" value="${ratio}"></progress></div>`;

  }

  function onVisibility(){if(document.visibilityState==='hidden'&&tracker.state?.status==='running'){const msg=$('#run-live-msg',view);if(msg)msg.textContent='La app quedó en segundo plano. Algunos navegadores pueden interrumpir la ubicación; vuelve a esta pestaña para revisar el GPS.';}}

  function showGpsError(message){const el=$('#run-live-msg',view);if(el)el.textContent=message;}

  let announcedKm=0;

  function paint(){

    const state=tracker.state;if(!state)return;

    const seconds=tracker.elapsedSeconds(),km=tracker.distanceKm(),flat=tracker.points();

    const write=(id,value)=>{const node=$(`#${id}`,view);if(node)node.textContent=value;};

    write('run-live-time',durationLabel(seconds));write('run-live-distance',fmt(prefs.unit==='mi'?km*.621371:km,2));const distUnit=prefs.unit==='mi'?'mi':'km';const unitNode=$('#run-live-distance',view)?.nextElementSibling;if(unitNode)unitNode.textContent=distUnit;write('run-live-pace',`${kmPace(prefs.unit==='mi'?km*.621371:km,seconds/60)} min/${distUnit}`);write('run-gps-status',state.gps_status);

    const acc=flat.at(-1)?.accuracy;write('run-accuracy',acc?`Precisión ${acc} m`: '');

    write('run-live-moving',durationLabel(state.moving_time_sec||0));

    const segment=state.segments?.at(-1)||[],end=segment.at(-1),start=segment[Math.max(0,segment.length-4)];

    if(end&&start&&end.at>start.at){const current=kmPace(Math.max(.001,Math.round(earthDistance(start,end))/1000*(prefs.unit==='mi' ? 0.621371 : 1)),(end.at-start.at)/60000);write('run-live-current-pace',`${current} min/${distUnit}`);}

    const threshold=Math.floor(km);if(prefs.announce&&threshold>announcedKm){announcedKm=threshold;notify(`Kilómetro ${threshold} · ritmo medio ${kmPace(km,seconds/60)}`);}

    if(mapController?.then) mapController.then(({update})=>update?.(state.segments||[]));

  }

  function earthDistance(a,b){return distanceBetween(a,b);}

  function manualFormMarkup(activity=null){return `<h2>${activity?'Editar actividad':'Registro manual'}</h2><input name="id" type="hidden" value="${esc(activity?.id||'')}"><label>Nombre<input name="activity_name" maxlength="100" value="${esc(activity?.activity_name||'')}" placeholder="Carrera matutina"></label><div class="row"><label>Fecha<input name="performed_on" type="date" max="${today()}" required value="${esc(activity?.performed_on||today())}"></label><label>Tipo<select name="run_type"><option value="">Sin especificar</option>${RUN_TYPES.map(([v,t])=>`<option value="${v}" ${activity?.run_type===v?'selected':''}>${esc(t)}</option>`).join('')}</select></label></div><div class="row"><label>Distancia (km)<input name="distance_km" type="number" min="0.01" max="999.99" step="0.01" inputmode="decimal" required ${activity?.tracking_source==='gps'?'readonly':''} value="${esc(activity?.distance_km??'')}"></label><label>Duración (h:mm:ss)<input name="duration" type="text" inputmode="numeric" placeholder="0:30:00" ${activity?.tracking_source==='gps'?'readonly':''} pattern="(?:[0-9]+:)?[0-5]?[0-9]:[0-5][0-9]" required value="${activity?.duration_min?durationLabel(durationOf(activity)):''}"></label></div><label>Desnivel positivo (m) · opcional<input name="elevation_m" type="number" min="0" max="10000" step="1" value="${esc(activity?.elevation_m??'')}"></label><label>Esfuerzo percibido (1–10) · opcional<input name="rpe" type="number" min="1" max="10" step="1" value="${esc(activity?.rpe??'')}"></label><label>Superficie · opcional<select name="surface"><option value="">Sin especificar</option>${['Asfalto','Tierra','Pista','Montaña','Otra'].map(x=>`<option ${activity?.surface===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Notas<input name="notes" maxlength="1000" value="${esc(activity?.notes||'')}"></label><label>Fotografías · hasta 3, 8 MB cada una<input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><p class="run-manual-pace muted" aria-live="polite">Ritmo: —</p><div class="quick-actions"><button class="btn" type="submit">${activity?'Guardar cambios':'Guardar carrera'}</button><button class="btn ghost" type="button" data-cancel-manual>Cancelar</button></div>`;}

  function bindManual(form, activity){

    const pace=form.querySelector('.run-manual-pace'),dist=form.elements.distance_km,duration=form.elements.duration;

    const parseDuration=(value)=>{const parts=value.split(':').map(Number);if(parts.some((x)=>!Number.isFinite(x)))return 0;if(parts.length===3)return parts[0]*3600+parts[1]*60+parts[2];if(parts.length===2)return parts[0]*60+parts[1];return 0;};

    const update=()=>{const sec=parseDuration(duration.value),km=Number(dist.value);pace.textContent=km>0&&sec>0?`Ritmo medio: ${kmPace(km,sec/60)} min/km`:'Ritmo: —';};dist.oninput=duration.oninput=update;update();

    form.onsubmit=async(e)=>{e.preventDefault();const sec=parseDuration(duration.value),km=Number(dist.value),date=form.elements.performed_on.value;if(!(km>0&&sec>0)||date>today()){notify('Revisa distancia, duración y fecha.');return;}const button=form.querySelector('[type="submit"]');button.disabled=true;let photos=[];let uploaded=[];const id=form.elements.id.value,old=activities.find(a=>a.id===id);try{photos=await uploadRunPhotos(userId,form.elements.photos.files,old?.activity_photos||[]);uploaded=photos.filter(path=>!(old?.activity_photos||[]).includes(path));const row={discipline:'running',tracking_source:old?.tracking_source||'manual',performed_on:date,distance_km:old?.tracking_source==='gps'?old.distance_km:km,duration_min:old?.tracking_source==='gps'?old.duration_min:Math.max(.1,Number((sec/60).toFixed(1))),duration_seconds:old?.tracking_source==='gps'?old.duration_seconds||Math.round(old.duration_min*60):sec,started_at:old?.started_at||null,moving_time_sec:old?.moving_time_sec??null,activity_name:form.elements.activity_name.value.trim()||'Running',run_type:form.elements.run_type.value||null,elevation_m:num(form.elements.elevation_m.value),rpe:num(form.elements.rpe.value),surface:form.elements.surface.value||null,notes:form.elements.notes.value.trim()||null,route_points:old?.tracking_source==='gps'?old.route_points:[],route_segments:old?.tracking_source==='gps'?old.route_segments:[],split_data:old?.tracking_source==='gps'?old.split_data:[],activity_photos:photos};const response=id?await supabase.from('activities').update(row).eq('id',id).eq('user_id',userId):await supabase.from('activities').insert(row);if(response.error)throw new Error(response.error.message);}catch(saveError){if(uploaded.length)await supabase.storage.from('profile-media').remove(uploaded);button.disabled=false;let msg=form.querySelector('.msg');if(!msg){msg=document.createElement('p');msg.className='msg';form.append(msg);}msg.textContent=`No se guardó: ${saveError.message}`;return;}form.closest('dialog')?.close();notify(id?'Actividad actualizada.':'Carrera guardada.','success');await refreshActivities();page='history';render();};

    form.querySelector('[data-cancel-manual]').onclick=()=>{const dialog=form.closest('dialog');if(dialog)dialog.close();else form.hidden=true;};

  }

  async function refreshActivities(){const res=await supabase.from('activities').select('*').eq('discipline','running').order('performed_on',{ascending:false}).order('created_at',{ascending:false});if(!res.error)activities=res.data||[];}

  function renderReview(box){

    const state=tracker.state;if(!state){box.innerHTML='<div class="card">No hay una carrera para revisar.</div><button class="btn" id="review-back">Volver a Correr</button>';$('#review-back',box).onclick=()=>setPage('run');return;}

    const result=tracker.finish(), metrics=splitRuns(result.route_segments), km=Number(result.distance_km.toFixed(2));

    const fastestSplit=metrics.splits.filter(s=>s.km!=='Final').sort((a,b)=>a.seconds-b.seconds)[0];const elevation=elevationGain(result.route_segments),tooShort=km<.01;

    box.innerHTML=`<section class="run-review"><div class="run-review__intro"><span class="run-live__label">REVISIÓN · GPS</span><p>Comprueba los resultados y añade los detalles que quieras antes de guardar.</p>${tooShort?'<p class="card warn">La distancia válida aún no alcanza 0,01 km. Vuelve a Correr y reanuda para registrar más recorrido.</p>':''}<p>${esc(localDate(result.started_at))} · ${new Intl.DateTimeFormat('es-BO',{hour:'2-digit',minute:'2-digit'}).format(new Date(result.started_at))} · GPS</p></div><div class="run-map-wrap"><div id="run-map-review" class="run-map run-map--review" aria-label="Recorrido GPS de la carrera"></div><button type="button" class="run-map__locate" id="review-center">Centrar recorrido</button></div><div class="run-review-stats"><article class="card"><b>${fmt(km,2)} km</b><span>Distancia</span></article><article class="card"><b>${durationLabel(result.duration_sec)}</b><span>Tiempo total</span></article><article class="card"><b>${durationLabel(metrics.moving_sec)}</b><span>En movimiento*</span></article><article class="card"><b>${kmPace(km,result.duration_sec/60)}</b><span>Ritmo medio</span></article><article class="card"><b>${fastestSplit?`${durationLabel(fastestSplit.seconds)}`:'—'}</b><span>Mejor parcial de 1 km</span></article><article class="card"><b>${elevation??'—'}${elevation===null?'':' m'}</b><span>Desnivel positivo GPS</span></article></div>${metrics.splits.length?`<details class="card run-splits"><summary>Parciales (${metrics.splits.length})</summary>${metrics.splits.map(s=>`<div><span>${s.km==='Final'?'Tramo final':`Km ${s.km}`}</span><b>${durationLabel(s.seconds)}</b><small>${kmPace(s.distance_m/1000,s.seconds/60)} min/km</small></div>`).join('')}</details>`:''}<form id="run-review-form" class="card run-review-form"><label>Nombre de actividad<input name="activity_name" maxlength="100" placeholder="Carrera matutina" value=""></label><div class="row"><label>Tipo<select name="run_type"><option value="">Sin especificar</option>${RUN_TYPES.map(([v,t])=>`<option value="${v}">${esc(t)}</option>`).join('')}</select></label><label>Esfuerzo (1–10)<input name="rpe" type="number" min="1" max="10" placeholder="Opcional"></label></div><label>Superficie · opcional<select name="surface"><option value="">Sin especificar</option>${['Asfalto','Tierra','Pista','Montaña','Otra'].map(x=>`<option>${x}</option>`).join('')}</select></label><label>Notas personales<textarea name="notes" rows="3" maxlength="1000" placeholder="¿Cómo te sentiste?"></textarea></label><label>Fotografías · opcional, hasta 3<input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><p class="muted">* Tiempo en movimiento estimado a partir de los intervalos GPS. Privada por defecto.</p><p class="msg" id="review-msg" aria-live="polite"></p><div class="run-review-actions"><button class="btn" type="submit" id="review-save" ${tooShort?'disabled':''}>Guardar actividad</button><button class="btn ghost" type="button" id="review-back">Volver a revisar</button><button class="link" type="button" id="review-discard">Descartar carrera</button></div></form></section>`;

    mapController=mountMap($('#run-map-review',box),result.route_segments);

    $('#review-center',box).onclick=()=>mapController?.then(({recenter})=>recenter());

    $('#review-back',box).onclick=()=>{tracker.returnToPause();setPage('run');};

    $('#review-discard',box).onclick=async()=>{if(await confirmDialog('Esta carrera GPS se eliminará y no aparecerá en tu historial.','Descartar carrera')){tracker.discard();page='run';render();}};

    $('#run-review-form',box).onsubmit=async(e)=>{e.preventDefault();if(saving||tooShort)return;saving=true;const button=$('#review-save',box);button.disabled=true;const form=e.currentTarget;let photos=[];try{photos=await uploadRunPhotos(userId,form.elements.photos.files);const row={discipline:'running',performed_on:localDate(result.started_at),distance_km:km,duration_min:Math.max(.1,Number((result.duration_sec/60).toFixed(1))),duration_seconds:result.duration_sec,activity_name:form.elements.activity_name.value.trim()||'Carrera GPS',run_type:form.elements.run_type.value||null,rpe:num(form.elements.rpe.value),surface:form.elements.surface.value||null,notes:form.elements.notes.value.trim()||null,route_points:result.route_points,route_segments:result.route_segments,split_data:metrics.splits,moving_time_sec:Math.round(metrics.moving_sec),started_at:new Date(result.started_at).toISOString(),activity_photos:photos,tracking_source:'gps'};const {error:saveError}=await supabase.from('activities').insert(row);if(saveError){if(photos.length)await supabase.storage.from('profile-media').remove(photos);throw new Error(saveError.message);}}catch(saveError){saving=false;button.disabled=false;$('#review-msg',box).textContent=`No se guardó. Tu borrador se conserva para reintentar: ${saveError.message}`;return;}tracker.discard();await refreshActivities();notify('Carrera guardada.','success');saving=false;page='history';render();};

  }

  function elevationGain(segments){const groups=Array.isArray(segments?.[0])?segments:[segments||[]];let samples=0,total=0;for(const segment of groups)for(let i=1;i<segment.length;i++){const before=segment[i-1].elevation,after=segment[i].elevation;if(!Number.isFinite(before)||!Number.isFinite(after))continue;samples++;const rise=after-before;if(rise>1&&rise<20)total+=rise;}return samples>=5?Math.round(total):null;}

  function renderProgress(box){

    const rows=summary(period), totalKm=rows.reduce((n,a)=>n+Number(a.distance_km||0),0), totalSec=rows.reduce((n,a)=>n+durationOf(a),0), totalMin=totalSec/60, bestDistance=[...activities].sort((a,b)=>b.distance_km-a.distance_km)[0];

    const eight=[];const now=new Date();for(let i=7;i>=0;i--){const d=new Date(now);d.setDate(d.getDate()-((d.getDay()+6)%7)-i*7);d.setHours(12,0,0,0);const start=d.toISOString().slice(0,10),end=new Date(d);end.setDate(end.getDate()+7);const endIso=end.toISOString().slice(0,10);const items=activities.filter(a=>a.performed_on>=start&&a.performed_on<endIso);eight.push({start,end:startIso.slice(5),km:items.reduce((n,a)=>n+Number(a.distance_km||0),0),items});}

    const max=Math.max(1,...eight.map(x=>x.km)),selectedWeekIndex=eight.findIndex(w=>w.start===selectedWeek),weekDelta=selectedWeekIndex>0?eight[selectedWeekIndex].km-eight[selectedWeekIndex-1].km:0;

    box.innerHTML=`<div class="run-progress"><div class="run-period" role="group" aria-label="Periodo de estadísticas">${[['week','Esta semana'],['month','Este mes'],['all','Todo el tiempo']].map(([v,l])=>`<button type="button" data-period="${v}" class="${period===v?'on':''}">${l}</button>`).join('')}</div><div class="run-progress__stats"><article class="card"><b>${fmt(totalKm,1)} km</b><span>Distancia</span></article><article class="card"><b>${rows.length}</b><span>Carreras</span></article><article class="card"><b>${durationLabel(totalSec)}</b><span>Tiempo total</span></article><article class="card"><b>${kmPace(totalKm,totalMin)}</b><span>Ritmo medio</span></article></div><section class="card run-records"><h2>Récords personales</h2>${bestDistance?`<div><span>Mayor distancia</span><b>${fmt(bestDistance.distance_km)} km</b><time>${esc(bestDistance.performed_on)}</time></div>`:'<p class="muted">Registra carreras para calcular tus récords.</p>'}${[1,5,10].map(k=>{const record=bestSplit(activities,k);return `<div><span>Mejor ${k} km verificable</span><b>${record?durationLabel(record.seconds):'—'}</b><time>${record?esc(record.date):''}</time></div>`;}).join('')}<div><span>Mayor duración</span><b>${activities.length?durationLabel(Math.max(...activities.map(durationOf))):'—'}</b>${activities.length?`<time>${esc([...activities].sort((a,b)=>durationOf(b)-durationOf(a))[0].performed_on)}</time>`:''}</div></section><section class="card run-weekly"><h2>Distancia · últimas 8 semanas</h2><div class="run-weekly__chart" aria-label="Gráfico de kilómetros por semana">${eight.map(w=>`<button class="run-weekly__bar ${selectedWeek===w.start?'selected':''}" type="button" data-week="${w.start}" aria-label="Semana desde ${w.start}: ${fmt(w.km,1)} kilómetros"><i style="height:${Math.max(w.km?4:0,w.km/max*100)}%"></i><b>${fmt(w.km,0)}</b><small>${w.end}</small></button>`).join('')}</div>${selectedWeek?`<div class="run-weekly__detail"><b>Semana desde ${selectedWeek}</b>${selectedWeekIndex>0?`<p>Vs. semana anterior: ${weekDelta>=0?'+':''}${fmt(weekDelta,1)} km</p>`:''}${eight.find(w=>w.start===selectedWeek)?.items.map(a=>`<p>${esc(a.activity_name||'Running')} · ${fmt(a.distance_km)} km · ${esc(a.performed_on)}</p>`).join('')||'<p class="muted">Sin carreras.</p>'}</div>`:''}</section></div>`;

    box.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{period=b.dataset.period;renderProgress(box);});

    box.querySelectorAll('[data-week]').forEach(b=>b.onclick=()=>{selectedWeek=selectedWeek===b.dataset.week?'':b.dataset.week;renderProgress(box);});

  }

  function bestSplit(list, targetKm){let best=null;for(const activity of list){for(const segment of routeSegments(activity)){if(segment.length<2)continue;const distances=[0];for(let i=1;i<segment.length;i++){const step=distanceBetween(segment[i-1],segment[i]),sec=(segment[i].at-segment[i-1].at)/1000;distances.push(distances.at(-1)+(step>=2&&step<=250&&sec>0&&step/sec<=12?step:0));}for(let i=0;i<segment.length;i++){const target=distances[i]+targetKm*1000;let j=i+1;while(j<segment.length&&distances[j]<target)j++;if(j>=segment.length)continue;const span=distances[j]-distances[j-1];if(span<=0)continue;const fraction=(target-distances[j-1])/span,endAt=segment[j-1].at+(segment[j].at-segment[j-1].at)*fraction,seconds=(endAt-segment[i].at)/1000;if(seconds>0&&(!best||seconds<best.seconds))best={seconds,date:activity.performed_on};}}}return best;}

  function renderHistory(box){

    const cutoff=historyPeriod==='month'?`${today().slice(0,7)}-01`:historyPeriod==='90'?localDate(new Date(Date.now()-90*86400000)):historyPeriod==='year'?`${today().slice(0,4)}-01-01`:'';
    const filtered=activities.filter(a=>(!cutoff||a.performed_on>=cutoff)&&(historyFilter==='all'||(historyFilter==='gps'?a.tracking_source==='gps':historyFilter==='manual'?a.tracking_source!=='gps':a.run_type===historyFilter))).sort((a,b)=>sortAsc?String(a.performed_on).localeCompare(String(b.performed_on)):byDate(a,b));

    const shown=filtered.slice(0,historyCount);

    box.innerHTML=`<div class="run-history-tools"><label>Filtrar<select id="history-filter"><option value="all">Todas las carreras</option><option value="gps">GPS</option><option value="manual">Manuales</option>${RUN_TYPES.map(([v,t])=>`<option value="${v}">${esc(t)}</option>`).join('')}</select></label><label>Periodo<select id="history-period"><option value="all">Todo el historial</option><option value="month">Este mes</option><option value="90">Últimos 90 días</option><option value="year">Este año</option></select></label><button type="button" class="btn ghost sm" id="history-sort">Fecha ${sortAsc?'↑':'↓'}</button><button type="button" class="btn sm" id="history-add">Registrar manual</button></div><div class="run-history-list">${shown.map(a=>`<article class="card run-history-card"><button type="button" class="run-history-open" data-activity="${a.id}"><span class="run-history-card__head"><b>${esc(a.activity_name||'Running')}</b><small>${esc(a.performed_on)} · ${a.tracking_source==='gps'?'GPS':'Manual'}</small></span>${routeThumbnail(a)}<span class="run-history-card__main"><strong>${fmt(a.distance_km)} km</strong><span>${durationLabel(durationOf(a))} · ${manualPace(a)} min/km</span></span><span class="run-history-card__type">${esc(RUN_TYPE[a.run_type]||'Carrera')}</span><span aria-hidden="true">→</span></button></article>`).join('')||'<div class="card muted">No hay actividades para este filtro.</div>'}</div>${shown.length<filtered.length?'<button type="button" class="btn ghost" id="history-more">Cargar más actividades</button>':''}<dialog class="run-detail-dialog" id="run-detail"><div id="run-detail-content"></div></dialog>`;

    $('#history-filter',box).value=historyFilter;$('#history-filter',box).onchange=(e)=>{historyFilter=e.target.value;historyCount=PER_PAGE;renderHistory(box);};$('#history-period',box).value=historyPeriod;$('#history-period',box).onchange=(e)=>{historyPeriod=e.target.value;historyCount=PER_PAGE;renderHistory(box);};

    $('#history-sort',box).onclick=()=>{sortAsc=!sortAsc;renderHistory(box);};$('#history-add',box).onclick=()=>{const dlg=document.createElement('dialog');dlg.className='run-detail-dialog';dlg.innerHTML=`<form class="run-detail-sheet" id="manual-create">${manualFormMarkup()}</form>`;document.body.append(dlg);dlg.showModal();bindManual($('#manual-create',dlg),null);dlg.addEventListener('close',()=>dlg.remove());};

    $('#history-more',box)?.addEventListener('click',()=>{historyCount+=PER_PAGE;renderHistory(box);});

    box.querySelectorAll('[data-activity]').forEach(b=>b.onclick=()=>openDetail(activities.find(a=>a.id===b.dataset.activity),box));

  }

  async function openDetail(activity,box){

    const dialog=$('#run-detail',box),content=$('#run-detail-content',dialog),route=routeSegments(activity),splits=activity.split_data||[];const photoUrls=await Promise.all((activity.activity_photos||[]).map(async path=>{const {data}=await supabase.storage.from('profile-media').createSignedUrl(path,1800);return data?.signedUrl||'';}));

    content.innerHTML=`<div class="run-detail-sheet"><button class="link run-detail-close" type="button" id="detail-close">Cerrar</button><header><span class="run-live__label">${activity.tracking_source==='gps'?'CARRERA GPS':'REGISTRO MANUAL'}</span><h2>${esc(activity.activity_name||'Running')}</h2><p>${esc(activity.performed_on)} · ${esc(RUN_TYPE[activity.run_type]||'Carrera')}</p></header>${route.length?'<div id="run-map-detail" class="run-map run-map--detail"></div>':'<div class="card run-detail-no-map">Registro manual · no hay recorrido GPS asociado.</div>'}<div class="run-review-stats"><article class="card"><b>${fmt(activity.distance_km)} km</b><span>Distancia</span></article><article class="card"><b>${durationLabel(durationOf(activity))}</b><span>Duración</span></article><article class="card"><b>${manualPace(activity)}</b><span>Ritmo medio</span></article><article class="card"><b>${activity.elevation_m??'—'}${activity.elevation_m?' m':''}</b><span>Desnivel</span></article></div>${photoUrls.some(Boolean)?`<div class="run-photo-grid">${photoUrls.filter(Boolean).map(src=>`<img src="${esc(src)}" alt="Foto de la actividad" loading="lazy">`).join('')}</div>`:''}${splits.length?`<details class="card run-splits" open><summary>Parciales</summary>${splits.map(s=>`<div><span>${s.km==='Final'?'Tramo final':`Km ${s.km}`}</span><b>${durationLabel(s.seconds)}</b><small>${kmPace(s.distance_m/1000,s.seconds/60)}</small></div>`).join('')}</details>`:''}<div class="card run-detail-info"><p>Esfuerzo percibido: <b>${activity.rpe||'—'}</b></p><p>Superficie: <b>${esc(activity.surface||'—')}</b></p><p>${esc(activity.notes||'Sin notas personales.')}</p></div><details class="run-action-menu"><summary>Acciones</summary><div><button class="btn ghost" id="detail-edit">Editar actividad</button><button class="btn ghost" id="detail-share">Compartir resumen</button><button class="btn ghost" id="detail-delete">Eliminar actividad</button></div><p class="muted">Las actividades se mantienen privadas. La publicación voluntaria en la comunidad no está disponible desde Running todavía.</p></details></div>`;

    $('#detail-close',dialog).onclick=()=>dialog.close();dialog.showModal();if(route.length)mountMap($('#run-map-detail',dialog),route);

    $('#detail-share',dialog).onclick=async()=>{const text=`${activity.activity_name||'Running'} · ${fmt(activity.distance_km)} km · ${durationLabel(durationOf(activity))} · ${activity.performed_on}`;if(navigator.share){try{await navigator.share({title:'Mi entrenamiento Running',text});}catch(error){if(error.name!=='AbortError')notify('No se pudo compartir el resumen.');}}else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);notify('Resumen copiado.','success');}else notify('Este navegador no ofrece opciones para compartir.');};

    $('#detail-edit',dialog).onclick=()=>{const form=document.createElement('form');form.className='run-detail-sheet';form.id='manual-edit';form.innerHTML=manualFormMarkup(activity);content.replaceChildren(form);bindManual(form,activity);};

    $('#detail-delete',dialog).onclick=async()=>{if(!(await confirmDialog('Esta acción eliminará la actividad y su recorrido GPS.','Eliminar actividad')))return;const {error:deleteError}=await supabase.from('activities').delete().eq('id',activity.id).eq('user_id',userId);if(deleteError){notify(`No se pudo eliminar: ${deleteError.message}`);return;}if(activity.activity_photos?.length){const {error:storageError}=await supabase.storage.from('profile-media').remove(activity.activity_photos);if(storageError)notify('Actividad borrada; no se pudieron eliminar sus fotos almacenadas.');}dialog.close();await refreshActivities();renderHistory(box);notify('Actividad eliminada.','success');};

  }

  render();

}



async function renderOtherDiscipline(view, ctx, discipline) {
  const { data: acts = [], error } = await supabase.from('activities').select('*').eq('discipline', discipline).order('performed_on', { ascending: false }).order('created_at', { ascending: false });
  const records = error ? [] : acts;
  const totalKm = records.reduce((n, a) => n + Number(a.distance_km || 0), 0);
  const totalMin = records.reduce((n, a) => n + Number(a.duration_min || 0), 0);
  const totalSec = records.reduce((n, a) => n + durationOf(a), 0);
  const todayDate = new Date(); todayDate.setHours(12, 0, 0, 0);
  const weekStartDate = new Date(todayDate); weekStartDate.setDate(todayDate.getDate() - ((todayDate.getDay() + 6) % 7));
  const weekKey = localDate(weekStartDate), monthKey = today().slice(0, 7);
  const weekRows = records.filter(a => a.performed_on >= weekKey);
  const monthRows = records.filter(a => a.performed_on.startsWith(monthKey));
  const sumDistance = rows => rows.reduce((n, a) => n + Number(a.distance_km || 0), 0);
  const metricLabel = discipline === 'swimming' ? 'Ritmo promedio' : 'Velocidad media';
  const metricValue = discipline === 'swimming'
    ? `${fmt(totalKm ? totalMin / (totalKm * 10) : 0, 2)} min/100 m`
    : `${fmt(totalMin ? totalKm / totalMin * 60 : 0, 1)} km/h`;
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(weekStartDate); start.setDate(start.getDate() - i * 7);
    const key = localDate(start); const end = new Date(start); end.setDate(end.getDate() + 7);
    const items = records.filter(a => a.performed_on >= key && a.performed_on < localDate(end));
    weeks.push({ key, km: sumDistance(items), items });
  }
  const maxWeek = Math.max(1, ...weeks.map(w => w.km));

  view.innerHTML = `<section class="run-module"><header class="run-module__head"><h1>${esc(DISC[discipline])}</h1></header><nav class="tabs sub running-pages"><button class="on">Progreso</button><button id="other-manual-tab">Historial y registro</button></nav><div id="other-content"><div class="run-progress__stats"><article class="card"><b>${fmt(sumDistance(weekRows))} km</b><span>Esta semana</span></article><article class="card"><b>${fmt(sumDistance(monthRows))} km</b><span>Este mes</span></article><article class="card"><b>${records.length}</b><span>Sesiones</span></article><article class="card"><b>${durationLabel(totalSec)}</b><span>Tiempo total</span></article></div><section class="card run-records"><h2>Resumen de ${esc(DISC[discipline])}</h2><p>${metricLabel}: <b>${metricValue}</b></p><p>${fmt(totalKm)} km en ${records.length} registros</p></section><section class="card run-weekly"><h2>Distancia · últimas 8 semanas</h2><div class="run-weekly__chart">${weeks.map(w => `<div class="run-weekly__bar"><i style="height:${Math.max(w.km ? 4 : 0, w.km / maxWeek * 100)}%"></i><b>${fmt(w.km, 0)}</b><small>${w.key.slice(5)}</small></div>`).join('')}</div></section><button class="btn" id="other-open-history">Registrar actividad</button></div></section>`;
  if (error) view.querySelector('#other-content').insertAdjacentHTML('afterbegin', `<p class="msg">No se pudieron cargar tus actividades: ${esc(error.message)}</p>`);

  const historyTab = $('#other-manual-tab', view);
  const showHistory = () => {
    const content = $('#other-content', view);
    content.innerHTML = `<button class="btn sm ghost" id="other-back">Volver a Progreso</button><form id="other-form" class="card">${manualFormMarkup()}</form><div class="run-history-list">${records.map(a => `<article class="card run-history-card"><div class="run-history-card__head"><b>${esc(a.activity_name || DISC[discipline])}</b><small>${esc(a.performed_on)} · Manual</small></div><div class="run-history-card__main"><strong>${fmt(a.distance_km)} km</strong><span>${durationLabel(durationOf(a))} · ${discipline === 'swimming' ? `${fmt(a.duration_min / (a.distance_km * 10), 2)} min/100 m` : `${fmt((a.distance_km / a.duration_min) * 60, 1)} km/h`}</span></div><div class="quick-actions"><button class="btn sm ghost" data-other-edit="${a.id}" type="button">Editar</button><button class="btn sm ghost" data-other-delete="${a.id}" type="button">Eliminar</button></div></article>`).join('') || '<p class="card muted">Aún no hay registros.</p>'}</div>`;
    bindOtherManual($('#other-form', view), null);
    $('#other-back', view).onclick = () => renderOtherDiscipline(view, ctx, discipline);
    view.querySelectorAll('[data-other-edit]').forEach(button => button.onclick = () => {
      const activity = records.find(a => a.id === button.dataset.otherEdit), form = $('#other-form', view);
      form.innerHTML = manualFormMarkup(activity); bindOtherManual(form, activity);
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    view.querySelectorAll('[data-other-delete]').forEach(button => button.onclick = async () => {
      if (!(await confirmDialog('Se eliminará esta actividad de tu historial.', 'Eliminar actividad'))) return;
      const { error: deleteError } = await supabase.from('activities').delete().eq('id', button.dataset.otherDelete).eq('user_id', ctx.user.id);
      if (deleteError) { notify(`No se pudo eliminar: ${deleteError.message}`); return; }
      await renderOtherDiscipline(view, ctx, discipline);
    });
  };
  historyTab.onclick = showHistory;
  $('#other-open-history', view).onclick = showHistory;

  function bindOtherManual(form, activity) {
    const duration = form.elements.duration, distance = form.elements.distance_km, pace = form.querySelector('.run-manual-pace');
    const parse = value => { const parts = value.split(':').map(Number); return parts.some(n => !Number.isFinite(n)) ? 0 : parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts.length === 2 ? parts[0] * 60 + parts[1] : 0; };
    const updatePace = () => { const seconds = parse(duration.value), km = Number(distance.value); pace.textContent = km > 0 && seconds > 0 ? `${discipline === 'swimming' ? 'Ritmo' : 'Velocidad'}: ${discipline === 'swimming' ? `${fmt(seconds / 60 / (km * 10), 2)} min/100 m` : `${fmt(km / (seconds / 3600), 1)} km/h`}` : 'Ritmo: —'; };
    duration.oninput = distance.oninput = updatePace; updatePace();
    form.onsubmit = async event => {
      event.preventDefault(); const seconds = parse(duration.value), km = Number(distance.value), date = form.elements.performed_on.value;
      if (!(km > 0 && seconds > 0) || date > today()) { notify('Revisa distancia, duración y fecha.'); return; }
      const row = { discipline, performed_on: date, distance_km: km, duration_min: Number((seconds / 60).toFixed(1)), duration_seconds: seconds, activity_name: form.elements.activity_name.value.trim() || DISC[discipline], tracking_source: 'manual', route_points: [], notes: form.elements.notes.value.trim() || null };
      const result = activity
        ? await supabase.from('activities').update(row).eq('id', activity.id).eq('user_id', ctx.user.id)
        : await supabase.from('activities').insert({ ...row, user_id: ctx.user.id });
      if (result.error) { notify(`No se pudo guardar: ${result.error.message}`); return; }
      notify(activity ? 'Actividad actualizada.' : 'Actividad guardada.', 'success'); await renderOtherDiscipline(view, ctx, discipline);
    };
    form.querySelector('[data-cancel-manual]').onclick = () => renderOtherDiscipline(view, ctx, discipline);
  }
}

export async function renderRunning(view, ctx, discipline = 'running') {

  if (!ctx.canRegister) { view.innerHTML = `<h1>${esc(DISC[discipline])}</h1><div class="card warn">Tu membresía del mes aún no está aprobada. Cuando se apruebe podrás registrar actividades. <a href="#pago">Ir a Membresía</a></div>`; return; }

  if (discipline === 'running') return renderRun(view,ctx);

  return renderOtherDiscipline(view,ctx,discipline);

}
