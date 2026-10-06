#!/usr/bin/env node
// Headless render invariants for Horizon Engine, run in Chromium with SwiftShader (see README.md).
//
//   node tests/render.test.mjs [url] [--full]
//
// Without a URL the script serves the repository's index.html itself. --full runs the 12-pass
// accumulation check on every preset instead of a subset. Exits non-zero when any check fails.
//
// These pin the invariants that the iPhone "8×4 garbage block" bug breaks: every accumulation pass
// covers every pixel exactly once, nothing becomes NaN/Inf, no SIMD-group-aligned cell stands out
// from its neighbours, rendering is deterministic, and thumbnails agree with the main view. Apple
// GPU behaviour cannot be reproduced here, so a pass is necessary rather than sufficient: it shows
// the app's own logic is sound and catches regressions that also show up on SwiftShader.

import { toRGB, findBlockAnomalies, corruptCells, cellContrast, cellBusyness } from './block-detector.mjs';
import { launch, serveApp, check, assert, harnessFailed, finish } from './harness.mjs';

const argv = process.argv.slice(2);
const FULL = argv.includes('--full');
const URL_ARG = argv.find(a => !a.startsWith('--'));

// Sizes are multiples of the 8×4 cell so the cell grid is the same from either framebuffer origin.
const SMALL = [160, 100];   // every preset, 2 passes
const MAIN = [320, 200];    // full 12-pass accumulation, subset of presets
const THUMB = [140, 88];    // the size buildLookStrip uses
const PHONE_VIEW = [480, 300]; // with the phone budget this needs 2 bands per pass, split at row 273
const REFINE = 12;
const HEAVY = ['Ember Dusk', 'Aurora Lake', 'Ocean Glitter']; // clouds + water, night + aurora, sun glitter
const COMPARE = ['Fuji Twilight', 'Ember Dusk', 'Golden Fields', 'High Noon', 'Alpine Lake', 'Ocean Glitter'];

// ─── Page helpers ───────────────────────────────────────────────────────────

