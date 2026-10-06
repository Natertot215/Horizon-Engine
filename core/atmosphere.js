'use strict';

// The atmosphere and the stars: sky lookup tables, exposure metering and the star statistics.

const KEY = 0.25;
const NIGHT_FLOOR = 2.5e-6;
const transProg = program(VS, TRANS_FS);
const lutProg = program(VS, SKYLUT_FS, { uTrans: 0 });
const atmo = {
  trans: target(TR_W, TR_H, gl.RGBA32F),
  sun: target(SKY_W, SKY_H, gl.RGBA32F),
  moon: target(SKY_W, SKY_H, gl.RGBA32F),
  transSig: '', sunSig: '', moonSig: '', Ysun: 0, Ymoon: 0,
};
const lutBuf = new Float32Array(SKY_W * SKY_H * 4);

function skyMeter(b) {
  let sum = 0, wsum = 0;
  for (let j = 0; j < SKY_H; j++) {
    const s = j / (SKY_H - 1) * 2 - 1;
    if (s <= 0) continue;
    const wj = Math.cos(s * s * Math.PI / 2) * s;
    for (let i = 1; i < SKY_W; i++) {
      const w = wj * i, o = (j * SKY_W + i) * 4;
      sum += w * luma(b[o], b[o + 1], b[o + 2]);
      wsum += w;
    }
  }
  return sum / wsum;
}

// The share of light the ground bounces back into the air: water reflects little, land its colour.
function groundAlbedo() {
  return P.surface === 1 ? 0.06 : luma(...hexLinear(P.surfColorA));
}

function renderSkyLUT(t, elev) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  gl.viewport(0, 0, SKY_W, SKY_H);
  gl.useProgram(lutProg.p);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, atmo.trans.tex);
  gl.uniform4f(lutProg.u.uAtmo, P.rayleigh, P.mie, P.ozone, P.mieG);
  gl.uniform3f(lutProg.u.uLight, 0, Math.sin(elev * DEG), Math.cos(elev * DEG));
  gl.uniform1f(lutProg.u.uFill, P.skyFill);
  gl.uniform1f(lutProg.u.uAlbedo, groundAlbedo());
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.readPixels(0, 0, SKY_W, SKY_H, gl.RGBA, gl.FLOAT, lutBuf);
  return skyMeter(lutBuf);
}

function updateAtmosphere() {
  const transSig = [P.rayleigh, P.mie, P.ozone].join();
  if (transSig !== atmo.transSig) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, atmo.trans.fbo);
    gl.viewport(0, 0, TR_W, TR_H);
    gl.useProgram(transProg.p);
    gl.uniform4f(transProg.u.uAtmo, P.rayleigh, P.mie, P.ozone, P.mieG);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    atmo.transSig = transSig;
  }
  const lutSig = [transSig, P.mieG, P.skyFill, groundAlbedo()].join();
  const sunSig = lutSig + ',' + P.sunElev;
  if (sunSig !== atmo.sunSig) {
    atmo.Ysun = renderSkyLUT(atmo.sun, P.sunElev);
    atmo.sunSig = sunSig;
  }
  const moonSig = lutSig + ',' + P.moonElev;
  if (P.moon && moonSig !== atmo.moonSig) {
    atmo.Ymoon = renderSkyLUT(atmo.moon, P.moonElev);
    atmo.moonSig = moonSig;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// Averages over the star population, for the glow that stands in for stars too dense to draw: per
// layer (texel L) the mean flux × area relative to the layer's own, and the mean colour. Redrawn
// whenever the uniforms it reads change.
const starStats = {
  prog: program(VS, `#version 300 es
precision highp float;
precision highp int;
${SCENE_UNIFORM_DECLS()}
out vec4 outColor;
${GLSL_COMMON}
${GLSL_STAR}
void main() {
  vec3 c = vec3(0.0);
  for (int i = 0; i < 16; i++) for (int j = 0; j < 16; j++) c += starColor((float(i) + 0.5) / 16.0, (float(j) + 0.5) / 16.0);
  float e = 0.0;
  for (int i = 0; i < 64; i++) {
    vec2 sh = starShape(pow((float(i) + 0.5) / 64.0, 3.0), floor(gl_FragCoord.x), 1.0);
    e += sh.x * sh.y * sh.y;
  }
  outColor = vec4(c / 256.0, e / 64.0);
}`),
  t: target(7, 1, gl.RGBA32F), sig: '',
};

function updateStarStats() {
  const used = SCENE_UNIFORMS.filter(([name]) => starStats.prog.u[name]), values = used.map(([, , get]) => get());
  const sig = JSON.stringify(values);
  if (sig === starStats.sig) return;
  starStats.sig = sig;
  gl.bindFramebuffer(gl.FRAMEBUFFER, starStats.t.fbo);
  gl.viewport(0, 0, 7, 1);
  gl.useProgram(starStats.prog.p);
  used.forEach(([name, type], i) => SETTERS[type](starStats.prog.u[name], values[i]));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
