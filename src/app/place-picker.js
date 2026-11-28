// Elegir un punto en el mapa (lugar de un evento). Devuelve { lat, lon }, null si se cierra, o 'remove' si se quita.
import { closeButton } from './common.js';
import { esc } from '../supabase.js';

const loadLeaflet = async () => { const [{ default: L }] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]); return L; };
const SUCRE = [-19.0333, -65.2627];

async function search(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=es&countrycodes=bo&q=${encodeURIComponent(q)}`;
  const rows = await (await fetch(url, { signal: AbortSignal.timeout(7000) })).json();
  return rows.map((r) => ({ name: r.display_name.split(',').slice(0, 3).join(','), lat: +r.lat, lon: +r.lon }));
}

export function openPlacePicker({ lat = null, lon = null, title = 'Lugar del evento' } = {}) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal route-picker';
    modal.innerHTML = `<section class="sheet route-picker__sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-h"><h2>${esc(title)}</h2>${closeButton('data-cancel')}</div>
      <div class="route-picker__bar"><form class="route-picker__search" data-search><input type="search" placeholder="Buscar calle o lugar…" aria-label="Buscar lugar" autocomplete="off"><button type="submit" class="route-picker__go" aria-label="Buscar"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg></button></form><div class="route-picker__results" data-results hidden></div></div>
      <div class="route-picker__map" data-map></div>
      <p class="route-picker__hint" data-hint>Toca el mapa para marcar el lugar exacto. Puedes arrastrar el punto para ajustarlo.</p>
      <div class="route-picker__foot"><b data-info>${lat != null ? 'Punto marcado' : 'Sin punto'}</b><div class="route-picker__tools"><button type="button" class="btn sm ghost" data-locate>Mi ubicación</button>${lat != null ? '<button type="button" class="btn sm ghost" data-remove>Quitar</button>' : ''}</div><button type="button" class="btn" data-done>Usar este lugar</button></div></section>`;
    document.body.append(modal);
    const q = (s) => modal.querySelector(s), close = (v) => { modal.remove(); resolve(v); };
    q('[data-cancel]').onclick = () => close(null);
    modal.onclick = (e) => { if (e.target === modal) close(null); };
    let pt = lat != null ? [lat, lon] : null, marker = null, map = null, L = null;
    const info = q('[data-info]'), results = q('[data-results]');

    const setPoint = (p, pan = true) => {
      pt = [+p[0], +p[1]];
      if (marker) marker.setLatLng(pt); else { marker = L.marker(pt, { draggable: true }).addTo(map); marker.on('dragend', () => { const ll = marker.getLatLng(); pt = [ll.lat, ll.lng]; }); }
      info.textContent = 'Punto marcado'; if (pan) map.setView(pt, Math.max(map.getZoom(), 16));
    };
    (async () => {
      L = await loadLeaflet(); if (!modal.isConnected) return;
      map = L.map(q('[data-map]'), { zoomControl: false, attributionControl: true }).setView(pt || SUCRE, pt ? 16 : 13);
      map.attributionControl.setPrefix(false);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
      if (pt) setPoint(pt, false);
      map.on('click', (e) => setPoint([e.latlng.lat, e.latlng.lng], false));
      requestAnimationFrame(() => map.invalidateSize());
    })();

    q('[data-search]').onsubmit = async (e) => {
      e.preventDefault(); const text = e.currentTarget.querySelector('input').value.trim(); if (!text) return;
      results.hidden = false; results.innerHTML = '<p class="muted">Buscando…</p>';
      try {
        const list = await search(`${text} Sucre`).then((r) => (r.length ? r : search(text)));
        results.innerHTML = list.length ? list.map((r, i) => `<button type="button" data-i="${i}">${esc(r.name)}</button>`).join('') : '<p class="muted">Sin resultados.</p>';
        results.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { const r = list[+b.dataset.i]; results.hidden = true; if (map) setPoint([r.lat, r.lon]); }));
      } catch { results.innerHTML = '<p class="muted">No se pudo buscar. Revisa tu conexión.</p>'; }
    };
    q('[data-locate]').onclick = () => navigator.geolocation?.getCurrentPosition((p) => map && setPoint([p.coords.latitude, p.coords.longitude]), () => { q('[data-hint]').textContent = 'No se pudo obtener tu ubicación.'; }, { enableHighAccuracy: true, timeout: 10000 });
    q('[data-remove]')?.addEventListener('click', () => close('remove'));
    q('[data-done]').onclick = () => { if (!pt) { q('[data-hint]').textContent = 'Primero toca el mapa para marcar el lugar.'; return; } close({ lat: +pt[0].toFixed(6), lon: +pt[1].toFixed(6) }); };
  });
}
