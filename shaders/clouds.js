'use strict';

// Cloud layers: their fields, density and lighting.
const GLSL_CLOUDS = `
float remap(float v, float a, float b) { return clamp((v - a) / (b - a), 0.0, 1.0); }

// A tint colour scaled to unit luma, blended in by its alpha.
vec3 lumaTint(vec4 t) { return mix(vec3(1.0), t.rgb / max(luma(t.rgb), 0.05), t.a); }

vec3 gCloudAmb = vec3(0.0); // sky light on the ground, lighting the clouds from below

float hg(float c, float g) {
  float g2 = g * g;
  return 0.0795775 * (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);
}

// A layer's field in cell units: x is the puff field before thresholding, y the local coverage.
// Weather (two very large octaves) makes coverage and cell size wander across the sky, and every
// octave is rotated and scaled by an irrational ratio, so the tiled noise never visibly repeats.
// Per layer, uCloudA is (cover, density, altitude, thickness), B (scale, billow, cells, streak),
// C (detail, soft, evolution, seed), D (wind heading sin and cos, drift) and E.x how much the
// weather varies it.
vec2 cloudField(int i, vec2 xz, float h, float rate) {
  vec4 B = uCloudB[i], Cc = uCloudC[i], Dd = uCloudD[i];
  vec2 q = xz + Dd.zw;
  vec2 r = vec2(dot(q, Dd.xy), dot(q, vec2(-Dd.y, Dd.x))) / B.x;
  rate /= B.x;
  float m = Cc.z, vary = uCloudE[i].x;
  vec3 o = Cc.w * vec3(0.137, 0.291, 0.533);
  float w = nz(vec3(rot2(r, 0.6) * 0.017 + o.xy, 0.31 + m * 0.1), 0.017 * rate).r * 0.6
          + nz(vec3(rot2(r, 2.2) * 0.043 + o.yz, 0.67 + m * 0.2), 0.043 * rate).r * 0.4;
  r.x /= 1.0 + B.w * 5.0;
  // Dense weather breaks into tighter cells; thin weather into larger, looser ones.
  r *= 1.0 + (w - 0.5) * 0.7 * vary;
  if (B.w > 0.0) {
    vec2 wv = vec2(nz(vec3(r * 0.35, m) + o.zxy, 0.35 * rate).a, nz(vec3(r * 0.35, m) + o.yzx + 0.5, 0.35 * rate).a) - 0.5;
    r += wv * B.w * 1.6;
  }
  float big = nz(vec3(rot2(r, 1.1) * 0.13, m * 0.5) + o, 0.13 * rate).r;
  // Height h (km above the base) runs along the lookups' third axis at their own scale, so the
  // shapes change up through a cloud instead of standing as columns extruded from its base.
  float z = h / B.x;
  float n1 = nz(vec3(r * 0.5, m + z * 0.5) + o.yzx, 0.5 * rate).r;
  float base = mix(n1, nz(vec3(rot2(r, 0.83) * 1.37, m * 1.3 + z * 1.37) + o.zxy, 1.37 * rate).a, 0.3);
  if (B.y > 0.0) base = mix(base, nz(vec3(rot2(r, 0.4) * 0.53, m + z * 0.53) + o.zxy, 0.53 * rate).g * 0.6 + base * 0.4, B.y);
  if (B.z > 0.0) base = mix(base, base * 0.45 + nz(vec3(rot2(r, 1.9) * 2.3, m * 1.5 + z * 2.3) + o, 2.3 * rate).b * 0.75 - 0.08, B.z);
  return vec2(base, uCloudA[i].x + (big - 0.5) * 0.5 + (w - 0.5) * 1.3 * vary);
}

float cloudDensity(int i, vec3 pw, float hf, float rate, bool detailed) {
  if (hf < 0.0 || hf > 1.0) return 0.0;
  vec2 f = cloudField(i, pw.xz, clamp(hf, 0.0, 1.0) * uCloudA[i].w, rate);
  float puff = uCloudB[i].y, soft = uCloudC[i].y;
  // Flat bases and domed tops for heaped clouds, lens shapes for thin layers: only the strongest
  // part of the field reaches the top and bottom, so puffs are rounded rather than extruded. Edges
  // soften with the pixel footprint instead of breaking into blocks.
  float top = max(hf - 0.2, 0.0) / 0.8;
  float prof = mix(4.0 * hf * (1.0 - hf), smoothstep(0.0, 0.1, hf) * (1.0 - top * top), puff);
  float lo = 1.0 - f.y + (1.0 - prof) * mix(0.6 - 0.25 * soft, 0.3, puff);
  float d = remap(f.x, lo, lo + 0.06 + 0.3 * soft + min(rate * 2.0, 0.3));
  if (d <= 0.0) return 0.0;
  d = mix(d * d * (3.0 - 2.0 * d), sqrt(d), puff);
  if (detailed && uCloudC[i].x > 0.0) {
    float ds = uCloudB[i].x * 0.16;
    vec3 dq = vec3(pw.x + uCloudD[i].z, pw.y, pw.z + uCloudD[i].w) / ds + vec3(0.0, uCloudC[i].z * 2.0, 0.0);
    float det = nz(dq, rate / ds).g * 0.65 + nz(dq * 2.7, 2.7 * rate / ds).b * 0.35;
    d = remap(d, uCloudC[i].x * 0.55 * (1.0 - det), 1.0);
  }
  return d;
}

vec4 cloudLayer(int i, vec3 d, float fp, float jitter) {
  float hb = uCloudA[i].z, th = uCloudA[i].w;
  float rIn = RG + hb, rOut = rIn + th;
  float t0 = shellDist(OBS * d.y, rIn), t1 = shellDist(OBS * d.y, rOut);
  float tEnd = min(t1, t0 + 12.0 * th + 20.0);
  if (tEnd <= t0) return vec4(0.0, 0.0, 0.0, 1.0);
  float tm = 0.5 * (t0 + tEnd);
  vec3 pm = d * tm + vec3(0.0, OBS, 0.0);
  vec3 up = normalize(pm);
  float rm = length(pm);
  bool moonLit = uMoonScale > uSunScale * luma(transmittance(rm, dot(up, uSunDir)));
  vec3 L = moonLit ? uMoonDir : uSunDir;
  float glow = 1.0 + uCloudLight.z * (1.0 - smoothstep(-0.05, 0.25, uSunDir.y));
  vec3 lightCol = (moonLit ? uMoonScale : uSunScale * glow) * transmittance(rm, dot(up, L)) * lumaTint(uCloudTint) * uCloudLight.w;
  vec3 ambTop = skyLight(vec3(0.0, 1.0, 0.0));
  vec3 ambBot = gCloudAmb * 0.6;
  ambBot += uLPColor * uLP.x * uCloudMisc.y * uNightScale * lpFocus(d) * (1.0 - 0.5 * smoothstep(0.0, 0.6, d.y));
  vec3 ambK = lumaTint(uCloudShade) * uCloudLight.y * uCloudLight.w;
  ambTop *= ambK;
  ambBot *= ambK;
  float c = dot(d, L);
  float phase = mix(0.0796, 0.75 * hg(c, 0.82) + 0.25 * hg(c, -0.25), uCloudLight.x);
  float sigma = uCloudA[i].y * 32.0;
  float Lup = dot(L, up);
  // At most the 64 steps the loop below allows, or the march would stop short of tEnd.
  int n = int(clamp((tEnd - t0) / (th * 0.07) * uQuality, 8.0, min(48.0 * uQuality, 64.0)));
  float graze = inversesqrt(max(abs(dot(d, up)), 0.04));
  float dt = (tEnd - t0) / float(n);
  float t = t0 + dt * jitter;
  vec3 acc = vec3(0.0);
  float T = 1.0;
  for (int k = 0; k < 64; k++) {
    if (k >= n || T < 0.01) break;
    vec3 pw = d * t;
    float hf = (length(pw + vec3(0.0, OBS, 0.0)) - rIn) / th;
    float rate = fp * t * graze;
    float den = cloudDensity(i, pw, hf, rate, true);
    if (den > 0.002) {
      float dist = min(Lup > 0.08 ? (1.0 - hf) * th / Lup : Lup < -0.08 ? hf * th / -Lup : th * 3.0, 3.0);
      float tau = 0.0;
      tau += cloudDensity(i, pw + L * dist * 0.1, hf + Lup * dist * 0.1 / th, rate * 2.0, false) * 0.22;
      tau += cloudDensity(i, pw + L * dist * 0.35, hf + Lup * dist * 0.35 / th, rate * 2.0, false) * 0.3;
      tau += cloudDensity(i, pw + L * dist * 0.8, hf + Lup * dist * 0.8 / th, rate * 2.0, false) * 0.48;
      tau *= dist * sigma;
      float beer = exp(-tau) + 0.35 * exp(-tau * 0.25) + 0.12 * exp(-tau * 0.06);
      float powder = 1.0 - 0.55 * exp(-den * sigma * 0.35);
      vec3 S = lightCol * beer * phase * powder + mix(ambBot, ambTop, clamp(hf, 0.0, 1.0));
      float st = exp(-den * sigma * dt);
      acc += T * S * (1.0 - st);
      T *= st;
    }
    t += dt;
  }
  float fade = exp(-tm / mix(500.0, 25.0, uCloudMisc.x));
  return vec4(acc * fade, mix(1.0, T, fade));
}

vec4 clouds(vec3 d, float fp, float jitter, vec3 amb) {
  vec3 L = vec3(0.0);
  float T = 1.0;
  if (d.y < -0.02) return vec4(L, T);
  gCloudAmb = amb;
  for (int i = 0; i < 3; i++) {
    if (i >= uCloudN) break;
    vec4 c = cloudLayer(i, d, fp, jitter);
    L += T * c.rgb;
    T *= c.a;
    if (T < 0.01) break;
  }
  return vec4(L, T);
}
`;
