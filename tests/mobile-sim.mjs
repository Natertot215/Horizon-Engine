#!/usr/bin/env node
// Mobile walkthrough for Horizon Engine: an iPhone 17 (402×874 CSS px at 3×, touch, coarse pointer,
// iOS user agent) in headless Chromium + SwiftShader, driving the real app through its own input
// paths and screenshotting each step, with checks for the mobile invariants.
//
//   node tests/mobile-sim.mjs [url] [--out dir]
//
// Steps: first load, refined view, hidden panel, a one-finger drag (mid-drag, held, after release),
// a pinch, landscape with the Dynamic Island's safe areas, capture mode, and focusing the Save Look
// field. Screenshots go to --out (default: horizon-mobile-sim in the temp folder). SwiftShader is a CPU
// rasterizer, so timings say nothing about an iPhone; what is drawn, where and when is the same.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { launch, serveApp, check, assert, harnessFailed, finish } from './harness.mjs';

const argv = process.argv.slice(2);
const OUT = path.resolve(argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : path.join(os.tmpdir(), 'horizon-mobile-sim'));
const URL_ARG = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out');

const IPHONE = {
  viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
};
const LANDSCAPE_SAFE = { top: 0, left: 62, right: 62, bottom: 21 }; // iPhone 17 on its side

