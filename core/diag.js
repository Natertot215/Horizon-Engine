'use strict';

// The ?diag self-test for GPU faults.

// ?diag replaces the app with a GPU self-test: the same scenes rendered through every path the app
// uses and through a diagnostic build of the sky shader with single stages bypassed (uDebug), each
// read back and scored for cell-aligned corruption (garbage shared by an 8×4 SIMD group, as seen on
// iPhones). ?diag=N uses preset N as scene B.
const DIAG_ARG = new URLSearchParams(location.search).get('diag');
const DIAG = DIAG_ARG !== null;

// to: where the sky is drawn; f16 is the RGBA16F accumulation target, read back as float. passes
// add up with blending, in row bands of `band` under the scissor, then `resolve` divides them out.
const DIAG_PATHS = {
  thumb: { to: 't8', q: THUMB_QUALITY, samples: THUMB_SAMPLES }, // renderThumb
  f16: { to: 'f16' },
  acc1: { to: 'f16', passes: 1, resolve: 't8' },
  acc4: { to: 'f16', passes: 4, resolve: 't8' },
  bands: { to: 'f16', passes: 4, band: 50, resolve: 't8' },
  canvas: { to: 'canvas' },                              // renderView at full scale
  view: { to: 'f16', passes: 4, band: 50, resolve: 'canvas' }, // refineView
};
const DIAG_T = 3; // levels (of 255) a cell must stand out by
const dg = { t8: null, f16: null, prog: null };

function diagTarget(to, w, h) {
  if (to !== 'canvas') return (dg[to] = fitTarget(dg[to], w, h, to === 'f16' ? gl.RGBA16F : gl.RGBA8)).fbo;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return null;
}

function diagRead(fbo, w, h, float) {
  const a = float ? new Float32Array(w * h * 4) : new Uint8Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.readPixels(0, 0, w, h, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, a);
  return a;
}

// Draws case c and reads it back: px is RGBA8 in framebuffer rows (bottom up, so cells line up with
// SIMD groups), f the raw RGBA16F sum where the path has one.
function diagRender(c, values) {
  const { w, h } = c, n = c.passes || 1, band = c.band || h, fbo = diagTarget(c.to, w, h);
  for (let k = 0; k < n; k++) {
    if (k) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); }
    for (let y = 0; y < h; y += band) {
      drawSky(fbo, w, h, [0, 0], c.step || 1, values, { prog: c.prog, debug: c.mask, quality: c.q, samples: c.samples, frame: k, rows: c.band && [y, Math.min(h, y + band)] });
    }
    gl.disable(gl.BLEND);
  }
  if (c.to !== 'f16') return { px: diagRead(fbo, w, h) };
  const f = diagRead(fbo, w, h, true);
  if (!c.resolve) return { f, px: Uint8Array.from(f, v => Math.round(clamp(v, 0, 1) * 255)) };
  const out = diagTarget(c.resolve, w, h);
  gl.bindFramebuffer(gl.FRAMEBUFFER, out);
  gl.viewport(0, 0, w, h);
  gl.useProgram(resolveProg.p);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, dg.f16.tex);
  gl.uniform1f(resolveProg.u.uScale, 1 / n);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return { f, px: diagRead(out, w, h) };
}

const median = a => { a.sort((p, q) => p - q); const k = a.length >> 1; return a.length & 1 ? a[k] : (a[k - 1] + a[k]) / 2; };

