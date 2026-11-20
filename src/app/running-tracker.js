const EARTH_RADIUS_M = 6371000;
const MAX_ACCURACY_M = 30;
const AUTO_PAUSE_MS = 180000;   // sin moverte 3 min con GPS activo -> pausa automática
const AUTO_RESUME_M = 15;       // al moverte esto, se reanuda sola
const FORGOT_MS = 600000;       // al finalizar, más de 10 min quieto -> se recorta (olvidaste pausar)
const MIN_STEP_M = 2;
const MAX_SPEED_MPS = 12;
let activeWatchId = null;
let activeClockId = null;

const radians = (deg) => deg * Math.PI / 180;
export function distanceBetween(a, b) {
  const dLat = radians(b.lat - a.lat), dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function createRunningTracker(userId) {
  const key = `batmon_running_live_${userId}`;
  const read = () => { try { const value = JSON.parse(localStorage.getItem(key)); return value?.user_id === userId ? value : null; } catch { return null; } };
  let state = read();
  const save = () => { try { localStorage.setItem(key, JSON.stringify(state)); return true; } catch { return false; } };
  const elapsedSeconds = () => state ? state.elapsed_before_pause + (state.status === 'running' ? Math.max(0, Math.floor((Date.now() - state.segment_started_at) / 1000)) : 0) : 0;
  const distanceKm = () => (state?.distance_m || 0) / 1000;
  const stopWatch = () => { if (activeWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(activeWatchId); activeWatchId = null; };
  const stopClock = () => { clearInterval(activeClockId); activeClockId = null; };
  const startClock = (onUpdate) => { stopClock(); activeClockId = setInterval(() => { checkAuto(); onUpdate?.(state); }, 1000); };
  const points = () => (state?.segments || []).flat();

  /* ---- Estimación inteligente de tramos sin señal ----
     1) Ritmo reciente → cuántos metros "debió" correr durante el corte.
     2) Rumbo antes del corte → curva natural en vez de una recta.
     3) Si hay internet, se pide una ruta peatonal real (OpenStreetMap) y se usa si es creíble.
     Todo queda marcado est:true (línea punteada) y se avisa que es estimado. */
  const toXY = (o, p) => ({ x: (p.lon - o.lon) * 111320 * Math.cos(radians(o.lat)), y: (p.lat - o.lat) * 110540 });
  const fromXY = (o, x, y) => ({ lat: o.lat + y / 110540, lon: o.lon + x / (111320 * Math.cos(radians(o.lat))) });
  function recentPace(real) {
    const end = real.at(-1); let i = real.length - 1, dist = 0;
    while (i > 0 && end.at - real[i - 1].at <= 120000) { dist += distanceBetween(real[i - 1], real[i]); i--; }
    const sec = (end.at - real[i].at) / 1000;
    const v = sec >= 20 ? dist / sec : 0;
    return v >= 1 && v <= 6 ? v : null;                      // 3.6–21.6 km/h: ritmo de carrera creíble
  }
  function headingOf(real) {
    const end = real.at(-1);
    for (let i = real.length - 2; i >= 0; i--) {
      if (distanceBetween(real[i], end) >= 15) { const v = toXY(real[i], end), n = Math.hypot(v.x, v.y) || 1; return { x: v.x / n, y: v.y / n }; }
    }
    return null;
  }
  function curvePath(a, b, dir) {
    const v = toXY(a, b), d = Math.hypot(v.x, v.y);
    if (!dir || d < 20) return [a, b];
    const along = v.x * dir.x + v.y * dir.y;                  // si ya iba hacia el destino, casi recta
    const k = along > 0 ? 0.35 : 0.7, c = { x: dir.x * d * k, y: dir.y * d * k };
    return Array.from({ length: 14 }, (_, i) => { const t = i / 13, u = 1 - t; const x = 2 * u * t * c.x + t * t * v.x, y = 2 * u * t * c.y + t * t * v.y; return i === 0 ? a : i === 13 ? b : fromXY(a, x, y); });
  }
  const pathLength = (pts) => pts.reduce((n, p, i) => n + (i ? distanceBetween(pts[i - 1], p) : 0), 0);
  function estimateMeters(pathLen, seconds, pace) {
    let m = pathLen;
    if (pace) m = Math.min(Math.max(pathLen, pace * seconds), pathLen * 1.5);   // el ritmo puede alargarlo hasta +50 %
    return Math.min(m, seconds * 8);
  }
  const stamp = (pts, t0, t1) => { const total = pathLength(pts) || 1; let acc = 0; return pts.map((p, i) => { if (i) acc += distanceBetween(pts[i - 1], p); return { lat: p.lat, lon: p.lon, at: Math.round(t0 + (t1 - t0) * (acc / total)), est: true }; }); };
  async function fetchFootRoute(a, b) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 7000);
    try {
      const r = await fetch(`https://routing.openstreetmap.de/routed-foot/route/v1/foot/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`, { signal: ctl.signal });
      const j = await r.json(); const c = j?.routes?.[0]?.geometry?.coordinates;
      return Array.isArray(c) && c.length > 1 ? c.map(([lon, lat]) => ({ lat, lon })) : null;
    } catch { return null; } finally { clearTimeout(timer); }
  }

  function bridgeGap(point, onUpdate) {
    if (state.no_bridge) { state.no_bridge = false; return; }
    const real = points().filter((p) => !p.est), last = real.at(-1);
    if (!last) return;
    const seconds = (point.at - last.at) / 1000, straight = distanceBetween(last, point);
    if (seconds < 45 || straight < 8) return;
    if (seconds > 4 * 3600 || straight / seconds > 8) {         // no se puede estimar: línea punteada que NO suma distancia
      if (straight < 200000) { state.segments.splice(state.segments.length - 1, 0, stamp([last, point], last.at, point.at)); state.gps_status = 'Tramo largo sin señal: unido con línea punteada (no suma distancia)'; }
      return;
    }
    const pace = recentPace(real), dir = headingOf(real);
    let pts = curvePath(last, point, dir);
    let meters = estimateMeters(pathLength(pts), seconds, pace);
    const link = stamp(pts, last.at, point.at);
    state.segments.splice(state.segments.length - 1, 0, link);
    state.distance_m += meters; state.est_m = (state.est_m || 0) + meters; state.est_sec = (state.est_sec || 0) + seconds;
    state.gps_status = `Tramo sin señal estimado: ~${Math.round(meters)} m (línea punteada)`;
    // Mejora asíncrona: ruta peatonal real, solo si cabe en lo que el ritmo permite.
    fetchFootRoute(last, point).then((route) => {
      if (!route || !state || state.status === 'finished') return;
      const len = pathLength(route);
      if (len < straight * 0.95 || len > straight * 1.8 || len / seconds > 8) return;
      const i = state.segments.indexOf(link); if (i < 0) return;
      const better = estimateMeters(len, seconds, pace);
      state.segments[i] = stamp([last, ...route.slice(1, -1), point], last.at, point.at);
      state.distance_m += better - meters; state.est_m += better - meters; meters = better;
      state.gps_status = `Tramo sin señal estimado por calles: ~${Math.round(meters)} m (línea punteada)`;
      save(); onUpdate?.(state);
    });
  }

  /* ---- Suavizado (filtro de Kalman 2D): reduce el "temblor" del GPS y el zigzag que infla la distancia ---- */
  function smooth(point) {
    const acc = Math.max(3, point.accuracy), kf = state.kf;
    if (!kf) { state.kf = { lat: point.lat, lon: point.lon, v: acc * acc, at: point.at }; return point; }
    kf.v += Math.max(0, (point.at - kf.at) / 1000) * 9;          // un corredor cambia ~3 m/s de posición por segundo
    const k = kf.v / (kf.v + acc * acc);
    kf.lat += k * (point.lat - kf.lat); kf.lon += k * (point.lon - kf.lon); kf.v = (1 - k) * kf.v; kf.at = point.at;
    return { ...point, lat: kf.lat, lon: kf.lon };
  }

  /* ---- Pausa automática: quieto con GPS activo -> pausa sola y se reanuda al moverte ---- */
  function checkAuto() {
    if (!state || state.status !== 'running' || !state.last_move_at) return;
    const now = Date.now();
    if (!(state.last_fix_at && now - state.last_fix_at < 30000)) return;     // sin GPS vivo no es "quieto": es pantalla apagada o sin señal
    if (now - state.last_move_at <= AUTO_PAUSE_MS) return;
    const moved = Math.max(0, Math.floor((state.last_move_at - state.segment_started_at) / 1000));
    state.elapsed_before_pause += moved;                                       // el tiempo quieto no cuenta
    state.status = 'paused'; state.auto_paused = true;
    state.gps_status = 'Pausa automática · sin movimiento';
    state.auto_notice = 'Pausa automática: llevas unos minutos sin moverte. Se reanuda sola cuando corras.';
    save();
  }

  function startWatch(onUpdate, onError) {
    if (!navigator.geolocation) { onError('Este navegador no ofrece geolocalización.'); return; }
    if (!window.isSecureContext) { onError('El GPS requiere una conexión segura HTTPS.'); return; }
    stopWatch();
    activeWatchId = navigator.geolocation.watchPosition((position) => {
      if (!state) return;
      const { latitude: lat, longitude: lon, accuracy, altitude } = position.coords;
      const now = position.timestamp || Date.now();
      const good = Number.isFinite(accuracy) && accuracy <= MAX_ACCURACY_M;
      if (state.status === 'paused' && state.auto_paused) {                    // reanudar sola al detectar movimiento real
        if (!good) return;
        const lastReal = points().filter((p) => !p.est).at(-1);
        if (lastReal && distanceBetween(lastReal, { lat, lon }) > AUTO_RESUME_M + accuracy * 0.5) {
          state.status = 'running'; state.auto_paused = false; state.segment_started_at = now; state.last_move_at = now; state.last_fix_at = Date.now();
          state.no_bridge = true; state.kf = null; if (state.segments.at(-1)?.length) state.segments.push([]);
          state.gps_status = 'Movimiento detectado · carrera reanudada'; state.auto_notice = 'Carrera reanudada automáticamente.'; save(); onUpdate?.(state);
        }
        return;
      }
      if (state.status !== 'running') return;
      if (!good) { if (state.segments.at(-1)?.length) state.segments.push([]); state.kf = null; state.gps_status = `Señal débil · precisión ${Math.round(accuracy || 0)} m`; save(); onUpdate?.(state); return; }
      state.last_fix_at = Date.now();
      let point = { lat, lon, at: now, accuracy: Math.round(accuracy), elevation: Number.isFinite(altitude) ? altitude : null };
      let segment = state.segments.at(-1);
      if (!segment) segment = state.segments[state.segments.push([]) - 1];
      let prev = segment.at(-1);
      if (prev && point.at - prev.at > 60000) { state.segments.push([]); segment = state.segments.at(-1); prev = null; state.kf = null; state.gap_count = (state.gap_count || 0) + 1; state.gps_status = 'Señal interrumpida · nuevo tramo iniciado'; }
      point = smooth(point);
      if (!prev) { bridgeGap(point, onUpdate); state.last_move_at = point.at; }
      if (prev) {
        const step = distanceBetween(prev, point), seconds = Math.max(.2, (point.at - prev.at) / 1000);
        const speed = step / seconds;
        // Quieto o temblor: no se suma. El umbral crece con la imprecisión del GPS.
        if (step < Math.max(MIN_STEP_M, Math.min(accuracy * 0.4, 8))) { state.gps_status = `GPS conectado · precisión ${point.accuracy} m`; save(); onUpdate?.(state); return; }
        if (step > 250 || speed > MAX_SPEED_MPS) {
          state.gps_status = 'Salto GPS descartado · esperando una posición estable';
          state.segments.push([]); state.kf = null; state.gap_count = (state.gap_count || 0) + 1; save(); onUpdate?.(state); return;
        }
        state.distance_m += step; state.last_move_at = point.at;
        if (seconds <= 15) state.moving_time_sec = (state.moving_time_sec || 0) + seconds;
      }
      segment.push(point);
      if (points().length > 4000) state.segments = state.segments.map((part) => part.length > 2 ? part.filter((_, index) => index === 0 || index === part.length - 1 || index % 2 === 0) : part);
      state.gps_status = `GPS conectado · precisión ${point.accuracy} m`;
      if (!save()) state.gps_status = 'Almacenamiento local lleno · finaliza pronto para guardar';
      onUpdate?.(state);
    }, (error) => {
      if (state.segments.at(-1)?.length) state.segments.push([]);
      state.kf = null;
      const messages = { 1: 'Permiso de ubicación denegado. Revisa los permisos del navegador.', 2: 'No se pudo obtener la ubicación. Comprueba el GPS.', 3: 'La ubicación tardó demasiado; seguimos buscando señal.' };
      state.gps_status = messages[error.code] || 'Error de ubicación.'; save(); onError?.(state.gps_status); onUpdate?.(state);
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  }

  function start(onUpdate, onError) {
    if (state) return false;
    if (!navigator.geolocation || !window.isSecureContext) { onError?.(!window.isSecureContext ? 'El GPS requiere HTTPS.' : 'Este navegador no ofrece geolocalización.'); return false; }
    state = { user_id: userId, started_at: Date.now(), segment_started_at: Date.now(), elapsed_before_pause: 0, moving_time_sec: 0, distance_m: 0, segments: [], status: 'running', gps_status: 'Buscando señal GPS…', gap_count: 0 };
    if (!save()) { state = null; onError?.('No hay espacio local para guardar la actividad. Libera espacio e inténtalo otra vez.'); return false; }
    startWatch(onUpdate, onError); startClock(onUpdate); return true;
  }
  function restore(onUpdate, onError) {
    if (!state) return;
    if (state.status === 'running') {
      state.segments ||= Array.isArray(state.points) && state.points.length ? [state.points] : [];
      if (state.segments.at(-1)?.length) state.segments.push([]);
      state.gps_status = 'Actividad recuperada · buscando GPS'; save(); startWatch(onUpdate, onError); startClock(onUpdate);
    }
  }
  function refresh(onUpdate, onError) { if (state?.status === 'running') { if (state.segments.at(-1)?.length) state.segments.push([]); startWatch(onUpdate, onError); } }
  function pause() {
    if (!state || state.status !== 'running') return;
    state.elapsed_before_pause = elapsedSeconds(); state.status = 'paused'; state.gps_status = 'Carrera pausada'; save(); stopWatch(); stopClock();
  }
  function resume(onUpdate, onError) {
    if (!state || state.status !== 'paused') return;
    state.status = 'running'; state.auto_paused = false; state.kf = null; state.last_move_at = Date.now(); state.last_fix_at = 0; state.no_bridge = true; state.segment_started_at = Date.now(); state.segments ||= []; if(state.segments.at(-1)?.length)state.segments.push([]); state.gps_status = 'Buscando GPS · el siguiente punto iniciará un nuevo tramo'; save(); startWatch(onUpdate, onError); startClock(onUpdate);
  }
  function discard() { stopWatch(); stopClock(); localStorage.removeItem(key); state = null; }
  function finish() {
    if (!state) return null;
    let trimmed = 0;
    if (state.status === 'running') {                                  // olvidaste pausar: se recorta el tiempo quieto final
      const lastMove = state.last_move_at || points().filter((p) => !p.est).at(-1)?.at || 0;
      if (lastMove && Date.now() - lastMove > FORGOT_MS) trimmed = Math.floor((Date.now() - lastMove) / 1000);
      state.elapsed_before_pause = Math.max(1, elapsedSeconds() - trimmed); state.trimmed_sec = trimmed;
    }
    state.status = 'finished'; stopWatch(); stopClock(); save();
    const routeSegments = (state.segments || []).filter((segment) => segment.length);
    return { duration_sec: Math.max(1, elapsedSeconds()), moving_time_sec:Math.round(state.moving_time_sec||0), distance_km: distanceKm(), route_points: routeSegments.flat(), route_segments: routeSegments, started_at: state.started_at, gap_count: state.gap_count || 0, estimated_m: Math.round(state.est_m || 0), trimmed_sec: state.trimmed_sec || 0 };
  }
  function returnToPause() { if (state?.status === 'finished') { state.status = 'paused'; state.gps_status = 'Carrera pausada; revisa y reanuda para continuar.'; save(); } }
  return { get state() { return state; }, elapsedSeconds, distanceKm, points, start, refresh, restore, pause, resume, finish, returnToPause, discard };
}
