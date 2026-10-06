'use strict';

// The live view: GPU pacing, previews, reprojection and progressive refinement.

const VIEW = Object.assign({ scale: 1 }, store('horizon-view'));
// The canvas matches the screen's own pixels, up to 3×: a 2× canvas on a 3× phone is resampled by
// 1.5, which softens everything and turns the dither into a faint grid.
const MAX_DPR = 3;
const screenDpr = () => Math.min(window.devicePixelRatio || 1, MAX_DPR);
const REFINE = 12; // frames averaged once the view holds still
const FADE = 4; // passes over which a refreshed view takes over from the reprojected previous one
let needLow = true, needFull = true, lastChange = 0, lowTarget = null, accTarget = null, accN = 0;
let refineK = 0, refineY = 0; // the refinement pass being rendered and the row its next band starts at
let lowOK = false; // lowTarget shows the current state
let accCam = null, accKey = ''; // the camera and scene the accumulation is rendering
// The last finished view, kept while a new one renders: camera moves show it reprojected (sharp and
// already antialiased) instead of the coarse preview, and the new passes fade in over it.
let anchorTarget = null, anchor = null;
let devSize = null; // the canvas in device pixels, where the browser reports it exactly

// GPU pacing. Each frame's sky work is fenced: done by the next frame means there was room, so the
// budget grows; still running means the GPU is behind, so it shrinks and that frame adds nothing.
// Phones stay capped: iOS aborts GPU work that runs too long, leaving blocks of a frame unrendered.
const GPU = { px: FRAME_PX, avg: FRAME_PX, max: PHONE ? 1 << 19 : 1 << 23, fence: null, used: 0, late: false };

function gpuIdle() {
  if (!GPU.fence) return true;
  if (gl.getSyncParameter(GPU.fence, gl.SYNC_STATUS) !== gl.SIGNALED) {
    if (!GPU.late) GPU.px = Math.max(1 << 15, GPU.px * 0.7);
    GPU.late = true;
    return false;
  }
  gl.deleteSync(GPU.fence);
  GPU.fence = null;
  if (!GPU.late && GPU.used > 0.7 * GPU.px) GPU.px = Math.min(GPU.max, GPU.px * 1.15);
  GPU.avg += (GPU.px - GPU.avg) * 0.1;
  GPU.late = false;
  return true;
}

function gpuFence() {
  GPU.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
}

// Previews draw at the resolution the budget allows, in 5% steps so it doesn't flicker.
function previewScale() {
  return clamp(Math.floor(Math.sqrt(GPU.avg / (canvas.width * canvas.height)) * 20) / 20, 0.15, 1);
}

const CAMERA_KEYS = ['proj', 'heading', 'pitch', 'roll', 'fov'];

// Everything but the camera: two views that agree on it differ only in where they look (the eye
// never moves), so one can be reprojected into the other.
function sceneKey() {
  const p = { ...P };
  for (const k of CAMERA_KEYS) delete p[k];
  return JSON.stringify([p, ANIM.time, ANIM.micro, ANIM.cloud]);
}

function viewCam(w, h) {
  const m = viewMapping(w), b = cameraBasis();
  return { proj: P.proj, half: P.fov * DEG / 2, head: P.heading * DEG, fwd: b.fwd, right: b.right, up: b.up, img: captureDims(), pix0: m.pix0, step: m.step, w, h };
}

