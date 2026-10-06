'use strict';

// Capture output: tiled stills and their encoding.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts) {
  let c = 0xffffffff;
  for (const b of parts) for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const head = new Uint8Array(8);
  new DataView(head.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) head[4 + i] = type.charCodeAt(i);
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, crc32([head.subarray(4), data]));
  return [head, data, tail];
}

async function encodePNG(rgba, W, H, progress) {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, W);
  dv.setUint32(4, H);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const cs = new CompressionStream('deflate');
  const compressed = new Response(cs.readable).arrayBuffer();
  const writer = cs.writable.getWriter();
  const stride = W * 3, ROWS = 48;
  let t0 = performance.now();
  for (let y0 = 0; y0 < H; y0 += ROWS) {
    const n = Math.min(ROWS, H - y0), buf = new Uint8Array(n * (stride + 1));
    for (let i = 0; i < n; i++) {
      const y = y0 + i, o = i * (stride + 1) + 1, cur = y * W * 4, prev = cur - W * 4;
      buf[o - 1] = 4;
      for (let x = 0, k = 0; x < W; x++) {
        for (let ch = 0; ch < 3; ch++, k++) {
          const q = x * 4 + ch;
          const a = x > 0 ? rgba[cur + q - 4] : 0;
          const b = y > 0 ? rgba[prev + q] : 0;
          const c = x > 0 && y > 0 ? rgba[prev + q - 4] : 0;
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          buf[o + k] = rgba[cur + q] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
      }
    }
    await writer.write(buf);
    if (performance.now() - t0 > 40) {
      progress((y0 + n) / H);
      await nextFrame();
      t0 = performance.now();
      if (job.cancel) { compressed.catch(() => {}); writer.abort(); return null; }
    }
  }
  await writer.close();
  const idat = new Uint8Array(await compressed);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Blob([sig, ...pngChunk('IHDR', ihdr), ...pngChunk('IDAT', idat), ...pngChunk('IEND', new Uint8Array(0))], { type: 'image/png' });
}

async function encodeJPEG(rgba, W, H) {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  const ROWS = 512;
  for (let y0 = 0; y0 < H; y0 += ROWS) {
    const n = Math.min(ROWS, H - y0);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, y0 * W * 4, n * W * 4), W, n), 0, y0);
  }
  return new Promise(r => cv.toBlob(r, 'image/jpeg', 0.95));
}

let job = null;
const FORMAT_NAMES = { png: 'PNG', jpg: 'JPEG', mp4: 'MP4' };

function busy(title, frac, meta) {
  $('busy').classList.add('on');
  $('busy-title').textContent = title;
  $('busy-fill').style.width = (frac * 100).toFixed(1) + '%';
  $('busy-meta').textContent = meta;
}

// Square tiles holding the same number of samples per draw whatever the sample count (a phone's GPU
// work must stay short), in steps of 32 pixels.
function tileSize(samples) {
  return clamp(Math.round(Math.sqrt((PHONE ? 1 << 16 : 1 << 18) / samples) / 32) * 32, 32, 512);
}

async function renderTiles(W, H, opts, onTile) {
  const T = tileSize(opts.samples || 1), values = sceneValues(), tile = target(T, T);
  const px = new Uint8Array(T * T * 4), out = opts.into || new Uint8Array(W * H * 4);
  const total = Math.ceil(W / T) * Math.ceil(H / T);
  let done = 0, t0 = performance.now();
  for (let ty = 0; ty < H && !job.cancel; ty += T) {
    for (let tx = 0; tx < W && !job.cancel; tx += T) {
      const tw = Math.min(T, W - tx), th = Math.min(T, H - ty);
      drawSky(tile.fbo, tw, th, [tx * opts.step, ty * opts.step], opts.step, values, opts);
      gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let r = 0; r < th; r++) out.set(px.subarray(r * tw * 4, (r + 1) * tw * 4), ((ty + th - 1 - r) * W + tx) * 4);
      done++;
      if (performance.now() - t0 > 32) {
        onTile(done / total);
        await nextFrame();
        t0 = performance.now();
      }
    }
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  tile.free();
  return out;
}

function runExport() {
  if (job) return;
  setPlaying(false);
  job = { cancel: false, error: null };
  (C.format === 'mp4' ? recordVideo : saveStill)().catch(e => toast(e.message)).finally(() => {
    job = null;
    $('busy').classList.remove('on');
    invalidate();
    syncUI();
  });
}

