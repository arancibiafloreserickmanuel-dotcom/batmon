import './hamster-loader.css';

// Utilidades compartidas por app.js / running.js / plyo.js / admin.js
export const fmt = (n, d = 1) => (n === null || n === undefined || n === '' ? '—' : (Math.round(Number(n) * 10 ** d) / 10 ** d).toLocaleString('es-BO'));
export const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); // fecha local, no UTC
export const today = () => iso(new Date());
export const monthStart = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };
export const weekStart = (from = new Date()) => { const d = new Date(from); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
export const paceStr = (km, min) => { if (!km || !min) return '—'; const p = min / km; let m = Math.floor(p), s = Math.round((p - m) * 60); if (s === 60) { m++; s = 0; } return `${m}:${String(s).padStart(2, '0')} /km`; };
export const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
export const imgSrc = (e) => (e?.images?.[0] ? `/exercises/${e.images[0]}` : null);

export const loadingMarkup = () => `<div class="loading-state" role="status" aria-live="polite"><div class="wheel-and-hamster" role="img" aria-label="Hámster naranja corriendo en una rueda"><div class="wheel"></div><div class="hamster"><div class="hamster__body"><div class="hamster__head"><div class="hamster__ear"></div><div class="hamster__eye"></div><div class="hamster__nose"></div></div><div class="hamster__limb hamster__limb--fr"></div><div class="hamster__limb hamster__limb--fl"></div><div class="hamster__limb hamster__limb--br"></div><div class="hamster__limb hamster__limb--bl"></div><div class="hamster__tail"></div></div></div><div class="spoke"></div></div><span class="loading-label">Cargando…</span></div>`;

export function showDelayedLoading(target, delay = 1000) {
  if (target.querySelector('.loading-state')) return () => {};
  let active = true;
  const timer = setTimeout(() => { if (active) target.innerHTML = loadingMarkup(); }, delay);
  return () => { active = false; clearTimeout(timer); };
}

export const LEVEL = { beginner: 'Principiante', intermediate: 'Intermedio', expert: 'Avanzado' };
export const RUN_TYPE = { easy: 'Suave', long: 'Largo', tempo: 'Tempo', intervals: 'Series', race: 'Carrera', recovery: 'Recuperación' };
export const DISC = { running: 'Running', cycling: 'Ciclismo', swimming: 'Natación' };

// borrador en el navegador (no es crítico: si falla, no pasa nada)
export const draft = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignorar */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignorar */ } },
};

export function notify(message, kind = 'error') {
  let host = document.querySelector('.toast-host');
  if (!host) { host = document.createElement('div'); host.className = 'toast-host'; host.setAttribute('aria-live', 'polite'); document.body.append(host); }
  const item = document.createElement('div'); item.className = `toast ${kind}`; item.textContent = message; host.append(item);
  setTimeout(() => item.remove(), 4200);
}

export function confirmDialog(message, confirmText = 'Confirmar') {
  return new Promise((resolve) => {
    const safe = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const overlay = document.createElement('div'); overlay.className = 'modal';
    overlay.innerHTML = `<section class="sheet confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><div class="sheet-h"><b id="confirm-title">Confirmar acción</b></div><p>${safe(message)}</p><div class="quick-actions"><button type="button" class="btn ghost" data-cancel>Cancelar</button><button type="button" class="btn" data-ok>${safe(confirmText)}</button></div></section>`;
    const finish = (value) => { overlay.remove(); resolve(value); };
    overlay.querySelector('[data-cancel]').onclick = () => finish(false);
    overlay.querySelector('[data-ok]').onclick = () => finish(true);
    overlay.onclick = (e) => { if (e.target === overlay) finish(false); };
    document.body.append(overlay); overlay.querySelector('[data-cancel]').focus();
  });
}
