// Block-anomaly detector for SIMD-group-sized garbage.
//
// Apple GPUs shade fragments in SIMD groups of 32 threads that cover an aligned 8×4 pixel cell.
// When a whole group computes garbage (or is skipped), the output has an 8×4 cell whose colour is
// off from its surroundings, with the step sitting exactly on the cell's edges. Natural content
// (stars, grass, a horizon that happens to land on a row of the grid) does not do that on three or
// four sides at once while staying smooth inside, so the detector asks for both:
//   1. the cell mean deviates from the median of its 8 neighbouring cell means, and
//   2. on at least `minSharpSides` of its sides (all sides for cells at a corner) the mean step
//      across the cell edge is far larger than the steps one pixel inside and one pixel outside,
//      and every pixel along that edge steps the same way as the deviation (a stray star or a
//      flower inside the cell steps on a few pixels only).
//
// Images are RGBA, row-major, in framebuffer order (as gl.readPixels returns them). Cells are
// aligned to the framebuffer origin; partial cells at the right and top edges are skipped.

export const DEFAULTS = {
  bw: 8,             // cell width in pixels
  bh: 4,             // cell height in pixels
  minDev: 0.012,     // cell mean vs neighbour median, max over RGB, in [0, 1] units
  minStep: 0.008,    // mean signed step across a sharp edge, in [0, 1] units
  ratio: 4,          // edge step must exceed this multiple of the neighbouring steps
  uniform: 0.4,      // every pixel along a sharp edge must step by at least this fraction of the mean
  minSharpSides: 3,  // sharp sides needed (fewer when the cell touches the image border)
};

// Converts RGBA data to a Float32Array of RGB in [0, 1]. `scale` maps raw values to [0, 1]: 1/255
// for RGBA8 bytes, 1/N for an accumulation buffer holding the sum of N frames.
export function toRGB(px, w, h, scale = 1) {
  const out = new Float32Array(w * h * 3);
  for (let i = 0, j = 0; i < w * h * 4; i += 4, j += 3) {
    out[j] = px[i] * scale;
    out[j + 1] = px[i + 1] * scale;
    out[j + 2] = px[i + 2] * scale;
  }
  return out;
}

function median(values) {
  const s = values.slice().sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
}

// Returns flagged cells as [{ bx, by, x, y, dev, sharp }] where (x, y) is the cell's lower-left
// pixel in framebuffer coordinates. `rgb` is the output of toRGB.
export function findBlockAnomalies(rgb, w, h, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const { bw, bh } = o;
  const nx = Math.floor(w / bw), ny = Math.floor(h / bh);
  const at = (x, y, c) => rgb[(y * w + x) * 3 + c];

  const means = new Float32Array(nx * ny * 3);
  for (let by = 0; by < ny; by++) {
    for (let bx = 0; bx < nx; bx++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let y = by * bh; y < (by + 1) * bh; y++) for (let x = bx * bw; x < (bx + 1) * bw; x++) s += at(x, y, c);
        means[(by * nx + bx) * 3 + c] = s / (bw * bh);
      }
    }
  }

  // Signed step across one edge of a cell (inside minus outside, times `sign`): its mean, its
  // smallest per-pixel value, and the larger of the mean steps one pixel inside and one outside.
  // `inner(i, d)` / `outer(i, d)` give the pixel at position i along the edge and depth d from it.
  function edge(len, inner, outer, c, sign) {
    let step = 0, minStep = Infinity, inStep = 0, outStep = 0, nOut = 0;
    for (let i = 0; i < len; i++) {
      const [ix0, iy0] = inner(i, 0), [ix1, iy1] = inner(i, 1);
      const [ox0, oy0] = outer(i, 0), [ox1, oy1] = outer(i, 1);
      const s = sign * (at(ix0, iy0, c) - at(ox0, oy0, c));
      step += s;
      minStep = Math.min(minStep, s);
      inStep += at(ix1, iy1, c) - at(ix0, iy0, c);
      if (ox1 >= 0 && ox1 < w && oy1 >= 0 && oy1 < h) { outStep += at(ox0, oy0, c) - at(ox1, oy1, c); nOut++; }
    }
    return { step: step / len, minStep, control: Math.max(Math.abs(inStep / len), nOut ? Math.abs(outStep / nOut) : 0) };
  }

  const flagged = [];
  for (let by = 0; by < ny; by++) {
    for (let bx = 0; bx < nx; bx++) {
      const x0 = bx * bw, y0 = by * bh, x1 = x0 + bw - 1, y1 = y0 + bh - 1;
      // 1. Deviation from the neighbourhood.
      let dev = 0, devC = 0, devSign = 0;
      for (let c = 0; c < 3; c++) {
        const nb = [];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const qx = bx + dx, qy = by + dy;
          if (qx >= 0 && qx < nx && qy >= 0 && qy < ny) nb.push(means[(qy * nx + qx) * 3 + c]);
        }
        const d = means[(by * nx + bx) * 3 + c] - median(nb);
        if (Math.abs(d) > dev) { dev = Math.abs(d); devC = c; devSign = Math.sign(d); }
      }
      if (dev < o.minDev) continue;

      // 2. Sharp steps exactly on the cell edges, in the direction of the deviation.
      const sides = [];
      if (x0 > 0) sides.push([bh, (i, d) => [x0 + d, y0 + i], (i, d) => [x0 - 1 - d, y0 + i]]);
      if (x1 < w - 1) sides.push([bh, (i, d) => [x1 - d, y0 + i], (i, d) => [x1 + 1 + d, y0 + i]]);
      if (y0 > 0) sides.push([bw, (i, d) => [x0 + i, y0 + d], (i, d) => [x0 + i, y0 - 1 - d]]);
      if (y1 < h - 1) sides.push([bw, (i, d) => [x0 + i, y1 - d], (i, d) => [x0 + i, y1 + 1 + d]]);
      let sharp = 0;
      for (const [len, inner, outer] of sides) {
        const e = edge(len, inner, outer, devC, devSign);
        if (e.step >= o.minStep && e.step >= o.ratio * e.control && e.minStep >= o.uniform * e.step) sharp++;
      }
      if (sharp >= Math.min(o.minSharpSides, sides.length)) flagged.push({ bx, by, x: x0, y: y0, dev, sharp });
    }
  }
  return flagged;
}

