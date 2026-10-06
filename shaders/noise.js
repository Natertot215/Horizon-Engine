'use strict';

// Hashes, and the tiling 3D noise texture the sky shader samples.
const GLSL_NOISE = `
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

uint hash3u(uvec3 v) { return pcg(v.x ^ pcg(v.y ^ pcg(v.z))); }

float rnd(inout uint h) {
  h = pcg(h);
  return float(h) * (1.0 / 4294967296.0);
}
`;

const NOISE_N = 128;

const NOISE3_FS = `#version 300 es
precision highp float;
precision highp int;
uniform float uSlice;
out vec4 outColor;
${GLSL_NOISE}

vec3 rand3(vec3 c, uint salt) {
  uvec3 q = uvec3(ivec3(c));
  uint h = hash3u(q ^ uvec3(salt));
  float a = rnd(h), b = rnd(h), d = rnd(h);
  return vec3(a, b, d);
}

#define GRAD(o) dot(normalize(rand3(mod(i + o, period), salt) * 2.0 - 0.999), f - o)

float perlin(vec3 x, float period, uint salt) {
  vec3 i = floor(x), f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = GRAD(vec3(0, 0, 0)), b = GRAD(vec3(1, 0, 0)), c = GRAD(vec3(0, 1, 0)), d = GRAD(vec3(1, 1, 0));
  float e = GRAD(vec3(0, 0, 1)), g = GRAD(vec3(1, 0, 1)), h = GRAD(vec3(0, 1, 1)), k = GRAD(vec3(1, 1, 1));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}

float worley(vec3 x, float period, uint salt) {
  vec3 i = floor(x), f = fract(x);
  float d = 8.0;
  for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
      for (int xx = -1; xx <= 1; xx++) {
        vec3 o = vec3(float(xx), float(y), float(z));
        vec3 v = f - o - rand3(mod(i + o, period), salt);
        d = min(d, dot(v, v));
      }
  return sqrt(d);
}

float fbm(vec3 p, float base, int octaves, uint salt) {
  float v = 0.0, amp = 1.0, tot = 0.0;
  for (int o = 0; o < 6; o++) {
    if (o >= octaves) break;
    float fr = base * exp2(float(o));
    v += amp * perlin(p * fr, fr, salt + uint(o));
    tot += amp;
    amp *= 0.5;
  }
  return clamp(0.5 + 1.4 * v / tot, 0.0, 1.0);
}

float cells(vec3 p, float base, uint salt) {
  float w1 = worley(p * base, base, salt), w2 = worley(p * base * 2.0, base * 2.0, salt + 1u);
  float w3 = worley(p * base * 4.0, base * 4.0, salt + 2u);
  return clamp(1.0 - (w1 * 0.625 + w2 * 0.25 + w3 * 0.125) * 1.15, 0.0, 1.0);
}

// Octaves stop at 32 per tile (4 texels per cycle): finer ones sit at the texel spacing, where
// trilinear filtering turns them into streaks and stair steps wherever the texture is magnified.
// Shaders reach finer detail by sampling at larger scales.
void main() {
  vec3 p = vec3(gl_FragCoord.xy / ${NOISE_N}.0, uSlice);
  outColor = vec4(fbm(p, 4.0, 4, 11u), cells(p, 4.0, 23u), cells(p, 8.0, 37u), fbm(p, 8.0, 3, 41u));
}`;
