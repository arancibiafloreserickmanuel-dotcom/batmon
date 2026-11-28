// Encuentra el código QR dentro de una imagen (p. ej. una captura del banco con nombre, fecha, etc.).
// Busca los tres cuadrados de las esquinas (proporción 1:1:3:1:1) y devuelve el cuadrado exacto del código.

// Blanco y negro con umbral global (Otsu) o local (media de la zona).
function binarize(gray, w, h, local) {
  const out = new Uint8Array(w * h); // 1 = oscuro
  if (!local) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, th = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = gray.length - wB; if (!wF) break;
      sumB += t * hist[t];
      const v = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
      if (v > best) { best = v; th = t; }
    }
    for (let i = 0; i < gray.length; i++) out[i] = gray[i] <= th ? 1 : 0;
    return out;
  }
  const W = w + 1, integral = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += gray[y * w + x]; integral[(y + 1) * W + x + 1] = integral[y * W + x + 1] + row; }
  }
  const r = Math.max(12, Math.round(Math.min(w, h) / 10));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const mean = (integral[y1 * W + x1] - integral[y0 * W + x1] - integral[y1 * W + x0] + integral[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
      out[y * w + x] = gray[y * w + x] < mean - 8 ? 1 : 0;
    }
  }
  return out;
}

const isFinder = (c) => {
  const total = c[0] + c[1] + c[2] + c[3] + c[4];
  if (total < 7 || c.some((v) => !v)) return false;
  const u = total / 7, tol = u * 0.7;
  return Math.abs(c[0] - u) < tol && Math.abs(c[1] - u) < tol && Math.abs(c[2] - 3 * u) < 3 * tol && Math.abs(c[3] - u) < tol && Math.abs(c[4] - u) < tol;
};

// Confirma el patrón en una dirección pasando por (x, y); devuelve centro y tamaño.
function crossCheck(bin, w, h, x, y, dx, dy) {
  const at = (k) => { const px = x + dx * k, py = y + dy * k; return px < 0 || py < 0 || px >= w || py >= h ? -1 : bin[py * w + px]; };
  const c = [0, 0, 0, 0, 0];
  let k = 0;
  while (at(k) === 1) { c[2]++; k--; }
  while (at(k) === 0) { c[1]++; k--; }
  while (at(k) === 1) { c[0]++; k--; }
  k = 1;
  while (at(k) === 1) { c[2]++; k++; }
  while (at(k) === 0) { c[3]++; k++; }
  const start = k;
  while (at(k) === 1) { c[4]++; k++; }
  if (!isFinder(c)) return null;
  const end = start + c[4];
  return { center: end - c[4] - c[3] - c[2] / 2 - 0.5, size: c[0] + c[1] + c[2] + c[3] + c[4] };
}

function finders(bin, w, h) {
  const found = [];
  for (let y = 0; y < h; y += 2) {
    const runs = [];
    let x = 0;
    while (x < w) { const v = bin[y * w + x]; let n = x; while (n < w && bin[y * w + n] === v) n++; runs.push([v, x, n - x]); x = n; }
    for (let i = 0; i + 4 < runs.length; i++) {
      if (runs[i][0] !== 1) continue;
      const c = [0, 1, 2, 3, 4].map((j) => runs[i + j][2]);
      if (!isFinder(c)) continue;
      const cx = Math.floor(runs[i + 2][1] + runs[i + 2][2] / 2);
      const v = crossCheck(bin, w, h, cx, y, 0, 1); if (!v) continue;
      const cy = Math.round(y + v.center);
      const hz = crossCheck(bin, w, h, cx, cy, 1, 0); if (!hz) continue;
      const fx = cx + hz.center + 0.5, fy = y + v.center + 0.5, m = (v.size + hz.size) / 14;
      const same = found.find((f) => Math.hypot(f.x - fx, f.y - fy) < f.m * 4);
      if (same) { const n = same.n + 1; same.x = (same.x * same.n + fx) / n; same.y = (same.y * same.n + fy) / n; same.m = (same.m * same.n + m) / n; same.n = n; }
      else found.push({ x: fx, y: fy, m, n: 1 });
    }
  }
  return found.filter((f) => f.n >= 2).sort((a, b) => b.n - a.n).slice(0, 24);
}

// Elige las tres esquinas que forman un triángulo rectángulo isósceles.
function pickTriple(list) {
  let best = null;
  for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) for (let k = j + 1; k < list.length; k++) {
    if (i === j || i === k) continue;
    const a = list[i], b = list[j], c = list[k];
    const ms = [a.m, b.m, c.m];
    if (Math.max(...ms) / Math.min(...ms) > 1.5) continue;
    const ab = Math.hypot(b.x - a.x, b.y - a.y), ac = Math.hypot(c.x - a.x, c.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y);
    const legs = Math.abs(ab - ac) / Math.max(ab, ac), diag = Math.abs(bc - Math.hypot(ab, ac)) / bc;
    const m = (a.m + b.m + c.m) / 3;
    if (legs > 0.15 || diag > 0.08 || ab / m < 11) continue;
    const score = Math.min(a.n, 12) + Math.min(b.n, 12) + Math.min(c.n, 12) - (legs + diag) * 60;
    if (!best || score > best.score) best = { a, b, c, m, score };
  }
  return best;
}

/** rgba: píxeles de un canvas. Devuelve { x, y, size } (cuadrado exacto del QR, en píxeles) o null. */
export function detectQr(rgba, w, h) {
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) gray[i] = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 151 + rgba[i * 4 + 2] * 28) >> 8;
  for (const local of [false, true]) {
    const t = pickTriple(finders(binarize(gray, w, h, local), w, h));
    if (!t) continue;
    const { a, b, c, m } = t;
    const unit = (p) => { const d = Math.hypot(p.x - a.x, p.y - a.y); return [(p.x - a.x) / d, (p.y - a.y) / d]; };
    const u = unit(b), v = unit(c), e = 3.5 * m; // el centro de cada esquina queda a 3,5 módulos del borde
    const pts = [
      [a.x - e * (u[0] + v[0]), a.y - e * (u[1] + v[1])],
      [b.x + e * (u[0] - v[0]), b.y + e * (u[1] - v[1])],
      [c.x + e * (v[0] - u[0]), c.y + e * (v[1] - u[1])],
      [b.x + c.x - a.x + e * (u[0] + v[0]), b.y + c.y - a.y + e * (u[1] + v[1])],
    ];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    if (size > Math.min(w, h) * 1.03) continue;
    return { x: cx - size / 2, y: cy - size / 2, size };
  }
  return null;
}