// Self-check support: returns a copy of `rgb` with the given cells overwritten. `mode` is
//   'solid'  – the cell becomes `color` (the thumbnail symptom: near-black dark red), or
//   'blend'  – the cell becomes mix(pixel, color, amount) (the averaged-view symptom: one of N
//              accumulated frames was garbage, so the cell is slightly darker and tinted).
export function corruptCells(rgb, w, cells, { mode = 'solid', color = [0.09, 0.01, 0.01], amount = 1 / 12, bw = 8, bh = 4 } = {}) {
  const out = rgb.slice();
  for (const [bx, by] of cells) {
    for (let y = by * bh; y < (by + 1) * bh; y++) {
      for (let x = bx * bw; x < (bx + 1) * bw; x++) {
        for (let c = 0; c < 3; c++) {
          const i = (y * w + x) * 3 + c;
          out[i] = mode === 'solid' ? color[c] : out[i] * (1 - amount) + color[c] * amount;
        }
      }
    }
  }
  return out;
}

// Mean max-over-RGB difference between horizontally and vertically adjacent pixels over the cell
// and its 8 neighbours: low in sky and calm water, high in grass, stars and foliage. The self-check
// puts faint corruptions where the real symptom was seen, in smooth regions.
export function cellBusyness(rgb, w, h, bx, by, { bw = 8, bh = 4 } = {}) {
  const xa = Math.max(0, (bx - 1) * bw), xb = Math.min(w - 1, (bx + 2) * bw - 1);
  const ya = Math.max(0, (by - 1) * bh), yb = Math.min(h - 1, (by + 2) * bh - 1);
  let s = 0, n = 0;
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const i = (y * w + x) * 3;
      if (x < xb) { let m = 0; for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(rgb[i + c] - rgb[i + 3 + c])); s += m; n++; }
      if (y < yb) { let m = 0; for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(rgb[i + c] - rgb[i + w * 3 + c])); s += m; n++; }
    }
  }
  return s / n;
}

// Mean of the max-over-RGB distance between a cell's pixels and `color`; used by the self-check to
// pick cells where a corruption is actually visible.
export function cellContrast(rgb, w, bx, by, color, { bw = 8, bh = 4 } = {}) {
  let s = 0;
  for (let y = by * bh; y < (by + 1) * bh; y++) {
    for (let x = bx * bw; x < (bx + 1) * bw; x++) {
      let m = 0;
      for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(rgb[(y * w + x) * 3 + c] - color[c]));
      s += m;
    }
  }
  return s / (bw * bh);
}
