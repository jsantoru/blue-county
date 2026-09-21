/** Mapped backyard evidence, actual rendered scenery and real-physics smoke check. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const source = JSON.parse(
  await readFile("docs/research-backyard/hydro-observations.json", "utf8"),
);
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
  screenshots: [],
  views: [],
  transitions: [],
  measurement:
    "Canonical USGS centerline compared with runtime data and actual scene metadata. Creek bed samples use the terrain surface shared by renderer and physics. Departure uses fixed-step vehicle physics; moving RAF timing is measured separately. Inspection screenshots require visual review. Channel dimensions and plant placements remain representative, not field measurements.",
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

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    t = Math.max(
      0,
      Math.min(
        1,
        ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1),
      ),
    );
  return {
    distance: Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t),
    t,
  };
}
function inside(p, ring) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result;
  }
  return result;
}
function creekGap(p, stations) {
  let nearest = { distance: Infinity, halfWidth: 0 };
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1],
      b = stations[i],
      hit = segmentDistance(p, a.point, b.point);
    if (hit.distance < nearest.distance)
      nearest = {
        distance: hit.distance,
        halfWidth: (a.width + (b.width - a.width) * hit.t) / 2,
      };
  }
  return nearest.distance - nearest.halfWidth;
}
function assertBackyard(details, map) {
  assert(
    details.data && details.render,
    "Mapped backyard must exist in actual neighborhood scene",
  );
  const data = details.data,
    render = details.render,
    stations = data.stream.stations;
  assert.equal(data.stream.id, "usgs-3dhp-EH86B");
  assert.equal(render.streamName, "Stony Creek");
  assert.deepEqual(
    data.stream.pointsXZ,
    source.stream.pointsXZ,
    "Original USGS centerline must remain unchanged",
  );
  assert(stations.length > 100 && data.stream.renderedLengthMeters > 150);
  assert.equal(render.stations.length, stations.length);
  assert.equal(render.waterTriangles, (stations.length - 1) * 2);
  assert.equal(render.woodlandPolygons, data.woodlands.length);
  assert(
    render.woodlandFloorTriangles > 100 &&
      render.stones > 50 &&
      render.leafFragments > 100,
  );
  for (let i = 0; i < stations.length; i++) {
    if (i)
      assert(
        stations[i].waterY <= stations[i - 1].waterY + 0.000001,
        "Downstream water profile must not climb the coarse DEM's artificial humps",
      );
    assert.deepEqual(
      render.stations[i].point,
      stations[i].point,
      "Rendered water must follow compiled station geometry",
    );
    assert.equal(render.stations[i].waterY, stations[i].waterY);
    const sourceDistance = Math.min(
      ...source.stream.pointsXZ
        .slice(1)
        .map(
          (p, j) =>
            segmentDistance(stations[i].point, source.stream.pointsXZ[j], p)
              .distance,
        ),
    );
    assert(
      sourceDistance < 0.001,
      "Clipping/resampling must not relocate the source stream",
    );
    for (const road of map.roads)
      for (let j = 1; j < road.points.length; j++)
        assert(
          segmentDistance(
            stations[i].point,
            [road.points[j - 1][0], road.points[j - 1][2]],
            [road.points[j][0], road.points[j][2]],
          ).distance >=
            road.width / 2 + 11.99,
          "Scenic channel must end before mapped pavement; no invented road cut",
        );
  }
  assert(render.plants.total > 100 && render.plants.batches <= 6);
  assert.equal(render.plantPositions.length, render.plants.total);
  for (const kind of ["fern", "sedge", "shrub", "sapling"])
    assert(render.plants.counts[kind] > 0, `Understory must include ${kind}`);
  for (const plant of render.plantPositions) {
    assert(
      data.woodlands.some((w) => inside([plant.x, plant.z], w.points)),
      "Undergrowth must remain inside the observed wooded ground",
    );
    assert(
      creekGap([plant.x, plant.z], stations) > 0.54,
      "Terrestrial plants must leave the water surface clear",
    );
  }
  assert(
    details.trees.length > 50,
    "Backyard needs a continuous woodland instead of isolated yard trees",
  );
  for (const [x, z, radius] of details.trees) {
    assert(
      data.woodlands.some((w) => inside([x, z], w.points)),
      "Representative woodland stems must respect the aerial lawn edge",
    );
    assert(
      creekGap([x, z], stations) > radius,
      "Tree trunks must stay out of the stream",
    );
  }
}
async function state(label) {
  const result = await page.evaluate(async () => {
    for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
    const g = window.__game;
    return {
      state: g.getState(),
      details: g.backyardDetails(),
      glError: document.querySelector("#game").getContext("webgl2").getError(),
    };
  });
  assert.equal(result.glError, 0, `${label}: WebGL error`);
  return { label, ...result };
}
async function screenshot(name, position, target, cameraHeight, targetHeight) {
  await page.evaluate(
    ({ position, target, cameraHeight, targetHeight }) => {
      const g = window.__game;
      g.pause();
      for (const id of ["menu", "hud", "toast"])
        document.getElementById(id).style.visibility = "hidden";
      g.inspectView(
        [position[0], g.surfaceAt(...position) + cameraHeight, position[1]],
        [target[0], g.surfaceAt(...target) + targetHeight, target[1]],
      );
    },
    { position, target, cameraHeight, targetHeight },
  );
  await page.waitForTimeout(450);
  const snapshot = await state(name);
  report.views.push({
    label: name,
    camera: snapshot.state.camera,
    metrics: snapshot.state.metrics,
  });
  const path = `docs/backyard-${name}.png`;
  await page.screenshot({ path });
  report.screenshots.push(path);
}

try {
  await page.goto(`${url}/?test&backyard-qa`);
  await page.waitForFunction(
    () => window.__game?.getState().ready && window.__game.backyardDetails,
    null,
    { timeout: 60000 },
  );
  const map = await page.evaluate(async () =>
    (await fetch("/map/warwick.json")).json(),
  );
  await page.evaluate(() => {
    window.__game.quality("high");
    window.__game.startFree();
  });
  await page.waitForFunction(() => window.__game.getState().grounded === 4);
  const initial = await state("initial backyard");
  assertBackyard(initial.details, map);
  report.initial = initial;
  report.gpu = await page.evaluate(() => {
    const gl = document.querySelector("#game").getContext("webgl2"),
      ext = gl.getExtension("WEBGL_debug_renderer_info");
    return gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  });
  report.bedSamples = await page.evaluate(() => {
    const g = window.__game;
    return g
      .backyardDetails()
      .data.stream.stations.filter((s, i) => s.fade > 0.99 && i % 5 === 0)
      .map((s) => ({
        point: s.point,
        waterY: s.waterY,
        groundY: g.surfaceAt(...s.point),
      }));
  });
  assert(
    report.bedSamples.every((s) => s.waterY > s.groundY + 0.03),
    "Creek water must occupy the carved channel above its bed",
  );
  await screenshot("deck-woods", [18, 6], [65, 0], 3, 1.5);
  await screenshot("lawn-edge", [25, 0], [65, 0], 2, 1.3);
  await screenshot("creek-bank", [79, -6], [82.9576, -23.64], 3, 0.2);
  await screenshot("creek-bend", [40, 36], [57, 22], 2, 0.4);
  await screenshot("overview", [140, -20], [65, -5], 50, 1);

  report.departure = await page.evaluate((map) => {
    const g = window.__game,
      route = g.beginNeighborhoodDrive();
    g.pause();
    const result = {
      checkedSteps: 0,
      airborneSteps: 0,
      reachedRoad: false,
      samples: [],
      routePoints: route.points,
    };
    for (let i = 0; i < 1500; i++) {
      const step = g.advanceNeighborhoodDrive(1 / 60);
      result.checkedSteps++;
      result.airborneSteps += step.airborne;
      if (i % 30 === 0)
        result.samples.push({
          position: step.state.position,
          grounded: step.state.grounded,
          speed: step.state.speed,
          target: step.target,
        });
      if (
        step.target > map.home.departurePath.length &&
        Math.hypot(
          step.state.position[0] - map.home.position[0],
          step.state.position[2] - map.home.position[2],
        ) > 32 &&
        step.state.near < 4.6
      ) {
        result.reachedRoad = true;
        break;
      }
    }
    g.endBenchmark();
    g.clearInspectionView();
    return result;
  }, map);
  assert(
    report.departure.reachedRoad && report.departure.airborneSteps === 0,
    "Backyard terrain must preserve the Home driveway departure",
  );
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
            const sorted = [...intervals].sort((a, b) => a - b),
              p = (n) => sorted[Math.floor((sorted.length - 1) * n)];
            resolve({
              seconds: (time - start) / 1000,
              intervals: sorted.length,
              medianMs: p(0.5),
              p95Ms: p(0.95),
              p99Ms: p(0.99),
              maxMs: sorted.at(-1),
              metrics: window.__game.getState().metrics,
            });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  await page.evaluate(() => {
    window.__game.endBenchmark();
    window.__game.startFree();
  });
  for (const quality of ["low", "medium", "high"]) {
    await page.evaluate((quality) => window.__game.quality(quality), quality);
    const result = await state(`${quality} quality`);
    assertBackyard(result.details, map);
    report.transitions.push({
      label: result.label,
      metrics: result.state.metrics,
      plants: result.details.render.plants.total,
      trees: result.details.trees.length,
    });
  }
  await page.evaluate(() => window.__game.startTest());
  const handling = await state("handling grounds");
  assert.equal(handling.state.mode, "test");
  assert.equal(handling.details.render, null);
  assert.equal(handling.details.trees.length, 0);
  report.transitions.push({
    label: handling.label,
    mode: handling.state.mode,
    render: handling.details.render,
  });
  await page.evaluate(() => window.__game.startFree());
  await page.waitForFunction(() => window.__game.getState().grounded === 4);
  const restored = await state("backyard recreated");
  assertBackyard(restored.details, map);
  assert.deepEqual(
    restored.details,
    initial.details,
    "Deterministic backyard geometry must survive disposal/recreation",
  );
  report.transitions.push({
    label: restored.label,
    metrics: restored.state.metrics,
  });
  assert.equal(report.errors.length, 0, report.errors.join("\n"));
  report.passed = true;
  console.log(
    JSON.stringify(
      {
        passed: true,
        stations: initial.details.render.stations.length,
        plants: initial.details.render.plants,
        trees: initial.details.trees.length,
        departure: {
          checkedSteps: report.departure.checkedSteps,
          airborneSteps: report.departure.airborneSteps,
          reachedRoad: report.departure.reachedRoad,
        },
        frameTiming: report.frameTiming,
        screenshots: report.screenshots,
        errors: report.errors,
      },
      null,
      2,
    ),
  );
} catch (error) {
  report.failure = error.stack ?? String(error);
  throw error;
} finally {
  report.warnings = [...new Set(report.warnings)];
  await writeFile(
    "docs/backyard-verification.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
