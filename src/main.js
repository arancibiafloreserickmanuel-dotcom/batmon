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
  const minW = Math.min(320, maxW);
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
window.addEventListener('pagehide', () => {
  pageIsClosing = true;
  carouselLoader.disconnect();
  disposeComplexCarousel();
}, { once: true });
