import { mountRunCoach } from './coach-ui.js';
import { supabase, $, esc } from '../supabase.js';

import { fmt, today, paceStr, num, RUN_TYPE, DISC, confirmDialog, notify } from './common.js';

import { createRunningTracker, distanceBetween } from './running-tracker.js';
import { getPlannedRoute, setPlannedRoute, findRouteMatches, matchLiveRoute, coverage, activityRoute } from './route-tools.js';
import { openRoutePicker, routeSummary } from './route-picker.js';
import { mapToolsMarkup, mountMapTools } from './running-map-tools.js';
import { sessionMediaMarkup, readSessionMedia, saveSessionMedia } from './profile-ui.js';
import { shareSectionMarkup, bindShareSection, readShare, publishShare, activityLogros, renderSharedFeed } from './share.js';

// Botón "volver a las disciplinas": vive dentro de la propia pantalla (antes lo añadía app.js al principio y cada render lo borraba).
const BACK_HTML = '<button type="button" class="training-back-button animated-back animated-back-compact" id="run-back-training"><span class="animated-back-sweep" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H21z"/></svg></span><span class="animated-back-label">Todas las disciplinas</span></button>';
const bindBack = (root) => { const b = root.querySelector('#run-back-training'); if (b) b.onclick = () => { location.hash = '#training'; }; };



const RUN_TYPES = Object.entries(RUN_TYPE);

const PER_PAGE = 25;

const preferenceKey = (id) => `batmon_running_preferences_${id}`;

const byDate = (a, b) => String(b.performed_on).localeCompare(String(a.performed_on)) || String(b.created_at).localeCompare(String(a.created_at));

const kmPace = (km, min) => Number(km) > 0 && Number(min) > 0 ? paceStr(Number(km), Number(min)) : '—';

