'use strict';

// The aurora.

const GLSL_AURORA = `
vec3 aurora(vec3 d, float fp, float jitter) {
  if (uAurora.x <= 0.0 || d.y <= 0.0) return vec3(0.0);
  vec2 hd = dirXZ(uAurora.z);
  float time = uTime.z, base = mix(1100.0, -150.0, uAurora.w);
  vec3 acc = vec3(0.0);
  const int N = 28;
  for (int k = 0; k < N; k++) {
    float hf = (float(k) + jitter) / float(N);
    float t = shellDist(OBS * d.y, RG + 95.0 + 190.0 * uAurora.y * hf);
    vec2 xz = toFrame(d.xz * t, hd);
    float across = xz.x, along = xz.y;
    float rate = fp * t * 0.001;
    // Curtains meander at three scales; a few run side by side.
    float fold = (nz(vec3(along * 0.0006, time * 0.0015, 0.37), rate * 0.6).a - 0.5) * 420.0
               + (nz(vec3(along * 0.003, time * 0.004, 0.71), rate * 3.0).a - 0.5) * 90.0
               + (nz(vec3(along * 0.012, time * 0.01, 0.55), rate * 12.0).r - 0.5) * 18.0;
    float c = across - base - fold;
    float band = gauss(c / 7.0) + 0.55 * gauss((c - 120.0) / 10.0) + 0.35 * gauss((c + 260.0) / 12.0) + 0.1 * gauss(c / 90.0);
    if (band < 0.002) continue;
    // Fine vertical rays and brighter knots along the curtain.
    float rays = 0.45 + 0.55 * smoothstep(0.35, 0.8, nz(vec3(along * 0.09, time * 0.03, 0.13 + hf * 0.04), rate * 90.0).r);
    float knots = 0.55 + 0.45 * smoothstep(0.3, 0.7, nz(vec3(along * 0.004, time * 0.006, 0.91), rate * 4.0).r);
    float vprof = smoothstep(0.0, 0.03, hf) * exp(-hf * 3.0);
    vec3 col = mix(uAuroraA, uAuroraB, smoothstep(0.12, 0.65, hf));
    acc += col * band * rays * knots * vprof;
  }
  return acc * uAurora.x * 0.12;
}
`;
