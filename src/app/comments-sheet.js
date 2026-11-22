// Hoja de comentarios (estilo Instagram): lista arriba, escribir abajo con el icono de enviar.
// La usan el muro y las actividades de Club. Quien llama guarda en su tabla; aquí solo se dibuja.
import { esc } from '../supabase.js';
import { notify } from './common.js';

const SEND = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3 10.5 13.5"/><path d="M21 3l-6.5 18-4-7.5L3 9.5z"/></svg>';
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '?';

export function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 604800) return `${Math.floor(s / 86400)} d`;
  return new Date(iso).toLocaleDateString('es-BO', { day: 'numeric', month: 'short' });
}

/**
 * getList(): [{ id, name, body, at, mine }] · onSend(body): Promise<boolean> (true si se guardó; quien llama actualiza su lista)
 * onDelete?(id): Promise<boolean> · canDelete?(item) · onClose?()
 */
export function openComments({ getList, onSend, onDelete, canDelete = () => false, onClose }) {
  const ov = document.createElement('div');
  ov.className = 'cm-ov';
  ov.innerHTML = `<section class="cm-sheet" role="dialog" aria-modal="true" aria-label="Comentarios">
    <header class="cm-head"><span class="cm-grip"></span><b>Comentarios</b><button type="button" class="cm-close" data-close aria-label="Cerrar">×</button></header>
    <div class="cm-list" data-list></div>
    <form class="cm-form" data-form autocomplete="off"><input name="body" maxlength="500" placeholder="Añade un comentario…" aria-label="Comentario" required><button type="submit" class="cm-send" aria-label="Enviar comentario" title="Enviar">${SEND}</button></form></section>`;
  document.body.appendChild(ov);
  const list = ov.querySelector('[data-list]'), form = ov.querySelector('[data-form]'), input = form.elements.body;

  const paint = (toEnd = false) => {
    const items = getList();
    list.innerHTML = items.length ? items.map((c) => `<article class="cm-item" data-id="${esc(c.id)}"><span class="cm-av" aria-hidden="true">${esc(initials(c.name))}</span>
      <div class="cm-body"><p><b>${esc(c.name)}</b> ${esc(c.body)}</p><small>${ago(c.at)}${canDelete(c) ? ' · <button type="button" class="cm-del" data-del>Eliminar</button>' : ''}</small></div></article>`).join('') : '<p class="cm-empty">Aún no hay comentarios.<br>Sé el primero en comentar.</p>';
    if (toEnd) list.scrollTop = list.scrollHeight;
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { removeEventListener('keydown', onKey); ov.classList.add('out'); setTimeout(() => { ov.remove(); onClose?.(); }, 180); };
  addEventListener('keydown', onKey);
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]'); if (!b || !onDelete) return;
    if (await onDelete(b.closest('.cm-item').dataset.id)) paint();
  });
  form.onsubmit = async (e) => {
    e.preventDefault(); const body = input.value.trim(); if (!body) return;
    const btn = form.querySelector('button'); btn.disabled = true;
    try { if (await onSend(body)) { input.value = ''; paint(true); } } catch (err) { notify(err.message || 'No se pudo comentar.'); }
    btn.disabled = false; input.focus();
  };
  paint(true);
  requestAnimationFrame(() => ov.classList.add('in'));
  return { close, refresh: paint };
}
