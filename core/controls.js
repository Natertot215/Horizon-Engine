'use strict';

// The control panel: tabs, sections and controls, undo and redo, the look strip.

// The cloud layer and body the "c#" and "b#" controls edit.
let cloudSel = 0, bodySel = 0;
const resolveKey = key => key.startsWith('b#') ? `b${bodySel}${key.slice(2)}` : key.replace('#', cloudSel);
function firstCloudLayer() {
  return [0, 1, 2].find(i => P[`c${i}On`]) ?? 0;
}
const fmt = d => v => v.toFixed(d);
const km = v => v.toFixed(2) + ' km';
const layerOn = () => P[resolveKey('c#On')];
const bodyOn = () => P[resolveKey('b#On')];
const deg = v => v.toFixed(0) + '°';
const grassy = () => P.surface === 3 || P.surface === 4;
const pct = v => Math.round(v * 100) + '%';
const signed = d => v => (v > 0 ? '+' : '') + v.toFixed(d);

const ICONS = {
  sky: '<circle cx="8" cy="8" r="2.6"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
  stars: '<path d="M8 1.8l1.6 4.6L14.2 8l-4.6 1.6L8 14.2l-1.6-4.6L1.8 8l4.6-1.6z"/>',
  night: '<path d="M12.8 10.2A5.6 5.6 0 0 1 5.8 3.2a5.6 5.6 0 1 0 7 7z"/>',
  motion: '<path d="M2 8h3l2-4.5 2.5 9L11.5 8H14"/>',
  land: '<path d="M1.5 12.5l4.2-6.5 3 4.2 1.8-2.4 4 4.7z"/><path d="M1.5 14.5h13"/>',
  clouds: '<path d="M4.5 12.5h7.2a2.8 2.8 0 0 0 .3-5.6 4 4 0 0 0-7.7-.6A3.1 3.1 0 0 0 4.5 12.5z"/>',
  space: '<circle cx="8" cy="8" r="3.4"/><path d="M1.6 10.9c-.7-1.3 2.3-3.4 6.2-4.6s7.4-1.2 7.9.1-1.8 2.2-4.1 3.1"/>',
  color: '<path d="M8 2.2c2.6 3.1 4 5.2 4 7.1a4 4 0 0 1-8 0c0-1.9 1.4-4 4-7.1z"/>',
};

