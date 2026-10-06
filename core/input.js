'use strict';

// Input: dragging and pinching the view, placing the sun, keys.

const pointers = new Map();

function radPerCss() {
  return P.proj === 3 ? TAU / F.w : P.fov * DEG / Math.hypot(F.w, F.h);
}

// Option-drag (Alt-drag) puts the sun under the pointer.
let placing = false;

function placeSun(e) {
  const v = dirAtImage(...cssToImage(e.clientX, e.clientY));
  setSkyVector(v, 'sunElev', 'sunHeading');
  P.sunElev = clamp(P.sunElev, -24, 72);
  changed();
}

canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  if (e.altKey && !pointers.size) { placing = true; placeSun(e); return; }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.classList.add('drag');
});
canvas.addEventListener('pointermove', e => {
  if (C.on && C.loupe && e.pointerType === 'mouse') { loupeAt = [e.clientX, e.clientY]; queueLoupe(); }
  if (placing) { placeSun(e); return; }
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  if (pointers.size === 1) {
    const k = radPerCss() / DEG;
    P.heading = ((P.heading - (e.clientX - prev.x) * k) % 360 + 360) % 360;
    if (P.proj !== 3) P.pitch = clamp(P.pitch + (e.clientY - prev.y) * k, -90, 90);
  } else if (pointers.size === 2) {
    const other = [...pointers].find(([id]) => id !== e.pointerId)[1];
    const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
    const d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
    if (d0 > 0 && d1 > 0) zoom(d0 / d1);
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  changed();
});
canvas.addEventListener('lostpointercapture', e => {
  placing = false;
  pointers.delete(e.pointerId);
  if (!pointers.size) canvas.classList.remove('drag');
});
for (const type of ['keydown', 'keyup']) window.addEventListener(type, e => canvas.classList.toggle('place', e.altKey));
window.addEventListener('blur', () => canvas.classList.remove('place'));
canvas.addEventListener('pointerleave', () => { loupeAt = null; queueLoupe(); });

function zoom(f) {
  const r = PROJECTIONS[P.proj];
  P.fov = clamp(P.fov * f, r.min, r.max);
}

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  zoom(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  changed();
}, { passive: false });
let pinchFrom = 0;
canvas.addEventListener('gesturestart', e => { e.preventDefault(); pinchFrom = P.fov; });
canvas.addEventListener('gesturechange', e => {
  e.preventDefault();
  if (pointers.size < 2) { zoom(pinchFrom / e.scale / P.fov); changed(); }
});
// A lost GPU context (iOS drops them for background tabs and under memory pressure) can't be rebuilt
// in place, so the page reloads into the same scene, unless it already did so moments ago.
canvas.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  let last = 0;
  try { last = +sessionStorage.getItem('horizon-reloaded') || 0; } catch {}
  if (Date.now() - last < 15000) { fail('The GPU context was lost. Reload the page to continue.'); return; }
  try {
    sessionStorage.setItem('horizon-resume', JSON.stringify({ P, tab, capture: C.on, panel: panelOpen() }));
    sessionStorage.setItem('horizon-reloaded', String(Date.now()));
  } catch {}
  const reload = () => { if (!document.hidden) location.reload(); };
  document.addEventListener('visibilitychange', reload);
  reload();
});

window.addEventListener('keydown', e => {
  if (job) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.target.matches('input:not([type=range], [type=color]), select')) {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.matches('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if (k === 'h') setPanel(!panelOpen());
  else if (k === 'c') setCaptureMode(!C.on);
  else if (k === 'l' && C.on) toggleLoupe();
  else if (k === ' ') { e.preventDefault(); setPlaying(!ANIM.playing); }
  else if (k === '[' || k === ']') setRate(RATES[clamp(rateIndex() + (k === ']' ? 1 : -1), 0, RATES.length - 1)][0]);
  else if (k === 'escape') { if ($('sheet').classList.contains('on')) closeSheet(); else if (C.on) setCaptureMode(false); }
});
window.addEventListener('resize', layout);
// The canvas box drives layout (iOS can fire resize before the new size settles) and, where the
// browser reports it, the exact device-pixel size of the canvas.
try {
  new ResizeObserver(([e]) => {
    const d = e.devicePixelContentBoxSize && e.devicePixelContentBoxSize[0];
    devSize = d ? [d.inlineSize, d.blockSize] : null;
    layout();
  }).observe(canvas, { box: 'device-pixel-content-box' });
} catch {
  new ResizeObserver(() => layout()).observe(canvas);
}
