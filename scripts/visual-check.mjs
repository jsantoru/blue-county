/** Production-browser scenery validation and independent RAF measurements. */
import { chromium } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const url = process.env.GAME_URL || "http://127.0.0.1:5180";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
const errors = [],
  warnings = [],
  failures = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
  if (m.type() === "warning") warnings.push(m.text());
  if (/GL_INVALID_|WebGL: too many errors|Shader Error/.test(m.text()))
    errors.push(m.text());
});
page.on("response", (r) => {
  if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
});
const report = {
  date: new Date().toISOString(),
  browser: await browser.version(),
  viewport: [1920, 1080],
  measurement:
    "Independent requestAnimationFrame timestamps after warmup; actual rendered production build, 3 rivals and 3 civilian cars. No physical controller used.",
  locations: [],
  presets: [],
  errors,
  warnings,
  failures,
};
await mkdir("docs", { recursive: true });
try {
  await page.goto(`${url}/?test&visual-check`);
  await page.waitForFunction(() => window.__game?.getState().ready, null, {
    timeout: 60_000,
  });
  report.gpu = await page.evaluate(() => {
    const gl = document.querySelector("#game").getContext("webgl2");
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext
      ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
  });
  await page.evaluate(() => {
    window.__game.quality("high");
    window.__game.startFree();
  });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: "docs/neighborhood-home.png" });
  report.locations.push({
    name: "Home / Beverly Drive",
    state: await page.evaluate(() => window.__game.getState()),
  });
  await page.evaluate(() => {
    window.__game.pause();
    document.querySelector("#menu").style.visibility = "hidden";
    document.querySelector("#hud").style.visibility = "hidden";
    document.querySelector("#toast").style.visibility = "hidden";
    window.__game.inspectView([-25, 7, -28], [0, 3, 0]);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "docs/neighborhood-detail.png" });
  await page.evaluate(() => {
    window.__game.clearInspectionView();
    for (const id of ["menu", "hud", "toast"])
      document.getElementById(id).style.visibility = "";
    window.__game.resume();
  });
  for (const index of [60, 130, 210]) {
    await page.evaluate((i) => {
      const points = window.__game.route(),
        a = points[i],
        b = points[i + 1];
      window.__game.teleport(
        [a[0], a[1] + 0.85, a[2]],
        Math.atan2(b[0] - a[0], b[2] - a[2]),
      );
    }, index);
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => window.__game.getState());
    assert(
      state.grounded >= 2,
      `Vehicle lost the drivable surface at route ${index}`,
    );
    assert(
      state.metrics.draws < 1600,
      `Excessive visible draws at route ${index}`,
    );
    assert(
      state.metrics.triangles < 9_000_000,
      `Excessive visible geometry at route ${index}`,
    );
    report.locations.push({ name: `Route point ${index}`, state });
    if (index === 60)
      await page.screenshot({ path: "docs/neighborhood-ridge.png" });
  }
  for (const preset of ["high", "medium", "low"]) {
    await page.evaluate((q) => {
      window.__game.quality(q);
      window.__game.beginBenchmark();
    }, preset);
    await page.waitForTimeout(3500);
    await page.waitForFunction(
      () => {
        const state = window.__game.getState();
        return state.countdown <= 0 && state.speed > 10;
      },
      null,
      { timeout: 30000 },
    );
    const glError = await page.evaluate(() =>
      document.querySelector("#game").getContext("webgl2").getError(),
    );
    assert.equal(
      glError,
      0,
      `${preset} has a WebGL error after the quality transition`,
    );
    await page.screenshot({ path: `docs/graphics-${preset}.png` });
    const sample = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const samples = [];
          let start = 0,
            previous = 0;
          function tick(time) {
            if (!start) start = time;
            if (previous) samples.push(time - previous);
            previous = time;
            if (time - start < 12000) requestAnimationFrame(tick);
            else {
              const sorted = [...samples].sort((a, b) => a - b);
              const percentile = (p) =>
                sorted[Math.floor((sorted.length - 1) * p)];
              resolve({
                durationSeconds: (time - start) / 1000,
                samples: samples.length,
                p50Ms: percentile(0.5),
                p95Ms: percentile(0.95),
                p99Ms: percentile(0.99),
                maxMs: sorted.at(-1),
                meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
                state: window.__game.endBenchmark(),
              });
            }
          }
          requestAnimationFrame(tick);
        }),
    );
    assert(sample.state.metrics.quality === preset);
    report.presets.push({ preset, ...sample });
    console.log(
      `${preset}: RAF p50=${sample.p50Ms.toFixed(2)} p95=${sample.p95Ms.toFixed(2)}ms, ${sample.state.metrics.draws} draws, ${sample.state.metrics.triangles} triangles`,
    );
  }
  await page.evaluate(() => {
    window.__game.quality("high");
    window.__game.startFree();
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);
  const resized = await page.evaluate(() => window.__game.getState().metrics);
  assert.equal(resized.width, 1280);
  assert.equal(resized.height, 720);
  const finalGlError = await page.evaluate(() =>
    document.querySelector("#game").getContext("webgl2").getError(),
  );
  assert.equal(
    finalGlError,
    0,
    "Low → High and resize must render without WebGL errors",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(failures.length, 0, failures.join("\n"));
  report.passed = true;
} finally {
  report.warnings = [...new Set(warnings)];
  await writeFile(
    "docs/visual-verification.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
