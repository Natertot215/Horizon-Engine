'use strict';

// GLSL every program shares: lookup-table sizes, the sun, debug bits, constants and helpers.

const TR_W = 256, TR_H = 64, SKY_W = 192, SKY_H = 108;
const SUN_R = 0.00465;

// Stage bypasses for the ?diag self-test, one uDebug bit each. Only the diagnostic build of the sky
// shader defines DIAG; everywhere else DBG() is the constant false and the branches compile away.
const DBG_BITS = ['LUT', 'TRANS', 'NOISE', 'WATER', 'LAND', 'CELESTIAL', 'CLOUDS', 'GRADE', 'DITHER', 'FLAT', 'GRAD', 'INJECT'];

const GLSL_COMMON = `
#ifdef DIAG
uniform int uDebug;
#define DBG(b) ((uDebug & (b)) != 0)
#else
#define DBG(b) false
#endif
${DBG_BITS.map((n, i) => `#define DBG_${n} ${1 << i}`).join('\n')}
const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const float DEG = 0.01745329252;
const float SUN_R = ${SUN_R};
const vec2 TR_SIZE = vec2(${TR_W}.0, ${TR_H}.0);
const vec2 SKY_SIZE = vec2(${SKY_W}.0, ${SKY_H}.0);

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float wrapAngle(float a) { return mod(a + PI, TAU) - PI; }

float gauss(float x) { return exp(-0.5 * x * x); }

vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

// The unit xz vector of a compass heading, and a point's coordinates in the frame of a unit axis u
// and its perpendicular (u.y, -u.x), and back.
vec2 dirXZ(float heading) { return vec2(sin(heading), cos(heading)); }
vec2 toFrame(vec2 p, vec2 u) { return vec2(dot(p, u), dot(p, vec2(u.y, -u.x))); }
vec2 fromFrame(vec2 q, vec2 u) { return q.x * u + q.y * vec2(u.y, -u.x); }

float valueNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}

vec4 fetchBilinear(sampler2D t, vec2 x, vec2 size) {
  vec2 f = clamp(x, 0.0, 1.0) * (size - 1.0);
  ivec2 i = clamp(ivec2(f), ivec2(0), ivec2(size) - 2); // always in bounds, even for a NaN x
  vec2 w = clamp(f - vec2(i), 0.0, 1.0);
  vec4 a = texelFetch(t, i, 0), b = texelFetch(t, i + ivec2(1, 0), 0);
  vec4 c = texelFetch(t, i + ivec2(0, 1), 0), d = texelFetch(t, i + ivec2(1, 1), 0);
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
`;
