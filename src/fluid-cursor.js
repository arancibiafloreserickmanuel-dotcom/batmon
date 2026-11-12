/* =======================================================================
   fluid-cursor — fluid engine

   The fluid solver here — the GLSL shaders (in ./shaders.js) and the GPU
   simulation pipeline (advection, divergence, curl, vorticity, Jacobi
   pressure solve, gradient subtract) — is adapted from:

       WebGL-Fluid-Simulation by Pavel Dobryakov (PavelDoGreat)
       https://github.com/PavelDoGreat/WebGL-Fluid-Simulation
       MIT License — Copyright (c) 2017 Pavel Dobryakov
       (full license text shipped in LICENSE / NOTICE)

   The technique itself originates with NVIDIA GPU Gems, Ch. 38,
   "Fast Fluid Dynamics Simulation on the GPU."

   Original work: the preset system, the live controls panel, the
   reduced-motion + pause-on-blur handling (see main.js), this wrapper
   module, and the editorial type-inversion demo page.
======================================================================= */

import {
  baseVertex,
  splatShader,
  advectionShader,
  divergenceShader,
  curlShader,
  vorticityShader,
  pressureShader,
  gradientSubtractShader,
  clearShader,
  displayShader
} from './shaders.js';

/**
 * Boots the fluid simulation on `canvas`, driven live by the shared `config`
 * object (mutating config from outside — e.g. the controls panel — is picked
 * up on the next frame). Returns { start, stop, clear, isRunning }.
 * Throws "no-webgl2" or "no-float-render" when the browser can't run it.
 */
