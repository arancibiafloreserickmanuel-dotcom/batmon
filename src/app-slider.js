// Carrusel 3D de celulares (animación de https://github.com/shivc868/component-018), con avance automático en bucle.
import { gsap } from 'gsap';
import { MathUtils } from 'three';
import { Draggable } from 'gsap/Draggable';
import { InertiaPlugin } from 'gsap/InertiaPlugin';

gsap.registerPlugin(Draggable, InertiaPlugin);

const SHOTS = [
  ['Inicio de la app', 1], ['Mapa de rutas', 2], ['Entrenamiento de pliometría', 3],
  ['Rutinas del plan', 4], ['Perfil y estadísticas', 5], ['Sesión de entrenamiento en curso', 6],
];
const DESKTOP = {
  cardWidth: 'clamp(150px, 17vw, 260px)', cardAspect: '720 / 1460',
  gap: 250, step: 170, stepDecay: 0.71, depth: 90, depthStep: 15, rotBase: 62, rotStep: 80, perspective: 1000,
  centerScale: 1.08, scaleDrop: 0.2, scaleStep: 0.17, visiblePerSide: 3, fadeZone: 0.45,
  dragUnit: 300, maxThrowDuration: 1.6, designWidth: 1650, minScale: 0.62, introDuration: 1.7, introEase: 'expo.inOut',
};
const MOBILE = {
  cardWidth: 'clamp(150px, 46vw, 230px)', gap: 130, step: 85, depth: 60, depthStep: 12, rotBase: 55, rotStep: 70, perspective: 800,
  centerScale: 1.04, scaleDrop: 0.17, scaleStep: 0.14, visiblePerSide: 2, dragUnit: 180, designWidth: 400, minScale: 0.75,
};
const AUTO_EVERY = 2.4, AUTO_RESUME = 1.8;

export function mountAppSlider(root) {
  const stage = root.querySelector('.app-slider__stage');
  const C = { ...DESKTOP };
  const COUNT = SHOTS.length, wrapOffset = gsap.utils.wrap(-COUNT / 2, COUNT / 2);
  stage.style.perspectiveOrigin = '50% 50%';
  const cards = SHOTS.map(([alt, n]) => {
    const card = document.createElement('div');
    card.className = 'app-card';
    const img = new Image();
    img.src = `/app/phone-${n}.webp`; img.alt = alt; img.draggable = false; img.decoding = 'async';
    card.append(img); stage.append(card);
    gsap.set(card, { xPercent: -50, yPercent: -50 });
    return card;
  });

  let rs = 1, spread = 0, position = 0, visible = false, hold = false, idleCall = null, autoTween = null;
  const computeScale = () => { rs = gsap.utils.clamp(C.minScale, 1, innerWidth / C.designWidth); };
  const render = (pos) => {
    for (let i = 0; i < COUNT; i++) {
      const off = wrapOffset(i - pos), d = Math.abs(off), side = Math.sign(off), t = Math.min(d, 1), rest = Math.max(d - 1, 0);
      const stack = C.step * ((1 - Math.pow(C.stepDecay, rest)) / (1 - C.stepDecay));
      const rotation = (t * C.rotBase + rest * C.rotStep) * spread;
      gsap.set(cards[i], {
        x: side * (t * C.gap + stack) * rs * spread, z: -(t * C.depth + rest * C.depthStep) * rs * spread, rotationY: -side * rotation,
        scale: C.centerScale - t * C.scaleDrop - rest * C.scaleStep,
        opacity: gsap.utils.clamp(0, 1, (C.visiblePerSide + C.fadeZone - d) / C.fadeZone),
        zIndex: Math.round((COUNT - d) * 10), force3D: true,
      });
    }
  };

  const proxy = document.createElement('div');
  const update = () => { position = -draggable.x / C.dragUnit; render(position); };

  // El scroll vertical mueve el carrusel mientras la sección está fija; al terminar se libera la página
  const runway = document.getElementById('app-runway');
  const progress = () => {
    if (!runway) return 0;
    const stageH = runway.firstElementChild?.offsetHeight || innerHeight;
    return MathUtils.clamp(-runway.getBoundingClientRect().top / Math.max(1, runway.offsetHeight - stageH), 0, 1);
  };
  function follow() {
    if (hold || spread < 1) return;
    autoTween?.kill();
    autoTween = gsap.to(proxy, { x: -progress() * (COUNT - 1) * C.dragUnit, duration: 0.55, ease: 'power2.out', overwrite: true, onUpdate: () => { draggable.update(); update(); } });
  }
  addEventListener('scroll', follow, { passive: true });

  const draggable = Draggable.create(proxy, {
    type: 'x', trigger: root, inertia: true,
    snap: (v) => Math.round(v / C.dragUnit) * C.dragUnit, maxDuration: C.maxThrowDuration,
    onPress() { hold = true; autoTween?.kill(); idleCall?.kill(); root.classList.add('is-grabbing'); },
    onRelease() { root.classList.remove('is-grabbing'); },
    onDrag: update, onThrowUpdate: update,
    onDragEnd() {
      const resume = () => { idleCall?.kill(); idleCall = gsap.delayedCall(AUTO_RESUME, () => { hold = false; }); };
      if (!this.tween || !this.tween.isActive()) {
        gsap.to(proxy, { x: Math.round(this.x / C.dragUnit) * C.dragUnit, duration: 0.5, ease: 'power3.out', onUpdate: () => { draggable.update(); update(); }, onComplete: resume });
      } else this.tween.eventCallback('onComplete', resume);
    },
  })[0];

  const mq = matchMedia('(max-width: 767px)');
  const apply = () => {
    Object.assign(C, mq.matches ? { ...DESKTOP, ...MOBILE } : DESKTOP);
    cards.forEach((c) => { c.style.width = C.cardWidth; c.style.aspectRatio = C.cardAspect; });
    stage.style.perspective = `${C.perspective}px`;
    gsap.set(proxy, { x: -position * C.dragUnit }); draggable.update(); computeScale(); render(position);
  };
  apply();
  mq.addEventListener('change', apply);
  const onResize = () => { computeScale(); render(position); };
  addEventListener('resize', onResize);

  let introduced = false;
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !introduced) {
      introduced = true;
      gsap.to({ v: 0 }, { v: 1, duration: C.introDuration, ease: C.introEase, onUpdate() { spread = this.targets()[0].v; render(position); }, onComplete: follow });
    }
  }, { threshold: 0.25 });
  io.observe(root);

  return () => { io.disconnect(); mq.removeEventListener('change', apply); removeEventListener('resize', onResize); autoTween?.kill(); idleCall?.kill(); removeEventListener('scroll', follow); draggable.kill(); };
}
