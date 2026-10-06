'use strict';

// Water: waves, glints, foam and the light scattered out of the water.

const GLSL_WATER = `
const int WAVES = 32;

float smithG1(float c, float a2) {
  float x = c / sqrt(a2 * max(1.0 - c * c, 1e-6));
  return x < 1.6 ? (3.535 * x + 2.181 * x * x) / (1.0 + 2.276 * x + 2.577 * x * x) : 1.0;
}

// Beckmann microfacet reflectance toward light l; multiply by the light's irradiance.
float glint(vec3 n, vec3 v, vec3 l, float a2) {
  float nl = dot(n, l), nv = max(dot(n, v), 1e-3);
  if (nl <= 0.0) return 0.0;
  vec3 h = normalize(v + l);
  float nh2 = max(dot(n, h), 1e-3);
  nh2 *= nh2;
  float D = exp((nh2 - 1.0) / (nh2 * a2)) / (PI * a2 * nh2 * nh2);
  float F = 0.02 + 0.98 * schlick(dot(v, h));
  return F * D * smithG1(nv, a2) * smithG1(min(nl, 1.0), a2) / (4.0 * nv);
}

// Sum of directional deep-water waves. Waves smaller than the pixel footprint drop out of the
// normal and move into the unresolved slope variance (x), which widens the sun's glitter path.
// The crest (y) is the slope-weighted height of the longer half of the waves (whitecaps ride
// those), in units of its spread over the ones still resolved, so it reads the same near and far.
// fpD is the pixel footprint across the view (m); along the view it stretches by 1 / sin(grazing).
vec2 waves(vec2 P, vec2 vh, float fpD, float graze, out vec3 n) {
  float t = uTime.y * uSurfC.z, S = uSurf.z, stretch2 = 1.0 / (graze * graze);
  float rate = fpD / graze;
  // Wave groups: slowly drifting amplitude patches stop the components reading as a lattice.
  vec4 grp = groundNz(P, 90.0 * S, 0.19 + t * 0.0007, rate) * 1.6 - 0.3;
  vec3 g = vec3(0.0);
  float cr = 0.0, cs = 1e-6, mss = 0.0;
  for (int i = 0; i < WAVES; i++) {
    vec4 w = uWave[i];
    float k = length(w.xy);
    float c = dot(w.xy, vh) / k;
    float vis = smoothstep(1.5, 4.0, TAU / (k * fpD * sqrt(1.0 + c * c * (stretch2 - 1.0))));
    float s = w.w * k * grp[i & 3];
    float th = dot(w.xy, P) - sqrt(9.81 * k * (1.0 + k * k * 7.4e-6)) * t + w.z;
    float sn = sin(th);
    g += vec3(w.xy / k * cos(th), sn * uWaveFx.x) * (s * vis);
    if (i < WAVES / 2) {
      cr += sn * s * vis;
      cs += 0.5 * pow(w.w * k * vis, 2.0);
    }
    mss += 0.5 * s * s * (1.0 - vis * vis);
  }
  // Wind ripples: two octaves of stretched, animated noise carry the finest slopes.
  vec2 wd = dirXZ(uSurfC.x);
  vec2 q = toFrame(P, wd) * vec2(1.0, 0.55);
  float lr = 0.6 * S, sr = sqrt(uWaveFx.z);
  for (int o = 0; o < 2; o++) {
    float vis = smoothstep(1.5, 4.0, lr / rate);
    if (vis > 0.0) {
      vec2 gr = noiseGrad(vec3((q - vec2(t * 0.35 * sqrt(lr), 0.0)) / lr * 0.25, 0.53 + float(o) * 0.31 + t * 0.03 / sqrt(lr)), rate / lr * 0.25, 0) * 0.25 * sr * vis;
      g.xy += fromFrame(gr, wd);
    }
    mss += uWaveFx.z * (1.0 - vis * vis);
    lr *= 0.3;
  }
  n = normalize(vec3(-g.x, 1.0 - g.z, -g.y));
  return vec2(mss, cr / sqrt(cs));
}

vec2 worley2(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  float f1 = 8.0, f2 = 8.0;
  for (int y = -1; y <= 1; y++)
    for (int k = -1; k <= 1; k++) {
      vec2 o = vec2(float(k), float(y));
      uint h = hash3u(uvec3(uvec2(ivec2(i + o) + 100000), 61u));
      vec2 r = o + 0.15 + 0.7 * vec2(rnd(h), rnd(h)) - f;
      float dd = dot(r, r);
      if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) f2 = dd;
    }
  return sqrt(vec2(f1, f2));
}

// Water at the point the view ray d meets it: body scattering, sun and moon glints and foam.
// F is the weight left for the reflected scene and r its direction; under marks facets that
// reflect below the horizon (they would see another wave, i.e. more sky, not the shore).
vec3 waterSurface(vec3 d, float Dm, float rate, float fp, vec3 amb, out float F, out vec3 r, out bool under) {
  vec2 P = d.xz * Dm;
  vec3 n;
  vec2 w = waves(P, normalize(d.xz + 1e-6), fp * Dm, max(-d.y, 0.003), n);
  vec3 v = -d;
  F = (0.02 + 0.98 * schlick(dot(n, v))) * uSurfB.a;
  r = reflect(d, n);
  // Even flat water reflects only E / Dm above the horizon, so only facets that tilt the ray
  // below it count, and the clamp stays small enough not to lift the shore's mirror image.
  under = r.y < 0.0;
  r = normalize(vec3(r.x, max(r.y, 1e-5), r.z));
  vec3 sunE = gSunE * gShade;
  vec3 spec = sunE * uSunDisk.x * glint(n, v, uSunDir, w.x + 2e-5 + uSunDisk.y * uSunDisk.y);
  if (uMoon.x > 0.0) {
    // The disk is drawn far below its true radiance so its face stays visible; the glitter path
    // uses a brighter moon so it reads the way it does in a night photograph.
    spec += skyExtinction(uMoonDir.y) * uMoon.z * 250.0 * PI * uMoon.y * uMoon.y * moonLitFrac() * glint(n, v, uMoonDir, w.x + 2e-5 + uMoon.y * uMoon.y);
  }
  vec3 E = directLight(vec3(0.0, 1.0, 0.0)) * gShade + amb;
  vec3 body;
  if (surfType() == SURF_SALT) {
    // Salt crust under a thin film: polygonal ridges break through the mirror.
    float S = uSurf.z, poly = 1.6 * S;
    vec2 c = worley2(P / poly);
    float ridge = 1.0 - smoothstep(0.0, 0.06 + 0.5 * rate / poly, c.y - c.x);
    float far = smoothstep(0.02, 0.3, rate / poly);
    ridge = mix(ridge, 0.12, far);
    float tone = groundNz(P, 40.0 * S, 0.33, rate).r;
    body = mix(uSurfA.rgb, uSurfB.rgb, 0.35 * tone) * (0.9 + 0.25 * ridge) * E;
    F *= 1.0 - 0.8 * ridge * (1.0 - far);
    spec *= 1.0 - 0.8 * ridge * (1.0 - far);
  } else {
    // Light scattered back out of the water column; crests are thin enough to let light through
    // in the Accent colour, brightest with the sun behind them.
    vec2 dh = normalize(d.xz + 1e-5), sh = normalize(uSunDir.xz + 1e-5);
    float thin = smoothstep(-0.2, 1.0, w.y) * uWaveFx.x;
    body = uSurfA.rgb * E + uSurfB.rgb * thin * (0.3 * E + 0.1 * sunE * pow(max(dot(dh, sh), 0.0), 4.0));
  }
  vec3 col = body * (1.0 - F) + spec * uSurfB.a;
  if (uWaveFx.y > 0.0) {
    vec2 q = toFrame(P, dirXZ(uSurfC.x)) / uSurf.z;
    float t = uTime.y * uSurfC.z;
    float streak = nz(vec3(q * vec2(0.012, 0.06) + vec2(-t * 0.004, 0.0), 0.37), rate * 0.06 / uSurf.z).r;
    float speck = nz(vec3(q * 0.35, 0.71 + t * 0.002), rate * 0.35 / uSurf.z).g;
    // The crest is spread about ±0.4: Whitecaps lowers the threshold from its top percent.
    float foam = smoothstep(0.0, 0.25, w.y + (streak - 0.5) * 0.6 + (speck - 0.5) * 0.3 - 1.1 + 0.7 * uWaveFx.y);
    col = mix(col, vec3(0.82) * E, foam);
    F *= 1.0 - foam;
  }
  return col;
}
`;