export function createFluidCursor(canvas, config) {
  let gl, programs = {}, velocity, dye, divergence, curl, pressure;
  let texelX, texelY;
  let rafId = null, lastTime = 0;
  let lastPoint = null;
  const splatQueue = [];

  function compile(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
    }
    return s;
  }

  function createProgram(fragSource) {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, baseVertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragSource));
    gl.bindAttribLocation(program, 0, "aPosition");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
    }
    const uniforms = {};
    const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(program, i).name;
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    return { program, uniforms, bind() { gl.useProgram(this.program); } };
  }

  function initQuad() {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    const elem = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elem);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
  }

  function blit(target) {
    if (target == null) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  function createFBO(w, h, internalFormat, format, type, filter) {
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      texture, fbo, width: w, height: h,
      attach(id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, texture); return id; }
    };
  }

  function createDoubleFBO(w, h, internalFormat, format, type, filter) {
    let fbo1 = createFBO(w, h, internalFormat, format, type, filter);
    let fbo2 = createFBO(w, h, internalFormat, format, type, filter);
    return {
      width: w, height: h,
      get read() { return fbo1; },
      get write() { return fbo2; },
      swap() { const t = fbo1; fbo1 = fbo2; fbo2 = t; }
    };
  }

  function getResolution(res) {
    let aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspect < 1) aspect = 1.0 / aspect;
    const min = Math.round(res);
    const max = Math.round(res * aspect);
    return gl.drawingBufferWidth > gl.drawingBufferHeight
      ? { width: max, height: min }
      : { width: min, height: max };
  }

  function initFramebuffers() {
    const r = getResolution(config.RESOLUTION);
    texelX = 1.0 / r.width;
    texelY = 1.0 / r.height;
    const t = gl.HALF_FLOAT;
    velocity   = createDoubleFBO(r.width, r.height, gl.RG16F,   gl.RG,   t, gl.NEAREST);
    dye        = createDoubleFBO(r.width, r.height, gl.RGBA16F, gl.RGBA, t, gl.LINEAR);
    divergence = createFBO(r.width, r.height, gl.R16F, gl.RED, t, gl.NEAREST);
    curl       = createFBO(r.width, r.height, gl.R16F, gl.RED, t, gl.NEAREST);
    pressure   = createDoubleFBO(r.width, r.height, gl.R16F, gl.RED, t, gl.NEAREST);
  }

  /* ---------- simulation ---------- */
  function step(dt) {
    gl.disable(gl.BLEND);

    programs.curl.bind();
    gl.uniform2f(programs.curl.uniforms.texelSize, texelX, texelY);
    gl.uniform1i(programs.curl.uniforms.uVelocity, velocity.read.attach(0));
    blit(curl);

    programs.vorticity.bind();
    gl.uniform2f(programs.vorticity.uniforms.texelSize, texelX, texelY);
    gl.uniform1i(programs.vorticity.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(programs.vorticity.uniforms.uCurl, curl.attach(1));
    gl.uniform1f(programs.vorticity.uniforms.curl, config.CURL);
    gl.uniform1f(programs.vorticity.uniforms.dt, dt);
    blit(velocity.write); velocity.swap();

    programs.divergence.bind();
    gl.uniform2f(programs.divergence.uniforms.texelSize, texelX, texelY);
    gl.uniform1i(programs.divergence.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence);

    programs.clear.bind();
    gl.uniform1i(programs.clear.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(programs.clear.uniforms.value, config.PRESSURE_DECAY);
    blit(pressure.write); pressure.swap();

    programs.pressure.bind();
    gl.uniform2f(programs.pressure.uniforms.texelSize, texelX, texelY);
    gl.uniform1i(programs.pressure.uniforms.uDivergence, divergence.attach(0));
    for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(programs.pressure.uniforms.uPressure, pressure.read.attach(1));
      blit(pressure.write); pressure.swap();
    }

    programs.gradient.bind();
    gl.uniform2f(programs.gradient.uniforms.texelSize, texelX, texelY);
    gl.uniform1i(programs.gradient.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(programs.gradient.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write); velocity.swap();

    programs.advection.bind();
    gl.uniform2f(programs.advection.uniforms.texelSize, texelX, texelY);
    gl.uniform1i(programs.advection.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(programs.advection.uniforms.uSource, velocity.read.attach(0));
    gl.uniform1f(programs.advection.uniforms.dt, dt);
    gl.uniform1f(programs.advection.uniforms.dissipation, config.VELOCITY_DISSIPATION);
    blit(velocity.write); velocity.swap();

    gl.uniform1i(programs.advection.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(programs.advection.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(programs.advection.uniforms.dissipation, config.DYE_DISSIPATION);
    blit(dye.write); dye.swap();
  }

  function splat(x, y, dx, dy) {
    programs.splat.bind();
    gl.uniform1f(programs.splat.uniforms.aspectRatio, canvas.clientWidth / canvas.clientHeight);
    gl.uniform1f(programs.splat.uniforms.radius, config.SPLAT_RADIUS);
    gl.uniform2f(programs.splat.uniforms.point, x, y);

    gl.uniform1i(programs.splat.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform3f(programs.splat.uniforms.color, dx, dy, 0.0);
    blit(velocity.write); velocity.swap();

    // Paint the dye with presence (white); the display shader applies the
    // preset's inkColor as the final tint — so a black inkColor (Mono) still shows.
    gl.uniform1i(programs.splat.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(programs.splat.uniforms.color, 1.0, 1.0, 1.0);
    blit(dye.write); dye.swap();
  }

  function clearDye() {
    programs.clear.bind();
    gl.uniform1i(programs.clear.uniforms.uTexture, dye.read.attach(0));
    gl.uniform1f(programs.clear.uniforms.value, 0.0);
    blit(dye.write); dye.swap();
  }

  function render() {
    gl.disable(gl.BLEND);
    programs.display.bind();
    gl.uniform1i(programs.display.uniforms.uTexture, dye.read.attach(0));
    gl.uniform3f(programs.display.uniforms.inkColor, config.inkColor[0], config.inkColor[1], config.inkColor[2]);
    gl.uniform1f(programs.display.uniforms.threshold, config.threshold);
    gl.uniform1f(programs.display.uniforms.softness, config.softness);
    blit(null);
  }

  function frame() {
    const now = Date.now();
    let dt = (now - lastTime) / 1000;
    dt = Math.min(dt, 0.016666);
    lastTime = now;

    while (splatQueue.length) {
      const s = splatQueue.shift();
      splat(s.x, s.y, s.dx, s.dy);
    }
    step(dt);
    render();
    rafId = requestAnimationFrame(frame);
  }

  /* ---------- input ---------- */
  function pointerMove(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = 1.0 - (clientY - rect.top) / rect.height;
    if (lastPoint) {
      const dx = (x - lastPoint.x) * config.SPLAT_FORCE;
      const dy = (y - lastPoint.y) * config.SPLAT_FORCE;
      if (dx !== 0 || dy !== 0) splatQueue.push({ x, y, dx, dy });
    }
    lastPoint = { x, y };
  }

  function bindInput() {
    window.addEventListener("mousemove", (e) => pointerMove(e.clientX, e.clientY));
    window.addEventListener("mouseleave", () => { lastPoint = null; });
    window.addEventListener("touchmove", (e) => {
      const t = e.touches[0];
      if (t) pointerMove(t.clientX, t.clientY);
    }, { passive: true });
    window.addEventListener("touchend", () => { lastPoint = null; });
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      return true;
    }
    return false;
  }

  function start() {
    lastTime = Date.now();
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  /* ---------- boot ---------- */
  gl = canvas.getContext("webgl2", {
    alpha: true, premultipliedAlpha: true,
    antialias: false, depth: false, stencil: false
  });
  if (!gl) throw new Error("no-webgl2");
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("no-float-render");
  gl.getExtension("OES_texture_float_linear");

  resizeCanvas();
  [
    ["splat", splatShader], ["advection", advectionShader],
    ["divergence", divergenceShader], ["curl", curlShader],
    ["vorticity", vorticityShader], ["pressure", pressureShader],
    ["gradient", gradientSubtractShader], ["clear", clearShader],
    ["display", displayShader]
  ].forEach(([name, src]) => { programs[name] = createProgram(src); });

  initQuad();
  initFramebuffers();
  bindInput();

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (resizeCanvas()) initFramebuffers(); }, 150);
  });

  return {
    start,
    stop,
    clear: clearDye,
    isRunning: () => rafId !== null
  };
}