// Cells of bw×bh pixels aligned to the framebuffer origin that stand apart from their surroundings:
// in some channel the cell mean is off the median of its 8 neighbours by more than DIAG_T + 2σ, and
// three or four of its sides step that way by more than max(DIAG_T / 2, 2σ) (median step across the
// side), σ being the mean step inside the cell. Stars, glints, waves, edges and gradients rarely
// step on three sides of an aligned cell; a cell-wide offset always does. (ox, oy) shifts the grid
// off the SIMD alignment, which gives the count natural detail alone produces.
function blockScan(px, w, h, bw, bh, ox = 0, oy = 0) {
  const nx = (w - ox) / bw | 0, ny = (h - oy) / bh | 0, m = new Float32Array(nx * ny * 3), bad = [];
  const at = (x, y, ch) => px[(y * w + x) * 4 + ch];
  let black = 0, flat = 0;
  for (let by = 0; by < ny; by++) for (let bx = 0; bx < nx; bx++) {
    const s = [0, 0, 0], o0 = ((oy + by * bh) * w + ox + bx * bw) * 4;
    let same = true;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const o = o0 + (y * w + x) * 4;
      for (let ch = 0; ch < 3; ch++) { s[ch] += px[o + ch]; same &&= px[o + ch] === px[o0 + ch]; }
    }
    for (let ch = 0; ch < 3; ch++) m[(by * nx + bx) * 3 + ch] = s[ch] / (bw * bh);
    if (s[0] + s[1] + s[2] === 0) black++;
    else if (same) flat++;
  }
  for (let by = 1; by < ny - 1; by++) for (let bx = 1; bx < nx - 1; bx++) {
    const x0 = ox + bx * bw, x1 = x0 + bw, y0 = oy + by * bh, y1 = y0 + bh, mean = [], ref = [];
    let dev = 0;
    for (let ch = 0; ch < 3; ch++) {
      const nb = [];
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (i || j) nb.push(m[((by + j) * nx + bx + i) * 3 + ch]);
      mean[ch] = m[(by * nx + bx) * 3 + ch];
      ref[ch] = median(nb);
      const dv = mean[ch] - ref[ch];
      if (Math.abs(dv) <= DIAG_T || Math.abs(dv) <= Math.abs(dev)) continue;
      let tex = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        if (x > x0) tex += Math.abs(at(x, y, ch) - at(x - 1, y, ch));
        if (y > y0) tex += Math.abs(at(x, y, ch) - at(x, y - 1, ch));
      }
      tex *= 2 / ((bw - 1) * bh + bw * (bh - 1));
      if (Math.abs(dv) <= DIAG_T + tex) continue;
      const sides = [[], [], [], []];
      for (let y = y0; y < y1; y++) { sides[0].push(at(x0, y, ch) - at(x0 - 1, y, ch)); sides[1].push(at(x1 - 1, y, ch) - at(x1, y, ch)); }
      for (let x = x0; x < x1; x++) { sides[2].push(at(x, y0, ch) - at(x, y0 - 1, ch)); sides[3].push(at(x, y1 - 1, ch) - at(x, y1, ch)); }
      if (sides.filter(sd => median(sd) * Math.sign(dv) > Math.max(DIAG_T / 2, tex)).length >= 3) dev = dv;
    }
    if (dev) bad.push({ x: x0, y: y0, dev: +dev.toFixed(1), rgb: mean.map(Math.round), ref: ref.map(Math.round) });
  }
  bad.sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev));
  return { n: bad.length, score: bad.length / ((nx - 2) * (ny - 2)), black, flat, worst: bad.slice(0, 6) };
}

// Mean step across 8×4 cell borders over the mean step inside cells, the larger of the horizontal
// and vertical ratio (steps clipped at 4 levels per channel, so one edge cannot dominate): about 1
// for any natural image, higher when many cells are offset by a little.
function edgeRatio(px, w, h) {
  const e = new Float64Array(8); // per direction: border sum, count, inner sum, count
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    for (const [on, d, edge, i] of [[x, 4, x % 8 === 0, 0], [y, w * 4, y % 4 === 0, 4]]) {
      if (!on) continue;
      let v = 0;
      for (let ch = 0; ch < 3; ch++) v += Math.min(4, Math.abs(px[o + ch] - px[o - d + ch]));
      e[i + (edge ? 0 : 2)] += v;
      e[i + (edge ? 1 : 3)]++;
    }
  }
  const r = i => (e[i] / e[i + 1] + 1) / (e[i + 2] / e[i + 3] + 1);
  return Math.max(r(0), r(4));
}

function diagEnv() {
  resizeCanvas(); // the size the app would render the view at
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const prec = t => { const f = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, t); return [f.rangeMin, f.rangeMax, f.precision]; };
  return {
    renderer: gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
    vendor: gl.getParameter(dbg ? dbg.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
    version: gl.getParameter(gl.VERSION),
    highFloat: prec(gl.HIGH_FLOAT), highInt: prec(gl.HIGH_INT),
    dpr: devicePixelRatio, canvas: [canvas.width, canvas.height], css: [innerWidth, innerHeight],
    maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE), PHONE, FRAME_PX, budget: Math.round(GPU.px),
    ua: navigator.userAgent, extensions: gl.getSupportedExtensions(),
  };
}

