import './style.css';
import { defaultConfig } from './presets.js';
import { createFluidCursor } from './fluid-cursor.js';

// The cursor keeps fixed brand settings; only its width adapts to the viewport.
const canvas = document.getElementById("fluid");
const config = { ...defaultConfig, inkColor: defaultConfig.inkColor.slice() };
const mobileCursor = window.matchMedia("(max-width: 640px)");
if (mobileCursor.matches) config.SPLAT_RADIUS = 0.00026;

let fluid = null;
mobileCursor.addEventListener("change", (event) => {
  config.SPLAT_RADIUS = event.matches ? 0.00026 : defaultConfig.SPLAT_RADIUS;
});

try {
  fluid = createFluidCursor(canvas, config);

  // Pause when the tab isn't visible to save GPU resources.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      fluid.stop();
    } else if (!fluid.isRunning()) {
      fluid.start();
    }
  });

  // Respect reduced-motion preferences.
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduce) fluid.start();
} catch (err) {
  console.error(err);
  document.getElementById("fallback").classList.add("show");
}

// Landing behaviour: sticky header state, reveal-on-scroll, and community image growth.
const header = document.getElementById("header");
const visual = document.getElementById("visual");
function onScroll() {
  header.classList.toggle("scrolled", window.scrollY > 40);
  const rect = visual.getBoundingClientRect();
  const vh = window.innerHeight || 800;
  const p = Math.max(0, Math.min(1, (vh - rect.top) / (vh + rect.height)));
  const mobile = window.matchMedia("(max-width: 760px)").matches;
  const maxW = mobile
    ? Math.max(260, window.innerWidth - 32)
    : Math.min(1000, Math.max(260, window.innerWidth - 96));
  // En móvil el ancho inicial debe ser claramente menor para que el crecimiento
  // al entrar en «En cada ruta, un Crowd» se perciba igual que en escritorio.
  const minW = mobile ? Math.min(190, Math.max(140, maxW * 0.48)) : Math.min(320, maxW);
  const w = Math.round(minW + (maxW - minW) * p);
  visual.style.width = w + "px";
  visual.style.height = Math.round(w * (941 / 1672)) + "px";
}
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onScroll);
onScroll();

const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) {
      e.target.classList.add("is-in");
      io.unobserve(e.target);
    }
  });
}, { threshold: 0.15 });
document.querySelectorAll(".reveal").forEach((n) => io.observe(n));

let disposeComplexCarousel = () => {};
let pageIsClosing = false;
const carouselRoot = document.getElementById('complex-carousel');
const carouselLoader = new IntersectionObserver(([entry]) => {
  if (!entry.isIntersecting) return;
  carouselLoader.disconnect();
  import('./complex-carousel.js').then(({ mountComplexCarousel }) => {
    if (!pageIsClosing) disposeComplexCarousel = mountComplexCarousel();
  });
}, { rootMargin: '240px 0px' });
if (carouselRoot) carouselLoader.observe(carouselRoot);
const apparelRoot = document.getElementById('indumentaria');
const apparelLoader = new IntersectionObserver(([entry]) => {
  if (!entry.isIntersecting) return;
  apparelLoader.disconnect();
  import('./indumentaria-gallery.js').then(({ mountApparelGallery }) => {
    if (!pageIsClosing) disposeApparelGallery = mountApparelGallery();
  });
}, { rootMargin: '240px 0px' });
let disposeApparelGallery = () => {};
const appRoot = document.getElementById('app-slider');
const appLoader = new IntersectionObserver(([entry]) => {
  if (!entry.isIntersecting) return;
  appLoader.disconnect();
  import('./app-slider.js').then(({ mountAppSlider }) => { if (!pageIsClosing) mountAppSlider(appRoot); });
}, { rootMargin: '300px 0px' });
if (appRoot) appLoader.observe(appRoot);
// Murciélago que vuela con el scroll (se carga cuando la página ya está lista)
const startBat = () => import('./bat-flight.js').then(({ mountBatFlight }) => { if (!pageIsClosing) mountBatFlight().catch((e) => { console.warn('Murciélago no disponible', e); const h = document.querySelector('.bc-mark-frame img'); if (h) h.src = '/hero-batmon.png'; }); });
if (document.readyState === 'complete') startBat(); else addEventListener('load', startBat, { once: true });
if (apparelRoot) apparelLoader.observe(apparelRoot);
window.addEventListener('pagehide', () => {
  pageIsClosing = true;
  carouselLoader.disconnect();
  apparelLoader.disconnect();
  disposeComplexCarousel();
  disposeApparelGallery();
}, { once: true });
