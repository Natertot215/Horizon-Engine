# Render tests

Headless Chromium + SwiftShader checks for the invariants the iPhone 8×4-block bug breaks: no shader/page errors; no NaN/Inf and exactly one write per pixel per pass in the RGBA16F accumulation buffer; no 8×4/4×8-aligned outlier cells in thumbnails or main renders (detector self-checked on corrupted copies); bit-identical repeat renders; thumbnails matching the main view; phone-budget banding identical to an unbanded render. It also checks that the kept view, reprojected after a camera move, lands where a fresh render puts the scene, in all four projections.

    node tests/render.test.mjs           # serves ../index.html itself, about 3-4 minutes
    node tests/render.test.mjs <url>     # test another copy instead
    node tests/render.test.mjs --full    # 12-pass check on every preset (slower)

Uses Playwright from /opt/node-tools/node_modules and Chromium at /opt/pw-browsers/chromium (override with PLAYWRIGHT_MODULES / CHROMIUM); no npm install. Exits non-zero on failure.
SwiftShader cannot reproduce Apple GPU faults: a pass shows the app's own logic is sound and guards against regressions, not that iOS is fixed. The cell detector lives in block-detector.mjs.

# Mobile walkthrough

An emulated iPhone 17 (402×874 CSS px at 3×, touch, iOS user agent) driving the real app: first load, refined view, hidden panel, a one-finger drag, a pinch, landscape with the Dynamic Island's safe areas, capture mode and the Save Look field. Screenshots of every step, plus checks: the canvas and thumbnails at one pixel per screen pixel, no double-tap or focus zoom, the kept view shown while dragging and pinching, controls clear of the safe areas, no errors.

    node tests/mobile-sim.mjs                 # about 6 minutes; screenshots in <tmp>/horizon-mobile-sim
    node tests/mobile-sim.mjs <url> --out dir

Timings under SwiftShader say nothing about an iPhone; what is drawn, where and when is the same.
