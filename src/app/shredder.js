// Botón de eliminar con trituradora: la hoja entra a la máquina, sale en tiras y se puede deshacer unos segundos.
// Basado en "The shredder delete button" de Animorio (https://animorio.com): libre en sitios propios y de clientes.
import gsap from 'gsap';
import './shredder.css';

const STRIPS = 13, FEED = 1.5, CURL = 0.2, TWIST = 1.5, FALL = [1100, 3.6], REWIND = 1.7;
const W = 208, H = 270, SEG = 5.4, NODES = Math.round(H / SEG) + 1;
const N = Math.max(4, Math.min(40, Math.round(STRIPS))), SW = W / N;
const MW = W + 28, MH = 60, BW = 172, BH = 52, STEP = 1 / 120, VFEED = H / FEED, LAG = 26, CURL_REACH = 16, CRUMBS = 34;

const MARKUP = `<button type="button" class="shred-x" data-cancel aria-label="Cancelar">×</button>
<div class="shred" data-shred>
  <canvas class="shred__canvas" aria-hidden="true" data-canvas></canvas>
  <div class="shred__sheet" role="img" data-sheet><span class="shred__ghost" data-ghost></span></div>
  <div class="shred__box" data-box>
    <button class="shred__btn" type="button" data-btn>
      <span class="shred__face shred__face--delete" data-face="delete"></span>
      <span class="shred__face shred__face--machine" data-face="machine"><span class="shred__slot"></span><span class="shred__teeth"></span><span class="shred__state"><span data-busy>Triturando</span></span></span>
      <span class="shred__face shred__face--undo" data-face="undo"><span class="shred__timer" data-timer></span></span>
      <span class="shred__label" data-label="delete" aria-hidden="true"><svg class="shred__icon" viewBox="0 0 24 24"><g class="shred__lid"><path d="M4 6.5h16"/><path d="M9.5 6.5V4.25h5V6.5"/></g><path d="M6.2 6.5l.9 13.25h9.8l.9-13.25"/><path d="M10.25 10.5v5.5M13.75 10.5v5.5"/></svg><span>Eliminar</span></span>
      <span class="shred__label shred__label--undo" data-label="undo" aria-hidden="true"><svg class="shred__icon" viewBox="0 0 24 24"><path d="M9 14.5L4.5 10 9 5.5"/><path d="M4.75 10h9.5a5 5 0 0 1 0 10H11"/></svg><span>Deshacer</span></span>
    </button>
  </div>
  <p class="sr" aria-live="polite" data-live></p>
</div>`;

/**
 * Abre la trituradora para eliminar algo.
 * { name, points?: [[lat,lon]], image?: url de la foto publicada (si hay, la hoja es esa foto), undoSeconds = 5, onCommit }: onCommit se llama cuando pasa el tiempo de "Deshacer" (aquí se borra de verdad).
 */
