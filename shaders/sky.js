'use strict';

// The sky shader: its uniforms, the features each scene compiles, the scene and the tone & grade.
const SCENE_UNIFORMS = [
  ['uImg', 'vec2', () => D.img],
  ['uProj', 'int', () => P.proj],
  ['uHalfDiag', 'float', () => P.fov * DEG / 2],
  ['uHeading', 'float', () => P.heading * DEG],
  ['uFwd', 'vec3', () => D.basis.fwd],
  ['uRight', 'vec3', () => D.basis.right],
  ['uUp', 'vec3', () => D.basis.up],

  ['uAtmo', 'vec4', () => [P.rayleigh, P.mie, P.ozone, P.mieG]],
  ['uSunDir', 'vec3', () => D.sunDir],
  ['uSunAz', 'vec2', () => D.sunAz],
  ['uSunScale', 'float', () => D.sunScale],
  ['uSunDisk', 'vec3', () => [P.sunDisk ? 1 : 0, SUN_R * P.sunSize, P.sunGlow]],
  ['uMoonAz', 'vec2', () => D.moonAz],
  ['uMoonScale', 'float', () => D.moonScale],
  ['uNightScale', 'float', () => D.nightScale],
  ['uNightZenith', 'vec3', () => saturate(hexLinear(P.nightZenith), P.nightVibrance).map(c => c * P.nightBright)],
  ['uNightHorizon', 'vec3', () => saturate(hexLinear(P.nightHorizon), P.nightVibrance).map(c => c * P.nightBright)],
  ['uNightCurve', 'float', () => P.nightCurve],
  ['uLP', 'vec4', () => [P.lpStrength, P.lpHeight, P.lpFocus, 0]],
  ['uLPColor', 'vec3', () => hexLinear(P.lpColor)],
  ['uLPDir', 'vec2', () => [Math.sin(P.lpHeading * DEG), Math.cos(P.lpHeading * DEG)]],
  ['uAirglow', 'vec4', () => [...hexLinear(P.airglowColor), P.airglow]],
  ['uSurf', 'vec4', () => [P.surface, P.eyeHeight, P.surfScale, 0]],
  ['uSurfA', 'vec4', () => [...hexLinear(P.surfColorA), P.surfWaves]],
  ['uSurfB', 'vec4', () => [...hexLinear(P.surfColorB), P.surfReflect]],
  ['uSurfC', 'vec4', () => [P.surfWind * DEG, P.surfSparkle, P.surfMotion, P.surfRows * DEG]],
  ['uGrass', 'vec4', () => [P.grassHeight, P.grassDensity, P.grassWidth * 0.006, P.grassLean]],
  ['uGrassB', 'vec4', () => [P.grassDry, P.flowers, 0, 0]],
  ['uTerrain', 'vec4', () => [P.relief, 0, 0, 0]],
  ['uFlower', 'vec3', () => hexLinear(P.flowerColor)],
  ['uTree', 'vec4', () => D.trees, 16],
  ['uTreeN', 'int', () => D.treeN],
  ['uTreeLook', 'vec4', () => [P.treeFoliage, P.treeAutumn, P.treeWidth, 0]],
  ['uTreeColor', 'vec3', () => hexLinear(P.treeColor)],
  ['uWave', 'vec4', () => D.waves, 32],
  ['uWaveFx', 'vec3', () => D.waveFx],
  ['uLand', 'vec4', () => [P.land, P.landHeight, P.landRough, P.landLayers]],
  ['uLandB', 'vec4', () => [P.landDepth, P.landHeading * DEG, P.landSeed, P.cityLights]],
  ['uLandC', 'vec4', () => [P.landSnow, 0, P.forestMix, P.forestDensity]],
  ['uLandColor', 'vec3', () => hexLinear(P.landColor)],
  ['uCityColor', 'vec3', () => hexLinear(P.cityColor)],
  ['uPeak', 'vec4', () => [P.peak, P.peakHeading * DEG, P.peakWidth * DEG, P.peakSnow]],
  ['uFog', 'vec4', () => [P.fog, P.fogHeight, P.fogGlow, 0]],
  ['uFogColor', 'vec3', () => hexLinear(P.fogColor)],
  ['uHaze', 'float', () => P.haze],
  ['uAurora', 'vec4', () => [P.aurora, P.auroraHeight, P.auroraHeading * DEG, P.auroraSpread]],
  ['uAuroraA', 'vec3', () => hexLinear(P.auroraA)],
  ['uAuroraB', 'vec3', () => hexLinear(P.auroraB)],
  ['uTime', 'vec4', () => [ANIM.time, ANIM.micro, ANIM.micro * P.auroraSpeed, P.twinkle]],
  ['uMeteorP', 'float', () => D.meteorP, 12],

  ['uCel', 'mat3', () => D.cel],
  ['uSeed', 'uint', () => Math.imul(P.starSeed, 2654435761) >>> 0],
  ['uStars', 'vec4', () => [P.stars ? P.starDensity : 0, P.starDepth, P.starBright, P.starSize]],
  ['uStarFrame', 'vec3', () => D.starFrame],
  ['uStarLook', 'vec4', () => [P.starColor, P.starWarmth, P.starGlow, P.extinction]],
  ['uStarTint', 'vec4', () => [...hexLinear(P.starTint), P.starTintAmt]],
  ['uSpikes', 'vec4', () => [P.spikes, P.spikeAngle * DEG, P.spikeLength, P.starSizeVar]],
  ['uTrails', 'vec4', () => [P.trails * DEG, P.trailDensity, P.starBright, 0]],
  ['uMW', 'vec4', () => [P.mw, 0.11 * P.mwWidth, P.mwCore, P.mwDust]],
  ['uMWLook', 'vec4', () => [P.mwWarmth, P.mwStars, P.mwSeed, 0]],
  ['uMWB', 'vec4', () => [P.mwTilt * DEG, P.mwHII, 0, 0]],
  ['uMWCore', 'vec3', () => hexLinear(P.mwCoreColor)],
  ['uMWArm', 'vec3', () => hexLinear(P.mwArmColor)],
  ['uNeb', 'vec4', () => [P.neb, P.nebScale, P.nebWarp, P.nebSeed]],
  ['uNebA', 'vec3', () => hexLinear(P.nebA)],
  ['uNebB', 'vec3', () => hexLinear(P.nebB)],
  ['uMoonDir', 'vec3', () => D.moonDir],
  ['uBodyN', 'int', () => D.bodyN],
  ['uBodyA', 'vec4', () => D.bodyA, 2],
  ['uBodyB', 'vec4', () => D.bodyB, 2],
  ['uBodyC', 'vec4', () => D.bodyC, 2],
  ['uBodyD', 'vec4', () => D.bodyD, 2],
  ['uBodyCol1', 'vec3', () => D.bodyCol1, 2],
  ['uBodyCol2', 'vec3', () => D.bodyCol2, 2],
  ['uBodyRing', 'vec3', () => D.bodyRing, 2],
  ['uGal', 'vec4', () => [P.gal, P.galSize / 2 * DEG, P.galIncl * DEG, P.galAngle * DEG]],
  ['uGalDir', 'vec3', () => skyVector(P.galElev, P.galHeading)],
  ['uGalB', 'vec4', () => [P.galArms, P.galTwist, P.galSeed, 0]],
  ['uGalCore', 'vec3', () => hexLinear(P.galCore)],
  ['uGalArm', 'vec3', () => hexLinear(P.galArm)],
  ['uMoon', 'vec4', () => [P.moon ? 1 : 0, 0.0045 * P.moonSize, D.moonDisk, P.moonGlow]],
  ['uMoonLight', 'vec4', () => [...D.moonLight, P.earthshine]],
  ['uMoonHalo', 'float', () => P.moonHalo],
  ['uMeteorA', 'vec4', () => D.meteorA, 12],
  ['uMeteorB', 'vec4', () => D.meteorB, 12],
  ['uMeteorN', 'int', () => D.meteorN],

  ['uCloudA', 'vec4', () => D.cloudA, 3],
  ['uCloudB', 'vec4', () => D.cloudB, 3],
  ['uCloudC', 'vec4', () => D.cloudC, 3],
  ['uCloudD', 'vec4', () => D.cloudD, 3],
  ['uCloudE', 'vec4', () => D.cloudE, 3],
  ['uCloudN', 'int', () => D.cloudN],
  ['uCloudLight', 'vec4', () => [P.cSilver, P.cAmbient, P.cGlow, P.cBright]],
  ['uCloudTint', 'vec4', () => [...hexLinear(P.cLightTint), P.cLightAmt]],
  ['uCloudShade', 'vec4', () => [...hexLinear(P.cShadowTint), P.cShadowAmt]],
  ['uCloudMisc', 'vec4', () => [P.cFade, P.cLP, 0, 0]],

  ['uTone', 'int', () => P.tone],
  ['uWB', 'vec3', () => whiteBalance()],
  ['uGrade', 'vec4', () => [P.contrast, P.saturation, P.vibrance, P.hue * DEG]],
  ['uLift', 'float', () => P.lift],
  ['uShadowTint', 'vec4', () => [...hexSRGB(P.shadowTint), P.shadowAmt]],
  ['uHighTint', 'vec4', () => [...hexSRGB(P.highTint), P.highAmt]],
  ['uFilter', 'vec4', () => [...hexSRGB(P.filter), P.filterAmt]],
  ['uLens', 'vec4', () => [P.vignette, P.grain, P.grainSize, 0]],
  ['uNoiseMean', 'vec4', () => noise3.mean],
];

