/*
  Campo de subida de imagen/video — animación basada en "Image upload field" de Animorio (https://animorio.com).
  Se aplica solo a todos los <input type="file"> de la app: el input real sigue dentro del formulario
  (los formularios leen input.files igual que antes); la animación es la vista previa que se "revela" al cargar.
*/
import './upload-field.css';

const UPLOAD = 2.2;   // segundos que dura la animación de carga
const BLUR = 7;       // desenfoque (px) de la parte aún no cargada
const H_EMPTY = 148, H_FILE = 96;

let gsapPromise = null;
const loadGsap = () => gsapPromise || (gsapPromise = Promise.all([import('gsap'), import('gsap/EasePack')]).then(([{ gsap }, { SlowMo }]) => {
  gsap.registerPlugin(SlowMo);
  gsap.registerPlugin({ name: 'autoRound', init() {} });
  gsap.defaults({ autoRound: false });
  return gsap;
}));

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const weight = (bytes) => bytes > 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
const FILM = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><rect width="72" height="72" fill="#d8d8d8"/><path d="M28 22l20 14-20 14z" fill="#222"/></svg>');

function videoPoster(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video'), url = URL.createObjectURL(file);
    let finished = false;
    const done = (data) => { if (finished) return; finished = true; URL.revokeObjectURL(url); resolve(data); };
    v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url;
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.2, (v.duration || 1) / 2); } catch { done(''); } };
    v.onseeked = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 216;
        const g = c.getContext('2d'), r = Math.max(216 / v.videoWidth, 216 / v.videoHeight);
        g.drawImage(v, (216 - v.videoWidth * r) / 2, (216 - v.videoHeight * r) / 2, v.videoWidth * r, v.videoHeight * r);
        done(c.toDataURL('image/jpeg', 0.85));
      } catch { done(''); }
    };
    v.onerror = () => done('');
    setTimeout(() => done(''), 4000);
  });
}

const CHECK_DOWN = '<svg viewBox="0 0 28 28"><rect x="3.5" y="5.5" width="21" height="17" rx="4"></rect><path d="M7.500 18.500 12 14l3.200 3.200 2.300-2.300 3 3.600"></path><path class="up__arrow" data-arrow d="M14 2v8M10.800 5.200 14 2l3.200 3.200"></path></svg>';

