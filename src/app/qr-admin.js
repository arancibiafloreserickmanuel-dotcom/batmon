// Administración → Pagos: cambiar el QR (recortando solo el código), su vencimiento y la animación.
import { supabase, esc } from '../supabase.js';
import { notify, closeButton, today } from './common.js';
import { detectQr } from './qr-detect.js';
import { QR_ANIMS, loadPaymentQr, qrUrl, qrExpired, qrDate, qrFrame } from './qr-pay.js';

const HINT = 'Falta aplicar la migración 0034 en Supabase.';

/** Tarjeta resumen al inicio de Pagos. */
export async function mountQrAdmin(box) {
  const { row, error } = await loadPaymentQr();
  if (!box.isConnected) return;
  const state = !row?.expires_on ? 'Sin fecha de vencimiento' : qrExpired(row) ? `Venció el ${qrDate(row.expires_on)}` : `Vence el ${qrDate(row.expires_on)}`;
  box.innerHTML = `<article class="card qr-admin"><img src="${qrUrl(row?.image_path)}" alt="QR de pago actual"><div><b>QR de pago</b><small class="${qrExpired(row) ? 'is-bad' : ''}">${error ? HINT : state}</small>${row ? `<small>Animación ${row.animation_on ? `activada: ${esc(QR_ANIMS.find(([k]) => k === row.animation)?.[1] || '')}` : 'desactivada'}</small>` : ''}<button type="button" class="btn sm" data-qr-edit>Cambiar QR</button></div></article>`;
  box.querySelector('[data-qr-edit]').onclick = () => openEditor(row, () => mountQrAdmin(box));
}

const loadImage = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen. Usa PNG o JPG.')); };
  img.src = url;
});

