// Rangos: los LOGROS son la moneda. Los logros salen de (1) logros de cuenta conseguidos y (2) retos completados.
// El rango solo depende de constancia y esfuerzo verificado en la app, nunca del físico, peso o medidas del socio.
const BASE = '/ranks';

export const TIERS = [
  { key: 'hierro', name: 'Hierro', color: '#8a8a95', start: 0, steps: [0, 25, 60] },
  { key: 'cobre', name: 'Cobre', color: '#a26244', start: 100, steps: [100, 160, 230] },
  { key: 'plata', name: 'Plata', color: '#92a0b1', start: 320, steps: [320, 420, 540] },
  { key: 'oro', name: 'Oro', color: '#c09148', start: 700, steps: [700, 880, 1100] },
  { key: 'esmeralda', name: 'Esmeralda', color: '#2ecc71', start: 1350, steps: [1350, 1650, 2000] },
  { key: 'zafiro', name: 'Zafiro', color: '#3b82f6', start: 2400, steps: [2400, 2850, 3350] },
  { key: 'rubi', name: 'Rubí', color: '#e11d48', start: 3900, steps: [3900, 4500, 5200] },
  { key: 'diamante', name: 'Diamante', color: '#7dd3fc', start: 6000, steps: [6000, 6900, 7900] },
  { key: 'campeon', name: 'Campeón', color: '#a855f7', start: 9000, steps: [9000, 10300, 11800] },
];
const ROMAN = ['I', 'II', 'III'];

/** Escalones planos de menor a mayor. */
const LADDER = TIERS.flatMap((t) => t.steps.map((from, i) => ({ tier: t, level: i + 1, from })));

export const rankIcon = (tier, level, size = 128) => `${BASE}/${tier.key}-${level}-${size}.webp`;

/** Rango para un total de logros. */
export function rankFor(points) {
  const p = Math.max(0, Math.floor(points || 0));
  let idx = 0;
  LADDER.forEach((step, i) => { if (p >= step.from) idx = i; });
  const cur = LADDER[idx], next = LADDER[idx + 1] || null;
  return {
    tier: cur.tier, level: cur.level, name: `${cur.tier.name} ${ROMAN[cur.level - 1]}`, points: p,
    from: cur.from, next, nextName: next ? `${next.tier.name} ${ROMAN[next.level - 1]}` : null,
    progress: next ? (p - cur.from) / (next.from - cur.from) : 1, missing: next ? next.from - p : 0,
    icon: rankIcon(cur.tier, cur.level), iconBig: rankIcon(cur.tier, cur.level, 384),
  };
}

export const rankBadge = (rank, size = 28) => `<img class="rank-badge" src="${rank.icon}" alt="Rango ${rank.name}" width="${size}" height="${size}" loading="lazy">`;

export const TIER_POINTS = { bronze: 10, silver: 25, gold: 60 };

const escHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Ventana con la explicación de los rangos (se abre al tocar el icono del perfil). */
export function openRankInfo(rank, account = 0, challenges = 0) {
  const modal = document.createElement('div'); modal.className = 'modal rank-info';
  modal.innerHTML = `<section class="sheet" role="dialog" aria-modal="true" aria-label="Rangos"><div class="sheet-h"><h2>Rangos</h2><button class="link" type="button" data-close>Cerrar</button></div>
    <div class="rank-info__me"><img src="${rank.iconBig}" alt=""><div><b>${escHtml(rank.name)}</b><p class="muted">${rank.points} logros${rank.next ? ` · faltan ${rank.missing} para ${escHtml(rank.nextName)}` : ' · rango máximo'}</p><small class="muted">Cuenta: ${account} · Retos: ${challenges}</small></div></div>
    <p><b>¿Qué son los logros?</b> Son la moneda para subir de rango. Se ganan con los logros de tu cuenta (bronce +10, plata +25, oro +60) y completando retos del club.</p>
    <p><b>¿Cómo subo?</b> Entrena con constancia en Running, Ciclismo, Natación, Pliometría y Fuerza, comparte tus entrenamientos y completa retos.</p>
    <p><b>¿Es justo?</b> Sí: el rango no depende de tu físico, peso ni medidas, solo de tu constancia y esfuerzo registrado.</p>
    <div class="rank-info__ladder">${TIERS.map((t) => `<span class="${t.key === rank.tier.key ? 'on' : ''}"><img src="${rankIcon(t, 1)}" alt="" loading="lazy"><small>${t.name}</small><em>${t.start}+</em></span>`).join('')}</div></section>`;
  document.body.append(modal);
  const close = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) close(); };
  modal.querySelector('[data-close]').onclick = close;
}
