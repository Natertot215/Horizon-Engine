'use strict';

// The frame loop and start-up.

let statT = 0, uiT = 0, lastFrame = performance.now(), fps = 60;
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!job) {
    resizeCanvas();
    // The timelapse keeps real time even on frames the GPU is too busy to draw.
    if (ANIM.playing) { advance(dt); lowOK = false; }
    if (gpuIdle()) {
      GPU.used = 0;
      if (ANIM.playing) {
        renderView(previewScale(), 0.75);
        fps += (1 / Math.max(dt, 1e-3) - fps) * 0.1;
        needFull = true;
        needLow = false;
        if (now - uiT > 150) { syncUI(); uiT = now; }
      } else {
        const settling = now - lastChange < 150;
        if (needLow && settling) { renderView(previewScale(), 0.6); needLow = false; }
        else if (needFull && !settling) { refineView(0); needFull = needLow = false; }
        else if (refineY && !settling) refineView(refineK);
        else if (accN > 0 && accN < REFINE && !settling) refineView(accN);
        else if (!settling) nextThumb();
      }
      if (GPU.used) gpuFence();
    }
    if (now - statT > 250) {
      statEl.textContent = ANIM.playing ? `${Math.round(fps)} fps` : accN ? `${accN} spp` : '';
      statT = now;
    }
  }
  requestAnimationFrame(frame);
}

// Back from a reload after a lost GPU context: the same scene, panel and mode.
const resume = (() => { try { const r = JSON.parse(sessionStorage.getItem('horizon-resume')); sessionStorage.removeItem('horizon-resume'); return r; } catch { return null; } })();
if (resume && resume.P) {
  Object.assign(P, resume.P);
  cloudSel = firstCloudLayer();
  if (typeof resume.tab === 'string') tab = resume.tab;
}
buildUI();
if (resume) {
  if (resume.panel === false) setPanel(false);
  if (resume.capture) setCaptureMode(true);
}
layout();
history.base = JSON.stringify(P);
if (DIAG) runDiag();
else requestAnimationFrame(frame);