let app = null, browser = null;
try {
  fs.mkdirSync(OUT, { recursive: true });
  app = await serveApp(URL_ARG);
  browser = await launch();
  const context = await browser.newContext(IPHONE);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const log = [];
  page.on('pageerror', e => log.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/404|favicon/.test(m.text())) log.push(`console.error: ${m.text()}`); });

  const shot = name => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const state = () => page.evaluate(() => ({
    accN, refineY, needFull, lowOK, err: $('err').textContent,
    keep: !!anchor && anchor.key === sceneKey(), anchorN: anchor && anchor.n,
  }));
  // Waits for the view to finish refining (n passes, all of them by default).
  const refined = (n = 12) => page.waitForFunction(n => accN >= n && !refineY && !needFull, n, { timeout: 300000, polling: 250 });
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });

  await page.goto(app.url, { waitUntil: 'commit' });
  await check('first load: no errors, canvas at the screen\'s own pixel density', async () => {
    await page.waitForFunction(() => typeof frame === 'function' && canvas.width > 300, null, { timeout: 120000 });
    for (const ms of [500, 3000]) { await page.waitForTimeout(ms); await shot(`01-load-${ms}ms`); }
    const s = await page.evaluate(() => ({ w: canvas.width, h: canvas.height, cw: canvas.clientWidth, ch: canvas.clientHeight, dpr: devicePixelRatio, phone: PHONE }));
    assert(s.phone, 'pointer: coarse did not match: the phone paths are not exercised');
    const k = Math.min(s.dpr, 3);
    assert(s.w === Math.round(s.cw * k) && s.h === Math.round(s.ch * k), `canvas ${s.w}×${s.h} for a ${s.cw}×${s.ch} box at ${s.dpr}×: the compositor resamples it`);
    assert(!log.length, log.join('\n'));
    return `${s.w}×${s.h} for ${s.cw}×${s.ch} CSS px at ${s.dpr}×`;
  });

  await check('refined view and thumbnails at one pixel per screen pixel', async () => {
    await refined();
    await page.waitForFunction(() => !thumbQueue.some(([, cv]) => { const r = cv.getBoundingClientRect(), s = $('looks').getBoundingClientRect(); return r.right > s.left && r.left < s.right; }), null, { timeout: 300000, polling: 500 });
    await shot('02-refined');
    const t = await page.evaluate(() => [...document.querySelectorAll('.preset canvas')].map(c => [c.width, c.height, c.clientWidth, c.clientHeight]));
    const bad = t.filter(([w, h, cw, ch]) => w !== Math.round(cw * 3) || h !== Math.round(ch * 3));
    assert(!bad.length, `${bad.length} thumbnails not at 3×: ${JSON.stringify(bad[0])}`);
    return `${t.length} thumbnails at ${t[0][0]}×${t[0][1]}`;
  });

  await check('touch: no double-tap zoom, no tap flash, no focus zoom on fields', async () => {
    const s = await page.evaluate(() => {
      const css = el => getComputedStyle(el);
      return {
        touch: css(document.documentElement).touchAction,
        flash: css(document.documentElement).webkitTapHighlightColor,
        fields: [...document.querySelectorAll('input.num, select')].map(e => [e.id || e.className, parseFloat(css(e).fontSize)]),
      };
    });
    assert(s.touch === 'manipulation', `html touch-action is ${s.touch}: double taps on the controls zoom the page`);
    assert(/rgba\(0, 0, 0, 0\)|transparent/.test(s.flash), `tap highlight ${s.flash}`);
    // Fields not built yet (capture size) are checked in capture mode below.
    const small = s.fields.filter(([, px]) => px < 16);
    assert(!small.length, `fields under 16px zoom the page on focus in iOS: ${JSON.stringify(small)}`);
    await page.evaluate(() => { const s = $('looks'); s.scrollLeft = s.scrollWidth; });
    await page.tap('.preset.add');
    await page.waitForTimeout(300);
    await shot('03-save-look-focused');
    const vv = await page.evaluate(() => [visualViewport.scale, document.activeElement.id]);
    await page.evaluate(() => { document.activeElement.blur(); $('save-row').hidden = true; });
    return `touch-action ${s.touch}; ${s.fields.length} fields ≥ 16px; focus on ${vv[1]} at scale ${vv[0]}`;
  });

  await check('hidden panel: the view takes the screen', async () => {
    await page.tap('#panel .head .icon:last-child');
    await page.waitForTimeout(200);
    await refined();
    await shot('04-panel-hidden');
    const F = await page.evaluate(() => ({ ...F }));
    assert(F.w > 300, `frame ${JSON.stringify(F)}`);
  });

  await check('one-finger drag: the finished view moves with the camera, then the new passes take over', async () => {
    const h0 = await page.evaluate(() => P.heading);
    await touch('touchStart', [[200, 500]]);
    const during = [];
    for (let i = 1; i <= 12; i++) {
      await touch('touchMove', [[200 - i * 6, 500 + i * 2]]);
      await page.waitForTimeout(40);
      if (i === 6) { await shot('05-drag-mid'); during.push(await state()); }
    }
    await page.waitForTimeout(100);
    await shot('05-drag-held');
    during.push(await state());
    await touch('touchEnd', []);
    const h1 = await page.evaluate(() => P.heading);
    assert(Math.abs(h1 - h0) > 1, `heading moved ${h1 - h0}°`);
    assert(during.every(s => s.keep && s.anchorN >= 1), `the kept view was not usable during the drag: ${JSON.stringify(during)}`);
    await page.waitForFunction(() => accN >= 1, null, { timeout: 300000, polling: 100 });
    await shot('05-release-first-pass');
    await refined();
    await shot('05-release-refined');
    return `heading ${h0.toFixed(1)}° → ${h1.toFixed(1)}°, kept view of ${during[0].anchorN} passes shown while dragging`;
  });

  await check('pinch: zooms, and shows the kept view while the fingers are down', async () => {
    const f0 = await page.evaluate(() => P.fov);
    await touch('touchStart', [[150, 450], [250, 450]]);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', [[150 - i * 8, 450], [250 + i * 8, 450]]); await page.waitForTimeout(40); }
    await page.waitForTimeout(100);
    await shot('06-pinch-held');
    const s = await state();
    await touch('touchEnd', []);
    const f1 = await page.evaluate(() => P.fov);
    assert(f1 < f0 * 0.8, `fov ${f0} → ${f1}`);
    assert(s.keep, 'kept view not used during the pinch');
    await refined();
    await shot('06-pinch-refined');
    return `fov ${f0.toFixed(1)}° → ${f1.toFixed(1)}°`;
  });

  await check('landscape: controls and frame clear of the Dynamic Island and home indicator', async () => {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: LANDSCAPE_SAFE });
    await page.evaluate(() => applyLook(PRESETS.find(p => p.name === 'Deep Navy') || PRESETS[0]));
    await page.setViewportSize({ width: 874, height: 402 });
    await page.tap('#reopen');
    await page.waitForTimeout(300);
    await refined(2);
    await shot('07-landscape');
    const r = await page.evaluate(() => {
      const box = id => { const b = $(id).getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
      return { panel: box('panel'), credit: box('credit'), bar: box('bar'), F: [F.x, F.y, F.x + F.w, F.y + F.h], vw: innerWidth, vh: innerHeight };
    });
    const { left, right, bottom } = LANDSCAPE_SAFE, problems = [];
    for (const [name, [l, t, rr, b]] of Object.entries({ panel: r.panel, credit: r.credit, bar: r.bar, frame: r.F })) {
      if (l < left || rr > r.vw - right || b > r.vh - bottom) problems.push(`${name} [${[l, t, rr, b].map(Math.round)}] crosses the safe area`);
    }
    assert(!problems.length, problems.join('\n'));
    return `panel [${r.panel.map(Math.round)}], frame [${r.F.map(Math.round)}]`;
  });

  await check('capture mode, portrait: frame and capture fields', async () => {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, right: 0, bottom: 0 } });
    await page.setViewportSize(IPHONE.viewport);
    await page.evaluate(() => setCaptureMode(true));
    await page.waitForTimeout(300);
    await refined(2);
    await shot('08-capture');
    const small = await page.evaluate(() => [...document.querySelectorAll('input.num, select')].filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.id));
    assert(!small.length, `fields under 16px: ${small.join(', ')}`);
    await page.evaluate(() => setCaptureMode(false));
  });

  await check('no errors logged during the walk', async () => {
    const s = await state();
    assert(!s.err, s.err.slice(0, 300));
    assert(!log.length, log.join('\n'));
  });
} catch (e) {
  harnessFailed(e);
} finally {
  if (browser) await browser.close();
  if (app) app.close();
}
finish(` · screenshots in ${OUT}`);
