import './style.css';
import { defaultConfig, PRESETS } from './presets.js';
import { createFluidCursor } from './fluid-cursor.js';

/* ---------------------------------------------------------------------
   ORIGINAL: demo wiring — controls panel, presets, and the
   reduced-motion + pause-on-blur lifecycle around the fluid engine.
--------------------------------------------------------------------- */
const canvas = document.getElementById("fluid");
const config = { ...defaultConfig, inkColor: defaultConfig.inkColor.slice() };
const el = (id) => document.getElementById(id);

let fluid = null;

function syncControls() {
  el("curl").value = config.CURL;
  el("iter").value = config.PRESSURE_ITERATIONS;
  el("fade").value = config.DYE_DISSIPATION;
  el("radius").value = config.SPLAT_RADIUS;
  el("curl-val").textContent = config.CURL;
  el("iter-val").textContent = config.PRESSURE_ITERATIONS;
  el("fade-val").textContent = config.DYE_DISSIPATION.toFixed(3);
  el("radius-val").textContent = config.SPLAT_RADIUS.toFixed(5);
}

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  config.CURL = p.CURL;
  config.DYE_DISSIPATION = p.DYE_DISSIPATION;
  config.SPLAT_RADIUS = p.SPLAT_RADIUS;
  config.inkColor = p.inkColor.slice();
  config.threshold = p.threshold;
  config.softness = p.softness;
  canvas.style.mixBlendMode = p.blend;
  syncControls();
}

function bindControls() {
  el("tune-btn").addEventListener("click", () => el("panel").classList.toggle("open"));
  el("preset").addEventListener("change", (e) => applyPreset(e.target.value));
  el("curl").addEventListener("input", (e) => { config.CURL = +e.target.value; el("curl-val").textContent = config.CURL; });
  el("iter").addEventListener("input", (e) => { config.PRESSURE_ITERATIONS = +e.target.value; el("iter-val").textContent = config.PRESSURE_ITERATIONS; });
  el("fade").addEventListener("input", (e) => { config.DYE_DISSIPATION = +e.target.value; el("fade-val").textContent = config.DYE_DISSIPATION.toFixed(3); });
  el("radius").addEventListener("input", (e) => { config.SPLAT_RADIUS = +e.target.value; el("radius-val").textContent = config.SPLAT_RADIUS.toFixed(5); });
  el("clear-btn").addEventListener("click", () => { if (fluid) fluid.clear(); });
  syncControls();
}

try {
  fluid = createFluidCursor(canvas, config);
  bindControls();

  // pause when the tab isn't visible — saves the GPU
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      fluid.stop();
    } else if (!fluid.isRunning()) {
      fluid.start();
    }
  });

  // respect reduced-motion: leave the page static, don't run the sim
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduce) fluid.start();
} catch (err) {
  console.error(err);
  el("fallback").classList.add("show");
}

/* ---------------------------------------------------------------------
   Landing behaviour from the design: sticky header state, reveal-on-scroll,
   scroll-grow community image. (The fluid cursor above is untouched.)
--------------------------------------------------------------------- */
const header = document.getElementById("header");
const visual = document.getElementById("visual");
function onScroll() {
  header.classList.toggle("scrolled", window.scrollY > 40);
  const rect = visual.getBoundingClientRect();
  const vh = window.innerHeight || 800;
  const p = Math.max(0, Math.min(1, (vh - rect.top) / (vh + rect.height)));
  const maxW = Math.min(1000, Math.max(260, window.innerWidth - 96));
  const minW = Math.min(320, maxW);
  const w = Math.round(minW + (maxW - minW) * p);
  visual.style.width = w + "px";
  visual.style.height = Math.round(w * 0.56) + "px";
}
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onScroll);
onScroll();

const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
}, { threshold: 0.15 });
document.querySelectorAll(".reveal").forEach((n) => io.observe(n));
