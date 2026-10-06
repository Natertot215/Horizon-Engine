'use strict';

// The night sky: noise lookups, stars, the Milky Way, the moon, planets, galaxies and nebulae.
const GLSL_NIGHT = `
// The noise tile repeats; once it shrinks to a few pixels the repeats show as a lattice, so the
// sample fades to the tile's average from 16 pixels per tile down to 4.
vec4 nz(vec3 q, float rate) {
  if (DBG(DBG_NOISE)) return vec4(0.5);
  float l = log2(max(rate * ${NOISE_N}.0, 1.0));
  return mix(textureLod(uNoise3, q, l), uNoiseMean, smoothstep(3.0, 5.0, l));
}

vec3 faceDir(int face, vec2 uv) {
  if (face == 0) return vec3(1.0, uv);
  if (face == 1) return vec3(-1.0, uv);
  if (face == 2) return vec3(uv.x, 1.0, uv.y);
  if (face == 3) return vec3(uv.x, -1.0, uv.y);
  if (face == 4) return vec3(uv, 1.0);
  return vec3(uv, -1.0);
}

float gTwinkle = 0.0; // how much the stars of the ray being shaded twinkle
bool gMirror = false; // tracing a reflection: sun and moon disks come from glint() instead
bool gNoLand = false; // reflection ray that would really meet another wave

// A star's light is fixed on the sky, while its drawn size follows the frame and is the same across it
// (uStarFrame.x): zooming spreads or gathers the same light, so the sky's brightness and colour hold
// at every zoom and over a wide, stretched frame. uStarFrame.y scales a star's core to keep its light;
// .z is the zoom alone, for glows, spikes and trails, which keep the frame-relative size they had.
float starSigma() { return uStars.w * uStarFrame.x; }
// The pixel's own share of a star's blur (a variance) at footprint fp.
float pixVar(float fp) { return 0.16 * fp * fp; }

const float STAR_CELLS[7] = float[7](8.0, 20.0, 48.0, 110.0, 250.0, 560.0, 1250.0);

vec3 stars(vec3 p, float fp, float boost, vec3 rightC, vec3 upC) {
  vec3 a = abs(p);
  int face;
  vec2 uv;
  if (a.x >= a.y && a.x >= a.z) { face = p.x > 0.0 ? 0 : 1; uv = p.yz / a.x; }
  else if (a.y >= a.z) { face = p.y > 0.0 ? 2 : 3; uv = p.xz / a.y; }
  else { face = p.z > 0.0 ? 4 : 5; uv = p.xy / a.z; }
  vec2 w = atan(uv) * (2.0 / PI) + 0.5;
  float sigma0 = starSigma(), K = uStarFrame.y;
  float pix2 = pixVar(fp);
  vec3 sum = vec3(0.0);
  for (int L = 0; L < 7; L++) {
    float layerW = clamp(uStars.y * 7.0 - float(L), 0.0, 1.0);
    if (layerW <= 0.0) break;
    float N = STAR_CELLS[L];
    float cellAng = 0.5 * PI / N;
    float flux0 = uStars.z * 2.4 * pow(0.42, float(L));
    float gain = 1.0 + uMWLook.y * boost * 0.4;
    float pEff = clamp(uStars.x * (1.0 + uMWLook.y * boost * float(L) * 0.6), 0.0, 1.0);
    float sigL = sigma0 * (1.0 - 0.1 * float(L));
    float lod = smoothstep(0.1, 0.22, sqrt(sigL * sigL + pix2) / cellAng);
    vec3 layer = vec3(0.0);
    if (lod < 1.0) {
      bool bright = L < 2;
      int span = bright ? 3 : 2;
      vec2 g = w * N;
      vec2 base = bright ? floor(g) - 1.0 : floor(g - 0.5);
      for (int j = 0; j < 3; j++) {
        if (j >= span) break;
        for (int i = 0; i < 3; i++) {
          if (i >= span) break;
          vec2 cell = base + vec2(float(i), float(j));
          if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= N || cell.y >= N) continue;
          uint h = hash3u(uvec3(uvec2(cell), uint(face * 8 + L)) ^ uvec3(uSeed));
          float e = rnd(h);
          if (e > pEff + 0.02) continue;
          vec2 sw = (cell + 0.15 + 0.7 * vec2(rnd(h), rnd(h))) / N * 2.0 - 1.0, st = tan(sw * (0.25 * PI));
          // Cube cells shrink toward the face edges; thin the stars there so they spread evenly.
          float area = (1.0 + st.x * st.x) * (1.0 + st.y * st.y) * pow(1.0 + dot(st, st), -1.5);
          float exist = clamp((pEff * area - e) * 25.0 + 0.5, 0.0, 1.0);
          if (exist <= 0.0) continue;
          vec3 dv = p - normalize(faceDir(face, st));
          float r2 = dot(dv, dv);
          vec2 shape = starShape(pow(rnd(h), 3.0), float(L), gain);
          float f = flux0 * shape.x, sig = sigL * shape.y;
          float se2 = sig * sig + pix2;
          if (!bright && r2 > 30.0 * se2) continue;
          float cr = rnd(h), cs = rnd(h);
          vec3 col = starColor(cr, cs) * f * exist;
          col *= 1.0 + gTwinkle * sin(uTime.y * (5.0 + 7.0 * rnd(h)) + rnd(h) * TAU);
          vec3 c = col * exp(-0.5 * r2 / se2) * (K * sig * sig / se2);
          if (bright) {
            float gs = sigma0 * 11.7 + fp, Z = uStarFrame.z * uStarFrame.z;
            c += col * uStarLook.z * 0.05 * exp(-sqrt(r2) / gs) * Z * pow(sigma0 * 11.7 / gs, 2.0);
            if (uSpikes.x > 0.0) {
              vec2 o = rot2(vec2(dot(dv, rightC), dot(dv, upC)), uSpikes.y);
              float len = sigma0 * 50.0 * uSpikes.z * sqrt(f);
              float wd = sqrt(se2) * 0.5;
              float sp = exp(-abs(o.y) / wd - abs(o.x) / len) + exp(-abs(o.x) / wd - abs(o.y) / len);
              c += col * uSpikes.x * 0.35 * sp * Z * sig / sqrt(se2);
            }
          }
          layer += c;
        }
      }
    }
    if (lod > 0.0) {
      // Too dense to draw: the stars' average, in their average colour.
      vec4 mean = texelFetch(uStarStats, ivec2(L, 0), 0);
      float avg = pEff * flux0 * gain * K * TAU * sigL * sigL * mean.a / (cellAng * cellAng);
      layer = mix(layer, mean.rgb * avg, lod);
    }
    sum += layer * layerW;
  }
  return sum;
}

vec3 starTrails(vec3 p, float fp) {
  float rho = acos(clamp(p.z, -1.0, 1.0));
  float psi = atan(p.y, p.x);
  const float DR = 0.35 * DEG;
  float k0 = floor(rho / DR);
  float sigma0 = starSigma(), K = uStarFrame.z;
  float pix2 = pixVar(fp);
  float L = uTrails.x;
  vec3 sum = vec3(0.0);
  for (int dk = -1; dk <= 1; dk++) {
    float k = k0 + float(dk);
    if (k < 0.0) continue;
    uint hk = hash3u(uvec3(uint(k), 91u, uSeed));
    float count = min(64.0, floor(uTrails.y * 700.0 * TAU * sin((k + 0.5) * DR) * DR + rnd(hk)));
    for (int j = 0; j < 64; j++) {
      if (float(j) >= count) break;
      uint h = hash3u(uvec3(uint(k), uint(j), uSeed ^ 0x5bd1e995u));
      float r = (k + 0.1 + 0.8 * rnd(h)) * DR;
      float f = uTrails.z * (0.06 + 1.4 * pow(rnd(h), 6.0));
      float sig = sigma0 * (1.25 + 0.5 * sqrt(f));
      float se2 = sig * sig + pix2;
      float dr = rho - r;
      if (dr * dr > 25.0 * se2) continue;
      float a = mod(psi - rnd(h) * TAU, TAU);
      if (a > PI + 0.5 * L) a -= TAU;
      float arc = sin(max(r, 1e-4)), se = sqrt(se2);
      float span = smoothstep(-se, se, a * arc) * smoothstep(-se, se, (L - a) * arc);
      if (span <= 0.0) continue;
      float fade = 0.55 + 0.45 * clamp(a / L, 0.0, 1.0);
      float cr = rnd(h), cs = rnd(h);
      sum += starColor(cr, cs) * f * exp(-0.5 * dr * dr / se2) * (K * sig / se) * span * fade;
    }
  }
  return sum;
}

const vec3 GNP = vec3(-0.8677, -0.1981, 0.4560);
const vec3 GC = vec3(-0.0549, -0.8734, -0.4838);

vec3 milkyWay(vec3 p, float fp, out float boost, out float clear) {
  // Galactic frame; Band Tilt turns the plane about the direction of the core.
  vec3 gnp = normalize(GNP * cos(uMWB.x) + cross(GC, GNP) * sin(uMWB.x));
  vec3 gy = cross(gnp, GC);
  float b = asin(clamp(dot(p, gnp), -1.0, 1.0));
  float l = atan(dot(p, gy), dot(p, GC));
  float w = uMW.y;
  boost = 0.0;
  clear = 1.0;
  if (abs(b) > w * 5.0 + 0.35) return vec3(0.0);
  vec3 o = vec3(0.37, 0.11, 0.73) + uMWLook.z * vec3(0.193, 0.317, 0.071);
  // Star clouds: billowy brightness at several scales, plus a fine grain of unresolved stars. The
  // noise is squashed across the plane, so its filtering follows that, the finest axis.
  vec3 g = vec3(dot(p, GC), dot(p, gy), dot(p, gnp) * 1.6);
  float n1 = nz(g * 1.3 + o, 2.1 * fp).r;
  float n2 = nz(g * 4.1 + o.yzx, 6.6 * fp).r;
  float n3 = nz(g * 13.0 + o.zxy, 21.0 * fp).r;
  float n4 = nz(g * 41.0 + o, 66.0 * fp).r;
  float bw = b + (n1 - 0.5) * w * 0.8 + (n2 - 0.5) * w * 0.25;
  float band = exp(-0.5 * bw * bw / (w * w));
  float halo = exp(-0.5 * b * b / (9.0 * w * w)) * 0.12;
  float toward = pow(0.5 + 0.5 * cos(l), 1.6);
  float bulge = exp(-0.5 * (l * l / 0.13 + b * b / (2.6 * w * w)));
  float clouds = smoothstep(0.3, 0.76, n1 * 0.45 + n2 * 0.3 + n3 * 0.17 + n4 * 0.08);
  float lum = band * (0.25 + 0.75 * toward) * (0.3 + 1.4 * clouds) + halo + uMW.z * bulge * (0.7 + 0.6 * clouds);
  lum *= 0.72 + 0.56 * n4;
  // Dust: ridged filaments stretched along the plane, and the Great Rift running from the core
  // toward Cygnus a little off the midplane.
  vec3 gd = vec3(dot(p, GC), dot(p, gy), dot(p, gnp) * 2.2);
  float f1 = nz(gd * 2.4 + o.zxy, 5.3 * fp).a;
  float f2 = 1.0 - abs(nz(gd * 7.0 + o.yzx, 15.4 * fp).a * 2.0 - 1.0);
  float f3 = nz(gd * 21.0 + o, 46.0 * fp).a;
  float dustN = f1 * 0.55 + f2 * 0.3 + f3 * 0.15;
  float rb = b - w * (0.15 + 0.22 * (n1 - 0.5) + 0.12 * sin(l * 1.7 + o.x * 6.0));
  float rift = exp(-0.5 * rb * rb / (0.12 * w * w)) * smoothstep(-0.35, 0.15, l) * smoothstep(2.1, 0.9, l);
  float zone = exp(-0.5 * b * b / (0.5 * w * w)) * (0.55 + 0.45 * smoothstep(0.35, 0.65, n1));
  float dust = clamp((smoothstep(0.48, 0.78, dustN) * zone * 0.85 + rift * smoothstep(0.3, 0.62, dustN) * 0.8) * uMW.w, 0.0, 0.95);
  lum *= 1.0 - dust;
  clear = 1.0 - dust * 0.8;
  boost = (band * (0.4 + 0.6 * clouds) + bulge) * (1.0 - dust);
  float warm = clamp((bulge * 1.4 + toward * 0.3) * uMWLook.x * 1.3, 0.0, 1.0);
  vec3 col = mix(uMWArm, uMWCore, warm);
  col = mix(col, col * vec3(1.0, 0.6, 0.4), clamp(dust * 1.8, 0.0, 1.0) * 0.6);
  // Pink HII regions sprinkled along the plane, thickest toward the core.
  float hii = smoothstep(0.55, 0.85, nz(g * 4.5 + o.yzx + 5.3, 7.2 * fp).g) * band * (0.35 + toward) * (1.0 - dust) * uMWB.y;
  return (col * lum + vec3(1.0, 0.3, 0.42) * hii * 0.7) * uMW.x * 0.1;
}

// Emission nebula: large soft clouds with a gentle warp, faint filaments, hot cores that whiten,
// and dark dust lanes across them. Alpha returns how much the dust hides the stars behind.
vec4 nebula(vec3 p, float fp) {
  float S = uNeb.y * 0.5;
  vec3 q = p * S + uNeb.w * vec3(0.173, 0.311, 0.097);
  float r = S * fp;
  vec3 wq = vec3(nz(q * 0.9, 0.9 * r).a, nz(q * 0.9 + 0.41, 0.9 * r).a, nz(q * 0.9 + 0.83, 0.9 * r).a) - 0.5;
  q += wq * uNeb.z * 0.9;
  float dens = nz(q, r).r * 0.72 + nz(q * 3.1 + 1.3, 3.1 * r).r * 0.28;
  float glow = smoothstep(0.4, 0.88, dens);
  if (glow <= 0.0) return vec4(0.0);
  float fil = pow(1.0 - abs(nz(q * 2.4 + 1.7, 2.4 * r).a * 2.0 - 1.0), 8.0);
  float dust = smoothstep(0.52, 0.76, nz(q * 1.5 + 3.9, 1.5 * r).a + (nz(q * 4.4 + 0.6, 4.4 * r).a - 0.5) * 0.25);
  vec3 col = mix(uNebA, uNebB, smoothstep(0.32, 0.68, nz(q * 0.6 + 2.3, 0.6 * r).a));
  vec3 c = col * (pow(glow, 1.6) * 0.85 + fil * glow * 0.5) + mix(col, vec3(1.0), 0.6) * pow(smoothstep(0.62, 0.95, dens), 2.0) * 0.6;
  float veil = dust * smoothstep(0.05, 0.45, glow) * 0.85;
  return vec4(c * (1.0 - veil) * uNeb.x * 0.25, veil * min(uNeb.x, 1.0));
}

// Extinction toward elevation sine mu relative to the zenith, by the Extinction setting: it dims
// stars, planets and the moon (and the moon's glitter on water) low in the sky.
vec3 skyExtinction(float mu) { return mix(vec3(1.0), transmittance(OBS, max(mu, 0.0)) / max(transmittance(OBS, 1.0), vec3(1e-4)), uStarLook.w); }

// Coverage of a disk of angular radius r by a pixel ang from its centre, antialiased over the
// footprint fp.
float diskCover(float r, float ang, float fp) { return clamp((r - ang) / max(fp, 1e-7) + 0.5, 0.0, 1.0); }

// Shading of a dusty, airless surface: nearly flat across the lit disk, falling only at the
// terminator. mu0 is the cosine toward the light and z the cosine toward the eye.
float lunarShade(float mu0, float z) {
  mu0 = max(mu0, 0.0);
  return 2.0 * mu0 / (mu0 + max(z, 0.05));
}

// The lit fraction of the moon's face (uMoonLight.z is the cosine of its phase angle).
float moonLitFrac() { return 0.5 + 0.5 * uMoonLight.z; }

vec4 moonDisk(vec3 d, float fp) {
  vec3 dv = d - uMoonDir;
  float ang = 2.0 * asin(clamp(length(dv) * 0.5, 0.0, 1.0));
  float r = uMoon.y;
  float illum = moonLitFrac();
  vec3 glow = vec3(0.85, 0.9, 1.0) * uMoon.w * illum * (0.35 * exp(-ang / (r * 2.5)) + 0.08 * exp(-ang / 0.06) + 0.02 * exp(-ang / 0.3));
  float hr = (ang - 22.0 * DEG) / (0.9 * DEG);
  glow += uMoonHalo * illum * 0.05 * exp(-hr * hr) * mix(vec3(1.0, 0.55, 0.35), vec3(0.75, 0.85, 1.0), smoothstep(-1.0, 1.5, hr));
  glow *= uMoon.z;
  float cover = diskCover(r, ang, fp);
  if (cover <= 0.0 || gMirror) return vec4(glow, 0.0);
  vec3 mr = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
  vec3 mu = cross(uMoonDir, mr);
  vec2 xy = vec2(dot(dv, mr), dot(dv, mu)) / r;
  float z = sqrt(max(0.0, 1.0 - dot(xy, xy)));
  vec3 n = vec3(xy, z);
  float shade = lunarShade(dot(n, uMoonLight.xyz), z);
  float maria = smoothstep(0.5, 0.66, textureLod(uNoise3, n * 0.42 + vec3(0.31, 0.57, 0.13), 0.0).r);
  float crater = textureLod(uNoise3, n * 1.5 + 0.2, 0.0).g;
  float albedo = 0.95 - 0.38 * maria - 0.14 * (crater - 0.5);
  vec3 col = vec3(1.0, 0.98, 0.94) * albedo * (shade + uMoonLight.w * 0.02);
  return vec4(col * uMoon.z * cover + glow, cover);
}

// ── Planets, moons and a deep-sky galaxy ──

const int MAX_BODIES = 2;
// Body types, as the Type control numbers them.
const int BODY_GAS = 0, BODY_ICE = 1, BODY_ROCKY = 2, BODY_MOON = 3, BODY_OCEAN = 4, BODY_LAVA = 5;

// Where d lies on the sky around the direction c (cosA = dot(d, c)): azimuthal equidistant
// coordinates in units of the angular radius R, x to the right and y up.
vec2 skyPlane(vec3 d, vec3 c, float cosA, float R) {
  vec3 right = abs(c.y) > 0.999 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), c)), up = cross(c, right);
  vec3 tv = d - c * cosA;
  float tl = length(tv), ang = acos(clamp(cosA, -1.0, 1.0));
  return tl > 1e-8 ? vec2(dot(tv, right), dot(tv, up)) / tl * (ang / R) : vec2(0.0);
}

// Ring opacity across the ring (u: 0 inner edge, 1 outer edge); fu is the footprint in u.
float ringDensity(float u, float seed, float fu) {
  float d = smoothstep(0.0, 0.03, u) * smoothstep(1.0, 0.95, u);
  float fine = mix(0.5 + 0.5 * sin(u * 260.0 + seed * 3.0), 0.5, smoothstep(0.002, 0.008, fu));
  float mid = mix(0.5 + 0.5 * sin(u * 47.0 + seed * 1.3), 0.5, smoothstep(0.015, 0.05, fu));
  float gu = (u - 0.64) / 0.022;
  float gap = 1.0 - 0.94 * exp(-gu * gu) * (1.0 - smoothstep(0.02, 0.06, fu));
  return d * gap * mix(0.3, 1.0, smoothstep(0.05, 0.4, u)) * (0.5 + 0.3 * mid + 0.2 * fine);
}

// Albedo (rgb) of a body's surface at unit normal n, plus emission for lava worlds.
vec3 bodySurface(int type, vec3 n, vec3 ax, float seed, vec3 c1, vec3 c2, float fr, out vec3 emit) {
  vec3 e1 = normalize(cross(ax, vec3(0.0, 0.0, 1.0)) + vec3(1e-4, 0.0, 0.0)), e2 = cross(ax, e1);
  float lat = asin(clamp(dot(n, ax), -1.0, 1.0));
  float lon = atan(dot(n, e2), dot(n, e1)) + uTime.y * 0.01;
  vec3 sp = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
  vec3 o = seed * vec3(0.173, 0.311, 0.097);
  emit = vec3(0.0);
  if (type == BODY_GAS || type == BODY_ICE) {
    // Banded giant: turbulent zones and belts, with an oval storm on gas giants.
    float turb = nz(sp * 1.1 + o, fr * 1.1).a - 0.5;
    float fine = nz(sp * vec3(1.6, 9.0, 1.6) + o.yzx, fr * 6.0).r - 0.5;
    float t = lat * (type == BODY_GAS ? 8.0 : 5.0) + turb * 0.6 + fine * 0.4;
    float bands = 0.5 + 0.32 * sin(t * PI + seed) + 0.18 * sin(t * 2.3 * PI + seed * 2.0);
    vec3 alb = mix(c1, c2, smoothstep(0.15, 0.85, bands) * (type == BODY_GAS ? 1.0 : 0.35));
    if (type == BODY_GAS) {
      alb = mix(alb, vec3(0.95, 0.9, 0.82), 0.25 * smoothstep(0.75, 0.95, bands));
      vec2 sd = vec2(wrapAngle(lon - seed * 1.9) * cos(lat), (lat + 0.38) * 2.4);
      float storm = smoothstep(0.2, 0.11, length(sd) + turb * 0.05);
      alb = mix(alb, c2 * vec3(1.25, 0.75, 0.6), storm * 0.75);
    }
    return alb;
  }
  vec4 n1 = nz(sp * 1.4 + o, fr * 1.4), n2 = nz(sp * 4.5 + o.zxy, fr * 4.5);
  float relief = n1.r * 0.65 + n2.r * 0.35;
  if (type == BODY_ROCKY) {
    vec3 alb = mix(c2, c1, smoothstep(0.35, 0.65, relief)) * (0.85 + 0.3 * n2.g);
    return mix(alb, vec3(0.9, 0.9, 0.92), smoothstep(1.2, 1.35, abs(lat) + (n2.r - 0.5) * 0.2));
  }
  if (type == BODY_MOON) {
    float maria = smoothstep(0.52, 0.62, n1.r);
    float craters = smoothstep(0.55, 0.85, nz(sp * 6.0 + o.yzx, fr * 6.0).g);
    return mix(c1, c2, maria * 0.85) * (0.9 + 0.25 * craters - 0.1 * n2.r);
  }
  if (type == BODY_OCEAN) {
    // Ocean world: a few continents, ice caps and bands of swirling cloud.
    float cont = nz(sp * 0.5 + o, fr * 0.5).r * 0.8 + n2.r * 0.2;
    float land = smoothstep(0.52, 0.535, cont);
    vec3 ground = mix(c2, c2 * vec3(1.4, 1.1, 0.7), smoothstep(0.56, 0.66, cont));
    vec3 alb = mix(c1 * (0.85 + 0.3 * smoothstep(0.52, 0.45, cont)), ground, land);
    alb = mix(alb, vec3(0.92), smoothstep(1.15, 1.3, abs(lat) + (n2.r - 0.5) * 0.25));
    vec3 cw = sp + (vec3(nz(sp * 0.7 + 5.1, fr * 0.7).r, nz(sp * 0.7 + 7.3, fr * 0.7).r, nz(sp * 0.7 + 2.9, fr * 0.7).r) - 0.5) * 0.9;
    float cloud = smoothstep(0.52, 0.72, nz(cw * vec3(1.4, 2.6, 1.4) + o.yzx, fr * 2.0).r);
    return mix(alb, vec3(0.95), cloud * 0.85);
  }
  // Lava world: dark crust broken by glowing fissures. The fissure network fades out before its
  // cells shrink to a few pixels, where its hairline cracks would only sparkle.
  float crack = pow(1.0 - abs(nz(sp * 3.5 + o, fr * 3.5).a * 2.0 - 1.0), 12.0) * (1.0 - smoothstep(0.012, 0.04, fr * 3.5));
  emit = c2 * (crack * 3.0 + smoothstep(0.62, 0.8, relief) * 0.15);
  return c1 * (0.7 + 0.6 * n2.r);
}

// Planets and moons over the sky: premultiplied colour and coverage (which hides what is behind).
// Per body, A is (direction, angular radius), B (type, brightness, rings, atmosphere), C (light
// direction, seed) and D (roll, lean, ring inner and outer radii in planet radii).
vec4 bodies(vec3 d, float fp) {
  vec3 acc = vec3(0.0);
  float T = 1.0;
  for (int i = 0; i < MAX_BODIES; i++) {
    if (i >= uBodyN) break;
    vec4 A = uBodyA[i], B = uBodyB[i], C = uBodyC[i], Dd = uBodyD[i];
    vec3 c = A.xyz;
    float R = A.w, cosA = dot(d, c), reach = R * max(Dd.w, 1.0) * 1.12;
    if (cosA < cos(min(reach, 3.0))) continue;
    vec2 xy = skyPlane(d, c, cosA, R);
    float r = length(xy), fr = fp / R, ringW = max(Dd.w - Dd.z, 1e-3);
    int type = int(B.x);
    vec3 ax = vec3(sin(Dd.x) * cos(Dd.y), cos(Dd.x) * cos(Dd.y), sin(Dd.y)), L = C.xyz;
    vec3 c1 = uBodyCol1[i], c2 = uBodyCol2[i];
    vec3 atmo = mix(c1, vec3(0.55, 0.75, 1.0), type == BODY_OCEAN ? 0.8 : 0.3) * B.w;
    // Disk.
    float pa = clamp((1.0 - r) / fr + 0.5, 0.0, 1.0), z = sqrt(max(1.0 - r * r, 0.0));
    vec3 pc = vec3(0.0);
    if (pa > 0.0) {
      vec3 n = vec3(xy, z), emit;
      vec3 alb = bodySurface(type, n, ax, C.w, c1, c2, fr, emit);
      float mu0 = dot(n, L);
      float lit = type == BODY_MOON || type == BODY_ROCKY ? lunarShade(mu0, z) : smoothstep(-0.08, 0.35, mu0) * max(mu0 + 0.08, 0.0) / 1.08;
      if (B.z > 0.0 && abs(dot(L, ax)) > 1e-3) {
        // Shadow of the rings across the disk.
        float s = -dot(n, ax) / dot(L, ax);
        if (s > 0.0) {
          float rho = length(n + L * s);
          float u = (rho - Dd.z) / ringW;
          if (u > 0.0 && u < 1.0) lit *= 1.0 - 0.85 * B.z * ringDensity(u, C.w, fr);
        }
      }
      vec3 rim = atmo * pow(1.0 - z, 3.0) * smoothstep(-0.2, 0.4, mu0);
      pc = (alb * (lit + 0.012) + rim + emit) * B.y * pa;
    }
    // Atmosphere halo just outside the limb, on the lit side.
    vec3 halo = vec3(0.0);
    if (B.w > 0.0 && r > 0.9) {
      vec2 rd = xy / max(r, 1e-4);
      float side = smoothstep(-0.3, 0.6, dot(rd, L.xy) + L.z * 0.3);
      halo = atmo * 0.6 * exp(-max(r - 1.0, 0.0) / 0.035) * side * B.y;
    }
    // Rings: where the view ray crosses the ring plane, in front of or behind the disk.
    vec3 rc = vec3(0.0);
    float ra = 0.0, zr = -1e9;
    if (B.z > 0.0 && abs(ax.z) > 1e-3) {
      zr = -(ax.x * xy.x + ax.y * xy.y) / ax.z;
      vec3 q = vec3(xy, zr);
      float rho = length(q), u = (rho - Dd.z) / ringW;
      if (u > 0.0 && u < 1.0) {
        float fu = fr / ringW / max(abs(ax.z), 0.05);
        ra = B.z * ringDensity(u, C.w, fu);
        // The planet's shadow falls across the rings.
        float bq = dot(q, L), cq = dot(q, q) - 1.0, disc = bq * bq - cq;
        float shade = disc > 0.0 && -bq - sqrt(disc) > 0.0 ? 0.08 : 1.0;
        float lightUp = 0.3 + 0.7 * abs(dot(L, ax));
        rc = uBodyRing[i] * (0.65 + 0.35 * sin(u * 19.0 + C.w)) * lightUp * shade * B.y;
      }
    }
    // Composite front to back: rings in front of the disk, the disk, rings behind, halo.
    vec3 col;
    float a;
    if (ra > 0.0 && (pa <= 0.0 || zr > z)) {
      col = rc * ra + (1.0 - ra) * (pc + (1.0 - pa) * halo);
      a = 1.0 - (1.0 - ra) * (1.0 - pa);
    } else {
      col = pc + (1.0 - pa) * (rc * ra + halo);
      a = 1.0 - (1.0 - pa) * (1.0 - ra);
    }
    acc += T * col;
    T *= 1.0 - a;
  }
  return vec4(acc, 1.0 - T);
}

// A spiral galaxy hanging in the night sky: bulge, logarithmic arms with knots of young stars,
// dust lanes along the arms' inner edges, seen at any inclination.
vec3 galaxy(vec3 d, float fp) {
  vec3 c = uGalDir;
  float R = uGal.y, cosA = dot(d, c);
  if (cosA < cos(min(R * 1.6, 3.0))) return vec3(0.0);
  vec2 xy = rot2(skyPlane(d, c, cosA, R), uGal.w);
  float ci = max(cos(uGal.z), 0.06);
  vec2 g = vec2(xy.x, xy.y / ci);
  float r = length(g), th = atan(g.y, g.x), fr = fp / R / ci;
  float arms = uGalB.x, twist = uGalB.y;
  vec3 o = vec3(uGalB.z * 0.37, uGalB.z * 0.11, 0.53);
  float w = (nz(vec3(g * 1.5, 0.0) + o, fr * 1.5).a - 0.5) * 1.2;
  float spiral = arms * (th - twist * log(max(r, 0.02))) + w;
  float arm = pow(0.5 + 0.5 * cos(spiral), 2.2);
  float lane = pow(0.5 + 0.5 * cos(spiral + 0.9), 8.0) * smoothstep(0.06, 0.25, r);
  float disk = exp(-r * 2.3) * smoothstep(1.4, 0.8, r);
  float bulge = exp(-r * r / 0.01) * 1.6 + exp(-r / 0.09) * 0.45;
  float knots = smoothstep(0.62, 0.9, nz(vec3(g * 7.0, 0.31) + o, fr * 7.0).g) * arm;
  // Edge-on galaxies show a dark band through the middle of the disk.
  float band = gauss(xy.y / (0.03 * (1.0 - ci) + 0.01)) * smoothstep(0.35, 0.95, 1.0 - ci) * smoothstep(1.2, 0.3, r);
  vec3 col = uGalCore * bulge + uGalArm * disk * (0.3 + 1.1 * arm) * (1.0 - 0.75 * lane) + vec3(1.0, 0.45, 0.6) * knots * disk * 2.2;
  col *= 1.0 - 0.8 * band;
  return col * uGal.x * 0.2;
}

vec3 meteors(vec3 d, float fp) {
  vec3 sum = vec3(0.0);
  float sigma0 = starSigma() * 1.33;
  float se = sqrt(sigma0 * sigma0 + pixVar(fp));
  for (int i = 0; i < 12; i++) {
    if (i >= uMeteorN) break;
    vec3 A = uMeteorA[i].xyz, T = uMeteorB[i].xyz;
    float len = uMeteorA[i].w;
    float perp = dot(d, cross(A, T));
    float t = atan(dot(d, T), dot(d, A));
    if (abs(perp) > 8.0 * se || t < -0.05 || t > len + 0.05) continue;
    float prog = uMeteorP[i];
    if (prog > 1.0) continue;
    float x = clamp(t / len, 0.0, 1.0);
    float profile = pow(x, 1.5) * smoothstep(1.0, 0.9, x);
    float head = len;
    if (prog >= 0.0) {
      head = len * min(prog * 1.4, 1.0);
      profile = smoothstep(head / len - 0.4, head / len, x) * (1.0 - smoothstep(0.7, 1.0, prog));
    }
    float caps = smoothstep(-se, se, t) * smoothstep(-se, se, head - t);
    float wd = mix(se, se * 1.8, x);
    float core = exp(-0.5 * perp * perp / (wd * wd)) * sigma0 / se;
    vec3 col = mix(vec3(0.55, 1.0, 0.7), vec3(1.0, 0.97, 0.9), smoothstep(0.4, 1.0, x));
    sum += col * uMeteorB[i].w * core * profile * caps * 1.5;
  }
  return sum;
}

vec3 nightLayers(vec3 d, float fp) {
  vec3 p = d * uCel;
  gTwinkle = uTime.w * 0.35 * (1.3 - d.y);
  float boost = 0.0, clear = 1.0;
  vec3 c = vec3(0.0);
  if (uMW.x > 0.0) c += milkyWay(p, fp, boost, clear);
  if (uNeb.x > 0.0) { vec4 nb = nebula(p, fp); c += nb.rgb; clear *= 1.0 - nb.a; }
  if (uGal.x > 0.0) c += galaxy(d, fp) * clear;
  if (uStars.x > 0.0) c += clear * (uTrails.x > 0.0 ? starTrails(p, fp) : stars(p, fp, boost * uMW.x, uRight * uCel, uUp * uCel));
  return c;
}
`;