const presentProg = program(VS, `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uAnchor, uAcc, uLow;
uniform int uHas;      // 1: kept view (same scene), 2: current accumulation
uniform vec2 uCanvas;
uniform vec2 uAccN;    // 1 / passes in the current view, its weight over the kept view
uniform vec3 uAnchorN; // 1 / passes in the kept view; 1 / (passes + 1) in rows below z, from a pass cut short
uniform float uVignette;
uniform int uProj, aProj;
uniform float uHalf, aHalf, uHead, aHead, uStep, aStep;
uniform vec3 uFwd, uRight, uUp, aFwd, aRight, aUp;
uniform vec2 uImg, aImg, uPix0, aPix0, aSize;
out vec4 outColor;
const float PI = 3.14159265359, TAU = 6.28318530718;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// The view direction through image point img, as the sky shader's viewDir.
vec3 viewDir(vec2 img, out float valid) {
  valid = 1.0;
  if (uProj == 3) {
    float lon = uHead + (img.x / uImg.x - 0.5) * TAU;
    float lat = (0.5 - img.y / uImg.y) * PI;
    valid = step(abs(lat), 0.5 * PI);
    lat = clamp(lat, -0.5 * PI, 0.5 * PI);
    return vec3(sin(lon) * cos(lat), sin(lat), cos(lon) * cos(lat));
  }
  vec2 n = (img - 0.5 * uImg) / (0.5 * length(uImg));
  n.y = -n.y;
  if (uProj == 0) return normalize(uFwd + (uRight * n.x + uUp * n.y) * tan(uHalf));
  float r = length(n);
  float th = uProj == 1 ? r * uHalf : 2.0 * atan(r * tan(0.5 * uHalf));
  valid = step(th, PI);
  vec2 u = r > 1e-6 ? n / r : vec2(0.0);
  return uFwd * cos(th) + (uRight * u.x + uUp * u.y) * sin(th);
}

// Where the kept view saw direction d, in its image coordinates; false where it could not.
bool anchorImg(vec3 d, out vec2 img) {
  if (aProj == 3) {
    float lon = atan(d.x, d.z) - aHead;
    lon -= TAU * floor(lon / TAU + 0.5);
    img = vec2((lon / TAU + 0.5) * aImg.x, (0.5 - asin(clamp(d.y, -1.0, 1.0)) / PI) * aImg.y);
    return true;
  }
  float z = dot(d, aFwd);
  vec2 p = vec2(dot(d, aRight), -dot(d, aUp)), n;
  if (aProj == 0) {
    if (z < 1e-3) return false;
    n = p / (z * tan(aHalf));
  } else {
    float th = acos(clamp(z, -1.0, 1.0)), l = length(p);
    if (aProj == 2 && th > 3.0) return false; // the stereographic image runs to infinity behind
    float r = aProj == 1 ? th / aHalf : tan(0.5 * th) / tan(0.5 * aHalf);
    n = l > 1e-6 ? p * (r / l) : vec2(0.0);
  }
  img = 0.5 * aImg + n * (0.5 * length(aImg));
  return true;
}

// Bilinear from the kept sums, scaling texel by texel: rows of a pass cut short hold one more sample.
vec3 anchorAt(vec2 gp) {
  vec2 f = gp - 0.5, t = fract(f);
  ivec2 i = ivec2(floor(f)), hi = ivec2(aSize) - 1;
  vec3 c = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1), q = clamp(i + o, ivec2(0), hi);
    float w = (o.x == 1 ? t.x : 1.0 - t.x) * (o.y == 1 ? t.y : 1.0 - t.y);
    c += w * texelFetch(uAnchor, q, 0).rgb * (float(q.y) < uAnchorN.z ? uAnchorN.y : uAnchorN.x);
  }
  return c;
}

float vignette(vec2 img, vec2 size) {
  return 1.0 - uVignette * smoothstep(0.3, 1.15, length((img - 0.5 * size) / (0.5 * length(size))));
}

void main() {
  vec2 img = uPix0 + vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y) * uStep;
  float k = 0.0; // the kept view's share, feathered toward its edges so the seam doesn't show
  vec3 kept = vec3(0.0);
  if ((uHas & 1) != 0) {
    float valid;
    vec3 d = viewDir(img, valid);
    vec2 ai;
    if (valid < 0.5) k = 1.0; // outside the projection: black, as the sky shader draws it
    else if (anchorImg(d, ai)) {
      // A 360° image repeats sideways, so the kept canvas may hold d a turn to either side.
      for (int i = 0; i < 3 && k == 0.0; i++) {
        vec2 a = ai + vec2(float(i == 1) - float(i == 2), 0.0) * aImg.x;
        vec2 q = (a - aPix0) / aStep, gp = vec2(q.x, aSize.y - q.y);
        vec2 edge = min(gp, aSize - gp) - 0.5;
        if (min(edge.x, edge.y) >= 0.0) {
          // The vignette sits on the frame, not the sky: move it from where it was to where it is.
          kept = anchorAt(gp) * vignette(img, uImg) / max(vignette(a, aImg), 0.05);
          k = max(smoothstep(0.0, 0.03 * min(aSize.x, aSize.y), min(edge.x, edge.y)), 1e-3);
        }
        if (aProj != 3) break;
      }
    }
  }
  vec3 c;
  float fresh; // the share of the pixel that carries its own dither
  if ((uHas & 2) != 0) {
    k *= 1.0 - uAccN.y;
    c = mix(texelFetch(uAcc, ivec2(gl_FragCoord.xy), 0).rgb * uAccN.x, kept, k);
    fresh = 1.0 - k;
  } else {
    c = mix(texture(uLow, gl_FragCoord.xy / uCanvas).rgb, kept, k);
    fresh = 0.0;
  }
  // Resampled pixels lose most of their dither; add it back so gradients don't band.
  c += (1.0 - fresh) * (hash12(gl_FragCoord.xy) + hash12(gl_FragCoord.xy + 71.3) - 1.0) / 255.0;
  outColor = vec4(c, 1.0);
}`, { uAnchor: 0, uAcc: 1, uLow: 2 });