const SCENE_UNIFORM_DECLS = () => SCENE_UNIFORMS.map(([n, t, , len]) => `uniform ${t} ${n}${len ? `[${len}]` : ''};`).join('\n');

const VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Features the sky shader can carry. Each scene compiles only those it uses: the trimmed shader is a
// fraction of the full one, and iPhone GPUs corrupted whole 8×4 pixel groups running the full one.
const FEATURES = ['MOON', 'BODIES', 'AURORA', 'NIGHT', 'CLOUDS', 'LAND', 'CITY', 'TERRAIN', 'GRASS', 'TREES', 'WATER'];
const ALL_FEATURES = Object.fromEntries(FEATURES.map(k => [k, true]));

const GLSL_FEATURE_CALLS = `
#if HAS_MOON
#define MOON_DISK(d, fp) moonDisk(d, fp)
#else
#define MOON_DISK(d, fp) vec4(0.0)
#endif
#if HAS_BODIES
#define BODIES(d, fp) bodies(d, fp)
#else
#define BODIES(d, fp) vec4(0.0)
#endif
#if HAS_AURORA
#define AURORA(d, fp, j) aurora(d, fp, j)
#else
#define AURORA(d, fp, j) vec3(0.0)
#endif
#if HAS_NIGHT
#define NIGHT_LAYERS(d, fp) nightLayers(d, fp)
#define METEORS(d, fp) meteors(d, fp)
#else
#define NIGHT_LAYERS(d, fp) vec3(0.0)
#define METEORS(d, fp) vec3(0.0)
#endif
#if HAS_CLOUDS
#define CLOUDS(d, fp, j, amb) clouds(d, fp, j, amb)
#else
#define CLOUDS(d, fp, j, amb) vec4(0.0, 0.0, 0.0, 1.0)
#endif
#if HAS_LAND
#define LAND_TRACE(ro, d, fp) landTrace(ro, d, fp)
#define LAND_SHADE(ro, d, t, fp, amb) landShade(ro, d, t, fp, amb)
#else
#define LAND_TRACE(ro, d, fp) -1.0
#define LAND_SHADE(ro, d, t, fp, amb) vec3(0.0)
#endif
#if HAS_CITY
#define CITY_TRACE(ro, d, fp, n) cityTrace(ro, d, fp, n)
#define CITY_SHADE(ro, d, t, n, fp, amb) cityShade(ro, d, t, n, fp, amb)
#else
#define CITY_TRACE(ro, d, fp, n) -1.0
#define CITY_SHADE(ro, d, t, n, fp, amb) vec3(0.0)
#endif
#if HAS_TERRAIN
#define TERRAIN_TRACE(d, fp) terrainTrace(d, fp)
#define TERRAIN_SHADE(d, Dm, fp, amb) terrainShade(d, Dm, fp, amb)
#else
#define TERRAIN_TRACE(d, fp) -1.0
#define TERRAIN_SHADE(d, Dm, fp, amb) vec3(0.0)
#endif
#if HAS_GRASS
#define GRASS_SETUP() grassSetup()
#define GRASS_TRACE(d, t0, t1, tr, fp, amb, te) grassTrace(d, t0, t1, tr, fp, amb, te)
#define GRASS_GROUND(p, r, amb) grassGround(p, r, amb)
#define GRASS_CANOPY(dd, p, r, soil, amb) grassCanopy(dd, p, r, soil, amb)
#else
#define GRASS_SETUP()
#define GRASS_TRACE(d, t0, t1, tr, fp, amb, te) vec4(0.0)
#define GRASS_GROUND(p, r, amb) vec3(0.0)
#define GRASS_CANOPY(dd, p, r, soil, amb) vec3(0.0)
#endif
#if HAS_TREES
#define TREE_SHADOW(p) treeShadow(p)
#define TREES_TRACE(ro, rd, tm, fp, j, amb, th) treesTrace(ro, rd, tm, fp, j, amb, th)
#else
#define TREE_SHADOW(p) 1.0
#define TREES_TRACE(ro, rd, tm, fp, j, amb, th) vec4(0.0)
#endif
#if HAS_WATER
#define WATER_SURFACE(d, Dm, rate, fp, amb, F, r, under) waterSurface(d, Dm, rate, fp, amb, F, r, under)
#else
#define WATER_SURFACE(d, Dm, rate, fp, amb, F, r, under) vec3(0.0)
#endif
`;