const TABS = [
  { id: 'sky', label: 'Sky', sections: [
    ['Sun & Time', [
      { key: 'sunElev', label: 'Time of Day', min: -24, max: 72, step: 0.1, fmt: v => `${sunPhase(v)} · ${v.toFixed(1)}°` },
      { key: 'sunHeading', label: 'Sun Heading', min: 0, max: 360, step: 0.5, fmt: deg },
      { key: 'sunIntensity', label: 'Sunlight', min: 0.1, max: 3, step: 0.01, fmt: fmt(2) },
      { key: 'sunDisk', label: 'Sun Disk', type: 'toggle' },
      { key: 'sunSize', label: 'Disk Size', min: 0.5, max: 8, step: 0.05, fmt: v => v.toFixed(2) + '×', when: () => P.sunDisk },
      { key: 'sunGlow', label: 'Lens Glow', min: 0, max: 3, step: 0.01, fmt: fmt(2) },
      { type: 'custom', build: body => { el('div', 'note', body, 'Option-drag (Alt-drag) the sky to place the sun.'); } },
    ]],
    ['Atmosphere', [
      { key: 'rayleigh', label: 'Air Density', min: 0.2, max: 3, step: 0.01, fmt: fmt(2) },
      { key: 'mie', label: 'Haze', min: 0, max: 12, step: 0.05, fmt: fmt(2) },
      { key: 'mieG', label: 'Halo Focus', min: 0.5, max: 0.96, step: 0.005, fmt: fmt(3) },
      { key: 'ozone', label: 'Ozone', min: 0, max: 4, step: 0.01, fmt: fmt(2) },
      { key: 'skyFill', label: 'Sky Fill', min: 0, max: 2, step: 0.01, fmt: fmt(2) },
    ]],
    ['Night Sky', [
      { key: 'nightBright', label: 'Brightness', min: 0, max: 4, step: 0.01, fmt: fmt(2) },
      { key: 'nightZenith', label: 'Zenith', type: 'color' },
      { key: 'nightHorizon', label: 'Horizon', type: 'color' },
      { key: 'nightCurve', label: 'Horizon Hug', min: 0, max: 1, step: 0.01, fmt: fmt(2) },
      { key: 'nightVibrance', label: 'Vibrancy', min: -1, max: 2, step: 0.01, fmt: signed(2) },
    ]],
    ['Light Pollution', [
      { key: 'lpStrength', label: 'Strength', color: 'lpColor', min: 0, max: 2, step: 0.01, fmt: fmt(2) },
      { key: 'lpHeading', label: 'Heading', min: 0, max: 360, step: 0.5, fmt: deg },
      { key: 'lpFocus', label: 'Directional', min: 0, max: 1, step: 0.01, fmt: pct },
      { key: 'lpHeight', label: 'Dome Height', min: 0.02, max: 0.6, step: 0.005, fmt: fmt(2) },
      { key: 'airglow', label: 'Airglow', color: 'airglowColor', min: 0, max: 1, step: 0.01, fmt: fmt(2) },
    ]],
  ]},
  { id: 'clouds', label: 'Clouds', sections: [
    ['Layers', [
      { type: 'custom', build: buildLayerPicker },
      { key: 'c#On', label: 'Layer Enabled', type: 'toggle' },
      { type: 'custom', build: buildCloudTypes },
    ]],
    ['Shape', [
      { key: 'c#Cover', label: 'Coverage', min: 0, max: 1, step: 0.005, fmt: pct, when: layerOn },
      { key: 'c#Vary', label: 'Variation', min: 0, max: 1, step: 0.01, fmt: pct, when: layerOn },
      { key: 'c#Dens', label: 'Density', min: 0.02, max: 2, step: 0.01, fmt: fmt(2), when: layerOn },
      { key: 'c#Scale', label: 'Scale', min: 0.3, max: 20, step: 0.05, fmt: km, when: layerOn },
      { key: 'c#Billow', label: 'Billow', min: 0, max: 1, step: 0.01, fmt: fmt(2), when: layerOn },
      { key: 'c#Cells', label: 'Ripples', min: 0, max: 1, step: 0.01, fmt: fmt(2), when: layerOn },
      { key: 'c#Streak', label: 'Streaks', min: 0, max: 1, step: 0.01, fmt: fmt(2), when: layerOn },
      { key: 'c#Detail', label: 'Detail', min: 0, max: 1, step: 0.01, fmt: fmt(2), when: layerOn },
      { key: 'c#Soft', label: 'Softness', min: 0, max: 1, step: 0.01, fmt: fmt(2), when: layerOn },
      { key: 'c#Seed', label: 'Pattern', min: 0, max: 50, step: 0.1, fmt: fmt(1), when: layerOn },
    ]],
    ['Placement & Wind', [
      { key: 'c#Alt', label: 'Altitude', min: 0.3, max: 12, step: 0.05, fmt: km, when: layerOn },
      { key: 'c#Thick', label: 'Thickness', min: 0.05, max: 4, step: 0.01, fmt: km, when: layerOn },
      { key: 'c#Wind', label: 'Wind Direction', min: 0, max: 360, step: 1, fmt: deg, when: layerOn },
      { key: 'c#Speed', label: 'Wind Speed', min: 0, max: 60, step: 0.5, fmt: v => v.toFixed(1) + ' m/s', when: layerOn },
      { key: 'c#Morph', label: 'Evolution', min: 0, max: 3, step: 0.01, fmt: fmt(2), when: layerOn },
    ]],
    ['Lighting', [
      { key: 'cBright', label: 'Brightness', min: 0, max: 3, step: 0.01, fmt: fmt(2) },
      { key: 'cAmbient', label: 'Ambient Fill', min: 0, max: 3, step: 0.01, fmt: fmt(2) },
      { key: 'cSilver', label: 'Silver Lining', min: 0, max: 1, step: 0.01, fmt: fmt(2) },
      { key: 'cGlow', label: 'Sunset Glow', min: 0, max: 3, step: 0.01, fmt: fmt(2) },
      { key: 'cLightAmt', label: 'Light Tint', color: 'cLightTint', min: 0, max: 1, step: 0.01, fmt: fmt(2) },
      { key: 'cShadowAmt', label: 'Shadow Tint', color: 'cShadowTint', min: 0, max: 1, step: 0.01, fmt: fmt(2) },
      { key: 'cLP', label: 'City Underglow', min: 0, max: 4, step: 0.01, fmt: fmt(2) },
      { key: 'cFade', label: 'Distance Haze', min: 0, max: 1, step: 0.01, fmt: fmt(2) },
      { key: 'cQuality', label: 'Ray Steps', min: 0.5, max: 2.5, step: 0.05, fmt: v => v.toFixed(2) + '×' },
    ]],
  ]},
  { id: 'stars', label: 'Stars', sections: [
    ['Stars', [
      { key: 'stars', label: 'Stars', type: 'toggle' },
      { key: 'starDensity', label: 'Density', min: 0, max: 1, step: 0.01, fmt: pct, when: () => P.stars },
      { key: 'starDepth', label: 'Depth', min: 0.15, max: 1, step: 0.01, fmt: pct, when: () => P.stars },
      { key: 'starBright', label: 'Brightness', min: 0, max: 4, step: 0.01, fmt: fmt(2), when: () => P.stars },
      { key: 'starSize', label: 'Size', min: 0.3, max: 4, step: 0.01, fmt: fmt(2), when: () => P.stars },
      { key: 'starSizeVar', label: 'Size Variation', min: 0, max: 1, step: 0.01, fmt: pct, when: () => P.stars },
      { key: 'starGlow', label: 'Bright Star Glow', min: 0, max: 2, step: 0.01, fmt: fmt(2), when: () => P.stars },
      { key: 'starColor', label: 'Color', min: 0, max: 1.5, step: 0.01, fmt: fmt(2), when: () => P.stars },
      { key: 'starWarmth', label: 'Warmth', min: -1, max: 1, step: 0.01, fmt: signed(2), when: () => P.stars },
      { key: 'starTintAmt', label: 'Tint', color: 'starTint', min: 0, max: 1, step: 0.01, fmt: fmt(2), when: () => P.stars },
      { key: 'extinction', label: 'Horizon Fade', min: 0, max: 1, step: 0.01, fmt: fmt(2), when: () => P.stars },
    ]],
    ['Diffraction & Trails', [
      { key: 'spikes', label: 'Diffraction Spikes', min: 0, max: 2, step: 0.01, fmt: fmt(2) },
      { key: 'spikeLength', label: 'Spike Length', min: 0.2, max: 3, step: 0.01, fmt: fmt(2), when: () => P.spikes > 0 },
      { key: 'spikeAngle', label: 'Spike Angle', min: 0, max: 90, step: 0.5, fmt: deg, when: () => P.spikes > 0 },
      { key: 'trails', label: 'Star Trails', min: 0, max: 360, step: 1, fmt: v => v ? deg(v) : 'Off' },
      { key: 'trailDensity', label: 'Trail Density', min: 0.05, max: 1, step: 0.01, fmt: pct, when: () => P.trails > 0 },
    ]],
    ['Celestial Sphere', [
      { key: 'latitude', label: 'Latitude', min: -90, max: 90, step: 0.5, fmt: v => `${Math.abs(v).toFixed(1)}° ${v >= 0 ? 'N' : 'S'}` },
      { key: 'skyRotation', label: 'Sky Rotation', min: 0, max: 360, step: 0.5, fmt: deg },
      { key: 'starSeed', label: 'Star Pattern', min: 1, max: 99, step: 1, fmt: fmt(0) },
    ]],
  ]},
  { id: 'space', label: 'Space', sections: [
    ['Milky Way', [
      { key: 'mw', label: 'Brightness', min: 0, max: 3, step: 0.01, fmt: v => v ? v.toFixed(2) : 'Off' },
      { type: 'custom', build: buildBandStyles },
      { key: 'mwTilt', label: 'Band Tilt', min: -90, max: 90, step: 0.5, fmt: deg, when: () => P.mw > 0 },
      { key: 'mwWidth', label: 'Width', min: 0.4, max: 2.5, step: 0.01, fmt: fmt(2), when: () => P.mw > 0 },
      { key: 'mwCore', label: 'Core', min: 0, max: 3, step: 0.01, fmt: fmt(2), when: () => P.mw > 0 },
      { key: 'mwDust', label: 'Dust Lanes', min: 0, max: 1.5, step: 0.01, fmt: fmt(2), when: () => P.mw > 0 },
      { key: 'mwHII', label: 'Glowing Knots', min: 0, max: 2, step: 0.01, fmt: fmt(2), when: () => P.mw > 0 },
      { key: 'mwStars', label: 'Star Clouds', min: 0, max: 3, step: 0.01, fmt: fmt(2), when: () => P.mw > 0 },
      { key: 'mwWarmth', label: 'Core Blend', min: 0, max: 1, step: 0.01, fmt: fmt(2), when: () => P.mw > 0 },
      { key: 'mwCoreColor', label: 'Core Color', type: 'color', when: () => P.mw > 0 },
      { key: 'mwArmColor', label: 'Arm Color', type: 'color', when: () => P.mw > 0 },
      { key: 'mwSeed', label: 'Structure', min: 0, max: 20, step: 0.1, fmt: fmt(1), when: () => P.mw > 0 },
    ]],
    ['Planets & Moons', [
      { type: 'custom', build: buildBodyPicker },
      { key: 'b#On', label: 'Visible', type: 'toggle' },
      { type: 'custom', build: buildBodyTypes },
      { key: 'b#Size', label: 'Size', min: 0.3, max: 70, step: 0.1, fmt: v => v.toFixed(1) + '°', when: bodyOn },
      { key: 'b#Elev', label: 'Elevation', min: -10, max: 90, step: 0.1, fmt: deg, when: bodyOn },
      { key: 'b#Heading', label: 'Heading', min: 0, max: 360, step: 0.5, fmt: deg, when: bodyOn },
      { key: 'b#Phase', label: 'Phase', min: 0, max: 1, step: 0.005, fmt: v => `${Math.round((1 + Math.cos(v * Math.PI)) * 50)}% lit`, when: bodyOn },
      { key: 'b#Light', label: 'Light From', min: -180, max: 180, step: 0.5, fmt: deg, when: bodyOn },
      { key: 'b#Roll', label: 'Axis Tilt', min: -90, max: 90, step: 0.5, fmt: deg, when: bodyOn },
      { key: 'b#Lean', label: 'Axis Lean', min: -75, max: 75, step: 0.5, fmt: deg, when: bodyOn },
      { key: 'b#Bright', label: 'Brightness', min: 0, max: 3, step: 0.01, fmt: fmt(2), when: bodyOn },
      { key: 'b#ColorA', label: 'Primary', type: 'color', when: bodyOn },
      { key: 'b#ColorB', label: 'Secondary', type: 'color', when: bodyOn },
      { key: 'b#Atmo', label: 'Atmosphere', min: 0, max: 1.5, step: 0.01, fmt: fmt(2), when: bodyOn },
      { key: 'b#Ring', label: 'Rings', color: 'b#RingColor', min: 0, max: 1, step: 0.01, fmt: v => v ? pct(v) : 'Off', when: bodyOn },
      { key: 'b#RingIn', label: 'Ring Inner Edge', min: 1.05, max: 3, step: 0.01, fmt: v => v.toFixed(2) + '×', when: () => bodyOn() && P[resolveKey('b#Ring')] > 0 },
      { key: 'b#RingOut', label: 'Ring Outer Edge', min: 1.2, max: 5, step: 0.01, fmt: v => v.toFixed(2) + '×', when: () => bodyOn() && P[resolveKey('b#Ring')] > 0 },
      { key: 'b#Seed', label: 'Pattern', min: 0, max: 50, step: 0.1, fmt: fmt(1), when: bodyOn },
    ]],
    ['Galaxy', [
      { key: 'gal', label: 'Brightness', min: 0, max: 3, step: 0.01, fmt: v => v ? v.toFixed(2) : 'Off' },
      { key: 'galSize', label: 'Size', min: 1, max: 90, step: 0.5, fmt: v => v.toFixed(1) + '°', when: () => P.gal > 0 },
      { key: 'galElev', label: 'Elevation', min: -10, max: 90, step: 0.1, fmt: deg, when: () => P.gal > 0 },
      { key: 'galHeading', label: 'Heading', min: 0, max: 360, step: 0.5, fmt: deg, when: () => P.gal > 0 },
      { key: 'galIncl', label: 'Inclination', min: 0, max: 88, step: 0.5, fmt: deg, when: () => P.gal > 0 },
      { key: 'galAngle', label: 'Rotation', min: -180, max: 180, step: 0.5, fmt: deg, when: () => P.gal > 0 },
      { key: 'galArms', label: 'Arms', min: 1, max: 5, step: 1, fmt: fmt(0), when: () => P.gal > 0 },
      { key: 'galTwist', label: 'Winding', min: 0.5, max: 5, step: 0.01, fmt: fmt(2), when: () => P.gal > 0 },
      { key: 'galCore', label: 'Core Color', type: 'color', when: () => P.gal > 0 },
      { key: 'galArm', label: 'Arm Color', type: 'color', when: () => P.gal > 0 },
      { key: 'galSeed', label: 'Structure', min: 0, max: 50, step: 0.1, fmt: fmt(1), when: () => P.gal > 0 },
    ]],
    ['Nebula', [
      { key: 'neb', label: 'Intensity', min: 0, max: 3, step: 0.01, fmt: v => v ? v.toFixed(2) : 'Off' },
      { key: 'nebA', label: 'Primary', type: 'color', when: () => P.neb > 0 },
      { key: 'nebB', label: 'Secondary', type: 'color', when: () => P.neb > 0 },
      { key: 'nebScale', label: 'Scale', min: 0.3, max: 4, step: 0.01, fmt: fmt(2), when: () => P.neb > 0 },
      { key: 'nebWarp', label: 'Wisps', min: 0, max: 1.5, step: 0.01, fmt: fmt(2), when: () => P.neb > 0 },
      { key: 'nebSeed', label: 'Shape', min: 0, max: 40, step: 0.1, fmt: fmt(1), when: () => P.neb > 0 },
    ]],
  ]},
  { id: 'night', label: 'Night', sections: [
    ['Moon', [
      { key: 'moon', label: 'Moon', type: 'toggle' },
      { key: 'moonPhase', label: 'Phase', min: 0, max: 1, step: 0.005, fmt: moonPhaseName, when: () => P.moon },
      { key: 'moonElev', label: 'Elevation', min: -5, max: 85, step: 0.1, fmt: deg, when: () => P.moon },
      { key: 'moonHeading', label: 'Heading', min: 0, max: 360, step: 0.5, fmt: deg, when: () => P.moon },
      { key: 'moonSize', label: 'Size', min: 0.5, max: 12, step: 0.05, fmt: v => v.toFixed(2) + '×', when: () => P.moon },
      { key: 'moonTilt', label: 'Tilt', min: -180, max: 180, step: 0.5, fmt: deg, when: () => P.moon },
      { key: 'moonBright', label: 'Disk Brightness', min: 0, max: 3, step: 0.01, fmt: fmt(2), when: () => P.moon },
      { key: 'moonGlow', label: 'Glow', min: 0, max: 2, step: 0.01, fmt: fmt(2), when: () => P.moon },
      { key: 'moonHalo', label: '22° Halo', min: 0, max: 2, step: 0.01, fmt: fmt(2), when: () => P.moon },
      { key: 'earthshine', label: 'Earthshine', min: 0, max: 2, step: 0.01, fmt: fmt(2), when: () => P.moon },
      { key: 'moonLight', label: 'Moonlight', min: 0, max: 10, step: 0.05, fmt: fmt(2), when: () => P.moon },
    ]],
    ['Aurora', [
      { key: 'aurora', label: 'Intensity', min: 0, max: 3, step: 0.01, fmt: v => v ? v.toFixed(2) : 'Off' },
      { key: 'auroraA', label: 'Lower Color', type: 'color', when: () => P.aurora > 0 },
      { key: 'auroraB', label: 'Upper Color', type: 'color', when: () => P.aurora > 0 },
      { key: 'auroraHeight', label: 'Curtain Height', min: 0.3, max: 2, step: 0.01, fmt: fmt(2), when: () => P.aurora > 0 },
      { key: 'auroraHeading', label: 'Direction', min: 0, max: 360, step: 0.5, fmt: deg, when: () => P.aurora > 0 },
      { key: 'auroraSpread', label: 'Spread', min: 0, max: 1, step: 0.01, fmt: pct, when: () => P.aurora > 0 },
    ]],
    ['Meteors', [
      { key: 'meteors', label: 'Count', min: 0, max: 12, step: 1, fmt: v => v ? fmt(0)(v) : 'Off' },
      { key: 'meteorBright', label: 'Brightness', min: 0.1, max: 4, step: 0.01, fmt: fmt(2), when: () => P.meteors > 0 },
      { key: 'meteorLength', label: 'Length', min: 2, max: 40, step: 0.5, fmt: deg, when: () => P.meteors > 0 },
      { key: 'meteorHeading', label: 'Radiant', min: 0, max: 360, step: 0.5, fmt: deg, when: () => P.meteors > 0 },
      { key: 'meteorSeed', label: 'Pattern', min: 1, max: 99, step: 1, fmt: fmt(0), when: () => P.meteors > 0 },
    ]],
  ]},
  { id: 'land', label: 'Land', sections: [
    ['Surface', [
      { type: 'custom', build: buildSurfaces },
      { key: 'surfColorA', label: 'Base Color', type: 'color' },
      { key: 'surfColorB', label: 'Accent Color', type: 'color' },
      { key: 'surfScale', label: 'Texture Scale', min: 0.2, max: 5, step: 0.01, fmt: v => v.toFixed(2) + '×' },
      { key: 'surfWaves', label: 'Waves & Wind', min: 0, max: 3, step: 0.01, fmt: fmt(2) },
      { key: 'surfReflect', label: 'Reflection', min: 0, max: 1, step: 0.01, fmt: pct, when: () => P.surface === 1 || P.surface === 2 },
      { key: 'relief', label: 'Relief', min: 0, max: 3, step: 0.01, fmt: v => v.toFixed(2) + '×', when: () => P.surface >= 5 },
      { key: 'surfFoam', label: 'Whitecaps', min: 0, max: 1.5, step: 0.01, fmt: fmt(2), when: () => P.surface === 1 },
      { key: 'grassHeight', label: 'Grass Height', min: 0.05, max: 1.5, step: 0.01, fmt: v => v.toFixed(2) + ' m', when: grassy },
      { key: 'grassDensity', label: 'Density', min: 0.3, max: 2, step: 0.01, fmt: v => v.toFixed(2) + '×', when: grassy },
      { key: 'grassWidth', label: 'Blade Width', min: 0.4, max: 3, step: 0.01, fmt: v => v.toFixed(2) + '×', when: grassy },
      { key: 'grassLean', label: 'Bend', min: 0, max: 1, step: 0.01, fmt: fmt(2), when: grassy },
      { key: 'grassDry', label: 'Dry Blades', min: 0, max: 1, step: 0.01, fmt: pct, when: grassy },
      { key: 'flowers', label: 'Wildflowers', color: 'flowerColor', min: 0, max: 1, step: 0.01, fmt: pct, when: () => P.surface === 3 },
      { key: 'surfWind', label: 'Wind Direction', min: 0, max: 360, step: 1, fmt: deg },
      { key: 'surfRows', label: 'Row Angle', min: 0, max: 180, step: 0.5, fmt: deg, when: () => P.surface === 4 },
      { key: 'surfSparkle', label: 'Sparkle', min: 0, max: 2, step: 0.01, fmt: fmt(2), when: () => P.surface === 6 },
      { key: 'eyeHeight', label: 'Eye Height', min: 0.1, max: 300, step: 0.05, fmt: v => v.toFixed(2) + ' m' },
    ]],
    ['Landscape', [
      { key: 'land', label: 'Horizon', type: 'choice', cols: 3, options: LANDS.map(([title], i) => ({ value: i, title })),
        after: () => { if (P.land) P.landHeight = LANDS[P.land][1]; } },
      { key: 'landHeight', label: 'Height', min: 0.3, max: 15, step: 0.05, fmt: deg, when: () => P.land > 0 },
      { key: 'landRough', label: 'Ruggedness', min: 0, max: 1, step: 0.01, fmt: fmt(2), when: () => P.land === 2 },
      { key: 'landLayers', label: 'Ranges', min: 1, max: 4, step: 1, fmt: fmt(0), when: () => P.land > 0 && P.land < 4 },
      { key: 'landDepth', label: 'Shore Distance', min: 0.2, max: 5, step: 0.01, fmt: v => v.toFixed(2) + ' km', when: () => P.land > 0 },
      { key: 'landHeading', label: 'Rotate', min: 0, max: 360, step: 0.5, fmt: deg, when: () => P.land > 0 },
      { key: 'landSeed', label: 'Shape', min: 0, max: 50, step: 0.1, fmt: fmt(1), when: () => P.land > 0 },
      { key: 'landColor', label: 'Color', type: 'color', when: () => P.land > 0 && P.land !== 4 },
      { key: 'landSnow', label: 'Snow', min: 0, max: 1, step: 0.01, fmt: pct, when: () => P.land === 1 || P.land === 2 },
      { key: 'forestMix', label: 'Conifers', min: 0, max: 1, step: 0.01, fmt: pct, when: () => P.land === 3 },
      { key: 'forestDensity', label: 'Tree Density', min: 0.2, max: 1, step: 0.01, fmt: pct, when: () => P.land === 3 },
      { key: 'cityLights', label: 'Window Lights', color: 'cityColor', min: 0, max: 1, step: 0.01, fmt: pct, when: () => P.land === 4 },
    ]],
    ['Trees', [
      { key: 'trees', label: 'Count', min: 0, max: 16, step: 1, fmt: v => v ? fmt(0)(v) : 'Off' },
      { key: 'treeType', label: 'Kind', type: 'choice', cols: 4, options: ['Broadleaf', 'Conifer', 'Birch', 'Mixed'].map((title, value) => ({ value, title })), when: () => P.trees > 0 },
      { key: 'treeHeight', label: 'Height', min: 3, max: 40, step: 0.5, fmt: v => v.toFixed(1) + ' m', when: () => P.trees > 0 },
      { key: 'treeWidth', label: 'Crown Width', min: 0.5, max: 1.8, step: 0.01, fmt: v => v.toFixed(2) + '×', when: () => P.trees > 0 },
      { key: 'treeFoliage', label: 'Foliage', color: 'treeColor', min: 0.2, max: 1.5, step: 0.01, fmt: fmt(2), when: () => P.trees > 0 },
      { key: 'treeAutumn', label: 'Autumn', min: 0, max: 1, step: 0.01, fmt: pct, when: () => P.trees > 0 },
      { key: 'treeNear', label: 'Nearest', min: 5, max: 400, step: 1, fmt: v => v.toFixed(0) + ' m', when: () => P.trees > 0,
        after: () => { P.treeFar = Math.max(P.treeFar, P.treeNear); } },
      { key: 'treeFar', label: 'Farthest', min: 10, max: 1000, step: 1, fmt: v => v.toFixed(0) + ' m', when: () => P.trees > 1,
        after: () => { P.treeNear = Math.min(P.treeNear, P.treeFar); } },
      { key: 'treeHeading', label: 'Heading', min: 0, max: 360, step: 0.5, fmt: deg, when: () => P.trees > 0 },
      { key: 'treeSpread', label: 'Spread', min: 0, max: 360, step: 1, fmt: deg, when: () => P.trees > 1 },
      { key: 'treeSeed', label: 'Layout', min: 1, max: 99, step: 1, fmt: fmt(0), when: () => P.trees > 0 },
    ]],
    ['Volcano Peak', [
      { key: 'peak', label: 'Height', min: 0, max: 20, step: 0.05, fmt: v => v ? deg(v) : 'Off' },
      { key: 'peakHeading', label: 'Heading', min: 0, max: 360, step: 0.5, fmt: deg, when: () => P.peak > 0 },
      { key: 'peakWidth', label: 'Width', min: 3, max: 50, step: 0.1, fmt: deg, when: () => P.peak > 0 },
      { key: 'peakSnow', label: 'Snow Cap', min: 0, max: 1, step: 0.01, fmt: pct, when: () => P.peak > 0 },
    ]],
    ['Fog & Haze', [
      { key: 'fog', label: 'Ground Fog', min: 0, max: 2, step: 0.01, fmt: v => v ? v.toFixed(2) : 'Off' },
      { key: 'fogHeight', label: 'Fog Height', min: 2, max: 400, step: 1, fmt: v => v.toFixed(0) + ' m', when: () => P.fog > 0 },
      { key: 'fogGlow', label: 'Mist Glow', min: 0, max: 2, step: 0.01, fmt: fmt(2), when: () => P.fog > 0 },
      { key: 'fogColor', label: 'Fog Color', type: 'color', when: () => P.fog > 0 },
      { key: 'haze', label: 'Distance Haze', min: 0, max: 1, step: 0.01, fmt: fmt(2) },
    ]],
  ]},
  { id: 'motion', label: 'Motion', sections: [
    ['Timelapse', [
      { label: 'Play', type: 'toggle', get: () => ANIM.playing, set: v => setPlaying(v) },
      { label: 'Speed', type: 'choice', cols: 3, options: RATES.map(([value, title]) => ({ value, title })), get: () => ANIM.rate, set: setRate },
      { label: 'Run Backward', type: 'toggle', get: () => ANIM.reverse, set: v => { ANIM.reverse = v; } },
      { label: 'Reset Time', type: 'button', action: resetTime },
    ]],
    ['What Moves', [
      { key: 'motionSky', label: 'Sun, Moon & Stars', type: 'toggle' },
      { key: 'motionClouds', label: 'Clouds', type: 'toggle' },
      { key: 'windMul', label: 'Wind Strength', min: 0, max: 5, step: 0.01, fmt: v => v.toFixed(2) + '×', when: () => P.motionClouds },
      { key: 'morphMul', label: 'Cloud Evolution', min: 0, max: 5, step: 0.01, fmt: v => v.toFixed(2) + '×', when: () => P.motionClouds },
      { key: 'twinkle', label: 'Star Twinkle', min: 0, max: 1, step: 0.01, fmt: pct },
      { key: 'surfMotion', label: 'Water & Fields', min: 0, max: 4, step: 0.01, fmt: v => v.toFixed(2) + '×' },
      { key: 'auroraSpeed', label: 'Aurora Flow', min: 0, max: 5, step: 0.01, fmt: v => v.toFixed(2) + '×' },
    ]],
  ]},
  { id: 'color', label: 'Color', sections: [
    ['Tone', [
      { key: 'ev', label: 'Exposure', min: -5, max: 5, step: 0.05, fmt: v => signed(2)(v) + ' EV' },
      { key: 'tone', label: 'Tone Curve', type: 'choice', cols: 4, options: TONES.map((t, i) => ({ value: i, title: t })) },
      { key: 'contrast', label: 'Contrast', min: 0.5, max: 2, step: 0.01, fmt: fmt(2) },
      { key: 'lift', label: 'Black Point', min: -0.15, max: 0.15, step: 0.002, fmt: signed(3) },
    ]],
    ['Color', [
      { key: 'temp', label: 'Temperature', min: -1, max: 1, step: 0.01, fmt: signed(2) },
      { key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.01, fmt: signed(2) },
      { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, fmt: fmt(2) },
      { key: 'vibrance', label: 'Vibrance', min: -1, max: 1.5, step: 0.01, fmt: signed(2) },
      { key: 'hue', label: 'Hue Shift', min: -180, max: 180, step: 0.5, fmt: deg },
    ]],
    ['Split Toning', [
      { key: 'shadowAmt', label: 'Shadows', color: 'shadowTint', min: 0, max: 1, step: 0.01, fmt: fmt(2) },
      { key: 'highAmt', label: 'Highlights', color: 'highTint', min: 0, max: 1, step: 0.01, fmt: fmt(2) },
      { key: 'filterAmt', label: 'Color Filter', color: 'filter', min: 0, max: 1, step: 0.01, fmt: fmt(2) },
    ]],
  ]},
];

