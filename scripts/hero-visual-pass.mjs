/** Repeatable production screenshots and independent render-frame measurements. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const stage = process.argv.includes("--after") ? "after" : "before";
const base = process.env.GAME_URL || "http://127.0.0.1:5180";
const root = "output/playwright/hero-visual-pass";
const directory = `${root}/${stage}`;
await mkdir(directory, { recursive: true });
let fixtures =
  stage === "after"
    ? JSON.parse(
        await readFile(`${root}/fixtures.json`, "utf8").catch((error) => {
          if (error.code !== "ENOENT") throw error;
          return readFile("docs/hero-visual-fixtures.json", "utf8");
        }),
      )
    : { views: {}, cars: {} };
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
page.setDefaultTimeout(60000);
const report = {
  stage,
  date: new Date().toISOString(),
  browser: await browser.version(),
  methodology:
    "Actual production rendering in system Edge. Exact inspection-camera vectors and parked car positions are saved by --before and reused by --after. High captures are 1920×1080 at device scale 1; Medium is 1280×720. Unchanged Home spawn/brake hold preserves the parked car transforms. Lighting/exposure uses each production build's authored settings, with no test-only color grading. Pausing fixes car/character poses; wind/cloud wall-clock phase is not frozen. Chris and Ed are extra after-only views with no baseline comparison. RAF timings are independent wall-clock samples during ten seconds of normal animated driving and are local browser measurements, not a physical-hardware or universal performance claim.",
  shots: [],
  presets: [],
  errors: [],
  warnings: [],
  checks: [],
};
page.on("pageerror", (error) => report.errors.push(error.message));
page.on("console", (message) => {
  if (
    message.type() === "error" ||
    /GL_INVALID_|WebGL: too many errors|Shader Error/.test(message.text())
  )
    report.errors.push(message.text());
  else if (message.type() === "warning") report.warnings.push(message.text());
});
page.on("response", (response) => {
  if (response.status() >= 400)
    report.errors.push(`HTTP ${response.status()} ${response.url()}`);
});
const frames = (count = 8) =>
  page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
  }, count);
const state = () => page.evaluate(() => window.__game.getState());
const checkGL = async (label) => {
  const error = await page.evaluate(() =>
    document.querySelector("#game").getContext("webgl2").getError(),
  );
  assert.equal(error, 0, `${label}: WebGL error`);
};
const hideInterface = () =>
  page.evaluate(() => {
    for (const id of ["menu", "hud", "toast"])
      document.getElementById(id).style.visibility = "hidden";
  });
const capture = async (name, fixtureName = name) => {
  const fixture = fixtures.views[fixtureName];
  assert(fixture, `Missing deterministic camera fixture ${fixtureName}`);
  await page.evaluate(({ position, target }) => {
    window.__game.pause();
    window.__game.inspectView(position, target);
  }, fixture);
  await hideInterface();
  await frames(14);
  await checkGL(name);
  const s = await state();
  const path = `${directory}/${name}.png`;
  await page.screenshot({ path });
  report.shots.push({
    name,
    path,
    camera: s.camera,
    quality: s.metrics.quality,
    viewport: [s.metrics.width, s.metrics.height],
    metrics: s.metrics,
    member: s.club.member,
    finish: s.club.finish,
    position: s.position,
    rotation: s.rotation,
  });
  console.log(`Captured ${stage}: ${name}`);
};
const selectMember = async (id) => {
  await page.evaluate(() => {
    window.__game.clearInspectionView();
    window.__game.pause();
    for (const id of ["menu", "hud", "toast"])
      document.getElementById(id).style.visibility = "";
  });
  await page.getByRole("button", { name: /The Lug Nuts/ }).click();
  await page.locator(`.garage-member[data-member="${id}"]`).click();
  await page.locator(".garage-drive").click();
  await page.waitForFunction((id) => {
    const s = window.__game.getState();
    return s.club.member === id && s.screen === null && !s.club.busy;
  }, id);
  await page.waitForFunction(() => window.__game.getState().grounded >= 3);
  await frames(20);
  await page.evaluate(() => window.__game.pause());
  const s = await state();
  const [x, y, z, w] = s.rotation;
  const heading = Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
  if (stage === "after" && fixtures.cars[id]) {
    const parked = fixtures.cars[id];
    assert(
      Math.hypot(...s.position.map((value, i) => value - parked.position[i])) <
        0.002,
      `${id}: unchanged Home spawn must match the saved parked position`,
    );
    assert(
      Math.abs(
        Math.atan2(
          Math.sin(heading - parked.heading),
          Math.cos(heading - parked.heading),
        ),
      ) < 0.0001,
      `${id}: unchanged Home brake hold must match the saved parked heading`,
    );
  }
  if (stage === "after") {
    assert.equal(
      s.club.finish?.localReflectionReady,
      true,
      `${id}: Home local reflection probe must be active`,
    );
    for (const surface of ["paint", "chrome", "glass", "rubber"])
      assert(
        s.club.finish?.surfaces[surface] > 0,
        `${id}: expected ${surface} surfaces must receive the finish pass`,
      );
  }
  if (stage === "before" || !fixtures.views[`${id}-front-three-quarter`]) {
    fixtures.cars[id] = { position: s.position, heading };
    const local = (side, height, front) => [
      s.position[0] + Math.cos(heading) * side + Math.sin(heading) * front,
      s.position[1] + height,
      s.position[2] - Math.sin(heading) * side + Math.cos(heading) * front,
    ];
    fixtures.views[`${id}-front-three-quarter`] = {
      position: local(4.2, 2.1, 5.8),
      target: local(0, 0.5, 0),
    };
  }
};

try {
  await page.goto(`${base}/?test&revision=hero-visual-pass-${stage}`);
  await page.waitForFunction(() => window.__game?.getState().ready);
  report.bundle = await page
    .locator('script[type="module"]')
    .getAttribute("src");
  report.gpu = await page.evaluate(() => {
    const gl = document.querySelector("#game").getContext("webgl2");
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    return gl.getParameter(
      extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER,
    );
  });
  await page.evaluate(() => {
    window.__game.quality("high");
    window.__game.startFree();
  });
  await page.waitForFunction(() => window.__game.getState().grounded >= 3);
  await frames(20);
  report.home = await page.evaluate(() => window.__game.homeDetails());
  if (stage === "before") {
    for (const [name, position, target, eyeHeight, targetHeight] of [
      ["home-street-eye", [-31.3, -4.89], [1.97, 2.13], 1.7, 2.6],
      ["home-front-close", [-18.58, -2.21], [1.97, 2.13], 2.3, 2.6],
      ["home-side-deck", [-5, 24], [1, 10], 3.5, 2.3],
    ]) {
      fixtures.views[name] = await page.evaluate(
        ({ position, target, eyeHeight, targetHeight }) => {
          const g = window.__game;
          return {
            position: [
              position[0],
              g.surfaceAt(...position) + eyeHeight,
              position[1],
            ],
            target: [
              target[0],
              g.surfaceAt(...target) + targetHeight,
              target[1],
            ],
          };
        },
        { position, target, eyeHeight, targetHeight },
      );
    }
  }
  await capture("home-street-eye");
  await capture("home-front-close");
  await capture("home-side-deck");
  if (stage === "after") {
    Object.assign(
      fixtures.views,
      await page.evaluate(() => {
        const g = window.__game;
        const { frame, house, yard } = g.homeDetails();
        const [doorX, , doorZ] = house.frontDoorCenter;
        const entryX = doorX - frame.back[0] * 3.8 + frame.right[0] * 0.7;
        const entryZ = doorZ - frame.back[1] * 3.8 + frame.right[1] * 0.7;
        const [cornerX, cornerZ] = yard.deck.points[1];
        const deckX = cornerX + frame.right[0] * 1.8 - frame.back[0] * 2.2;
        const deckZ = cornerZ + frame.right[1] * 1.8 - frame.back[1] * 2.2;
        return {
          "home-entry-material-detail": {
            position: [entryX, g.surfaceAt(entryX, entryZ) + 1.68, entryZ],
            target: [doorX, frame.entryFloorY + 1.7, doorZ],
          },
          "home-deck-material-detail": {
            position: [deckX, g.surfaceAt(deckX, deckZ) + 1.68, deckZ],
            target: [cornerX, yard.deck.y + 0.65, cornerZ],
          },
        };
      }),
    );
    await capture("home-entry-material-detail");
    await capture("home-deck-material-detail");
  }
  for (const id of stage === "before"
    ? ["joe", "craig", "lou"]
    : ["joe", "craig", "lou", "chris", "ed"]) {
    await selectMember(id);
    await capture(`${id}-front-three-quarter`);
  }
  report.checks.push(
    "High-quality facade, close facade, deck, Joe, Craig and Lou captured from saved world-space camera fixtures",
  );
  if (stage === "after")
    report.checks.push(
      "All five members have active Home reflections and matched paint, chrome, glass and rubber finishes; Chris and Ed also have after-only captures",
    );

  await selectMember("joe");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => window.__game.quality("medium"));
  await capture("home-front-close-medium", "home-front-close");
  await capture("joe-front-three-quarter-medium", "joe-front-three-quarter");
  report.checks.push(
    "Resize to 1280×720 and Medium-quality rendering retain valid shaders and the same camera framing",
  );
  for (const quality of ["low", "high", "medium"]) {
    await page.evaluate((quality) => window.__game.quality(quality), quality);
    await frames(10);
    await checkGL(`${quality} quality transition`);
    const s = await state();
    report.presets.push({
      quality,
      width: s.metrics.width,
      height: s.metrics.height,
      draws: s.metrics.draws,
      triangles: s.metrics.triangles,
    });
  }
  report.checks.push(
    "Low/High/Medium quality transitions produce no shader or WebGL errors",
  );

  for (const quality of stage === "after" ? ["medium", "high"] : ["medium"]) {
    if (quality === "high") {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.evaluate(() => window.__game.quality("high"));
    }
    await page.evaluate(() => {
      window.__game.clearInspectionView();
      for (const id of ["menu", "hud", "toast"])
        document.getElementById(id).style.visibility = "";
      window.__game.beginNeighborhoodDrive();
    });
    await frames(30);
    const measured = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const intervals = [];
          const beginning = window.__game.getState();
          let first = 0,
            previous = 0;
          function sample(now) {
            if (!first) first = now;
            if (previous) intervals.push(now - previous);
            previous = now;
            if (now - first < 10000) return requestAnimationFrame(sample);
            const sorted = [...intervals].sort((a, b) => a - b);
            const end = window.__game.getState();
            resolve({
              durationMs: now - first,
              frames: intervals.length,
              medianFrameMs: sorted[Math.floor(sorted.length * 0.5)],
              p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
              meanFrameMs:
                intervals.reduce((a, b) => a + b, 0) / intervals.length,
              maximumFrameMs: sorted.at(-1),
              startPosition: beginning.position,
              endPosition: end.position,
              quality: end.metrics.quality,
              viewport: [end.metrics.width, end.metrics.height],
              endMetrics: end.metrics,
            });
          }
          requestAnimationFrame(sample);
        }),
    );
    assert(
      Math.hypot(
        measured.endPosition[0] - measured.startPosition[0],
        measured.endPosition[2] - measured.startPosition[2],
      ) > 2,
      "Frame sampling must include actual moving gameplay",
    );
    await page.evaluate(() => window.__game.endBenchmark());
    await checkGL(`${quality} moving gameplay benchmark`);
    measured.comparison =
      quality === "high"
        ? "Standalone final High 1920×1080 sample; no baseline High moving sample exists"
        : "Medium 1280×720 sample using the baseline route and measurement method";
    report[quality === "high" ? "performanceHigh" : "performance"] = measured;
    report.checks.push(
      `Measured independent RAF intervals during ten seconds of actual moving neighborhood gameplay at ${quality} quality`,
    );
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack ?? String(error);
  throw error;
} finally {
  if (stage === "before")
    await writeFile(
      `${root}/fixtures.json`,
      JSON.stringify(fixtures, null, 2) + "\n",
    );
  await writeFile(
    `${directory}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}
console.log(
  JSON.stringify(
    {
      stage,
      bundle: report.bundle,
      passed: report.passed,
      performance: report.performance,
      performanceHigh: report.performanceHigh,
      errors: report.errors,
      report: `${directory}/report.json`,
    },
    null,
    2,
  ),
);
