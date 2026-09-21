/** Photo-specific Home review with actual rendered metadata and vehicle physics. */
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
  views: [],
  transitions: [],
  measurement:
    "Home facade and yard metadata comes from actual scene groups. Scripted departure uses the actual fixed-step vehicle simulation. Screenshots use inspection cameras and require human comparison with supplied photos; their capture alone does not establish visual fidelity. No physical-controller claim.",
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

async function renderedState(label) {
  const result = await page.evaluate(async () => {
    for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
    return {
      state: window.__game.getState(),
      details: window.__game.homeDetails(),
      glError: document.querySelector("#game").getContext("webgl2").getError(),
    };
  });
  assert.equal(result.glError, 0, `${label}: WebGL error`);
  return { label, ...result };
}

async function screenshot(name, position, target, height, targetHeight) {
  await page.evaluate(
    ({ position, target, height, targetHeight }) => {
      const g = window.__game;
      g.pause();
      for (const id of ["menu", "hud", "toast"])
        document.getElementById(id).style.visibility = "hidden";
      g.inspectView(
        [position[0], g.surfaceAt(...position) + height, position[1]],
        [target[0], g.surfaceAt(...target) + targetHeight, target[1]],
      );
    },
    { position, target, height, targetHeight },
  );
  await page.waitForTimeout(450);
  report.views.push(await renderedState(name));
  const path = `docs/home-${name}.png`;
  await page.screenshot({ path });
  report.screenshots.push(path);
}