// Kept for ?diag, which resolves its accumulation tests with it.
const resolveProg = program(VS, `#version 300 es
precision highp float;
uniform sampler2D uAcc;
uniform float uScale;
out vec4 outColor;
void main() { outColor = vec4(texelFetch(uAcc, ivec2(gl_FragCoord.xy), 0).rgb * uScale, 1.0); }`, { uAcc: 0 });

function invalidate() {
  // Keep the finished view being replaced, for reprojection while the next one renders.
  if (accN > 0) {
    [anchorTarget, accTarget] = [accTarget, anchorTarget];
    anchor = { n: accN, split: refineK === accN ? refineY : 0, cam: accCam, key: accKey };
  }
  needLow = needFull = true;
  lowOK = false;
  accN = refineY = 0;
  lastChange = performance.now();
}

function viewMapping(cw) {
  const k = cw / canvas.clientWidth;
  const [W, H] = captureDims();
  return { pix0: [-(F.x + F.ox) * W / F.w, -(F.y + F.oy) * H / F.h], step: W / (F.w * k) };
}

function resizeCanvas() {
  const dpr = screenDpr(), r = canvas.getBoundingClientRect();
  // The exact size only settles rounding: some (emulated) setups report CSS pixels there.
  const exact = devSize && dpr === window.devicePixelRatio && Math.abs(devSize[0] - r.width * dpr) < 2 && Math.abs(devSize[1] - r.height * dpr) < 2;
  const w = Math.max(1, Math.round((exact ? devSize[0] : r.width * dpr) * VIEW.scale));
  const h = Math.max(1, Math.round((exact ? devSize[1] : r.height * dpr) * VIEW.scale));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    invalidate();
  }
}

