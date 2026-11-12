// Utilidades compartidas por app.js / running.js / plyo.js / admin.js
export const fmt = (n, d = 1) => (n === null || n === undefined || n === '' ? '—' : (Math.round(Number(n) * 10 ** d) / 10 ** d).toLocaleString('es-BO'));
export const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); // fecha local, no UTC
export const today = () => iso(new Date());
export const monthStart = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };
export const weekStart = (from = new Date()) => { const d = new Date(from); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
export const paceStr = (km, min) => { if (!km || !min) return '—'; const p = min / km; let m = Math.floor(p), s = Math.round((p - m) * 60); if (s === 60) { m++; s = 0; } return `${m}:${String(s).padStart(2, '0')} /km`; };
export const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
export const imgSrc = (e) => (e?.images?.[0] ? `/exercises/${e.images[0]}` : null);

export const LEVEL = { beginner: 'Principiante', intermediate: 'Intermedio', expert: 'Avanzado' };
export const RUN_TYPE = { easy: 'Suave', long: 'Largo', tempo: 'Tempo', intervals: 'Series', race: 'Carrera', recovery: 'Recuperación' };
export const DISC = { running: 'Running', cycling: 'Ciclismo', swimming: 'Natación' };

// borrador en el navegador (no es crítico: si falla, no pasa nada)
export const draft = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignorar */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignorar */ } },
};
