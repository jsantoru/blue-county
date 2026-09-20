/** Property evidence and actual-physics QA; no physical-controller claim. */
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
  screenshots: [],
  tour: [],
  transitions: [],
  measurement:
    "Actual fixed-step vehicle physics with the scripted neighborhood driver. Home departure checks the true quaternion-projected chassis against mapped road/driveway pavement and building footprints every physics step. Inspection cameras and RAF timing are separate. No physical controller evidence.",
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
    report.errors.push(`HTTP${response.status()} ${response.url()}`);
});

async function renderedState(label) {
  const result = await page.evaluate(async () => {
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
    return {
      state: window.__game.getState(),
      glError: document.querySelector("#game").getContext("webgl2").getError(),
    };
  });
  assert.equal(result.glError, 0, `${label}: WebGL error`);
  return { label, ...result };
}
async function screenshot(
  name,
  position,
  target,
  cameraHeight = 3.4,
  targetHeight = 1.1,
) {
  if (position) {
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
  }
  await page.waitForTimeout(350);
  const path = `docs/property-${name}.png`;
  await page.screenshot({ path });
  report.screenshots.push(path);
}
const center = (points) => [
  points.reduce((sum, p) => sum + p[0], 0) / points.length,
  points.reduce((sum, p) => sum + p[1], 0) / points.length,
];