function diagCases() {
  const preset = PRESETS[DIAG_ARG === '' ? -1 : +DIAG_ARG];
  const A = { name: 'A', title: 'default', p: {} };
  const B = preset ? { name: 'B', title: preset.name, p: preset.p } : { name: 'B', title: 'twilight mix', p: {
    sunElev: -3, moon: true, moonElev: 18, moonHeading: 160, mw: 0.6, aurora: 0.5, land: 1, ...cloudLayer(0, 'cumulus', { Cover: 0.35 }),
  } };
  const out = [], sec = t => out.push({ sec: t });
  const add = (scene, path, w, h, label, extra = {}) => out.push({ scene, path, w, h, label, mask: 0, ...DIAG_PATHS[path], ...extra });
  sec('A default · production shader');
  for (const [w, h] of [[256, 256], [400, 800]]) for (const p of Object.keys(DIAG_PATHS)) add(A, p, w, h, `${p} ${w === h ? w : w + '×' + h}`);
  add(A, 'view', 400, 800, 'view ÷4 400×800', { step: 4 });
  sec('A default · fast-math build (no isnan guard): FAIL here and PASS above means fast math was the cause');
  for (const p of ['thumb', 'f16']) add(A, p, 256, 256, `${p} 256 fast`, { fast: true });
  add(A, 'view', 400, 800, 'view ÷4 400×800 fast', { step: 4, fast: true });
  sec(`B ${B.title} · production shader`);
  for (const p of ['thumb', 'view']) add(B, p, 256, 256, `${p} 256`);
  const all = (1 << DBG_BITS.indexOf('GRADE')) - 1; // every scene stage, LUT to CLOUDS
  for (const s of [A, B]) {
    sec(`${s.name} · diag shader, bypass one stage · f16 256`);
    add(s, 'f16', 256, 256, 'none', { diag: true });
    DBG_BITS.forEach((n, i) => n !== 'INJECT' && add(s, 'f16', 256, 256, (/^(FLAT|GRAD)$/.test(n) ? 'only ' : '−') + n.toLowerCase(), { diag: true, mask: 1 << i }));
    add(s, 'f16', 256, 256, '−all stages', { diag: true, mask: all });
  }
  sec('Self-test · injected 8×4 tint, must be caught');
  const inj = 1 << DBG_BITS.indexOf('INJECT');
  add(A, 'thumb', 256, 256, 'thumb 256', { diag: true, mask: inj, self: true });
  add(A, 'bands', 400, 800, 'bands 400×800', { diag: true, mask: inj, self: true });
  return out;
}

