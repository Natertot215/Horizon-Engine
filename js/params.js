'use strict';

// Scene parameters: cloud and body types, the defaults, the live state P and colour helpers.

const CLOUD_TYPES = {
  cumulus: { Cover: 0.42, Dens: 1, Alt: 1.4, Thick: 1.6, Scale: 3.2, Billow: 0.85, Cells: 0, Streak: 0, Detail: 0.7, Soft: 0.2 },
  stratocumulus: { Cover: 0.62, Dens: 0.9, Alt: 1.2, Thick: 0.8, Scale: 4, Billow: 0.5, Cells: 0.3, Streak: 0.12, Detail: 0.5, Soft: 0.3 },
  altocumulus: { Cover: 0.55, Dens: 0.8, Alt: 4, Thick: 0.3, Scale: 1.6, Billow: 0.3, Cells: 0.85, Streak: 0.2, Detail: 0.4, Soft: 0.25 },
  cirrus: { Cover: 0.45, Dens: 0.35, Alt: 9, Thick: 0.35, Scale: 6, Billow: 0, Cells: 0, Streak: 0.85, Detail: 0.3, Soft: 0.8 },
  overcast: { Cover: 0.92, Dens: 0.8, Alt: 1, Thick: 1.1, Scale: 8, Billow: 0.2, Cells: 0, Streak: 0.1, Detail: 0.35, Soft: 0.6 },
  veil: { Cover: 0.85, Dens: 0.12, Alt: 8, Thick: 0.4, Scale: 10, Billow: 0, Cells: 0, Streak: 0.4, Detail: 0.1, Soft: 1 },
};

function cloudLayer(i, type, extra = {}) {
  const out = {};
  const base = { On: true, ...CLOUD_TYPES[type], Vary: 0.6, Wind: 70 + i * 25, Speed: 12 + i * 8, Morph: 0.4, Seed: i * 3 + 1, ...extra };
  for (const [k, v] of Object.entries(base)) out[`c${i}${k}`] = v;
  return out;
}

// Planets and moons: two slots, each one of these kinds (colours and atmosphere per kind).
const BODY_TYPES = [
  ['Gas Giant', { ColorA: '#e3c7a0', ColorB: '#9c6a44', Atmo: 0.35 }],
  ['Ice Giant', { ColorA: '#aedfea', ColorB: '#5e9ec4', Atmo: 0.6 }],
  ['Rocky', { ColorA: '#c47c45', ColorB: '#6d3f25', Atmo: 0.15 }],
  ['Moon', { ColorA: '#bdbab4', ColorB: '#5f5c58', Atmo: 0 }],
  ['Ocean World', { ColorA: '#1e4f8c', ColorB: '#6a7a3c', Atmo: 0.8 }],
  ['Lava World', { ColorA: '#1d1612', ColorB: '#ff6a1f', Atmo: 0.2 }],
];

function bodySlot(i, type, extra = {}) {
  const out = {};
  const base = {
    On: false, Type: type, Size: 14, Elev: 20, Heading: 200, Phase: 0.3, Light: 30, Roll: 12, Lean: 16, Bright: 1,
    Ring: 0, RingIn: 1.35, RingOut: 2.3, RingColor: '#d9c7a6', Seed: i * 3 + 1, ...BODY_TYPES[type][1], ...extra,
  };
  for (const [k, v] of Object.entries(base)) out[`b${i}${k}`] = v;
  return out;
}

const BAND_STYLES = [
  ['Natural', { mwCoreColor: '#ffdfbc', mwArmColor: '#d5e5ff', mwWarmth: 0.55, mwDust: 0.85, mwHII: 0.4 }],
  ['Golden', { mwCoreColor: '#ffc37a', mwArmColor: '#ffe6c4', mwWarmth: 0.9, mwDust: 1, mwHII: 0.25 }],
  ['Arctic', { mwCoreColor: '#dfeaff', mwArmColor: '#8fb6ff', mwWarmth: 0.35, mwDust: 0.7, mwHII: 0.1 }],
  ['Violet', { mwCoreColor: '#ffbde9', mwArmColor: '#a493ff', mwWarmth: 0.5, mwDust: 0.8, mwHII: 0.8 }],
  ['Rose', { mwCoreColor: '#ffc9b0', mwArmColor: '#ffa6cf', mwWarmth: 0.6, mwDust: 0.9, mwHII: 1.3 }],
  ['Emerald', { mwCoreColor: '#eaffbd', mwArmColor: '#78e3c6', mwWarmth: 0.5, mwDust: 0.8, mwHII: 0.2 }],
];

