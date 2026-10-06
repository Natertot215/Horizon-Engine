'use strict';

// Grass, wheat and flowers: blades traced cell by cell.

const GLSL_GRASS = `
// Blades sit on a grid whose u axis runs downwind. A blade is rooted in its cell and leans downwind
// by at most one cell, so a ray crossing cell (i, j) only tests the blades of (i, j) and (i - 1, j).
// In its face frame a blade's spine follows a = kb·y², so the ray test is a quadratic.
const int GRASS_K = 5;

vec2 gWind, gCell, gLean, gOff; // grid u axis (world xz), cell size, lean direction and origin offset in grid space
float gSigma;
bool gWheat;

// Blade kinds: a leaf blade, a seed-head stem standing above the canopy, a flower, a wheat stalk.
const int BLADE_LEAF = 0, BLADE_STEM = 1, BLADE_FLOWER = 2, BLADE_WHEAT = 3;

struct Blade { vec2 root; vec2 nh; float kb; float ka; float hy; float w; int kind; uint h; };

float grassGust(vec2 uv, float t) {
  return 0.55 * sin(uv.x * 0.8 - t * 1.9 + 0.8 * sin(uv.y * 0.27 + t * 0.15))
       + 0.30 * sin(uv.x * 2.1 + uv.y * 0.6 - t * 3.1)
       + 0.15 * sin(uv.y * 1.3 + uv.x * 0.5 - t * 1.1);
}

Blade grassBlade(ivec2 c, int k, float t) {
  Blade b;
  uint h = hash3u(uvec3(uvec2(c + 1000000), uint(k) + 977u));
  float u0 = rnd(h), v0 = 0.18 + 0.64 * rnd(h);
  b.root = (vec2(c) + vec2(u0, v0)) * gCell - gOff;
  float pick = rnd(h), len;
  if (gWheat) {
    v0 = 0.22 + 0.56 * v0;
    b.root.y = (float(c.y) + v0) * gCell.y - gOff.y;
    b.kind = pick < 0.82 ? BLADE_WHEAT : BLADE_LEAF;
    len = uGrass.x * (b.kind == BLADE_WHEAT ? 0.86 + 0.14 * rnd(h) : 0.3 + 0.3 * rnd(h)) * (0.92 + 0.16 * valueNoise(b.root * 0.4 + 3.3));
    b.w = uGrass.z * (b.kind == BLADE_WHEAT ? 0.6 : 1.4);
  } else {
    b.kind = pick < uGrassB.y * 0.12 ? BLADE_FLOWER : pick > 0.93 ? BLADE_STEM : BLADE_LEAF;
    len = uGrass.x * (b.kind != BLADE_LEAF ? 1.05 + 0.4 * rnd(h) : (0.45 + 0.55 * rnd(h)) * (0.6 + 0.8 * valueNoise(b.root * 1.3 + 7.1)));
    b.w = uGrass.z * (b.kind != BLADE_LEAF ? 0.35 : 0.7 + 0.6 * rnd(h));
  }
  bool flower = b.kind == BLADE_FLOWER;
  float gust = grassGust(b.root, t) + 0.25 * sin(t * (2.0 + 2.0 * rnd(h)) + rnd(h) * TAU);
  float lean = len * clamp(0.06 + 0.55 * uGrass.w * rnd(h) + 0.12 * uSurfA.a * (1.0 + gust), 0.0, 0.85) * (b.kind == BLADE_STEM || flower ? 0.4 : 1.0);
  float side = flower ? 0.0 : (rnd(h) - 0.5) * 0.8;
  vec2 L = lean * normalize(gLean + vec2(-gLean.y, gLean.x) * side);
  float m = min(v0, 1.0 - v0) * gCell.y - (flower ? 0.012 : 0.5 * b.w);
  L = vec2(clamp(L.x, -u0 * gCell.x, (2.0 - u0) * gCell.x - b.w), clamp(L.y, -max(m, 0.0), max(m, 0.0)));
  b.hy = sqrt(max(len * len - dot(L, L), 0.05 * len * len));
  float phi = rnd(h) * TAU;
  b.nh = vec2(cos(phi), sin(phi));
  b.kb = dot(L, b.nh) / (b.hy * b.hy);
  b.ka = dot(L, vec2(-b.nh.y, b.nh.x)) / (b.hy * b.hy);
  b.h = h;
  return b;
}

// rd = ray direction in (u, v, up). Returns coverage; outputs hit distance, height and offset
// across the blade (-1..1), or side = 2 for a flower head.
float bladeHit(Blade b, vec3 rd, float tA, float tB, float pw0, out float tHit, out float y, out float side) {
  vec2 wv = vec2(-b.nh.y, b.nh.x);
  float a0 = -dot(b.root, b.nh), da = dot(rd.xy, b.nh);
  float b0 = -dot(b.root, wv), db = dot(rd.xy, wv);
  float E = uSurf.y, dy = rd.z;
  if (b.kind == BLADE_FLOWER) {
    // Flower head: a small sphere on the stem tip.
    vec3 c = vec3(b.root + (b.kb * b.nh + b.ka * wv) * b.hy * b.hy, b.hy) - vec3(0.0, 0.0, E);
    float r = 0.012 * uGrass.z / 0.006, bq = dot(rd, c), cq = dot(c, c) - r * r, disc = bq * bq - cq;
    if (disc > 0.0) {
      float t = bq - sqrt(disc);
      if (t >= tA && t <= tB) {
        tHit = t;
        y = b.hy;
        side = 2.0;
        return clamp((r - length(cross(rd, c))) / (pw0 * t) + 0.5, 0.0, 1.0);
      }
    }
  }
  float A = b.kb * dy * dy, B = 2.0 * b.kb * E * dy - da, C = b.kb * E * E - a0;
  vec2 ts;
  if (abs(A) < 1e-9) ts = vec2(abs(B) > 1e-12 ? -C / B : -1.0, -1.0);
  else {
    float disc = B * B - 4.0 * A * C;
    if (disc < 0.0) return 0.0;
    float q = -0.5 * (B + (B >= 0.0 ? 1.0 : -1.0) * sqrt(disc));
    if (abs(q) < 1e-12) return 0.0;
    ts = vec2(q / A, C / q);
    if (ts.y < ts.x) ts = ts.yx;
  }
  for (int i = 0; i < 2; i++) {
    float t = ts[i];
    if (t < tA || t > tB) continue;
    float yy = (E + dy * t) / b.hy;
    if (yy < 0.0 || yy > 1.0) continue;
    float prof = b.kind == BLADE_LEAF ? pow(clamp((1.0 - yy) * 3.0, 0.0, 1.0), 0.6)
               : b.kind == BLADE_STEM && yy > 0.72 ? 1.0 + 3.2 * sin(PI * min((yy - 0.72) / 0.3, 1.0)) * smoothstep(1.0, 0.96, yy)
               : b.kind == BLADE_WHEAT && yy > 0.86 ? 1.0 + 2.6 * sqrt(max(sin(PI * min((yy - 0.86) / 0.15, 1.0)), 0.0)) * smoothstep(1.0, 0.975, yy) : 1.0;
    float hw = 0.5 * b.w * prof;
    float off = b0 + db * t - b.ka * (yy * b.hy) * (yy * b.hy);
    // Overlap of the blade with the pixel footprint, so sub-pixel blades add the right coverage.
    float pw = pw0 * t;
    float a = clamp((min(hw, off + 0.5 * pw) - max(-hw, off - 0.5 * pw)) / pw, 0.0, 1.0);
    if (a <= 0.0) continue;
    tHit = t;
    y = yy * b.hy;
    side = clamp(off / max(hw, 1e-5), -1.0, 1.0);
    return a;
  }
  return 0.0;
}

// Leaf lighting: diffuse on the lit face, yellow-green transmission when backlit, a waxy sheen,
// and sunlight that thins out toward the base of the canopy. gap < 0 averages over gap sizes.
vec3 grassLight(vec3 alb, vec3 n, vec3 d, float y, float gap, vec3 amb) {
  float H = uGrass.x;
  vec3 col = alb * amb * mix(0.22, 1.0, pow(clamp(y / H, 0.0, 1.0), 0.6));
  vec3 L = uSunDir;
  float k = gSigma * max(H - y, 0.0) / max(L.y, 0.04), x = max(1.4 * k, 1e-4);
  // The average over gap in [0, 1] is exp(-0.3 k) (1 - exp(-x)) / x, which goes to 1 (not 0) as k
  // does: tips above the canopy are in full sun.
  float shadow = gap >= 0.0 ? exp(-k * (0.3 + 1.4 * gap)) : exp(-0.3 * k) * (1.0 - exp(-x)) / x;
  float ndl = dot(n, L);
  vec3 lit = ndl > 0.0 ? alb * ndl : alb * vec3(1.3, 1.5, 0.55) * (-ndl);
  vec3 hv = normalize(L - d);
  float spec = ndl > 0.0 ? (0.04 + 0.96 * schlick(dot(-d, hv))) * 2.3 * pow(max(dot(n, hv), 0.0), 50.0) * ndl : 0.0;
  col += (lit / PI + spec) * gSunE * shadow * gShade;
  if (uMoonScale > 0.0) col += alb * max(dot(n, uMoonDir), 0.0) / PI * gMoonE * shadow;
  return col;
}

const vec3 STRAW = vec3(0.34, 0.25, 0.11);

vec3 shadeBlade(Blade b, vec3 d, float t, float y, float side, vec3 amb) {
  uint h = b.h;
  float r1 = rnd(h), r2 = rnd(h), r3 = rnd(h);
  if (side > 1.5) {
    // Flower head: sphere normal, petals lit with some translucency.
    vec2 wv0 = vec2(-b.nh.y, b.nh.x);
    vec2 cu = b.root + (b.kb * b.nh + b.ka * wv0) * b.hy * b.hy;
    vec3 c = vec3(fromFrame(cu, gWind), b.hy).xzy;
    vec3 p = vec3(d.xz * t, uSurf.y + d.y * t).xzy;
    vec3 n = normalize(p - c);
    vec3 alb = uFlower * (0.75 + 0.5 * r1);
    alb = mix(alb, alb.gbr, step(0.85, r2) * 0.6);
    return grassLight(alb, normalize(n + vec3(0.0, 0.4, 0.0)), d, y, r3 * 0.3, amb) * 1.3;
  }
  vec2 nh = fromFrame(b.nh, gWind), wv = fromFrame(vec2(-b.nh.y, b.nh.x), gWind);
  vec3 n = normalize(vec3(nh.x, -2.0 * b.kb * y, nh.y));
  if (dot(n, d) > 0.0) n = -n;
  n = normalize(n + vec3(wv.x, 0.0, wv.y) * side * 0.35);
  float yy = y / b.hy;
  // Parallel veins and a pale midrib, visible on blades close to the lens.
  float veins = 0.93 + 0.07 * sin(side * 23.0 + r1 * 6.0) + 0.12 * exp(-side * side * 40.0);
  vec3 alb = mix(uSurfA.rgb, uSurfB.rgb, yy * yy) * (0.7 + 0.6 * r1) * mix(0.8, 1.0, yy) * veins;
  if (gWheat) {
    // Stalk colour up to the ear, the ear itself in the accent colour; leaves stay greener.
    vec3 stalk = uSurfA.rgb * (0.8 + 0.4 * r1), ear = uSurfB.rgb * (0.8 + 0.4 * r1);
    alb = b.kind == BLADE_WHEAT ? mix(stalk, ear, smoothstep(0.84, 0.9, yy)) : mix(uSurfA.rgb * vec3(0.7, 0.85, 0.5), stalk, 0.5 + 0.5 * uGrassB.x);
  } else if (b.kind != BLADE_LEAF) alb = mix(uSurfB.rgb, STRAW, b.kind == BLADE_STEM ? smoothstep(0.6, 0.8, yy) : 0.2);
  else if (r2 < uGrassB.x * 0.5) alb = mix(alb, STRAW, 0.7);
  return grassLight(alb, n, d, y, r3, amb);
}

vec3 grassGround(vec2 P, float rate, vec3 amb) {
  float n1 = groundNz(P, 0.6, 0.61, rate).r;
  vec3 alb = gWheat ? vec3(0.09, 0.065, 0.04) * (0.7 + 0.6 * n1)
                    : mix(uSurfA.rgb * 0.5, vec3(0.05, 0.04, 0.02), 0.45) * (0.6 + 0.8 * n1);
  float shadow = exp(-gSigma * uGrass.x / max(uSunDir.y, 0.04)) * gShade;
  return alb * (gSunE * max(uSunDir.y, 0.0) * shadow / PI + amb * (gWheat ? 0.4 : 0.2));
}

// Blades below pixel size: the expected first hit, estimated with fixed stratified samples of the
// same blade population the tracer uses (height profile, face angles weighted by projected area,
// colours and lighting), so the far field matches the traced blades on average. soil is the
// ground's colour at P, seen through the gaps.
vec3 grassCanopy(vec3 d, vec2 P, float rate, vec3 soil, vec3 amb) {
  float H = uGrass.x, S = uSurf.z;
  float cb = max(length(d.xz), 1e-4), cot = cb / max(-d.y, 1e-4);
  vec2 dh = d.xz / cb;
  // Blade density is full below mid and fades to zero at top (meadow clumps run tall; wheat
  // stands level with its ears on top).
  float top = gWheat ? H : 1.3 * H, mid = gWheat ? 0.86 * H : 0.5 * H, Fm = 0.5 * (top - mid);
  float tauTot = gSigma * cot * (Fm + mid);
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float tau = -log(1.0 - (float(i) + 0.5) / 5.0 * (1.0 - exp(-tauTot)));
    float F = tau / (gSigma * cot);
    float y = max(F < Fm ? top - sqrt(2.0 * F * (top - mid)) : mid - (F - Fm), 0.0);
    float yy = clamp(y / H, 0.0, 1.0);
    vec3 alb = mix(uSurfA.rgb, uSurfB.rgb, yy * yy) * mix(0.8, 1.0, yy);
    if (gWheat) alb = mix(uSurfA.rgb, uSurfB.rgb, smoothstep(0.82, 0.9, yy));
    else {
      alb = mix(alb, STRAW, 0.35 * uGrassB.x);
      // Above the leaf canopy only seed-head stems and flowers remain.
      float above = smoothstep(0.95, 1.1, y / H);
      alb = mix(alb, mix(mix(uSurfB.rgb, STRAW, 0.6), uFlower * 1.3, clamp(uGrassB.y * 0.6, 0.0, 0.7)), above);
    }
    for (int j = 0; j < 4; j++) {
      float s = asin((float(j) + 0.5) * 0.5 - 1.0);
      vec2 nh = -rot2(dh, s);
      sum += grassLight(alb, normalize(vec3(nh.x, (float(j & 1) - 0.5) * 0.6 * yy, nh.y)), d, y, -1.0, amb);
    }
  }
  vec3 col = mix(sum / 20.0, soil, exp(-tauTot));
  // Structure the eye still resolves: clumps, dry patches, gusts combing across the field, and
  // blade-scale streaks that carry the traced texture past the hand-off distance.
  vec4 nA = groundNz(P, 5.0 * S, 0.23, rate);
  vec4 nB = groundNz(P, 18.0 * S, 0.41, rate);
  float gust = grassGust(toFrame(P, gWind), uTime.y * uSurfC.z);
  vec2 q = vec2(dot(P, vec2(-dh.y, dh.x)) / (1.2 * gCell.y), dot(P, dh) / max(0.6 * H * cot, 0.05));
  float streak = mix(valueNoise(q) + 0.5 * valueNoise(q * vec2(2.3, 1.0) + 9.1) - 0.75, 0.0, smoothstep(0.3, 1.0, rate / (1.2 * gCell.y)));
  col *= (0.88 + 0.24 * nA.r) * (0.92 + 0.16 * nB.g) * (1.0 + 0.1 * uSurfA.a * gust) * (1.0 + 0.7 * streak);
  if (gWheat) {
    float rows = cos(TAU * toFrame(P, gWind).y / gCell.y);
    return col * (1.0 + 0.12 * rows * (1.0 - smoothstep(0.25, 0.8, rate / gCell.y)));
  }
  return mix(col, col * vec3(1.25, 1.0, 0.55), smoothstep(0.55, 0.8, nB.a) * uGrassB.x);
}

// Premultiplied grass radiance (rgb) and coverage (a) along the ray between t0 and t1; tEnd is
// how far the traversal got before running out of steps.
vec4 grassTrace(vec3 d, float t0, float t1, float tFade, float fp, vec3 amb, out float tEnd) {
  vec3 rd = vec3(toFrame(d.xz, gWind), d.y);
  vec2 dg = rd.xy / gCell, g0 = (rd.xy * t0 + gOff) / gCell;
  ivec2 c = ivec2(floor(g0));
  vec2 sg = vec2(dg.x >= 0.0 ? 1.0 : -1.0, dg.y >= 0.0 ? 1.0 : -1.0);
  vec2 dgs = sg * max(abs(dg), vec2(1e-9));
  vec2 tNext = t0 + (vec2(c) + max(sg, 0.0) - g0) / dgs, tDelta = 1.0 / abs(dgs);
  float tc0 = t0, T = 1.0, time = uTime.y * uSurfC.z, pw0 = 0.75 * fp;
  vec3 acc = vec3(0.0);
  tEnd = t0;
  for (int s = 0; s < 128; s++) {
    float tc1 = min(min(tNext.x, tNext.y), t1);
    tEnd = tc1;
    float best = tc1, by = 0.0, bs = 0.0, ba = 0.0;
    Blade bb;
    for (int q = 0; q < 2; q++)
      for (int k = 0; k < GRASS_K; k++) {
        Blade b = grassBlade(c - ivec2(q, 0), k, time);
        float th, yh, sd;
        float a = bladeHit(b, rd, tc0, best, pw0, th, yh, sd);
        if (a > 0.0) { best = th; by = yh; bs = sd; ba = a; bb = b; }
      }
    if (ba > 0.0) {
      ba *= 1.0 - smoothstep(0.6 * tFade, tFade, best);
      acc += T * ba * shadeBlade(bb, d, best, by, bs, amb);
      T *= 1.0 - ba;
      if (T < 0.03) break;
      tc0 = best + 1e-4;
      continue;
    }
    if (tc1 >= t1) break;
    if (tNext.x < tNext.y) { c.x += int(sg.x); tc0 = tNext.x; tNext.x += tDelta.x; }
    else { c.y += int(sg.y); tc0 = tNext.y; tNext.y += tDelta.y; }
  }
  return vec4(acc, 1.0 - T);
}

void grassSetup() {
  vec2 wind = dirXZ(uSurfC.x);
  float n = uGrass.y * 600.0;
  gWheat = surfType() == SURF_WHEAT;
  if (gWheat) {
    // Crop rows: u runs along the rows (pointing downwind) and v across, one row per cell.
    vec2 row = dirXZ(uSurfC.w);
    gWind = dot(row, wind) < 0.0 ? -row : row;
    gLean = normalize(toFrame(wind, gWind) + vec2(0.4, 0.0));
    gCell = vec2(float(GRASS_K) / (n * 0.17), 0.17);
    gOff = vec2(0.0, 0.5 * gCell.y); // stand in a row, not in a gap
  } else {
    gWind = wind;
    gLean = vec2(1.0, 0.0);
    gOff = vec2(0.0);
    gCell.x = clamp(0.5 * uGrass.x, 0.03, 0.5);
    gCell.y = clamp(float(GRASS_K) / (n * gCell.x), 0.015, 0.3);
  }
  gSigma = n * uGrass.z * 0.32;
}
`;