// Camera and capture settings share one submenu, opened by the Capture button.
const CAPTURE_MENU = { sections: [
    ['Frame', [
      { type: 'custom', build: buildAspect },
      { type: 'custom', build: buildDevice },
    ]],
    ['View', [
      { key: 'proj', label: 'Projection', type: 'choice', cols: 4, options: PROJECTIONS.map((p, i) => ({ value: i, title: p.title })),
        after: () => { P.fov = clamp(P.fov, PROJECTIONS[P.proj].min, PROJECTIONS[P.proj].max); } },
      { key: 'fov', label: 'Field of View', min: 4, max: 360, step: 0.5, fmt: v => P.proj === 0 ? `${v.toFixed(0)}° · ${(21.63 / Math.tan(v * DEG / 2)).toFixed(0)}mm` : deg(v),
        range: () => [PROJECTIONS[P.proj].min, PROJECTIONS[P.proj].max], when: () => P.proj !== 3 },
      { key: 'heading', label: 'Heading', min: 0, max: 360, step: 0.5, fmt: deg },
      { key: 'pitch', label: 'Pitch', min: -90, max: 90, step: 0.5, fmt: deg, when: () => P.proj !== 3 },
      { key: 'roll', label: 'Roll', min: -180, max: 180, step: 0.5, fmt: deg, when: () => P.proj !== 3 },
    ]],
    ['Lens', [
      { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01, fmt: fmt(2) },
      { key: 'grain', label: 'Film Grain', min: 0, max: 1, step: 0.01, fmt: fmt(2) },
      { key: 'grainSize', label: 'Grain Size', min: 0.3, max: 4, step: 0.05, fmt: fmt(2), when: () => P.grain > 0 },
    ]],
    ['Resolution', [
      { type: 'custom', build: buildSize },
      { label: 'Preview Resolution', min: 0.35, max: 1, step: 0.05, fmt: pct,
        get: () => VIEW.scale, set: v => { VIEW.scale = v; store('horizon-view', VIEW); } },
    ]],
    ['Output', [
      { label: 'Format', type: 'choice', cols: 3, options: [{ value: 'png', title: 'PNG' }, { value: 'jpg', title: 'JPEG' }, { value: 'mp4', title: 'Video' }],
        get: () => C.format, set: v => setCapture({ format: v }) },
      { label: 'Quality', type: 'choice', cols: 2, options: [{ value: 4, title: 'Standard' }, { value: 16, title: 'Supersampled' }],
        get: () => C.samples, set: v => setCapture({ samples: v }), when: () => C.format !== 'mp4' },
      { label: 'Video Length', min: 1, max: 60, step: 1, fmt: v => v + ' s', get: () => C.seconds, set: v => setCapture({ seconds: v }), when: () => C.format === 'mp4' },
      { label: 'Frame Rate', type: 'choice', cols: 3, options: [24, 30, 60].map(v => ({ value: v, title: v + ' fps' })),
        get: () => C.fps, set: v => setCapture({ fps: v }), when: () => C.format === 'mp4' },
      { type: 'custom', build: body => {
        const note = el('div', 'note', body);
        refreshers.push(() => {
          note.hidden = C.format !== 'mp4';
          const [W, H] = videoDims();
          note.textContent = `Records ${W} × ${H} MP4 at the Motion tab's timelapse speed (${rateLabel()}), then returns to the current moment.`;
        });
      } },
      { label: 'Thirds Grid', type: 'toggle', get: () => C.grid, set: v => setCapture({ grid: v }) },
      { label: 'Pixel Loupe', type: 'toggle', get: () => C.loupe, set: v => { C.loupe = v; } },
    ]],
]};

