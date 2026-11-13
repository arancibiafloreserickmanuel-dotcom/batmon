import {
  AmbientLight,
  CanvasTexture,
  DirectionalLight,
  DoubleSide,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from 'three';

const projects = [
  { src: '/complex-running-group.png', label: 'Grupo corriendo' },
  { src: '/complex-team-coast.png', label: 'Equipo Batmon en la costa' },
  { src: '/complex-campaign.png', label: 'Campaña Nueva Piel Batmon Crowd' },
  { src: '/complex-shirt-night.png', label: 'Polera Batmon Crowd de noche' },
];

export function mountComplexCarousel() {
  const root = document.getElementById('complex-carousel');
  const canvas = document.getElementById('complex-canvas');
  if (!root || !canvas) return () => {};

  const buttons = [...root.querySelectorAll('[data-slide]')];
  const buttonClickHandlers = [];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const scene = new Scene();
  const camera = new PerspectiveCamera(53.4, 1, 0.1, 2000);
  camera.position.set(0, 0, 41.18);
  camera.lookAt(0, 0, 0);

  let renderer;
  let cards = [];
  let totalWidth = 0;
  let halfW = 1;
  let halfH = 1;
  let offset = 0;
  let targetOffset = 0;
  let activeIndex = 0;
  let visible = false;
  let rafId = 0;
  let lastFrame = 0;
  let destroyed = false;
  let drag = null;
  let lastPointerMove = 0;
  let latestPointerDelta = 0;
  let suppressPointerClick = false;
  let imageRecords = [];
  const raycaster = new Raycaster();
  const pointer = new Vector2();

  const ambient = new AmbientLight(0xffffff, 1.05);
  const keyLight = new DirectionalLight(0xffffff, 0.38);
  keyLight.position.set(-0.4, 0.5, 1).normalize();
  scene.add(ambient, keyLight);

  function clampOffset(value) {
    if (!cards.length) return value;
    return MathUtils.clamp(value, cards[0].center, cards[cards.length - 1].center);
  }

  function cardTexture(image) {
    const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    textureCanvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = textureCanvas.getContext('2d');
    const radius = Math.max(18, Math.round(Math.min(textureCanvas.width, textureCanvas.height) * 0.025));
    context.beginPath();
    context.roundRect(0, 0, textureCanvas.width, textureCanvas.height, radius);
    context.clip();
    context.drawImage(image, 0, 0, textureCanvas.width, textureCanvas.height);
    const shade = context.createLinearGradient(0, textureCanvas.height * 0.68, 0, textureCanvas.height);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,.13)');
    context.fillStyle = shade;
    context.fillRect(0, textureCanvas.height * 0.68, textureCanvas.width, textureCanvas.height * 0.32);

    const texture = new CanvasTexture(textureCanvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  function rebuildCards(width, height) {
    if (!renderer) return;
    const oldActiveCenter = cards[activeIndex]?.center;
    const aspect = width / Math.max(1, height);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    halfH = Math.tan(MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    halfW = halfH * aspect;
    renderer.setSize(width, height, false);

    const cardHeight = halfH * 2 * 0.52;
    const maxCardWidth = halfW * 2 * 0.88;
    const gap = 20 * (halfW * 2 / width);
    cards.forEach(({ mesh }) => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });

    cards = imageRecords.map(({ image, texture, label }, index) => {
      const imageAspect = image.naturalWidth / image.naturalHeight;
      const scale = Math.min(1, maxCardWidth / (cardHeight * imageAspect));
      const cardW = cardHeight * imageAspect * scale;
      const cardH = cardHeight * scale;
      const geometry = new PlaneGeometry(cardW, cardH, 64, 40);
      const base = geometry.attributes.position.array.slice();
      const material = new MeshStandardMaterial({
        map: texture,
        roughness: 0.82,
        metalness: 0,
        transparent: true,
        alphaTest: 0.02,
        side: DoubleSide,
      });
      const mesh = new Mesh(geometry, material);
      mesh.userData = { base, width: cardW, height: cardH, index, label };
      scene.add(mesh);
      return { mesh, width: cardW, height: cardH, gap, label, texture, index, center: 0 };
    });

    totalWidth = cards.reduce((sum, card) => sum + card.width + gap, 0);
    let cursor = -totalWidth / 2;
    cards.forEach((card) => {
      card.center = cursor + card.width / 2;
      cursor += card.width + gap;
    });
    if (cards.length && oldActiveCenter === undefined) {
      offset = cards[0].center;
      targetOffset = offset;
    } else if (cards.length) {
      const shift = cards[activeIndex].center - oldActiveCenter;
      offset += shift;
      targetOffset += shift;
    }
  }

  function setActive(index, focus = false) {
    activeIndex = MathUtils.clamp(index, 0, Math.max(0, cards.length - 1));
    buttons.forEach((button, i) => {
      button.setAttribute('aria-pressed', String(i === activeIndex));
      button.tabIndex = i === activeIndex ? 0 : -1;
    });
    if (focus) buttons[activeIndex]?.focus({ preventScroll: true });
  }

  function centerCard(index) {
    if (!cards.length) return;
    const i = MathUtils.clamp(index, 0, cards.length - 1);
    targetOffset = clampOffset(cards[i].center);
    setActive(i);
    if (reducedMotion.matches) offset = targetOffset;
  }

  function deformCards() {
    const depth = halfW * 0.2;
    cards.forEach((card) => {
      const { mesh } = card;
      const position = mesh.geometry.attributes.position;
      const base = mesh.userData.base;
      const center = card.center - offset;
      mesh.position.x = center;
      for (let i = 0; i < position.count; i++) {
        const xLocal = base[i * 3];
        const y = base[i * 3 + 1];
        const x = center + xLocal;
        const q = (x / halfW) * 1.15 - 0.2;
        const g = Math.exp(-q * q);
        const sin = Math.sin(Math.PI * q);
        const shape = sin * g;
        const derivative = (Math.PI * Math.cos(Math.PI * q) - 2 * q * sin) * g;
        const bank = -0.16 * derivative / Math.PI;
        const s = MathUtils.clamp(x / halfW, -1, 1);
        const hinge = -0.12 * halfW * s * (1.5 - 0.5 * s * s);
        position.setXYZ(
          i,
          xLocal,
          y * Math.cos(bank),
          y * Math.sin(bank) - depth * shape + hinge,
        );
      }
      position.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingSphere();
    });
  }

  function updateActiveFromCenter() {
    if (!cards.length) return;
    let closest = 0;
    let distance = Infinity;
    cards.forEach((card, index) => {
      const center = card.center - offset;
      const d = Math.abs(center);
      if (d < distance) { closest = index; distance = d; }
    });
    if (closest !== activeIndex) setActive(closest);
  }

  function frame(now) {
    rafId = 0;
    if (destroyed || !visible || document.hidden || !renderer) return;
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (reducedMotion.matches) offset = targetOffset;
    else offset += (targetOffset - offset) * (1 - Math.exp(-7 * dt));
    deformCards();
    updateActiveFromCenter();
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(frame);
  }

  function startFrame() {
    if (!destroyed && visible && !document.hidden && renderer && !rafId) {
      lastFrame = 0;
      rafId = requestAnimationFrame(frame);
    }
  }

  function stopFrame() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    lastFrame = 0;
  }

  function worldUnitsPerPixel() {
    return (halfW * 2) / Math.max(1, root.clientWidth);
  }

  function moveByPixels(deltaPixels, passVerticalRemainderToPage = false) {
    const start = targetOffset;
    const unitsPerPixel = worldUnitsPerPixel();
    const next = clampOffset(start + deltaPixels * unitsPerPixel);
    targetOffset = next;
    if (passVerticalRemainderToPage && unitsPerPixel > 0) {
      const consumedPixels = (next - start) / unitsPerPixel;
      const remainder = deltaPixels - consumedPixels;
      if (Math.abs(remainder) > 0.5) window.scrollBy(0, remainder);
    }
    return Math.abs(next - start) > 0.001;
  }

  function onWheel(event) {
    if (event.ctrlKey) return;
    let dx = event.deltaX;
    let dy = event.deltaY;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) { dx *= 16; dy *= 16; }
    else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) { dx *= root.clientWidth; dy *= root.clientHeight; }
    // Vertical wheel gestures advance the carousel while it has images left;
    // once an end is reached, the browser keeps scrolling the page normally.
    const dominant = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    if (!dominant) return;
    if (!moveByPixels(dominant * 0.8)) return;
    event.preventDefault();
  }

  function hitCard(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(cards.map((card) => card.mesh), false)[0];
    return hit?.object.userData.index;
  }

  function onPointerDown(event) {
    if (event.target.closest('button')) return;
    drag = { id: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false, axis: null };
    latestPointerDelta = 0;
    lastPointerMove = performance.now();
  }

  function onPointerMove(event) {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.max(Math.abs(dx), Math.abs(dy)) > 6) {
      const axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
      // A mouse drag has no native page-scroll gesture; ignore vertical drags.
      // Touch and pen use vertical movement to advance slides, as the mouse
      // wheel does on desktop, then hand any excess movement to the page.
      if (axis === 'y' && drag.pointerType === 'mouse') {
        drag = null;
        return;
      }
      drag.axis = axis;
      drag.moved = true;
      root.setPointerCapture(event.pointerId);
    }
    if (!drag.moved) return;
    const moveX = event.clientX - drag.lastX;
    const moveY = event.clientY - drag.lastY;
    const step = drag.axis === 'x' ? moveX : moveY;
    moveByPixels(-step, drag.axis === 'y');
    latestPointerDelta = step;
    lastPointerMove = performance.now();
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
  }

  function onPointerUp(event) {
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved) {
      const hitIndex = hitCard(event.clientX, event.clientY);
      if (hitIndex !== undefined) centerCard(hitIndex);
    } else {
      suppressPointerClick = true;
      window.setTimeout(() => { suppressPointerClick = false; }, 0);
      if (performance.now() - lastPointerMove < 100) {
        moveByPixels(-latestPointerDelta * 6, drag.axis === 'y');
      }
      if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    }
    drag = null;
  }

  function onKeyDown(event) {
    const current = Number(event.currentTarget.dataset.slide);
    let next;
    if (event.key === 'ArrowRight') next = current + 1;
    else if (event.key === 'ArrowLeft') next = current - 1;
    else if (event.key === 'Home') next = 0;
    if (next === undefined) return;
    event.preventDefault();
    const index = MathUtils.clamp(next, 0, cards.length - 1);
    centerCard(index);
    setActive(index, true);
  }

  function onClickCapture(event) {
    if (suppressPointerClick && event.detail > 0) {
      event.preventDefault();
      event.stopPropagation();
      suppressPointerClick = false;
    }
  }

  function onVisibilityChange() {
    if (document.hidden) stopFrame();
    else startFrame();
  }

  function onReducedMotionChange() {
    if (reducedMotion.matches) {
      offset = targetOffset;
      deformCards();
    }
  }

  async function initialize() {
    try {
      const [, images] = await Promise.all([
        document.fonts?.ready ?? Promise.resolve(),
        Promise.all(projects.map(async ({ src }) => {
          const image = new Image();
          image.src = src;
          if (image.decode) await image.decode();
          else await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = reject;
          });
          return image;
        })),
      ]);
      if (destroyed) return;

      renderer = new WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = SRGBColorSpace;

      imageRecords = projects.map((project, index) => ({ ...project, image: images[index], texture: cardTexture(images[index]) }));
      rebuildCards(root.clientWidth, root.clientHeight);
      setActive(activeIndex);
      deformCards();
      renderer.render(scene, camera);
      root.classList.add('is-ready');
      startFrame();
    } catch (error) {
      console.error('No se pudo iniciar el carrusel de complejos:', error);
      root.classList.add('is-unavailable');
      const fallback = document.createElement('div');
      fallback.className = 'complex-fallback-gallery';
      projects.forEach(({ src, label }) => {
        const image = document.createElement('img');
        image.src = src;
        image.alt = label;
        fallback.append(image);
      });
      root.prepend(fallback);
    }
  }

  const resizeObserver = new ResizeObserver(() => {
    if (renderer && root.clientWidth && root.clientHeight) {
      rebuildCards(root.clientWidth, root.clientHeight);
      deformCards();
      renderer.render(scene, camera);
    }
  });
  resizeObserver.observe(root);

  const visibilityObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) startFrame();
    else stopFrame();
  }, { threshold: 0.01 });
  visibilityObserver.observe(root);

  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerUp);
  root.addEventListener('click', onClickCapture, true);
  buttons.forEach((button, index) => {
    const select = () => centerCard(index);
    buttonClickHandlers.push(select);
    button.addEventListener('click', select);
    button.addEventListener('keydown', onKeyDown);
  });
  document.addEventListener('visibilitychange', onVisibilityChange);
  reducedMotion.addEventListener('change', onReducedMotionChange);

  initialize();

  return () => {
    destroyed = true;
    stopFrame();
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    root.removeEventListener('wheel', onWheel);
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('pointercancel', onPointerUp);
    root.removeEventListener('click', onClickCapture, true);
    buttons.forEach((button, index) => {
      button.removeEventListener('click', buttonClickHandlers[index]);
      button.removeEventListener('keydown', onKeyDown);
    });
    document.removeEventListener('visibilitychange', onVisibilityChange);
    reducedMotion.removeEventListener('change', onReducedMotionChange);
    cards.forEach(({ mesh }) => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    imageRecords.forEach(({ texture }) => texture.dispose());
    renderer?.dispose();
  };
}