function assertHome(details) {
  assert(
    details?.house,
    "Actual scene must contain the photo-specific Home house",
  );
  assert(
    details?.yard,
    "Actual scene must contain the photo-specific Home yard",
  );
  assert(details?.frame, "Home frame must be available for geometry review");
  assert(
    details.frame.right[1] > 0.9,
    "Viewer-right must point toward the south driveway",
  );
  assert(
    details.frame.back[0] > 0.9,
    "Front must face west toward Beverly Drive",
  );
  assert(
    details.frame.width > 14 && details.frame.width < 16,
    "Retain the state facade width",
  );
  assert(
    details.frame.depth > 9 && details.frame.depth < 11,
    "Retain the state footprint depth",
  );
  const openings = details.house.openings,
    byId = (id) => {
      const opening = openings.find((candidate) => candidate.id === id);
      assert(opening, `The actual facade must contain ${id}`);
      assert(
        opening.structuralOpening,
        `${id} must be a recess through the siding`,
      );
      return opening;
    },
    upper = ["left", "middle", "picture"].map((id) =>
      byId(`front-upper-${id}`),
    ),
    lower = ["left", "middle", "right"].map((id) => byId(`front-lower-${id}`)),
    entry = byId("front-entry"),
    patio = byId("right-patio-red-door"),
    slider = byId("right-deck-sliders");
  assert.deepEqual(
    upper.map((opening) => opening.kind),
    ["paired", "paired", "picture"],
  );
  assert(
    upper.every((opening) => opening.face === "front" && opening.shutters),
  );
  assert(
    upper[0].center < upper[1].center &&
      upper[1].center < entry.center &&
      entry.center < upper[2].center,
    "The photographed entry sits between the middle and right window groups",
  );
  assert(
    upper[0].center / details.frame.width < -0.3 &&
      upper[2].center / details.frame.width > 0.3,
    "Outer window groups must preserve the broad facade spacing",
  );
  assert(
    entry.center / details.frame.width > 0.08 &&
      entry.center / details.frame.width < 0.18,
    "The front entry must remain offset toward viewer-right",
  );
  assert(
    upper[2].width > upper[0].width && upper[2].width > upper[1].width,
    "The right picture window must be wider than the paired upper windows",
  );
  assert(
    lower.every(
      (opening, index) =>
        opening.top < upper[index].bottom &&
        opening.top - opening.bottom < upper[index].top - upper[index].bottom,
    ),
    "Short basement windows must remain distinct from the taller upper windows",
  );
  assert.equal(patio.face, "right");
  assert.equal(slider.face, "right");
  assert.equal(slider.kind, "slider");
  assert(
    Math.abs(patio.center - slider.center) < 0.001,
    "The patio door and upper sliders must align on the driveway-side wall",
  );
  assert(
    Math.abs(patio.centerWorld[0] - slider.centerWorld[0]) < 0.001 &&
      Math.abs(patio.centerWorld[2] - slider.centerWorld[2]) < 0.001,
    "Side openings must align in actual world coordinates",
  );
  assert(
    slider.bottom > patio.bottom + 2,
    "Deck sliders must be one storey above the patio entrance",
  );
  assert(
    details.house.batches > 0 && details.house.triangles > 100,
    "Facade metadata must correspond to actual rendered geometry",
  );
  assert(
    details.house.roof.ridgeParallelToFront,
    "Low roof ridge must run parallel to the photographed facade",
  );
  const frame = details.frame,
    local = ([x, z]) => {
      const dx = x - frame.center[0],
        dz = z - frame.center[1];
      return [
        dx * frame.right[0] + dz * frame.right[1],
        dx * frame.back[0] + dz * frame.back[1],
      ];
    },
    deck = details.yard.deck.points.map(local),
    patioRing = details.yard.patio.points.map(local),
    screen = details.yard.screenRoom.points.map(local),
    walk = details.yard.path.points.map(local);
  assert(
    deck.some(([u, v]) => u > frame.width / 2 + 2 && v < 0),
    "Deck must extend outside the driveway-side wall",
  );
  assert(
    deck.some(([u, v]) => u < 0 && v > frame.depth / 2 + 1),
    "Deck must wrap around the rear of the house",
  );
  assert(
    patioRing.every(([u]) => u >= frame.width / 2 - 0.001),
    "Patio must sit beside the right wall",
  );
  assert(
    details.yard.deck.y - details.yard.patio.y > 2,
    "Patio must have useful headroom below the elevated deck",
  );
  assert(
    screen.every(([, v]) => v >= frame.depth / 2 - 0.001) &&
      details.yard.screenRoom.roofed,
    "Screened area must be roofed and attached to the rear deck",
  );
  assert(
    walk.some(
      ([u, v]) =>
        Math.abs(u - entry.center) < 1 && v <= -frame.depth / 2 + 0.001,
    ) && walk.some(([u]) => u > frame.width / 2),
    "Front walk must connect the entry toward the driveway side",
  );
  assert.equal(details.yard.frontBeds.length, 2);
  assert.equal(details.yard.mailbox.number, "2");
  assert(details.yard.mailbox.redFlag);
  assert(details.yard.triangles > 100 && details.yard.drawCalls > 0);
  const ornaments = Object.fromEntries(
    Object.entries(details.yard.ornaments).map(([name, point]) => [
      name,
      local([point[0], point[2]]),
    ]),
  );
  assert(
    Object.values(ornaments).every(([, v]) => v < -frame.depth / 2),
    "Photo-observed ornaments must remain in the front foundation bed",
  );
  assert(
    ornaments.bench[0] > entry.center &&
      ornaments.wagonWheel[0] < entry.center &&
      ornaments.birdbath[0] < entry.center,
    "Bench belongs right of the entry; wheel and birdbath belong left",
  );
  assert(
    details.trees?.trees.length >= 3,
    "Front lawn needs the photographed exposed tree-trunk groups",
  );
  assert(
    details.trees.trees.every(
      (tree) =>
        tree.type === "deciduous" &&
        tree.localPosition[1] < -frame.depth / 2 &&
        tree.bareTrunkHeightMeters > 3,
    ),
    "Front-yard tree groups must retain tall exposed deciduous trunks",
  );
  assert(
    details.trees.trees.some((tree) => tree.localPosition[0] < 0) &&
      details.trees.trees.some((tree) => tree.localPosition[0] > 0),
    "Trunk groups should frame both sides of the open front lawn",
  );
}