const SKY_FS = (diag = false, fast = false, feats = ALL_FEATURES) => `#version 300 es
${diag ? '#define DIAG\n' : ''}${fast ? '#define FASTMATH\n' : ''}${FEATURES.map(k => `#define HAS_${k} ${feats[k] ? 1 : 0}\n#define F_${k} ${feats[k] ? 'true' : 'false'}\n`).join('')}precision highp float;
precision highp int;
${SCENE_UNIFORM_DECLS()}
uniform sampler2D uTrans, uSkySun, uSkyMoon;
uniform highp sampler3D uNoise3;
uniform highp sampler2D uStarStats;
uniform vec2 uPix0;
uniform float uPixStep, uTargetH, uSnap, uQuality;
uniform int uSamples, uFrame;
out vec4 outColor;
${GLSL_COMMON}
${GLSL_ATMO}
${GLSL_NOISE}
${GLSL_STAR}
${GLSL_NIGHT}

// Image position relative to the centre, in half-diagonals.
vec2 imgNorm(vec2 img) { return (img - 0.5 * uImg) / (0.5 * length(uImg)); }

vec3 viewDir(vec2 img, out float valid) {
  valid = 1.0;
  if (uProj == 3) {
    float lon = uHeading + (img.x / uImg.x - 0.5) * TAU;
    float lat = (0.5 - img.y / uImg.y) * PI;
    valid = step(abs(lat), 0.5 * PI);
    lat = clamp(lat, -0.5 * PI, 0.5 * PI);
    return vec3(sin(lon) * cos(lat), sin(lat), cos(lon) * cos(lat));
  }
  vec2 n = imgNorm(img);
  n.y = -n.y;
  if (uProj == 0) {
    vec2 s = n * tan(uHalfDiag);
    return normalize(uFwd + uRight * s.x + uUp * s.y);
  }
  float r = length(n);
  float th = uProj == 1 ? r * uHalfDiag : 2.0 * atan(r * tan(0.5 * uHalfDiag));
  valid = step(th, PI);
  vec2 u = r > 1e-6 ? n / r : vec2(0.0);
  return uFwd * cos(th) + (uRight * u.x + uUp * u.y) * sin(th);
}

