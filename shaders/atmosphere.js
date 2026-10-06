'use strict';

// The atmosphere: densities, transmittance and the sky lookup table.
// Requires uniforms uAtmo (rayleigh, mie, ozone, mie g) and sampler uTrans.
const GLSL_ATMO = `
const float RG = 6360.0, RT = 6460.0, OBS = 6360.05;
const vec3 RAY_SCA = vec3(5.802e-3, 13.558e-3, 33.1e-3);
const float MIE_SCA = 3.996e-3, MIE_EXT = 4.4e-3;
const vec3 OZONE_ABS = vec3(0.650e-3, 1.881e-3, 0.085e-3);

// Distance from the eye out to the sphere of radius r around the Earth's centre along a ray with
// b = OBS * d.y.
float shellDist(float b, float r) { return -b + sqrt(max(b * b - (OBS * OBS - r * r), 0.0)); }

vec3 densities(float h) {
  return vec3(exp(-h / 8.0) * uAtmo.x, exp(-h / 1.2) * uAtmo.y, max(0.0, 1.0 - abs(h - 25.0) / 15.0) * uAtmo.z);
}

vec3 extinction(vec3 n) { return RAY_SCA * n.x + MIE_EXT * n.y + OZONE_ABS * n.z; }

vec3 transmittance(float r, float mu) {
  if (DBG(DBG_TRANS)) return vec3(0.8);
  float H = sqrt(RT * RT - RG * RG);
  float rho = sqrt(max(0.0, r * r - RG * RG));
  float muH = -rho / r;
  float m = max(mu, muH);
  float d = max(0.0, -r * m + sqrt(max(0.0, r * r * (m * m - 1.0) + RT * RT)));
  float dMin = RT - r, dMax = rho + H;
  vec2 x = vec2((d - dMin) / max(dMax - dMin, 1e-6), rho / H);
  return fetchBilinear(uTrans, x, TR_SIZE).rgb * smoothstep(muH - SUN_R, muH + SUN_R, mu);
}

float phaseRayleigh(float c) { return 0.0596831 * (1.0 + c * c); }

float phaseMie(float c, float g) {
  float g2 = g * g;
  return 0.1193662 * (1.0 - g2) * (1.0 + c * c) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
`;

const TRANS_FS = `#version 300 es
precision highp float;
uniform vec4 uAtmo;
uniform sampler2D uTrans;
out vec4 outColor;
${GLSL_COMMON}
${GLSL_ATMO}
void main() {
  vec2 x = (gl_FragCoord.xy - 0.5) / (TR_SIZE - 1.0);
  float H = sqrt(RT * RT - RG * RG);
  float rho = H * x.y;
  float r = sqrt(rho * rho + RG * RG);
  float dMin = RT - r, dMax = rho + H;
  float d = dMin + x.x * (dMax - dMin);
  float mu = d < 1e-4 ? 1.0 : clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
  vec3 tau = vec3(0.0);
  const int N = 80;
  float dt = d / float(N);
  for (int k = 0; k < N; k++) {
    float t = (float(k) + 0.5) * dt;
    tau += extinction(densities(sqrt(t * t + 2.0 * r * mu * t + r * r) - RG)) * dt;
  }
  outColor = vec4(any(isnan(tau)) ? vec3(1.0) : exp(-tau), 1.0); // isnan: no Metal fast math (see SKY_FS)
}`;

const SKYLUT_FS = `#version 300 es
precision highp float;
uniform vec4 uAtmo;
uniform sampler2D uTrans;
uniform vec3 uLight;
uniform float uFill, uAlbedo;
out vec4 outColor;
${GLSL_COMMON}
${GLSL_ATMO}
void main() {
  vec2 x = (gl_FragCoord.xy - 0.5) / (SKY_SIZE - 1.0);
  float az = x.x * x.x * PI;
  float s = x.y * 2.0 - 1.0;
  float el = sign(s) * s * s * 0.5 * PI;
  vec3 d = vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az));
  vec3 p0 = vec3(0.0, OBS, 0.0);
  float mu = d.y;
  float discG = OBS * OBS * (mu * mu - 1.0) + RG * RG;
  bool ground = mu < 0.0 && discG >= 0.0;
  float tMax = ground ? -OBS * mu - sqrt(discG) : -OBS * mu + sqrt(OBS * OBS * (mu * mu - 1.0) + RT * RT);
  float c = dot(d, uLight);
  float pr = phaseRayleigh(c), pm = phaseMie(c, uAtmo.w);
  vec3 L = vec3(0.0), T = vec3(1.0);
  const int N = 48;
  float tPrev = 0.0;
  for (int k = 0; k < N; k++) {
    float f = (float(k) + 1.0) / float(N);
    float t1 = tMax * f * f;
    float dt = t1 - tPrev;
    vec3 p = p0 + d * (tPrev + 0.5 * dt);
    tPrev = t1;
    float r = length(p);
    vec3 n = densities(r - RG);
    vec3 sR = RAY_SCA * n.x;
    float sM = MIE_SCA * n.y;
    vec3 ext = extinction(n);
    float muS = dot(p, uLight) / r;
    float muH = -sqrt(max(0.0, 1.0 - RG * RG / (r * r)));
    vec3 Ts = transmittance(r, muS);
    vec3 Tms = transmittance(r, max(muS, 0.25)) * exp(-max(0.0, muH - muS) * 60.0);
    // Sunlight the ground reflects fills the lower half of the sphere, seen through the air below p.
    vec3 bounce = (uAlbedo / PI) * max(muS, 0.0) * transmittance(RG, muS) * transmittance(RG, 1.0) / transmittance(r, 1.0);
    vec3 S = (sR * pr + sM * pm) * Ts + (sR + sM) * (uFill * 0.08 * Tms + 0.5 * bounce);
    vec3 stepT = exp(-ext * dt);
    L += T * S * (1.0 - stepT) / max(ext, vec3(1e-9));
    T *= stepT;
  }
  if (ground) {
    vec3 pg = normalize(p0 + d * tMax);
    float muG = dot(pg, uLight);
    L += T * (uAlbedo / PI) * transmittance(RG, muG) * max(muG, 0.0);
  }
  outColor = vec4(any(isnan(L)) || any(isinf(L)) ? vec3(0.0) : L, 1.0); // isnan: no Metal fast math (see SKY_FS)
}`;