try {
  await page.goto(`${url}/?test&home-qa`);
  await page.waitForFunction(
    () => window.__game?.getState().ready && window.__game.homeDetails,
    null,
    { timeout: 60000 },
  );
  await page.evaluate(() => {
    window.__game.quality("high");
    window.__game.startFree();
  });
  await page.waitForFunction(() => window.__game.getState().grounded === 4);
  report.initial = await renderedState("initial Home");
  assertHome(report.initial.details);
  const cameraPosition = report.initial.state.camera.position,
    deckPoints = report.initial.details.yard.deck.points;
  let cameraInsideDeck = false;
  for (let i = 0, j = deckPoints.length - 1; i < deckPoints.length; j = i++) {
    const a = deckPoints[i],
      b = deckPoints[j];
    if (
      a[1] > cameraPosition[2] !== b[1] > cameraPosition[2] &&
      cameraPosition[0] <
        ((b[0] - a[0]) * (cameraPosition[2] - a[1])) / (b[1] - a[1]) + a[0]
    )
      cameraInsideDeck = !cameraInsideDeck;
  }
  report.initialCamera = {
    position: cameraPosition,
    insideDeckFootprint: cameraInsideDeck,
    deckY: report.initial.details.yard.deck.y,
  };
  assert(
    !report.initial.state.camera.inspection,
    "Initial view must use the real chase camera",
  );
  assert(
    !cameraInsideDeck ||
      cameraPosition[1] > report.initial.details.yard.deck.y + 1.2,
    "Home chase camera must remain outside the deck's floor-to-railing volume",
  );
  await page.waitForTimeout(450);
  await page.screenshot({ path: "docs/home-start.png" });
  report.screenshots.push("docs/home-start.png");
  report.gpu = await page.evaluate(() => {
    const gl = document.querySelector("#game").getContext("webgl2"),
      ext = gl.getExtension("WEBGL_debug_renderer_info");
    return gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  });

  await screenshot("front", [-31.3, -4.89], [1.97, 2.13], 2.3, 2.6);
  await screenshot("front-details", [-18.58, -2.21], [1.97, 2.13], 2.3, 2.6);
  await screenshot("driveway-deck", [-5, 24], [1, 10], 3.5, 2.3);
  await screenshot("screened-porch", [20, 2], [8, 5], 5.8, 3);

  report.departure = await page.evaluate(async () => {
    const map = await (await fetch("/map/warwick.json")).json(),
      g = window.__game,
      route = g.beginNeighborhoodDrive();
    g.pause();
    const result = {
      routePoints: route.points,
      departurePoints: map.home.departurePath.length,
      checkedSteps: 0,
      airborneSteps: 0,
      samples: [],
      reachedRoad: false,
    };
    for (let i = 0; i < 25 * 60; i++) {
      const step = g.advanceNeighborhoodDrive(1 / 60);
      result.checkedSteps++;
      result.airborneSteps += step.airborne;
      if (i % 30 === 0)
        result.samples.push({
          step: i,
          position: step.state.position,
          speed: step.state.speed,
          grounded: step.state.grounded,
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
        result.endState = step.state;
        break;
      }
      if (step.finished) break;
    }
    g.endBenchmark();
    g.clearInspectionView();
    return result;
  });
  assert(
    report.departure.reachedRoad,
    "Home departure must clear the new house and yard details and reach Beverly Drive",
  );
  assert.equal(
    report.departure.airborneSteps,
    0,
    "Home departure must retain its drivable surface",
  );

  await page.evaluate(() => {
    for (const id of ["menu", "hud", "toast"])
      document.getElementById(id).style.visibility = "";
    window.__game.startFree();
  });
  for (const quality of ["low", "high"]) {
    await page.evaluate((quality) => window.__game.quality(quality), quality);
    const transition = await renderedState(`${quality} quality`);
    assertHome(transition.details);
    report.transitions.push(transition);
  }
  await page.evaluate(() => window.__game.startTest());
  const handling = await renderedState("handling grounds");
  assert.equal(handling.state.mode, "test");
  assert(
    !handling.details.house && !handling.details.yard,
    "Home-specific scenery must not leak into handling grounds",
  );
  report.transitions.push(handling);
  await page.evaluate(() => window.__game.startFree());
  await page.waitForFunction(() => window.__game.getState().grounded === 4);
  const restored = await renderedState("Home recreated");
  assert.equal(restored.state.mode, "neighborhood");
  assertHome(restored.details);
  assert.deepEqual(
    restored.details,
    report.initial.details,
    "Home details must survive environment disposal and recreation",
  );
  report.transitions.push(restored);
  assert.equal(report.errors.length, 0, report.errors.join("\n"));
  report.passed = true;
  console.log(
    JSON.stringify(
      {
        passed: true,
        departure: {
          checkedSteps: report.departure.checkedSteps,
          airborneSteps: report.departure.airborneSteps,
          reachedRoad: report.departure.reachedRoad,
        },
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
    "docs/home-verification.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
