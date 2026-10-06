'use strict';

// Capture settings and the camera: the frame size, the projection and view directions.

const ASPECTS = [
  ['16:9', 16, 9], ['16:10', 16, 10], ['21:9', 21, 9], ['32:9', 32, 9],
  ['3:2', 3, 2], ['4:3', 4, 3], ['1:1', 1, 1], ['2:1', 2, 1],
  ['4:5', 4, 5], ['3:4', 3, 4], ['9:16', 9, 16], ['9:19.5', 9, 19.5],
];
const SIZES = [['HD', 1920], ['QHD', 2560], ['4K', 3840], ['5K', 5120], ['6K', 6144], ['8K', 7680]];
const DEVICES = [
  ['iPhone 17', 1206, 2622], ['iPhone 17 Pro Max', 1320, 2868], ['iPad Pro 13″', 2064, 2752],
  ['MacBook Air 13″', 2560, 1664], ['MacBook Air 15″', 2880, 1864], ['Studio Display', 5120, 2880],
  ['Pro Display XDR', 6016, 3384], ['4K UHD', 3840, 2160], ['8K UHD', 7680, 4320],
  ['Ultrawide', 3440, 1440], ['Super Ultrawide', 5120, 1440],
];
const MAX_SIDE = 8192;

// Quality: 4 samples per pixel (Standard) or 16 (Supersampled). Settings saved before v2 had 1 and 4.
const C = Object.assign({ ratio: 16 / 9, long: 3840, format: 'png', samples: 4, grid: true, fps: 30, seconds: 8 }, store('horizon-capture'));
if (C.v !== 2) C.samples = C.samples > 1 ? 16 : 4;
C.on = false;
C.loupe = false;

function captureDims() {
  return C.ratio >= 1
    ? [C.long, Math.max(16, Math.round(C.long / C.ratio))]
    : [Math.max(16, Math.round(C.long * C.ratio)), C.long];
}

function setCapture(patch) {
  Object.assign(C, patch);
  C.long = clamp(Math.round(C.long), 64, MAX_SIDE);
  const { ratio, long, format, samples, grid, fps, seconds } = C;
  store('horizon-capture', { ratio, long, format, samples, grid, fps, seconds, v: 2 });
  layout();
  syncUI();
}

// ─── Camera & Projection ────────────────────────────────────────────────────

function cameraBasis() {
  const h = P.heading * DEG, p = P.pitch * DEG, r = P.roll * DEG;
  const f0 = [Math.sin(h), 0, Math.cos(h)], r0 = [Math.cos(h), 0, -Math.sin(h)], u0 = [0, 1, 0];
  const fwd = v3.add(v3.scale(f0, Math.cos(p)), v3.scale(u0, Math.sin(p)));
  const up1 = v3.add(v3.scale(u0, Math.cos(p)), v3.scale(f0, -Math.sin(p)));
  const right = v3.add(v3.scale(r0, Math.cos(r)), v3.scale(up1, Math.sin(r)));
  const up = v3.add(v3.scale(up1, Math.cos(r)), v3.scale(r0, -Math.sin(r)));
  return { fwd, right, up };
}

function dirAtImage(ix, iy) {
  const [W, H] = captureDims();
  if (P.proj === 3) {
    const lon = P.heading * DEG + (ix / W - 0.5) * TAU;
    const lat = clamp((0.5 - iy / H) * Math.PI, -Math.PI / 2, Math.PI / 2);
    return [Math.sin(lon) * Math.cos(lat), Math.sin(lat), Math.cos(lon) * Math.cos(lat)];
  }
  const hd = Math.hypot(W, H) / 2;
  const nx = (ix - W / 2) / hd, ny = -(iy - H / 2) / hd;
  const b = cameraBasis(), half = P.fov * DEG / 2;
  if (P.proj === 0) {
    const t = Math.tan(half);
    return v3.norm(v3.add(b.fwd, v3.add(v3.scale(b.right, nx * t), v3.scale(b.up, ny * t))));
  }
  const r = Math.hypot(nx, ny);
  const th = P.proj === 1 ? r * half : 2 * Math.atan(r * Math.tan(half / 2));
  const ux = r > 0 ? nx / r : 0, uy = r > 0 ? ny / r : 0;
  return v3.add(v3.scale(b.fwd, Math.cos(th)), v3.scale(v3.add(v3.scale(b.right, ux), v3.scale(b.up, uy)), Math.sin(th)));
}
