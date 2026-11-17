// Herramientas del mapa en pantalla completa durante la carrera:
// buscador de rutas del club, filtros, capas, brújula, "dónde estoy" y dibujo de rutas propias.
import { esc } from '../supabase.js';

const DIFFICULTY = {
  facil: { label: 'Fácil', cls: 'easy' },
  moderada: { label: 'Moderada', cls: 'mid' },
  dificil: { label: 'Difícil', cls: 'hard' },
};
const SURFACE = { asfalto: 'Asfalto', tierra: 'Tierra', pista: 'Pista', montana: 'Montaña', mixta: 'Mixta' };

const LAYERS = [
  { id: 'street', label: 'Calle', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19, attr: '&copy; OpenStreetMap' },
  { id: 'dark', label: 'Oscuro', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', max: 19, attr: '&copy; OpenStreetMap &copy; CARTO' },
  { id: 'terrain', label: 'Relieve', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', max: 17, attr: '&copy; OpenStreetMap, SRTM | OpenTopoMap' },
  { id: 'sat', label: 'Satélite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', max: 19, attr: 'Imágenes &copy; Esri' },
];

const FILTERS = {
  source: { label: 'Rutas', options: [['all', 'Todas'], ['official', 'Oficiales'], ['shared', 'Del club'], ['mine', 'Mías']] },
  length: { label: 'Longitud', options: [['all', 'Todas'], ['s', 'Hasta 5 km'], ['m', '5 – 10 km'], ['l', '10 – 21 km'], ['xl', 'Más de 21 km']] },
  elevation: { label: 'Desnivel', options: [['all', 'Todos'], ['s', 'Hasta 100 m'], ['m', '100 – 300 m'], ['l', 'Más de 300 m']] },
  surface: { label: 'Superficie', options: [['all', 'Todas'], ...Object.entries(SURFACE)] },
  difficulty: { label: 'Dificultad', options: [['all', 'Todas'], ...Object.entries(DIFFICULTY).map(([k, v]) => [k, v.label])] },
};

const fmtKm = (n) => Number(n || 0).toLocaleString('es-BO', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

function matches(route, f, query, userId) {
  const q = query.trim().toLowerCase();
  if (q && !`${route.name} ${route.description || ''} ${route.author_name || ''}`.toLowerCase().includes(q)) return false;
  if (f.source === 'official' && !route.is_official) return false;
  if (f.source === 'shared' && (route.is_official || route.user_id === userId)) return false;
  if (f.source === 'mine' && route.user_id !== userId) return false;
  const km = Number(route.distance_km);
  if (f.length === 's' && !(km <= 5)) return false;
  if (f.length === 'm' && !(km > 5 && km <= 10)) return false;
  if (f.length === 'l' && !(km > 10 && km <= 21)) return false;
  if (f.length === 'xl' && !(km > 21)) return false;
  if (f.elevation !== 'all') {
    const m = route.elevation_gain_m;
    if (m == null) return false;
    if (f.elevation === 's' && !(m <= 100)) return false;
    if (f.elevation === 'm' && !(m > 100 && m <= 300)) return false;
    if (f.elevation === 'l' && !(m > 300)) return false;
  }
  if (f.surface !== 'all' && route.surface !== f.surface) return false;
  if (f.difficulty !== 'all' && route.difficulty !== f.difficulty) return false;
  return true;
}

export const mapToolsMarkup = () => `
  <div class="mt-edge mt-edge--l" aria-hidden="true"></div><div class="mt-edge mt-edge--r" aria-hidden="true"></div>
  <div class="mt-top">
    <label class="mt-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="mt-q" type="search" placeholder="Buscar rutas del club" autocomplete="off" enterkeyhint="search"><button type="button" id="mt-q-clear" aria-label="Borrar búsqueda" hidden>✕</button></label>
    <div class="mt-chips" id="mt-chips">${Object.entries(FILTERS).map(([k, v]) => `<button type="button" class="mt-chip" data-filter="${k}">${v.label}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>`).join('')}</div>
    <div class="mt-menu" id="mt-menu" hidden></div>
  </div>
  <div class="mt-right">
    <button type="button" class="mt-fab mt-compass" id="mt-compass" aria-label="Brújula"><span class="mt-compass__dial"><i></i></span><b>N</b></button>
    <button type="button" class="mt-fab" id="mt-layers" aria-label="Capas del mapa"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/></svg></button>
    <button type="button" class="mt-fab" id="mt-locate" aria-label="Ir a mi ubicación"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></button>
    <button type="button" class="mt-fab" id="mt-draw" aria-label="Dibujar una ruta"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17l-1 3Z"/><path d="m14 7 3 3"/></svg></button>
    <div class="mt-layer-menu" id="mt-layer-menu" hidden></div>
  </div>
  <div class="mt-pad" role="group" aria-label="Mover el mapa"><button type="button" class="mt-arrow mt-arrow--up" data-pan="up" aria-label="Mover mapa up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg></button><button type="button" class="mt-arrow mt-arrow--left" data-pan="left" aria-label="Mover mapa left"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg></button><button type="button" class="mt-arrow mt-arrow--right" data-pan="right" aria-label="Mover mapa right"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg></button><button type="button" class="mt-arrow mt-arrow--down" data-pan="down" aria-label="Mover mapa down"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 10 6 6 6-6"/></svg></button></div>
  <div class="mt-sheet" id="mt-sheet" hidden></div>
  <div class="mt-draw" id="mt-drawbar" hidden></div>`;

export async function mountMapTools(root, { mapPromise, supabase, userId, userName, isAdmin, notify }) {
  const handle = await mapPromise;
  if (!handle || !handle.map || !handle.L) return;
  const { map, L, setBase } = handle;
  const $ = (sel) => root.querySelector(sel);

  const state = { routes: [], loaded: false, error: '', filters: { source: 'all', length: 'all', elevation: 'all', surface: 'all', difficulty: 'all' }, query: '', selected: null, openRoute: null };
  let selectedLayer = null, drawing = false, drawPts = [], drawLine = null, drawDots = [], hereMarker = null;

  /* ---------- Capas del mapa ---------- */
  let layerId = 'street';
  const layerMenu = $('#mt-layer-menu');
  layerMenu.innerHTML = LAYERS.map((l) => `<button type="button" data-layer="${l.id}" class="${l.id === layerId ? 'on' : ''}">${l.label}</button>`).join('');
  $('#mt-layers').onclick = () => { layerMenu.hidden = !layerMenu.hidden; };
  layerMenu.onclick = (e) => {
    const b = e.target.closest('button[data-layer]'); if (!b) return;
    const l = LAYERS.find((x) => x.id === b.dataset.layer); if (!l) return;
    layerId = l.id; setBase(l); layerMenu.hidden = true;
    layerMenu.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.layer === layerId));
    root.classList.toggle('mt-dark', l.id === 'dark' || l.id === 'sat');
  };

  /* ---------- Flechas para mover el mapa (mantener pulsado = seguir moviendo) ---------- */
  root.querySelectorAll('[data-pan]').forEach((b) => {
    const d = b.dataset.pan, step = () => map.panBy([d === 'left' ? -120 : d === 'right' ? 120 : 0, d === 'up' ? -120 : d === 'down' ? 120 : 0], { animate: true, duration: 0.25 });
    let t = 0;
    const stop = () => { clearInterval(t); t = 0; };
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); stop(); step(); t = setInterval(step, 260); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stop));
  });

  /* ---------- Mi ubicación ---------- */
  $('#mt-locate').onclick = () => {
    if (!navigator.geolocation) { notify('Este dispositivo no permite ubicación.'); return; }
    navigator.geolocation.getCurrentPosition((p) => {
      const pos = [p.coords.latitude, p.coords.longitude];
      map.setView(pos, 17, { animate: true });
      if (hereMarker) hereMarker.setLatLng(pos);
      else hereMarker = L.circleMarker(pos, { radius: 8, color: '#fff', weight: 3, fillColor: '#2f7bff', fillOpacity: 1 }).addTo(map);
    }, () => notify('No se pudo obtener tu ubicación.'), { enableHighAccuracy: true, timeout: 10000 });
  };

  /* ---------- Brújula: muestra hacia dónde apunta el teléfono ---------- */
  const dial = $('.mt-compass__dial');
  let compassOn = false;
  const onHeading = (e) => {
    const h = typeof e.webkitCompassHeading === 'number' ? e.webkitCompassHeading : (e.absolute || e.type === 'deviceorientationabsolute') && typeof e.alpha === 'number' ? 360 - e.alpha : null;
    if (h == null) return;
    dial.style.transform = `rotate(${-h}deg)`;
  };
  const startCompass = async (manual) => {
    if (compassOn) return true;
    try {
      if (typeof DeviceOrientationEvent === 'undefined') throw new Error('sin sensor');
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        if (!manual) return false;           // iOS exige un toque del usuario para dar permiso
        const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') { notify('Permiso de brújula denegado.'); return false; }
      }
      window.addEventListener('deviceorientationabsolute', onHeading, true);
      window.addEventListener('deviceorientation', onHeading, true);
      compassOn = true; $('#mt-compass').classList.add('on');
      return true;
    } catch { if (manual) notify('Este dispositivo no tiene brújula.'); return false; }
  };
  $('#mt-compass').onclick = async () => {
    if (compassOn) { dial.style.transform = ''; window.removeEventListener('deviceorientationabsolute', onHeading, true); window.removeEventListener('deviceorientation', onHeading, true); compassOn = false; $('#mt-compass').classList.remove('on'); return; }
    if (await startCompass(true)) notify('Brújula activada: la flecha roja marca el norte.', 'success');
  };
  startCompass(false);

  /* ---------- Rutas: carga, filtros y lista ---------- */
  async function loadRoutes() {
    if (state.loaded) return;
    const { data, error } = await supabase.from('club_routes').select('*').order('created_at', { ascending: false }).limit(300);
    state.loaded = true;
    if (error) { state.error = /club_routes|relation|schema cache/i.test(error.message) ? 'Las rutas del club aún no están activadas (falta aplicar la migración 0020).' : `No se pudieron cargar las rutas: ${error.message}`; state.routes = []; }
    else { state.routes = data || []; state.error = ''; }
  }
  const filtered = () => state.routes.filter((r) => matches(r, state.filters, state.query, userId));
  const sheet = $('#mt-sheet');

  const routeCard = (r) => {
    const d = DIFFICULTY[r.difficulty] || DIFFICULTY.moderada;
    const origin = r.is_official ? 'Ruta oficial' : r.user_id === userId ? 'Tuya' : `Compartida por ${esc(r.author_name || 'un socio')}`;
    return `<button type="button" class="mt-card" data-id="${r.id}">
      <b class="mt-card__name">${esc(r.name)}</b>
      <span class="mt-card__row"><i class="mt-badge mt-badge--${d.cls}">${d.label}</i><span>${fmtKm(r.distance_km)} km${r.elevation_gain_m != null ? ` · ${r.elevation_gain_m} m` : ''} · ${esc(SURFACE[r.surface] || '')}</span></span>
      <span class="mt-card__origin ${r.is_official ? 'is-official' : ''}">${origin}</span>
    </button>`;
  };

  function showList() {
    state.openRoute = null;
    const list = filtered();
    if (state.error) sheet.innerHTML = `<p class="mt-empty">${esc(state.error)}</p>`;
    else if (!state.routes.length) sheet.innerHTML = '<p class="mt-empty">Todavía no hay rutas compartidas. Dibuja la primera con el lápiz.</p>';
    else if (!list.length) sheet.innerHTML = '<p class="mt-empty">Ninguna ruta coincide con tu búsqueda o filtros.</p>';
    else sheet.innerHTML = `<div class="mt-cards">${list.map(routeCard).join('')}</div>`;
    sheet.hidden = false;
  }

  function showDetail(id) {
    const r = state.routes.find((x) => x.id === id); if (!r) return;
    state.openRoute = r;
    const d = DIFFICULTY[r.difficulty] || DIFFICULTY.moderada;
    const origin = r.is_official ? 'Ruta oficial del club' : r.user_id === userId ? 'Creada por ti' : `Compartida por ${esc(r.author_name || 'un socio')}`;
    sheet.innerHTML = `<div class="mt-detail">
      <button type="button" class="mt-detail__back" id="mt-back" aria-label="Volver a la lista">‹</button>
      <b class="mt-detail__name">${esc(r.name)}</b>
      <span class="mt-card__row"><i class="mt-badge mt-badge--${d.cls}">${d.label}</i><span>${origin}</span></span>
      <div class="mt-detail__grid"><div><b>${fmtKm(r.distance_km)} km</b><span>Distancia</span></div><div><b>${r.elevation_gain_m != null ? `${r.elevation_gain_m} m` : '—'}</b><span>Desnivel</span></div><div><b>${esc(SURFACE[r.surface] || '—')}</b><span>Superficie</span></div></div>
      ${r.description ? `<p class="mt-detail__text">${esc(r.description)}</p>` : ''}
      <div class="mt-detail__actions"><button type="button" class="mt-btn mt-btn--solid" id="mt-pick">${state.selected && state.selected.id === r.id ? 'Quitar del mapa' : 'Seleccionar ruta'}</button>${(r.user_id === userId || isAdmin) ? '<button type="button" class="mt-btn" id="mt-del">Eliminar</button>' : ''}</div>
    </div>`;
    sheet.hidden = false;
    $('#mt-back').onclick = showList;
    $('#mt-pick').onclick = () => { if (state.selected && state.selected.id === r.id) clearSelection(); else selectRoute(r); };
    const del = $('#mt-del');
    if (del) del.onclick = async () => {
      if (!window.confirm('¿Eliminar esta ruta para todos?')) return;
      const { error } = await supabase.from('club_routes').delete().eq('id', r.id);
      if (error) { notify(`No se pudo eliminar: ${error.message}`); return; }
      state.routes = state.routes.filter((x) => x.id !== r.id);
      if (state.selected && state.selected.id === r.id) clearSelection();
      showList();
    };
  }

  function selectRoute(r) {
    clearSelection(true);
    const pts = (r.points || []).map((p) => [+p[0], +p[1]]).filter((p) => p.every(Number.isFinite));
    if (pts.length < 2) { notify('Esta ruta no tiene puntos válidos.'); return; }
    selectedLayer = L.featureGroup([
      L.polyline(pts, { color: '#ffffff', weight: 9, opacity: .9 }),
      L.polyline(pts, { color: '#ff5a1f', weight: 5, opacity: 1 }),
      L.circleMarker(pts[0], { radius: 7, color: '#fff', weight: 3, fillColor: '#2fb35a', fillOpacity: 1 }),
      L.circleMarker(pts[pts.length - 1], { radius: 7, color: '#fff', weight: 3, fillColor: '#e23b2e', fillOpacity: 1 }),
    ]).addTo(map);
    map.fitBounds(selectedLayer.getBounds(), { padding: [60, 60], maxZoom: 17 });
    state.selected = r;
    sheet.innerHTML = `<div class="mt-picked"><span><b>${esc(r.name)}</b><small>${fmtKm(r.distance_km)} km marcados en el mapa</small></span><button type="button" class="mt-btn" id="mt-unpick">Quitar</button></div>`;
    sheet.hidden = false;
    $('#mt-unpick').onclick = () => { clearSelection(); sheet.hidden = true; };
  }
  function clearSelection(silent) {
    if (selectedLayer) { map.removeLayer(selectedLayer); selectedLayer = null; }
    state.selected = null;
    if (!silent && !sheet.hidden && sheet.querySelector('.mt-picked')) sheet.hidden = true;
  }

  sheet.addEventListener('click', (e) => { const c = e.target.closest('.mt-card'); if (c) showDetail(c.dataset.id); });

  /* ---------- Buscador ---------- */
  const q = $('#mt-q'), clearBtn = $('#mt-q-clear');
  const openSearch = async () => { await loadRoutes(); if (!drawing) showList(); };
  q.addEventListener('focus', openSearch);
  q.addEventListener('input', async () => { state.query = q.value; clearBtn.hidden = !q.value; await loadRoutes(); if (!drawing) showList(); });
  clearBtn.onclick = () => { q.value = ''; state.query = ''; clearBtn.hidden = true; showList(); };
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') q.blur(); });

  /* ---------- Filtros ---------- */
  const menu = $('#mt-menu');
  let openFilter = null;
  const paintChips = () => root.querySelectorAll('.mt-chip').forEach((c) => {
    const k = c.dataset.filter; const active = state.filters[k] !== 'all';
    c.classList.toggle('is-active', active); c.classList.toggle('is-open', openFilter === k);
    const label = active ? (FILTERS[k].options.find(([v]) => v === state.filters[k]) || [])[1] : FILTERS[k].label;
    c.firstChild.textContent = label;
  });
  $('#mt-chips').onclick = async (e) => {
    const c = e.target.closest('.mt-chip'); if (!c) return;
    const k = c.dataset.filter;
    if (openFilter === k) { openFilter = null; menu.hidden = true; paintChips(); return; }
    openFilter = k;
    menu.innerHTML = FILTERS[k].options.map(([v, l]) => `<button type="button" data-v="${v}" class="${state.filters[k] === v ? 'on' : ''}">${l}</button>`).join('');
    menu.hidden = false; paintChips();
    await loadRoutes();
  };
  menu.onclick = async (e) => {
    const b = e.target.closest('button[data-v]'); if (!b || !openFilter) return;
    state.filters[openFilter] = b.dataset.v; openFilter = null; menu.hidden = true; paintChips();
    await loadRoutes(); if (!drawing) showList();
  };

  /* ---------- Dibujar una ruta ---------- */
  const bar = $('#mt-drawbar');
  const drawKm = () => drawPts.reduce((n, p, i) => (i ? n + L.latLng(drawPts[i - 1]).distanceTo(L.latLng(p)) : 0), 0) / 1000;
  function paintDraw() {
    if (drawLine) { map.removeLayer(drawLine); drawLine = null; }
    drawDots.forEach((d) => map.removeLayer(d)); drawDots = [];
    if (drawPts.length) {
      drawLine = L.polyline(drawPts, { color: '#ff5a1f', weight: 5, dashArray: '2 9', lineCap: 'round' }).addTo(map);
      drawDots = drawPts.map((p, i) => L.circleMarker(p, { radius: i === 0 ? 7 : 4, color: '#fff', weight: 2, fillColor: i === 0 ? '#2fb35a' : '#ff5a1f', fillOpacity: 1 }).addTo(map));
    }
    bar.innerHTML = `<div class="mt-draw__info"><b>${fmtKm(drawKm())} km</b><span>${drawPts.length ? 'Toca el mapa para seguir trazando' : 'Toca el mapa para marcar el inicio'}</span></div>
      <div class="mt-draw__btns"><button type="button" class="mt-btn" id="mt-undo" ${drawPts.length ? '' : 'disabled'}>Deshacer</button><button type="button" class="mt-btn" id="mt-clr" ${drawPts.length ? '' : 'disabled'}>Limpiar</button><button type="button" class="mt-btn mt-btn--solid" id="mt-save" ${drawPts.length > 1 ? '' : 'disabled'}>Guardar</button><button type="button" class="mt-btn" id="mt-cancel">Cancelar</button></div>`;
    $('#mt-undo').onclick = () => { drawPts.pop(); paintDraw(); };
    $('#mt-clr').onclick = () => { drawPts = []; paintDraw(); };
    $('#mt-cancel').onclick = stopDraw;
    $('#mt-save').onclick = saveDialog;
  }
  const onMapClick = (e) => { drawPts.push([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]); paintDraw(); };
  function startDraw() {
    drawing = true; drawPts = []; sheet.hidden = true; menu.hidden = true; layerMenu.hidden = true;
    root.classList.add('is-drawing'); $('#mt-draw').classList.add('on');
    map.on('click', onMapClick); bar.hidden = false; paintDraw();
  }
  function stopDraw() {
    drawing = false; drawPts = []; paintDraw();
    if (drawLine) { map.removeLayer(drawLine); drawLine = null; }
    drawDots.forEach((d) => map.removeLayer(d)); drawDots = [];
    map.off('click', onMapClick); bar.hidden = true;
    root.classList.remove('is-drawing'); $('#mt-draw').classList.remove('on');
  }
  $('#mt-draw').onclick = () => { if (drawing) stopDraw(); else startDraw(); };

  function saveDialog() {
    if (drawPts.length < 2) return;
    const dlg = document.createElement('dialog'); dlg.className = 'run-detail-dialog';
    dlg.innerHTML = `<form class="run-detail-sheet mt-save" method="dialog"><button class="link run-detail-close" type="button" id="mt-s-close">Cerrar</button><h2>Guardar ruta</h2>
      <p class="muted">${fmtKm(drawKm())} km · ${drawPts.length} puntos</p>
      <label>Nombre<input id="mt-s-name" maxlength="80" required placeholder="Circuito Parque Bolívar"></label>
      <label>Dificultad<select id="mt-s-diff">${Object.entries(DIFFICULTY).map(([k, v]) => `<option value="${k}" ${k === 'moderada' ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
      <label>Superficie<select id="mt-s-surf">${Object.entries(SURFACE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>Desnivel positivo (m) · opcional<input id="mt-s-elev" type="number" min="0" max="10000" inputmode="numeric" placeholder="120"></label>
      <label>Descripción · opcional<input id="mt-s-desc" maxlength="500" placeholder="Salida desde la plaza…"></label>
      <label class="run-check"><input id="mt-s-shared" type="checkbox" checked> Compartir con el club</label>
      ${isAdmin ? '<label class="run-check"><input id="mt-s-official" type="checkbox"> Marcar como ruta oficial</label>' : ''}
      <button class="btn" type="button" id="mt-s-save">Guardar ruta</button><p class="msg" id="mt-s-msg" aria-live="polite"></p></form>`;
    document.body.append(dlg); dlg.showModal();
    const $d = (s) => dlg.querySelector(s);
    $d('#mt-s-close').onclick = () => dlg.close();
    dlg.addEventListener('close', () => dlg.remove());
    $d('#mt-s-save').onclick = async () => {
      const name = $d('#mt-s-name').value.trim();
      if (!name) { $d('#mt-s-msg').textContent = 'Escribe un nombre para la ruta.'; return; }
      const elevRaw = $d('#mt-s-elev').value;
      const row = {
        user_id: userId, author_name: userName || null, name,
        description: $d('#mt-s-desc').value.trim() || null,
        difficulty: $d('#mt-s-diff').value, surface: $d('#mt-s-surf').value,
        distance_km: Number(drawKm().toFixed(2)), elevation_gain_m: elevRaw === '' ? null : Math.round(Number(elevRaw)),
        points: drawPts, shared: $d('#mt-s-shared').checked, is_official: isAdmin ? !!($d('#mt-s-official') && $d('#mt-s-official').checked) : false,
      };
      const btn = $d('#mt-s-save'); btn.disabled = true;
      const { data, error } = await supabase.from('club_routes').insert(row).select().single();
      btn.disabled = false;
      if (error) { $d('#mt-s-msg').textContent = /club_routes|relation|schema cache/i.test(error.message) ? 'Falta aplicar la migración 0020 en Supabase.' : `No se pudo guardar: ${error.message}`; return; }
      state.routes.unshift(data); state.loaded = true;
      dlg.close(); stopDraw(); selectRoute(data);
    };
  }

  // Al salir de la pantalla, soltar los oyentes globales de la brújula.
  const cleanup = new MutationObserver(() => {
    if (!root.isConnected) { window.removeEventListener('deviceorientationabsolute', onHeading, true); window.removeEventListener('deviceorientation', onHeading, true); cleanup.disconnect(); }
  });
  if (root.parentNode) cleanup.observe(root.parentNode, { childList: true });
  paintChips();
}
