'use strict';

// Scene state: from the parameters to the sky shader's uniforms, and drawing the sky.

const D = {};
const ANIM = { time: 0, micro: 0, cloud: cloudsAtRest() };

const MOON_I = 2e-5;

// Each cloud layer's drift (x, z) and morph, before any timelapse has moved it.
function cloudsAtRest() {
  return [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
}

// Rows laid end to end in a zero-filled array of `len` numbers: a uniform array with fixed slots,
// empty past the rows given.
function pack(len, rows) {
  const out = new Array(len).fill(0);
  rows.forEach((row, i) => out.splice(i * row.length, row.length, ...row));
  return out;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function celestialFrame() {
  const phi = P.latitude * DEG, th = P.skyRotation * DEG;
  const ez = [0, Math.sin(phi), Math.cos(phi)], ex0 = [0, Math.cos(phi), -Math.sin(phi)], ey0 = [-1, 0, 0];
  const ex = v3.add(v3.scale(ex0, Math.cos(th)), v3.scale(ey0, Math.sin(th)));
  const ey = v3.add(v3.scale(ex0, -Math.sin(th)), v3.scale(ey0, Math.cos(th)));
  return [...ex, ...ey, ...ez];
}

function meteorField() {
  const radiant = skyVector(55, P.meteorHeading);
  const A = [], B = [], prog = [], live = ANIM.playing || ANIM.micro > 0;
  for (let i = 0; i < 12; i++) {
    const period = 3 + 7 * rng(i * 131 + 7)(), phase = ANIM.micro / period + rng(i * 71 + 3)();
    const cycle = live ? Math.floor(phase) : 0;
    prog.push(live ? (phase - cycle) / 0.18 : -1);
    const R = rng(P.meteorSeed * 9973 + 17 + i * 7919 + cycle * 104729);
    let dir = radiant;
    for (let k = 0; k < 24; k++) {
      dir = skyVector(10 + R() * 72, R() * 360);
      const c = v3.dot(dir, radiant);
      if (c < Math.cos(14 * DEG) && c > Math.cos(80 * DEG)) break;
    }
    const tangent = v3.norm(v3.add(v3.scale(dir, v3.dot(dir, radiant)), v3.scale(radiant, -1)));
    A.push(...dir, P.meteorLength * DEG * (0.5 + R()));
    B.push(...tangent, (0.35 + 0.65 * R()) * P.meteorBright);
  }
  return { A, B, prog };
}

// Directional wave components (kx, kz, phase, amplitude) for the water shader. "Waves & Wind"
// sets a wind speed, which fixes the total slope variance (Cox–Munk) and the longest swell.
function waveField() {
  const R = rng(7331), U = P.surfWaves * 4, wind = P.surfWind * DEG;
  const lmax = P.surfScale * (1.5 + 0.85 * U * U), lmin = 0.02 * Math.sqrt(P.surfScale);
  const mss = 0.0006 + 0.0048 * U;
  const out = [], weights = [];
  for (let i = 0; i < 32; i++) {
    const f = (i + R()) / 32;
    const k = TAU / (lmax * Math.pow(lmin / lmax, f));
    const th = wind + (R() + R() + R() - 1.5) * (0.5 + 1.4 * f);
    const s = 0.5 + R();
    weights.push(s * s);
    out.push(Math.sin(th) * k, Math.cos(th) * k, R() * TAU, k);
  }
  const total = weights.reduce((a, b) => a + b);
  for (let i = 0; i < 32; i++) out[i * 4 + 3] = Math.sqrt(2 * 0.7 * mss * weights[i] / total) / out[i * 4 + 3];
  return { waves: out, fx: [clamp(P.surfWaves / 2.5, 0, 0.8), P.surface === 1 ? P.surfFoam * clamp((P.surfWaves - 0.5) / 1.5, 0, 1) : 0, 0.15 * mss] };
}

// Foreground trees: scattered around a heading at random distances, kept apart, sorted front to
// back. Each entry is (x, z, height, type * 1000 + seed).
function treeField() {
  const R = rng(P.treeSeed * 7919 + 13), out = [], spots = [];
  for (let i = 0, tries = 0; i < P.trees && tries < 200; tries++) {
    const one = P.trees === 1;
    const az = (P.treeHeading + (one ? 0 : (R() - 0.5) * P.treeSpread)) * DEG;
    const dist = one ? P.treeNear : P.treeNear + (P.treeFar - P.treeNear) * Math.pow(R(), 0.8);
    const h = P.treeHeight * (one ? 1 : 0.7 + 0.6 * R());
    const x = Math.sin(az) * dist, z = Math.cos(az) * dist;
    if (spots.some(([sx, sz, sh]) => Math.hypot(x - sx, z - sz) < 0.35 * (h + sh))) continue;
    const type = P.treeType < 3 ? P.treeType : [0, 0, 1, 2][Math.floor(R() * 4)];
    spots.push([x, z, h]);
    out.push([dist, x, z, h, type * 1000 + Math.floor(R() * 997)]);
    i++;
  }
  out.sort((a, b) => a[0] - b[0]);
  return { trees: pack(64, out.map(([, ...tree]) => tree)), n: out.length };
}

function derive(img) {
  D.img = img || captureDims();
  const s = Math.max(frameScale(D.img), STAR.ref / STAR.zoom), d = STAR.draw * s;
  D.starFrame = [d, (STAR.energy * STAR.ref / d) ** 2, STAR.ref / s];
  updateStarStats();
  ({ waves: D.waves, fx: D.waveFx } = waveField());
  ({ trees: D.trees, n: D.treeN } = treeField());
  D.basis = cameraBasis();
  D.sunDir = skyVector(P.sunElev, P.sunHeading);
  D.sunAz = [Math.sin(P.sunHeading * DEG), Math.cos(P.sunHeading * DEG)];
  D.moonDir = skyVector(P.moonElev, P.moonHeading);
  D.moonAz = [Math.sin(P.moonHeading * DEG), Math.cos(P.moonHeading * DEG)];
  D.cel = celestialFrame();
  const alpha = Math.PI * Math.abs(1 - 2 * P.moonPhase);
  const lx = (P.moonPhase < 0.5 ? 1 : -1) * Math.sin(alpha), tilt = P.moonTilt * DEG;
  D.moonLight = [lx * Math.cos(tilt), lx * Math.sin(tilt), Math.cos(alpha)];
  const moonI = P.moon ? MOON_I * Math.pow((1 + Math.cos(alpha)) / 2, 3.5) * P.moonLight : 0;
  const meteors = meteorField();
  D.meteorA = meteors.A;
  D.meteorB = meteors.B;
  D.meteorP = meteors.prog;
  D.meteorN = P.meteors;
  const layers = [0, 1, 2].filter(i => P[`c${i}On`] && P[`c${i}Cover`] > 0).sort((a, b) => P[`c${a}Alt`] - P[`c${b}Alt`]);
  D.cloudN = layers.length;
  const clouds = layers.map(i => {
    const c = k => P[`c${i}${k}`], w = c('Wind') * DEG, a = ANIM.cloud[i];
    return [
      [c('Cover'), c('Dens'), c('Alt'), c('Thick')],
      [c('Scale'), c('Billow'), c('Cells'), c('Streak')],
      [c('Detail'), c('Soft'), a[2], c('Seed') + i * 7.3],
      [Math.sin(w), Math.cos(w), a[0], a[1]],
      [c('Vary'), 0, 0, 0],
    ];
  });
  [D.cloudA, D.cloudB, D.cloudC, D.cloudD, D.cloudE] = [0, 1, 2, 3, 4].map(j => pack(12, clouds.map(rows => rows[j])));
  updateAtmosphere();
  const ev = Math.pow(2, P.ev);
  // Exposure is metered for a sun of unit strength, so Sunlight brightens what the sun lights.
  const sunY = atmo.Ysun * P.sunIntensity;
  const gain = KEY / (atmo.Ysun + (P.moon ? atmo.Ymoon * moonI : 0) + NIGHT_FLOOR);
  const nightVis = gain * NIGHT_FLOOR / KEY, sunVis = gain * sunY / KEY;
  D.sunScale = P.sunIntensity * gain * ev;
  D.moonScale = moonI * gain * ev;
  D.nightScale = nightVis * ev;
  D.moonDisk = ev * P.moonBright * (nightVis * 1.5 + sunVis * 0.05 * gain);
  const on = [0, 1].filter(i => P[`b${i}On`]);
  D.bodyN = on.length;
  const bodies = on.map(i => {
    const b = k => P[`b${i}${k}`], al = b('Phase') * Math.PI, th = b('Light') * DEG;
    return [
      [...skyVector(b('Elev'), b('Heading')), b('Size') / 2 * DEG],
      [b('Type'), 2.2 * ev * b('Bright') * (nightVis + 0.35 * sunVis), b('Ring'), b('Atmo')],
      [Math.sin(al) * Math.cos(th), Math.sin(al) * Math.sin(th), Math.cos(al), b('Seed')],
      [b('Roll') * DEG, b('Lean') * DEG, b('RingIn'), Math.max(b('RingOut'), b('RingIn') + 0.05)],
      hexLinear(b('ColorA')), hexLinear(b('ColorB')), hexLinear(b('RingColor')),
    ];
  });
  [D.bodyA, D.bodyB, D.bodyC, D.bodyD] = [0, 1, 2, 3].map(j => pack(8, bodies.map(rows => rows[j])));
  [D.bodyCol1, D.bodyCol2, D.bodyRing] = [4, 5, 6].map(j => pack(6, bodies.map(rows => rows[j])));
}

function sceneValues(img) {
  derive(img);
  return SCENE_UNIFORMS.map(([name, type, get]) => [name, type, get()]);
}

// Phones get a much smaller GPU budget per frame: iOS cuts off GPU work that runs too long, which
// left blocks of a frame unrendered (dark, tinted squares in the averaged view, stray pixels in
// thumbnails). Refinement passes are therefore spread over several frames in row bands.
const PHONE = matchMedia('(pointer: coarse)').matches;
const FRAME_PX = PHONE ? 1 << 17 : 1 << 21;

function drawSky(fbo, w, h, pix0, step, values, opts = {}) {
  const sky = opts.prog || skyProgram(sceneFeatures()); // ?diag passes its own builds
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, w, h);
  gl.useProgram(sky.p);
  if (sky.u.uDebug) gl.uniform1i(sky.u.uDebug, opts.debug || 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, atmo.trans.tex);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, atmo.sun.tex);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, atmo.moon.tex);
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_3D, noise3.tex);
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, starStats.t.tex);
  for (const [name, type, v] of values) if (sky.u[name]) SETTERS[type](sky.u[name], v);
  gl.uniform2fv(sky.u.uPix0, pix0);
  gl.uniform1f(sky.u.uPixStep, step);
  gl.uniform1f(sky.u.uTargetH, h);
  gl.uniform1f(sky.u.uSnap, opts.snap ? 1 : 0);
  gl.uniform1i(sky.u.uSamples, opts.samples || 1);
  gl.uniform1i(sky.u.uFrame, opts.frame || 0);
  gl.uniform1f(sky.u.uQuality, (opts.quality ?? 1) * P.cQuality);
  if (!opts.rows) { gl.drawArrays(gl.TRIANGLES, 0, 3); return; }
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(0, opts.rows[0], w, opts.rows[1] - opts.rows[0]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.disable(gl.SCISSOR_TEST);
}