const DEFAULTS = {
  sunElev: 8, sunHeading: 200, sunDisk: true, sunSize: 1, sunGlow: 0.5, sunIntensity: 1,
  rayleigh: 1, mie: 1, mieG: 0.8, ozone: 1, skyFill: 0.5,
  nightBright: 1, nightZenith: '#0a0e2a', nightHorizon: '#2b2550', nightCurve: 0.35, nightVibrance: 0,
  lpStrength: 0.12, lpColor: '#c98a6a', lpHeading: 20, lpFocus: 0.5, lpHeight: 0.12,
  airglow: 0.06, airglowColor: '#4f8a5e',
  surface: 1, eyeHeight: 2, surfScale: 1, surfColorA: '#0a1820', surfColorB: '#1f5a4e', surfWaves: 0.35, surfReflect: 1,
  surfWind: 60, surfSparkle: 0.5, surfMotion: 1, surfRows: 65, surfFoam: 0.5,
  grassHeight: 0.45, grassDensity: 1, grassWidth: 1, grassLean: 0.5, grassDry: 0.15, flowers: 0, flowerColor: '#f4e7a1',
  relief: 1,
  trees: 0, treeType: 0, treeHeight: 14, treeNear: 30, treeFar: 140, treeHeading: 200, treeSpread: 70, treeSeed: 1,
  treeColor: '#3d5a24', treeAutumn: 0, treeFoliage: 1, treeWidth: 1,
  land: 0, landHeight: 3, landRough: 0.5, landLayers: 2, landDepth: 1, landHeading: 0, landSeed: 1,
  landColor: '#2a2d36', cityLights: 0.5, cityColor: '#ffbe76', landSnow: 0, forestMix: 0.6, forestDensity: 0.85,
  peak: 0, peakHeading: 200, peakWidth: 14, peakSnow: 0.35,
  fog: 0, fogHeight: 40, fogGlow: 0.3, fogColor: '#c9cfe0', haze: 0.35,
  motionSky: true, motionClouds: true, windMul: 1, morphMul: 1, twinkle: 0.3, auroraSpeed: 1,
  aurora: 0, auroraHeight: 1, auroraHeading: 0, auroraSpread: 0.5, auroraA: '#3dff9a', auroraB: '#c04dff',

  stars: true, starDensity: 0.6, starDepth: 0.85, starBright: 1, starSize: 1, starSizeVar: 0.35, starColor: 0.5, starWarmth: 0,
  starTint: '#b9c6ff', starTintAmt: 0, starGlow: 0.3, extinction: 0.8, starSeed: 1,
  spikes: 0, spikeAngle: 45, spikeLength: 1, trails: 0, trailDensity: 0.5,
  latitude: 35, skyRotation: 270,
  mw: 0, mwWidth: 1, mwCore: 0.8, mwDust: 0.8, mwWarmth: 0.5, mwStars: 0.8, mwSeed: 0,
  mwTilt: 0, mwHII: 0.4, mwCoreColor: '#ffdfbc', mwArmColor: '#d5e5ff',
  neb: 0, nebA: '#ff4f8b', nebB: '#3d6bff', nebScale: 1, nebWarp: 0.5, nebSeed: 1,
  meteors: 0, meteorBright: 1, meteorLength: 12, meteorHeading: 60, meteorSeed: 1,
  moon: false, moonPhase: 0.5, moonElev: 25, moonHeading: 140, moonSize: 1, moonBright: 1, moonGlow: 0.4,
  moonHalo: 0, earthshine: 0.3, moonLight: 1, moonTilt: 0,
  ...bodySlot(0, 0, { Ring: 0.85 }),
  ...bodySlot(1, 3, { Size: 3, Elev: 34, Heading: 235, Phase: 0.42, Light: -25, Roll: 0, Lean: 0 }),
  gal: 0, galSize: 16, galElev: 38, galHeading: 165, galIncl: 62, galAngle: 28, galArms: 2, galTwist: 2.4, galSeed: 1,
  galCore: '#ffe2b8', galArm: '#a6bdff',

  ...cloudLayer(0, 'cumulus', { On: false }),
  ...cloudLayer(1, 'altocumulus', { On: false }),
  ...cloudLayer(2, 'cirrus', { On: false }),
  cLightTint: '#ffb27a', cLightAmt: 0, cShadowTint: '#5b62b0', cShadowAmt: 0,
  cSilver: 0.6, cAmbient: 1, cGlow: 0.6, cBright: 1, cFade: 0.5, cLP: 1, cQuality: 1,

  proj: 0, heading: 200, pitch: 12, roll: 0, fov: 84,
  vignette: 0.12, grain: 0, grainSize: 1,

  ev: 0, tone: 0, temp: 0, tint: 0, contrast: 1, saturation: 1, vibrance: 0, hue: 0, lift: 0,
  shadowTint: '#2c3f9a', shadowAmt: 0, highTint: '#ffae6b', highAmt: 0, filter: '#9a86ff', filterAmt: 0,
};
const P = { ...DEFAULTS };

