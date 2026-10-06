'use strict';

// Ground surfaces: plain ground, and terrain for dunes, snow drifts and rock.

const GLSL_TERRAIN = `
// Plain ground: a dark, faintly mottled floor for silhouette scenes.
vec3 plainGround(vec2 P, float rate) {
  return mix(uSurfA.rgb, uSurfB.rgb, groundNz(P, 6.0 * uSurf.z, 0.43, rate).r);
}

// ── Terrain: dunes, snow drifts, rocky ground ──

// Height (m) above the base plane. Dunes are transverse ridges with a gentle windward slope and a
// steep slip face whose crests meander; snow lies in soft drifts; rock is broken ground.
float gDunePhase = 0.0;

float terrainH(vec2 p, float rate) {
  int type = surfType();
  float S = uSurf.z, A = uTerrain.x;
  vec2 q = toFrame(p, dirXZ(uSurfC.x));
  if (type == SURF_DESERT) {
    float lam = 110.0 * S;
    vec4 w1 = groundNz(q * vec2(1.0, 0.55), lam * 4.0, 0.11, rate);
    vec4 w2 = groundNz(q, lam, 0.23, rate);
    float f = fract(q.x / lam + (w1.r - 0.5) * 3.2 + (w2.r - 0.5) * 0.5 + gDunePhase);
    float prof = f < 0.78 ? sin(f / 0.78 * PI * 0.5) : 1.0 - pow((f - 0.78) / 0.22, 0.85);
    prof = mix(prof, 0.6, smoothstep(0.08, 0.45, rate / lam));
    float small = (w2.a - 0.5) * 4.0 * (1.0 - smoothstep(0.3, 1.0, rate / (lam * 0.25)));
    return (prof * (0.45 + 0.8 * w1.g) * 13.0 + small) * A * S;
  }
  vec4 n1 = groundNz(p, 60.0 * S, 0.37, rate);
  vec4 n2 = groundNz(q * vec2(0.6, 1.0), 14.0 * S, 0.59, rate);
  if (type == SURF_SNOW) return ((n1.r - 0.5) * 3.0 + (n2.r - 0.5) * 0.9) * A * S;
  return ((n1.r - 0.5) * 2.4 + (n2.a - 0.5) * 1.6 + pow(n2.g, 3.0) * 1.8) * A * S;
}

float gH0;

// First intersection of the view ray with the terrain (eye at the origin, uSurf.y above the local
// ground), or -1 if it escapes past the march range.
float terrainTrace(vec3 d, float fp) {
  float E = uSurf.y, top = 22.0 * uTerrain.x * uSurf.z + 1.0;
  if (surfType() == SURF_DESERT) {
    // Stand just upwind of a crest so the view runs out over the dune field.
    float lam = 110.0 * uSurf.z;
    float w1 = nz(vec3(0.0, 0.0, 0.11), 0.0).r, w2 = nz(vec3(0.0, 0.0, 0.23), 0.0).r;
    gDunePhase = 0.7 - fract((w1 - 0.5) * 3.2 + (w2 - 0.5) * 0.5);
  }
  gH0 = terrainH(vec2(0.0), 0.0);
  float t = 0.0, tPrev = 0.0, gapPrev = E;
  for (int i = 0; i < 450; i++) {
    vec3 p = d * t;
    float gap = p.y + E + gH0 - terrainH(p.xz, fp * t);
    if (gap < 0.0) {
      // Refine between the last point above ground and this one.
      for (int k = 0; k < 5; k++) {
        float tm = mix(tPrev, t, gapPrev / max(gapPrev - gap, 1e-5));
        vec3 pm = d * tm;
        float gm = pm.y + E + gH0 - terrainH(pm.xz, fp * tm);
        if (gm < 0.0) { t = tm; gap = gm; } else { tPrev = tm; gapPrev = gm; }
      }
      return t;
    }
    if (d.y > 0.0 && p.y + E > top) return -1.0;
    tPrev = t;
    gapPrev = gap;
    // Steps never shrink below a share of the distance (a little more past 500 m), so rays that
    // graze crests still reach the end of the march within the loop.
    t += max(gap * 0.55, 0.04 + t * mix(0.012, 0.018, smoothstep(500.0, 3000.0, t)));
    if (t > 6000.0) break;
  }
  return -1.0;
}

// Soft shadow from the terrain itself toward the sun.
float terrainShadow(vec3 p, float rate) {
  float E = uSurf.y, res = 1.0, t = 0.5 + rate;
  for (int i = 0; i < 22; i++) {
    vec3 q = p + uSunDir * t;
    float gap = q.y + E + gH0 - terrainH(q.xz, max(rate, 0.002 * t));
    res = min(res, 10.0 * gap / t);
    if (res < 0.0) break;
    t *= 1.38;
  }
  return clamp(res, 0.0, 1.0);
}

vec3 terrainShade(vec3 d, float t, float fp, vec3 amb) {
  int type = surfType();
  float S = uSurf.z, rate = fp * t * inversesqrt(max(abs(d.y), 0.03));
  vec3 p = d * t;
  vec2 P = p.xz;
  float e = max(0.2, rate);
  float h = terrainH(P, rate);
  vec3 n = normalize(vec3(h - terrainH(P + vec2(e, 0.0), rate), e, h - terrainH(P + vec2(0.0, e), rate)));
  vec2 wd = dirXZ(uSurfC.x);
  vec2 q = toFrame(P, wd);
  vec3 A = uSurfA.rgb, B = uSurfB.rgb;
  vec3 alb;
  if (type == SURF_DESERT) {
    // Wind ripples run across the wind; sand shades from crest to trough.
    float warp = groundNz(P, 6.0 * S, 0.81, rate).r;
    float rw = 0.22 * S, fade = (1.0 - smoothstep(0.15, 0.5, rate / rw)) * uSurfA.a;
    vec2 g = wd * cos((q.x / rw + warp * 7.0) * TAU) * 0.25 * fade;
    n = normalize(n + vec3(-g.x, 0.0, -g.y));
    alb = mix(B, A, smoothstep(-2.0, 6.0, h / max(uTerrain.x * S, 0.05)) * 0.8 + 0.2 * groundNz(P, 25.0 * S, 0.15, rate).r);
  } else if (type == SURF_SNOW) {
    // Sastrugi: wind-carved ridges along the wind, and glints from individual crystals.
    vec2 g = fromFrame(groundGrad(q * vec2(0.35, 1.0), 2.0 * S, 0.47, rate, 3) * uSurfA.a * 0.045, wd);
    n = normalize(n + vec3(-g.x, 0.0, -g.y));
    alb = mix(A, B, 0.25 * groundNz(P, 30.0 * S, 0.61, rate).r);
  } else {
    float n1 = groundNz(P, 8.0 * S, 0.27, rate).r;
    float crack = pow(1.0 - abs(groundNz(P, 3.0 * S, 0.39, rate).a * 2.0 - 1.0), 10.0);
    alb = mix(A, B, smoothstep(0.3, 0.7, n1)) * (1.0 - 0.45 * crack * (1.0 - smoothstep(0.05, 0.3, rate / (3.0 * S))));
    vec2 g = groundGrad(P, 1.5 * S, 0.91, rate, 0) * 0.04 * uSurfA.a;
    n = normalize(n + vec3(-g.x, 0.0, -g.y));
  }
  float sh = terrainShadow(p + n * (0.3 + 2.0 * rate), rate) * gShade;
  vec3 col = alb * (gSunE * max(dot(n, uSunDir), 0.0) * sh / PI + amb * (0.55 + 0.45 * n.y));
  if (uMoonScale > 0.0) col += alb * gMoonE * max(dot(n, uMoonDir), 0.0) / PI;
  if (type == SURF_SNOW && uSurfC.y > 0.0) {
    // Sparkle: one crystal facet per footprint, facing any way at all, flashes where it mirrors
    // the sun or moon into the eye, whichever side the light is on.
    uint hh = hash3u(uvec3(uvec2(ivec2(floor(P / (rate * 2.0))) + 1000000), 7u));
    vec3 nf = normalize(vec3(rnd(hh) * 2.0 - 1.0, rnd(hh), rnd(hh) * 2.0 - 1.0));
    bool sun = uSunDir.y > -0.05;
    vec3 L = sun ? uSunDir : uMoonDir;
    vec3 E2 = sun ? gSunE * uSunDisk.x : vec3(uMoonScale) * 30.0;
    // Toward the horizon one facet's cell stretches over many pixels: fade out before it shows.
    if (dot(nf, d) < 0.0) col += E2 * pow(max(dot(reflect(d, nf), L), 0.0), 150.0) * uSurfC.y * 3.0 * sh * smoothstep(0.03, 0.08, -d.y);
  }
  return col;
}
`;
