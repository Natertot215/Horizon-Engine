'use strict';

// Looks: the built-in presets, saved looks and their thumbnails.

const PRESETS = [
  { name: 'Fuji Twilight', p: {
    sunElev: -13.5, sunHeading: 295, heading: 205, pitch: 9, fov: 70,
    ozone: 2, mie: 1.4, skyFill: 0.8,
    nightBright: 1.6, nightZenith: '#151640', nightHorizon: '#5d4f8f', nightCurve: 0.5, nightVibrance: 0.3, airglow: 0.02, lpStrength: 0,
    starDensity: 0.7, starDepth: 0.85, starBright: 0.97, starSize: 0.75, starColor: 0.3,
    surfColorA: '#0d1424', surfColorB: '#0d1424', surfWaves: 0.2,
    land: 3, landHeight: 1.7, landLayers: 2, landColor: '#11131b', forestMix: 1, forestDensity: 0.95,
    peak: 7.5, peakHeading: 205, peakWidth: 24, peakSnow: 0.42,
    fog: 0.5, fogHeight: 15, fogGlow: 0.8, fogColor: '#c3c6e8', haze: 0.45,
    ev: 0.3, tone: 1, contrast: 1.05, saturation: 1.1,
  } },
  { name: 'Ember Dusk', p: {
    sunElev: -1.2, sunHeading: 250, heading: 245, pitch: 16, fov: 75,
    ...cloudLayer(1, 'altocumulus', { Cover: 0.55, Dens: 0.9, Alt: 4.5, Thick: 0.32, Scale: 0.9, Cells: 0.9 }),
    cGlow: 1.8, cLightTint: '#ff5a2a', cLightAmt: 0.45, cShadowTint: '#1d2440', cShadowAmt: 0.6,
    surfWaves: 0.15, land: 4, landHeight: 2, landLayers: 2, landDepth: 1.6, landHeading: 245, cityLights: 0.5, landColor: '#0e1016',
    ev: -0.4, tone: 2, temp: 0.25, contrast: 1.2, saturation: 1.05,
  } },
  { name: 'Veiled Night', p: {
    sunElev: -30, heading: 160, pitch: 55, fov: 80,
    nightZenith: '#121436', nightHorizon: '#3a3260', nightBright: 1.3,
    lpStrength: 0.5, lpColor: '#b48fd0', lpFocus: 0.4,
    starDensity: 0.45, starDepth: 0.6, starBright: 0.69,
    ...cloudLayer(0, 'stratocumulus', { Cover: 0.55, Dens: 0.5, Soft: 0.6 }),
    cLP: 2.2, cAmbient: 1.2, ev: 0.3,
  } },
  { name: 'Deep Navy', p: {
    sunElev: -35, heading: 30, pitch: 75, fov: 70,
    nightZenith: '#0b1236', nightHorizon: '#1a2150', nightBright: 1.3, nightVibrance: 0.4,
    starDensity: 0.95, starDepth: 1, starBright: 0.76, starSize: 0.8, starColor: 0.3, starTint: '#c9c2ff', starTintAmt: 0.2,
    extinction: 0.3, airglow: 0, lpStrength: 0,
  } },
  { name: 'Abyss', p: {
    sunElev: -40, heading: 60, pitch: 80, fov: 65,
    nightZenith: '#03050d', nightHorizon: '#0b1024', nightBright: 1.1, nightVibrance: 0.2, airglow: 0, lpStrength: 0,
    starDensity: 0.5, starDepth: 0.95, starBright: 0.55, starSize: 0.8, starSizeVar: 0.7, starColor: 0.35,
    starTint: '#a9b8ff', starTintAmt: 0.15, extinction: 0.3, vignette: 0.25,
  } },
  { name: 'Violet Stream', p: {
    sunElev: -40, heading: 122, pitch: 72, fov: 70, roll: 40, skyRotation: 54, latitude: 30,
    nightZenith: '#0c0718', nightHorizon: '#150c26', nightBright: 1.2, nightVibrance: 0.6, airglow: 0, lpStrength: 0,
    mw: 0.9, mwWidth: 1.4, mwCore: 0.3, mwDust: 0.6, mwWarmth: 0.2, mwStars: 1.6,
    starDensity: 1, starDepth: 1, starBright: 0.97, starSize: 0.85, starColor: 0.6, starTint: '#b49cff', starTintAmt: 0.25,
    filter: '#9b7bff', filterAmt: 0.3,
  } },
  { name: 'Fire Sky', p: {
    sunElev: -1.2, sunHeading: 262, heading: 250, pitch: 14, fov: 84,
    ...cloudLayer(1, 'altocumulus', { Cover: 0.66, Dens: 0.8, Alt: 4.5, Thick: 0.4, Scale: 1.3, Billow: 0.4, Cells: 0.65, Streak: 0.15, Detail: 0.5, Soft: 0.3 }),
    ...cloudLayer(2, 'cirrus', { Cover: 0.4, Dens: 0.3 }),
    cGlow: 2, cLightTint: '#ff4a1a', cLightAmt: 0.4, cShadowTint: '#3a2a6a', cShadowAmt: 0.5,
    surfWaves: 0.12, land: 1, landHeight: 1.6, landLayers: 2, landColor: '#0e0f16',
    ev: -0.2, tone: 2, saturation: 1.1,
  } },
  { name: 'Milky Way Core', p: {
    sunElev: -30, latitude: 30, skyRotation: 120, heading: 176, pitch: 25, fov: 95, starBright: 1.47,
    mw: 1.4, mwCore: 1.4, mwDust: 0.85, mwWarmth: 0.75, mwHII: 0.6, mwCoreColor: '#ffd29a', mwArmColor: '#e0e6ff',
    starDensity: 0.85, starDepth: 1, starSizeVar: 0.5,
    nightZenith: '#0b0e22', nightHorizon: '#1d1c38',
    surfWaves: 0.12, land: 2, landHeight: 3.5, landColor: '#0b0c12',
  } },
  { name: 'Aurora Lake', p: {
    sunElev: -25, heading: 0, pitch: 14, fov: 95, starBright: 1.47,
    aurora: 1.4, auroraSpread: 0.45, starDensity: 0.85, starSizeVar: 0.5,
    surfWaves: 0.12, land: 2, landHeight: 3.5, landLayers: 2, landColor: '#0b0c12',
  } },
  { name: 'Mirror Flats', p: {
    sunElev: -2.5, sunHeading: 250, heading: 240, pitch: 6, fov: 85,
    surface: 2, surfColorA: '#ebe8e3', surfColorB: '#b6aea3', surfReflect: 0.85, surfWaves: 0.12,
    land: 1, landHeight: 1.2, landLayers: 2, landColor: '#3a3a4a',
    ...cloudLayer(2, 'cirrus', { Cover: 0.5, Dens: 0.3 }), cGlow: 1.6, cLightTint: '#ff8a5c', cLightAmt: 0.3, tone: 2,
  } },
  { name: 'Golden Fields', p: {
    sunElev: 5, sunHeading: 240, heading: 230, pitch: 2, fov: 80,
    surface: 4, surfColorA: '#b08a45', surfColorB: '#e0bd6e', surfWaves: 0.8, grassHeight: 0.9, grassWidth: 0.7, grassLean: 0.15, surfRows: 135,
    land: 3, landHeight: 1.4, landLayers: 2, landColor: '#1d2318', haze: 0.35,
    ...cloudLayer(0, 'cumulus', { Cover: 0.32 }),
  } },
  { name: 'Dune Sunset', p: {
    sunElev: 3, sunHeading: 255, heading: 225, pitch: 0, fov: 72,
    surface: 5, surfColorA: '#d9a46a', surfColorB: '#a8693a', surfWaves: 0.7, surfWind: 305, surfScale: 1.5, relief: 1.8, eyeHeight: 10,
    haze: 0.3, mie: 1.5, tone: 3, contrast: 1.15,
  } },
  { name: 'High Noon', p: {
    sunElev: 55, sunHeading: 180, heading: 200, pitch: 12, fov: 90,
    surface: 3, surfColorA: '#3a5a22', surfColorB: '#6e7d2f', surfWaves: 0.6, flowers: 0.25,
    land: 1, landHeight: 2.5, landColor: '#2d3a26', trees: 3, treeNear: 80, treeFar: 260, treeSpread: 100,
    ...cloudLayer(0, 'cumulus', {}),
  } },
  { name: 'Star Trails', p: {
    sunElev: -30, latitude: 35, heading: 0, pitch: 28, fov: 110, starBright: 1.59, trails: 75, trailDensity: 0.5,
    surface: 0, surfColorA: '#0d0e14', surfColorB: '#08090d',
    land: 3, landHeight: 2.2, landLayers: 2, landDepth: 0.4, landColor: '#0a0b10', forestMix: 1, forestDensity: 0.9,
  } },
  { name: 'Moonlit Snow', p: {
    sunElev: -30, moon: true, moonPhase: 0.5, moonElev: 30, moonHeading: 160, moonHalo: 0.8, moonLight: 3,
    heading: 160, pitch: 10, fov: 85,
    surface: 6, surfColorA: '#eef2fa', surfColorB: '#cad6ea', surfSparkle: 0.8, relief: 0.8,
    land: 2, landHeight: 5, landColor: '#4a4f5c', landSnow: 1, landDepth: 2,
  } },
  { name: 'Deep Space', p: {
    sunElev: -45, heading: 90, pitch: 89, fov: 80, starBright: 0.87,
    nightZenith: '#05030c', nightHorizon: '#05030c', airglow: 0, lpStrength: 0,
    neb: 1, nebScale: 0.55, nebWarp: 0.3, nebSeed: 6, nebA: '#e8466a', nebB: '#2a8fd0',
    mw: 0.3, starDensity: 1, starDepth: 1, starColor: 0.7, starSizeVar: 0.6,
    gal: 1.1, galSize: 14, galElev: 70, galHeading: 30,
    contrast: 1.2, lift: -0.01,
  } },
  { name: 'Ringed Giant', p: {
    sunElev: -22, heading: 200, pitch: 14, fov: 70, starBright: 0.6,
    b0On: true, b0Size: 30, b0Elev: 20, b0Heading: 200, b0Phase: 0.3, b0Light: 25, b0Lean: 14,
    starDensity: 0.8, starSizeVar: 0.5, mw: 0.6, surfWaves: 0.3,
  } },
  { name: 'Lone Tree', p: {
    sunElev: 1.5, sunHeading: 45, heading: 200, pitch: 5, fov: 55,
    trees: 1, treeHeight: 10, treeNear: 75, treeHeading: 197, treeWidth: 1.15,
    surfWaves: 0.05, land: 2, landHeight: 4.5, landLayers: 2, landColor: '#56504c', landSnow: 0.7, landDepth: 3, haze: 0.3,
    ...cloudLayer(2, 'cirrus', { Cover: 0.35, Dens: 0.25 }), cGlow: 1.4, cLightTint: '#ffb08a', cLightAmt: 0.3,
  } },
  { name: 'Wildflower Meadow', p: {
    sunElev: 6, sunHeading: 235, heading: 215, pitch: -1, fov: 70,
    surface: 3, surfColorA: '#2f4a1a', surfColorB: '#8a9a3a', flowers: 0.65, grassHeight: 0.5,
    trees: 4, treeNear: 70, treeFar: 300, treeSpread: 90, treeHeading: 205,
    land: 1, landHeight: 2, landLayers: 3, landColor: '#3b4a2a', haze: 0.35,
    ...cloudLayer(0, 'cumulus', { Cover: 0.28 }),
  } },
  { name: 'Alpine Lake', p: {
    sunElev: 9, sunHeading: 70, heading: 205, pitch: 3, fov: 65,
    surfWaves: 0.03, land: 2, landHeight: 7.5, landLayers: 2, landColor: '#5a524c', landSnow: 0.65, landDepth: 3, haze: 0.25,
  } },
  { name: 'Twin Moons', p: {
    sunElev: -10, sunHeading: 260, heading: 230, pitch: 8, fov: 70, starBright: 0.6,
    surface: 5, surfColorA: '#d8a874', surfColorB: '#5a3520', surfWind: 310, surfScale: 1.4, relief: 1.8, eyeHeight: 12,
    b0On: true, b0Type: 4, b0ColorA: '#1e4f8c', b0ColorB: '#6a7a3c', b0Atmo: 0.9, b0Ring: 0, b0Size: 20, b0Elev: 14, b0Heading: 208, b0Phase: 0.62, b0Light: -10,
    b1On: true, b1Type: 2, b1ColorA: '#c47c45', b1ColorB: '#6d3f25', b1Atmo: 0.15, b1Size: 9, b1Elev: 17, b1Heading: 250, b1Phase: 0.5, b1Light: -10,
  } },
  { name: 'Galaxy Rise', p: {
    sunElev: -25, heading: 200, pitch: 18, fov: 85,
    moon: true, moonPhase: 0.3, moonElev: 5, moonHeading: 290, moonLight: 3.5, moonGlow: 0.2,
    surface: 5, surfColorA: '#d9a46a', surfColorB: '#a8693a', surfWind: 290, surfScale: 1.4, relief: 1.8, eyeHeight: 10,
    gal: 1.3, galSize: 45, galElev: 22, galHeading: 200, galIncl: 62, galAngle: 25, mw: 0.5, starSizeVar: 0.5,
  } },
  { name: 'Ocean Glitter', p: {
    sunElev: 9, sunHeading: 200, heading: 200, pitch: 1, fov: 70,
    surface: 1, surfColorA: '#061c2a', surfColorB: '#2b8f7c', surfWaves: 1.6, surfScale: 2.6, surfMotion: 1.6,
    ...cloudLayer(0, 'cumulus', { Cover: 0.36 }), haze: 0.15, tone: 1,
  } },
  { name: 'Pine Ridge', p: {
    sunElev: 4, sunHeading: 100, heading: 130, pitch: 2, fov: 70,
    surface: 3, surfColorA: '#2f4a1a', surfColorB: '#7d8c3a', grassHeight: 0.35,
    land: 3, forestMix: 1, forestDensity: 0.95, landHeight: 6, landLayers: 4, landColor: '#16201a', landDepth: 0.6,
    fog: 0.35, fogHeight: 30, fogGlow: 0.6,
    trees: 4, treeType: 1, treeHeight: 22, treeNear: 30, treeFar: 120, treeSpread: 100, treeHeading: 140,
  } },
];