const localDate = (timestamp) => { const d=new Date(timestamp); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

const durationLabel = (sec) => `${Math.floor(sec / 3600)}:${String(Math.floor(sec % 3600 / 60)).padStart(2,'0')}:${String(Math.floor(sec % 60)).padStart(2,'0')}`;

const durationOf = (activity) => Number(activity.duration_seconds) || Math.round(Number(activity.duration_min || 0) * 60);



function readPreferences(userId) {

  try { return { unit: 'km', announce: true, voice: false, wakeLock: false, showMap: true, ...(JSON.parse(localStorage.getItem(preferenceKey(userId))) || {}) }; }

  catch { return { unit: 'km', announce: true, voice: false, wakeLock: false, showMap: true }; }

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



async function mountMap(el, segments, { center = null, locate = null, zoomControl = false, interactive = true, ghost = null } = {}) {

  if (!el) return { map: null, recenter() {} };

  el.innerHTML = '<div class="run-map__loading">Cargando mapa…</div>';

  try {

    const [{ default: L }] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);

    if (!el.isConnected) return { map: null, recenter() {} };

    el.innerHTML = '';

    const first = segments.flat().find((p) => Number.isFinite(+p.lat) && Number.isFinite(+p.lon));

    const startAt = center || (first ? [+first.lat, +first.lon] : [-19.0196, -65.2619]);

    const map = L.map(el, interactive ? { zoomControl: false, attributionControl: true, scrollWheelZoom: true } : { zoomControl: false, attributionControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false }).setView(startAt, first || center ? 16 : 13);
    map.attributionControl?.setPrefix(false);

    let baseLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>' }).addTo(map);
    const setBase = (l) => { map.removeLayer(baseLayer); baseLayer = L.tileLayer(l.url, { maxZoom: l.max, attribution: l.attr, subdomains: 'abc' }).addTo(map); baseLayer.bringToBack(); };

    if (zoomControl) L.control.zoom({ position: 'topright' }).addTo(map);

    map.on('tileerror', () => { const msg = el.parentElement?.querySelector('.run-map__error'); if (msg) msg.hidden = false; });

    const routeLayer=L.featureGroup().addTo(map);
    const ghostLayer=L.featureGroup().addTo(map);
    const setGhost=(pts)=>{ghostLayer.clearLayers();if(!pts||pts.length<2)return;const gi=getComputedStyle(document.body).getPropertyValue('--ink').trim()||'#151515';L.polyline(pts,{color:'#fff',weight:9,opacity:.5}).addTo(ghostLayer);L.polyline(pts,{color:gi,weight:5,opacity:.4,dashArray:'10 10',lineCap:'round'}).addTo(ghostLayer);L.circleMarker(pts[0],{radius:6,color:'#fff',weight:2,fillColor:'#24553a',fillOpacity:1}).bindTooltip('Inicio de la ruta').addTo(ghostLayer);L.circleMarker(pts.at(-1),{radius:6,color:'#fff',weight:2,fillColor:'#171717',fillOpacity:1}).bindTooltip('Destino').addTo(ghostLayer);if(!segments.flat().length)map.fitBounds(ghostLayer.getBounds(),{padding:[36,36],maxZoom:16});};
    setGhost(ghost);

    const drawSegments=(allSegments)=>{routeLayer.clearLayers();const ink=getComputedStyle(document.body).getPropertyValue('--ink').trim()||'#151515';const valid=allSegments.filter((s)=>s.length).map((s)=>({est:!!s[0]?.est,pts:s.map((p)=>[+p.lat,+p.lon]).filter((p)=>p.every(Number.isFinite))})).filter((s)=>s.pts.length);valid.forEach(({pts,est})=>{if(pts.length>1)L.polyline(pts,est?{color:ink,weight:4,opacity:.6,dashArray:'2 10',lineCap:'round'}:{color:ink,weight:5,opacity:.9,lineCap:'round'}).addTo(routeLayer);});const real=valid.filter((s)=>!s.est);if(real.length){L.circleMarker(real[0].pts[0],{radius:7,color:'#fff',weight:3,fillColor:'#24553a',fillOpacity:1}).bindTooltip('Inicio').addTo(routeLayer);const last=real.at(-1).pts;if(last.length>1)L.circleMarker(last.at(-1),{radius:7,color:'#fff',weight:3,fillColor:'#171717',fillOpacity:1}).bindTooltip('Última posición').addTo(routeLayer);}};

    drawSegments(segments);

    const routePoints = segments.flat();

    if (routePoints.length) {

      if (!center && routePoints.length > 1) map.fitBounds(L.latLngBounds(routePoints.map((p) => [p.lat,p.lon])), { padding: [36,36], maxZoom: 16 });

    }

    if (locate) {

      navigator.geolocation?.getCurrentPosition((p) => { if (!map.getContainer().isConnected) return; const position=[p.coords.latitude,p.coords.longitude]; const marker=L.circleMarker(position,{radius:8,color:'#fff',weight:3,fillColor:'#24553a',fillOpacity:1}).bindTooltip('Tu ubicación').addTo(map); if (!routePoints.length) map.setView(position,16); marker.bringToFront(); }, () => {}, { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 });

    }

    requestAnimationFrame(() => map.invalidateSize());

    return { map, L, setBase, setGhost, update:drawSegments, recenter: () => { const latest=routeLayer.getBounds();if(latest.isValid())map.fitBounds(latest,{padding:[36,36],maxZoom:16});else {const point=segments.flat().at(-1);if(point)map.setView([point.lat,point.lon],16);else if(center)map.setView(center,16);} } };

  } catch (error) {

    el.innerHTML = `<div class="run-map__fallback"><b>No se pudo cargar el mapa</b><span>El GPS y la actividad siguen disponibles. Revisa tu conexión.</span><small>${esc(error.message)}</small></div>`;

    return { map: null, recenter() {} };

  }

}



function addPageNav(view, selected, active) {

  view.querySelectorAll('.tabs-pill__input').forEach((input) => {

    input.checked = input.value === selected;

    input.onchange = () => active(input.value);

  });

}



async function renderRun(view, ctx) {

  const userId = ctx.user.id, tracker = createRunningTracker(userId), prefs = readPreferences(userId);

  let { data: activities = [], error } = await supabase.from('activities').select('*').eq('discipline','running').order('performed_on',{ascending:false}).order('created_at',{ascending:false});

  if (error) activities = [];

  const savedPage = localStorage.getItem(`batmon_running_page_${userId}`);

  let page = tracker.state?.status === 'finished' ? 'review' : tracker.state?.status === 'running' || tracker.state?.status === 'paused' ? 'run' : 'run';

  let historyCount = PER_PAGE, historyFilter = 'all', historyPeriod = 'all', sortAsc = false, period = 'week', selectedWeek = '';

  let mapController = null, saving = false;
  const planned = () => { const r = getPlannedRoute(userId); return r && Date.now() - (r.set_at || 0) < 36 * 3600 * 1000 ? r : null; };
  const ghostPts = () => planned()?.points || null;
  const knownRuns = activities.filter((a) => activityRoute(a).length >= 5);
  let shownStatus = null, lastMatchAt = 0, shownMatchId = null;

  const setPage = (next) => { page = next; localStorage.setItem(`batmon_running_page_${userId}`, next); render(); };

  const summary = (periodKey) => {

    const now = new Date(); let start = '';

    if (periodKey === 'week') { const monday = new Date(now); monday.setHours(12,0,0,0); monday.setDate(now.getDate() - ((now.getDay()+6)%7)); start = localDate(monday); }

    if (periodKey === 'month') start = `${today().slice(0,7)}-01`;

    return activities.filter((a) => !start || a.performed_on >= start);

  };

  const render = () => {

    const running = tracker.state?.status === 'running';
    const paused = tracker.state?.status === 'paused';
    document.body.classList.toggle('run-takeover', page === 'run' && running);

    const active = tracker.state && ['running','paused','finished'].includes(tracker.state.status);

    const title = page === 'run' ? (active ? 'Carrera en curso' : 'Correr') : page === 'progress' ? 'Progreso' : page === 'history' ? 'Historial' : page === 'feed' ? 'Actividades' : 'Revisar carrera';

    const showSubnav = page !== 'review' && !running && !paused;

    view.innerHTML = `<section class="run-module">${BACK_HTML}<header class="run-module__head"><div><p class="run-kicker">RUNNING · BATMON CROWD</p><h1>${title}</h1></div>${active ? `<span class="run-state run-state--${tracker.state.status}">${tracker.state.status === 'paused' ? 'Pausada' : tracker.state.status === 'finished' ? 'Por guardar' : 'En curso'}</span>` : ''}</header>

      ${showSubnav ? `<nav class="running-pages tabs-pill tabs-pill--4" aria-label="Secciones de Running">
        <input class="tabs-pill__input" type="radio" name="run-page" id="run-page-run" value="run">
        <label class="tabs-pill__label" for="run-page-run">Correr</label>
        <input class="tabs-pill__input" type="radio" name="run-page" id="run-page-progress" value="progress">
        <label class="tabs-pill__label" for="run-page-progress">Progreso</label>
        <input class="tabs-pill__input" type="radio" name="run-page" id="run-page-history" value="history">
        <label class="tabs-pill__label" for="run-page-history">Historial</label>
        <input class="tabs-pill__input" type="radio" name="run-page" id="run-page-feed" value="feed">
        <label class="tabs-pill__label" for="run-page-feed">Actividades</label>
        <div class="tabs-pill__indicator" aria-hidden="true"></div>
      </nav>` : ''}

      ${error?`<p class="msg" role="status">No se pudo cargar el historial: ${esc(error.message)}</p>`:''}<div id="run-page-content"></div></section>`;

    bindBack(view);
    const content = $('#run-page-content',view);

    addPageNav(view,page,(next)=>setPage(next));

    if (page === 'run') renderRunScreen(content);

    if (page === 'progress') renderProgress(content);

    if (page === 'history') renderHistory(content);

    if (page === 'feed') renderSharedFeed(content, ctx);

    if (page === 'review') renderReview(content);

  };



  function goalSummary(){ const g=prefs.goal; if(!g) return 'Establece un objetivo'; return g.type==='distance' ? `Objetivo: ${fmt(g.value,1)} km` : `Objetivo: ${fmt(g.value,0)} min`; }

  const goalIcon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const GOAL_ICONS = { none: goalIcon('<path d="M8 5v14l11-7z"/>'), distance: goalIcon('<rect x="3" y="10" width="18" height="4" rx="1"/><path d="M7 10v2M11 10v3M15 10v2"/>'), duration: goalIcon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>') };
  const SETTINGS_ICON = goalIcon('<path d="M4 6h16M4 12h16M4 18h16"/>');

  const GOAL_OPTIONS = [ { value: 'none', label: 'Libre', icon: GOAL_ICONS.none }, { value: 'distance', label: 'Distancia', icon: GOAL_ICONS.distance }, { value: 'duration', label: 'Duración', icon: GOAL_ICONS.duration } ];

  const X_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path class="morph-line top" d="M4 7 L20 7"/><path class="morph-line middle" d="M4 12 L20 12"/><path class="morph-line bottom" d="M4 17 L20 17"/></svg>';

  // Nombres curvados siguiendo el anillo, cada uno dentro de una cápsula ovalada que rodea a su icono
  // (en la mitad inferior se invierte el arco para que el texto se lea derecho).
  function goalArcLabels(chosen) {
    const OUT = 18 + 6 + 34, RC = OUT + 22, SIZE = 2 * (RC + 28), C = SIZE / 2, n = GOAL_OPTIONS.length;
    const rad = (d) => d * Math.PI / 180;
    const pt = (r, deg) => [(C + r * Math.sin(rad(deg))).toFixed(1), (C - r * Math.cos(rad(deg))).toFixed(1)];
    const arc = (id, r, from, to, sweep) => { const [x1, y1] = pt(r, from), [x2, y2] = pt(r, to); return `<path id="${id}" d="M${x1} ${y1} A${r} ${r} 0 0 ${sweep} ${x2} ${y2}"/>`; };
    const items = GOAL_OPTIONS.map((o, i) => {
      const deg = (360 / n) * i, bottom = Math.cos(rad(deg)) < -0.01;
      const half = ((o.label.length * 7.4 + 22) / 2 / RC) * 180 / Math.PI;   // medio ancho de la cápsula, en grados
      const rt = bottom ? RC + 4 : RC - 4;                                    // línea base del texto
      const from = bottom ? deg + half : deg - half, to = bottom ? deg - half : deg + half, sweep = bottom ? 0 : 1;
      const on = chosen === o.value ? ' is-active' : '';
      return `<g class="goal-arc${on}" data-value="${o.value}"><defs>${arc(`goal-bg-${i}`, RC, from, to, sweep)}${arc(`goal-tx-${i}`, rt, bottom ? deg + 60 : deg - 60, bottom ? deg - 60 : deg + 60, sweep)}</defs>`
        + `<use href="#goal-bg-${i}" class="goal-arc-bg"/><text class="goal-arc-text"><textPath href="#goal-tx-${i}" startOffset="50%" text-anchor="middle">${esc(o.label)}</textPath></text></g>`;
    }).join('');
    return `<svg class="goal-arcs" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" aria-hidden="true">${items}</svg>`;
  }

  function goalRadialMarkup() {
    const chosen = prefs.goal?.type || 'none';
    const selectedIndex = Math.max(1, GOAL_OPTIONS.findIndex((o) => o.value === chosen) + 1);
    const chosenLabel = GOAL_OPTIONS.find((o) => o.value === chosen)?.label || '';
    return `<div class="goal-radial" style="--options:${GOAL_OPTIONS.length};--selected:${selectedIndex}">
      <div class="goal-options">
        ${GOAL_OPTIONS.map((o, i) => `<label class="goal-option" style="--i:${i + 1}" title="${esc(o.label)}">
          <input class="goal-option-input" type="radio" name="goal-option" value="${o.value}" aria-label="${esc(o.label)}" ${chosen === o.value ? 'checked' : ''}>
          <span class="goal-option-inner">${o.icon}</span>
        </label>`).join('')}
      </div>
      ${goalArcLabels(chosen)}
      <div class="goal-menu-ring" aria-hidden="true"></div>
      <div class="goal-selector-light" aria-hidden="true"></div>
      <div class="goal-btn">
        <span class="goal-btn-icon">${GOAL_ICONS[chosen]}</span>
        <span class="goal-btn-x">${X_ICON}</span>
        <input class="goal-menu-input" type="checkbox" aria-label="Elegir objetivo">
      </div>
    </div>`;
  }

  function bindGoalRadial(box, onSaved) {
    const radial = $('.goal-radial', box), toggle = $('.goal-menu-input', box), panel = $('.goal-panel', box), row = radial ? radial.parentElement : null;
    if (!radial || !toggle || !panel) return;
    const texts = [...radial.querySelectorAll('.goal-arc')];
    const inputs = [...radial.querySelectorAll('.goal-option-input')];
    const mark = (value) => texts.forEach((t) => t.classList.toggle('is-active', t.dataset.value === value));
    const chosenValue = () => { const c = radial.querySelector('.goal-option-input:checked'); return c ? c.value : 'none'; };
    let keepOpenUntil = 0;
    const close = () => { toggle.checked = false; place(); };

    // Panel de valor: se queda encima del menú y su contenido cambia con cada opción que toques.
    function drawPanel(type) {
      const opt = GOAL_OPTIONS.find((o) => o.value === type) || GOAL_OPTIONS[0];
      const current = prefs.goal && prefs.goal.type === type ? prefs.goal.value : '';
      const field = type === 'none'
        ? '<p class="goal-panel__hint">Correrás sin objetivo.</p>'
        : `<label>${type === 'distance' ? 'Distancia objetivo (km)' : 'Duración objetivo (minutos)'}<input id="goal-panel-input" type="number" min="0.1" step="0.1" inputmode="decimal" value="${esc(String(current))}" placeholder="${type === 'distance' ? '5' : '30'}"></label>`;
      panel.innerHTML = `<b class="goal-panel__title">${esc(opt.label)}</b>${field}<button class="btn" type="button" id="goal-panel-save">${type === 'none' ? 'Listo' : 'Guardar objetivo'}</button>`;
      panel.classList.remove('is-swap'); void panel.offsetWidth; panel.classList.add('is-swap');
      $('#goal-panel-save', panel).onclick = () => {
        if (type === 'none') { prefs.goal = null; }
        else {
          const value = Number($('#goal-panel-input', panel).value);
          if (!(value > 0)) { notify('Indica un objetivo válido.'); return; }
          prefs.goal = { type, value };
        }
        savePreferences(userId, prefs); close(); onSaved();
      };
    }

    // Al abrir: el menú se centra en la fila, los demás controles se atenúan y aparece el panel.
    function place() {
      let shift = 0;
      if (toggle.checked && row) { const r = radial.getBoundingClientRect(), w = row.getBoundingClientRect(); shift = (w.left + w.width / 2) - (r.left + r.width / 2); }
      radial.style.setProperty('--shift', `${Math.round(shift)}px`);
      mark(chosenValue());
      panel.hidden = !toggle.checked;
      if (toggle.checked) drawPanel(chosenValue());
    }
    toggle.addEventListener('change', place);

    // Tocar el nombre equivale a tocar su icono: selecciona, no cierra.
    radial.querySelectorAll('.goal-arc').forEach((g) => {
      g.addEventListener('click', () => { const inp = radial.querySelector(`.goal-option-input[value="${g.dataset.value}"]`); if (inp) inp.click(); });
    });
    radial.querySelectorAll('.goal-option').forEach((label) => {
      const input = label.querySelector('input');
      label.addEventListener('pointerenter', () => mark(input.value));
      label.addEventListener('pointerleave', () => mark(chosenValue()));
      input.onclick = () => {
        // El color se mueve a la opción tocada y el panel cambia de contenido; el menú sigue abierto para poder elegir otra.
        radial.style.setProperty('--selected', inputs.indexOf(input) + 1);
        toggle.checked = true; panel.hidden = false;   // elegir una opción nunca cierra el menú
        keepOpenUntil = Date.now() + 500;
        mark(input.value); drawPanel(input.value);
      };
    });
    document.addEventListener('pointerdown', (e) => { const path = e.composedPath ? e.composedPath() : []; if (toggle.checked && Date.now() > keepOpenUntil && !path.includes(radial) && !path.includes(panel) && !radial.contains(e.target) && !panel.contains(e.target)) close(); });
  }

  function settingsToggleFields(prefix) {
    return `<label>Distancia<select id="${prefix}-unit"><option value="km">Kilómetros</option><option value="mi">Millas</option></select></label>
      <label class="run-check"><input id="${prefix}-announce" type="checkbox" ${prefs.announce?'checked':''}> Avisar cada kilómetro</label>
      <label class="run-check"><input id="${prefix}-voice" type="checkbox" ${prefs.voice?'checked':''}> Comentarios en audio</label>
      <label class="run-check"><input id="${prefix}-wakelock" type="checkbox" ${prefs.wakeLock?'checked':''}> Mantener la pantalla encendida</label>
      <label class="run-check"><input id="${prefix}-showmap" type="checkbox" ${prefs.showMap?'checked':''}> Mostrar mapa al pausar</label>`;
  }

  function bindSettingsToggleFields(root, prefix, onChange) {
    const unit = $(`#${prefix}-unit`, root); if (unit) { unit.value = prefs.unit; unit.onchange = () => { prefs.unit = unit.value; savePreferences(userId, prefs); onChange?.(); }; }
    const bind = (key, id) => { const el = $(`#${prefix}-${id}`, root); if (el) el.onchange = () => { prefs[key] = el.checked; savePreferences(userId, prefs); if (key === 'wakeLock') applyWakeLock(); onChange?.(); }; };
    bind('announce', 'announce'); bind('voice', 'voice'); bind('wakeLock', 'wakelock'); bind('showMap', 'showmap');
  }

  function renderRunScreen(box) {

    const state = tracker.state;

    if (!state) {

      box.innerHTML = `<div class="run-prep-card">
        <div class="run-map-wrap run-map-wrap--boxed run-map-wrap--static">
          <div id="run-map-live" class="run-map run-map--boxed run-map--static" role="img" aria-label="Mapa de ubicación"></div>
          <div class="run-map__fade run-map__fade--soft" aria-hidden="true"></div>
          <p class="run-map__error" hidden>No se pudieron cargar los mosaicos del mapa. Intenta de nuevo con conexión.</p>
          <div class="run-prep-overlay">
            <div class="goal-backdrop" aria-hidden="true"></div>
            <div class="goal-panel" hidden></div>
            <div class="run-prep-controls">
              <button type="button" class="run-icon-btn" id="run-settings-open" aria-label="Ajustes">${SETTINGS_ICON}</button>
              <button type="button" class="run-circle-btn run-circle-btn--start" id="run-start"><span>COMENZAR</span></button>
              ${goalRadialMarkup()}
            </div>
          </div>
        </div>
        <div class="run-plan-route"><div><b>Ruta de hoy</b><small id="run-plan-info">${esc(routeSummary(planned()))}${planned() ? '' : ' · opcional'}</small></div><span><button type="button" class="btn sm ghost" id="run-plan-route">${planned() ? 'Cambiar' : 'Marcar de dónde a dónde'}</button>${planned() ? '<button type="button" class="btn sm ghost" id="run-plan-clear">Quitar</button>' : ''}</span></div>
        <details class="card run-manual-card"><summary>Registrar manualmente</summary><form id="run-manual-form">${manualFormMarkup()}</form></details>
        <p id="run-gps-hint" class="run-note">GPS requiere HTTPS y permiso de ubicación.</p>
      </div>`;

      shownStatus = null;
      mapController = mountMap($('#run-map-live', box), [], { zoomControl: false, interactive: false, ghost: ghostPts() });
      $('#run-plan-route', box).onclick = async () => { const out = await openRoutePicker({ route: planned(), title: 'Ruta de hoy (opcional)', allowRemove: true }); if (!out) return; setPlannedRoute(userId, out.route ? { ...out.route, set_at: Date.now() } : null); renderRunScreen(box); };
      const clearPlan = $('#run-plan-clear', box); if (clearPlan) clearPlan.onclick = () => { setPlannedRoute(userId, null); renderRunScreen(box); };

      $('#run-start', box).onclick = () => { runCountdown(() => { const ok = tracker.start(paint, (message) => { const m = $('#run-live-msg', view); if (m) m.textContent = message; }); if (ok) { page = 'run'; render(); } }); };

      $('#run-settings-open', box).onclick = openSettingsDialog;

      bindGoalRadial(box, () => renderRunScreen(box));

      bindManual($('#run-manual-form', box), null);

      if (navigator.permissions?.query) navigator.permissions.query({ name: 'geolocation' }).then((p) => { const hint = $('#run-gps-hint', box); if (hint) hint.textContent = p.state === 'denied' ? 'Ubicación bloqueada. Habilítala en los permisos del navegador.' : p.state === 'granted' ? 'Permiso GPS concedido · se activará al iniciar.' : 'GPS listo · se pedirá permiso al iniciar.'; }).catch(() => {});

      return;
    }

    if (state.status === 'paused') {

      const elevation = elevationGain(state.segments || []);

      box.innerHTML = `<section class="card run-paused">
        ${prefs.showMap ? `<div class="run-map-wrap run-map-wrap--boxed"><div id="run-map-live" class="run-map run-map--boxed" aria-label="Recorrido hasta ahora"></div><div class="run-map__fade" aria-hidden="true"></div></div>` : '<div class="card run-map-hidden">Mapa oculto (actívalo en Ajustes).</div>'}
        <p class="run-live__label">ACTIVIDAD PAUSADA</p>
        <div class="run-paused-stats">
          <article><b id="run-live-distance">${fmt(tracker.distanceKm(),2)}</b><span>km</span></article>
          <article><b id="run-live-time">${durationLabel(tracker.elapsedSeconds())}</b><span>Tiempo</span></article>
          <article><b id="run-live-pace">${kmPace(tracker.distanceKm(),tracker.elapsedSeconds()/60)}</b><span>Ritmo</span></article>
          <article><b id="run-elevation">${elevation===null?'—':elevation+' m'}</b><span>Elevación</span></article>
        </div>
        <div class="run-paused-actions">
          <button type="button" class="run-circle-btn run-circle-btn--ghost" id="run-discard" aria-label="Descartar carrera">✕</button>
          <button type="button" class="run-circle-btn run-circle-btn--start" id="run-resume" aria-label="Reanudar carrera">►</button>
        </div>
        <p class="msg" id="run-live-msg" aria-live="polite">Consejo: deja la pantalla encendida. Si la bloqueas, el GPS se pausa y ese tramo se estima.</p>
      </section>`;

      shownStatus = state.status;
      if (prefs.showMap) mapController = mountMap($('#run-map-live', box), state.segments || [], { ghost: ghostPts() });

      $('#run-resume', box).onclick = () => { tracker.resume(paint, showGpsError); applyWakeLock(); render(); };
      $('#run-discard', box).onclick = async () => { if (await confirmDialog('Se eliminará el borrador local de esta carrera.', 'Descartar actividad')) { applyWakeLock(); tracker.discard(); page = 'run'; render(); } };

      tracker.restore(paint, showGpsError); paint();
      return;
    }

    // status === 'running'
    box.innerHTML = `<div class="run-counter-stage">
      <div class="run-swipe" id="run-swipe">
        <section class="run-swipe__panel run-swipe__panel--stats"><h3>Parciales</h3>
          <div class="run-stat-rows">
            <div class="run-stat-row"><span>Kilómetro</span><b id="run-live-distance2">${fmt(tracker.distanceKm(),2)}</b></div>
            <div class="run-stat-row"><span>Ritmo prom.</span><b id="run-live-pace2">${kmPace(tracker.distanceKm(),tracker.elapsedSeconds()/60)}</b></div>
            <div class="run-stat-row"><span>Variación</span><b id="run-live-current-pace">—</b></div>
            <div class="run-stat-row"><span>En movimiento*</span><b id="run-live-moving">${durationLabel(tracker.elapsedSeconds())}</b></div>
            <div class="run-stat-row"><span>Precisión GPS</span><b id="run-accuracy">—</b></div>
            <div class="run-stat-row"><span>Señal GPS</span><b id="run-gps-status">${esc(state.gps_status||'')}</b></div>
          </div>
          <p class="run-note">* El tiempo en movimiento se estima con puntos GPS válidos.</p></section>
        <section class="run-swipe__panel run-swipe__panel--counter">
          <div class="run-counter-top">
            <div><b id="run-live-pace">${kmPace(tracker.distanceKm(),tracker.elapsedSeconds()/60)}</b><span>Ritmo</span></div>
            <div><b id="run-live-ppm">--</b><span>PPM</span></div>
            <div><b id="run-live-time">${durationLabel(tracker.elapsedSeconds())}</b><span>Tiempo</span></div>
          </div>
          <div class="run-counter-main">
            <div class="run-counter"><b id="run-live-distance">${fmt(tracker.distanceKm(),2)}</b></div>
            <span class="run-counter-unit">kilómetros</span>
            ${renderGoalProgress(state)}
          </div>
          <div class="run-counter-bottom">
            <div class="run-actions">
              <div class="run-action"><button class="run-circle-btn run-circle-btn--big" id="run-pause" type="button" aria-label="Pausar"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg></button><span>Pausar</span></div>
              <div class="run-action"><button class="run-circle-btn run-circle-btn--big run-circle-btn--outline" id="run-finish" type="button" aria-label="Finalizar"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg></button><span>Finalizar</span></div>
            </div>
            <p class="msg" id="run-live-msg" aria-live="polite"></p>
          </div>
        </section>
        <section class="run-swipe__panel run-swipe__panel--map run-maptools">
          <div id="run-map-live" class="run-map run-map--full" aria-label="Tu recorrido"></div>
          ${mapToolsMarkup()}
          <button type="button" class="run-pagearrow run-pagearrow--l" data-goto="1" aria-label="Ir al contador"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg></button>
          <button type="button" class="run-pagearrow run-pagearrow--r" data-goto="3" aria-label="Ir a configuración"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button>
          <div class="run-map-keystats"><div><b id="run-live-distance3">${fmt(tracker.distanceKm(),2)}</b><span>km</span></div><div><b id="run-live-time3">${durationLabel(tracker.elapsedSeconds())}</b><span>Tiempo</span></div><div><b id="run-live-pace3">${kmPace(tracker.distanceKm(),tracker.elapsedSeconds()/60)}</b><span>Ritmo</span></div></div>
        </section>
        <section class="run-swipe__panel run-swipe__panel--config"><h3>Configuración</h3>${settingsToggleFields('cfg')}<button class="link run-discard" id="run-discard" type="button">Descartar carrera</button></section>
      </div>
      <div class="run-swipe-dots" aria-hidden="true"><i></i><i class="on"></i><i></i><i></i></div>
    </div>`;

    bindSettingsToggleFields(box, 'cfg');
    shownStatus = state.status;
    mapController = mountMap($('#run-map-live', box), state.segments || [], { ghost: ghostPts() });
    if (planned()) $('.run-maptools', box).classList.add('has-route'); // con ruta asignada no se dibuja otra
    mountMapTools($('.run-maptools', box), { mapPromise: mapController, supabase, userId, userName: (ctx.profile?.full_name || ctx.user?.user_metadata?.full_name || '').trim(), isAdmin: !!ctx.isAdmin, notify });

    const swipe = $('#run-swipe', box);
    requestAnimationFrame(() => { swipe.scrollLeft = swipe.clientWidth; });
    const dots = box.querySelectorAll('.run-swipe-dots i');
    box.querySelectorAll('[data-goto]').forEach((b) => (b.onclick = () => swipe.scrollTo({ left: swipe.clientWidth * Number(b.dataset.goto), behavior: 'smooth' })));
    swipe.addEventListener('scroll', () => { const idx = Math.round(swipe.scrollLeft / Math.max(1, swipe.clientWidth)); dots.forEach((dot, i) => dot.classList.toggle('on', i === idx)); }, { passive: true });

    $('#run-pause', box).onclick = () => { tracker.pause(); applyWakeLock(); render(); };
    $('#run-finish', box).onclick = async () => { if (!(await confirmDialog('Finalizar y revisar esta carrera. Todavía podrás descartarla antes de guardar.', 'Finalizar carrera'))) return; const result = tracker.finish(); applyWakeLock(); if (!result) { notify('No se pudo finalizar la carrera.'); return; } if (result.distance_km < .01) { notify('La ruta tiene menos de 10 metros válidos. Puedes descartarla o revisar los datos GPS.'); } page = 'review'; render(); };
    $('#run-discard', box).onclick = async () => { if (await confirmDialog('Se eliminará el borrador local de esta carrera.', 'Descartar actividad')) { applyWakeLock(); tracker.discard(); page = 'run'; render(); } };

    tracker.restore(paint, showGpsError); paint(); applyWakeLock();
    document.addEventListener('visibilitychange', onVisibility, { once: true });

  }

  let wakeLock = null;
  async function applyWakeLock() {
    try {
      if (prefs.wakeLock && tracker.state?.status === 'running' && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        if (!wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      } else if (wakeLock) { await wakeLock.release().catch(() => {}); wakeLock = null; }
    } catch { wakeLock = null; /* pantalla encendida es una comodidad, no algo crítico */ }
  }
  // iOS solo concede el bloqueo tras un toque del usuario: se reintenta en el primer toque si se perdió.
  document.addEventListener('pointerdown', () => { if (!wakeLock) applyWakeLock(); }, { passive: true });
  function speak(text) {
    if (!prefs.voice || !('speechSynthesis' in window)) return;
    try { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'es-BO'; window.speechSynthesis.speak(u); } catch { /* ignorar */ }
  }

  function runCountdown(done) {
    const host = document.createElement('div'); host.className = 'run-countdown'; host.setAttribute('role','status'); host.setAttribute('aria-live','assertive');
    document.body.appendChild(host);
    let n = 3;
    const tick = () => {
      if (n <= 0) { host.classList.add('is-go'); host.textContent = '¡Vamos!'; setTimeout(() => { host.remove(); done(); }, 450); return; }
      host.textContent = String(n); n -= 1; setTimeout(tick, 800);
    };
    tick();
  }

  function openSettingsDialog() {
    const dlg = document.createElement('dialog'); dlg.className = 'run-detail-dialog';
    dlg.innerHTML = `<div class="run-detail-sheet"><button class="link run-detail-close" type="button" id="settings-close">Cerrar</button><h2>Ajustes de carrera</h2>${settingsToggleFields('settings')}</div>`;
    document.body.append(dlg); dlg.showModal();
    bindSettingsToggleFields(dlg, 'settings');
    $('#settings-close', dlg).onclick = () => dlg.close();
    dlg.addEventListener('close', () => dlg.remove());
  }

  function openGoalValueDialog(type, onSaved) {
    const dlg = document.createElement('dialog'); dlg.className = 'run-detail-dialog';
    const label = type === 'distance' ? 'Distancia objetivo (km)' : 'Duración objetivo (minutos)';
    const current = prefs.goal?.type === type ? prefs.goal.value : '';
    dlg.innerHTML = `<div class="run-detail-sheet"><button class="link run-detail-close" type="button" id="goalval-close">Cerrar</button><h2>${esc(label)}</h2>
      <label><input id="goalval-input" type="number" min="0.1" step="0.1" inputmode="decimal" value="${esc(String(current))}" placeholder="${type === 'distance' ? '5' : '30'}"></label>
      <button class="btn" id="goalval-save" type="button">Guardar objetivo</button></div>`;
    document.body.append(dlg); dlg.showModal();
    $('#goalval-input', dlg).focus();
    $('#goalval-close', dlg).onclick = () => dlg.close();
    $('#goalval-save', dlg).onclick = () => {
      const value = Number($('#goalval-input', dlg).value);
      if (!(value > 0)) { notify('Indica un objetivo válido.'); return; }
      prefs.goal = { type, value }; savePreferences(userId, prefs);
      dlg.close(); onSaved();
    };
    dlg.addEventListener('close', () => dlg.remove());
  }

  function openManualDialog(activity) {
    const dlg = document.createElement('dialog'); dlg.className = 'run-detail-dialog';
    dlg.innerHTML = `<form class="run-detail-sheet" id="manual-dialog-form">${manualFormMarkup(activity)}</form>`;
    document.body.append(dlg); dlg.showModal(); bindManual($('#manual-dialog-form', dlg), activity);
    dlg.addEventListener('close', () => dlg.remove());
  }

  function renderGoalProgress(state) {

    const goal=prefs.goal;if(!goal)return '';

    const current=goal.type==='distance'?tracker.distanceKm():tracker.elapsedSeconds()/60,ratio=Math.min(100,current/goal.value*100);

    return `<div class="run-goal-progress"><div><b>Objetivo ${goal.type==='distance'?'de distancia':'de duración'}</b><span>${fmt(current,1)} / ${fmt(goal.value,1)} ${goal.type==='distance'?'km':'min'}</span></div><progress max="100" value="${ratio}"></progress></div>`;

  }

  let hiddenAt = 0;
  function onVisibility(){
    const running = tracker.state?.status === 'running', msg = $('#run-live-msg', view);
    if (document.visibilityState === 'hidden' && running) { hiddenAt = Date.now(); }
    if (document.visibilityState === 'visible' && running) {
      applyWakeLock();
      const away = hiddenAt ? Math.round((Date.now() - hiddenAt) / 1000) : 0; hiddenAt = 0;
      tracker.refresh(paint, showGpsError);                       // reinicia el GPS: el anterior pudo quedar dormido
      if (away >= 20 && msg) msg.textContent = `La pantalla estuvo apagada ${away >= 120 ? Math.round(away / 60) + ' min' : away + ' s'}. El tiempo se contó completo; el tramo sin GPS se estima con una línea punteada.`;
    }
    document.addEventListener('visibilitychange', onVisibility, { once: true });
  }

  function showGpsError(message){const el=$('#run-live-msg',view);if(el)el.textContent=message;}

  let announcedKm=0;

  function paint(){

    const state=tracker.state;if(!state)return;

    if(state.auto_notice){notify(state.auto_notice,'info');delete state.auto_notice;}
    if(shownStatus&&state.status!==shownStatus&&page==='run'&&(state.status==='running'||state.status==='paused')){applyWakeLock();render();return;}

    const seconds=tracker.elapsedSeconds(),km=tracker.distanceKm(),flat=tracker.points();

    const write=(id,value)=>{const node=$(`#${id}`,view);if(node)node.textContent=value;};

    write('run-live-time',durationLabel(seconds));write('run-live-distance',fmt(prefs.unit==='mi'?km*.621371:km,2));const distUnit=prefs.unit==='mi'?'mi':'km';const unitNode=$('.run-counter-unit',view);if(unitNode)unitNode.textContent=prefs.unit==='mi'?'millas':'kilómetros';write('run-live-pace',kmPace(prefs.unit==='mi'?km*.621371:km,seconds/60));write('run-gps-status',state.gps_status);write('run-live-distance2',fmt(prefs.unit==='mi'?km*.621371:km,2));write('run-live-pace2',`${kmPace(prefs.unit==='mi'?km*.621371:km,seconds/60)} min/${distUnit}`);write('run-live-distance3',fmt(prefs.unit==='mi'?km*.621371:km,2));write('run-live-time3',durationLabel(seconds));write('run-live-pace3',kmPace(prefs.unit==='mi'?km*.621371:km,seconds/60));

    const acc=flat.at(-1)?.accuracy;write('run-accuracy',acc?`Precisión ${acc} m`: '');

    write('run-live-moving',durationLabel(state.moving_time_sec||0));

    const segment=state.segments?.at(-1)||[],end=segment.at(-1),start=segment[Math.max(0,segment.length-4)];

    if(end&&start&&end.at>start.at){const current=kmPace(Math.max(.001,Math.round(earthDistance(start,end))/1000*(prefs.unit==='mi' ? 0.621371 : 1)),(end.at-start.at)/60000);write('run-live-current-pace',`${current} min/${distUnit}`);}

    const threshold=Math.floor(km);if(threshold>announcedKm){announcedKm=threshold;if(prefs.announce)notify(`Kilómetro ${threshold} · ritmo medio ${kmPace(km,seconds/60)}`);if(prefs.voice)speak(`Kilómetro ${threshold}. Ritmo medio ${kmPace(km,seconds/60).replace(':',' con ')} minutos por kilómetro.`);}

    if(mapController?.then) mapController.then(({update})=>update?.(state.segments||[]));
    if(state.status==='running'&&!planned()&&Date.now()-lastMatchAt>8000){lastMatchAt=Date.now();const m=matchLiveRoute(state.segments||[],knownRuns);if(m&&m.activity.id!==shownMatchId){shownMatchId=m.activity.id;const times=findRouteMatches(activityRoute(m.activity),activities,m.activity.id).length+1;mapController?.then(c=>c.setGhost?.(m.pts.map(q=>[q.lat,q.lon])));notify(`Ruta conocida: ${m.activity.activity_name||'carrera anterior'} · ya la corriste ${times} ${times===1?'vez':'veces'}. Se marca en el mapa.`,'info');}}

  }

  function earthDistance(a,b){return distanceBetween(a,b);}

  function manualFormMarkup(activity=null){return `<h2>${activity?'Editar actividad':'Registro manual'}</h2><input name="id" type="hidden" value="${esc(activity?.id||'')}"><label>Nombre<input name="activity_name" maxlength="100" value="${esc(activity?.activity_name||'')}" placeholder="Carrera matutina"></label><div class="row"><label>Fecha<input name="performed_on" type="date" max="${today()}" required value="${esc(activity?.performed_on||today())}"></label><label>Tipo<select name="run_type"><option value="">Sin especificar</option>${RUN_TYPES.map(([v,t])=>`<option value="${v}" ${activity?.run_type===v?'selected':''}>${esc(t)}</option>`).join('')}</select></label></div><div class="row"><label>Distancia (km)<input name="distance_km" type="number" min="0.01" max="999.99" step="0.01" inputmode="decimal" required ${activity?.tracking_source==='gps'?'readonly':''} value="${esc(activity?.distance_km??'')}"></label><label>Duración (h:mm:ss)<input name="duration" type="text" inputmode="numeric" placeholder="0:30:00" ${activity?.tracking_source==='gps'?'readonly':''} pattern="(?:[0-9]+:)?[0-5]?[0-9]:[0-5][0-9]" required value="${activity?.duration_min?durationLabel(durationOf(activity)):''}"></label></div><div class="row"><label>Desnivel (m)<input name="elevation_m" type="number" min="0" max="10000" step="1" value="${esc(activity?.elevation_m??'')}"></label><label>Esfuerzo (1–10)<select name="rpe"><option value="">Sin indicar</option>${[1,2,3,4,5,6,7,8,9,10].map(n=>`<option value="${n}" ${Number(activity?.rpe)===n?'selected':''}>${n}</option>`).join('')}</select></label></div><div class="row"><label>Superficie<select name="surface"><option value="">Sin especificar</option>${['Asfalto','Tierra','Pista','Montaña','Otra'].map(x=>`<option ${activity?.surface===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Notas<input name="notes" maxlength="1000" value="${esc(activity?.notes||'')}"></label></div><label>Fotos (hasta 3)<input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><p class="run-manual-pace muted" aria-live="polite">Ritmo: —</p><div class="quick-actions"><button class="btn" type="submit">${activity?'Guardar cambios':'Guardar carrera'}</button><button class="btn ghost" type="button" data-cancel-manual>Cancelar</button></div>`;}

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

    box.innerHTML=`<section class="run-review"><div class="run-review__intro"><span class="run-live__label">REVISIÓN · GPS</span><p>Comprueba los resultados y añade los detalles que quieras antes de guardar.</p>${tooShort?'<p class="card warn">La distancia válida aún no alcanza 0,01 km. Vuelve a Correr y reanuda para registrar más recorrido.</p>':''}<p>${esc(localDate(result.started_at))} · ${new Intl.DateTimeFormat('es-BO',{hour:'2-digit',minute:'2-digit'}).format(new Date(result.started_at))} · GPS</p></div><div id="run-review-extra"></div><div class="run-map-wrap"><div id="run-map-review" class="run-map run-map--review" aria-label="Recorrido GPS de la carrera"></div><button type="button" class="run-map__locate" id="review-center">Centrar recorrido</button></div><div class="run-review-stats"><article class="card"><b>${fmt(km,2)} km</b><span>Distancia</span></article><article class="card"><b>${durationLabel(result.duration_sec)}</b><span>Tiempo total</span></article><article class="card"><b>${durationLabel(metrics.moving_sec)}</b><span>En movimiento*</span></article><article class="card"><b>${kmPace(km,result.duration_sec/60)}</b><span>Ritmo medio</span></article><article class="card"><b>${fastestSplit?`${durationLabel(fastestSplit.seconds)}`:'—'}</b><span>Mejor parcial de 1 km</span></article><article class="card"><b>${elevation??'—'}${elevation===null?'':' m'}</b><span>Desnivel positivo GPS</span></article></div>${metrics.splits.length?`<details class="card run-splits"><summary>Parciales (${metrics.splits.length})</summary>${metrics.splits.map(s=>`<div><span>${s.km==='Final'?'Tramo final':`Km ${s.km}`}</span><b>${durationLabel(s.seconds)}</b><small>${kmPace(s.distance_m/1000,s.seconds/60)} min/km</small></div>`).join('')}</details>`:''}<form id="run-review-form" class="card run-review-form"><label>Nombre de actividad<input name="activity_name" maxlength="100" placeholder="Carrera matutina" value=""></label><div class="row"><label>Tipo<select name="run_type"><option value="">Sin especificar</option>${RUN_TYPES.map(([v,t])=>`<option value="${v}">${esc(t)}</option>`).join('')}</select></label><label>Esfuerzo (1–10)<select name="rpe"><option value="">Sin indicar</option>${[1,2,3,4,5,6,7,8,9,10].map(n=>`<option value="${n}">${n}</option>`).join('')}</select></label></div><label>Superficie · opcional<select name="surface"><option value="">Sin especificar</option>${['Asfalto','Tierra','Pista','Montaña','Otra'].map(x=>`<option>${x}</option>`).join('')}</select></label><label>Notas personales<textarea name="notes" rows="3" maxlength="1000" placeholder="¿Cómo te sentiste?"></textarea></label><label>Fotos o video · opcional, hasta 3<input name="photos" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple></label>${sessionMediaMarkup(ctx,'running',{reuse:true})}${shareSectionMarkup({titlePlaceholder:'Carrera de mañana'})}<p class="muted">* Tiempo en movimiento estimado a partir de los intervalos GPS. Privada por defecto.</p><p class="msg" id="review-msg" aria-live="polite"></p><div class="run-review-actions"><button class="btn" type="submit" id="review-save" ${tooShort?'disabled':''}>Guardar actividad</button><button class="btn ghost" type="button" id="review-back">Volver a revisar</button><button class="link" type="button" id="review-discard">Descartar carrera</button></div></form></section>`;

    bindShareSection($('#run-review-form',box),{route:result.route_segments});
    mapController=mountMap($('#run-map-review',box),result.route_segments,{ghost:ghostPts()});
    {const parts=[];if(result.trimmed_sec>=60)parts.push(`<p class="card warn">Parece que olvidaste pausar: se recortaron ${durationLabel(result.trimmed_sec)} finales sin movimiento y el tiempo total se ajustó.</p>`);const matches=findRouteMatches(result.route_segments,activities);if(matches.length){const best=[...matches].sort((a,b)=>durationOf(a)-durationOf(b))[0],bestT=durationOf(best),diff=result.duration_sec-bestT;parts.push(`<p class="card route-match"><b>Ruta repetida · ${matches.length+1}.ª vez</b><span>Mejor tiempo en esta ruta: ${durationLabel(bestT)} (${esc(best.performed_on)}). ${diff<=0?'¡Nuevo récord en esta ruta!':'Hoy +'+durationLabel(diff)+'.'}</span></p>`);}const pl=planned();if(pl)parts.push(`<p class="card route-match"><b>Ruta marcada</b><span>Cubriste el ${Math.round(coverage(pl,result.route_segments)*100)}% de la ruta de ${pl.distance_km} km.</span></p>`);const ex=$('#run-review-extra',box);if(ex)ex.innerHTML=parts.join('');}

    $('#review-center',box).onclick=()=>mapController?.then(({recenter})=>recenter());

    $('#review-back',box).onclick=()=>{tracker.returnToPause();setPage('run');};

    $('#review-discard',box).onclick=async()=>{if(await confirmDialog('Esta carrera GPS se eliminará y no aparecerá en tu historial.','Descartar carrera')){tracker.discard();page='run';render();}};

    $('#run-review-form',box).onsubmit=async(e)=>{e.preventDefault();if(saving||tooShort)return;saving=true;const button=$('#review-save',box);button.disabled=true;const form=e.currentTarget;let photos=[],share=null,savedRow=null,savedRowData=null;try{photos=await uploadRunPhotos(userId,Array.from(form.elements.photos.files).filter(f=>f.type.startsWith('image/')));const row={discipline:'running',performed_on:localDate(result.started_at),distance_km:km,duration_min:Math.max(.1,Number((result.duration_sec/60).toFixed(1))),duration_seconds:result.duration_sec,activity_name:form.elements.activity_name.value.trim()||'Carrera GPS',run_type:form.elements.run_type.value||null,rpe:num(form.elements.rpe.value),surface:form.elements.surface.value||null,notes:form.elements.notes.value.trim()||null,route_points:result.route_points,route_segments:result.route_segments,split_data:metrics.splits,moving_time_sec:Math.round(metrics.moving_sec),started_at:new Date(result.started_at).toISOString(),activity_photos:photos,tracking_source:'gps'};share=readShare(form,row.activity_name);savedRowData=row;const {data:inserted,error:saveError}=await supabase.from('activities').insert(row).select('id').single();savedRow=inserted;if(saveError){if(photos.length)await supabase.storage.from('profile-media').remove(photos);throw new Error(saveError.message);}}catch(saveError){saving=false;button.disabled=false;$('#review-msg',box).textContent=`No se guardó. Tu borrador se conserva para reintentar: ${saveError.message}`;return;}let shareError=null;if(share){const stats={distance_km:km,duration_sec:result.duration_sec,elevation_m:elevation,moving_sec:Math.round(metrics.moving_sec),logros:activityLogros({kind:'running',distanceKm:km,durationMin:result.duration_sec/60,previous:activities})};({error:shareError}=await publishShare(userId,{kind:'running',sourceId:savedRow?.id,performedOn:savedRowData.performed_on,stats,route:result.route_segments,share}));}let mediaError=null;try{({error:mediaError}=await saveSessionMedia(ctx,readSessionMedia(form),{kind:'running',ref:savedRow?.id}));}catch(mediaFail){mediaError=mediaFail;}if(mediaError)notify(`Carrera guardada, pero la foto de la sesión no se subió: ${mediaError.message}`);tracker.discard();await refreshActivities();if(share&&!shareError){notify('Carrera guardada y compartida.','success');saving=false;page='feed';render();return;}notify(shareError?`Carrera guardada, pero no se pudo compartir: ${shareError.message}`:'Carrera guardada.',shareError?'error':'success');saving=false;page='history';render();};

  }

  function elevationGain(segments){const groups=Array.isArray(segments?.[0])?segments:[segments||[]];let samples=0,total=0;for(const segment of groups)for(let i=1;i<segment.length;i++){const before=segment[i-1].elevation,after=segment[i].elevation;if(!Number.isFinite(before)||!Number.isFinite(after))continue;samples++;const rise=after-before;if(rise>1&&rise<20)total+=rise;}return samples>=5?Math.round(total):null;}

  function renderProgress(box){

    const rows=summary(period), totalKm=rows.reduce((n,a)=>n+Number(a.distance_km||0),0), totalSec=rows.reduce((n,a)=>n+durationOf(a),0), totalMin=totalSec/60, bestDistance=[...activities].sort((a,b)=>b.distance_km-a.distance_km)[0];

    const eight=[];const now=new Date();for(let i=7;i>=0;i--){const d=new Date(now);d.setDate(d.getDate()-((d.getDay()+6)%7)-i*7);d.setHours(12,0,0,0);const start=d.toISOString().slice(0,10),end=new Date(d);end.setDate(end.getDate()+7);const endIso=end.toISOString().slice(0,10);const items=activities.filter(a=>a.performed_on>=start&&a.performed_on<endIso);eight.push({start,end:endIso.slice(5),km:items.reduce((n,a)=>n+Number(a.distance_km||0),0),items});}

    const max=Math.max(1,...eight.map(x=>x.km)),selectedWeekIndex=eight.findIndex(w=>w.start===selectedWeek),weekDelta=selectedWeekIndex>0?eight[selectedWeekIndex].km-eight[selectedWeekIndex-1].km:0;

    box.innerHTML=`<div id="run-coach"></div><div class="run-progress"><div class="run-period" role="group" aria-label="Periodo de estadísticas">${[['week','Esta semana'],['month','Este mes'],['all','Todo el tiempo']].map(([v,l])=>`<button type="button" data-period="${v}" class="${period===v?'on':''}">${l}</button>`).join('')}</div><div class="run-progress__stats"><article class="card"><b>${fmt(totalKm,1)} km</b><span>Distancia</span></article><article class="card"><b>${rows.length}</b><span>Carreras</span></article><article class="card"><b>${durationLabel(totalSec)}</b><span>Tiempo total</span></article><article class="card"><b>${kmPace(totalKm,totalMin)}</b><span>Ritmo medio</span></article></div><section class="card run-records"><h2>Récords personales</h2>${bestDistance?`<div><span>Mayor distancia</span><b>${fmt(bestDistance.distance_km)} km</b><time>${esc(bestDistance.performed_on)}</time></div>`:'<p class="muted">Registra carreras para calcular tus récords.</p>'}${[1,5,10].map(k=>{const record=bestSplit(activities,k);return `<div><span>Mejor ${k} km verificable</span><b>${record?durationLabel(record.seconds):'—'}</b><time>${record?esc(record.date):''}</time></div>`;}).join('')}<div><span>Mayor duración</span><b>${activities.length?durationLabel(Math.max(...activities.map(durationOf))):'—'}</b>${activities.length?`<time>${esc([...activities].sort((a,b)=>durationOf(b)-durationOf(a))[0].performed_on)}</time>`:''}</div></section><section class="card run-weekly"><h2>Distancia · últimas 8 semanas</h2><div class="run-weekly__chart" aria-label="Gráfico de kilómetros por semana">${eight.map(w=>`<button class="run-weekly__bar ${selectedWeek===w.start?'selected':''}" type="button" data-week="${w.start}" aria-label="Semana desde ${w.start}: ${fmt(w.km,1)} kilómetros"><i style="height:${Math.max(w.km?4:0,w.km/max*100)}%"></i><b>${fmt(w.km,0)}</b><small>${w.end}</small></button>`).join('')}</div>${selectedWeek?`<div class="run-weekly__detail"><b>Semana desde ${selectedWeek}</b>${selectedWeekIndex>0?`<p>Vs. semana anterior: ${weekDelta>=0?'+':''}${fmt(weekDelta,1)} km</p>`:''}${eight.find(w=>w.start===selectedWeek)?.items.map(a=>`<p>${esc(a.activity_name||'Running')} · ${fmt(a.distance_km)} km · ${esc(a.performed_on)}</p>`).join('')||'<p class="muted">Sin carreras.</p>'}</div>`:''}</section></div>`;

    mountRunCoach(box.querySelector('#run-coach'),ctx);
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

    $('#detail-share',dialog).onclick=async()=>{const text=`${activity.activity_name||'Running'} · ${fmt(activity.distance_km)} km · ${durationLabel(durationOf(activity))} · ${activity.performed_on}`;if(navigator.share){try{await navigator.share({title:'Mi entrenamiento Running',text});}catch(error){if(error.name!=='AbortError')notify('No se pudo compartir el resumen.');}}else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);notify('Resumen listo para pegar.','success');}else notify('Este navegador no ofrece opciones para compartir.');};

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

  view.innerHTML = `<section class="run-module">${BACK_HTML}<header class="run-module__head"><h1>${esc(DISC[discipline])}</h1></header><nav class="tabs sub running-pages"><button class="on">Progreso</button><button id="other-manual-tab">Historial y registro</button></nav><div id="other-content"><div class="run-progress__stats"><article class="card"><b>${fmt(sumDistance(weekRows))} km</b><span>Esta semana</span></article><article class="card"><b>${fmt(sumDistance(monthRows))} km</b><span>Este mes</span></article><article class="card"><b>${records.length}</b><span>Sesiones</span></article><article class="card"><b>${durationLabel(totalSec)}</b><span>Tiempo total</span></article></div><section class="card run-records"><h2>Resumen de ${esc(DISC[discipline])}</h2><p>${metricLabel}: <b>${metricValue}</b></p><p>${fmt(totalKm)} km en ${records.length} registros</p></section><section class="card run-weekly"><h2>Distancia · últimas 8 semanas</h2><div class="run-weekly__chart">${weeks.map(w => `<div class="run-weekly__bar"><i style="height:${Math.max(w.km ? 4 : 0, w.km / maxWeek * 100)}%"></i><b>${fmt(w.km, 0)}</b><small>${w.key.slice(5)}</small></div>`).join('')}</div></section><button class="btn" id="other-open-history">Registrar actividad</button></div></section>`;
  bindBack(view);
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