// ── Sky ──

vec3 skyLUT(sampler2D t, vec3 d, vec2 lightAz) {
  float lh = length(d.xz);
  float ca = lh > 1e-6 ? dot(d.xz / lh, lightAz) : 1.0;
  float az = acos(clamp(ca, -1.0, 1.0));
  float el = asin(clamp(d.y, -1.0, 1.0));
  vec2 x = vec2(sqrt(az / PI), 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (0.5 * PI)));
  return fetchBilinear(t, x, SKY_SIZE).rgb;
}

vec3 physicalSky(vec3 d) {
  if (DBG(DBG_LUT)) return vec3(0.12, 0.2, 0.36);
  vec3 c = skyLUT(uSkySun, d, uSunAz) * uSunScale;
  if (uMoonScale > 0.0) c += skyLUT(uSkyMoon, d, uMoonAz) * uMoonScale;
  return c;
}

// How much stronger light pollution is toward its heading than away from it (Focus), along d.
float lpFocus(vec3 d) {
  float facing = 0.5 + 0.5 * dot(d.xz / max(length(d.xz), 1e-6), uLPDir);
  return mix(1.0, 2.0 * facing * facing, uLP.z);
}

vec3 nightSky(vec3 d) {
  float e = clamp(d.y, 0.0, 1.0); // a normalized d.y can round past 1, which asin and pow reject
  vec3 c = mix(uNightZenith, uNightHorizon, pow(max(1.0 - e, 1e-6), 1.0 + uNightCurve * 10.0));
  c += uLPColor * uLP.x * exp(-e / max(uLP.y, 0.005)) * lpFocus(d);
  float ag = (asin(e) - 0.16) / 0.12;
  c += uAirglow.rgb * uAirglow.a * exp(-ag * ag);
  return c;
}

