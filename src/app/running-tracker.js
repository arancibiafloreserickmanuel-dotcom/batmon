const EARTH_RADIUS_M = 6371000;
const MAX_ACCURACY_M = 40;
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
  const startClock = (onUpdate) => { stopClock(); activeClockId = setInterval(() => onUpdate?.(state), 1000); };
  const points = () => (state?.segments || []).flat();

  function startWatch(onUpdate, onError) {
    if (!navigator.geolocation) { onError('Este navegador no ofrece geolocalización.'); return; }
    if (!window.isSecureContext) { onError('El GPS requiere una conexión segura HTTPS.'); return; }
    stopWatch();
    activeWatchId = navigator.geolocation.watchPosition((position) => {
      if (!state || state.status !== 'running') return;
      const { latitude: lat, longitude: lon, accuracy, altitude } = position.coords;
      if (!Number.isFinite(accuracy) || accuracy > MAX_ACCURACY_M) { if (state.segments.at(-1)?.length) state.segments.push([]); state.gps_status = `Señal débil · precisión ${Math.round(accuracy || 0)} m`; save(); onUpdate?.(state); return; }
      const point = { lat, lon, at: position.timestamp || Date.now(), accuracy: Math.round(accuracy), elevation: Number.isFinite(altitude) ? altitude : null };
      let segment = state.segments.at(-1);
      if (!segment) segment = state.segments[state.segments.push([]) - 1];
      let prev = segment.at(-1);
      if (prev && point.at - prev.at > 60000) { state.segments.push([]); segment = state.segments.at(-1); prev = null; state.gap_count = (state.gap_count || 0) + 1; state.gps_status = 'Señal interrumpida · nuevo tramo iniciado'; }
      if (prev) {
        const step = distanceBetween(prev, point), seconds = Math.max(.2, (point.at - prev.at) / 1000);
        const speed = step / seconds;
        if (step < MIN_STEP_M) { state.gps_status = `GPS conectado · precisión ${point.accuracy} m`; save(); onUpdate?.(state); return; }
        // Ignore only implausible jumps; keep a gap marker so the map never draws through it.
        if (step > 250 || speed > MAX_SPEED_MPS) {
          state.gps_status = 'Salto GPS descartado · esperando una posición estable';
          state.segments.push([]); state.gap_count = (state.gap_count || 0) + 1; save(); onUpdate?.(state); return;
        }
        state.distance_m += step;
        if (seconds <= 15) state.moving_time_sec = (state.moving_time_sec || 0) + seconds;
      }
      segment.push(point);
      if (points().length > 4000) state.segments = state.segments.map((part) => part.length > 2 ? part.filter((_, index) => index === 0 || index === part.length - 1 || index % 2 === 0) : part);
      state.gps_status = `GPS conectado · precisión ${point.accuracy} m`;
      if (!save()) state.gps_status = 'Almacenamiento local lleno · finaliza pronto para guardar';
      onUpdate?.(state);
    }, (error) => {
      if (state.segments.at(-1)?.length) state.segments.push([]);
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
  function pause() {
    if (!state || state.status !== 'running') return;
    state.elapsed_before_pause = elapsedSeconds(); state.status = 'paused'; state.gps_status = 'Carrera pausada'; save(); stopWatch(); stopClock();
  }
  function resume(onUpdate, onError) {
    if (!state || state.status !== 'paused') return;
    state.status = 'running'; state.segment_started_at = Date.now(); state.segments ||= []; if(state.segments.at(-1)?.length)state.segments.push([]); state.gps_status = 'Buscando GPS · el siguiente punto iniciará un nuevo tramo'; save(); startWatch(onUpdate, onError); startClock(onUpdate);
  }
  function discard() { stopWatch(); stopClock(); localStorage.removeItem(key); state = null; }
  function finish() {
    if (!state) return null;
    if (state.status === 'running') state.elapsed_before_pause = elapsedSeconds();
    state.status = 'finished'; stopWatch(); stopClock(); save();
    const routeSegments = (state.segments || []).filter((segment) => segment.length);
    return { duration_sec: Math.max(1, elapsedSeconds()), moving_time_sec:Math.round(state.moving_time_sec||0), distance_km: distanceKm(), route_points: routeSegments.flat(), route_segments: routeSegments, started_at: state.started_at, gap_count: state.gap_count || 0 };
  }
  function returnToPause() { if (state?.status === 'finished') { state.status = 'paused'; state.gps_status = 'Carrera pausada; revisa y reanuda para continuar.'; save(); } }
  return { get state() { return state; }, elapsedSeconds, distanceKm, points, start, restore, pause, resume, finish, returnToPause, discard };
}
