import {
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';

const images = [
  { src: '/apparel-shirt-back.png', alt: 'Polera Batmon Crowd, vista posterior' },
  { src: '/apparel-shirt-front.png', alt: 'Polera Batmon Crowd, vista frontal' },
  { src: '/apparel-new-polera.png', alt: 'Nueva polera Batmon Crowd' },
  { src: '/apparel-crowd-shirt.png', alt: 'Diseño de poleras Batmon Crowd' },
  { src: '/apparel-run-punilla.png', alt: 'Polera Run Punilla' },
];

const C = {
  radius: 5,
  step: 0.535,
  pitch: -1.225493061807594,
  spinOffset: 4.3,
  tiltX: 0.05,
  baseY: -4.4,
  cardWidth: 2.56,
  cardHeight: 3.56,
  bank: 0.25,
  guideRadius: 1.02,
  guideLength: 0.5,
  guideHeight: 1.15,
  turns: 2.61,
  entryBack: 0.91,
  fov: 65,
  camY: 2.65,
  camZ: 9.35,
  lookAtY: 3.8,
};

const mobileLayout = window.matchMedia('(max-width: 760px)').matches;
const L = mobileLayout ? { ...C, radius: 4.3, step: 0.9, cardWidth: 3.6, cardHeight: 5.2 } : C;
const stripWidth = 2 * L.radius * L.guideRadius * 1.12;
const turnDrop = Math.abs(L.pitch * Math.PI * 2);

function containTexture(image, renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 1068;
  const ctx = canvas.getContext('2d');
  const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  ctx.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

export function mountApparelGallery() {
  const root = document.getElementById('indumentaria');
  const stage = document.getElementById('apparel-stage');
  const canvas = document.getElementById('apparel-canvas');
  const topTitle = document.querySelector('.apparel-title-top');
  const bottomTitle = document.querySelector('.apparel-title-bottom');
  const middleTitle = document.querySelector('.apparel-title-middle');
  if (!root || !stage || !canvas) return () => {};

  const scene = new Scene();
  const camera = new PerspectiveCamera(L.fov, 1, 0.1, 60);
  camera.position.set(0, L.camY, L.camZ);
  camera.lookAt(0, L.lookAtY, 0);
  const rig = new Group();
  const tilt = new Group();
  const spin = new Group();
  const guides = new Group();
  tilt.rotation.x = L.tiltX;
  tilt.position.y = L.baseY;
  tilt.add(spin, guides);
  rig.add(tilt);
  scene.add(rig);

  let renderer;
  let meshes = [];
  let textures = [];
  let visible = false;
  let destroyed = false;
  let progress = 0;
  let extraTurns = 0;
  let raf = 0;
  const pointer = new Vector2();
  const raycaster = new Raycaster();

  function cardCenter(angle, midY) {
    return new Vector3(L.radius * Math.sin(angle), angle * L.pitch - midY, L.radius * Math.cos(angle));
  }

  function makeGeometry(angle, midY) {
    const geometry = new PlaneGeometry(L.cardWidth, L.cardHeight, 32, 8);
    const positions = geometry.attributes.position;
    const bank = Math.atan2(L.pitch, L.radius) * L.bank;
    const center = cardCenter(angle, midY);
    for (let i = 0; i < positions.count; i++) {
      const theta = angle + positions.getX(i) / L.radius;
      const y = positions.getY(i);
      const radius = L.radius - y * Math.sin(bank);
      positions.setXYZ(i,
        radius * Math.sin(theta) - center.x,
        theta * L.pitch - midY + y * Math.cos(bank) - center.y,
        radius * Math.cos(theta) - center.z);
    }
    return geometry;
  }

  function draw() {
    if (!renderer || !visible || destroyed) return;
    const entry = L.entryBack + extraTurns * Math.PI * 2;
    const spinSpan = (L.turns + extraTurns) * Math.PI * 2;
    const travel = entry - progress * spinSpan;
    spin.rotation.y = L.spinOffset + travel;
    spin.position.y = L.pitch * travel;
    const guideTravel = entry - (1 - progress) * spinSpan;
    guides.rotation.y = L.spinOffset + guideTravel;
    guides.position.y = L.pitch * guideTravel;

    let hovered = -1;
    if (stage.matches(':hover') && window.matchMedia('(hover: hover)').matches) {
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      hovered = hit ? meshes.indexOf(hit.object) : -1;
    }
    meshes.forEach((mesh, index) => {
      const scale = mesh.userData.scale + ((index === hovered ? 1.05 : 1) - mesh.userData.scale) * 0.2;
      mesh.userData.scale = scale;
      mesh.scale.setScalar(scale);
    });
    renderer.render(scene, camera);
  }

  function requestDraw() {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
  }

  function setProgress() {
    const distance = Math.max(1, root.offsetHeight - stage.clientHeight);
    progress = MathUtils.clamp(-root.getBoundingClientRect().top / distance, 0, 1);
    if (topTitle && bottomTitle) {
      const fade = 0.28 + 0.72 * Math.sin(Math.PI * progress);
      const travel = (0.62 - progress * 1.24) * stage.clientWidth;
      topTitle.style.opacity = String(fade);
      topTitle.style.transform = `translate3d(calc(-50% + ${travel}px), 0, 0)`;
      bottomTitle.style.opacity = String(fade);
      bottomTitle.style.transform = `translate3d(calc(-50% - ${travel}px), 0, 0)`;
    }
    if (middleTitle) middleTitle.style.opacity = String(0.45 + 0.55 * Math.sin(Math.PI * progress));
    requestDraw();
  }

  function resize() {
    if (!renderer || !stage.clientWidth || !stage.clientHeight) return;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    const visibleWidth = 2 * Math.tan((L.fov * Math.PI) / 360) * camera.aspect * L.camZ;
    const scale = mobileLayout
      ? Math.min(1, Math.max(visibleWidth / stripWidth, 0.82))
      : Math.min(1, visibleWidth / stripWidth);
    rig.scale.setScalar(scale);
    rig.position.y = L.lookAtY * (1 - scale);
    const dropBelow = L.lookAtY - (L.baseY + L.pitch * L.entryBack);
    extraTurns = Math.ceil((dropBelow * (1 / scale - 1)) / turnDrop);
    requestDraw();
  }

  function onPointerMove(event) {
    const rect = stage.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
    requestDraw();
  }

  function setVisible() {
    visible = true;
    requestDraw();
  }

  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) requestDraw();
  }, { threshold: 0.01 });
  intersection.observe(root);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  window.addEventListener('scroll', setProgress, { passive: true });
  window.addEventListener('resize', setProgress, { passive: true });
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerleave', requestDraw);
  window.addEventListener('pageshow', setVisible);

  async function initialize() {
    try {
      const loaded = await Promise.all(images.map(async ({ src, alt }) => {
        const image = new Image();
        image.src = src;
        if (image.decode) await image.decode();
        else await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
        return { image, alt };
      }));
      if (destroyed) return;
      renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = SRGBColorSpace;
      const span = (loaded.length - 1) * L.step;
      const midY = span / 2 * L.pitch;
      const maxAnisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      textures = loaded.map(({ image }) => {
        const texture = containTexture(image, renderer);
        texture.anisotropy = maxAnisotropy;
        return texture;
      });
      meshes = loaded.map(({ alt }, index) => {
        const angle = index * L.step;
        const geometry = makeGeometry(angle, midY);
        const material = new MeshBasicMaterial({ map: textures[index], transparent: true, alphaTest: 0.015, side: DoubleSide });
        const mesh = new Mesh(geometry, material);
        mesh.position.copy(cardCenter(angle, midY));
        mesh.userData = { alt, scale: 1 };
        spin.add(mesh);
        return mesh;
      });

      const start = -((L.guideLength - 1) * span) / 2;
      const end = span - start;
      const edgeY = (L.cardHeight / 2) * L.guideHeight;
      const guideMaterial = new LineBasicMaterial({ color: '#c90020', transparent: true, opacity: 0.28 });
      for (const y of [edgeY, -edgeY]) {
        const points = [];
        for (let t = start; t <= end; t += 0.03) {
          points.push(new Vector3(L.radius * L.guideRadius * Math.sin(t), t * L.pitch - midY + y, L.radius * L.guideRadius * Math.cos(t)));
        }
        guides.add(new Line(new BufferGeometry().setFromPoints(points), guideMaterial));
      }
      resize();
      root.classList.add('is-ready');
      setProgress();
    } catch (error) {
      console.error('No se pudo iniciar la galería de indumentaria:', error);
      root.classList.add('is-unavailable');
    }
  }

  initialize();
  setProgress();
  return () => {
    destroyed = true;
    if (raf) cancelAnimationFrame(raf);
    intersection.disconnect();
    resizeObserver.disconnect();
    window.removeEventListener('scroll', setProgress);
    window.removeEventListener('resize', setProgress);
    stage.removeEventListener('pointermove', onPointerMove);
    stage.removeEventListener('pointerleave', requestDraw);
    window.removeEventListener('pageshow', setVisible);
    if (renderer) {
      scene.traverse((object) => {
        if (object instanceof Mesh || object instanceof Line) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
          else object.material.dispose();
        }
      });
      textures.forEach((texture) => texture.dispose());
      renderer.dispose();
    }
  };
}