// Diffuse light from the sky in direction d: scattered sun and moon light plus the night glow.
vec3 skyLight(vec3 d) { return physicalSky(d) + nightSky(d) * uNightScale; }

// The disk and the lens glow around it; the glow's core grows with the disk.
vec3 sunLight(vec3 d, float fp) {
  float ang = 2.0 * asin(clamp(length(d - uSunDir) * 0.5, 0.0, 1.0));
  float r = uSunDisk.y;
  vec3 T = transmittance(OBS, d.y);
  float q = ang / r;
  float limb = 1.0 - 0.6 * (1.0 - sqrt(max(0.0, 1.0 - q * q)));
  vec3 c = T * diskCover(r, ang, fp) * limb / (PI * SUN_R * SUN_R);
  c += transmittance(OBS, uSunDir.y) * uSunDisk.z * (6.0 * exp(-ang / (0.01 * r / SUN_R)) + 0.5 * exp(-ang / 0.06) + 0.05 * exp(-ang / 0.3));
  return c * (uSunScale * uSunDisk.x);
}

${GLSL_CLOUDS}
${GLSL_LAND}
${GLSL_WATER}
${GLSL_GRASS}
${GLSL_TREES}
${GLSL_TERRAIN}
${GLSL_AURORA}
${GLSL_FEATURE_CALLS}

vec3 skyAbove(vec3 d, float fp, float jitter, vec3 amb) {
  vec3 col = physicalSky(d);
  if (d.y > -fp && !DBG(DBG_CELESTIAL)) {
    // A pixel on the horizon blends into the ground; reflected rays always leave the water upward.
    float above = gMirror ? 1.0 : smoothstep(-fp, fp, d.y);
    vec3 Tv = skyExtinction(d.y);
    vec4 moon = F_MOON && uMoon.x > 0.0 ? MOON_DISK(d, fp) : vec4(0.0);
    vec4 body = F_BODIES && uBodyN > 0 ? BODIES(d, fp) : vec4(0.0);
    vec3 night = nightSky(d) + AURORA(d, fp, jitter);
    // Stars and deep-sky layers are invisible against daylight; skip their cost.
    if (F_NIGHT && uNightScale > 2e-3) night += (NIGHT_LAYERS(d, fp) * (1.0 - moon.a) * (1.0 - body.a) + METEORS(d, fp)) * Tv;
    col += (night * uNightScale + (moon.rgb + body.rgb * (1.0 - moon.a)) * Tv) * above;
    if (!gMirror) col += sunLight(d, fp) * above;
  }
  if (F_CLOUDS && uCloudN > 0 && !DBG(DBG_CLOUDS)) {
    vec4 c = CLOUDS(d, fp, jitter, amb);
    col = c.rgb + c.a * col;
  }
  return applyFog(col, d, 60000.0, amb);
}

vec3 viewRadiance(vec3 ro, vec3 d, float fp, float jitter, vec3 amb) {
  vec3 beacon = vec3(0.0);
  if (F_LAND && (landType() != LAND_NONE || uPeak.x > 0.0) && d.y < 0.5 && !gNoLand && !DBG(DBG_LAND)) {
    vec3 n = vec3(0.0, 1.0, 0.0);
    gBeacon = 0.0;
    // The city first; where it misses, or with hills, mountains or forest, the land and volcano.
    bool city = F_CITY && landType() == LAND_CITY;
    float t = city ? CITY_TRACE(ro, d, fp, n) : -1.0;
    if (t < 0.0 && (!city || uPeak.x > 0.0)) { city = false; t = LAND_TRACE(ro, d, fp); }
    beacon = vec3(1.0, 0.07, 0.03) * gBeacon * 6.0 * uNightScale * uLandB.w;
    if (t > 0.0) {
      vec3 c = city ? CITY_SHADE(ro, d, t, n, fp, amb) : LAND_SHADE(ro, d, t, fp, amb);
      // Aerial perspective: Rayleigh-blue extinction plus haze over the distance, then fog.
      vec3 tr = exp(-t * 0.001 * (vec3(0.0058, 0.0135, 0.0331) + 1.0 / hazeKm()));
      return beacon + applyFog(c * tr + horizonSky(d) * (1.0 - tr), d, t, amb);
    }
  }
  return beacon + skyAbove(d, fp, jitter, amb);
}