let tab = store('horizon-tab') || 'sky';
const refreshers = [];
let statEl, tabBody, tabButtons = {};

function setPanel(open) {
  panel.classList.toggle('hidden', !open);
  $('reopen').classList.toggle('on', !open);
  layout();
}

function changed() {
  invalidate();
  syncUI();
  commitSoon();
}

const history = { past: [], future: [], base: null, timer: 0 };

function commitSoon() {
  clearTimeout(history.timer);
  history.timer = setTimeout(commit, 400);
}

function commit() {
  if (ANIM.playing) return;
  const snap = JSON.stringify(P);
  if (history.base !== null && snap !== history.base) {
    history.past.push(history.base);
    if (history.past.length > 150) history.past.shift();
    history.future.length = 0;
  }
  history.base = snap;
  syncUI();
}

function restoreSnapshot(snap) {
  Object.assign(P, JSON.parse(snap));
  invalidate();
  syncUI();
}

function undo() {
  commit();
  if (!history.past.length) return;
  history.future.push(history.base);
  history.base = history.past.pop();
  restoreSnapshot(history.base);
}

function redo() {
  commit();
  if (!history.future.length) return;
  history.past.push(history.base);
  history.base = history.future.pop();
  restoreSnapshot(history.base);
}

function syncUI() {
  for (const f of refreshers) f();
  for (const f of lookRefreshers) f();
  frameEl.classList.toggle('on', C.on);
  frameEl.classList.toggle('grid', C.on && C.grid);
  bar.classList.toggle('capture', C.on);
  $('credit').classList.toggle('away', C.on || !!job);
  placeBar();
  if (!C.on || !C.loupe) loupeEl.classList.remove('on');
}

