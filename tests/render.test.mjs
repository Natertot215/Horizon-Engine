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

import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toRGB, findBlockAnomalies, corruptCells, cellContrast, cellBusyness } from './block-detector.mjs';

const require = createRequire(process.env.PLAYWRIGHT_MODULES || '/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROMIUM = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-proxy-server'];
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

// ─── Tiny runner ────────────────────────────────────────────────────────────

const results = [];
async function check(name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)${note ? '\n      ' + note : ''}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)\n      ${String(e && e.message || e).split('\n').join('\n      ')}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ─── Server and browser ─────────────────────────────────────────────────────

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.statusCode = rel === 'favicon.ico' ? 204 : 404;
      return res.end();
    }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(file)];
    if (type) res.setHeader('content-type', type);
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

// Helpers installed in the page. They call the app's own top-level functions (applyLook,
// refineView, renderThumb, ...) and read pixels back as base64 so Node can analyse them.
function installHelpers() {
  job = { cancel: false }; // the app's frame loop renders nothing while an export job is set
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
  const readFloat = (fbo, w, h) => {
    const f = new Float32Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, f);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return f;
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
      const raw = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, thumbTarget.fbo);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const shown = cv.getContext('2d').getImageData(0, 0, w, h).data;
      return { data: b64(raw), shown: b64(shown), glError: gl.getError() };
    },
    // Frames the main view so the canvas shows exactly the whole capture image, as a thumbnail
    // does, and renders one sample per pixel (pass 0) at the thumbnail's ray-step quality (read
    // from renderThumb's source, which passes { quality: 0.8 }). Restores the framing afterwards.
    fittedPass0(i, w, h) {
      const savedF = { ...F }, savedRatio = C.ratio;
      const thumbQuality = +((renderThumb.toString().match(/quality:\s*([\d.]+)/) || [])[1] || 1);
      try {
        canvas.width = w;
        canvas.height = h;
        C.ratio = w / h;
        Object.assign(F, { x: 0, y: 0, w: canvas.clientWidth, h: canvas.clientHeight });
        applyLook(PRESETS[i]);
        P.cQuality *= thumbQuality;
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

const t0 = Date.now();
let server = null, browser = null;
try {
  await check('block detector self-check (synthetic image)', () => {
    const [w, h] = MAIN, rgb = syntheticImage(w, h);
    const clean = findBlockAnomalies(rgb, w, h);
    assert(clean.length === 0, `clean synthetic image flagged: ${clean.length} cells`);
    return selfCheck(rgb, w, h, 'synthetic', 12345);
  });

  let url = URL_ARG;
  if (!url) { server = await serve(); url = `http://127.0.0.1:${server.address().port}/index.html`; }
  browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ARGS });
  const log = [];
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
      const nf = nonFinite(f), cov = coverageErrors(f, SMALL[0], 2);
      if (nf) problems.push(`${names[i]}: ${nf} non-finite values`);
      if (cov.length) problems.push(`${names[i]}: coverage ${cov.join(', ')}`);
      if (r.glError) problems.push(`${names[i]}: gl error 0x${r.glError.toString(16)}`);
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
      const nf = nonFinite(f), cov = coverageErrors(f, MAIN[0], REFINE);
      if (nf) problems.push(`${name}: ${nf} non-finite values`);
      if (cov.length) problems.push(`${name}: coverage ${cov.join(', ')}`);
      if (r.glError) problems.push(`${name}: gl error 0x${r.glError.toString(16)}`);
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
    const fa = new Uint32Array(f32(a.data).slice().buffer), fb = new Uint32Array(f32(b.data).slice().buffer);
    let diff = 0;
    for (let i = 0; i < fa.length; i++) diff += fa[i] !== fb[i];
    assert(diff === 0, `${name}: ${diff} of ${fa.length} accumulation values differ between two identical renders`);
    assert(Buffer.from(ta.data, 'base64').equals(Buffer.from(tb.data, 'base64')), `${name}: thumbnails differ between two identical renders`);
    return `${name}, 3 passes at ${SMALL.join('×')} + thumbnail, with ${other} rendered in between`;
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
      const ua = new Uint32Array(f.slice().buffer), ub = new Uint32Array(ref.slice().buffer);
      let diff = 0, firstRow = -1;
      for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) { diff++; if (firstRow < 0) firstRow = Math.floor(i / 4 / w); }
      assert(diff === 0, `${diff} values differ from the unbanded render (first at row ${firstRow})`);
      const a = anomalies(toRGB(f, w, h, 1 / n), w, h);
      assert(!a.length, describe(a));
      assert(!plog.length, plog.join('\n'));
      return `${name}: ${r.calls.join(' + ')} bands for ${n} passes, FRAME_PX=${st.framePx}`;
    } finally {
      await context.close();
    }
  });

  await check('no errors logged during the run', async () => {
    const st = await page.evaluate(() => __t.state());
    assert(!st.err && !st.lost && st.glError === 0, `err=${st.err.slice(0, 200)} lost=${st.lost} glError=${st.glError}`);
    assert(!log.length, log.join('\n'));
  });
} catch (e) {
  results.push({ name: 'harness', ok: false });
  console.log(`FAIL  harness\n      ${e && e.stack || e}`);
} finally {
  if (browser) await browser.close();
  if (server) server.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(failed.length ? 1 : 0);