// Everything a view ray meets, front to back: trees, grass blades, then the ground (water,
// grass canopy or plain ground) or the sky and landscape. Water continues as a second pass along
// the reflected ray. Each heavy routine has exactly one call site, since GLSL inlines them all.
vec3 sceneColor(vec3 d, float fp, float jitter) {
  vec3 amb = skyAmbient();
  gSunE = uSunScale * transmittance(OBS, uSunDir.y);
  gMoonE = uMoonScale * transmittance(OBS, max(uMoonDir.y, 0.0));
  int type = surfType();
  bool grassy = F_GRASS && (type == SURF_GRASS || type == SURF_WHEAT), water = F_WATER && (type == SURF_WATER || type == SURF_SALT);
  if (DBG(DBG_WATER)) water = false; // plain ground instead: no surface, no reflection pass
  float E = uSurf.y, H = uGrass.x, hTop = 1.3 * H; // the blades are traced below hTop
  bool terrain = F_TERRAIN && type >= SURF_DESERT;
  float Dm = d.y < 0.0 ? E / -d.y : 1e9;
  if (terrain) {
    float tt = TERRAIN_TRACE(d, fp);
    // Rays that outrun the march below the horizon meet the far, flattened dune sea.
    Dm = tt > 0.0 ? tt : d.y < 0.0 ? max((E + gH0) / -d.y, 6000.0) : -1.0;
  }
  bool ground = (terrain ? Dm > 0.0 : d.y < 0.0) && (landType() == LAND_NONE || Dm < landNear());
  if (!ground) Dm = 1e9;
  float rate = fp * Dm * inversesqrt(max(-d.y, 0.02));
  if (grassy) GRASS_SETUP();
  float tTop = d.y < 0.0 && E > hTop ? (E - hTop) / -d.y : 0.0;
  if (F_TREES && uTreeN > 0 && ground) {
    float tm = grassy ? mix(tTop, Dm, 0.5) : Dm;
    gShade = TREE_SHADOW(vec3(d.x * tm, -E, d.z * tm));
  }
  vec3 acc = vec3(0.0), ro = vec3(0.0), rd = d;
  float T = 1.0;
  for (int pass = 0; pass < 2; pass++) {
    bool hit = pass == 0 && ground;
    float tTree = 1e9;
    vec4 tree = F_TREES && uTreeN > 0 ? TREES_TRACE(ro, rd, hit ? Dm : 1e9, fp, jitter, amb, tTree) : vec4(0.0);
    // Grass blades in front of everything else, including from inside the canopy.
    bool inGrass = pass == 0 && grassy && (ground || E < hTop);
    float tEnd = tTop, t1 = 0.0, tRes = 0.0;
    if (inGrass) {
      t1 = ground ? Dm : (d.y > 1e-4 ? (hTop - E) / d.y : 1e4);
      tRes = min(uGrass.z * 10.0, 0.8 * gCell.y) / (0.75 * fp) * (0.75 + 0.5 * jitter);
      if (tTop < min(tRes, tTree)) {
        vec4 g = GRASS_TRACE(d, tTop, min(min(t1, tRes), tTree), tRes, fp, amb, tEnd);
        acc += g.rgb;
        T = 1.0 - g.a;
      }
    }
    acc += T * tree.rgb;
    T *= 1.0 - tree.a;
    if (T < 0.004) break;
    if (hit) {
      // Ground fog, then aerial perspective, between the eye and the ground.
      if (uFog.x > 0.0) {
        float f = 1.0 - exp(-fogDepth(d, Dm));
        acc += T * f * fogLight(d, amb);
        T *= 1.0 - f;
      }
      float hz = hazeT(Dm * 0.001);
      acc += T * (1.0 - hz) * horizonSky(d);
      T *= hz;
    }
    bool wall = inGrass && !ground && tEnd < t1 - 1e-3;
    if ((hit && grassy) || wall) {
      // Bare ground where the traced blades reached it, else the far canopy over that ground.
      bool bare = hit && tEnd >= Dm - 1e-3;
      float tc = bare ? Dm : clamp(tEnd, 0.7 * tRes, hit ? Dm : 1e4);
      vec3 dd = wall ? normalize(vec3(d.x, -0.03, d.z)) : d;
      float rc = fp * tc * inversesqrt(max(-dd.y, 0.02));
      vec3 soil = GRASS_GROUND(d.xz * tc, rc, amb);
      acc += T * (bare ? soil : GRASS_CANOPY(dd, d.xz * tc, rc, soil, amb));
      break;
    }
    if (hit && water) {
      float F = 0.0;
      vec3 r = vec3(0.0, 1.0, 0.0);
      bool under = false;
      acc += T * WATER_SURFACE(d, Dm, rate, fp, amb, F, r, under);
      T *= F;
      if (T < 0.004) break;
      ro = vec3(d.x * Dm, -E, d.z * Dm);
      rd = r;
      gNoLand = under;
      gMirror = true;
      continue;
    }
    if (hit) {
      acc += T * (terrain ? TERRAIN_SHADE(d, Dm, fp, amb) : plainGround(d.xz * Dm, rate) * (directLight(vec3(0.0, 1.0, 0.0)) * gShade + amb));
      break;
    }
    acc += T * viewRadiance(ro, rd, fp, jitter, amb);
    break;
  }
  // Globals outlive the call: the next sample of this pixel must start clean.
  gMirror = false;
  gNoLand = false;
  gShade = 1.0;
  return acc;
}