function accessor(it) {
  return {
    get: it.get ?? (() => P[resolveKey(it.key)]),
    set: it.set ?? (v => { P[resolveKey(it.key)] = v; }),
  };
}

// A row of segment buttons under an optional label; returns the button strip.
function segRow(body, label, cols) {
  const row = el('div', 'row', body);
  if (label) el('div', 'lab', row, label);
  return el('div', 'seg' + (cols ? ' c' + cols : ''), row);
}

// One button per option in a strip: `pick(value)` applies it, `active(value)` says whether it is lit.
function choiceButtons(seg, options, pick, active) {
  for (const { value, title } of options) {
    const b = el('button', 'btn', seg, title);
    b.onclick = () => pick(value);
    refreshers.push(() => b.classList.toggle('active', active(value)));
  }
}

function buildItem(it, body) {
  const { get, set } = accessor(it);
  if (it.type === 'custom') return it.build(body);
  if (it.type === 'button') {
    const row = el('div', 'row', body);
    el('button', 'btn', row, it.label).onclick = it.action;
    return;
  }
  if (it.type === 'toggle') {
    const row = el('div', 'tog', body);
    el('span', null, row, it.label);
    el('span', 'sw', row);
    row.onclick = () => { set(!get()); it.after?.(); changed(); };
    refreshers.push(() => {
      row.classList.toggle('on', !!get());
      if (it.when) row.classList.toggle('off', !it.when());
    });
    return;
  }
  if (it.type === 'choice') {
    const seg = segRow(body, it.label, it.cols), row = seg.parentNode;
    choiceButtons(seg, it.options, v => { set(v); it.after?.(); changed(); }, v => get() === v);
    if (it.when) refreshers.push(() => row.classList.toggle('off', !it.when()));
    return;
  }
  if (it.type === 'color') {
    const row = el('div', 'row', body);
    const lab = el('div', 'lab', row);
    el('span', null, lab, it.label);
    lab.appendChild(colorInput(it.key));
    if (it.when) refreshers.push(() => row.classList.toggle('off', !it.when()));
    return;
  }
  const row = el('div', 'row', body);
  const lab = el('div', 'lab', row);
  const name = el('span', null, lab, it.label);
  const right = el('div', 'lab-r', lab);
  const val = el('span', 'val', right);
  if (it.color) right.appendChild(colorInput(it.color));
  const input = el('input', null, row);
  Object.assign(input, { type: 'range', min: it.min, max: it.max, step: it.step });
  input.oninput = () => { set(parseFloat(input.value)); it.after?.(); changed(); };
  if (it.key) name.ondblclick = () => { set(DEFAULTS[resolveKey(it.key)]); it.after?.(); changed(); };
  refreshers.push(() => {
    if (it.range) { const [a, b] = it.range(); input.min = a; input.max = b; }
    input.value = get();
    val.textContent = it.fmt(get());
    if (it.when) row.classList.toggle('off', !it.when());
  });
}

