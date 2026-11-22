// Botón de "Me gusta" animado (corazón + contador que rueda), sin fondo.
// Basado en "The like button" de Animorio (https://animorio.com): libre en sitios propios y de clientes.
import gsap from 'gsap';

const HEART = 'M16 27.6c-.5 0-1-.2-1.4-.5C8.9 22.6 3.6 18.1 3.6 11.9c0-3.8 2.9-6.6 6.4-6.6 2.5 0 4.6 1.3 6 3.3 1.4-2 3.5-3.3 6-3.3 3.5 0 6.4 2.8 6.4 6.6 0 6.2-5.3 10.7-11 15.2-.4.3-.9.5-1.4.5z';
const RAYS = 8, BURST = 0.6, POP = [1, 0.4], ROLL = 0.5, COLORS = ['#a3162e', '#7d1226', '#b0334a'];
const SVG = 'http://www.w3.org/2000/svg';
const fmt = new Intl.NumberFormat('es-BO');

export const likeMarkup = (liked, count, attrs = '') => `<button type="button" class="lk" data-like aria-pressed="${liked}" aria-label="Me gusta" ${attrs}>
  <span class="lk__icon" aria-hidden="true">
    <svg class="lk__burst" viewBox="-60 -60 120 120"><circle class="lk__ring" r="0" data-ring/><g data-rays></g></svg>
    <svg class="lk__heart" viewBox="0 0 32 32" data-heart><path class="lk__outline" d="${HEART}"/><path class="lk__fill" data-fill d="${HEART}"/></svg>
  </span><span class="lk__count" aria-hidden="true" data-count>${fmt.format(count)}</span></button>`;

/** Activa la animación sobre un botón creado con likeMarkup. Devuelve { set(liked, count, animate) }. */
export function mountLike(button, { liked, count }) {
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const heart = button.querySelector('[data-heart]'), fill = button.querySelector('[data-fill]'), ring = button.querySelector('[data-ring]'), countEl = button.querySelector('[data-count]');
  let n = count, shown = fmt.format(n), state = liked;

  const rays = Array.from({ length: RAYS }, (_, i) => {
    const g = document.createElementNS(SVG, 'g'); g.setAttribute('transform', `rotate(${(360 / RAYS) * i - 90})`);
    const line = document.createElementNS(SVG, 'line'); ['x1', 'y1', 'x2', 'y2'].forEach((a) => line.setAttribute(a, '0')); line.setAttribute('stroke', COLORS[i % COLORS.length]);
    g.appendChild(line); button.querySelector('[data-rays]').appendChild(g); return line;
  });
  gsap.set(rays, { opacity: 0 });
  gsap.set(fill, { scale: liked ? 1 : 0, transformOrigin: '50% 55%' });
  gsap.set(heart, { transformOrigin: '50% 55%' });

  const burst = () => {
    const tl = gsap.timeline();
    tl.fromTo(ring, { attr: { r: 11 }, strokeWidth: 7 }, { attr: { r: 26 }, strokeWidth: 0, duration: BURST * 0.55, ease: 'power3.out' }, 0);
    rays.forEach((line, i) => {
      const far = i % 2 ? 0.7 : 1;
      tl.fromTo(line, { attr: { x1: 24, x2: 24 }, opacity: 0 }, { attr: { x2: 24 + 12 * far }, opacity: 1, duration: BURST * 0.28, ease: 'power2.out', immediateRender: false }, BURST * 0.18)
        .to(line, { attr: { x1: 24 + 19 * far, x2: 24 + 19 * far }, opacity: 0, duration: BURST * 0.45, ease: 'power2.out' }, BURST * 0.46);
    });
    return tl;
  };

  const slots = (s) => countEl.replaceChildren(...[...s].map((ch) => { const slot = document.createElement('span'); slot.className = 'slot'; const f = document.createElement('span'); f.textContent = ch; slot.appendChild(f); return slot; }));
  const roll = (dir) => {
    const s = fmt.format(n);
    if (REDUCED) { slots(s); shown = s; return; }
    if (s.length !== shown.length) {
      gsap.timeline()
        .to(countEl, { yPercent: -70 * dir, opacity: 0, duration: ROLL * 0.35, ease: 'power2.in', onComplete: () => slots(s) })
        .fromTo(countEl, { yPercent: 70 * dir, opacity: 0 }, { yPercent: 0, opacity: 1, duration: ROLL * 0.65, ease: 'power3.out', immediateRender: false });
    } else {
      [...s].forEach((ch, i) => {
        if (ch === shown[i]) return;
        const slot = countEl.children[i];
        [...slot.children].slice(0, -1).forEach((e) => { gsap.killTweensOf(e); e.remove(); });
        const old = slot.lastElementChild; gsap.killTweensOf(old);
        const fresh = document.createElement('span'); fresh.textContent = ch; slot.appendChild(fresh);
        const delay = (s.length - 1 - i) * 0.06, ease = 'back.out(1.6)';
        gsap.fromTo(old, { yPercent: 0, y: 0 }, { yPercent: -100 * dir, y: -6 * dir, duration: ROLL, ease, delay, onComplete: () => old.remove() });
        gsap.fromTo(fresh, { yPercent: 100 * dir, y: 6 * dir }, { yPercent: 0, y: 0, duration: ROLL, ease, delay });
      });
    }
    shown = s;
  };

  slots(shown);

  const beat = () => { if (!REDUCED) gsap.to(heart, { keyframes: { scale: [1.16, 0.96, 1.07, 1], easeEach: 'sine.inOut' }, duration: 0.7, overwrite: 'auto' }); };
  button.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') beat(); });
  button.addEventListener('pointerdown', () => { if (!REDUCED) gsap.to(button, { scale: 0.94, duration: 0.1, ease: 'power2.out', overwrite: 'auto' }); });
  const release = () => { if (!REDUCED) gsap.to(button, { scale: 1, duration: 0.7, ease: 'elastic.out(1, 0.4)', overwrite: 'auto' }); };
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => button.addEventListener(ev, release));

  return {
    set(nextLiked, nextCount, animate = true) {
      const dir = nextCount >= n ? 1 : -1; n = nextCount; button.setAttribute('aria-pressed', String(nextLiked));
      if (!animate) { slots(fmt.format(n)); shown = fmt.format(n); gsap.set(fill, { scale: nextLiked ? 1 : 0 }); state = nextLiked; return; }
      roll(dir);
      if (REDUCED) { gsap.to(fill, { scale: nextLiked ? 1 : 0, duration: 0, overwrite: true }); state = nextLiked; return; }
      if (nextLiked && !state) {
        gsap.timeline()
          .to(heart, { scale: 0.76, duration: 0.1, ease: 'power2.in', overwrite: 'auto' })
          .set(fill, { scale: 0.15 })
          .to(heart, { scale: 1, duration: 0.8, ease: `elastic.out(${POP[0]}, ${POP[1]})`, overwrite: 'auto' })
          .to(fill, { scale: 1, duration: 0.8, ease: `elastic.out(${POP[0]}, ${POP[1]})`, overwrite: 'auto' }, '<')
          .add(burst(), '<');
      } else if (!nextLiked && state) {
        gsap.timeline()
          .to(fill, { scale: 0, duration: 0.25, ease: 'power2.in', overwrite: 'auto' })
          .fromTo(heart, { scale: 0.86 }, { scale: 1, duration: 0.55, ease: 'back.out(3)', overwrite: 'auto' }, 0.08);
      }
      state = nextLiked;
    },
  };
}