export function openShredder({ name = 'elemento', points = null, image = '', undoSeconds = 5, onCommit } = {}) {
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const UNDO = undoSeconds;
  const root = document.createElement('div');
  root.className = 'shred-ov'; root.innerHTML = MARKUP; document.body.appendChild(root);
  const q = (s) => root.querySelector(s);
  const canvas = q('[data-canvas]'), ctx = canvas.getContext('2d'), sheet = q('[data-sheet]'), ghost = q('[data-ghost]'), box = q('[data-box]'), btn = q('[data-btn]');
  const machine = q('[data-face="machine"]'), undoFace = q('[data-face="undo"]'), redFace = q('[data-face="delete"]'), timer = q('[data-timer]'), busy = q('[data-busy]');
  const labelDelete = q('[data-label="delete"]'), labelUndo = q('[data-label="undo"]'), live = q('[data-live]'), cancelBtn = q('[data-cancel]');
  const css = getComputedStyle(root), colour = (n) => css.getPropertyValue(n).trim();

  let dpr = Math.min(2, window.devicePixelRatio || 1), tex = null, alive = true;

  /* ---- la hoja: barras redondeadas (la forma de las palabras, sin palabras) y, si hay, el trazo de la ruta ---- */
  const bar = (c, x, y, w, h = 3.2) => { c.beginPath(); c.roundRect(x, y, w, h, h / 2); c.fill(); };
  const barRight = (c, x, y, w, h) => bar(c, x - w, y, w, h);
  const para = (c, x, y, widths, lh, h) => { widths.forEach((w, i) => bar(c, x, y + i * lh, w, h)); return y + widths.length * lh; };
  const pen = (c, fill, alpha = 1) => { c.fillStyle = fill; c.globalAlpha = alpha; };

  let photo = null;
  if (image) {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { if (alive) { photo = im; paint(); } };
    im.onerror = () => { if (!im.dataset.retry && alive) { im.dataset.retry = '1'; im.removeAttribute('crossorigin'); im.src = image; } };
    im.src = image;
  }

  function drawDoc(c) {
    if (photo) { // la foto publicada ocupa toda la hoja (recortada para llenarla)
      const k = Math.max(W / photo.naturalWidth, H / photo.naturalHeight), w = photo.naturalWidth * k, h = photo.naturalHeight * k;
      c.drawImage(photo, (W - w) / 2, (H - h) / 2, w, h); return;
    }
    const ink = colour('--doc-ink'), muted = colour('--doc-muted'), accent = colour('--doc-accent');
    pen(c, ink); bar(c, 16, 18, 92, 7); barRight(c, W - 16, 17, 34, 9);
    pen(c, muted, 0.7); bar(c, 16, 31, 56, 3); barRight(c, W - 16, 31, 24, 3);
    pen(c, '#ececec'); c.beginPath(); c.roundRect(16, 50, W - 32, 118, 6); c.fill();
    const pts = (points || []).filter((p) => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]));
    if (pts.length > 1) {
      const lats = pts.map((p) => +p[0]), lons = pts.map((p) => +p[1]);
      const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
      const bw = W - 56, bh = 90, kx = (maxLon - minLon) || 1e-6, ky = (maxLat - minLat) || 1e-6, s = Math.min(bw / kx, bh / ky);
      const ox = 28 + (bw - kx * s) / 2, oy = 64 + (bh - ky * s) / 2;
      c.globalAlpha = 1; c.strokeStyle = ink; c.lineWidth = 2.6; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath();
      pts.forEach((p, i) => { const x = ox + (+p[1] - minLon) * s, y = oy + (maxLat - +p[0]) * s; if (i) c.lineTo(x, y); else c.moveTo(x, y); });
      c.stroke();
    } else { pen(c, muted, 0.5); para(c, 28, 82, [140, 120, 130], 16, 4); }
    pen(c, ink, 0.5); para(c, 16, 184, [176, 150, 170, 120], 10.4, 3.2);
    pen(c, muted, 0.6); para(c, H > 0 ? 16 : 0, H - 36, [150, 104], 8, 2.8);
    pen(c, accent); c.fillRect(0, H - 6, W, 6);
    c.globalAlpha = 1;
  }

  function paint() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = document.createElement('canvas'); c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const g = c.getContext('2d'); g.scale(dpr, dpr); g.fillStyle = colour('--paper'); g.fillRect(0, 0, W, H); drawDoc(g);
    tex = c; sheet.setAttribute('aria-label', name); dirty = true;
  }

  /* ---- las tiras: cadenas de puntos ---- */
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const strips = Array.from({ length: N }, (_, i) => ({ x0: -W / 2 + (i + 0.5) * SW, px: new Float32Array(NODES), py: new Float32Array(NODES), ox: new Float32Array(NODES), oy: new Float32Array(NODES), phi: new Float32Array(NODES), free: new Uint8Array(NODES) }));
  const crumbs = Array.from({ length: CRUMBS }, () => ({ x: 0, y: 0, vx: 0, vy: 0, a: 0, at: 0, w: 1, r: 0 }));

  function resetStrips() {
    seed = 7;
    strips.forEach((s, i) => {
      s.lag = rnd() * LAG; s.curl = CURL * (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5); s.tw = TWIST * (rnd() * 2 - 1); s.wob = rnd() * 6.28; s.spin = 0;
      s.spinV = (rnd() * 2 - 1) * 7; s.tumble = (rnd() * 2 - 1) * 0.9; s.drift = ((i + 0.5) / N - 0.5) * 70 + (rnd() * 2 - 1) * 22;
      s.released = false; s.tRel = 0; s.alpha = 1; s.free.fill(0);
      for (let j = 0; j < NODES; j++) { s.px[j] = s.ox[j] = s.x0; s.py[j] = s.oy[j] = -j * SEG; s.phi[j] = 0; }
    });
    crumbs.forEach((c) => { c.a = 0; c.at = 0.12 + rnd() * (FEED - 0.1); c.x = (rnd() - 0.5) * W; c.w = 1 + rnd() * 1.6; c.r = rnd() * 3; });
  }

  const st = { f: 0, lean: 0, page: 1, drop: 0 };
  let gap = 25, tSim = 0, feedFrom = 0;

  function simulate(h) {
    tSim += h;
    const e0 = st.f - gap, g = FALL[0];
    for (const s of strips) {
      const e = e0 - s.lag;
      if (!s.released && e >= H) {
        s.released = true; s.tRel = tSim;
        for (let j = 0; j < NODES; j++) s.ox[j] -= (s.drift * (0.4 + 0.6 * (j / NODES)) + (j - NODES / 2) * s.tumble) * h;
      }
      const air = s.released ? FALL[1] : 0.6, keep = 1 - Math.min(0.9, air * h);
      for (let j = 0; j < NODES; j++) {
        if (!s.released && j * SEG > e) { s.free[j] = 0; s.px[j] = s.x0; s.py[j] = -(j * SEG - Math.max(0, e)); s.ox[j] = s.px[j]; s.oy[j] = s.py[j] - VFEED * h; continue; }
        s.free[j] = 1;
        const vx = (s.px[j] - s.ox[j]) * keep, vy = (s.py[j] - s.oy[j]) * keep;
        s.ox[j] = s.px[j]; s.oy[j] = s.py[j];
        const flutter = s.released ? Math.sin(tSim * 5 + s.wob + j * 0.06) * 260 : Math.sin(tSim * 2.6 + s.wob + j * 0.03) * 34;
        s.px[j] += vx + flutter * h * h; s.py[j] += vy + g * h * h;
      }
      for (let it = 0; it < 3; it++) {
        for (let j = 0; j < NODES - 1; j++) {
          const a = j, b = j + 1, wa = s.free[a], wb = s.free[b];
          if (!wa && !wb) continue;
          const dx = s.px[b] - s.px[a], dy = s.py[b] - s.py[a], d = Math.hypot(dx, dy) || 0.0001, k = (d - SEG) / d / (wa + wb);
          s.px[a] += dx * k * wa; s.py[a] += dy * k * wa; s.px[b] -= dx * k * wb; s.py[b] -= dy * k * wb;
        }
        const loose = s.released ? Math.min(1, (tSim - s.tRel) * 1.6) : 0, reach = CURL_REACH + (NODES - CURL_REACH) * loose;
        for (let j = Math.min(Math.ceil(reach), NODES - 2); j >= 1; j--) {
          if (!s.free[j - 1]) continue;
          const ux = s.px[j] - s.px[j + 1], uy = s.py[j] - s.py[j + 1], d = Math.hypot(ux, uy) || 0.0001, t = Math.max(0, 1 - j / reach);
          const ang = s.curl * (t * t * (1 - loose) + (0.04 + 0.12 * t) * loose), c = Math.cos(ang), sn = Math.sin(ang);
          const tx = s.px[j] + ((ux * c - uy * sn) / d) * SEG, ty = s.py[j] + ((ux * sn + uy * c) / d) * SEG;
          s.px[j - 1] += (tx - s.px[j - 1]) * 0.3; s.py[j - 1] += (ty - s.py[j - 1]) * 0.3;
        }
      }
      if (s.released) s.spin += s.spinV * h;
      const out = Math.min(H, Math.max(0, e));
      for (let j = 0; j < NODES; j++) { const away = Math.max(0, out - j * SEG) / 100; s.phi[j] = s.tw * away * (1 + 0.25 * Math.sin(tSim * 2.4 + s.wob)) + s.spin * (0.4 + j / NODES); }
      s.alpha = s.released ? 1 - Math.min(1, Math.max(0, (tSim - s.tRel - 0.1) / 0.5)) : 1;
    }
    for (const c of crumbs) {
      const age = tSim - feedFrom - c.at;
      if (age < 0) continue;
      if (c.a === 0 && age < 0.05) { c.y = 2; c.vx = (rnd() - 0.5) * 60; c.vy = 40 + rnd() * 70; c.a = 1; }
      c.vy += g * 0.5 * h; c.vx *= 1 - 2 * h; c.x += c.vx * h; c.y += c.vy * h; c.a = Math.max(0.001, 1 - age / 0.9);
    }
  }

  /* ---- la grabación (para "Deshacer": se reproduce al revés) ---- */
  const ROW = 3 + N * (1 + NODES * 3) + CRUMBS * 3;
  let rec = [], recT = [];
  const frameBuf = new Float32Array(ROW);
  function fill(a) {
    let k = 0;
    a[k++] = st.f; a[k++] = st.lean; a[k++] = st.page;
    for (const s of strips) { a[k++] = s.alpha; for (let j = 0; j < NODES; j++) { a[k++] = s.free[j] ? s.px[j] : NaN; a[k++] = s.py[j]; a[k++] = s.phi[j]; } }
    for (const c of crumbs) { a[k++] = c.x; a[k++] = c.y; a[k++] = (state === 'shredding' || state === 'falling') && tSim - feedFrom - c.at > 0 ? c.a : 0; }
    return a;
  }
  const record = () => { rec.push(fill(new Float32Array(ROW))); recT.push(tSim); };
  function frameAt(t) {
    let lo = 0, hi = recT.length - 1;
    if (hi < 0) return null;
    if (t <= recT[0]) return rec[0];
    if (t >= recT[hi]) return rec[hi];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (recT[m] <= t) lo = m; else hi = m; }
    const k = (t - recT[lo]) / (recT[hi] - recT[lo] || 1), A = rec[lo], B = rec[hi];
    for (let i = 0; i < ROW; i++) frameBuf[i] = A[i] + (B[i] - A[i]) * k;
    return frameBuf;
  }

  /* ---- el dibujo ---- */
  let CW = 0, CH = 0, dirty = true, lastSig = '';
  function fit() {
    const w = innerWidth, h = innerHeight, d = Math.min(2, window.devicePixelRatio || 1);
    if (w === CW && h === CH && d === dpr && canvas.width) return;
    CW = w; CH = h; if (d !== dpr) paint();
    canvas.width = Math.round(w * d); canvas.height = Math.round(h * d); dirty = true;
  }

  function draw(F) {
    const r = sheet.getBoundingClientRect(), b = box.getBoundingClientRect();
    const ex = b.left + b.width / 2, ey = b.top + b.height / 2 + MH / 2 - 2, slot = b.top + b.height / 2 - MH / 2 + 5;
    const sig = `${r.left},${r.top},${b.top},${F[0]},${F[1]},${F[2]},${st.drop},${state}`;
    if (!dirty && sig === lastSig && state !== 'shredding' && state !== 'falling' && state !== 'rewinding') return;
    dirty = false; lastSig = sig; gap = slot - r.bottom;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!tex) return;
    const edge = colour('--paper-edge'), f = F[0], lean = F[1], alpha = F[2] * (1 - st.drop);
    if (alpha > 0.002 && f < gap + H) {
      ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (f > 0) { ctx.beginPath(); ctx.rect(0, 0, CW, slot); ctx.clip(); }
      const shake = state === 'shredding' && f > gap ? Math.sin(tSim * 90) * 0.35 : 0;
      ctx.translate(r.left + W / 2 + shake, r.bottom + f + lean * 5 - st.drop * 18); ctx.rotate(-lean * 0.035); ctx.globalAlpha = alpha;
      ctx.shadowColor = 'rgba(28, 38, 58, 0.16)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 10;
      ctx.fillStyle = colour('--paper'); ctx.fillRect(-W / 2, -H, W, H); ctx.shadowColor = 'transparent';
      ctx.drawImage(tex, -W / 2, -H, W, H);
      ctx.strokeStyle = edge; ctx.lineWidth = 0.8; ctx.strokeRect(-W / 2 + 0.4, -H + 0.4, W - 0.8, H - 0.8);
      ctx.restore();
    }
    const back = colour('--paper-back'), sx = tex.width / W;
    let k = 3;
    for (let i = 0; i < N; i++) {
      const a = F[k++], base = k; k += NODES * 3;
      if (a <= 0.002) continue;
      ctx.globalAlpha = a;
      for (let j = 0; j < NODES - 1; j++) {
        const x1 = F[base + j * 3];
        if (Number.isNaN(x1)) break;
        const y1 = F[base + j * 3 + 1], x2raw = F[base + (j + 1) * 3], x2 = Number.isNaN(x2raw) ? x1 : x2raw, y2 = Number.isNaN(x2raw) ? y1 - SEG : F[base + (j + 1) * 3 + 1];
        const phi = (F[base + j * 3 + 2] + F[base + (j + 1) * 3 + 2]) / 2, cw = Math.cos(phi);
        if (Math.abs(cw) < 0.04) continue;
        const dx = x1 - x2, dy = y1 - y2, len = Math.hypot(dx, dy) || 0.0001, ux = dx / len, uy = dy / len;
        ctx.setTransform(dpr * uy * cw, dpr * -ux * cw, dpr * ux, dpr * uy, dpr * (ex + x2), dpr * (ey + y2));
        const w = SW - 0.7;
        if (cw > 0) ctx.drawImage(tex, (i * SW + 0.35) * sx, (H - (j + 1) * SEG) * sx, w * sx, SEG * sx, -w / 2, 0, w, len + 0.6);
        else { ctx.fillStyle = back; ctx.fillRect(-w / 2, 0, w, len + 0.6); }
        const shade = (1 - Math.abs(cw)) * 0.42;
        if (shade > 0.02) { ctx.fillStyle = `rgba(18, 24, 38, ${shade.toFixed(3)})`; ctx.fillRect(-w / 2, 0, w, len + 0.6); }
        ctx.fillStyle = edge; ctx.fillRect(-w / 2, 0, 0.7, len); ctx.fillRect(w / 2 - 0.7, 0, 0.7, len);
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = colour('--doc-muted');
    for (let c = 0; c < CRUMBS; c++) {
      const a = F[k + c * 3 + 2];
      if (a <= 0.01) continue;
      ctx.globalAlpha = a * 0.55; ctx.fillRect(ex + F[k + c * 3], ey + F[k + c * 3 + 1], 1.4, 1 + (c % 3) * 0.6);
    }
    ctx.globalAlpha = 1;
  }

  /* ---- los estados ---- */
  let state = 'idle', tl = null, undoTl = null;
  const play = { t: 0 };
  function face(el) {
    [machine, undoFace].forEach((x) => {
      if (x === el) { x.style.zIndex = 1; gsap.to(x, { opacity: 1, duration: 0.25, overwrite: 'auto' }); }
      else { x.style.zIndex = 0; gsap.to(x, { opacity: 0, duration: 0.2, delay: el ? 0.25 : 0, overwrite: 'auto' }); }
    });
    gsap.to(redFace, { opacity: el ? 0 : 1, duration: 0.2, delay: el ? 0.25 : 0, overwrite: 'auto' });
  }
  gsap.set([labelDelete, labelUndo], { xPercent: -50, yPercent: -50 });
  const say = (t) => { live.textContent = t; };
  function labels() {
    btn.setAttribute('aria-label', { idle: `Eliminar ${name}`, shredding: `Triturando ${name}. Pulsa para deshacer`, falling: `Deshacer, restaurar ${name}`, undo: `Deshacer, restaurar ${name}`, rewinding: `Restaurando ${name}`, gone: `Eliminar ${name}` }[state]);
    root.dataset.state = state; root.querySelector('[data-shred]').dataset.state = state;
  }

  function shred() {
    state = 'shredding'; labels(); say(`Triturando ${name}`); resetStrips(); rec = []; recT = []; tSim = 0;
    if (tl) tl.kill();
    if (REDUCED) { tl = gsap.timeline().to(st, { page: 0, duration: 0.35 }).to(labelDelete, { opacity: 0, duration: 0.2 }, 0).add(deleted, 0.2); return; }
    busy.textContent = 'Triturando'; feedFrom = 0.15 + 0.45;
    tl = gsap.timeline()
      .to(labelDelete, { y: 14, opacity: 0, duration: 0.2, ease: 'power2.in' }, 0)
      .to(btn, { width: MW, height: MH, borderRadius: 14, duration: 0.45, ease: 'power3.inOut' }, 0)
      .add(() => face(machine), 0.05)
      .to(st, { lean: 0, duration: 0.3, ease: 'power2.out', overwrite: 'auto' }, 0)
      .to(st, { f: () => gap, duration: 0.45, ease: 'power2.in' }, 0.15)
      .to(st, { f: () => gap + H + LAG + 4, duration: FEED + (LAG + 4) / VFEED, ease: 'none' }, feedFrom);
  }

  function deleted() {
    state = REDUCED ? 'undo' : 'falling'; labels(); say(`${name} eliminado. Puedes deshacer durante ${UNDO} segundos`);
    gsap.to(ghost, { opacity: 1, duration: 0.5, delay: REDUCED ? 0 : 0.3 });
    if (REDUCED) gsap.set([undoFace, labelUndo], { opacity: 1 });
    else {
      face(undoFace);
      gsap.to(btn, { width: BW, height: BH, borderRadius: 26, duration: 0.5, ease: 'power3.inOut' });
      gsap.fromTo(labelUndo, { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, delay: 0.2, ease: 'power3.out' });
    }
    if (undoTl) undoTl.kill();
    undoTl = gsap.timeline().fromTo(timer, { scaleX: 1 }, { scaleX: 0, duration: UNDO, ease: 'none' }).add(commit);
  }

  function undo() {
    if (undoTl) undoTl.kill();
    if (tl) tl.kill();
    state = 'rewinding'; labels(); say(`Restaurando ${name}`);
    gsap.to(ghost, { opacity: 0, duration: 0.3 });
    if (REDUCED || !rec.length) {
      gsap.set(undoFace, { opacity: 0 }); gsap.set(labelUndo, { opacity: 0 }); gsap.set(machine, { opacity: 0 }); gsap.set(btn, { width: BW, height: BH, borderRadius: 26 });
      tl = gsap.timeline().to(st, { page: 1, f: 0, duration: REDUCED ? 0.35 : 0.5 }).to(labelDelete, { y: 0, opacity: 1, duration: 0.25 }, 0).add(restored);
      return;
    }
    busy.textContent = 'Restaurando';
    gsap.to(labelUndo, { y: -12, opacity: 0, duration: 0.2, ease: 'power2.in' });
    gsap.to(btn, { width: MW, height: MH, borderRadius: 14, duration: 0.4, ease: 'power3.inOut' });
    face(machine);
    const end = recT[recT.length - 1]; let home = false; play.t = end;
    tl = gsap.timeline().to(play, {
      t: 0, duration: Math.max(0.6, end / REWIND), ease: 'power2.inOut',
      onUpdate: () => {
        dirty = true;
        if (!home && play.t < feedFrom) {
          home = true; face(null);
          gsap.to(btn, { width: BW, height: BH, borderRadius: 26, duration: 0.45, ease: 'power3.inOut' });
          gsap.to(labelDelete, { y: 0, opacity: 1, duration: 0.35, delay: 0.15, ease: 'power3.out' });
        }
      },
    }, 0.1).add(restored);
  }

  function restored() { rec = []; recT = []; st.f = 0; st.page = 1; state = 'idle'; labels(); say(`${name} restaurado`); dirty = true; }

  /* pasó el tiempo de "Deshacer": se elimina de verdad y se cierra */
  function commit() {
    state = 'gone'; labels(); rec = []; recT = [];
    gsap.to(labelUndo, { opacity: 0, duration: 0.2 });
    gsap.to(root, { opacity: 0, duration: 0.35, onComplete: () => { close(); } });
    try { onCommit?.(); } catch { /* el aviso de error lo da quien llama */ }
  }

  function act() {
    if (state === 'idle') shred();
    else if (state === 'shredding' || state === 'falling' || state === 'undo') undo();
  }

  function tick(time, delta) {
    if (!alive) return;
    fit();
    if (state === 'shredding' || state === 'falling') {
      const dt = Math.min(delta / 1000, 1 / 30), steps = Math.max(1, Math.round(dt / STEP));
      for (let n = 0; n < steps; n++) simulate(dt / steps);
      record();
      if (state === 'shredding' && strips.every((s) => s.released)) deleted();
      if (state === 'falling' && strips.every((s) => s.alpha <= 0) && crumbs.every((c) => c.a <= 0.01)) state = 'undo';
      const on = state === 'shredding' && st.f > gap;
      gsap.set(btn, { x: on ? Math.sin(tSim * 83) * 0.5 : 0, y: on ? Math.cos(tSim * 61) * 0.35 : 0 });
      draw(fill(frameBuf));
    } else if (state === 'rewinding' && rec.length) draw(frameAt(play.t));
    else draw(fill(frameBuf));
  }
  gsap.ticker.add(tick);

  /* ---- manos y teclas ---- */
  const leanIn = () => { if (!REDUCED && state === 'idle') gsap.to(st, { lean: 1, duration: 0.5, ease: 'back.out(2)', onUpdate: () => (dirty = true) }); };
  const leanOut = () => { if (state === 'idle') gsap.to(st, { lean: 0, duration: 0.6, ease: 'elastic.out(1, 0.5)', onUpdate: () => (dirty = true) }); };
  const lift = () => { delete btn.dataset.press; if (!REDUCED) gsap.to(btn, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.45)', overwrite: 'auto' }); };
  btn.addEventListener('click', act);
  btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') leanIn(); });
  btn.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') leanOut(); });
  btn.addEventListener('pointerdown', (e) => { btn.dataset.press = ''; if (e.pointerType !== 'mouse') leanIn(); if (!REDUCED) gsap.to(btn, { scale: 0.96, duration: 0.12, ease: 'power2.out', overwrite: 'auto' }); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => btn.addEventListener(t, lift));
  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && state !== 'idle' && state !== 'rewinding' && state !== 'gone') { e.preventDefault(); undo(); } else if (e.key === 'Escape' && state === 'idle') close(); };
  const onResize = () => { dirty = true; };
  addEventListener('keydown', onKey); addEventListener('resize', onResize);
  cancelBtn.addEventListener('click', () => { if (state === 'idle') close(); });
  root.addEventListener('click', (e) => { if (e.target === root && state === 'idle') close(); });

  function close() {
    if (!alive) return; alive = false;
    gsap.ticker.remove(tick); gsap.killTweensOf([root, btn, st, play, ghost, timer, machine, undoFace, redFace, labelDelete, labelUndo]);
    if (tl) tl.kill(); if (undoTl) undoTl.kill();
    removeEventListener('keydown', onKey); removeEventListener('resize', onResize); root.remove();
  }

  resetStrips(); labels(); fit(); paint();
  gsap.from(root, { opacity: 0, duration: 0.25 });
  if (!REDUCED) { st.drop = 1; gsap.to(st, { drop: 0, duration: 0.7, ease: 'power3.out', onUpdate: () => (dirty = true) }); }
  return { close };
}