function buildSurfaces(body) {
  choiceButtons(segRow(body, 'Surface Type', 3), SURFACES.map(([title, type, values]) => ({ title, value: { ...values, surface: type } })),
    values => { Object.assign(P, values); changed(); },
    values => P.surface === values.surface && P.surfColorA === values.surfColorA);
}

// Picks which of `n` slots (cloud layers, bodies) the controls below edit; a slot in use is
// labelled by what it holds.
function buildSlotPicker(body, n, label, select, selected) {
  const seg = segRow(body, null, n);
  for (let i = 0; i < n; i++) {
    const b = el('button', 'btn', seg);
    b.onclick = () => { select(i); syncUI(); };
    refreshers.push(() => {
      b.classList.toggle('active', selected() === i);
      b.textContent = label(i);
    });
  }
}

function buildLayerPicker(body) {
  buildSlotPicker(body, 3, i => P[`c${i}On`] ? `${P[`c${i}Alt`].toFixed(1)} km` : `Layer ${i + 1}`, i => { cloudSel = i; }, () => cloudSel);
}

function buildBodyPicker(body) {
  buildSlotPicker(body, 2, i => P[`b${i}On`] ? BODY_TYPES[P[`b${i}Type`]][0] : `Body ${i + 1}`, i => { bodySel = i; }, () => bodySel);
}

