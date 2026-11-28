// Hoja de comentarios (estilo Instagram): lista arriba, escribir abajo con el icono de enviar.
// La usan el muro y las actividades de Club. Quien llama guarda en su tabla; aquí solo se dibuja.
import { esc } from '../supabase.js';
import { notify, closeButton } from './common.js';

const SEND = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3 10.5 13.5"/><path d="M21 3l-6.5 18-4-7.5L3 9.5z"/></svg>';
const HEART = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 20.5c-.4 0-.8-.1-1.1-.4C6.600 16.800 3 13.700 3 9.600 3 7 5 5 7.500 5c1.800 0 3.500 1 4.500 2.600C13 6 14.700 5 16.500 5 19 5 21 7 21 9.600c0 4.100-3.600 7.200-7.900 10.500-.3.300-.7.400-1.100.4z"/></svg>';
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
 * Me gusta del comentario (opcional): item.likes (número) e item.liked; onLike?(id, quiereDarLike): Promise<boolean>
 */
export function openComments({ getList, onSend, onDelete, onLike, canDelete = () => false, onClose }) {
  const ov = document.createElement('div');
  ov.className = 'cm-ov';
  ov.innerHTML = `<section class="cm-sheet" role="dialog" aria-modal="true" aria-label="Comentarios">
    <header class="cm-head"><span class="cm-grip"></span><b>Comentarios</b>${closeButton('data-close', 'cm-close')}</header>
    <div class="cm-list" data-list></div>
    <form class="cm-form" data-form autocomplete="off"><input name="body" maxlength="500" placeholder="Añade un comentario…" aria-label="Comentario" required><button type="submit" class="cm-send" aria-label="Enviar comentario" title="Enviar">${SEND}</button></form></section>`;
  document.body.appendChild(ov);
  const list = ov.querySelector('[data-list]'), form = ov.querySelector('[data-form]'), input = form.elements.body;

  const paint = (toEnd = false) => {
    const items = getList();
    list.innerHTML = items.length ? items.map((c) => `<article class="cm-item" data-id="${esc(c.id)}"><span class="cm-av" aria-hidden="true">${esc(initials(c.name))}</span>
      <div class="cm-body"><p><b>${esc(c.name)}</b> ${esc(c.body)}</p><small>${ago(c.at)}${canDelete(c) ? ' · <button type="button" class="cm-del" data-del>Eliminar</button>' : ''}</small></div>${onLike && c.likes !== undefined ? `<button type="button" class="cm-like${c.liked ? ' on' : ''}" data-like aria-pressed="${!!c.liked}" aria-label="Me gusta">${HEART}<span>${c.likes || ''}</span></button>` : ''}</article>`).join('') : '<p class="cm-empty">Aún no hay comentarios.<br>Sé el primero en comentar.</p>';
    if (toEnd) list.scrollTop = list.scrollHeight;
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { removeEventListener('keydown', onKey); ov.classList.add('out'); setTimeout(() => { ov.remove(); onClose?.(); }, 180); };
  addEventListener('keydown', onKey);
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
  list.addEventListener('click', async (e) => {
    const lk = e.target.closest('[data-like]');
    if (lk && onLike) { const was = lk.classList.contains('on'); lk.disabled = true; if (await onLike(lk.closest('.cm-item').dataset.id, !was)) paint(); else lk.disabled = false; return; }
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