// Looks saved before v2 stored only values that differed from the defaults of the time. Before v3,
// star light grew with the field of view; v3 keeps it, so older looks get the brightness they showed.
const LEGACY = { surface: 0, surfColorA: '#1b1c21', surfColorB: '#121317', surfReflect: 0, surfWaves: 0.5 };
function starsV3(p) {
  const q = { ...DEFAULTS, ...p }, k = frameScale([2, 1], q) / STAR.ref;
  return { ...p, starBright: Math.round(clamp(q.starBright * (q.trails > 0 ? k : k * k), 0, 4) * 100) / 100 };
}
const savedLooks = store('horizon-looks');
const looks = (Array.isArray(savedLooks) ? savedLooks : []).filter(l => l && l.name && l.p)
  .map(l => l.v ? l : { name: l.name, v: 2, p: { ...LEGACY, ...l.p } })
  .map(l => l.v >= 3 ? l : { name: l.name, v: 3, p: starsV3(l.p) });

function lookParams(look) {
  return { ...DEFAULTS, ...look.p };
}

function lookActive(look) {
  return Object.entries(lookParams(look)).every(([k, v]) => P[k] === v);
}

function applyLook(look) {
  setPlaying(false);
  Object.assign(P, lookParams(look));
  rewindAnim();
  cloudSel = firstCloudLayer();
  changed();
}

