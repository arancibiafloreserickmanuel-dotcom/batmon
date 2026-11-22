// Murciélago 3D que acompaña el scroll de la landing: vuela, cae en picada en Indumentaria y aterriza sobre su póster final.
import {
  AmbientLight, AnimationMixer, DirectionalLight, HemisphereLight, LoopRepeat, MathUtils, OrthographicCamera, Scene, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL_SPAN = 1.83;            // envergadura del modelo (unidades)
const EMBLEM = { cx: 0.492, cy: 0.538, w: 0.787 }; // dónde está el murciélago dentro del póster (fracciones de la imagen)
const rad = MathUtils.degToRad;
const ss = (a, b, x) => { const t = MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

export async function mountBatFlight() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const poster = document.getElementById('bat-poster');
  const secs = { com: '#comunidad', cpl: '#complejos', ind: '#indumentaria', app: '#app', fin: '#final' };

  const canvas = document.createElement('canvas');
  canvas.id = 'bat-canvas'; canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, -3000, 3000);
  camera.position.z = 1000;
  scene.add(new AmbientLight(0xffffff, 0.45), new HemisphereLight(0xffffff, 0x222222, 0.7));
  const key = new DirectionalLight(0xffffff, 1.5); key.position.set(-300, 500, 800); scene.add(key);
  const rim = new DirectionalLight(0xffffff, 1.1); rim.position.set(400, 200, -600); scene.add(rim);

  const gltf = await new GLTFLoader().loadAsync('/bat/murcielago.glb');
  const bat = gltf.scene; scene.add(bat);
  bat.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; if (o.material) o.material.envMapIntensity = 0.4; } });
  const mixer = new AnimationMixer(bat);
  const act = {};
  for (const clip of gltf.animations) { const a = mixer.clipAction(clip); a.setLoop(LoopRepeat, Infinity); a.play(); a.setEffectiveWeight(0); act[clip.name] = a; }
  act.Volar.setEffectiveWeight(1);
  const weights = { Volar: 1, Picada: 0, Planear: 0, Reposo: 0 };

  let W = 0, H = 0, vw = 1440, K = 1;
  let waypoints = [], finalTop = 0, landStart = 0, landEnd = 0, diveA = 0, diveB = 0;
  const top = (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect().top + scrollY : 0; };
  const hgt = (sel) => document.querySelector(sel)?.offsetHeight || 0;

  function layout() {
    W = innerWidth; H = innerHeight; vw = W;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(W, H, false);
    camera.left = -W / 2; camera.right = W / 2; camera.top = H / 2; camera.bottom = -H / 2; camera.updateProjectionMatrix();
    K = W < 768 ? 1.55 : 1;                 // en móvil el murciélago es proporcionalmente más grande
    const T = Object.fromEntries(Object.entries(secs).map(([k, s]) => [k, top(s)]));
    const hCom = hgt(secs.com), hCpl = hgt(secs.cpl), hApp = hgt(secs.app);
    // [scrollY, x, y, ancho (fracción de pantalla), yaw°, alabeo°]
    waypoints = [
      [0, 0.80, 0.30, 0.30, -38, 8],
      [H * 0.6, 0.24, 0.40, 0.27, 34, -9],
      [T.com + hCom * 0.1, 0.74, 0.34, 0.26, -36, 8],
      [T.com + hCom * 0.7, 0.22, 0.52, 0.27, 32, -8],
      [T.cpl + hCpl * 0.15, 0.72, 0.30, 0.26, -34, 8],
      [T.cpl + hCpl * 0.8, 0.30, 0.50, 0.27, 30, -8],
      [T.ind - H * 0.1, 0.55, 0.22, 0.28, -10, 4],
    ];
    diveA = T.ind; diveB = T.ind + H * 1.1;   // caída en picada al entrar a Indumentaria
    waypoints.push([diveA, 0.52, 0.26, 0.30, 0, 0], [diveB, 0.50, 1.35, 0.36, 0, 0]);
    waypoints.push([T.app - H * 0.5, 0.82, -0.25, 0.26, -35, 8], [T.app + hApp * 0.55, 0.28, 0.48, 0.26, 28, -8]);
    finalTop = T.fin;
    const ph = poster ? poster.offsetHeight : H;
    landEnd = finalTop - (H - ph) / 2;                // póster centrado en pantalla
    landStart = landEnd - H * 0.95;
    waypoints.push([landStart, 0.62, 0.12, 0.28, -20, 6]);
    waypoints.sort((a, b) => a[0] - b[0]);
  }

  function pathAt(y) {
    const w = waypoints;
    if (y <= w[0][0]) return w[0].slice(1);
    for (let i = 0; i < w.length - 1; i++) {
      if (y <= w[i + 1][0]) { const t = ss(0, 1, (y - w[i][0]) / Math.max(1, w[i + 1][0] - w[i][0])); return w[i].slice(1).map((v, k) => mix(v, w[i + 1][k + 1], t)); }
    }
    return w[w.length - 1].slice(1);
  }

  // estado suavizado
  const S = { x: 0, y: 0, span: 0, yaw: 0, roll: 0, pitch: 0, ready: false, flap: 1 };
  let last = performance.now(), raf = 0, running = true, lastY = scrollY, t0 = last;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = (now - t0) / 1000;
    const y = scrollY;
    let [px, py, pw, yaw, roll] = pathAt(y);
    let X = px * W, Y = py * H, span = pw * Math.min(W, 1100) * K * (W < 768 ? 1 : 1.1), pitch = 0, rollRad = rad(roll), yawRad = rad(yaw);

    // picada: cabeza abajo, alas recogidas, con ligera oscilación
    const dive = ss(diveA - H * 0.05, diveA + H * 0.12, y) * (1 - ss(diveB - H * 0.2, diveB + H * 0.1, y));
    rollRad = mix(rollRad, Math.PI, dive); yawRad = mix(yawRad, 0, dive);
    X += Math.sin(t * 7) * 6 * dive;

    // aterrizaje exacto sobre el murciélago del póster
    const land = ss(landStart, landEnd, y);
    let rest = 0;
    if (poster && land > 0) {
      const r = poster.getBoundingClientRect();
      const tx = r.left + r.width * EMBLEM.cx, ty = r.top + r.height * EMBLEM.cy, tw = r.width * EMBLEM.w;
      const e = land * land * (3 - 2 * land);
      X = mix(X, tx, e); Y = mix(Y, ty, e); span = mix(span, tw, e);
      yawRad = mix(yawRad, 0, ss(0.45, 1, land)); rollRad = mix(rollRad, 0, ss(0.35, 1, land));
      rest = ss(0.8, 1, land);
    }
    // vuelo: vaivén vertical natural cuando no está aterrizando ni cayendo
    const free = (1 - dive) * (1 - land);
    Y += Math.sin(t * 2.1) * 10 * free + Math.sin(t * 4.3) * 3 * free;
    X += Math.sin(t * 1.3 + 1) * 8 * free;
    // inclinación según la velocidad de scroll
    const vy = (y - lastY) / Math.max(dt, 1e-3); lastY = y;
    pitch = MathUtils.clamp(-vy / 6000, -0.35, 0.35) * free;

    const k = 1 - Math.exp(-dt * (land > 0.6 ? 14 : 5));
    if (!S.ready) { Object.assign(S, { x: X, y: Y, span, yaw: yawRad, roll: rollRad, pitch, ready: true }); }
    else { S.x += (X - S.x) * k; S.y += (Y - S.y) * k; S.span += (span - S.span) * k; S.yaw += (yawRad - S.yaw) * k; S.roll += (rollRad - S.roll) * k; S.pitch += (pitch - S.pitch) * k; }

    // pesos de animación: volar / picada / reposo (pose original del emblema)
    const wantDive = dive > 0.5 ? 1 : 0;
    const target = { Volar: (1 - wantDive) * (1 - rest), Picada: wantDive * (1 - rest), Planear: 0 };
    for (const n of ['Volar', 'Picada', 'Planear']) { weights[n] += (target[n] - weights[n]) * (1 - Math.exp(-dt * 6)); act[n]?.setEffectiveWeight(weights[n]); }
    // aleteo más rápido cuando se hace scroll rápido
    const boost = 1 + Math.min(1.2, Math.abs(vy) / 1800);
    S.flap += (boost - S.flap) * (1 - Math.exp(-dt * 3));
    mixer.timeScale = (0.9 + 0.1 * S.flap) * (1 - rest * 0.8);
    mixer.update(dt);

    bat.visible = S.span > 2 && S.y < H * 1.6 && S.y > -H * 0.6;
    const sc = S.span / MODEL_SPAN;
    bat.scale.setScalar(sc);
    bat.position.set(S.x - W / 2, -(S.y - H / 2), 0);
    bat.rotation.set(S.pitch, S.yaw, -S.roll, 'YXZ');
    renderer.render(scene, camera);
  }

  const onVis = () => { if (document.hidden) { cancelAnimationFrame(raf); running = false; } else if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } };
  layout();
  addEventListener('resize', layout);
  addEventListener('load', layout);
  document.addEventListener('visibilitychange', onVis);
  new ResizeObserver(layout).observe(document.body);
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); removeEventListener('resize', layout); document.removeEventListener('visibilitychange', onVis); canvas.remove(); renderer.dispose(); };
}
