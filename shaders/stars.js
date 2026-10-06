'use strict';

// The star population, shared by the sky shader and the pass that averages it (starStats).
const GLSL_STAR = `
vec3 blackbody(float t) {
  t *= 0.01;
  float r = t <= 66.0 ? 1.0 : clamp(1.292936 * pow(t - 60.0, -0.1332047), 0.0, 1.0);
  float g = t <= 66.0 ? clamp(0.3900816 * log(t) - 0.6318414, 0.0, 1.0) : clamp(1.1298909 * pow(t - 60.0, -0.0755148), 0.0, 1.0);
  float b = t >= 66.0 ? 1.0 : t <= 19.0 ? 0.0 : clamp(0.5432068 * log(t - 10.0) - 1.1962541, 0.0, 1.0);
  return pow(vec3(r, g, b), vec3(2.2));
}

// A star's colour from two uniform numbers: its temperature band and its place in the band.
vec3 starColor(float r, float s) {
  float t = r < 0.08 ? mix(2900.0, 4200.0, s) : r < 0.42 ? mix(4800.0, 6600.0, s) : r < 0.8 ? mix(6600.0, 10000.0, s) : mix(10000.0, 26000.0, s);
  vec3 c = blackbody(t * exp2(-uStarLook.y * 0.8)) / blackbody(5800.0);
  c = mix(vec3(1.0), c / max(luma(c), 1e-4), uStarLook.x);
  return mix(c, uStarTint.rgb / max(luma(uStarTint.rgb), 1e-4), uStarTint.a);
}

// A star of brightness u (0..1, most near 0) in layer L, where gain is the Milky Way's boost: its
// flux and its blur, relative to the layer's. Size Variation spreads bright stars wider and shrinks
// faint ones toward a point.
vec2 starShape(float u, float L, float gain) {
  float a = (0.2 + 0.8 * u) * gain;
  float f = uStars.z * 2.4 * pow(0.42, L) * a;
  return vec2(a, (0.8 + 0.3 * u) * mix(1.0, clamp(pow(f / (uStars.z * 0.4 + 1e-4), 0.4), 0.45, 3.0), uSpikes.w));
}
`;
