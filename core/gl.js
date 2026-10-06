'use strict';

// WebGL: the context, programs and render targets, the sky program for each feature set, the noise texture.

const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
if (!gl) fail('WebGL2 is unavailable in this browser.');
if (!gl.getExtension('EXT_color_buffer_float')) fail('This browser lacks float render targets (EXT_color_buffer_float).');

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const lines = src.split('\n').map((l, i) => `${String(i + 1).padStart(4)}  ${l}`).join('\n');
    fail('Shader compile error:\n' + gl.getShaderInfoLog(s) + '\n\n' + lines);
  }
  return s;
}

function program(vs, fs, samplers = {}) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) fail('Program link error:\n' + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, name);
  }
  gl.useProgram(p);
  for (const [name, unit] of Object.entries(samplers)) if (u[name]) gl.uniform1i(u[name], unit);
  return { p, u };
}

function target(w, h, format = gl.RGBA8) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
  const filter = format === gl.RGBA32F ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h, free() { gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); } };
}

// Keeps a reusable target while its size holds, else replaces it.
function fitTarget(t, w, h, format) {
  if (t && t.w === w && t.h === h) return t;
  if (t) t.free();
  return target(w, h, format);
}

// RGBA8 pixels read back from a framebuffer (rows bottom up) as an upright ImageData.
function upright(px, w, h) {
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  return img;
}

// Copies the bound framebuffer into a 2D canvas.
function readInto(ctx, w, h) {
  const px = new Uint8ClampedArray(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  ctx.putImageData(upright(px, w, h), 0, 0);
}

gl.bindVertexArray(gl.createVertexArray());

const SETTERS = {
  float: (l, v) => Array.isArray(v) ? gl.uniform1fv(l, v) : gl.uniform1f(l, v),
  int: (l, v) => gl.uniform1i(l, v),
  uint: (l, v) => gl.uniform1ui(l, v),
  vec2: (l, v) => gl.uniform2fv(l, v),
  vec3: (l, v) => gl.uniform3fv(l, v),
  vec4: (l, v) => gl.uniform4fv(l, v),
  mat3: (l, v) => gl.uniformMatrix3fv(l, false, v),
};

const SKY_SAMPLERS = { uTrans: 0, uSkySun: 1, uSkyMoon: 2, uNoise3: 3, uStarStats: 4 };

// One sky program per feature set, compiled on first use and kept.
const skyPrograms = new Map();
function skyProgram(feats = ALL_FEATURES) {
  const key = FEATURES.map(k => feats[k] ? 1 : 0).join('');
  let prog = skyPrograms.get(key);
  if (!prog) skyPrograms.set(key, prog = program(VS, SKY_FS(false, false, feats), SKY_SAMPLERS));
  return prog;
}

// The features the current scene draws, matching the shader's own run-time tests (after derive()).
function sceneFeatures() {
  const t = P.surface;
  return {
    MOON: !!P.moon, BODIES: D.bodyN > 0, AURORA: P.aurora > 0, NIGHT: D.nightScale > 2e-3, CLOUDS: D.cloudN > 0,
    LAND: P.land > 0 || P.peak > 0, CITY: P.land === 4, TERRAIN: t >= 5, GRASS: t === 3 || t === 4,
    TREES: D.treeN > 0, WATER: t === 1 || t === 2,
  };
}

const noise3 = (() => {
  const prog = program(VS, NOISE3_FS);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.texStorage3D(gl.TEXTURE_3D, Math.log2(NOISE_N) + 1, gl.RGBA8, NOISE_N, NOISE_N, NOISE_N);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, NOISE_N, NOISE_N);
  gl.useProgram(prog.p);
  for (let z = 0; z < NOISE_N; z++) {
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, z);
    gl.uniform1f(prog.u.uSlice, (z + 0.5) / NOISE_N);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  gl.generateMipmap(gl.TEXTURE_3D);
  // The last mip is the whole tile's average, which nz() fades to once a tile shrinks to a few pixels.
  const mean = new Uint8Array(4);
  gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, Math.log2(NOISE_N), 0);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, mean);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteProgram(prog.p);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.REPEAT);
  return { tex, mean: [...mean].map(v => v / 255) };
})();