async function runDiag() {
  const ui = el('div', '', document.body);
  ui.id = 'diag';
  el('h2', '', ui, 'Horizon Engine · GPU self-test');
  const env = diagEnv();
  el('div', 'env', ui, [
    `GPU   ${env.renderer} · ${env.vendor}`,
    `GL    ${env.version}`,
    `highp float [${env.highFloat}] · int [${env.highInt}]  (rangeMin, rangeMax, precision)`,
    `dpr ${env.dpr} · canvas ${env.canvas.join('×')} · css ${env.css.join('×')} · maxTex ${env.maxTexture}`,
    `PHONE ${PHONE} · FRAME_PX ${FRAME_PX} · budget ${env.budget}`,
  ].join('\n'));
  const actions = el('div', 'row-b', ui), copy = el('button', 'btn', actions, 'Copy results'), status = el('span', '', actions, 'compiling…');
  copy.disabled = true;
  const table = el('table', '', ui);
  table.innerHTML = '<tr><th>case</th><th></th><th>8×4%</th><th>4×4%</th><th>8×8%</th><th>edge</th><th>blk</th><th>NaN</th><th>ms</th></tr>';
  el('div', 'env', ui, '\n8×4% 4×4% 8×8%: cells standing out from their neighbours · edge: step across 8×4 borders over step inside (≈1 when clean) · blk: all-black 8×4 cells · NaN: NaN/Inf values in the RGBA16F read-back (– none read) · ms: draw + read-back');
  const gal = el('div', 'gal', ui);
  el('div', 'env', ui, `\next ${env.extensions.join(' ')}\n\n${env.ua}`);
  const json = el('details', '', ui);
  el('summary', '', json, 'JSON');
  const pre = el('pre', '', json);
  const report = { env, cases: [] }, t0 = performance.now();
  await nextFrame();
  try {
    const tc = performance.now();
    dg.prog = program(VS, SKY_FS(true), SKY_SAMPLERS);
    dg.fast = program(VS, SKY_FS(false, true), SKY_SAMPLERS);
    env.diagCompileMs = Math.round(performance.now() - tc);
  } catch (e) {
    $('err').style.display = 'none';
    status.textContent = 'diag shader failed: ' + e.message;
  }
  const cases = diagCases(), runs = cases.filter(c => !c.sec);
  // Warm up both programs (drivers may build the pipeline on first draw) so timings are per render.
  for (const prog of [dg.prog, dg.fast]) if (prog) diagRender({ to: 't8', w: 8, h: 8, prog }, sceneValues([8, 8]));
  let done = 0, passed = 0, caught = 0, shown = 0;
  for (const c of cases) {
    if (c.sec) { el('td', '', el('tr', 'sec', table), c.sec).colSpan = 9; continue; }
    status.textContent = `running ${++done}/${runs.length}…`;
    await nextFrame();
    const row = { scene: c.scene.name, label: c.label, path: c.path, w: c.w, h: c.h, step: c.step || 1, mask: c.mask, diag: !!c.diag };
    try {
      if ((c.diag && !dg.prog) || (c.fast && !dg.fast)) throw new Error('no diag shader');
      Object.assign(P, lookParams(c.scene));
      rewindAnim();
      const values = sceneValues([c.w * (c.step || 1), c.h * (c.step || 1)]);
      gl.getError();
      const t = performance.now(), { px, f } = diagRender({ ...c, prog: c.fast ? dg.fast : c.diag ? dg.prog : skyProgram(sceneFeatures()) }, values);
      row.ms = Math.round(performance.now() - t);
      row.glError = gl.getError();
      if (gl.isContextLost()) throw new Error('WebGL context lost');
      for (const [bw, bh] of [[8, 4], [4, 4], [8, 8], [4, 8]]) row[`${bw}x${bh}`] = blockScan(px, c.w, c.h, bw, bh);
      row.shifted = blockScan(px, c.w, c.h, 8, 4, 4, 2).n;
      row.edge = +edgeRatio(px, c.w, c.h).toFixed(3);
      if (f) {
        Object.assign(row, { nan: 0, inf: 0, neg: 0, nanAt: [] }); // nanAt: [x, y, channel], framebuffer coordinates
        f.forEach((v, i) => {
          if (v < 0) row.neg++;
          if (v === v && isFinite(v)) return;
          row[v === v ? 'inf' : 'nan']++;
          if (row.nanAt.length < 8) row.nanAt.push([(i >> 2) % c.w, (i >> 2) / c.w | 0, 'rgba'[i & 3]]);
        });
      }
      if (c.mask === 1 << DBG_BITS.indexOf('FLAT')) row.offFlat = px.filter((v, i) => Math.abs(v - [64, 128, 191, 255][i & 3]) > 1).length;
      // Fail on more aligned cells than the shifted grid finds (natural detail), with 0.1% slack.
      const excess = row['8x4'].n - row.shifted;
      const bad = excess > 1 + 0.001 * c.w * c.h / 32 || row.edge > 1.1 || row.nan || row.inf || row.glError || row.offFlat;
      row.result = c.self ? (bad ? 'CAUGHT' : 'MISSED') : bad ? 'FAIL' : 'PASS';
      if (c.self ? bad : !bad) passed++;
      if (c.self && bad) caught++;
      if ((bad || c.self) && shown++ < 16) {
        const cell = el('div', '', gal), cv = el('canvas', '', cell);
        el('div', '', cell, `${c.scene.name} ${c.label}${c.mask ? ' m' + c.mask : ''}`);
        cv.width = c.w;
        cv.height = c.h;
        cv.style.width = c.w / devicePixelRatio + 'px'; // one image pixel per device pixel
        cv.getContext('2d').putImageData(upright(px, c.w, c.h), 0, 0);
      }
    } catch (e) {
      row.error = String(e.message || e);
      row.result = 'ERR';
    }
    report.cases.push(row);
    const tr = el('tr', '', table), pct = k => row[k] ? (row[k].score * 100).toFixed(2) : '';
    for (const v of [c.label, row.result, pct('8x4'), pct('4x4'), pct('8x8'), row.edge?.toFixed(2) ?? '', row['8x4']?.black ?? '', row.nan ?? '–', row.ms ?? '']) el('td', '', tr, v);
    const res = tr.children[1];
    res.className = /PASS|CAUGHT/.test(row.result) ? 'ok' : 'bad';
    if (row.error) res.title = row.error;
  }
  report.ms = Math.round(performance.now() - t0);
  report.summary = `${passed}/${report.cases.length} ok · self-test caught ${caught}/${runs.filter(c => c.self).length}`;
  status.textContent = `${report.summary} · ${(report.ms / 1000).toFixed(1)} s`;
  window.diagReport = report;
  const text = JSON.stringify(report);
  pre.textContent = text;
  copy.disabled = false;
  copy.onclick = async () => {
    let ok = true;
    try { await navigator.clipboard.writeText(text); } catch {
      const r = document.createRange();
      json.open = true;
      r.selectNodeContents(pre);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      ok = document.execCommand('copy');
    }
    status.textContent = ok ? `copied ${text.length} characters of JSON` : 'copy failed: select the JSON at the bottom';
  };
}