function buildCloudTypes(body) {
  const key = k => resolveKey(`c#${k}`);
  choiceButtons(segRow(body, 'Cloud Type', 3), Object.entries(CLOUD_TYPES).map(([name, values]) => ({ title: name[0].toUpperCase() + name.slice(1), value: values })),
    values => {
      for (const [k, v] of Object.entries(values)) P[key(k)] = v;
      P[key('On')] = true;
      changed();
    },
    values => Object.entries(values).every(([k, v]) => P[key(k)] === v));
}

function buildBodyTypes(body) {
  const key = k => resolveKey(`b#${k}`);
  choiceButtons(segRow(body, 'Kind', 3), BODY_TYPES.map(([title], type) => ({ title, value: type })),
    type => {
      for (const [k, v] of Object.entries(BODY_TYPES[type][1])) P[key(k)] = v;
      Object.assign(P, { [key('Type')]: type, [key('On')]: true });
      changed();
    },
    type => P[key('Type')] === type);
}

function buildBandStyles(body) {
  choiceButtons(segRow(body, 'Style', 3), BAND_STYLES.map(([title, value]) => ({ title, value })),
    values => { Object.assign(P, values); if (!P.mw) P.mw = 1; changed(); },
    values => P.mw > 0 && Object.entries(values).every(([k, v]) => P[k] === v));
}

function colorInput(key) {
  const input = document.createElement('input');
  input.type = 'color';
  input.id = 'c-' + key;
  input.oninput = () => { P[resolveKey(key)] = input.value; changed(); };
  refreshers.push(() => { input.value = P[resolveKey(key)]; });
  return input;
}

function buildAspect(body) {
  choiceButtons(segRow(body, 'Aspect Ratio'), ASPECTS.map(([title, a, b]) => ({ title, value: a / b })),
    ratio => setCapture({ ratio }), ratio => Math.abs(C.ratio - ratio) < 1e-4);
}

function buildDevice(body) {
  const row = el('div', 'row', body);
  el('div', 'lab', row, 'Device');
  const sel = el('select', null, row);
  sel.id = 'device';
  el('option', null, sel, 'Custom').value = '';
  DEVICES.forEach(([name, w, h], i) => { el('option', null, sel, `${name} · ${w} × ${h}`).value = i; });
  sel.onchange = () => {
    if (sel.value === '') return;
    const [, w, h] = DEVICES[+sel.value];
    setCapture({ ratio: w / h, long: Math.max(w, h) });
  };
  refreshers.push(() => {
    const [W, H] = captureDims();
    const i = DEVICES.findIndex(([, w, h]) => w === W && h === H);
    sel.value = i < 0 ? '' : i;
  });
}

function buildSize(body) {
  choiceButtons(segRow(body, 'Long Edge', 3), SIZES.map(([title, value]) => ({ title, value })),
    long => setCapture({ long }), long => C.long === long);
  const dims = el('div', 'row dims', body);
  const wIn = el('input', 'num', dims);
  el('span', null, dims, '×');
  const hIn = el('input', 'num', dims);
  for (const [inp, id] of [[wIn, 'cap-w'], [hIn, 'cap-h']]) Object.assign(inp, { id, type: 'number', min: 64, max: MAX_SIDE, step: 1 });
  const applyDims = () => {
    const w = clamp(Math.round(+wIn.value) || 64, 64, MAX_SIDE), h = clamp(Math.round(+hIn.value) || 64, 64, MAX_SIDE);
    setCapture({ ratio: w / h, long: Math.max(w, h) });
  };
  wIn.onchange = hIn.onchange = applyDims;
  const note = el('div', 'note', body);
  refreshers.push(() => {
    const [W, H] = captureDims();
    if (document.activeElement !== wIn) wIn.value = W;
    if (document.activeElement !== hIn) hIn.value = H;
    const T = tileSize(C.samples);
    note.textContent = `${(W * H / 1e6).toFixed(1)} megapixels · ${Math.ceil(W / T) * Math.ceil(H / T)} render tiles`;
  });
}

function renderMenu(menu) {
  const scroll = panel.scrollTop; // read before emptying the body clamps it
  refreshers.length = 0;
  refreshers.push(...staticRefreshers);
  tabBody.textContent = '';
  tabBody.scrollTop = 0;
  for (const [title, items] of menu.sections) {
    const sec = el('div', 'sec', tabBody);
    el('button', 'sh', sec, title).onclick = () => sec.classList.toggle('closed');
    const body = el('div', 'body', sec);
    for (const it of items) buildItem(it, body);
  }
  // On phones the whole panel scrolls; bring a new menu's start back into view.
  panel.scrollTop = C.on ? 0 : Math.min(scroll, $('tabs').offsetTop);
  syncUI();
}

function showTab(id) {
  tab = id;
  store('horizon-tab', id);
  for (const [k, b] of Object.entries(tabButtons)) b.classList.toggle('active', k === id);
  if (!C.on) renderMenu(TABS.find(t => t.id === id));
}

const staticRefreshers = [];

// Icons ignore the pointer so presses land on their button, even while the play icon is swapped.
function svg(paths) {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" pointer-events="none">${paths}</svg>`;
}

const lookRefreshers = [];