// Installed in the page. They call the app's own top-level functions (applyLook, refineView,
// renderThumb, ...) and read pixels back as base64 so Node can analyse them.
function installHelpers() {
  job = { cancel: false }; // the app's frame loop renders nothing while an export job is set
  GPU.px = GPU.avg = FRAME_PX; // bands of the documented size, whatever the frame loop's pacing reached
  const b64 = a => {
    const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const presetIndex = name => {
    const i = PRESETS.findIndex(p => p.name === name);
    if (i < 0) throw new Error(`no preset named ${name}`);
    return i;
  };
  // Pixels of a framebuffer (null: the canvas), as the sum of its passes or RGBA8 bytes.
  const readFloat = (fbo, w, h) => {
    const f = new Float32Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, f);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return f;
  };
  const readBytes = (fbo, w, h) => {
    const px = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px;
  };
  window.__t = {
    names: () => PRESETS.map(p => p.name),
    presetIndex,
    state: () => ({ err: document.getElementById('err').textContent, lost: gl.isContextLost(), glError: gl.getError(), phone: PHONE, framePx: FRAME_PX }),
    // Renders passes 0..n-1 of preset i through refineView into the RGBA16F accumulation target.
    accumulate(i, w, h, n) {
      canvas.width = w;
      canvas.height = h;
      applyLook(PRESETS[i]);
      const calls = [];
      for (let k = 0; k < n; k++) {
        let c = 1;
        while (!refineView(k)) if (++c > 10000) throw new Error('refineView never completed a pass');
        calls.push(c);
      }
      const f = readFloat(accTarget.fbo, w, h);
      return { data: b64(f), calls, glError: gl.getError() };
    },
    // The same passes drawn without row bands into a separate target, for the banding check.
    unbanded(w, h, n) {
      const m = viewMapping(w), values = sceneValues(), ref = target(w, h, gl.RGBA16F);
      for (let k = 0; k < n; k++) {
        if (k > 0) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); }
        drawSky(ref.fbo, w, h, m.pix0, m.step, values, { frame: k });
        gl.disable(gl.BLEND);
      }
      const f = readFloat(ref.fbo, w, h);
      ref.free();
      return { data: b64(f), glError: gl.getError() };
    },
    // renderThumb into its RGBA8 target; returns the raw target and what landed in the 2D canvas.
    thumb(i, w, h) {
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      renderThumb(PRESETS[i], cv);
      const raw = readBytes(thumbTarget.fbo, w, h);
      const shown = cv.getContext('2d').getImageData(0, 0, w, h).data;
      return { data: b64(raw), shown: b64(shown), glError: gl.getError() };
    },
    // Reprojection: renders n passes of preset i at camera cam0, moves the camera by `move`, and
    // presents the kept view reprojected over a 1×1 black, then white, stand-in for the low-
    // resolution preview (pixels equal in both are the kept view alone). Returns those, the unmoved
    // view as shown, and a fresh n-pass render at the moved camera; RGBA8 rows bottom-up, the fresh
    // one as float.
    warp(i, w, h, n, cam0, move) {
      const readCanvas = () => readBytes(null, w, h);
      const passes = () => { for (let k = 0; k < n; k++) while (!refineView(k)); };
      canvas.width = w;
      canvas.height = h;
      applyLook(PRESETS[i]);
      Object.assign(P, cam0);
      invalidate();
      anchor = null;
      passes();
      const before = readCanvas();
      Object.assign(P, move);
      invalidate();
      const over = v => {
        lowTarget = fitTarget(lowTarget, 1, 1);
        gl.bindFramebuffer(gl.FRAMEBUFFER, lowTarget.fbo);
        gl.clearColor(v, v, v, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        lowOK = true;
        present();
        return readCanvas();
      };
      const black = over(0), white = over(1);
      passes();
      const fresh = readFloat(accTarget.fbo, w, h);
      return { before: b64(before), black: b64(black), white: b64(white), fresh: b64(fresh), glError: gl.getError() };
    },
    // Mean light the stars add (luminance, stars on minus off, after grading) over a w×h window of a
    // 1920×1080 image of preset `name` at the given field of view, the window's top-left at (ox, oy).
    starlight(name, fov, w, h, ox, oy) {
      const W = 1920, H = 1080, look = PRESETS[presetIndex(name)];
      const mean = on => {
        Object.assign(P, lookParams(look), { fov, stars: on, vignette: 0, grain: 0 });
        const values = sceneValues([W, H]), t = target(w, h, gl.RGBA16F);
        for (let k = 0; k < 2; k++) {
          if (k) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); }
          drawSky(t.fbo, w, h, [ox, oy], 1, values, { frame: k });
          gl.disable(gl.BLEND);
        }
        const f = readFloat(t.fbo, w, h);
        t.free();
        let s = 0;
        for (let i = 0; i < w * h; i++) s += 0.2126 * f[i * 4] + 0.7152 * f[i * 4 + 1] + 0.0722 * f[i * 4 + 2];
        return s / (2 * w * h);
      };
      return mean(true) - mean(false);
    },
    // Frames the main view so the canvas shows exactly the whole capture image, as a thumbnail
    // does, and renders one sample per pixel (pass 0) at the thumbnail's ray-step quality.
    // Restores the framing afterwards.
    fittedPass0(i, w, h) {
      const savedF = { ...F }, savedRatio = C.ratio;
      try {
        canvas.width = w;
        canvas.height = h;
        C.ratio = w / h;
        Object.assign(F, { x: 0, y: 0, w: canvas.clientWidth, h: canvas.clientHeight });
        applyLook(PRESETS[i]);
        P.cQuality *= THUMB_QUALITY;
        while (!refineView(0));
        return { data: b64(readFloat(accTarget.fbo, w, h)), dims: captureDims(), glError: gl.getError() };
      } finally {
        Object.assign(F, savedF);
        C.ratio = savedRatio;
      }
    },
  };
}

const f32 = b64 => { const b = Buffer.from(b64, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
const u8 = b64 => new Uint8Array(Buffer.from(b64, 'base64'));

// Float values of `a` and `b` whose bit patterns differ: how many, and the index of the first.
function bitDiff(a, b) {
  const ua = new Uint32Array(a.slice().buffer), ub = new Uint32Array(b.slice().buffer);
  let n = 0, first = -1;
  for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) { if (!n) first = i; n++; }
  return { n, first };
}

async function openPage(browser, url, contextOptions, log) {
  const context = await browser.newContext({ viewport: { width: 800, height: 500 }, ...contextOptions });
  const page = await context.newPage();
  page.on('pageerror', e => log.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error' && !/favicon\.ico$/.test(m.location()?.url || '')) log.push(`console.error: ${m.text()}`);
  });
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  return { context, page };
}

