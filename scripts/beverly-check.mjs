import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const url = process.env.GAME_URL || "http://127.0.0.1:5180";
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
try {
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
  await page.evaluate(() => {
    window.__game.quality("high");
    window.__game.startFree();
  });
  await page.waitForTimeout(3200);
  await page.screenshot({ path: "docs/beverly-home.png" });
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
  await page.evaluate(() => window.__game.beginNeighborhoodDrive());
  await page.waitForFunction(() => window.__game.getState().speed > 8);
  report.frameTiming = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const intervals = [];
        let start = 0,
          last = 0;
        const tick = (time) => {
          if (!start) start = time;
          if (last) intervals.push(time - last);
          last = time;
          if (time - start < 12000) requestAnimationFrame(tick);
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
              metrics: window.__game.getState().metrics,
            });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  await page.evaluate(() => window.__game.endBenchmark());
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
    const path = `docs/beverly-${name}.png`;
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
  assert.equal(report.errors.length, 0, report.errors.join("\n"));
  report.passed = true;
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        survey: report.survey,
        tourSegments: report.tour.length,
        frameTiming: report.frameTiming,
        errors: report.errors,
      },
      null,
      2,
    ),
  );
} finally {
  report.warnings = [...new Set(report.warnings)];
  await writeFile(
    "docs/beverly-verification.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