function openEditor(row, done) {
  const state = { anim: row?.animation || 'scan', on: row ? row.animation_on : true, source: null, crop: null, blob: null, preview: qrUrl(row?.image_path) };
  const m = document.createElement('div');
  m.className = 'modal'; // solo se cierra con el botón, para no perder el recorte por un toque fuera
  m.innerHTML = `<div class="sheet"><div class="sheet-h"><b>Cambiar QR</b>${closeButton()}</div>
    <form class="adm-form" id="qr-form">
      <label>Foto del QR nuevo<input type="file" name="photo" accept="image/*"></label>
      <div data-editor hidden><p class="muted" data-found></p><div class="qr-crop"><canvas class="qr-crop__src"></canvas><div class="qr-crop__box"><i data-c="nw"></i><i data-c="ne"></i><i data-c="sw"></i><i data-c="se"></i></div></div><button type="button" class="btn sm ghost" data-auto>Detectar otra vez</button></div>
      <label>Vence el (último día en que sirve)<input type="date" name="expires" value="${row?.expires_on || ''}"></label>
      <label class="adm-sw"><span><b>Animación</b><small>Lo que ve el cliente al pagar con QR</small></span><input type="checkbox" class="share-switch" name="on" ${state.on ? 'checked' : ''} aria-label="Activar animación"><span><i></i></span></label>
      <div class="qr-anims" role="group" aria-label="Tipo de animación">${QR_ANIMS.map(([k, t]) => `<button type="button" class="btn ghost sm" data-anim="${k}">${t}</button>`).join('')}</div>
      <p class="muted">Así lo verá el cliente:</p><div class="qr-preview" data-preview></div>
      <button class="btn" type="submit">Guardar QR</button><p class="msg" aria-live="polite"></p>
    </form></div>`;
  document.body.append(m);
  const $ = (s) => m.querySelector(s), form = $('#qr-form'), msg = $('.msg'), canvas = $('.qr-crop__src'), box = $('.qr-crop__box');
  $('[data-close]').onclick = () => m.remove();

  const paintPreview = () => {
    $('[data-preview]').innerHTML = qrFrame(state.preview, state.on ? state.anim : '');
    $('.qr-anims').classList.toggle('is-off', !state.on);
    m.querySelectorAll('[data-anim]').forEach((b) => { b.classList.toggle('on', b.dataset.anim === state.anim); b.setAttribute('aria-pressed', b.dataset.anim === state.anim); });
  };
  m.querySelectorAll('[data-anim]').forEach((b) => (b.onclick = () => { state.anim = b.dataset.anim; paintPreview(); }));
  form.elements.on.onchange = (e) => { state.on = e.target.checked; paintPreview(); };

  // Recorte: solo el cuadrado elegido, sobre un margen blanco (nada del fondo de la foto).
  const render = () => {
    const { x, y, size } = state.crop, img = state.source;
    const side = Math.round(Math.min(1000, Math.max(600, size))), pad = Math.round(side * 0.07);
    const out = document.createElement('canvas'); out.width = out.height = side + pad * 2;
    const g = out.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, out.width, out.height);
    g.imageSmoothingEnabled = size >= side;
    const sx = Math.max(0, x), sy = Math.max(0, y), ex = Math.min(img.naturalWidth, x + size), ey = Math.min(img.naturalHeight, y + size), k = side / size;
    g.drawImage(img, sx, sy, ex - sx, ey - sy, pad + (sx - x) * k, pad + (sy - y) * k, (ex - sx) * k, (ey - sy) * k);
    state.preview = out.toDataURL('image/png');
    state.blob = new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    paintPreview();
  };
  const placeBox = () => {
    const { x, y, size } = state.crop, W = state.source.naturalWidth, H = state.source.naturalHeight;
    Object.assign(box.style, { left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`, width: `${(size / W) * 100}%`, height: `${(size / H) * 100}%` });
  };
  const auto = () => {
    const img = state.source, W = img.naturalWidth, H = img.naturalHeight, k = Math.min(1, 1400 / Math.max(W, H));
    const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
    const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    const hit = detectQr(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
    const side = Math.min(W, H) * 0.7;
    state.crop = hit ? { x: hit.x / k, y: hit.y / k, size: hit.size / k } : { x: (W - side) / 2, y: (H - side) / 2, size: side };
    $('[data-found]').textContent = hit ? 'QR encontrado. Solo se guarda lo que está dentro del recuadro; ajústalo si hace falta.' : 'No encontré el QR solo: mueve el recuadro y sus esquinas hasta enmarcarlo exacto.';
    placeBox(); render();
  };
  $('[data-auto]').onclick = auto;

  form.elements.photo.onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    msg.textContent = '';
    try { state.source = await loadImage(file); } catch (err) { msg.textContent = err.message; return; }
    canvas.width = state.source.naturalWidth; canvas.height = state.source.naturalHeight;
    canvas.getContext('2d').drawImage(state.source, 0, 0);
    $('[data-editor]').hidden = false;
    form.elements.expires.value = ''; // un QR nuevo necesita su propia fecha
    auto();
  };

  box.onpointerdown = (e) => {
    e.preventDefault();
    const corner = e.target.dataset.c, start = { ...state.crop }, px = e.clientX, py = e.clientY;
    const W = state.source.naturalWidth, H = state.source.naturalHeight, k = W / canvas.getBoundingClientRect().width;
    box.setPointerCapture(e.pointerId);
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    box.onpointermove = (ev) => {
      const dx = (ev.clientX - px) * k, dy = (ev.clientY - py) * k;
      if (!corner) state.crop = { size: start.size, x: clamp(start.x + dx, 0, W - start.size), y: clamp(start.y + dy, 0, H - start.size) };
      else {
        const sx = corner.includes('e') ? 1 : -1, sy = corner.includes('s') ? 1 : -1;
        const ax = sx > 0 ? start.x : start.x + start.size, ay = sy > 0 ? start.y : start.y + start.size; // esquina opuesta fija
        const room = Math.min(sx > 0 ? W - ax : ax, sy > 0 ? H - ay : ay);
        const size = clamp(start.size + (dx * sx + dy * sy) / 2, Math.min(40, room), room);
        state.crop = { size, x: sx > 0 ? ax : ax - size, y: sy > 0 ? ay : ay - size };
      }
      placeBox();
    };
    box.onpointerup = box.onpointercancel = () => { box.onpointermove = null; render(); };
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const expires = form.elements.expires.value || null, submit = form.querySelector('[type="submit"]');
    if (state.source && !expires) { msg.textContent = 'Pon hasta qué día sirve este QR.'; return; }
    if (expires && expires < today() && expires !== row?.expires_on) { msg.textContent = 'Esa fecha ya pasó.'; return; }
    submit.disabled = true; msg.textContent = 'Guardando…';
    let path = row?.image_path || null;
    if (state.source) {
      path = `qr-${Date.now()}.png`;
      const up = await supabase.storage.from('payment-qr').upload(path, await state.blob, { contentType: 'image/png' });
      if (up.error) { submit.disabled = false; msg.textContent = `No se pudo subir: ${up.error.message}. ${HINT}`; return; }
    }
    const { error } = await supabase.from('payment_qr').upsert({ id: 1, image_path: path, expires_on: expires, animation: state.anim, animation_on: state.on, updated_at: new Date().toISOString() });
    if (error) {
      if (state.source) await supabase.storage.from('payment-qr').remove([path]);
      submit.disabled = false; msg.textContent = `No se pudo guardar: ${error.message}. ${HINT}`; return;
    }
    if (state.source && row?.image_path) await supabase.storage.from('payment-qr').remove([row.image_path]);
    notify('QR actualizado.', 'success'); m.remove(); done();
  };
  paintPreview();
}
