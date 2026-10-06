'use strict';

// Layout: the view, the capture frame and the controls around the screen and its safe areas.

const canvas = $('view');
const frameEl = $('frame');
const panel = $('panel');
const bar = $('bar');
const F = { x: 0, y: 0, w: 1, h: 1, cx: 0 };
const BAR_SPACE = 80;
const PANEL_SPACE = 324; // the panel's width plus its margin and gap
const NARROW = matchMedia('(max-width: 700px)'); // the phone layout in the stylesheet
const panelOpen = () => !panel.classList.contains('hidden');

// Safe-area insets in CSS pixels (notch, Dynamic Island, home indicator), read from the stylesheet.
const safeProbe = el('div', null, document.body);
safeProbe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:var(--sat) var(--sar) var(--sab) var(--sal)';
function safeArea() {
  const s = getComputedStyle(safeProbe);
  return { t: parseFloat(s.paddingTop) || 0, r: parseFloat(s.paddingRight) || 0, b: parseFloat(s.paddingBottom) || 0, l: parseFloat(s.paddingLeft) || 0 };
}

function layout() {
  // The canvas box, not innerWidth/innerHeight: iOS reports those late and with the toolbar state.
  const vw = canvas.clientWidth || innerWidth, vh = canvas.clientHeight || innerHeight, sa = safeArea();
  const open = panelOpen();
  const narrow = NARROW.matches;
  const x0 = sa.l, x1 = vw - sa.r - (open && !narrow ? PANEL_SPACE : 0);
  const y0 = sa.t + (narrow ? 56 : 0);
  const y1 = vh - sa.b - (narrow ? (open ? panel.offsetHeight + 16 : 0) : BAR_SPACE);
  const aw = x1 - x0, ah = y1 - y0;
  const [W, H] = captureDims();
  const s = Math.min((aw - 48) / W, (ah - 48) / H);
  F.w = Math.max(8, W * s);
  F.h = Math.max(8, H * s);
  F.x = x0 + (aw - F.w) / 2;
  F.y = y0 + (ah - F.h) / 2;
  F.cx = F.x + F.w / 2;
  frameEl.style.cssText = `left:${F.x}px;top:${F.y}px;width:${F.w}px;height:${F.h}px`;
  placeBar();
  invalidate();
}

// Centre the bar under the frame, but keep it on screen and clear of the credit; in capture mode,
// drop the timelapse controls, then the size readout, when space runs short.
function placeBar() {
  const vw = innerWidth, narrow = NARROW.matches, sa = safeArea();
  const right = (panelOpen() && !narrow ? vw - PANEL_SPACE : vw) - sa.r - 8;
  const left = narrow || C.on ? sa.l + 8 : $('credit').getBoundingClientRect().right + 12;
  bar.classList.remove('compact', 'tight');
  if (C.on && bar.offsetWidth > right - left) bar.classList.add('compact');
  if (C.on && bar.offsetWidth > right - left) bar.classList.add('tight');
  const half = bar.offsetWidth / 2;
  bar.style.left = clamp(F.cx, left + half, Math.max(left + half, right - half)) + 'px';
}

function cssToImage(x, y) {
  const [W, H] = captureDims();
  return [(x - F.x) * W / F.w, (y - F.y) * H / F.h];
}
