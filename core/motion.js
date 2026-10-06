'use strict';

// Motion: the timelapse clock and what it moves.

const RATES = [[1, 'Real'], [60, '1 min/s'], [600, '10 min/s'], [3600, '1 h/s'], [10800, '3 h/s']];
Object.assign(ANIM, { playing: false, reverse: false, rate: 600, elapsed: 0, origin: null }, store('horizon-motion'));
ANIM.playing = false;

function rotateAboutPole(v, deg) {
  const phi = P.latitude * DEG, k = [0, Math.sin(phi), Math.cos(phi)], a = deg * DEG;
  const c = Math.cos(a), s = Math.sin(a), kv = v3.dot(k, v);
  const kx = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [0, 1, 2].map(i => v[i] * c + kx[i] * s + k[i] * kv * (1 - c));
}

function setSkyVector(v, elevKey, headKey) {
  P[elevKey] = Math.asin(clamp(v[1], -1, 1)) / DEG;
  P[headKey] = (Math.atan2(v[0], v[2]) / DEG + 360) % 360;
}

function advance(dtReal) {
  const dt = dtReal * ANIM.rate * (ANIM.reverse ? -1 : 1);
  ANIM.time += dt;
  ANIM.elapsed += dt;
  ANIM.micro += dtReal * Math.min(ANIM.rate, 4);
  if (P.motionSky) {
    const h = dt / 3600;
    const turn = (elevKey, headKey, deg) => setSkyVector(rotateAboutPole(skyVector(P[elevKey], P[headKey]), deg), elevKey, headKey);
    turn('sunElev', 'sunHeading', 15 * h);
    turn('moonElev', 'moonHeading', 14.49 * h);
    for (const i of [0, 1]) if (P[`b${i}On`]) turn(`b${i}Elev`, `b${i}Heading`, 15 * h);
    if (P.gal > 0) turn('galElev', 'galHeading', 15.041 * h);
    P.skyRotation = ((P.skyRotation + 15.041 * h) % 360 + 360) % 360;
  }
  if (P.motionClouds) {
    for (let i = 0; i < 3; i++) {
      const w = P[`c${i}Wind`] * DEG, ds = P[`c${i}Speed`] * P.windMul * dt / 1000;
      ANIM.cloud[i][0] -= Math.sin(w) * ds;
      ANIM.cloud[i][1] -= Math.cos(w) * ds;
      ANIM.cloud[i][2] += P[`c${i}Morph`] * P.morphMul * dt / 3600;
    }
  }
}

// What the timelapse moves, as it stood when play started: Reset Time puts it back.
const ORIGIN_KEYS = ['sunElev', 'sunHeading', 'moonElev', 'moonHeading', 'skyRotation', 'b0Elev', 'b0Heading', 'b1Elev', 'b1Heading', 'galElev', 'galHeading'];
const skyOrigin = () => Object.fromEntries(ORIGIN_KEYS.map(k => [k, P[k]]));

// Back to the start of the timelapse, with `origin` as the point to return to.
function rewindAnim(origin = null) {
  Object.assign(ANIM, { time: 0, micro: 0, elapsed: 0, origin, cloud: cloudsAtRest() });
}

function setPlaying(on) {
  if (on === ANIM.playing) return;
  if (on && !ANIM.origin) ANIM.origin = skyOrigin();
  ANIM.playing = on;
  if (!on) commitSoon();
  const shown = lowOK;
  invalidate();
  // Stopping changes nothing on screen: the last timelapse frame stays until the full view is ready.
  if (!on && shown) { needLow = false; lowOK = true; }
  syncUI();
}

function resetTime() {
  if (ANIM.origin) Object.assign(P, ANIM.origin);
  rewindAnim(ANIM.playing ? skyOrigin() : null);
  changed();
}

function setRate(rate) {
  ANIM.rate = rate;
  store('horizon-motion', { rate });
  syncUI();
}

const rateIndex = () => RATES.findIndex(([r]) => r === ANIM.rate);

function rateLabel() {
  return (RATES[rateIndex()] || RATES[2])[1];
}

function elapsedLabel() {
  const t = Math.abs(ANIM.elapsed), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = Math.floor(t) % 60;
  return (ANIM.elapsed < 0 ? '−' : '+') + (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`) + (h ? ' h' : '');
}