// Shows the view: the current accumulation, over the kept view reprojected while the accumulation
// is young, and the low-resolution preview wherever neither reaches.
function present() {
  const w = canvas.width, h = canvas.height, acc = accN > 0;
  if (!acc && !lowOK) return;
  const cam = viewCam(w, h), keep = !!anchor && anchor.key === sceneKey(), u = presentProg.u;
  // Reprojected, the kept view is softened by resampling, so the new passes take over after a few;
  // from an unchanged camera it is exact and stays until they have as many samples.
  const span = keep && JSON.stringify(anchor.cam) === JSON.stringify(cam) ? anchor.n : FADE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, w, h);
  gl.useProgram(presentProg.p);
  [keep && anchorTarget, acc && accTarget, lowTarget].forEach((t, i) => {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, t ? t.tex : null);
  });
  gl.uniform1i(u.uHas, (keep ? 1 : 0) | (acc ? 2 : 0));
  gl.uniform2f(u.uCanvas, w, h);
  gl.uniform2f(u.uAccN, acc ? 1 / accN : 0, Math.min(1, accN / span));
  gl.uniform1f(u.uVignette, P.vignette);
  for (const [k, c] of [['u', cam], ['a', keep ? anchor.cam : cam]]) {
    gl.uniform1i(u[k + 'Proj'], c.proj);
    gl.uniform1f(u[k + 'Half'], c.half);
    gl.uniform1f(u[k + 'Head'], c.head);
    gl.uniform1f(u[k + 'Step'], c.step);
    gl.uniform3fv(u[k + 'Fwd'], c.fwd);
    gl.uniform3fv(u[k + 'Right'], c.right);
    gl.uniform3fv(u[k + 'Up'], c.up);
    gl.uniform2fv(u[k + 'Img'], c.img);
    gl.uniform2fv(u[k + 'Pix0'], c.pix0);
  }
  if (keep) {
    gl.uniform2f(u.aSize, anchor.cam.w, anchor.cam.h);
    gl.uniform3f(u.uAnchorN, 1 / anchor.n, 1 / (anchor.n + 1), anchor.split);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// The interactive preview (and timelapse frames): one draw at reduced scale, upsampled by present().
function renderView(scale = 1, quality = 1) {
  const values = sceneValues();
  const w = Math.max(1, Math.round(canvas.width * scale)), h = Math.max(1, Math.round(canvas.height * scale));
  lowTarget = fitTarget(lowTarget, w, h);
  const m = viewMapping(w);
  drawSky(lowTarget.fbo, w, h, m.pix0, m.step, values, { quality });
  GPU.used += w * h;
  lowOK = true;
  present();
}

// Progressive refinement: frame k adds a sample with new sub-pixel and march offsets to a float
// buffer, and the canvas shows the running average.
// Renders the next band of pass k (as many rows as the GPU budget allows); returns true once the
// pass is complete and shown.
function refineView(k) {
  const w = canvas.width, h = canvas.height, m = viewMapping(w);
  const values = sceneValues(); // before blending is on: it may re-render the atmosphere LUTs
  accTarget = fitTarget(accTarget, w, h, gl.RGBA16F);
  if (k !== refineK) { refineK = k; refineY = 0; }
  if (k === 0 && refineY === 0) { accCam = viewCam(w, h); accKey = sceneKey(); }
  const y1 = Math.min(h, refineY + Math.max(1, Math.floor(GPU.px / w)));
  if (k > 0) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); }
  drawSky(accTarget.fbo, w, h, m.pix0, m.step, values, { frame: k, rows: [refineY, y1] });
  gl.disable(gl.BLEND);
  GPU.used += (y1 - refineY) * w;
  refineY = y1 < h ? y1 : 0;
  if (refineY) return false;
  accN = k + 1;
  present();
  return true;
}

// ─── Loupe ──────────────────────────────────────────────────────────────────

const loupeEl = $('loupe');
const loupeCtx = loupeEl.getContext('2d');
let loupeTarget = null, loupeAt = null, loupeQueued = false;

function drawLoupe() {
  loupeQueued = false;
  if (!C.on || !C.loupe || !loupeAt) { loupeEl.classList.remove('on'); return; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const S = Math.round(220 * dpr);
  if (loupeTarget?.w !== S) loupeEl.width = loupeEl.height = S;
  loupeTarget = fitTarget(loupeTarget, S, S);
  const [ix, iy] = cssToImage(loupeAt[0], loupeAt[1]);
  const step = 0.5;
  drawSky(loupeTarget.fbo, S, S, [ix - S / 2 * step, iy - S / 2 * step], step, sceneValues(), { snap: true });
  readInto(loupeCtx, S, S);
  loupeEl.style.left = loupeAt[0] - 110 + 'px';
  loupeEl.style.top = loupeAt[1] - 110 + 'px';
  loupeEl.classList.add('on');
}

function queueLoupe() {
  if (!loupeQueued) { loupeQueued = true; requestAnimationFrame(drawLoupe); }
}