function saveLook(name) {
  looks.push({ name, v: 3, p: { ...P } });
  store('horizon-looks', looks);
  buildLookStrip();
}

function deleteLook(look) {
  looks.splice(looks.indexOf(look), 1);
  store('horizon-looks', looks);
  buildLookStrip();
}

let thumbTarget = null;
const thumbQueue = []; // [look, canvas, cache key] still to draw
const THUMB_SAMPLES = 4; // a single sample per pixel leaves thumbnail edges jagged
const THUMB_QUALITY = 0.8; // ray steps, relative to the view

function renderThumb(look, cv) {
  const savedP = JSON.stringify(P), savedCloud = ANIM.cloud;
  Object.assign(P, lookParams(look));
  ANIM.cloud = cloudsAtRest();
  const w = cv.width, h = cv.height;
  thumbTarget = fitTarget(thumbTarget, w, h);
  drawSky(thumbTarget.fbo, w, h, [0, 0], 1, sceneValues([w, h]), { quality: THUMB_QUALITY, samples: THUMB_SAMPLES });
  readInto(cv.getContext('2d'), w, h);
  Object.assign(P, JSON.parse(savedP));
  ANIM.cloud = savedCloud;
}

// One thumbnail per idle frame: after the view has converged, while the strip is on screen and
// nothing is touched, cards in view first. Each new look can mean a shader compile, which on a
// phone stalls the page, so finished thumbnails are kept across visits.
function nextThumb() {
  if (!thumbQueue.length || accN < REFINE || pointers.size || C.on || !panelOpen()) return;
  const strip = $('looks').getBoundingClientRect();
  const i = thumbQueue.findIndex(([, cv]) => { const r = cv.getBoundingClientRect(); return r.right > strip.left && r.left < strip.right; });
  const [look, cv, key] = thumbQueue.splice(Math.max(0, i), 1)[0];
  renderThumb(look, cv);
  GPU.used += cv.width * cv.height * THUMB_SAMPLES;
  thumbCache.save(key, cv);
}

