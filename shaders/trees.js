'use strict';

// Foreground trees: trunks, branches and crowns.

const GLSL_TREES = `
// Foreground trees stand on the ground plane. Crowns are raymarched foliage volumes (lumpy
// ellipsoids of leaf clusters, or tiered cones for conifers); trunks and limbs are capsules.

const int MAX_TREES = 16;
const int TREE_BROADLEAF = 0, TREE_CONIFER = 1, TREE_BIRCH = 2;

// A tree: where it stands, its crown's centre and radii above that, height, seed and kind, and its
// trunk's radius and the height it reaches (a conifer's stops inside its lower crown).
struct Tree { vec3 base; vec3 c; vec3 R; float h; float seed; int type; float rt; float trunk; };

Tree treeAt(int i) {
  vec4 T = uTree[i];
  Tree tr;
  tr.base = vec3(T.x, -uSurf.y, T.y);
  tr.h = T.z;
  tr.type = int(T.w / 1000.0);
  tr.seed = mod(T.w, 1000.0);
  float w = uTreeLook.z * (0.85 + 0.3 * fract(tr.seed * 0.618));
  if (tr.type == TREE_CONIFER) { tr.c = vec3(0.0, 0.55, 0.0) * tr.h; tr.R = vec3(0.2 * w, 0.46, 0.2 * w) * tr.h; }
  else if (tr.type == TREE_BIRCH) { tr.c = vec3(0.0, 0.64, 0.0) * tr.h; tr.R = vec3(0.24 * w, 0.34, 0.24 * w) * tr.h; }
  else { tr.c = vec3(0.0, 0.6, 0.0) * tr.h; tr.R = vec3(0.44 * w, 0.37, 0.44 * w) * tr.h; }
  tr.rt = tr.h * (tr.type == TREE_CONIFER ? 0.016 : tr.type == TREE_BIRCH ? 0.014 : 0.024);
  tr.trunk = tr.type == TREE_CONIFER ? 0.42 * tr.h : tr.c.y;
  return tr;
}

// A broadleaf crown is the union of a main lobe and two offset side lobes.
float crownShape(Tree tr, vec3 l) {
  vec3 q = (l - tr.c) / tr.R;
  float s = 1.0 - length(q);
  for (int k = 0; k < 2; k++) {
    float a = tr.seed * 1.7 + float(k) * 2.6;
    vec3 o = vec3(cos(a) * 0.48, 0.18 - 0.36 * float(k), sin(a) * 0.48);
    s = max(s, 1.0 - length((q - o) / (0.62 - 0.08 * float(k))));
  }
  return s;
}

// Entry and exit of a ray through an axis-aligned ellipsoid (centre c, radii R).
vec2 ellipsoidSpan(vec3 ro, vec3 rd, vec3 c, vec3 R) {
  vec3 o = (ro - c) / R, v = rd / R;
  float a = dot(v, v), b = dot(o, v), k = dot(o, o) - 1.0, disc = b * b - a * k;
  if (disc < 0.0) return vec2(1e9, -1e9);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s) / a;
}

float capsule(vec3 ro, vec3 rd, vec3 pa, vec3 pb, float r) {
  vec3 ba = pb - pa, oa = ro - pa;
  float baba = dot(ba, ba), bard = dot(ba, rd), baoa = dot(ba, oa), rdoa = dot(rd, oa), oaoa = dot(oa, oa);
  float a = baba - bard * bard, b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - r * r * baba;
  float h = b * b - a * c;
  if (h >= 0.0) {
    float t = (-b - sqrt(h)) / a, y = baoa + t * bard;
    if (y > 0.0 && y < baba) return t;
    vec3 oc = y <= 0.0 ? oa : ro - pb;
    b = dot(rd, oc);
    c = dot(oc, oc) - r * r;
    h = b * b - c;
    if (h > 0.0) return -b - sqrt(h);
  }
  return -1.0;
}

vec3 limbEnd(Tree tr, int k) {
  float a = tr.seed * 2.39 + float(k) * 1.75 + 0.4 * sin(tr.seed + float(k));
  float y = tr.c.y - tr.R.y * (0.1 - 0.12 * float(k & 1));
  return tr.base + vec3(cos(a) * tr.R.x * 0.72, y, sin(a) * tr.R.z * 0.72);
}

// Nearest trunk or limb hit; n is the bark normal, v the height along the trunk (0..1).
float treeWood(Tree tr, vec3 ro, vec3 rd, out vec3 n, out float v) {
  vec3 pa = tr.base - vec3(0.0, 0.5, 0.0), pb = tr.base + vec3(0.0, tr.trunk, 0.0);
  float t = capsule(ro, rd, pa, pb, tr.rt), best = t > 0.0 ? t : 1e9;
  float rr = tr.rt;
  if (tr.type != TREE_CONIFER) {
    vec3 fork = tr.base + vec3(0.0, tr.c.y - 0.75 * tr.R.y, 0.0);
    for (int k = 0; k < 4; k++) {
      vec3 e = limbEnd(tr, k);
      float tk = capsule(ro, rd, fork, e, tr.rt * 0.45);
      if (tk > 0.0 && tk < best) { best = tk; pa = fork; pb = e; rr = tr.rt * 0.45; }
    }
  }
  if (best > 1e8) return -1.0;
  vec3 p = ro + rd * best, ba = pb - pa;
  float h = clamp(dot(p - pa, ba) / dot(ba, ba), 0.0, 1.0);
  n = (p - pa - ba * h) / rr;
  v = (p.y - tr.base.y) / tr.h;
  return best;
}

// A conifer's cone runs from a tenth of its height to its tip: the height up it (0..1) at y above
// the base, and the cone's radius there relative to its foot.
float coneY(Tree tr, float y) { return (y - 0.1 * tr.h) / (0.9 * tr.h); }
float coneRadius(float yy) { return pow(clamp(1.0 - yy, 0.0, 1.0), 0.95); }

// Returns (density, cluster signal): the signal is high in the core of a leaf clump.
vec2 crownDensity(Tree tr, vec3 p, float rate) {
  vec3 l = p - tr.base;
  if (tr.type == TREE_CONIFER) {
    // Conifer: a cone of drooping branch tiers whose tips reach out at uneven lengths.
    float yy = coneY(tr, l.y);
    if (yy < 0.0 || yy > 1.0) return vec2(0.0);
    float rr = length(l.xz) / tr.R.x, ang = atan(l.z, l.x);
    float nt = 10.0 + 4.0 * fract(tr.seed * 0.31), ti = floor(yy * nt + rr * 0.6);
    float tier = fract(yy * nt + rr * 0.6);
    float reach = 0.7 + 0.45 * valueNoise(vec2(ang * 2.2 + ti * 1.7, ti + tr.seed));
    vec4 n1 = nz(l / (tr.h * 0.05) * 0.1 + tr.seed * 0.137, rate / (tr.h * 0.05) * 0.1);
    float Rc = coneRadius(yy) * mix(1.0, 0.62, tier) * reach * (0.88 + 0.24 * n1.r);
    // Each whorl splits into separate drooping limbs, with needle clumps along them.
    float spoke = abs(fract(ang * (1.1 + 0.18 * mod(ti, 3.0)) + ti * 0.37) - 0.5) * 2.0;
    float limbs = smoothstep(0.95, 0.55, spoke + rr * 0.35 - 0.25);
    float d = smoothstep(Rc, Rc - 0.06, rr) * smoothstep(0.0, 0.12, tier + 0.08) * smoothstep(0.42, 0.56, n1.g + 0.12);
    return vec2(d * mix(limbs, 1.0, smoothstep(0.55, 0.2, rr / max(Rc, 1e-3))) * uTreeLook.x, clamp((Rc - rr) * 3.0, 0.0, 1.0));
  }
  float shape = crownShape(tr, l);
  if (shape < -0.35) return vec2(0.0);
  float cs = tr.h * (tr.type == TREE_BIRCH ? 0.08 : 0.12);
  vec3 w = l / cs + tr.seed * vec3(0.37, 0.71, 0.13);
  vec4 n1 = nz(w * 0.1, rate / cs * 0.1);
  shape += (n1.r - 0.5) * 0.7;
  if (shape <= 0.0) return vec2(0.0);
  vec4 n2 = nz(w * 0.33 + 3.1, rate / cs * 0.33);
  vec4 n3 = nz(w * 1.1 + 7.7, rate / cs * 1.1);
  // Leaf clusters with sky between them; mostly an outer shell around a sparser core.
  float sig = n1.g * 0.55 + n2.g * 0.33 + n3.g * 0.14 + shape * 0.5;
  float leaf = smoothstep(0.5, 0.57, sig);
  return vec2(leaf * smoothstep(0.0, 0.04, shape) * mix(0.35, 1.0, smoothstep(0.1, 0.4, 1.0 - shape)) * uTreeLook.x, smoothstep(0.52, 0.78, sig));
}

// Sunlight reaching p through its own crown (no shadows between trees).
float crownSun(Tree tr, vec3 p) {
  if (tr.type == TREE_CONIFER) {
    // Horizontal depth to the sunward side of the cone at this height.
    vec3 l = p - tr.base;
    float Rc = tr.R.x * coneRadius(coneY(tr, l.y));
    vec2 sh = normalize(uSunDir.xz + 1e-5);
    float side = dot(l.xz, sh), across = dot(l.xz, vec2(-sh.y, sh.x));
    float depth = max(sqrt(max(Rc * Rc - across * across, 0.0)) - side, 0.0) / max(length(uSunDir.xz), 0.2);
    return exp(-3.0 * depth / tr.R.x * uTreeLook.x);
  }
  vec2 s = ellipsoidSpan(p, uSunDir, tr.base + tr.c, tr.R);
  return exp(-2.4 * max(s.y, 0.0) / tr.R.x * uTreeLook.x);
}

vec3 foliage(Tree tr, vec3 p) {
  uint h = hash3u(uvec3(ivec3(floor((p - tr.base) / (tr.h * 0.1))) + 4096) + uint(tr.seed * 7.0));
  vec3 base = tr.type == TREE_CONIFER ? uTreeColor * vec3(0.42, 0.58, 0.62) : tr.type == TREE_BIRCH ? uTreeColor * vec3(1.25, 1.2, 0.7) : uTreeColor;
  float autumn = uTreeLook.y * (0.4 + 0.6 * fract(tr.seed * 0.73)) * float(tr.type != TREE_CONIFER);
  base = mix(base, mix(vec3(0.55, 0.16, 0.03), vec3(0.62, 0.38, 0.04), rnd(h)), autumn);
  return base * (0.7 + 0.6 * rnd(h)) * mix(vec3(1.0), vec3(1.1, 1.05, 0.8), rnd(h) * 0.6);
}

vec4 treeShade(Tree tr, vec3 ro, vec3 rd, float t0, float t1, float tw, vec3 n, float v, float fp, float jitter, vec3 amb) {
  float tEnd = tw > 0.0 ? min(t1, tw) : t1;
  vec3 acc = vec3(0.0), L = uSunDir;
  float T = 1.0;
  if (t0 < tEnd) {
    // More steps for crowns that cover many pixels.
    int N = int(clamp(tr.R.x / (fp * t0 + 1e-4) * 0.35, 18.0, 56.0));
    float dt = (tEnd - t0) / float(N), t = t0 + dt * jitter;
    float sigma = 30.0 / tr.R.x;
    for (int k = 0; k < 56; k++) {
      if (k >= N) break;
      vec3 p = ro + rd * t;
      vec2 cd = crownDensity(tr, p, fp * t);
      float dens = cd.x;
      if (dens > 0.01) {
        vec3 q = (p - tr.base - tr.c) / tr.R;
        vec3 nn = normalize(q / tr.R);
        // Light reaching this leaf through the crown; backlit crowns glow only at the rim.
        float sun = crownSun(tr, p);
        float wrap = max(dot(nn, L) * 0.55 + 0.45, 0.0);
        float trans = pow(max(dot(rd, L), 0.0), 4.0) * 2.2;
        float sky = mix(0.25, 1.0, smoothstep(0.2, 1.1, length(q))) * (0.7 + 0.3 * nn.y);
        // Clump cores stand proud and catch light; their edges sit in each other's shade.
        float clump = 0.45 + 0.75 * cd.y;
        vec3 alb = foliage(tr, p);
        vec3 c = alb * (gSunE * sun * (wrap * clump + trans * vec3(1.1, 1.25, 0.6)) / PI + amb * sky * (0.6 + 0.4 * cd.y));
        if (uMoonScale > 0.0) c += alb * gMoonE * max(dot(nn, uMoonDir) * 0.5 + 0.5, 0.0) / PI;
        float a = 1.0 - exp(-sigma * dens * dt);
        acc += T * a * c;
        T *= 1.0 - a;
        if (T < 0.02) break;
      }
      t += dt;
    }
  }
  if (tw > 0.0 && tw <= t1 + 1e-3 && T > 0.02) {
    vec3 p = ro + rd * tw;
    float angle = atan(n.z, n.x);
    bool birch = tr.type == TREE_BIRCH;
    float marks = birch ? smoothstep(0.55, 0.75, valueNoise(vec2(angle * 3.0, v * tr.h * 4.0) + tr.seed)) : 0.0;
    vec3 bark = birch ? mix(vec3(0.6, 0.58, 0.54), vec3(0.06, 0.05, 0.05), marks) : vec3(0.075, 0.06, 0.05) * (0.8 + 0.4 * valueNoise(vec2(angle * 2.0, v * tr.h * 1.5) + tr.seed));
    float sun = crownSun(tr, p);
    vec3 c = bark * (gSunE * max(dot(n, L), 0.0) * sun / PI + amb * mix(0.35, 0.8, sun));
    acc += T * c;
    T = 0.0;
  }
  return vec4(acc, 1.0 - T);
}

// Trees along a ray from ro (eye at the origin, ground at y = -eye height), front to back, up
// to tMax (where the ray meets the ground).
vec4 treesTrace(vec3 ro, vec3 rd, float tMax, float fp, float jitter, vec3 amb, out float tHit) {
  vec3 acc = vec3(0.0);
  float T = 1.0;
  tHit = 1e9;
  for (int i = 0; i < MAX_TREES; i++) {
    if (i >= uTreeN) break;
    Tree tr = treeAt(i);
    vec3 bc = tr.base + vec3(0.0, 0.5 * tr.h, 0.0);
    vec3 oc = ro - bc;
    float br = 0.58 * tr.h + tr.R.x, b = dot(oc, rd), k = dot(oc, oc) - br * br;
    if (b * b - k < 0.0 || -b + sqrt(max(b * b - k, 0.0)) < 0.0) continue;
    vec2 s = ellipsoidSpan(ro, rd, tr.base + tr.c, tr.R * 1.35);
    vec3 n;
    float v, tw = treeWood(tr, ro, rd, n, v);
    if (tw > tMax) tw = -1.0;
    s.y = min(s.y, tMax);
    if (s.y < max(s.x, 0.0) && tw < 0.0) continue;
    float t0 = max(s.x, 0.0), t1 = s.y < t0 ? t0 : s.y;
    if (tw > 0.0) t1 = max(t1, tw + 1e-3);
    vec4 c = treeShade(tr, ro, rd, t0, t1, tw, n, v, fp, jitter, amb);
    if (c.a <= 0.0) continue;
    float tc = tw > 0.0 ? min(t0, tw) : t0;
    tHit = min(tHit, tc);
    // Aerial perspective toward each tree.
    c.rgb = mix(horizonSky(rd) * c.a, c.rgb, hazeT(tc * 0.001));
    acc += T * c.rgb;
    T *= 1.0 - c.a;
    if (T < 0.01) break;
  }
  return vec4(acc, 1.0 - T);
}

// Sunlight left after passing through tree crowns and trunks on the way to p.
float treeShadow(vec3 p) {
  float s = 1.0;
  for (int i = 0; i < MAX_TREES; i++) {
    if (i >= uTreeN) break;
    Tree tr = treeAt(i);
    vec2 sp = ellipsoidSpan(p, uSunDir, tr.base + tr.c, tr.R);
    if (sp.y > max(sp.x, 0.0)) s *= mix(1.0, exp(-2.6 * (sp.y - max(sp.x, 0.0)) / tr.R.x), 0.9 * min(uTreeLook.x, 1.0));
    if (capsule(p, uSunDir, tr.base, tr.base + vec3(0.0, tr.trunk, 0.0), tr.rt) > 0.0) s *= 0.15;
  }
  return s;
}
`;
