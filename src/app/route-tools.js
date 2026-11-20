// Herramientas de rutas: comparación de rutas repetidas, cobertura de ruta planeada y enrutamiento por calles.
import { distanceBetween } from './running-tracker.js';

const flatPoints = (segs) => {
  const flat = Array.isArray(segs?.[0]) ? segs.flat() : (segs || []);
  return flat.filter((p) => p && !p.est && Number.isFinite(+p.lat) && Number.isFinite(+p.lon)).map((p) => ({ lat: +p.lat, lon: +p.lon }));
};
export const activityRoute = (a) => flatPoints(a?.route_segments?.length ? a.route_segments : a?.route_points);
export const lengthOf = (pts) => pts.reduce((n, p, i) => n + (i ? distanceBetween(pts[i - 1], p) : 0), 0);

/** Re-muestrea la ruta a n puntos equidistantes. */
export function resample(pts, n = 80) {
  if (pts.length < 2) return pts.slice();
  const total = lengthOf(pts); if (!total) return [pts[0]];
  const step = total / (n - 1), out = [pts[0]]; let acc = 0, next = step;
  for (let i = 1; i < pts.length && out.length < n; i++) {
    const seg = distanceBetween(pts[i - 1], pts[i]);
    while (seg > 0 && acc + seg >= next && out.length < n) {
      const t = (next - acc) / seg;
      out.push({ lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * t, lon: pts[i - 1].lon + (pts[i].lon - pts[i - 1].lon) * t });
      next += step;
    }
    acc += seg;
  }
  if (out.length < n) out.push(pts.at(-1));
  return out;
}

/** Distancia (m) de un punto a una polilínea. */
export function distToPolyline(p, poly) {
  const kx = 111320 * Math.cos(p.lat * Math.PI / 180), ky = 110540;
  const xy = (q) => [(q.lon - p.lon) * kx, (q.lat - p.lat) * ky];
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const [ax, ay] = xy(poly[i - 1]), [bx, by] = xy(poly[i]);
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + dx * t, ay + dy * t));
  }
  return poly.length === 1 ? distanceBetween(p, poly[0]) : best;
}
const meanDist = (a, b) => a.reduce((n, p) => n + distToPolyline(p, b), 0) / a.length;
const percentile = (arr, q) => { const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

const cache = new WeakMap();
const sigOf = (a) => {
  if (cache.has(a)) return cache.get(a);
  const pts = activityRoute(a), sig = pts.length >= 5 && lengthOf(pts) >= 300 ? { pts: resample(pts, 80), len: lengthOf(pts) } : null;
  cache.set(a, sig); return sig;
};

/** ¿Es la misma ruta? Mismo inicio, mismo final, longitud parecida y trazo casi idéntico. */
export function sameRoute(a, b) {
  if (!a || !b) return false;
  if (distanceBetween(a.pts[0], b.pts[0]) > 250 || distanceBetween(a.pts.at(-1), b.pts.at(-1)) > 250) return false;
  const ratio = a.len / b.len; if (ratio < 0.8 || ratio > 1.25) return false;
  const d = (meanDist(a.pts, b.pts) + meanDist(b.pts, a.pts)) / 2;
  if (d > 40) return false;
  return percentile(a.pts.map((p) => distToPolyline(p, b.pts)), 0.9) < 90;
}

/** Actividades anteriores que recorrieron la misma ruta que la carrera actual. */
export function findRouteMatches(segments, activities, excludeId = null) {
  const pts = flatPoints(segments), cur = pts.length >= 5 && lengthOf(pts) >= 300 ? { pts: resample(pts, 80), len: lengthOf(pts) } : null;
  if (!cur) return [];
  return activities.filter((a) => a.id !== excludeId && sameRoute(cur, sigOf(a))).sort((x, y) => String(y.performed_on).localeCompare(String(x.performed_on)));
}

/** Mientras corres: ¿tu trazo hasta ahora va por una ruta que ya conoces? Devuelve la más parecida. */
export function matchLiveRoute(segments, activities) {
  const pts = flatPoints(segments); if (pts.length < 5 || lengthOf(pts) < 200) return null;
  const trace = resample(pts, Math.min(30, pts.length));
  let best = null;
  for (const a of activities) {
    const sig = sigOf(a); if (!sig || distanceBetween(pts[0], sig.pts[0]) > 250) continue;
    const d = meanDist(trace, sig.pts);
    if (d < 35 && (!best || d < best.d)) best = { activity: a, d, pts: sig.pts };
  }
  return best;
}

/** Qué porción (0–1) de la ruta planeada recorriste. */
export function coverage(planned, segments) {
  const actual = flatPoints(segments), plan = (planned?.points || []).map(([lat, lon]) => ({ lat, lon }));
  if (actual.length < 2 || plan.length < 2) return 0;
  const samples = resample(plan, 60);
  return samples.filter((p) => distToPolyline(p, actual) <= 50).length / samples.length;
}

/* ---------- Ruta planeada guardada en el dispositivo (Running) ---------- */
const plannedKey = (userId) => `batmon_planned_route_${userId}`;
export function getPlannedRoute(userId) { try { return JSON.parse(localStorage.getItem(plannedKey(userId))); } catch { return null; } }
export function setPlannedRoute(userId, route) { try { if (route) localStorage.setItem(plannedKey(userId), JSON.stringify(route)); else localStorage.removeItem(plannedKey(userId)); } catch { /* sin almacenamiento */ } }

/* ---------- Enrutamiento por calles (OpenStreetMap) ---------- */
const SERVICE = { foot: ['routed-foot', 'foot'], bike: ['routed-bike', 'bike'], car: ['routed-car', 'driving'] };
export const PROFILE_LABEL = { foot: 'A pie', bike: 'Bici' };
const thin = (pts, max = 600) => (pts.length <= max ? pts : Array.from({ length: max }, (_, i) => pts[Math.round(i * (pts.length - 1) / (max - 1))]));
const round5 = (n) => Math.round(n * 1e5) / 1e5;

/** Ruta por calles entre los puntos marcados. Si falla, devuelve línea recta con routed:false. */
export async function buildRoute(waypoints, profile = 'foot') {
  const wp = waypoints.map(([lat, lon]) => [round5(lat), round5(lon)]);
  const straight = () => ({ profile, waypoints: wp, points: wp, distance_km: Number((lengthOf(wp.map(([lat, lon]) => ({ lat, lon }))) / 1000).toFixed(2)), routed: false });
  if (wp.length < 2) return straight();
  const [svc, mode] = SERVICE[profile] || SERVICE.foot, ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const coords = wp.map(([lat, lon]) => `${lon},${lat}`).join(';');
    const r = await fetch(`https://routing.openstreetmap.de/${svc}/route/v1/${mode}/${coords}?overview=full&geometries=geojson`, { signal: ctl.signal });
    const j = await r.json(), route = j?.routes?.[0], line = route?.geometry?.coordinates;
    if (!Array.isArray(line) || line.length < 2) return straight();
    const points = thin(line.map(([lon, lat]) => [round5(lat), round5(lon)]));
    return { profile, waypoints: wp, points, distance_km: Number((route.distance / 1000).toFixed(2)), routed: true };
  } catch { return straight(); } finally { clearTimeout(timer); }
}