// ─── Analysis ───────────────────────────────────────────────────────────────

function nonFinite(f) {
  let n = 0;
  for (let i = 0; i < f.length; i++) if (!Number.isFinite(f[i])) n++;
  return n;
}

// Every pass writes alpha 1 to every pixel (blended ONE, ONE after the first), so after n passes
// alpha must be exactly n everywhere. A pixel, band or SIMD group skipped or written twice shows up.
function coverageErrors(f, w, n) {
  const bad = [];
  for (let i = 3; i < f.length; i += 4) {
    if (f[i] !== n) {
      if (bad.length < 5) bad.push(`(${((i - 3) / 4) % w},${Math.floor((i - 3) / 4 / w)}) alpha=${f[i]}`);
      else { bad.push('...'); break; }
    }
  }
  return bad;
}

// What is wrong with an n-pass accumulation `f` of width w that __t.accumulate returned as `r`.
function accumulationProblems(name, r, f, w, n) {
  const problems = [], nf = nonFinite(f), cov = coverageErrors(f, w, n);
  if (nf) problems.push(`${name}: ${nf} non-finite values`);
  if (cov.length) problems.push(`${name}: coverage ${cov.join(', ')}`);
  if (r.glError) problems.push(`${name}: gl error 0x${r.glError.toString(16)}`);
  return problems;
}

function anomalies(rgb, w, h) {
  return [...findBlockAnomalies(rgb, w, h).map(c => ({ ...c, cell: '8x4' })),
    ...findBlockAnomalies(rgb, w, h, { bw: 4, bh: 8 }).map(c => ({ ...c, cell: '4x8' }))];
}

const describe = list => list.slice(0, 4).map(c => `${c.cell} cell at (${c.x},${c.y}) dev=${c.dev.toFixed(3)} sharp sides=${c.sharp}`).join('; ') + (list.length > 4 ? ` (+${list.length - 4} more)` : '');

// Self-check: corrupts copies of an image with isolated cells (and one horizontal pair) the way
// the iPhone bug does and requires the detector to find them, while finding nothing in the
// original. 'solid' mimics the thumbnails (cells of near-black dark red); 'blend' mimics the
// averaged view (one of 12 frames garbage: the cell is 1/12 darker and tinted), placed in smooth
// regions where it is visible.
function selfCheck(rgb, w, h, label, seed) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const color = [0.09, 0.01, 0.01];
  const nx = Math.floor(w / 8), ny = Math.floor(h / 4);
  const out = [];
  for (const mode of ['solid', 'blend']) {
    const cells = [];
    for (let t = 0; t < 2000 && cells.length < 8; t++) {
      const bx = 1 + Math.floor(rnd() * (nx - 3)), by = 1 + Math.floor(rnd() * (ny - 2));
      const pair = cells.length === 0 && mode === 'solid';
      const want = pair ? [[bx, by], [bx + 1, by]] : [[bx, by]];
      if (want.some(([x, y]) => cells.some(([cx, cy]) => Math.abs(cx - x) < 3 && Math.abs(cy - y) < 3))) continue;
      if (want.some(([x, y]) => cellContrast(rgb, w, x, y, color) < (mode === 'solid' ? 0.1 : 0.3))) continue;
      if (mode === 'blend' && want.some(([x, y]) => cellBusyness(rgb, w, h, x, y) > 0.012)) continue;
      cells.push(...want);
    }
    if (cells.length < 3) { out.push(`${mode}: too few suitable cells, skipped`); continue; }
    const bad = corruptCells(rgb, w, cells, { mode, color, amount: 1 / 12 });
    const found = new Set(findBlockAnomalies(bad, w, h).map(c => `${c.bx},${c.by}`));
    const hit = cells.filter(([x, y]) => found.has(`${x},${y}`)).length;
    const need = mode === 'solid' ? 0.85 : 0.6;
    assert(hit >= Math.ceil(need * cells.length), `${label}: detector found ${hit}/${cells.length} injected ${mode} cells (needs ${Math.round(need * 100)}%)`);
    out.push(`${mode} ${hit}/${cells.length}`);
  }
  return out.join(', ');
}

