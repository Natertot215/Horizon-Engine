# Render tests

Headless Chromium + SwiftShader checks for the invariants the iPhone 8×4-block bug breaks: no shader/page errors; no NaN/Inf and exactly one write per pixel per pass in the RGBA16F accumulation buffer; no 8×4/4×8-aligned outlier cells in thumbnails or main renders (detector self-checked on corrupted copies); bit-identical repeat renders; thumbnails matching the main view; phone-budget banding identical to an unbanded render.

    node tests/render.test.mjs           # serves ../index.html itself, about 3-4 minutes
    node tests/render.test.mjs <url>     # test another copy instead
    node tests/render.test.mjs --full    # 12-pass check on every preset (slower)

Uses Playwright from /opt/node-tools/node_modules and Chromium at /opt/pw-browsers/chromium (override with PLAYWRIGHT_MODULES / CHROMIUM); no npm install. Exits non-zero on failure.
SwiftShader cannot reproduce Apple GPU faults: a pass shows the app's own logic is sound and guards against regressions, not that iOS is fixed. The cell detector lives in block-detector.mjs.
