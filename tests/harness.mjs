// Shared by the test scripts: Chromium on SwiftShader through Playwright, a static server for the
// repository, and a small check runner that prints a PASS/FAIL line per check and a summary.
//
// Playwright comes from /opt/node-tools/node_modules and Chromium from /opt/pw-browsers/chromium
// (override with PLAYWRIGHT_MODULES / CHROMIUM); nothing is installed.

import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(process.env.PLAYWRIGHT_MODULES || '/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROMIUM = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-proxy-server'];

export function launch() {
  return chromium.launch({ executablePath: CHROMIUM, headless: true, args: ARGS });
}

// The app's URL: the one given, or the repository's index.html served from a local port. `close`
// stops the server, if one was started.
export async function serveApp(url) {
  if (url) return { url, close() {} };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.statusCode = rel === 'favicon.ico' ? 204 : 404;
      return res.end();
    }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(file)];
    if (type) res.setHeader('content-type', type);
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/index.html`, close: () => server.close() };
}

// ─── Check runner ───────────────────────────────────────────────────────────

const t0 = Date.now();
const results = [];

export async function check(name, fn) {
  const t = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)${note ? '\n      ' + note : ''}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)\n      ${String(e && e.message || e).split('\n').join('\n      ')}`);
  }
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// An error outside any check (the browser or server failing) counts as a failed check.
export function harnessFailed(e) {
  results.push({ name: 'harness', ok: false });
  console.log(`FAIL  harness\n      ${e && e.stack || e}`);
}

// Prints the summary line (with `note` appended) and exits non-zero when any check failed.
export function finish(note = '') {
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(0)}s${note}`);
  process.exit(failed.length ? 1 : 0);
}
