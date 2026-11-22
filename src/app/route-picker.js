// Selector de ruta A→B sobre el mapa + vista de ruta guardada.
import { buildRoute, PROFILE_LABEL } from './route-tools.js';

const DEFAULT_CENTER = [-19.0196, -65.2619];
// Zona permitida: Sucre, todo Chuquisaca y partes de los departamentos vecinos.
const AREA = { south: -22.3, north: -18.0, west: -67.2, east: -62.0 };
const inArea = (lat, lon) => lat >= AREA.south && lat <= AREA.north && lon >= AREA.west && lon <= AREA.east;
const nearIdx = (pts, p, from = 0) => { let bi = from, bd = Infinity; for (let i = from; i < pts.length; i++) { const d = (pts[i][0] - p[0]) ** 2 + (pts[i][1] - p[1]) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };
const loadLeaflet = async () => { const [{ default: L }] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]); return L; };
const pinIcon = (L, label, kind) => L.divIcon({ className: 'rp-pin-wrap', html: `<span class="rp-pin rp-pin--${kind}">${label}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Abre el selector. Devuelve { route } al aceptar (route = null si la quitó) o null si cancela.
 * route = { profile, waypoints:[[lat,lon]], points:[[lat,lon]], distance_km, routed }
 */
export function openRoutePicker({ route = null, profile = 'foot', title = 'Marcar ruta', allowRemove = false } = {}) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal route-picker';
    modal.innerHTML = `<section class="sheet route-picker__sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-h"><h2>${esc(title)}</h2><button class="link" type="button" data-cancel>Cerrar</button></div>
      <div class="route-picker__bar">
        <form class="route-picker__search" data-search><input type="search" placeholder="Buscar calle o lugar…" aria-label="Buscar lugar" autocomplete="off"><button type="submit" class="route-picker__go" aria-label="Buscar"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg></button></form>
        <div class="route-picker__results" data-results hidden></div>
      </div>
      <div class="route-picker__map" data-map></div>
      <p class="route-picker__hint" data-hint>Toca el mapa para el <b>inicio (A)</b> y otra vez para el <b>destino (B)</b>. Para cambiar por qué calles va, <b>mantén presionada la línea negra</b> y desliza.</p>
      <div class="route-picker__foot"><b data-dist>0 km</b>
        <div class="route-picker__tools">
          <button type="button" class="btn sm ghost" data-locate>Mi ubicación</button>
          <button type="button" class="btn sm ghost" data-undo>Deshacer</button>
          <button type="button" class="btn sm ghost" data-clear>Limpiar</button>
          ${allowRemove && route ? '<button type="button" class="btn sm ghost" data-remove>Quitar ruta</button>' : ''}
        </div>
        <button type="button" class="btn" data-done>Usar esta ruta</button></div>
</section>`;
    document.body.append(modal);
    const $ = (sel) => modal.querySelector(sel);
    const close = (value) => { modal.remove(); resolve(value); };
    $('[data-cancel]').onclick = () => close(null);
    modal.onclick = (e) => { if (e.target === modal) close(null); };

    let mode = route?.profile || profile, wps = (route?.waypoints || []).map((p) => [...p]), current = route, line = null, markers = [], reqId = 0, L = null, map = null;
    const hint = $('[data-hint]'), dist = $('[data-dist]');

    async function reroute() {
      const id = ++reqId;
      drawMarkers();
      if (wps.length < 2) { current = null; if (line) { map.removeLayer(line); line = null; } dist.textContent = wps.length ? 'Marca el destino' : '0 km'; return; }
      dist.textContent = 'Calculando…';
      const r = await buildRoute(wps, mode);
      if (id !== reqId) return;
      current = r;
      if (line) map.removeLayer(line);
      line = L.featureGroup([L.polyline(r.points, { color: '#fff', weight: 9, opacity: .9, interactive: false }), L.polyline(r.points, { color: '#111', weight: 5, opacity: .95, dashArray: r.routed ? null : '8 8', interactive: false }), L.polyline(r.points, { color: '#000', weight: 26, opacity: 0, bubblingMouseEvents: false, className: 'rp-hit' })]).addTo(map);
      dist.textContent = `${r.distance_km.toLocaleString('es-BO')} km`;
      hint.textContent = r.routed ? 'Ruta por calles. Mantén presionada la línea negra y desliza para cambiar por dónde va; toca un punto intermedio para quitarlo.' : 'No se pudo consultar el servicio de calles: se muestra una línea recta. Revisa tu conexión.';
    }
    // Posición (índice de waypoint) donde entra un punto nuevo tomado sobre la línea.
    function slotOnLine(ll) {
      const pts = current.points, ci = nearIdx(pts, [ll.lat, ll.lng]);
      let from = 0; const idxs = wps.map((w) => (from = nearIdx(pts, w, from)));
      let k = idxs.findIndex((ix, j) => j > 0 && ci <= ix); if (k < 1) k = wps.length - 1;
      return k;
    }
    function addPoint(lat, lon) {
      if (!inArea(lat, lon)) { hint.textContent = 'Solo se pueden marcar puntos en Sucre, Chuquisaca y alrededores.'; return; }
      if (wps.length >= 2) { hint.textContent = 'Ya tienes inicio (A) y destino (B). Mantén presionada la línea negra y desliza para ajustar el recorrido.'; return; }
      wps.push([lat, lon]); reroute();
    }
    function drawMarkers() {
      markers.forEach((m) => map.removeLayer(m)); markers = [];
      wps.forEach((wp, i) => {
        const last = i === wps.length - 1 && wps.length > 1, label = i === 0 ? 'A' : last ? 'B' : String(i);
        const m = L.marker(wp, { icon: pinIcon(L, label, i === 0 ? 'a' : last ? 'b' : 'mid'), draggable: true }).addTo(map);
        m.on('dragend', () => { const p = m.getLatLng(); if (!inArea(p.lat, p.lng)) { hint.textContent = 'Fuera de la zona permitida (Sucre y Chuquisaca).'; reroute(); return; } wps[i] = [p.lat, p.lng]; reroute(); });
        if (i > 0 && !last) m.on('click', () => { wps.splice(i, 1); reroute(); });
        markers.push(m);
      });
    }

    (async () => {
      L = await loadLeaflet();
      if (!modal.isConnected) return;
      const bounds = L.latLngBounds([AREA.south, AREA.west], [AREA.north, AREA.east]);
      map = L.map($('[data-map]'), { zoomControl: false, attributionControl: true, maxBounds: bounds, maxBoundsViscosity: 1, minZoom: 8 }).setView(DEFAULT_CENTER, 13);
      map.attributionControl.setPrefix(false);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
      requestAnimationFrame(() => map.invalidateSize());
      map.on('click', (e) => addPoint(e.latlng.lat, e.latlng.lng));
      // Mantener presionada la línea y deslizar = nuevo punto de paso (un simple toque no agrega puntos).
      const cont = map.getContainer(); let hold = null, drag = null;
      const stopHold = () => { if (hold) { clearTimeout(hold.timer); hold = null; } };
      const startDrag = (x, y) => {
        if (!current || wps.length < 2 || wps.length >= 25) return;
        const ll = map.mouseEventToLatLng({ clientX: x, clientY: y }), k = slotOnLine(ll), snap = current.points[nearIdx(current.points, [ll.lat, ll.lng])];
        drag = { k, ll: L.latLng(snap[0], snap[1]), marker: L.marker(snap, { icon: pinIcon(L, '•', 'mid'), interactive: false }).addTo(map) };
        map.dragging.disable(); navigator.vibrate?.(15); hint.textContent = 'Desliza hasta donde quieres pasar y suelta.';
      };
      const endDrag = () => {
        if (!drag) return; const d = drag; drag = null; map.removeLayer(d.marker); map.dragging.enable();
        if (!inArea(d.ll.lat, d.ll.lng)) { hint.textContent = 'Fuera de la zona permitida (Sucre y Chuquisaca).'; return; }
        wps.splice(d.k, 0, [d.ll.lat, d.ll.lng]); reroute();
      };
      cont.addEventListener('pointerdown', (e) => {
        if (!e.target.classList?.contains('rp-hit') || !current || e.button > 0) return;
        const sx = e.clientX, sy = e.clientY; stopHold();
        hold = { sx, sy, timer: setTimeout(() => { hold = null; startDrag(sx, sy); }, 380) };
      }, true);
      window.addEventListener('pointermove', (e) => {
        if (hold && Math.hypot(e.clientX - hold.sx, e.clientY - hold.sy) > 9) stopHold();
        if (drag) { const ll = map.mouseEventToLatLng(e); drag.ll = ll; drag.marker.setLatLng(ll); }
      });
      window.addEventListener('pointerup', () => { stopHold(); endDrag(); });
      window.addEventListener('pointercancel', () => { stopHold(); endDrag(); });
      cont.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
      cont.addEventListener('contextmenu', (e) => { if (hold || drag) e.preventDefault(); });
      if (wps.length) { await reroute(); if (line) map.fitBounds(line.getBounds(), { padding: [30, 30] }); }
      else navigator.geolocation?.getCurrentPosition((p) => { if (!wps.length && map && inArea(p.coords.latitude, p.coords.longitude)) map.setView([p.coords.latitude, p.coords.longitude], 15); }, () => {}, { timeout: 6000, maximumAge: 60000 });
    })();

    $('[data-undo]').onclick = () => { wps.pop(); reroute(); };
    $('[data-clear]').onclick = () => { wps = []; reroute(); };
    $('[data-locate]').onclick = () => navigator.geolocation?.getCurrentPosition((p) => {
      const { latitude: la, longitude: lo } = p.coords; map?.setView([la, lo], 16);
      if (!wps.length) addPoint(la, lo); // tu ubicación queda como inicio (A)
    }, () => { hint.textContent = 'No se pudo obtener tu ubicación.'; }, { enableHighAccuracy: true, timeout: 10000 });
    const rem = $('[data-remove]'); if (rem) rem.onclick = () => close({ route: null });
    const results = $('[data-results]'), searchInput = $('[data-search] input');
    const vb = `${AREA.west},${AREA.north},${AREA.east},${AREA.south}`;
    const fromNominatim = async (q) => (await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=es&countrycodes=bo&viewbox=${vb}&q=${encodeURIComponent(q)}`)).json()).map((h) => ({ name: h.display_name.split(',').slice(0, 3).join(','), lat: +h.lat, lon: +h.lon }));
    const fromPhoton = async (q) => (await (await fetch(`https://photon.komoot.io/api/?limit=6&lat=-19.03&lon=-65.26&bbox=${AREA.west},${AREA.south},${AREA.east},${AREA.north}&q=${encodeURIComponent(q)}`)).json()).features.map((f) => ({ name: [f.properties.name, f.properties.street, f.properties.city || f.properties.county].filter(Boolean).join(', '), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }));
    let searchId = 0;
    async function runSearch() {
      const q = searchInput.value.trim(); if (q.length < 2 || !map) { results.hidden = true; return; }
      const id = ++searchId; hint.textContent = 'Buscando…';
      const settled = await Promise.allSettled([fromNominatim(q), fromNominatim(`${q} Sucre`), fromPhoton(`${q} Sucre`)]);
      if (id !== searchId) return;
      if (settled.every((r) => r.status === 'rejected')) { hint.textContent = 'No se pudo buscar. Revisa tu conexión.'; return; }
      const seen = new Set(), hits = settled.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value).filter((h) => { const key = `${h.lat.toFixed(4)},${h.lon.toFixed(4)}`; if (!inArea(h.lat, h.lon) || seen.has(key)) return false; seen.add(key); return true; }).slice(0, 7);
      if (!hits.length) { results.hidden = true; hint.textContent = 'Ese lugar no aparece en el mapa abierto. Búscalo por la calle o toca el mapa para marcarlo.'; return; }
      hint.textContent = 'Elige un resultado: se centra el mapa y se marca el punto.';
      results.hidden = false;
      results.innerHTML = hits.map((h, n) => `<button type="button" data-hit="${n}">${esc(h.name)}</button>`).join('');
      results.querySelectorAll('[data-hit]').forEach((b) => (b.onclick = () => { const h = hits[+b.dataset.hit]; map.setView([h.lat, h.lon], 16); addPoint(h.lat, h.lon); results.hidden = true; }));
    }
    let typing = null;
    searchInput.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(runSearch, 650); });
    $('[data-search]').onsubmit = (e) => { e.preventDefault(); clearTimeout(typing); runSearch(); };
    $('[data-done]').onclick = () => {
      if (wps.length < 2 || !current) { hint.textContent = 'Marca al menos el inicio (A) y el destino (B).'; return; }
      close({ route: current });
    };
  });
}

/** Dibuja una ruta guardada (solo lectura) con inicio A y destino B. */
export async function mountRouteMap(el, route) {
  if (!el || !route?.points?.length) return null;
  try {
    const L = await loadLeaflet();
    if (!el.isConnected) return null;
    el.innerHTML = '';
    const map = L.map(el, { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
    map.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    const line = L.featureGroup([L.polyline(route.points, { color: '#fff', weight: 9, opacity: .9 }), L.polyline(route.points, { color: '#111', weight: 5, opacity: .95 })]).addTo(map);
    L.marker(route.points[0], { icon: pinIcon(L, 'A', 'a') }).addTo(map);
    L.marker(route.points.at(-1), { icon: pinIcon(L, 'B', 'b') }).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [24, 24] });
    requestAnimationFrame(() => map.invalidateSize());
    return map;
  } catch { el.innerHTML = '<p class="muted">No se pudo cargar el mapa.</p>'; return null; }
}

export const routeSummary = (route) => (route ? `${route.distance_km.toLocaleString('es-BO')} km` : 'Sin ruta');