// A synthetic image (smooth gradient + dither-like noise) for checking the detector before any
// browser work: clean must pass, corrupted must be caught.
function syntheticImage(w, h) {
  const rgb = new Float32Array(w * h * 3);
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = (rnd() + rnd() - 1) / 255;
    rgb.set([0.25 + 0.4 * y / h + n, 0.35 + 0.3 * x / w + n, 0.7 - 0.2 * y / h + n], (y * w + x) * 3);
  }
  return rgb;
}

// ─── Checks ─────────────────────────────────────────────────────────────────

let app = null, browser = null;
try {
  await check('block detector self-check (synthetic image)', () => {
    const [w, h] = MAIN, rgb = syntheticImage(w, h);
    const clean = findBlockAnomalies(rgb, w, h);
    assert(clean.length === 0, `clean synthetic image flagged: ${clean.length} cells`);
    return selfCheck(rgb, w, h, 'synthetic', 12345);
  });

  app = await serveApp(URL_ARG);
  browser = await launch();
  const { url } = app, log = [];
  let page = null;

  await check('page loads without shader or page errors', async () => {
    ({ page } = await openPage(browser, url, {}, log));
    await page.waitForTimeout(1500); // let the app's own frame loop run a few frames first
    await page.evaluate(installHelpers);
    const st = await page.evaluate(() => __t.state());
    assert(!st.err, `#err shows:\n${st.err.slice(0, 600)}`);
    assert(!st.lost, 'WebGL context lost');
    assert(st.glError === 0, `gl.getError() = 0x${st.glError.toString(16)}`);
    assert(log.length === 0, log.join('\n'));
    return `${url}`;
  });
  if (!page) throw new Error('page did not load; remaining checks skipped');

  const names = await page.evaluate(() => __t.names());
  const small = {}, main = {}, thumbs = {};

  await check(`no NaN/Inf, exact coverage: all ${names.length} presets, 2 passes at ${SMALL.join('×')}`, async () => {
    const problems = [];
    for (let i = 0; i < names.length; i++) {
      const r = await page.evaluate(([i, w, h]) => __t.accumulate(i, w, h, 2), [i, ...SMALL]);
      const f = f32(r.data);
      small[names[i]] = f;
      problems.push(...accumulationProblems(names[i], r, f, SMALL[0], 2));
    }
    assert(!problems.length, problems.slice(0, 12).join('\n') + (problems.length > 12 ? `\n... ${problems.length - 12} more` : ''));
  });

  // Named subsets fall back to the first presets if the preset list is ever renamed.
  const pick = (list, n) => { const l = list.filter(x => names.includes(x)); return l.length ? l : names.slice(0, n); };
  const heavy = FULL ? names : pick(HEAVY, 3), compare = pick(COMPARE, 6);
  await check(`no NaN/Inf, exact coverage: ${heavy.length} presets, ${REFINE} passes at ${MAIN.join('×')}`, async () => {
    const problems = [];
    for (const name of heavy) {
      const r = await page.evaluate(([n, w, h, k]) => __t.accumulate(__t.presetIndex(n), w, h, k), [name, ...MAIN, REFINE]);
      const f = f32(r.data);
      main[name] = f;
      problems.push(...accumulationProblems(name, r, f, MAIN[0], REFINE));
    }
    assert(!problems.length, problems.join('\n'));
    return heavy.join(', ');
  });

  await check(`thumbnails: renderThumb at ${THUMB.join('×')} for all presets, shown == rendered`, async () => {
    const problems = [];
    const [w, h] = THUMB;
    for (let i = 0; i < names.length; i++) {
      const r = await page.evaluate(([i, w, h]) => __t.thumb(i, w, h), [i, w, h]);
      const raw = u8(r.data), shown = u8(r.shown);
      thumbs[names[i]] = raw;
      if (r.glError) problems.push(`${names[i]}: gl error 0x${r.glError.toString(16)}`);
      // readInto flips rows into the 2D canvas; alpha is 1 so the copy must be exact.
      let diff = 0;
      for (let y = 0; y < h; y++) diff += Buffer.compare(Buffer.from(raw.subarray((h - 1 - y) * w * 4, (h - y) * w * 4)), Buffer.from(shown.subarray(y * w * 4, (y + 1) * w * 4))) !== 0;
      if (diff) problems.push(`${names[i]}: ${diff} rows differ between the RGBA8 target and the thumbnail canvas`);
    }
    assert(!problems.length, problems.join('\n'));
  });

  await check('block detector self-check (real renders)', () => {
    const notes = [];
    const t = thumbs[names[0]], m = main[heavy[0]];
    assert(t && m, 'no renders to corrupt: an earlier check failed before producing them');
    notes.push('thumb: ' + selfCheck(toRGB(t, ...THUMB, 1 / 255), ...THUMB, `thumbnail ${names[0]}`, 99));
    notes.push('main: ' + selfCheck(toRGB(m, ...MAIN, 1 / REFINE), ...MAIN, `main ${heavy[0]}`, 4242));
    return notes.join(' | ');
  });

  await check('no 8×4 / 4×8 block anomalies in thumbnails or main renders', () => {
    const problems = [];
    let cells = 0;
    for (const [name, raw] of Object.entries(thumbs)) {
      const a = anomalies(toRGB(raw, ...THUMB, 1 / 255), ...THUMB);
      if (a.length) problems.push(`thumbnail ${name}: ${describe(a)}`);
      cells += Math.floor(THUMB[0] / 8) * Math.floor(THUMB[1] / 4);
    }
    for (const [name, f] of Object.entries(small)) {
      const a = anomalies(toRGB(f, ...SMALL, 1 / 2), ...SMALL);
      if (a.length) problems.push(`${SMALL.join('×')} ${name}: ${describe(a)}`);
      cells += Math.floor(SMALL[0] / 8) * Math.floor(SMALL[1] / 4);
    }
    for (const [name, f] of Object.entries(main)) {
      const a = anomalies(toRGB(f, ...MAIN, 1 / REFINE), ...MAIN);
      if (a.length) problems.push(`${MAIN.join('×')} ${name}: ${describe(a)}`);
      cells += Math.floor(MAIN[0] / 8) * Math.floor(MAIN[1] / 4);
    }
    // The 12-pass renders come last in the list but carry the subtlest symptom, so keep them.
    const shown = problems.length > 12 ? [...problems.slice(0, 6), `... ${problems.length - 9} more images ...`, ...problems.slice(-3)] : problems;
    assert(!problems.length, `${problems.length} images with anomalies:\n${shown.join('\n')}`);
    return `${Object.keys(thumbs).length + Object.keys(small).length + Object.keys(main).length} images, ${cells} cells per orientation`;
  });

  await check('deterministic: same preset twice is bit-identical (accumulation and thumbnail)', async () => {
    const name = heavy[0], other = names[(names.indexOf(name) + 5) % names.length];
    const run = () => page.evaluate(([n, w, h]) => __t.accumulate(__t.presetIndex(n), w, h, 3), [name, ...SMALL]);
    const thumb = () => page.evaluate(([n, w, h]) => __t.thumb(__t.presetIndex(n), w, h), [name, ...THUMB]);
    const a = await run(), ta = await thumb();
    await page.evaluate(([n, w, h]) => __t.accumulate(__t.presetIndex(n), w, h, 1), [other, ...SMALL]); // disturb state in between
    const b = await run(), tb = await thumb();
    const fa = f32(a.data), diff = bitDiff(fa, f32(b.data)).n;
    assert(diff === 0, `${name}: ${diff} of ${fa.length} accumulation values differ between two identical renders`);
    assert(Buffer.from(ta.data, 'base64').equals(Buffer.from(tb.data, 'base64')), `${name}: thumbnails differ between two identical renders`);
    return `${name}, 3 passes at ${SMALL.join('×')} + thumbnail, with ${other} rendered in between`;
  });

  // Each scene runs a sky shader trimmed to the features it uses; the code left out is skipped at
  // run time anyway, so the trimmed build must match the full one bit for bit.
  await check(`trimmed shaders: every preset matches the full shader bit-for-bit (${names.length} presets)`, async () => {
    const bad = [];
    for (let i = 0; i < names.length; i++) {
      const run = full => page.evaluate(([i, w, h, full]) => {
        const own = sceneFeatures;
        if (full) sceneFeatures = () => ALL_FEATURES;
        try { return __t.accumulate(i, w, h, 1); } finally { sceneFeatures = own; }
      }, [i, ...SMALL, full]);
      const a = await run(false), b = await run(true);
      const diff = bitDiff(f32(a.data), f32(b.data)).n;
      if (diff) bad.push(`${names[i]}: ${diff} values`);
    }
    assert(!bad.length, `trimmed and full shaders differ: ${bad.join(', ')}`);
    return `1 pass at ${SMALL.join('×')}, ${await page.evaluate(() => skyPrograms.size)} programs compiled`;
  });

  // Fine detail legitimately differs between a 160-pixel and a 320-pixel render (cloud and grass
  // detail follow the pixel footprint), so "up to resampling" is checked at low frequency: the
  // main render is 2×2-downsampled to the thumbnail grid, both are compared in 4×4 blocks, and
  //   - the block error and the overall colour balance stay within tolerance,
  //   - no shifted (±1, ±2 px) or mirrored copy of the thumbnail fits better (framing/flip bugs),
  //   - the difference image has no 8×4- or 4×8-aligned cells (garbage in one path only).
  await check(`thumbnail matches a 1-sample main render up to resampling (${compare.length} presets)`, async () => {
    const problems = [], notes = [];
    const [tw, th] = SMALL, [mw, mh] = [SMALL[0] * 2, SMALL[1] * 2], B = 4;
    const shifted = (raw, dx, dy, flipX, flipY) => {
      const o = new Float32Array(tw * th * 3);
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const sx = Math.min(tw - 1, Math.max(0, (flipX ? tw - 1 - x : x) + dx));
        const sy = Math.min(th - 1, Math.max(0, (flipY ? th - 1 - y : y) + dy));
        for (let c = 0; c < 3; c++) o[(y * tw + x) * 3 + c] = raw[(sy * tw + sx) * 4 + c] / 255;
      }
      return o;
    };
    // Mean over interior 4×4 blocks of the max-over-RGB difference of block means.
    const blockErr = (a, b) => {
      let s = 0, n = 0;
      for (let by = 1; by < th / B - 1; by++) for (let bx = 1; bx < tw / B - 1; bx++) {
        let m = 0;
        for (let c = 0; c < 3; c++) {
          let d = 0;
          for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) { const i = ((by * B + y) * tw + bx * B + x) * 3 + c; d += a[i] - b[i]; }
          m = Math.max(m, Math.abs(d) / (B * B));
        }
        s += m;
        n++;
      }
      return s / n;
    };
    for (const name of compare) {
      const t = await page.evaluate(([n, w, h]) => __t.thumb(__t.presetIndex(n), w, h), [name, tw, th]);
      const m = await page.evaluate(([n, w, h]) => __t.fittedPass0(__t.presetIndex(n), w, h), [name, mw, mh]);
      const raw = u8(t.data), thumb = shifted(raw, 0, 0), full = f32(m.data);
      const down = new Float32Array(tw * th * 3), diffImg = new Float32Array(tw * th * 3);
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) s += full[((2 * y + dy) * mw + 2 * x + dx) * 4 + c];
        const i = (y * tw + x) * 3 + c;
        down[i] = Math.min(1, Math.max(0, s / 4)); // clamp like the RGBA8 thumbnail target
        diffImg[i] = 0.5 + thumb[i] - down[i];
      }
      const e0 = blockErr(thumb, down);
      let balance = 0;
      for (let c = 0; c < 3; c++) {
        let st = 0, sd = 0;
        for (let i = c; i < thumb.length; i += 3) { st += thumb[i]; sd += down[i]; }
        balance = Math.max(balance, Math.abs(st - sd) / (tw * th));
      }
      const near = Math.min(...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => blockErr(shifted(raw, dx, dy), down)));
      const far = Math.min(...[[2, 0], [-2, 0], [0, 2], [0, -2]].map(([dx, dy]) => blockErr(shifted(raw, dx, dy), down)),
        blockErr(shifted(raw, 0, 0, true, false), down), blockErr(shifted(raw, 0, 0, false, true), down));
      notes.push(`${name} err=${e0.toFixed(4)} balance=${balance.toFixed(4)} vs±1px=${(e0 / near).toFixed(2)} vs±2px/flip=${(e0 / far).toFixed(2)}`);
      if (e0 > 0.04) problems.push(`${name}: 4×4-block error ${e0.toFixed(4)} > 0.04`);
      if (balance > 0.025) problems.push(`${name}: mean colour differs by ${balance.toFixed(4)} > 0.025`);
      if (e0 > near) problems.push(`${name}: a 1-pixel-shifted thumbnail matches the main render better (${near.toFixed(4)} < ${e0.toFixed(4)})`);
      if (e0 > 0.95 * far) problems.push(`${name}: a 2-pixel-shifted or mirrored thumbnail matches nearly as well (${far.toFixed(4)} vs ${e0.toFixed(4)})`);
      const a = anomalies(diffImg, tw, th);
      if (a.length) problems.push(`${name}: block-aligned differences: ${describe(a)}`);
    }
    assert(!problems.length, problems.join('\n') + '\n' + notes.join('\n'));
    return notes.join('\n      ');
  });

  await check(`phone budget: banded refinement covers every pixel once and matches an unbanded render bit-for-bit (${PHONE_VIEW.join('×')})`, async () => {
    const plog = [];
    const { context, page: phone } = await openPage(browser, url, { isMobile: true, hasTouch: true }, plog);
    try {
      await phone.evaluate(installHelpers);
      const st = await phone.evaluate(() => __t.state());
      assert(st.phone, 'pointer: coarse did not match in the mobile context, so PHONE is false and banding is not exercised');
      const name = heavy[0], [w, h] = PHONE_VIEW, n = 2;
      const r = await phone.evaluate(([nm, w, h, n]) => __t.accumulate(__t.presetIndex(nm), w, h, n), [name, w, h, n]);
      assert(r.calls.every(c => c > 1), `expected several bands per pass with FRAME_PX=${st.framePx}, got ${r.calls.join(', ')} refineView calls`);
      const f = f32(r.data);
      const nf = nonFinite(f), cov = coverageErrors(f, w, n);
      assert(!nf, `${nf} non-finite values`);
      assert(!cov.length, `coverage: ${cov.join(', ')}`);
      const ref = f32((await phone.evaluate(([w, h, n]) => __t.unbanded(w, h, n), [w, h, n])).data);
      const diff = bitDiff(f, ref);
      assert(diff.n === 0, `${diff.n} values differ from the unbanded render (first at row ${Math.floor(diff.first / 4 / w)})`);
      const a = anomalies(toRGB(f, w, h, 1 / n), w, h);
      assert(!a.length, describe(a));
      assert(!plog.length, plog.join('\n'));
      return `${name}: ${r.calls.join(' + ')} bands for ${n} passes, FRAME_PX=${st.framePx}`;
    } finally {
      await context.close();
    }
  });

  // While a camera move renders, the view shows the last finished one reprojected. Its inverse
  // projections must land each direction where the fresh render puts it: much closer than the
  // unmoved image, for every projection. Compared in 4×4-block means, since resampling alone
  // moves fine detail (ripples, the horizon line) by a level or two.
  await check('reprojection: the kept view, moved with the camera, matches a fresh render (4 projections)', async () => {
    const problems = [], notes = [];
    const [w, h] = MAIN, n = 4, B = 4;
    const cases = [
      ['Lens', { proj: 0, fov: 70 }, { heading: '+5', pitch: '+3', roll: '+4' }],
      ['Fisheye', { proj: 1, fov: 150 }, { heading: '+12', pitch: '+6' }],
      ['Dome', { proj: 2, fov: 160 }, { heading: '+12', pitch: '-6', fov: '-25' }],
      ['360°', { proj: 3, fov: 360 }, { heading: '+30' }],
    ];
    const name = names.includes('Fuji Twilight') ? 'Fuji Twilight' : names[0];
    for (const [label, cam0, rel] of cases) {
      const r = await page.evaluate(([n0, w, h, n, cam0, rel]) => {
        const i = __t.presetIndex(n0), base = { ...lookParams(PRESETS[i]), ...cam0 };
        const move = Object.fromEntries(Object.entries(rel).map(([k, d]) => [k, base[k] + +d]));
        return __t.warp(i, w, h, n, cam0, move);
      }, [name, w, h, n, cam0, rel]);
      const before = u8(r.before), black = u8(r.black), white = u8(r.white), fresh = f32(r.fresh);
      const kept = p => black[p * 4] === white[p * 4] && black[p * 4 + 1] === white[p * 4 + 1] && black[p * 4 + 2] === white[p * 4 + 2];
      let covered = 0, blocks = 0, ew = 0, es = 0;
      for (let p = 0; p < w * h; p++) covered += kept(p);
      for (let by = 0; by < h / B; by++) for (let bx = 0; bx < w / B; bx++) {
        const px = [];
        for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) px.push((by * B + y) * w + bx * B + x);
        if (!px.every(kept)) continue;
        blocks++;
        for (let c = 0; c < 3; c++) {
          let a = 0, b = 0, f = 0;
          for (const p of px) { a += black[p * 4 + c]; b += before[p * 4 + c]; f += Math.min(255, Math.max(0, fresh[p * 4 + c] / n * 255)); }
          ew += Math.abs(a - f) / px.length;
          es += Math.abs(b - f) / px.length;
        }
      }
      ew /= 3 * blocks || 1;
      es /= 3 * blocks || 1;
      const cov = covered / (w * h);
      notes.push(`${label}: covers ${(cov * 100).toFixed(0)}%, error ${ew.toFixed(2)} vs unmoved ${es.toFixed(2)} levels`);
      if (r.glError) problems.push(`${label}: gl error 0x${r.glError.toString(16)}`);
      if (cov < 0.5) problems.push(`${label}: the kept view covers only ${(cov * 100).toFixed(0)}% after a small move`);
      if (!(ew < 0.3 * es)) problems.push(`${label}: reprojected error ${ew.toFixed(2)} is not well below the unmoved ${es.toFixed(2)}`);
      if (!(ew < 2.5)) problems.push(`${label}: reprojected error ${ew.toFixed(2)} levels > 2.5`);
    }
    assert(!problems.length, problems.join('\n') + '\n' + notes.join('\n'));
    return `${name}: ` + notes.join('\n      ');
  });

  // A star's light is fixed on the sky: zooming spreads or gathers it, so the level the stars add holds
  // across zoom, and from the centre to the stretched corner of a wide frame. (Before, it grew with
  // the field of view squared and followed the local pixel scale: 15× from 40° to 120°, 5× toward the
  // corner.)
  await check('stars: their light holds across zoom and across a wide frame', async () => {
    const name = names.includes('Deep Navy') ? 'Deep Navy' : names[0], [w, h] = [320, 200];
    const at = (fov, ox, oy) => page.evaluate(a => __t.starlight(...a), [name, fov, w, h, ox, oy]);
    const centre = [960 - w / 2, 540 - h / 2], zoom = {};
    for (const fov of [40, 70, 120]) zoom[fov] = await at(fov, ...centre);
    const corner = await at(110, 0, 0), middle = await at(110, ...centre);
    const levels = Object.values(zoom), spread = Math.max(...levels) / Math.min(...levels), edge = corner / middle;
    const note = `${name}: ${Object.entries(zoom).map(([f, v]) => `${f}° ${v.toFixed(4)}`).join(', ')} (×${spread.toFixed(2)}); 110° corner/centre ${edge.toFixed(2)}`;
    assert(levels.every(v => v > 0), `no starlight: ${note}`);
    assert(spread < 1.6, `starlight changes ×${spread.toFixed(2)} with zoom\n${note}`);
    assert(edge > 0.7 && edge < 1.4, `corner/centre starlight ${edge.toFixed(2)}\n${note}`);
    return note;
  });

  await check('no errors logged during the run', async () => {
    const st = await page.evaluate(() => __t.state());
    assert(!st.err && !st.lost && st.glError === 0, `err=${st.err.slice(0, 200)} lost=${st.lost} glError=${st.glError}`);
    assert(!log.length, log.join('\n'));
  });
} catch (e) {
  harnessFailed(e);
} finally {
  if (browser) await browser.close();
  if (app) app.close();
}
finish();