try {
  await page.goto(`${url}/?test&property-qa`);
  await page.waitForFunction(() => window.__game?.getState().ready, null, {
    timeout: 60000,
  });
  const map = await page.evaluate(async () => {
    const response = await fetch("/map/warwick.json");
    if (!response.ok) throw new Error(`Map request failed: ${response.status}`);
    return response.json();
  });
  const survey = map.beverlySurvey,
    features = survey?.propertyFeatures ?? [],
    signs = survey?.roadSigns ?? [];
  const surfaces = survey?.drivewaySurfaces ?? [];
  assert(
    surfaces.length > 0 && features.length > 0 && signs.length > 0,
    "Compile the property survey data before running test:property",
  );
  assert(
    map.home.departurePath?.length >= 2,
    "Home must provide a traced departure path",
  );
  const pools = features.filter((f) => f.kind === "pool"),
    decks = features.filter((f) => f.kind === "deck");
  report.survey = {
    drivewayPolygons: surfaces.length,
    decks: decks.length,
    patios: features.filter((f) => f.kind === "patio").length,
    pools: pools.length,
    roadSigns: signs.length,
    departurePoints: map.home.departurePath.length,
  };
  const building28 = map.buildings.find(
    (building) => building.id === "nys-7159159",
  );
  assert.equal(
    building28?.renderParts?.length,
    2,
    "Number 28 must retain its two source-partitioned wings",
  );
  report.courtyard28 = await page.evaluate(() =>
    window.__game
      .referenceFacades()
      .filter((facade) => String(facade.id).startsWith("nys-7159159:")),
  );
  assert.equal(
    report.courtyard28.length,
    2,
    "Both number28 wings must exist in the actual rendered neighborhood",
  );
  assert(
    Math.abs(report.courtyard28[0].roofBase - report.courtyard28[1].roofBase) <
      1e-6,
    "Number28 wings must share a roof base",
  );
  assert.deepEqual(
    report.courtyard28[0].colors,
    report.courtyard28[1].colors,
    "The connected wings must share source facade colors",
  );
  const secondaryPart = building28.renderParts.find(
    (part) => part.entrance === false,
  );
  assert(
    secondaryPart,
    "The source partition must identify the secondary wing",
  );
  const secondaryFacade = report.courtyard28.find(
    (facade) => facade.id === `${building28.id}:${secondaryPart.id}`,
  );
  assert.equal(
    secondaryFacade?.entryAccess,
    null,
    "Secondary wing must not invent a second entrance",
  );
  report.gpu = await page.evaluate(() => {
    const gl = document.querySelector("#game").getContext("webgl2"),
      ext = gl.getExtension("WEBGL_debug_renderer_info");
    return gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  });
  await page.evaluate(() => {
    window.__game.quality("high");
    window.__game.startFree();
  });
  const homeSpawn = await page.evaluate(() => window.__game.getState());
  await page.waitForTimeout(3200);
  report.home = await page.evaluate(() => window.__game.getState());
  report.neutralHome = {
    seconds: 3.2,
    movedMeters: Math.hypot(
      report.home.position[0] - homeSpawn.position[0],
      report.home.position[2] - homeSpawn.position[2],
    ),
    speed: report.home.speed,
    initialPosition: homeSpawn.position,
    settledPosition: report.home.position,
  };
  assert(
    report.neutralHome.movedMeters < 0.4,
    "Neutral Home parking hold must prevent rolling off the apron",
  );
  assert(
    report.neutralHome.speed < 0.15,
    "Neutral Home must settle below 0.15m/s",
  );
  assert.equal(report.home.grounded, 4);
  assert.equal(
    report.home.rotation.length,
    4,
    "Physics orientation must be exposed by the QA API",
  );
  assert(
    report.home.chassisHalfExtents,
    "Physics chassis dimensions must be exposed by the QA API",
  );
  await screenshot("home");

  report.parkingHold = await page.evaluate(() => {
    const g = window.__game;
    const idle = {
      steer: 0,
      throttle: 0,
      brake: 0,
      boost: false,
      handbrake: false,
    };
    const displacement = (a, b) =>
      Math.hypot(b.position[0] - a.position[0], b.position[2] - a.position[2]);
    g.pause();
    const before = g.getState(),
      held = g.simulateInput(idle, 30);
    const released = g.simulateInput({ ...idle, throttle: 1 }, 1.2);
    g.startFree();
    g.pause();
    g.recover();
    const recovered = g.getState(),
      drivenAfterRecovery = g.simulateInput({ ...idle, throttle: 1 }, 1.2);
    return {
      simulatedHoldSeconds: 30,
      heldDriftMeters: displacement(before, held),
      heldGrounded: held.grounded,
      heldSpeed: held.speed,
      throttleReleaseMeters: displacement(held, released),
      throttleReleaseSpeed: released.speed,
      recoveryReleaseMeters: displacement(recovered, drivenAfterRecovery),
      recoveryReleaseSpeed: drivenAfterRecovery.speed,
    };
  });
  assert(
    report.parkingHold.heldDriftMeters < 0.01,
    "Thirty simulated neutral seconds must retain the Home parking position",
  );
  assert.equal(
    report.parkingHold.heldGrounded,
    4,
    "Parking restraint must retain vertical suspension settling",
  );
  assert(
    report.parkingHold.throttleReleaseMeters > 0.4 &&
      report.parkingHold.throttleReleaseSpeed > 0.5,
    "Throttle must release Home parking restraint",
  );
  assert(
    report.parkingHold.recoveryReleaseMeters > 0.4 &&
      report.parkingHold.recoveryReleaseSpeed > 0.5,
    "Recovery must clear the Home parking restraint",
  );

  // Pause rendered simulation while stepping, so every departure physics step is inspected.
  report.departure = await page.evaluate((map) => {
    const g = window.__game,
      route = g.beginNeighborhoodDrive();
    g.pause();
    const home = [map.home.position[0], map.home.position[2]],
      pavementTolerance = 0.08;
    const segmentDistance = (p, a, b) => {
      const dx = b[0] - a[0],
        dz = b[1] - a[1],
        t = Math.max(
          0,
          Math.min(
            1,
            ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) /
              (dx * dx + dz * dz || 1),
          ),
        );
      return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
    };
    const polygonDistance = (p, points) => {
      let inside = false,
        distance = Infinity;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i],
          b = points[j];
        if (
          a[1] > p[1] !== b[1] > p[1] &&
          p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
        )
          inside = !inside;
        distance = Math.min(distance, segmentDistance(p, a, b));
      }
      return inside ? 0 : distance;
    };
    const bounds = (points) => ({
      minX: Math.min(...points.map((p) => p[0])),
      maxX: Math.max(...points.map((p) => p[0])),
      minZ: Math.min(...points.map((p) => p[1])),
      maxZ: Math.max(...points.map((p) => p[1])),
    });
    const nearby = (box) =>
      box.minX < home[0] + 80 &&
      box.maxX > home[0] - 80 &&
      box.minZ < home[1] + 80 &&
      box.maxZ > home[1] - 80;
    const driveways = map.beverlySurvey.drivewaySurfaces
      .map((f) => ({ ...f, bounds: bounds(f.points) }))
      .filter((f) => nearby(f.bounds));
    const buildings = (map.buildings ?? [])
      .map((b) => ({
        id: b.id,
        points: (b.points ?? b.footprint ?? []).map((p) => [p[0], p[2]]),
      }))
      .filter((b) => b.points.length >= 3 && nearby(bounds(b.points)));
    const segments = [];
    for (const road of map.roads)
      for (let i = 1; i < road.points.length; i++) {
        const a = [road.points[i - 1][0], road.points[i - 1][2]],
          b = [road.points[i][0], road.points[i][2]];
        if (nearby(bounds([a, b])))
          segments.push({ a, b, halfWidth: road.width / 2 });
      }
    const roadDistance = (p) =>
      segments.reduce(
        (best, segment) =>
          Math.min(
            best,
            segmentDistance(p, segment.a, segment.b) - segment.halfWidth,
          ),
        Infinity,
      );
    const pavementDistance = (p) =>
      Math.min(
        roadDistance(p),
        ...driveways.map((f) => polygonDistance(p, f.points)),
      );
    const rotatedPoint = (state, x, y, z) => {
      const [qx, qy, qz, qw] = state.rotation;
      // Collider center is 0.04m above the body origin, as in vehicle.ts.
      y += 0.04;
      const tx = 2 * (qy * z - qz * y),
        ty = 2 * (qz * x - qx * z),
        tz = 2 * (qx * y - qy * x);
      return [
        state.position[0] + x + qw * tx + qy * tz - qz * ty,
        state.position[2] + z + qw * tz + qx * ty - qy * tx,
      ];
    };
    const footprint = (state, halfX, halfY, halfZ) => {
      const points = [];
      for (const x of [-halfX, halfX])
        for (const y of [-halfY, halfY])
          for (const z of [-halfZ, halfZ])
            points.push(rotatedPoint(state, x, y, z));
      // Edge midpoints and center also catch concave gaps under a long chassis.
      for (const [x, z] of [
        [-halfX, 0],
        [halfX, 0],
        [0, -halfZ],
        [0, halfZ],
        [0, 0],
      ])
        points.push(rotatedPoint(state, x, 0, z));
      return points;
    };
    const cross = (a, b, c) =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const convexHull = (points) => {
      const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const chain = (ordered) => {
        const hull = [];
        for (const p of ordered) {
          while (hull.length >= 2 && cross(hull.at(-2), hull.at(-1), p) <= 0)
            hull.pop();
          hull.push(p);
        }
        return hull.slice(0, -1);
      };
      return [...chain(sorted), ...chain([...sorted].reverse())];
    };
    const overlap = (a, b) => {
      if (
        a.some((p) => polygonDistance(p, b) === 0) ||
        b.some((p) => polygonDistance(p, a) === 0)
      )
        return true;
      return a.some((p, i) =>
        b.some((q, j) => {
          const p2 = a[(i + 1) % a.length],
            q2 = b[(j + 1) % b.length];
          return (
            cross(p, p2, q) * cross(p, p2, q2) < 0 &&
            cross(q, q2, p) * cross(q, q2, p2) < 0
          );
        }),
      );
    };
    const result = {
      routePoints: route.points,
      pavementToleranceMeters: pavementTolerance,
      checkedSteps: 0,
      airborneSteps: 0,
      offPavementSteps: 0,
      maximumOffPavementMeters: 0,
      approximateVisualOverhangSteps: 0,
      houseOverlaps: [],
      firstOffPavement: [],
      samples: [],
      reachedRoad: false,
    };
    let roadFrames = 0;
    for (let i = 0; i < 25 * 60; i++) {
      const step = g.advanceNeighborhoodDrive(1 / 60),
        state = step.state,
        half = state.chassisHalfExtents;
      const points = footprint(state, half.x, half.y, half.z),
        distances = points.map(pavementDistance),
        outside = Math.max(...distances);
      result.checkedSteps++;
      result.airborneSteps += step.airborne;
      if (outside > pavementTolerance) {
        result.offPavementSteps++;
        result.maximumOffPavementMeters = Math.max(
          result.maximumOffPavementMeters,
          outside,
        );
        if (result.firstOffPavement.length < 12)
          result.firstOffPavement.push({
            step: i,
            position: state.position,
            target: step.target,
            outsideMeters: outside,
          });
      }
      if (
        footprint(state, 1.05, half.y, 2.6).some(
          (p) => pavementDistance(p) > pavementTolerance,
        )
      )
        result.approximateVisualOverhangSteps++;
      const hull = convexHull(points.slice(0, 8));
      for (const building of buildings)
        if (
          overlap(hull, building.points) &&
          !result.houseOverlaps.includes(building.id)
        )
          result.houseOverlaps.push(building.id);
      if (i % 30 === 0)
        result.samples.push({
          step: i,
          position: state.position,
          speed: state.speed,
          grounded: state.grounded,
          target: step.target,
          outsideMeters: outside,
        });
      const distanceFromHome = Math.hypot(
        state.position[0] - home[0],
        state.position[2] - home[1],
      );
      roadFrames =
        distanceFromHome > 6 &&
        points.every((p) => roadDistance(p) <= pavementTolerance)
          ? roadFrames + 1
          : 0;
      if (roadFrames >= 30) {
        result.reachedRoad = true;
        result.endState = state;
        break;
      }
      if (step.finished) break;
    }
    return result;
  }, map);
  assert(
    report.departure.reachedRoad,
    "Home departure did not reach the connected road",
  );
  assert.equal(
    report.departure.airborneSteps,
    0,
    "Home departure lost drivable surface",
  );
  assert.equal(
    report.departure.offPavementSteps,
    0,
    JSON.stringify(report.departure.firstOffPavement),
  );
  assert.deepEqual(
    report.departure.houseOverlaps,
    [],
    "Chassis overlapped a mapped building during Home departure",
  );
  let finished = false;
  for (let i = 0; i < 24 && !finished; i++) {
    const step = await page.evaluate(() =>
      window.__game.advanceNeighborhoodDrive(12),
    );
    assert.equal(step.airborne, 0, "Loop lost drivable surface");
    report.tour.push({
      target: step.target,
      points: step.points,
      steps: step.steps,
      position: step.state.position,
      grounded: step.state.grounded,
    });
    finished = step.finished;
  }
  assert(
    finished,
    "Connected Beverly loop did not complete after departing Home",
  );
  report.loopCompleted = true;
  await page.evaluate(() => window.__game.endBenchmark());

  // Same independent 12-second moving RAF sample as the Beverly check.
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
              meanMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
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

  const homePaving = surfaces.find((f) =>
    /^2\s+Beverly/i.test(f.address ?? ""),
  );
  assert(homePaving, "Home must have an observed driveway polygon");
  const homeTarget = center(homePaving.points);
  await screenshot(
    "home-driveway",
    [homeTarget[0] - 15, homeTarget[1] + 19],
    homeTarget,
    17,
    0.1,
  );
  for (const number of [6, 28, 30, 32, 33, 34]) {
    const pool = pools.find((f) =>
      new RegExp(`^${number}\\s+Beverly`, "i").test(f.address ?? ""),
    );
    assert(
      pool,
      `Observed pool at ${number} Beverly must be included in compiled data`,
    );
    const target = center(pool.points);
    const radius = Math.max(
      ...pool.points.map((p) => Math.hypot(p[0] - target[0], p[1] - target[1])),
    );
    await screenshot(
      `pool-${number}`,
      [
        target[0] + (number === 6 ? radius + 7 : -radius - 7),
        target[1] + radius + 6,
      ],
      target,
      radius + 7,
      0.5,
    );
  }
  const patio28 = features.find(
    (feature) =>
      feature.kind === "patio" && /^28\s+Beverly/i.test(feature.address ?? ""),
  );
  assert(patio28, "Number28's observed courtyard terrace must be restored");
  const courtyardTarget = center([
    ...patio28.points,
    ...building28.points.map((point) => [point[0], point[2]]),
  ]);
  await screenshot(
    "courtyard-28",
    [courtyardTarget[0] - 6, courtyardTarget[1] + 11],
    courtyardTarget,
    25,
    1.4,
  );
  const deck = decks.find((f) => /^39\s+Beverly/i.test(f.address ?? ""));
  if (deck) {
    const target = center(deck.points);
    const house = map.buildings.find(
      (b) => b.address === deck.address && b.kind === "house",
    );
    const houseCenter = house
      ? center((house.points ?? house.footprint).map((p) => [p[0], p[2]]))
      : [target[0] - 1, target[1]];
    const dx = target[0] - houseCenter[0],
      dz = target[1] - houseCenter[1],
      distance = Math.hypot(dx, dz) || 1;
    await screenshot(
      "deck-39",
      [target[0] + (dx / distance) * 12, target[1] + (dz / distance) * 12],
      target,
      8,
      0.5,
    );
  }
  const stops = signs
    .filter((f) => f.kind === "stop")
    .sort((a, b) => a.position[0] - b.position[0]);
  assert(
    stops.length >= 2,
    "Both Beverly junction approaches need sign evidence records",
  );
  for (const [name, stop] of [
    ["west", stops[0]],
    ["east", stops.at(-1)],
  ]) {
    const h = stop.facingHeading,
      [x, z] = stop.position;
    await screenshot(
      `sign-${name}`,
      [
        x + Math.sin(h) * 8 - Math.cos(h) * 2,
        z + Math.cos(h) * 8 + Math.sin(h) * 2,
      ],
      [x, z],
      2,
      stop.heightMeters ?? 2.15,
    );
  }
  await page.evaluate(() => {
    window.__game.clearInspectionView();
    for (const id of ["menu", "hud", "toast"])
      document.getElementById(id).style.visibility = "";
    window.__game.startFree();
  });
  for (const quality of ["medium", "low", "high"]) {
    await page.evaluate((quality) => window.__game.quality(quality), quality);
    report.transitions.push(await renderedState(quality));
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  report.transitions.push(await renderedState("resize 1280 × 720"));
  await page.setViewportSize({ width: 1920, height: 1080 });
  report.transitions.push(await renderedState("resize 1920 × 1080"));
  await page.evaluate(() => window.__game.startTest());
  report.transitions.push(await renderedState("handling grounds"));
  await page.evaluate(() => window.__game.startFree());
  await page.waitForFunction(() => window.__game.getState().grounded === 4);
  const restored = await renderedState("return Home");
  assert.equal(restored.state.mode, "neighborhood");
  const details = restored.state.metrics.scenery.find(
    (s) => "stopSigns" in s && "pools" in s,
  );
  assert(
    details &&
      details.pools === pools.length &&
      details.stopSigns === stops.length,
    "Property details must survive environment disposal/recreation",
  );
  report.transitions.push(restored);
  assert.equal(report.errors.length, 0, report.errors.join("\n"));
  report.passed = true;
  console.log(
    JSON.stringify(
      {
        passed: true,
        survey: report.survey,
        departure: {
          checkedSteps: report.departure.checkedSteps,
          offPavementSteps: report.departure.offPavementSteps,
          airborneSteps: report.departure.airborneSteps,
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
    "docs/property-verification.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