// Stars: their light is set at the angular scale of the default 84° lens (STAR.ref, where a star's
// light spreads like a blur of STAR.energy of the frame); they are drawn at STAR.draw of the frame,
// so they read as points, and zooming in past STAR.zoom× makes them bigger rather than brighter.
const STAR = { ref: 2 * Math.tan(42 * DEG), energy: 4e-4, draw: 2.4e-4, zoom: 2 };

// The frame's angular scale: the angle per image pixel at its centre times the image diagonal.
function frameScale([W, H], p = P) {
  const half = p.fov * DEG / 2;
  return [2 * Math.tan(half), 2 * half, 4 * Math.tan(half / 2), Math.hypot(W, H) * TAU / W][p.proj];
}

const PROJECTIONS = [
  { title: 'Lens', min: 4, max: 150 },
  { title: 'Fisheye', min: 30, max: 360 },
  { title: 'Dome', min: 30, max: 330 },
  { title: '360°', min: 360, max: 360 },
];

const TONES = ['Soft', 'Natural', 'Vivid', 'Filmic'];

const SURFACES = [
  ['Water', 1, { surfColorA: '#0a1820', surfColorB: '#1f5a4e', surfReflect: 1, surfWaves: 0.35, surfScale: 1, surfMotion: 1 }],
  ['Ocean', 1, { surfColorA: '#061c2a', surfColorB: '#2b8f7c', surfReflect: 1, surfWaves: 1.6, surfScale: 2.6, surfMotion: 1.6 }],
  ['Plain', 0, { surfColorA: '#1b1c21', surfColorB: '#121317', surfReflect: 0, surfWaves: 0.5, surfScale: 1 }],
  ['Salt Flat', 2, { surfColorA: '#ebe8e3', surfColorB: '#b6aea3', surfReflect: 0.85, surfWaves: 0.12, surfScale: 1 }],
  ['Grass', 3, { surfColorA: '#2f4a1a', surfColorB: '#8a9a3a', surfReflect: 0, surfWaves: 0.6, surfScale: 1, grassHeight: 0.45, grassWidth: 1, grassLean: 0.5 }],
  ['Wheat', 4, { surfColorA: '#b08a45', surfColorB: '#e0bd6e', surfReflect: 0, surfWaves: 0.8, surfScale: 1, grassHeight: 0.9, grassWidth: 0.7, grassLean: 0.15 }],
  ['Desert', 5, { surfColorA: '#d9a46a', surfColorB: '#a8693a', surfReflect: 0, surfWaves: 0.7, surfScale: 1, relief: 1 }],
  ['Snow', 6, { surfColorA: '#eef2fa', surfColorB: '#cad6ea', surfReflect: 0, surfWaves: 0.5, surfScale: 1, surfSparkle: 0.6, relief: 0.7 }],
  ['Rock', 7, { surfColorA: '#4b4743', surfColorB: '#2b2927', surfReflect: 0, surfWaves: 0.5, surfScale: 1, relief: 0.8 }],
];

const LANDS = [['None', 0], ['Hills', 2.5], ['Mountains', 5], ['Forest', 1.2], ['City', 2]];

function hexSRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

function hexLinear(hex) {
  return hexSRGB(hex).map(c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
}

// Rec. 709 luminance of a linear colour.
function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function saturate(rgb, amount) {
  const l = luma(...rgb);
  return rgb.map(c => Math.max(0, l + (c - l) * (1 + amount)));
}

function skyVector(elev, heading) {
  const e = elev * DEG, h = heading * DEG;
  return [Math.cos(e) * Math.sin(h), Math.sin(e), Math.cos(e) * Math.cos(h)];
}

function moonPhaseName(p) {
  const names = ['New', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent', 'New'];
  return names[Math.round(p * 8)] + ` · ${Math.round((1 - Math.cos(p * TAU)) * 50)}%`;
}

function sunPhase(elev) {
  if (elev < -18) return 'Night';
  if (elev < -12) return 'Astronomical Twilight';
  if (elev < -6) return 'Nautical Twilight';
  if (elev < -4) return 'Blue Hour';
  if (elev < 0) return 'Civil Twilight';
  if (elev < 6) return 'Golden Hour';
  return 'Daylight';
}

function whiteBalance() {
  const t = P.temp, g = P.tint;
  const wb = [1 + 0.32 * t, 1 - 0.12 * g, 1 - 0.32 * t];
  const l = luma(...wb);
  return wb.map(c => c / l);
}
