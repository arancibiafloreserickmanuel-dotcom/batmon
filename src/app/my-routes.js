// "Mis rutas" (Running): las rutas que creaste, guardadas en la tabla club_routes (privadas por defecto).
// Se reutiliza lo que ya existe: miniatura y calle de route-tools.js, mapa de route-picker.js.
import { esc } from '../supabase.js';
import { thumbSvg, reverseStreet } from './route-tools.js';
import { mountRouteMap } from './route-picker.js';
import { confirmDialog, notify } from './common.js';

const LEVEL = { facil: 'Fácil', moderada: 'Moderada', dificil: 'Difícil' };
const SURFACE = { asfalto: 'Asfalto', tierra: 'Tierra', pista: 'Pista', montana: 'Montaña', mixta: 'Mixta' };
const km2 = (n) => Number(n).toLocaleString('es-BO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const dateEs = (d) => new Date(d).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric' });
const near = (a, b) => Math.abs(a[0] - b[0]) < 0.0004 && Math.abs(a[1] - b[1]) < 0.0004;
const thin = (pts, max = 1500) => (pts.length <= max ? pts : Array.from({ length: max }, (_, i) => pts[Math.round(i * (pts.length - 1) / (max - 1))]));

/** Guarda la ruta marcada en tu biblioteca (sin duplicar una igual). Nunca lanza: guardar es un extra. */
export async function saveRouteToLibrary(supabase, userId, route) {
  try {
    const pts = thin((route?.points || []).map((p) => [+p[0], +p[1]]));
    if (pts.length < 2) return;
    const km = Number(Number(route.distance_km).toFixed(2));
    const { data: same } = await supabase.from('club_routes').select('points').eq('user_id', userId).eq('distance_km', km).limit(20);
    if ((same || []).some((r) => r.points?.length > 1 && near(r.points[0], pts[0]) && near(r.points.at(-1), pts.at(-1)))) return;
    const d = new Date(), name = `Ruta ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} · ${km2(km)} km`;
    await supabase.from('club_routes').insert({ user_id: userId, name, distance_km: km, points: pts, shared: false });
  } catch { /* sin tabla o sin conexión: la ruta de hoy igual funciona */ }
}

/** Dibuja la tarjeta "Mis rutas" dentro de `host` (un <details> con [data-mr-count] y [data-mr-body]). */
export async function mountMyRoutes(host, { supabase, userId, onUse }) {
  const body = host.querySelector('[data-mr-body]'), count = host.querySelector('[data-mr-count]');
  const { data, error } = await supabase.from('club_routes').select('id,name,description,difficulty,surface,distance_km,elevation_gain_m,points,shared,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(60);
  if (!host.isConnected) return;
  if (error) { count.textContent = 'No disponible'; body.innerHTML = '<p class="muted">No se pudieron cargar tus rutas.</p>'; return; }
  const routes = data || [];
  count.textContent = routes.length ? `${routes.length} guardada${routes.length === 1 ? '' : 's'} · elige una para correrla` : 'Aún no guardas ninguna';
  if (!routes.length) { body.innerHTML = '<p class="muted">Cada ruta que marques en “Ruta de hoy” se guarda aquí para usarla otra vez.</p>'; return; }
  body.innerHTML = `<div class="rt-list">${routes.map((r) => `<details class="card adm-fold rt-card" data-id="${r.id}"><summary>${thumbSvg([r.points], { cls: 'rt-thumb', label: 'Vista previa' })}<b>${esc(r.name)}</b><small>${dateEs(r.created_at)} · ${km2(r.distance_km)} km</small></summary>
    <div class="adm-fold__body"><div class="rt-info"><div class="rt-fromto"><b>Desde</b><span data-from>…</span><b>Hasta</b><span data-to>…</span></div>
      <span>${km2(r.distance_km)} km${r.elevation_gain_m != null ? ` · +${r.elevation_gain_m} m` : ''} · ${SURFACE[r.surface] || 'Asfalto'} · ${LEVEL[r.difficulty] || 'Moderada'} · ${r.shared ? 'Compartida con el club' : 'Solo para ti'}</span>${r.description ? `<span>${esc(r.description)}</span>` : ''}</div>
      <div class="rt-map" hidden></div>
      <div class="rt-actions"><button type="button" class="btn sm" data-use>Usar hoy</button><button type="button" class="btn sm ghost" data-view>Ver mapa</button><button type="button" class="btn sm ghost" data-del>Eliminar</button></div></div></details>`).join('')}</div>`;

  body.querySelectorAll('.rt-card').forEach((card) => {
    const r = routes.find((x) => x.id === card.dataset.id), first = r.points[0], last = r.points.at(-1);
    let streets = false;
    card.addEventListener('toggle', async () => {
      if (!card.open || streets) return; streets = true;
      const [a, b] = [await reverseStreet(first[0], first[1]), await reverseStreet(last[0], last[1])];
      card.querySelector('[data-from]').textContent = a || `${first[0].toFixed(4)}, ${first[1].toFixed(4)}`;
      card.querySelector('[data-to]').textContent = b || `${last[0].toFixed(4)}, ${last[1].toFixed(4)}`;
    });
    let mapped = false;
    card.querySelector('[data-view]').onclick = (e) => {
      const el = card.querySelector('.rt-map'); el.hidden = !el.hidden; e.currentTarget.textContent = el.hidden ? 'Ver mapa' : 'Ocultar mapa';
      if (!el.hidden && !mapped) { mapped = true; mountRouteMap(el, { points: r.points }); }
    };
    card.querySelector('[data-use]').onclick = () => onUse({ profile: 'foot', waypoints: [first, last], points: r.points, distance_km: Number(r.distance_km), routed: true });
    card.querySelector('[data-del]').onclick = async () => {
      if (!(await confirmDialog('¿Eliminar esta ruta de tus guardadas?', 'Eliminar ruta'))) return;
      const { error: er } = await supabase.from('club_routes').delete().eq('id', r.id).eq('user_id', userId);
      if (er) { notify(er.message); return; }
      notify('Ruta eliminada.', 'success'); mountMyRoutes(host, { supabase, userId, onUse });
    };
  });
}