async function saveStill() {
  const [W, H] = captureDims(), label = `${W} × ${H}`, format = C.format;
  busy(`Rendering ${label}`, 0, 'Preparing');
  await nextFrame();
  const rgba = await renderTiles(W, H, { step: 1, samples: C.samples, quality: C.samples > 4 ? 1.5 : 1.2 },
    f => busy(`Rendering ${label}`, f * 0.7, `${Math.round(f * 100)}% rendered`));
  if (job.cancel) return;
  busy(`Encoding ${FORMAT_NAMES[format]}`, 0.7, label);
  await nextFrame();
  const blob = format === 'png'
    ? await encodePNG(rgba, W, H, f => busy('Encoding PNG', 0.7 + f * 0.3, label))
    : await encodeJPEG(rgba, W, H);
  if (job.cancel) return;
  if (!blob) throw new Error(`This browser can't encode a ${label} JPEG. Use PNG instead.`);
  presentCapture(blob, W, H, format);
}

// ─── Video ──────────────────────────────────────────────────────────────────

const AVC_LEVELS = [[0x28, 8192, 245760], [0x2a, 8704, 522240], [0x32, 22080, 589824], [0x33, 36864, 983040], [0x34, 36864, 2073600]];

async function videoConfig(W, H, fps) {
  const mbs = Math.ceil(W / 16) * Math.ceil(H / 16);
  for (const [level, fs, mbps] of AVC_LEVELS) {
    if (mbs > fs || mbs * fps > mbps) continue;
    const config = {
      codec: 'avc1.6400' + level.toString(16), width: W, height: H, framerate: fps,
      bitrate: Math.round(W * H * fps * 0.2), avc: { format: 'avc' },
    };
    if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
  }
  return null;
}

// Video frames: the capture size fitted within 3840 px, in even dimensions.
function videoDims() {
  const [W, H] = captureDims(), k = Math.min(1, 3840 / Math.max(W, H));
  return [Math.round(W * k / 2) * 2, Math.round(H * k / 2) * 2];
}

async function recordVideo() {
  if (!('VideoEncoder' in window)) throw new Error('Video capture needs WebCodecs: use Chrome, Edge, or Safari 17 or newer.');
  const [W0] = captureDims(), [W, H] = videoDims();
  const fps = C.fps, frames = Math.round(C.seconds * fps), label = `${W} × ${H} · ${fps} fps`;
  const config = await videoConfig(W, H, fps);
  if (!config) throw new Error(`This browser can't encode ${W} × ${H} video at ${fps} fps. Try a smaller size or frame rate.`);
  const samples = [];
  let avcC = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const desc = meta?.decoderConfig?.description;
      if (desc) avcC = ArrayBuffer.isView(desc) ? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength).slice() : new Uint8Array(desc).slice();
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, key: chunk.type === 'key', pts: chunk.timestamp });
    },
    error: e => { job.error = e; },
  });
  encoder.configure(config);
  const savedP = JSON.stringify(P), savedAnim = JSON.stringify(ANIM);
  try {
    ANIM.playing = true;
    const step = W0 / W, rgba = new Uint8Array(W * H * 4);
    for (let f = 0; f < frames && !job.cancel && !job.error; f++) {
      if (f > 0) advance(1 / fps);
      await renderTiles(W, H, { step, samples: 1, quality: 1, into: rgba },
        t => busy(`Recording ${label}`, (f + t) / frames * 0.97, `Frame ${f + 1} of ${frames}`));
      if (job.cancel || job.error) break;
      const frame = new VideoFrame(rgba, { format: 'RGBA', codedWidth: W, codedHeight: H, timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: f % (fps * 2) === 0 });
      frame.close();
      busy(`Recording ${label}`, (f + 1) / frames * 0.97, `Frame ${f + 1} of ${frames}`);
      while (encoder.encodeQueueSize > 2) await nextFrame();
    }
    if (!job.cancel && !job.error) await encoder.flush();
  } finally {
    Object.assign(P, JSON.parse(savedP));
    Object.assign(ANIM, JSON.parse(savedAnim));
    if (encoder.state !== 'closed') encoder.close();
  }
  if (job.error) throw new Error('The video encoder stopped: ' + job.error.message);
  if (job.cancel || !samples.length) return;
  presentCapture(muxMP4(samples, avcC, W, H, fps), W, H, 'mp4');
}

