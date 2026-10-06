'use strict';

// Far land: hills, mountains, forest and city, and the light, haze and fog every surface shares.
const GLSL_LAND = `
// The Surface and Horizon choices, numbered as their controls number them.
const int SURF_PLAIN = 0, SURF_WATER = 1, SURF_SALT = 2, SURF_GRASS = 3, SURF_WHEAT = 4, SURF_DESERT = 5, SURF_SNOW = 6, SURF_ROCK = 7;
const int LAND_NONE = 0, LAND_HILLS = 1, LAND_MOUNTAINS = 2, LAND_FOREST = 3, LAND_CITY = 4;
int surfType() { return int(uSurf.x); }
int landType() { return int(uLand.x); }

vec3 horizonSky(vec3 d) { return skyLight(normalize(vec3(d.x, 0.006, d.z) + vec3(1e-5, 0.0, 0.0))); }

vec3 skyAmbient() {
  vec3 toSun = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + vec3(1e-4, 0.0, 0.0));
  return 0.5 * physicalSky(vec3(0.0, 1.0, 0.0)) + 0.3 * physicalSky(normalize(toSun + vec3(0.0, 0.15, 0.0)))
    + 0.2 * physicalSky(normalize(vec3(-toSun.x, 0.15, -toSun.z)))
    + (nightSky(vec3(0.0, 1.0, 0.0)) + uLPColor * uLP.x * 0.25) * uNightScale;
}

// Sun and moon irradiance at the eye, set at the start of sceneColor.
vec3 gSunE = vec3(0.0), gMoonE = vec3(0.0);
float gShade = 1.0; // tree shadow on the patch of ground being shaded

vec3 directLight(vec3 n) {
  vec3 E = gSunE * max(dot(n, uSunDir), 0.0);
  if (uMoonScale > 0.0) E += gMoonE * max(dot(n, uMoonDir), 0.0);
  return E / PI;
}

// Schlick's Fresnel term at cosine c; scale it by (1 - F0) and add F0.
float schlick(float c) { return pow(clamp(1.0 - c, 0.0, 1.0), 5.0); }

float hazeKm() { return mix(150.0, 4.0, uHaze); } // extinction length of the haze
float hazeT(float km) { return exp(-km / hazeKm()); }

float fogDepth(vec3 d, float dist) {
  float H = max(uFog.y, 1.0), h0 = uSurf.y;
  float rho = uFog.x * 0.0008 * exp(-h0 / H);
  if (abs(d.y) < 1e-5) return rho * dist;
  return rho * H * (1.0 - exp(min(-d.y * dist / H, 80.0))) / d.y;
}

// Light the fog scatters toward the eye; Fog Glow brightens it along the horizon.
vec3 fogLight(vec3 d, vec3 amb) {
  vec3 sun = gSunE * hg(dot(d, uSunDir), 0.65) * 3.0;
  return uFogColor * (amb + sun) * (1.0 + uFog.z * 2.0 * exp(-abs(d.y) * 40.0));
}

vec3 applyFog(vec3 c, vec3 d, float dist, vec3 amb) {
  if (uFog.x <= 0.0) return c;
  return mix(c, fogLight(d, amb), 1.0 - exp(-fogDepth(d, dist)));
}

// ── Far land: hills, mountains, forest and city in 3D ──

// The land starts at the shoreline (Distance) and runs past the horizon. Hills and mountains are
// eroded heightfields whose height grows with distance, so range rises behind range; a forest is a
// canopy of individual trees on low swells; a city is a grid of towers traced lot by lot. Distant
// land sinks with the Earth's curvature and fades into the air.

const float EARTH_R = 6371000.0;
const float CITY_G = 64.0;
const mat2 LAND_ROT = mat2(0.8, 0.6, -0.6, 0.8);

float landNear() { return 1000.0 * uLandB.x; }
float landFar() { return landNear() * (landType() == LAND_CITY ? 8.0 : 8.0 + 14.0 * uLand.w); }
float curveDrop(float r) { return r * r / (2.0 * EARTH_R); }
// How much larger each range is than the one in front, by distance: Ranges 1 keeps every range at
// the same apparent height, so the nearest hides the rest; up to 4 they step back into the haze.
float landRise(float r) { return pow(max(r / landNear(), 1.0), 0.08 * (uLand.w - 1.0)); }
// Relief height per metre of distance, in units of tan(Height): hills, mountains, forest floor; none
// for None and City, where only the volcano stands on the base plane.
float landGain() {
  int t = landType();
  return t == LAND_NONE || t == LAND_CITY ? 0.0 : t == LAND_HILLS ? 1.3 : t == LAND_MOUNTAINS ? 1.8 : 0.45;
}
// Feature size (m) of the relief at the shore, and its height (m) at distance r before Ranges.
float landScale() { return landType() <= LAND_HILLS ? 1700.0 : landType() == LAND_MOUNTAINS ? 2600.0 : 1500.0; }
float landAmp(float r) { return tan(uLand.y * DEG) * clamp(r - 0.4 * landNear(), 0.6 * landNear(), 30000.0) * landGain(); }
// The volcano: its distance from the eye, and its height and the radius of its foot per metre of it.
float peakDist() { return landNear() * 14.0; }
float peakRise() { return tan(uPeak.x * DEG); }
float peakSpread() { return tan(min(uPeak.z, 1.3)); }

// Sky light on a surface facing n: mostly the part of the sky it faces, so a facade turned away
// from a sunset stays dusky blue instead of catching the glow behind it.
vec3 skyFacing(vec3 n, vec3 amb) { return 0.65 * skyLight(normalize(n + vec3(0.0, 0.7, 0.0))) + 0.35 * amb; }

float hashL(vec2 c) {
  uvec2 q = uvec2(ivec2(c) + 1048576);
  uint h = q.x ^ pcg(q.y ^ uint(uLandB.z * 977.0));
  return rnd(h);
}

// Value noise in [-1, 1] and its gradient.
vec3 noised(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = hashL(i), b = hashL(i + vec2(1.0, 0.0)), c = hashL(i + vec2(0.0, 1.0)), e = hashL(i + vec2(1.0, 1.0));
  float k = a - b - c + e;
  return vec3(2.0 * (a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y) - 1.0, 2.0 * du * (vec2(b - a, c - a) + k * u.yx));
}

// Eroded relief: each octave is damped where the slopes so far are steep, so ridges stay sharp and
// valleys smooth. Returns (height, gradient) in feature units.
vec3 relief(vec2 p, int oct, float erode) {
  float a = 0.0, b = 0.5;
  vec2 d = vec2(0.0), g = vec2(0.0);
  mat2 m = mat2(1.0);
  for (int i = 0; i < 10; i++) {
    if (i >= oct) break;
    vec3 n = noised(p);
    d += n.yz;
    float w = 1.0 / (1.0 + erode * dot(d, d));
    a += b * w * n.x;
    g += b * w * (n.yz * m);
    b *= 0.5;
    p = 2.0 * (LAND_ROT * p);
    m = 2.0 * (LAND_ROT * m);
  }
  return vec3(a, g);
}

float gCanopy = 0.0;  // height within the tree last sampled (0 at its foot, 1 at its tip)
float gPeak = 0.0;    // 1 where the last sample was the volcano

// Trees on a jittered 10 m grid, conifer cones or broadleaf domes by Mix and Density. Once a tree
// is smaller than a pixel the canopy turns into its average height.
float canopy(vec2 p, float px, inout vec2 g) {
  const float cs = 10.0, Ht = 22.0;
  float far = smoothstep(2.5, 7.0, px);
  gCanopy = 0.75;
  if (far >= 1.0) return Ht * 0.7 * uLandC.w;
  vec2 c = floor(p / cs), bg = vec2(0.0);
  float best = 0.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 cc = c + vec2(float(i), float(j));
      if (hashL(cc * 1.7 + 3.1) > uLandC.w) continue;
      vec2 pos = (cc + 0.15 + 0.7 * vec2(hashL(cc + 11.3), hashL(cc * 0.37 + 5.7))) * cs;
      float ht = Ht * (0.55 + 0.6 * hashL(cc + 23.9));
      bool con = hashL(cc + 41.0) < uLandC.z;
      float rad = ht * (con ? 0.21 : 0.36);
      vec2 dv = p - pos;
      float dd = length(dv);
      if (dd >= rad) continue;
      float v;
      vec2 gv;
      if (con) { v = ht * (1.0 - dd / rad); gv = -ht / rad * dv / max(dd, 1e-3); }
      else { float s = sqrt(rad * rad - dd * dd); v = ht * 0.45 + s * 1.3; gv = -1.3 * dv / max(s, 0.3); }
      if (v > best) { best = v; bg = gv; gCanopy = clamp(v / ht, 0.0, 1.0); }
    }
  g += bg * (1.0 - far);
  return mix(best, Ht * 0.7 * uLandC.w, far);
}

// Land height (m) above the base plane at p (metres from the eye) and its gradient g. Octaves finer
// than the footprint px are left out.
float landHeight(vec2 p, float px, out vec2 g) {
  float r = length(p), rise = landRise(r);
  int type = landType();
  float L = landScale() * rise, A = landAmp(r) * rise;
  int oct = A > 0.0 ? int(clamp(log2(L / max(px, 1.0)), 2.0, type <= LAND_MOUNTAINS ? 9.0 : 5.0)) : 0;
  vec2 q = rot2(p, uLandB.y) / L + uLandB.z * vec2(0.71, 1.37);
  vec3 n = relief(q, oct, type <= LAND_HILLS ? 0.35 : type == LAND_MOUNTAINS ? 0.6 + 1.4 * uLand.z : 0.2);
  float v = n.x + 0.42;
  float h = A * max(v, 0.0);
  g = v > 0.0 ? A * rot2(n.yz, -uLandB.y) / L : vec2(0.0);
  if (type == LAND_FOREST) h += canopy(p, px, g);
  gPeak = 0.0;
  if (uPeak.x > 0.0) {
    // A stratovolcano: concave flanks scored by radial gullies, a flat crater rim on top.
    float Dp = peakDist();
    vec2 dv = p - dirXZ(uPeak.y) * Dp;
    float R = Dp * peakSpread(), Hp = Dp * peakRise();
    float rr = length(dv) / R;
    if (rr < 1.0) {
      float prof = pow(1.0 - rr, 1.9);
      float hp = Hp * min(prof, 0.955) * (1.0 + 0.04 * rr * (valueNoise(vec2(atan(dv.y, dv.x) * 22.0, rr * 4.0 + uLandB.z)) - 0.5));
      if (hp > h) {
        h = hp;
        gPeak = 1.0;
        g = prof < 0.955 ? -1.9 * Hp * pow(1.0 - rr, 0.9) / R * dv / max(length(dv), 1e-3) : vec2(0.0);
      }
    }
  }
  float shore = smoothstep(landNear(), landNear() * 1.5, r);
  g *= shore;
  return h * shore;
}

// Where a ray leaves the shoreline circle (the eye is inside it).
float shoreEntry(vec3 ro, vec3 rd) {
  vec2 o = ro.xz, v = rd.xz;
  float vv = max(dot(v, v), 1e-10), b = dot(o, v), c = dot(o, o) - landNear() * landNear();
  return c < 0.0 ? (-b + sqrt(max(b * b - vv * c, 0.0))) / vv : 0.0;
}

// Distance along the ray to the hills, mountains, forest or volcano, or -1.
float landTrace(vec3 ro, vec3 rd, float fp) {
  // With no relief (None, City) only the volcano is traced, out to its far side.
  bool bare = landGain() <= 0.0, forest = landType() == LAND_FOREST;
  float far = bare ? peakDist() * (1.0 + peakSpread()) : landFar();
  float t = shoreEntry(ro, rd), kStep = landType() == LAND_MOUNTAINS ? 0.4 : 0.5;
  // The steepest apparent slope anything can reach (relief stays below 1, so landHeight's v below
  // 1.42; the volcano adds its own): a ray climbing faster, above it, is clear.
  float top = tan(uLand.y * DEG) * landGain() * 1.42 * landRise(far) + (uPeak.x > 0.0 ? peakRise() : 0.0);
  float tPrev = t, dPrev = 1e9;
  for (int i = 0; i < 600; i++) {
    vec3 p = ro + rd * t;
    float r = length(p.xz);
    if (r > far) break;
    vec2 g;
    float dy = p.y - (landHeight(p.xz, fp * t, g) - uSurf.y - curveDrop(r));
    if (dy < 0.3 * fp * t) {
      // The bare base plane is no land: a ray that reaches it misses.
      if (bare && gPeak < 0.5) return -1.0;
      return dPrev < 1e8 ? mix(tPrev, t, clamp(dPrev / max(dPrev - dy, 1e-6), 0.0, 1.0)) : t;
    }
    if (rd.y > top && p.y + uSurf.y > top * r + 40.0) break;
    tPrev = t;
    dPrev = dy;
    // Tree cones are steep: step finely inside the canopy band (trees stand at most 26 m) while
    // canopy() still draws single trees. Steps never shrink below a share of the distance, so rays
    // that skim the land all the way out still arrive within the loop.
    // Far relief is taller for its width, so its slopes steepen with distance: a step longer than
    // the gap over the steepest of them would jump the peaks.
    float band = forest && fp * t < 7.0 ? 26.0 : 0.0;
    float k = min(kStep, landScale() / max(landAmp(r) * 2.0, 1e-3));
    t += max(dy > band ? (dy - band) * k + band * 0.2 : dy * 0.2, max(fp, dy > band ? 0.01 : 0.003) * t + 0.5);
  }
  return -1.0;
}

// Rock, meadow, forest and snow by height and slope; the volcano's ash, forest skirt and gullied
// snow cap; soft shadows cast by the land itself.
vec3 landShade(vec3 ro, vec3 rd, float t, float fp, vec3 amb) {
  vec3 p = ro + rd * t;
  int type = landType();
  vec2 g;
  float h = landHeight(p.xz, fp * t * 0.35, g);
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  // Texture noise runs up the slopes too, so cliffs are not streaked with the ground's pattern.
  vec2 pn = p.xz + h * vec2(0.8, -0.6);
  float n1 = valueNoise(pn / 90.0 + uLandB.z), n2 = valueNoise(pn / 17.0 - uLandB.z);
  // Rock in strata that follow the height, darker on the steepest faces.
  float strata = valueNoise(vec2(h / 23.0 + n1 * 2.0, 0.5));
  vec3 alb = uLandColor * (0.62 + 0.3 * n1 + 0.18 * n2 + 0.25 * strata) * mix(0.75, 1.0, smoothstep(0.35, 0.75, n.y));
  vec3 forest = vec3(0.022, 0.04, 0.018) * (0.7 + 0.6 * n2), meadow = vec3(0.07, 0.09, 0.035) * (0.8 + 0.4 * n1);
  // At full Snow the snow line drops below the valley floors.
  float snowLine = mix(2600.0, -150.0, uLandC.x);
  float ao = 1.0;
  if (gPeak > 0.5) {
    float Hp = peakDist() * peakRise(), e = h / max(Hp, 1.0);
    vec2 dv = p.xz - dirXZ(uPeak.y) * peakDist();
    float gully = valueNoise(vec2(atan(dv.y, dv.x) * 40.0, e * 6.0));
    alb = mix(vec3(0.09, 0.08, 0.075), vec3(0.16, 0.13, 0.11), n1) * (0.8 + 0.4 * n2);
    alb = mix(alb, forest, smoothstep(0.32, 0.18, e + 0.08 * n1));
    float snow = smoothstep(1.0 - uPeak.w - 0.03, 1.0 - uPeak.w + 0.03, e + (gully - 0.5) * 0.22);
    alb = mix(alb, vec3(0.84, 0.86, 0.9), snow);
  } else if (type == LAND_FOREST) {
    // Forest: broadleaf crowns lighter and yellower than conifers; darker deep in each crown.
    vec3 crown = mix(vec3(0.045, 0.065, 0.022), vec3(0.015, 0.028, 0.02), uLandC.z) * (0.7 + 0.6 * n2);
    alb = mix(crown, uLandColor * 0.5, 0.15) * (0.75 + 0.5 * hashL(floor(p.xz / 10.0)));
    ao = mix(0.35, 1.0, gCanopy);
  } else {
    // Forest on gentle ground below the tree line, meadow in clearings, snow above the snow line;
    // snow buries the meadows but the forest's dark crowns show through it. Single trees speckle
    // the forest until they shrink below a pixel.
    float veg = smoothstep(0.66, 0.86, n.y + 0.1 * n2) * (1.0 - smoothstep(0.55, 0.8, h / max(snowLine, 300.0) + 0.15 * n1));
    float wood = smoothstep(0.25, 0.45, valueNoise(pn / 41.0) * 0.6 + n2 * 0.4);
    float trees = mix(valueNoise(pn / 6.0), 0.5, smoothstep(0.5, 2.0, fp * t / 6.0));
    alb = mix(alb, mix(meadow, forest * (0.55 + 0.9 * trees), wood), veg);
    float snow = smoothstep(-60.0, 60.0, h - snowLine + (n1 - 0.5) * 250.0) * smoothstep(0.45, 0.7, n.y + 0.15 * n2) * step(0.001, uLandC.x);
    alb = mix(alb, vec3(0.83, 0.86, 0.91), snow * (1.0 - 0.7 * wood * veg));
  }
  float sh = 1.0;
  if (uSunDir.y > -0.04) {
    float s = 15.0 + 0.003 * t;
    for (int k = 0; k < 22; k++) {
      vec3 q = p + uSunDir * s;
      float rq = length(q.xz);
      vec2 gq;
      float yq = landHeight(q.xz, fp * t + s * 0.03, gq) - uSurf.y - curveDrop(rq);
      sh = min(sh, clamp(25.0 * (q.y - yq) / s, 0.0, 1.0));
      s *= 1.4;
      if (sh < 0.02 || q.y > 9000.0) break;
    }
  }
  return alb * (directLight(n) * sh + skyFacing(n, amb) * (0.55 + 0.45 * n.y)) * ao;
}

// ── City ──

// Building heights (m) scale with the Height setting.
float cityHeight(float m) { return m * uLand.y * 0.5; }

// The building on lot c: (centre, height, id). Avenues every sixth row and column; a downtown of
// towers out along the land heading, low-rise blocks elsewhere.
vec4 cityLot(vec2 c, out vec2 hs) {
  vec2 cen = (c + 0.5) * CITY_G;
  float r = length(cen), near = landNear();
  hs = vec2(0.0);
  if (r < near * 1.04 || r > landFar() || mod(c.x, 6.0) < 1.0 || mod(c.y, 6.0) < 1.0) return vec4(0.0);
  float h1 = hashL(c * 1.31 + 17.0), h2 = hashL(c + 3.7);
  vec2 dc = dirXZ(uLandB.y) * near * 4.2;
  float down = exp(-dot(cen - dc, cen - dc) / (2.0 * near * near * 1.1));
  float tower = down * step(0.55, h2);
  float H = (7.0 + 26.0 * h1 * h1) * (0.45 + 0.8 * valueNoise(cen / 700.0 + uLandB.z)) + tower * (60.0 + 320.0 * pow(hashL(c + 7.7), 1.6)) + down * 25.0 * h1;
  // Towers are slim; low-rise blocks fill more of their lots.
  hs = CITY_G * mix(vec2(0.3 + 0.15 * hashL(c * 0.71 + 9.1), 0.3 + 0.15 * hashL(c + 21.3)), vec2(0.2 + 0.1 * hashL(c + 2.9)), tower);
  return vec4(cen, cityHeight(H), h1);
}

vec4 gLot = vec4(0.0);
float gBeacon = 0.0;  // red aviation lights the ray passed close to

// The first building face or street a ray meets, walking the lot grid cell by cell, or -1.
float cityTrace(vec3 ro, vec3 rd, float fp, out vec3 n) {
  // Above top (over the tallest building cityLot can make, 446 m before scaling) nothing is hit.
  float t = shoreEntry(ro, rd), top = cityHeight(450.0) - uSurf.y;
  n = vec3(0.0, 1.0, 0.0);
  vec2 v = rd.xz, o = ro.xz + v * t, c = floor(o / CITY_G), s = vec2(v.x >= 0.0 ? 1.0 : -1.0, v.y >= 0.0 ? 1.0 : -1.0);
  vec2 inv = 1.0 / max(abs(v), vec2(1e-7));
  vec2 tN = t + ((c + max(s, 0.0)) * CITY_G - o) * s * inv, tD = CITY_G * inv;
  vec3 ri = 1.0 / mix(rd, vec3(1e-7), lessThan(abs(rd), vec3(1e-7)));
  for (int i = 0; i < 160; i++) {
    float tx = min(tN.x, tN.y);
    vec2 hs;
    vec4 lot = cityLot(c, hs);
    if (lot.z > 150.0 && fract(lot.w * 13.7) < 0.6) {
      vec3 b = vec3(lot.x, lot.z - uSurf.y + 2.0, lot.y) - ro;
      float tb = max(dot(b, rd), 1.0), dd = length(b - rd * tb), w = max(fp * tb * 0.6, 0.3);
      gBeacon += exp(-0.5 * dd * dd / (w * w)) * exp(-tb / 9000.0);
    }
    if (lot.z > 0.0) {
      vec3 ta = (vec3(lot.x - hs.x, -uSurf.y, lot.y - hs.y) - ro) * ri, tb = (vec3(lot.x + hs.x, lot.z - uSurf.y, lot.y + hs.y) - ro) * ri;
      vec3 mn = min(ta, tb), mx = max(ta, tb);
      float te = max(max(mn.x, mn.y), mn.z), tl = min(min(mx.x, mx.y), mx.z);
      if (te < tl && te > 0.0) {
        n = -sign(rd) * step(mn.yzx, mn) * step(mn.zxy, mn);
        gLot = lot;
        return te;
      }
    }
    if (rd.y < 0.0) {
      float tg = (-uSurf.y - ro.y) / rd.y;
      if (tg < tx) { gLot = vec4(0.0); return max(tg, t); }
    }
    if (rd.y > 0.0 && ro.y + rd.y * tx > top) break;
    t = tx;
    if (tN.x < tN.y) { c.x += s.x; tN.x += tD.x; } else { c.y += s.y; tN.y += tD.y; }
    if (dot(c, c) * CITY_G * CITY_G > pow(landFar() + CITY_G, 2.0)) break;
  }
  return -1.0;
}

// Facades of punched windows or glass curtain wall that mirror the sky; lit windows after dark in
// a mix of warm and cool light; windows smaller than a pixel blend to their average.
vec3 cityShade(vec3 ro, vec3 rd, float t, vec3 n, float fp, vec3 amb) {
  vec3 p = ro + rd * t;
  float px = fp * t, id = gLot.w, lights = uLandB.w;
  vec3 c;
  if (gLot.z <= 0.0) {
    c = vec3(0.045) * (directLight(n) + amb) + uCityColor * lights * 0.5 * uNightScale;
  } else if (n.y > 0.5) {
    c = mix(vec3(0.2), vec3(0.32, 0.3, 0.28), fract(id * 9.1)) * (directLight(n) + skyFacing(n, amb));
  } else {
    bool glassy = fract(id * 7.13) < 0.45;
    vec3 wall = mix(vec3(0.17, 0.165, 0.16), vec3(0.36, 0.33, 0.29), fract(id * 3.7)) * (glassy ? 0.35 : 1.0);
    float up = p.y + uSurf.y, fh = 3.7, cw = glassy ? 1.5 : 2.2 + 1.6 * fract(id * 5.3);
    vec2 w = vec2((abs(n.x) > 0.5 ? p.z : p.x) / cw, up / fh), f = fract(w);
    float win = glassy ? smoothstep(0.02, 0.1, f.y) * (1.0 - smoothstep(0.86, 0.94, f.y)) * smoothstep(0.02, 0.08, f.x) * (1.0 - smoothstep(0.92, 0.98, f.x))
                       : step(0.2, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.82);
    float lod = smoothstep(0.2, 0.8, px / cw), winAvg = glassy ? 0.72 : 0.31;
    float cover = mix(win, winAvg, lod);
    vec3 R = reflect(rd, n);
    float fres = 0.04 + 0.96 * schlick(dot(-rd, n));
    vec3 refl = mix(horizonSky(R), physicalSky(normalize(vec3(R.x, max(R.y, 0.02), R.z))), smoothstep(0.0, 0.3, R.y));
    refl += sunLight(normalize(R + vec3(0.0, 1e-4, 0.0)), max(fp, 0.004)) * 0.3;
    vec3 sky = skyFacing(n, amb);
    // Tinted, coated glass: a dim mirror head-on that brightens toward grazing.
    vec3 glass = refl * mix(0.05, 0.5, fres) + vec3(0.015, 0.02, 0.025) * sky;
    c = mix(wall * (directLight(n) + sky * 0.85), glass, cover);
    uint hh = hash3u(uvec3(uvec2(ivec2(floor(w)) + 65536), uint(id * 1e6)));
    // A share of windows lit, warm or cool and at varied levels; the far average stays dim so towers
    // read as dark masses pricked with light rather than glowing slabs.
    float on = step(rnd(hh), lights * 0.6), tone = rnd(hh), level = mix(0.35, 1.0, rnd(hh) * rnd(hh));
    vec3 lamp = mix(uCityColor, vec3(0.8, 0.9, 1.0) * luma(uCityColor) * 1.4, step(0.7, tone)) * level;
    c += mix(lamp * on * win * 3.0, uCityColor * lights * 0.6 * 0.6 * winAvg * 1.8, lod) * uNightScale;
    c *= mix(0.6, 1.0, smoothstep(0.0, 30.0, up));
  }
  return c;
}

// Noise over the ground at P (m) with features about scale metres across, read from slice z of the
// tile, and its gradient in channel ch (0 red, else alpha).
vec4 groundNz(vec2 P, float scale, float z, float rate) { return nz(vec3(P / scale * 0.1, z), rate / scale * 0.1); }

vec2 noiseGrad(vec3 c, float rate, int ch) {
  const float e = 0.01;
  vec4 a = nz(c, rate), bx = nz(c + vec3(e, 0.0, 0.0), rate), by = nz(c + vec3(0.0, e, 0.0), rate);
  return ch == 0 ? vec2(bx.r - a.r, by.r - a.r) / e : vec2(bx.a - a.a, by.a - a.a) / e;
}

vec2 groundGrad(vec2 P, float scale, float z, float rate, int ch) { return noiseGrad(vec3(P / scale * 0.1, z), rate / scale * 0.1, ch); }
`;