export function enhanceFileInput(input) {
  if (input.dataset.upEnhanced || input.hidden || input.dataset.noUploadField !== undefined) return;
  input.dataset.upEnhanced = '1';
  const accept = input.accept || 'image/*';
  const allowVideo = /video/.test(accept), multiple = input.multiple;
  const kind = allowVideo ? 'Foto o video' : multiple ? 'Fotos' : 'Imagen';

  const up = document.createElement('div');
  up.className = 'up'; up.dataset.up = '';
  up.innerHTML = `<div class="up__drop" data-drop><span class="up__ico" aria-hidden="true">${CHECK_DOWN}</span><span class="up__main">Suelta ${allowVideo ? 'un archivo' : multiple ? 'tus fotos' : 'una imagen'} o <b>explora</b></span><span class="up__hint">${kind}${multiple ? ' · hasta 3' : ''} · JPG, PNG o WebP${allowVideo ? ', MP4' : ''}</span></div>
    <div class="up__file" data-file><span class="thumb" data-thumbbox><img data-thumb alt=""><span class="thumb__veil" data-veil></span><span class="thumb__sheen" data-sheen></span><svg class="thumb__ok" data-ok viewBox="0 0 20 20" aria-hidden="true"><rect x="1" y="1" width="18" height="18" rx="6"></rect><path pathLength="1" data-tick d="M5.600 10.400 8.600 13.200 14.400 6.900"></path></svg></span>
      <span class="info"><span class="info__name" data-name></span><span class="info__meta"><span data-size></span><span class="roll"><span data-status>Cargando</span></span></span><span class="info__bar"><span data-bar></span></span></span>
      <button class="up__x" type="button" data-remove aria-label="Quitar el archivo"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.200 4.200 11.800 11.800M11.800 4.200 4.200 11.800"></path></svg></button></div>
    <p class="up__sr" data-live aria-live="polite"></p>`;
  input.before(up);
  const drop = up.querySelector('[data-drop]');
  drop.append(input);
  input.classList.add('up__input');
  input.style.cssText = '';

  const $ = (s) => up.querySelector(s);
  const arrow = $('[data-arrow]'), fileEl = $('[data-file]'), thumbBox = $('[data-thumbbox]'), thumb = $('[data-thumb]'), veil = $('[data-veil]'), sheen = $('[data-sheen]');
  const ok = $('[data-ok]'), tick = $('[data-tick]'), nameEl = $('[data-name]'), sizeEl = $('[data-size]'), statusEl = $('[data-status]'), bar = $('[data-bar]');
  const removeBtn = $('[data-remove]'), live = $('[data-live]');
  veil.style.backdropFilter = veil.style.webkitBackdropFilter = `blur(${BLUR}px) saturate(0)`;

  const prog = { p: 0 };
  let state = 'empty', flow = null, g = null, token = 0;

  function paint() {
    g.set(bar, { scaleX: prog.p });
    veil.style.clipPath = `inset(${(prog.p * 100).toFixed(1)}% 0 0 0)`;
    if (state === 'busy') statusEl.textContent = Math.round(prog.p * 100) + '%';
  }
  function swap(text) {
    if (statusEl.textContent === text) return;
    g.killTweensOf(statusEl);
    if (reduced()) { statusEl.textContent = text; return; }
    g.timeline().to(statusEl, { yPercent: -100, opacity: 0, duration: 0.13, ease: 'power2.in' })
      .call(() => { statusEl.textContent = text; })
      .fromTo(statusEl, { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.4, ease: 'back.out(1.8)', immediateRender: false });
  }

  function take(src, name, size) {
    state = 'busy';
    up.classList.remove('is-done');
    thumb.src = src; nameEl.textContent = name; sizeEl.textContent = size; statusEl.textContent = '0%';
    prog.p = 0; paint();
    live.textContent = 'Cargando ' + name;
    if (flow) flow.kill();
    g.set(ok, { scale: 0, transformOrigin: '50% 50%' }); g.set(tick, { strokeDashoffset: 1 }); g.set(veil, { opacity: 1 });
    const tl = g.timeline(); flow = tl;
    if (reduced()) {
      tl.set(drop, { autoAlpha: 0 }).set(up, { height: H_FILE }).set(fileEl, { autoAlpha: 1 });
      tl.to(prog, { p: 1, duration: UPLOAD, ease: 'steps(5)', onUpdate: paint });
    } else {
      tl.to(arrow, { y: -9, opacity: 0, duration: 0.22, ease: 'power2.in' }, 0);
      tl.to(drop, { autoAlpha: 0, scale: 0.96, duration: 0.22, ease: 'power2.in' }, 0.05);
      tl.to(up, { height: H_FILE, duration: 0.55, ease: 'back.out(1.5)' }, 0.12);
      tl.fromTo(fileEl, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: 'power3.out' }, 0.26);
      tl.fromTo(thumbBox, { scale: 0.7 }, { scale: 1, duration: 0.6, ease: 'back.out(2)' }, 0.26);
      tl.to(prog, { p: 1, duration: UPLOAD, ease: 'slow(0.4, 0.6, false)', onUpdate: paint }, 0.45);
    }
    tl.call(done);
  }
  function done() {
    state = 'done';
    up.classList.add('is-done');
    prog.p = 1; paint();
    swap('Listo');
    live.textContent = nameEl.textContent + ' listo';
    if (reduced()) { g.set(ok, { scale: 1 }); g.set(tick, { strokeDashoffset: 0 }); g.set(veil, { opacity: 0 }); return; }
    g.to(veil, { opacity: 0, duration: 0.3 });
    g.fromTo(sheen, { xPercent: -120, skewX: -14, opacity: 1 }, { xPercent: 260, duration: 0.8, ease: 'power2.out', onComplete: () => g.set(sheen, { opacity: 0 }) });
    g.fromTo(thumbBox, { scale: 1 }, { keyframes: [{ scale: 1.07, duration: 0.14, ease: 'power2.out' }, { scale: 1, duration: 0.7, ease: 'elastic.out(1, 0.4)' }] });
    g.to(ok, { scale: 1, duration: 0.5, ease: 'back.out(2.6)', delay: 0.1 });
    g.to(tick, { strokeDashoffset: 0, duration: 0.3, ease: 'power2.out', delay: 0.25 });
  }
  function clear(keepInput = false) {
    if (state === 'empty') return;
    state = 'empty'; token++;
    up.classList.remove('is-done');
    if (!keepInput) input.value = '';
    live.textContent = 'Archivo quitado';
    if (flow) flow.kill();
    g.killTweensOf([prog, veil, ok, tick, thumbBox, sheen]);
    const tl = g.timeline(); flow = tl;
    if (reduced()) { tl.set(fileEl, { autoAlpha: 0 }).set(up, { height: H_EMPTY }).set(drop, { autoAlpha: 1, scale: 1 }).set(arrow, { y: 0, opacity: 1 }); return; }
    tl.to(fileEl, { autoAlpha: 0, y: -6, duration: 0.2, ease: 'power2.in' }, 0);
    tl.to(up, { height: H_EMPTY, duration: 0.55, ease: 'back.out(1.4)' }, 0.1);
    tl.fromTo(drop, { autoAlpha: 0, scale: 0.96 }, { autoAlpha: 1, scale: 1, duration: 0.4, ease: 'power3.out' }, 0.22);
    tl.fromTo(arrow, { y: 9, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'back.out(2.4)' }, 0.3);
  }

  async function fromInput() {
    const files = Array.from(input.files || []);
    if (!files.length) { if (g) clear(true); return; }
    const first = files[0], isVideo = /^video\//.test(first.type);
    if (!isVideo && !/^image\//.test(first.type)) { live.textContent = 'Ese archivo no es una imagen'; input.value = ''; return; }
    g = await loadGsap();
    if (state !== 'empty') { state = 'done'; up.classList.remove('is-done'); if (flow) flow.kill(); state = 'empty'; g.set(up, { height: H_EMPTY }); g.set(fileEl, { autoAlpha: 0 }); g.set(drop, { autoAlpha: 1, scale: 1 }); }
    const mine = ++token;
    const src = isVideo ? (await videoPoster(first)) || FILM : URL.createObjectURL(first);
    if (mine !== token) return;
    const total = files.reduce((n, f) => n + f.size, 0);
    take(src, files.length > 1 ? `${first.name} +${files.length - 1}` : first.name, weight(total));
  }

  input.addEventListener('change', fromInput);
  ['dragenter', 'dragover'].forEach((t) => up.addEventListener(t, (e) => { e.preventDefault(); up.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((t) => up.addEventListener(t, (e) => { e.preventDefault(); up.classList.remove('is-over'); }));
  up.addEventListener('drop', (e) => {
    const list = e.dataTransfer?.files; if (!list?.length || state !== 'empty') return;
    try { const dt = new DataTransfer(); Array.from(list).slice(0, multiple ? 3 : 1).forEach((f) => dt.items.add(f)); input.files = dt.files; } catch { return; }
    fromInput();
  });
  removeBtn.addEventListener('click', () => clear());
  input.form?.addEventListener('reset', () => setTimeout(() => { if (!input.files?.length && g) clear(true); }, 0));
  // Si el formulario deja el campo vacío por código (p. ej. tras guardar), la vista vuelve sola al estado inicial.
  if (input.files?.length) fromInput();
}

export function enhanceFileInputs(root = document) {
  root.querySelectorAll('input[type="file"]').forEach(enhanceFileInput);
}

let observer = null;
export function autoEnhanceFileInputs() {
  if (observer) return;
  enhanceFileInputs();
  let queued = false;
  observer = new MutationObserver(() => {
    if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; enhanceFileInputs(); });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
