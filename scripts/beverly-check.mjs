import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const url = process.env.GAME_URL || "http://127.0.0.1:5180";
const detailPass = process.argv.includes("--detail-pass");
const artifactPrefix = detailPass ? "beverly-detail" : "beverly";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
const report = {
  date: new Date().toISOString(),
  browser: await browser.version(),
  viewport: [1920, 1080],
  errors: [],
  warnings: [],
  tour: [],
  screenshots: [],
  measurement:
    "Scripted Gamepad-independent driver using actual fixed-step vehicle physics. Scenery inspection cameras are separate from the driving test. No physical controller evidence.",
};
page.on("pageerror", (e) => report.errors.push(e.message));
page.on("console", (m) => {
  if (
    m.type() === "error" ||
    /GL_INVALID_|WebGL: too many errors|Shader Error/.test(m.text())
  )
    report.errors.push(m.text());
  else if (m.type() === "warning") report.warnings.push(m.text());
});
page.on("response", (r) => {
  if (r.status() >= 400) report.errors.push(`HTTP${r.status()} ${r.url()}`);
});
async function sampleFrames(durationMs = 12000) {
  return page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const intervals = [];
        let start = 0,
          last = 0;
        const tick = (time) => {
          if (!start) start = time;
          if (last) intervals.push(time - last);
          last = time;
          if (time - start < duration) requestAnimationFrame(tick);
          else {
            const s = [...intervals].sort((a, b) => a - b),
              p = (n) => s[Math.floor((s.length - 1) * n)];
            resolve({
              seconds: (time - start) / 1000,
              intervals: s.length,
              medianMs: p(0.5),
              p95Ms: p(0.95),
              p99Ms: p(0.99),
              maxMs: s.at(-1),
              meanMs: s.reduce((a, b) => a + b, 0) / s.length,
              metrics: window.__game?.getState().metrics ?? null,
            });
          }
        };
        requestAnimationFrame(tick);
      }),
    durationMs,
  );
}
// Each moving sample starts independently at Home, with the same driver and duration.
async function sampleMovingDrive() {
  await page.evaluate(() => window.__game.beginNeighborhoodDrive());
  await page.waitForFunction(() => window.__game.getState().speed > 8);
  const timing = await sampleFrames();
  await page.evaluate(() => window.__game.endBenchmark());
  return timing;
}
async function checkRenderedState(label) {
  // Wait for several completed renders so newly sized targets and rebuilt scenery are used.
  const result = await page.evaluate(async () => {
    for (let n = 0; n < 4; n++) await new Promise(requestAnimationFrame);
    const gl = document.querySelector("#game").getContext("webgl2");
    return { state: window.__game.getState(), glError: gl.getError() };
  });
  assert.equal(result.glError, 0, `${label}: unexpected WebGL error`);
  return { label, ...result };
}
try {
  if (detailPass) {
    await page.goto("about:blank");
    report.blankPageCadence = {
      description:
        "Same browser and viewport, no game, measured immediately before load. Compositor cadence only, not a GPU headroom measurement.",
      ...(await sampleFrames(3000)),
    };
  }
  await page.goto(`${url}/?test&beverly-qa`);
  await page.waitForFunction(() => window.__game?.getState().ready, null, {
    timeout: 60000,
  });
  report.gpu = await page.evaluate(() => {
    const gl = document.querySelector("#game").getContext("webgl2"),
      ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext
      ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
  });
  report.homeSpawn = await page.evaluate(() => {
    window.__game.quality("high");
    window.__game.startFree();
    return window.__game.getState().position;
  });
  await page.waitForTimeout(3200);
  await page.screenshot({ path: `docs/${artifactPrefix}-home.png` });
  report.home = await page.evaluate(() => window.__game.getState());
  assert.equal(report.home.grounded, 4);
  report.survey = await page.evaluate(() => {
    const s = window.__game.neighborhoodSurvey();
    return {
      loopMeters: s.loop.lengthMeters,
      footprints: s.buildingObservations.length,
      driveways: s.driveways.length,
      canopies: s.canopies.length,
      photoFacades: s.buildingObservations.filter((b) => b.photographedFacade)
        .length,
    };
  });
  // Continuous rendered driving: independent RAF intervals after the car accelerates.
  report.frameTiming = await sampleMovingDrive();
  if (detailPass) {
    report.detailPass = true;
    report.presets = [{ preset: "high", ...report.frameTiming }];
    report.screenshots.push(`docs/${artifactPrefix}-home.png`);
  }
  // Restart at Home and finish one complete connected loop without teleporting.
  await page.evaluate(() => window.__game.beginNeighborhoodDrive());
  let finished = false;
  for (let i = 0; i < 24 && !finished; i++) {
    const step = await page.evaluate(() =>
      window.__game.advanceNeighborhoodDrive(12),
    );
    assert.equal(step.airborne, 0, "Unexpected loss of drivable surface");
    report.tour.push({
      target: step.target,
      points: step.points,
      steps: step.steps,
      grounded: step.state.grounded,
      nearMeters: step.state.near,
      position: step.state.position,
    });
    finished = step.finished;
  }
  assert(finished, "Beverly loop did not complete");
  report.loopCompleted = true;
  await page.evaluate(() => window.__game.endBenchmark());
  for (const [name, position, target] of [
    ["home-house", [-31, 10], [2, 2]],
    ["west-35", [-199, -135], [-171, -117]],
    ...(detailPass ? [["west-35-close", [-185, -127], [-171, -117]]] : []),
    ["north-22", [-70, -310], [-79, -347]],
    ["loop-overview", [-90, -40], [-115, -170]],
  ]) {
    await page.evaluate(
      ({ position, target, name }) => {
        const g = window.__game;
        g.pause();
        for (const id of ["menu", "hud", "toast"])
          document.getElementById(id).style.visibility = "hidden";
        g.inspectView(
          [
            position[0],
            g.surfaceAt(...position) + (name === "loop-overview" ? 190 : 3.4),
            position[1],
          ],
          [target[0], g.surfaceAt(...target) + 2, target[1]],
        );
      },
      { position, target, name },
    );
    await page.waitForTimeout(350);
    const path = `docs/${artifactPrefix}-${name}.png`;
    await page.screenshot({ path });
    report.screenshots.push(path);
  }
  // Return to an ordinary playable view and exercise shadow/presentation transitions.
  await page.evaluate(() => {
    window.__game.clearInspectionView();
    for (const id of ["menu", "hud", "toast"])
      document.getElementById(id).style.visibility = "";
    window.__game.startFree();
  });
  if (detailPass) {
    for (const preset of ["medium", "low"]) {
      await page.evaluate((q) => window.__game.quality(q), preset);
      const timing = await sampleMovingDrive();
      assert.equal(timing.metrics.quality, preset);
      report.presets.push({ preset, ...timing });
      await checkRenderedState(`${preset} moving sample`);
    }
    // Exercise both downscaled and full-resolution targets across Low → High.
    report.resize = [];
    await page.setViewportSize({ width: 1280, height: 720 });
    const low = await checkRenderedState("low at 1280 × 720");
    assert.equal(low.state.metrics.quality, "low");
    assert.equal(low.state.metrics.width, 960);
    assert.equal(low.state.metrics.height, 540);
    report.resize.push(low);
    await page.evaluate(() => window.__game.quality("high"));
    await page.setViewportSize({ width: 1920, height: 1080 });
    const high = await checkRenderedState("high at 1920 × 1080");
    assert.equal(high.state.metrics.quality, "high");
    assert.equal(high.state.metrics.width, 1920);
    assert.equal(high.state.metrics.height, 1080);
    report.resize.push(high);

    // Rebuild both environments to expose disposed shared materials/textures.
    report.environmentTransitions = [];
    await page.evaluate(() => window.__game.startTest());
    await page.waitForFunction(() => window.__game.getState().grounded === 4);
    const grounds = await checkRenderedState("handling grounds");
    assert.equal(grounds.state.mode, "test");
    assert.equal(grounds.state.screen, null);
    report.environmentTransitions.push(grounds);
    await page.evaluate(() => window.__game.startFree());
    await page.waitForFunction(() => window.__game.getState().grounded === 4);
    const home = await checkRenderedState("return Home");
    assert.equal(home.state.mode, "neighborhood");
    assert.equal(home.state.screen, null);
    assert(
      home.state.metrics.vegetation,
      "Neighborhood vegetation must rebuild",
    );
    assert(
      home.state.metrics.scenery.length > 0,
      "Neighborhood scenery must rebuild",
    );
    assert(
      Math.hypot(
        home.state.position[0] - report.homeSpawn[0],
        home.state.position[2] - report.homeSpawn[2],
      ) < 1,
      "Return Home must restore the Home spawn",
    );
    report.environmentTransitions.push(home);
  } else {
    for (const q of ["medium", "low", "high"]) {
      await page.evaluate((q) => window.__game.quality(q), q);
      await page.waitForTimeout(400);
      assert.equal(
        await page.evaluate(() =>
          document.querySelector("#game").getContext("webgl2").getError(),
        ),
        0,
      );
    }
  }
  assert.equal(report.errors.length, 0, report.errors.join("\n"));
  report.passed = true;
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        survey: report.survey,
        tourSegments: report.tour.length,
        frameTiming: report.frameTiming,
        ...(detailPass ? { presets: report.presets } : {}),
        errors: report.errors,
      },
      null,
      2,
    ),
  );
} finally {
  report.warnings = [...new Set(report.warnings)];
  await writeFile(
    `docs/${artifactPrefix}-verification.json`,
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