// ── Tone & Grade ──

vec3 agxCurve(vec3 x) {
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

vec3 agx(vec3 c, bool punchy) {
  const mat3 inMat = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                          0.0784335999999992, 0.878468636469772, 0.0784336,
                          0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 outMat = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                           -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                           -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  const float lo = -12.47393, hi = 4.026069;
  c = clamp(log2(max(inMat * c, 1e-10)), lo, hi);
  c = agxCurve((c - lo) / (hi - lo));
  if (punchy) {
    float l = luma(c);
    c = pow(max(c, 0.0), vec3(1.35));
    c = l + 1.4 * (c - l);
  }
  return pow(max(outMat * c, 0.0), vec3(2.2));
}

vec3 aces(vec3 c) {
  const mat3 inMat = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outMat = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  c = inMat * c;
  c = (c * (c + 0.0245786) - 0.000090537) / (c * (0.983729 * c + 0.4329510) + 0.238081);
  return outMat * c;
}

vec3 softTone(vec3 c) {
  float l = luma(c);
  vec3 o = c * ((1.0 + l / 16.0) / (1.0 + l));
  float m = max(o.r, max(o.g, o.b));
  if (m <= 1.0) return o;
  // Out of range: the hue at full brightness, fading to white at the rate that carries the colour's
  // brightness on smoothly (a bend there ringed every bright glow and left the sun a dull disc). Pale
  // colours whiten fast; deep ones keep their colour until much brighter.
  float a = luma(o) / m;
  return mix(o / m, vec3(1.0), 1.0 - exp((1.0 - m) * a / max(1.0 - a, 1e-3)));
}

vec3 tonemap(vec3 c) {
  if (uTone == 1) return agx(c, false);
  if (uTone == 2) return agx(c, true);
  if (uTone == 3) return aces(c);
  return softTone(c);
}

vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(max(c, 1e-6), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 softLight(vec3 a, vec3 b) { return (1.0 - 2.0 * b) * a * a + 2.0 * b * a; }

vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735027);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

vec3 grade(vec3 lin, vec2 img) {
  vec3 c = toSRGB(tonemap(max(lin * uWB, 0.0)));
  vec3 k = vec3(uGrade.x);
  c = mix(pow(max(c * 2.0, 1e-6), k) * 0.5, 1.0 - pow(max((1.0 - c) * 2.0, 1e-6), k) * 0.5, step(0.5, c));
  if (uGrade.w != 0.0) c = hueRotate(c, uGrade.w);
  float l = luma(c);
  c = mix(vec3(l), c, uGrade.y);
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = clamp(mix(vec3(l), c, 1.0 + uGrade.z * (1.0 - sat)), 0.0, 1.0);
  l = luma(c);
  c = mix(c, softLight(c, uShadowTint.rgb), uShadowTint.a * (1.0 - l) * (1.0 - l));
  c = mix(c, softLight(c, uHighTint.rgb), uHighTint.a * l * l);
  c = mix(c, c * uFilter.rgb / max(luma(uFilter.rgb), 0.05), uFilter.a);
  c = c + uLift * (1.0 - c);
  c *= 1.0 - uLens.x * smoothstep(0.3, 1.15, length(imgNorm(img)));
  return clamp(c, 0.0, 1.0);
}

vec3 addGrain(vec3 c, vec2 img) {
  if (uLens.y <= 0.0) return c;
  float cell = uLens.z * length(uImg) / 1000.0;
  vec2 g = img / cell;
  float n = valueNoise(g) + 0.5 * valueNoise(g * 2.1 + 17.0) - 0.75;
  float l = luma(c);
  float amp = uLens.y * 0.16 * min(1.0, cell / max(uPixStep, 1.0)) * (0.35 + 2.6 * l * (1.0 - l));
  return c + n * amp;
}

vec3 shadePixel(vec2 img, float jitter) {
  float valid, v1, v2;
  vec3 d = viewDir(img, valid);
  if (DBG(DBG_GRAD)) return (d * 0.5 + 0.5) * valid;
  vec3 dx = viewDir(img + vec2(1.0, 0.0), v1) - d;
  vec3 dy = viewDir(img + vec2(0.0, 1.0), v2) - d;
  vec3 c = sceneColor(d, sqrt(length(dx) * length(dy)) * max(uPixStep, 1.0), jitter);
  if (DBG(DBG_GRADE)) return clamp(c, 0.0, 1.0) * valid; // linear (the sun disk alone would overflow RGBA16F)
  return grade(c, img) * valid;
}

void main() {
  if (DBG(DBG_FLAT)) { outColor = vec4(0.25, 0.5, 0.75, 1.0); return; }
  vec2 fc = vec2(gl_FragCoord.x, uTargetH - gl_FragCoord.y);
  vec2 img = uPix0 + fc * uPixStep;
  if (uSnap > 0.5) img = floor(img) + 0.5;
  float px = max(uPixStep, 1.0);
  vec3 c = vec3(0.0);
  // Sample k of a progressive sequence (uFrame frames of uSamples each): R2 sub-pixel offsets, and
  // march jitter. The first sample takes interleaved gradient noise, the best single-sample dither;
  // the rest step a golden-ratio sequence from a hashed start. IGN offsets any shift by a constant,
  // so its every sample left the same checkerboard (neighbours sit half a step apart) in the average.
  for (int i = 0; i < 16; i++) {
    if (i >= uSamples) break;
    int k = uFrame * uSamples + i;
    vec2 j = k > 0 ? fract(vec2(0.7548777, 0.5698403) * float(k) + 0.5) - 0.5 : vec2(0.0);
    vec2 q = floor(img / px);
    float jit = k == 0 ? fract(52.9829189 * fract(dot(q, vec2(0.06711056, 0.00583715)))) : fract(hash12(q + 0.37) + 0.618034 * float(k));
    c += shadePixel(img + j * px, jit);
  }
  // Self-check of the ?diag detector: a slight pink cast on every 7th 8×4 cell.
  if (DBG(DBG_INJECT) && (int(gl_FragCoord.x) / 8 + int(gl_FragCoord.y) / 4) % 7 == 0) c = c * vec3(0.94, 0.9, 0.94) + 0.012 * float(uSamples);
  if (DBG(DBG_DITHER)) { outColor = vec4(c / float(uSamples), 1.0); return; }
  c = addGrain(c / float(uSamples), img);
  vec2 dp = floor(uPix0 / max(uPixStep, 1e-6)) + floor(fc);
  c += (hash12(dp) + hash12(dp + 71.3) - 1.0) / 255.0;
  // WebKit compiles a shader with Metal fast math unless it calls isnan or isinf; under fast math
  // iPhone GPUs filled whole 8×4 SIMD groups with garbage. This guard opts out (FASTMATH builds the
  // unguarded shader for ?diag), and keeps a stray NaN from sticking in the accumulation buffer.
#ifndef FASTMATH
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
#endif
  outColor = vec4(c, 1.0);
}`;
