const EARTH_RADIUS_M = 6371000;
const MAX_ACCURACY_M = 40;
const MIN_STEP_M = 2;
const MAX_STEP_M = 250;
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
  const read = () => { try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; } };
  let state = read();
  const save = () => localStorage.setItem(key, JSON.stringify(state));
  const elapsedSeconds = () => state ? state.elapsed_before_pause + (state.status === 'running' ? Math.max(0, Math.floor((Date.now() - state.segment_started_at) / 1000)) : 0) : 0;
  const distanceKm = () => (state?.distance_m || 0) / 1000;
  const stopWatch = () => { if (activeWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(activeWatchId); activeWatchId = null; };
  const stopClock = () => { clearInterval(activeClockId); activeClockId = null; };

  function startWatch(onUpdate, onError) {
    if (!navigator.geolocation) { onError('Este navegador no ofrece geolocalización.'); return; }
    if (!window.isSecureContext) { onError('El GPS requiere una conexión segura HTTPS.'); return; }
    stopWatch();
    activeWatchId = navigator.geolocation.watchPosition((position) => {
      if (!state || state.status !== 'running') return;
      const { latitude: lat, longitude: lon, accuracy, altitude } = position.coords;
      if (!Number.isFinite(accuracy) || accuracy > MAX_ACCURACY_M) { state.gps_status = 'Señal GPS débil; buscando mejor precisión…'; save(); onUpdate?.(state); return; }
      const point = { lat, lon, at: position.timestamp || Date.now(), accuracy: Math.round(accuracy), elevation: Number.isFinite(altitude) ? altitude : null };
      const prev = state.points.at(-1);
      if (prev) {
        const step = distanceBetween(prev, point);
        if (step < MIN_STEP_M || step > MAX_STEP_M) return;
        state.distance_m += step;
      }
      state.points.push(point);
      state.gps_status = 'GPS conectado';
      save(); onUpdate?.(state);
    }, (error) => {
      const messages = { 1: 'Permiso de ubicación denegado. Revisa los permisos del navegador.', 2: 'No se pudo obtener la ubicación. Comprueba el GPS.', 3: 'La ubicación tardó demasiado; seguimos buscando señal.' };
      state.gps_status = messages[error.code] || 'Error de ubicación.'; save(); onError?.(state.gps_status);
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
  }

  function start(onUpdate, onError) {
    if (state) return false;
    if (!navigator.geolocation || !window.isSecureContext) { onError?.(!window.isSecureContext ? 'El GPS requiere HTTPS.' : 'Este navegador no ofrece geolocalización.'); return false; }
    state = { user_id: userId, started_at: Date.now(), segment_started_at: Date.now(), elapsed_before_pause: 0, distance_m: 0, points: [], status: 'running', gps_status: 'Buscando señal GPS…' };
    save(); startWatch(onUpdate, onError);
    activeClockId = setInterval(() => onUpdate?.(state), 1000);
    return true;
  }
  function restore(onUpdate, onError) {
    if (!state || state.status !== 'running') return;
    startWatch(onUpdate, onError); activeClockId = setInterval(() => onUpdate?.(state), 1000);
  }
  function pause() {
    if (!state || state.status !== 'running') return;
    state.elapsed_before_pause = elapsedSeconds(); state.status = 'paused'; state.gps_status = 'Carrera pausada'; save(); stopWatch(); stopClock();
  }
  function resume(onUpdate, onError) {
    if (!state || state.status !== 'paused') return;
    state.status = 'running'; state.segment_started_at = Date.now(); state.gps_status = 'Buscando señal GPS…'; save(); startWatch(onUpdate, onError); activeClockId = setInterval(() => onUpdate?.(state), 1000);
  }
  function discard() { stopWatch(); stopClock(); localStorage.removeItem(key); state = null; }
  function finish() {
    if (!state) return null;
    if (state.status === 'running') state.elapsed_before_pause = elapsedSeconds();
    state.status = 'finished'; stopWatch(); stopClock(); save();
    return { duration_min: Math.max(0.1, elapsedSeconds() / 60), distance_km: distanceKm(), route_points: state.points, started_at: state.started_at };
  }
  function reopenAfterSaveError() { if(state?.status==='finished'){state.status='paused';state.gps_status='Carrera pausada; reanuda para continuar.';save();} }
  return { get state() { return state; }, elapsedSeconds, distanceKm, start, restore, pause, resume, finish, reopenAfterSaveError, discard };
}