function muxMP4(samples, avcC, W, H, fps) {
  const u32 = v => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v); return b; };
  const i32 = v => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v); return b; };
  const u16 = v => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v); return b; };
  const str = s => new Uint8Array([...s].map(c => c.charCodeAt(0)));
  const zeros = n => new Uint8Array(n);
  const box = (type, ...parts) => {
    const size = 8 + parts.reduce((n, p) => n + p.length, 0), out = new Uint8Array(size);
    out.set(u32(size), 0);
    out.set(str(type), 4);
    let o = 8;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const full = (type, version, flags, ...parts) => box(type, new Uint8Array([version, flags >> 16 & 255, flags >> 8 & 255, flags & 255]), ...parts);
  const matrix = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000].map(u32);
  const timescale = fps * 1000, delta = 1000, n = samples.length, duration = n * delta;
  const offsets = samples.map((s, i) => Math.round(s.pts * fps / 1e6) * delta - i * delta);
  const shift = Math.max(0, -Math.min(...offsets));
  const ftyp = box('ftyp', str('isom'), u32(512), str('isom'), str('iso2'), str('avc1'), str('mp41'));
  const mdatSize = 8 + samples.reduce((t, s) => t + s.data.length, 0);
  const keys = samples.flatMap((s, i) => s.key ? [u32(i + 1)] : []);
  const stbl = box('stbl',
    full('stsd', 0, 0, u32(1), box('avc1', zeros(6), u16(1), zeros(16), u16(W), u16(H), u32(0x480000), u32(0x480000), u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff), box('avcC', avcC))),
    full('stts', 0, 0, u32(1), u32(n), u32(delta)),
    ...(offsets.some(o => o + shift) ? [full('ctts', 0, 0, u32(n), ...offsets.flatMap(o => [u32(1), i32(o + shift)]))] : []),
    full('stss', 0, 0, u32(keys.length), ...keys),
    full('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1)),
    full('stsz', 0, 0, u32(0), u32(n), ...samples.map(s => u32(s.data.length))),
    full('stco', 0, 0, u32(1), u32(ftyp.length + 8)));
  const moov = box('moov',
    full('mvhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u32(0x10000), u16(0x100), zeros(10), ...matrix, zeros(24), u32(2)),
    box('trak',
      full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(duration), zeros(8), u16(0), u16(0), u16(0), u16(0), ...matrix, u32(W * 65536), u32(H * 65536)),
      box('mdia',
        full('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0)),
        full('hdlr', 0, 0, u32(0), str('vide'), zeros(12), str('Horizon\0')),
        box('minf', full('vmhd', 0, 1, zeros(8)), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), stbl))));
  return new Blob([ftyp, u32(mdatSize), str('mdat'), ...samples.map(s => s.data), moov], { type: 'video/mp4' });
}

// ─── Save Sheet ─────────────────────────────────────────────────────────────

let sheetURL = null;
const framed = window.self !== window.top;

function presentCapture(blob, W, H, format) {
  if (sheetURL) URL.revokeObjectURL(sheetURL);
  sheetURL = URL.createObjectURL(blob);
  const video = format === 'mp4';
  const name = `horizon-${W}x${H}.${format}`;
  const img = $('sheet-img'), vid = $('sheet-video');
  img.hidden = video;
  vid.hidden = !video;
  if (video) { vid.src = sheetURL; vid.play().catch(() => {}); } else { img.src = sheetURL; }
  $('sheet-meta').textContent = `${name} · ${(blob.size / 1048576).toFixed(1)} MB` +
    (framed ? ` · Right-click the ${video ? 'video' : 'image'} and choose Save ${video ? 'Video' : 'Image'} As, or long-press it on iPhone.` : '');
  const save = $('sheet-save');
  save.hidden = framed;
  save.onclick = () => {
    const a = document.createElement('a');
    a.href = sheetURL;
    a.download = name;
    a.click();
  };
  $('sheet').classList.add('on');
  if (!framed) save.onclick();
}

function closeSheet() {
  $('sheet').classList.remove('on');
  $('sheet-video').pause();
}

$('sheet-close').onclick = closeSheet;
$('busy-cancel').onclick = () => { if (job) job.cancel = true; };