function buildLookStrip() {
  const strip = $('looks');
  strip.textContent = '';
  lookRefreshers.length = 0;
  thumbQueue.length = 0;
  thumbCache.live.clear();
  for (const look of [...PRESETS, ...looks]) {
    const card = el('button', 'preset', strip);
    const cv = el('canvas', null, card), dpr = screenDpr();
    // One pixel per screen pixel inside the card's border (70×44 outside it).
    cv.width = Math.round((cv.clientWidth || 68) * dpr);
    cv.height = Math.round((cv.clientHeight || 42) * dpr);
    el('span', null, card, look.name);
    card.onclick = () => applyLook(look);
    if (looks.includes(look)) {
      const x = el('span', 'x', card, '×');
      x.title = 'Delete this look';
      x.onclick = e => {
        e.stopPropagation();
        if (x.classList.contains('armed')) return deleteLook(look);
        x.classList.add('armed');
        x.textContent = 'Delete';
        setTimeout(() => { x.classList.remove('armed'); x.textContent = '×'; }, 2500);
      };
    }
    thumbCache.ready().then(version => {
      if (!cv.isConnected) return; // the strip was rebuilt meanwhile
      const key = thumbCache.key(version, look, cv.width, cv.height), url = thumbCache.data[key];
      if (url) {
        const img = new Image();
        img.onload = () => cv.getContext('2d').drawImage(img, 0, 0);
        img.onerror = () => thumbQueue.push([look, cv, key]);
        img.src = url;
      } else thumbQueue.push([look, cv, key]);
    });
    lookRefreshers.push(() => card.classList.toggle('active', lookActive(look)));
  }
  const add = el('button', 'preset add', strip);
  el('div', 'plus', add, '+');
  el('span', null, add, 'Save Look');
  add.onclick = () => { $('save-row').hidden = false; $('look-name').focus(); };
  for (const f of lookRefreshers) f();
}

function buildUI() {
  const head = el('div', 'head', panel);
  el('div', 'title', head, 'Horizon Engine');
  const hr = el('div', 'head-r', head);
  statEl = el('span', 'stat', hr);
  for (const [title, icon, fn, has] of [
    ['Undo (⌘Z)', '<path d="M5.5 4L2.5 7l3 3"/><path d="M2.5 7h7a4 4 0 0 1 0 8H8"/>', undo, () => history.past.length],
    ['Redo (⇧⌘Z)', '<path d="M10.5 4l3 3-3 3"/><path d="M13.5 7h-7a4 4 0 0 0 0 8H8"/>', redo, () => history.future.length],
  ]) {
    const b = el('button', 'icon', hr);
    b.title = title;
    b.innerHTML = svg(icon);
    b.onclick = fn;
    staticRefreshers.push(() => { b.disabled = !has(); });
  }
  const hide = el('button', 'icon', hr);
  hide.setAttribute('aria-label', 'Hide controls (H)');
  hide.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" stroke-width="1.2"><path d="M2 2l8 8M10 2l-8 8"/></svg>';
  hide.onclick = () => setPanel(false);
  $('reopen').onclick = () => setPanel(true);

  el('div', 'presets', panel).id = 'looks';
  const saveRow = el('form', 'saverow', panel);
  saveRow.id = 'save-row';
  saveRow.hidden = true;
  const nameIn = el('input', 'num', saveRow);
  Object.assign(nameIn, { id: 'look-name', placeholder: 'Name this look', maxLength: 32 });
  el('button', 'btn primary', saveRow, 'Save');
  const cancelSave = el('button', 'btn', saveRow, 'Cancel');
  cancelSave.type = 'button';
  cancelSave.onclick = () => { saveRow.hidden = true; };
  saveRow.onsubmit = e => {
    e.preventDefault();
    const name = nameIn.value.trim();
    if (!name) return;
    saveLook(name);
    nameIn.value = '';
    saveRow.hidden = true;
    toast(`Saved “${name}”`);
  };
  buildLookStrip();

  const tabs = el('nav', 'tabs', panel);
  tabs.id = 'tabs';
  for (const t of TABS) {
    const b = el('button', 'tab', tabs);
    b.innerHTML = svg(ICONS[t.id]) + `<span>${t.label}</span>`;
    b.onclick = () => showTab(t.id);
    tabButtons[t.id] = b;
  }
  const strip = $('looks');
  strip.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    strip.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  tabBody = el('div', 'tabbody', panel);
  const foot = el('div', 'foot', panel);
  const resetAll = el('button', 'btn', foot, 'Reset');
  resetAll.title = 'Return every setting to its default (undo brings it back)';
  resetAll.onclick = () => applyLook({ name: 'Default', p: {} });
  staticRefreshers.push(() => { resetAll.disabled = C.on; });
  const cap = el('button', 'btn primary', foot, 'Capture');
  cap.onclick = () => setCaptureMode(!C.on);
  staticRefreshers.push(() => { cap.textContent = C.on ? 'Exit Capture' : 'Capture'; cap.classList.toggle('primary', !C.on); });

  const play = el('button', 'icon', bar);
  play.title = 'Play timelapse (Space)';
  play.onclick = () => setPlaying(!ANIM.playing);
  const rateBtn = el('button', 'btn ghost', bar);
  rateBtn.title = 'Timelapse speed';
  rateBtn.onclick = () => setRate(RATES[(rateIndex() + 1) % RATES.length][0]);
  const clock = el('span', 'info clock', bar);
  const reset = el('button', 'icon', bar);
  reset.title = 'Reset time';
  reset.innerHTML = svg('<path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3"/><path d="M3 2.5v2.8h2.8"/>');
  reset.onclick = resetTime;
  staticRefreshers.push(() => {
    play.innerHTML = svg(ANIM.playing ? '<path d="M5 3.5v9M11 3.5v9"/>' : '<path d="M5 3l8 5-8 5z"/>');
    play.classList.toggle('on', ANIM.playing);
    rateBtn.textContent = rateLabel();
    clock.textContent = elapsedLabel();
  });
  const group = el('div', 'capgroup', bar);
  const info = el('span', 'info', group);
  staticRefreshers.push(() => {
    const [W, H] = captureDims();
    info.innerHTML = `<b>${W} × ${H}</b> · ${(W * H / 1e6).toFixed(1)} MP · ${FORMAT_NAMES[C.format]}`;
  });
  const toggles = [
    ['grid', 'Thirds grid', '<path d="M5.5 2v12M10.5 2v12M2 5.5h12M2 10.5h12"/>', () => setCapture({ grid: !C.grid })],
    ['loupe', 'Pixel loupe (L)', '<circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4L14 14"/>', toggleLoupe],
  ];
  for (const [key, title, icon, flip] of toggles) {
    const b = el('button', 'icon', group);
    b.title = title;
    b.innerHTML = svg(icon);
    b.onclick = flip;
    staticRefreshers.push(() => b.classList.toggle('on', !!C[key]));
  }
  el('button', 'btn', group, 'Done').onclick = () => setCaptureMode(false);
  const save = el('button', 'btn primary', group);
  save.onclick = runExport;
  staticRefreshers.push(() => { save.textContent = C.format === 'mp4' ? 'Record Video' : 'Save Image'; });
  showTab(TABS.some(t => t.id === tab) ? tab : 'sky');
}

// Capture mode shows only the Camera & Capture controls: no looks strip and no tabs.
function setCaptureMode(on) {
  C.on = on;
  for (const id of ['looks', 'tabs']) $(id).hidden = on;
  if (on) $('save-row').hidden = true;
  renderMenu(on ? CAPTURE_MENU : TABS.find(t => t.id === tab));
}

function toggleLoupe() {
  C.loupe = !C.loupe;
  syncUI();
}