const hashText = text => crc32([new TextEncoder().encode(text)]).toString(36);

// Thumbnails as JPEG data URLs, keyed by this build of the app (a hash of its scripts, read back
// from the browser's cache), the size and the look. Opened from disk the scripts can't be read
// back, so thumbnails then last only the session.
const thumbCache = {
  data: (v => v && typeof v === 'object' && !Array.isArray(v) ? v : {})(store('horizon-thumbs')),
  live: new Set(), version: null, timer: 0,
  ready() {
    const session = () => Math.random().toString(36).slice(2);
    if (location.protocol === 'file:') return this.version ||= Promise.resolve(session());
    return this.version ||= Promise.all([...document.scripts].map(s => fetch(s.src).then(r => r.ok ? r.text() : Promise.reject(r.status))))
      .then(texts => hashText(texts.join('\n')), session);
  },
  key(version, look, w, h) {
    const key = `${version}:${w}x${h}:${hashText(JSON.stringify(lookParams(look)))}`;
    this.live.add(key);
    return key;
  },
  save(key, cv) {
    this.data[key] = cv.toDataURL('image/jpeg', 0.9);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      for (const k of Object.keys(this.data)) if (!this.live.has(k)) delete this.data[k];
      store('horizon-thumbs', this.data);
    }, 1000);
  },
};
