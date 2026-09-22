/** Real render-loop regression for camera-relative walking and seated steering. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(30000);
const report = {
  date: new Date().toISOString(),
  methodology:
    "Actual production render loop and physics with keyboard, right-drag mouse events, and synthetic standard Gamepad API snapshots. Movement is compared to the displayed camera vectors, not an assumed internal yaw. Placement hooks establish repeatable unobstructed and wall-adjacent handling-ground fixtures; no simulated movement hooks are used. This does not claim physical-controller or rumble verification.",
  checks: [],
  movement: [],
  errors: [],
};
page.on("pageerror", (error) => report.errors.push(error.message));
page.on("response", (response) => {
  if (response.status() >= 400)
    report.errors.push(`${response.status()} ${response.url()}`);
});
const state = () => page.evaluate(() => window.__game.getState());
const frames = (count = 6) =>
  page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
  }, count);
const samples = (count) =>
  page.evaluate(async (count) => {
    const result = [];
    for (let i = 0; i < count; i++) {
      await new Promise(requestAnimationFrame);
      const { camera, exploration } = window.__game.getState();
      result.push({ camera, exploration });
    }
    return result;
  }, count);
const axis = (index, value) =>
  page.evaluate(
    ({ index, value }) => {
      window.__cameraPad.axes[index] = value;
    },
    { index, value },
  );
const button = (index, value) =>
  page.evaluate(
    ({ index, value }) => {
      window.__cameraPad.buttons[index] = { value, pressed: value > 0.5 };
    },
    { index, value },
  );
const press = async (index) => {
  await button(index, 1);
  await frames(3);
  await button(index, 0);
  await frames(3);
};
const phase = (value) =>
  page.waitForFunction(
    (value) => window.__game.getState().exploration.phase === value,
    value,
  );
const fixture = async (yaw) => {
  await page.evaluate(
    (yaw) => window.__game.setFootPosition([0, 0.1, 0], yaw),
    yaw,
  );
  await frames(8);
};
const length = (a) => Math.hypot(...a);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const normalized = (a) => a.map((value) => value / (length(a) || 1));
const subtract = (a, b) => a.map((value, i) => value - b[i]);
const horizontal = (a) => [a[0], a[2]];
const forward = (snapshot) =>
  normalized(
    horizontal(subtract(snapshot.camera.target, snapshot.camera.position)),
  );
const right = (snapshot) => {
  const f = forward(snapshot);
  return [-f[1], f[0]];
};
const boom = (snapshot) =>
  length(subtract(snapshot.camera.position, snapshot.camera.target));
const elevation = (snapshot) => {
  const offset = subtract(snapshot.camera.position, snapshot.camera.target);
  return Math.atan2(offset[1], length(horizontal(offset)));
};
const captureSteering = async (direction) => {
  await page.evaluate(() => {
    const g = window.__game;
    const s = g.getState();
    const d = g.heroDetails();
    const wheel = d.steeringWheel;
    const rotate = ([x, y, z]) => {
      const [qx, qy, qz, qw] = s.rotation;
      const tx = 2 * (qy * z - qz * y);
      const ty = 2 * (qz * x - qx * z);
      const tz = 2 * (qx * y - qy * x);
      return [
        x + qw * tx + qy * tz - qz * ty,
        y + qw * ty + qz * tx - qx * tz,
        z + qw * tz + qx * ty - qy * tx,
      ];
    };
    // Wrist coordinates provide the actual rendered model translation, including
    // the asset's vertical offset. No assumed chassis origin is used for the shot.
    const localMid = wheel.hands.left.map(
      (v, i) => (v + wheel.hands.right[i]) / 2,
    );
    const worldMid = d.bones.left_hand.map(
      (v, i) => (v + d.bones.right_hand[i]) / 2,
    );
    const centerDelta = rotate(wheel.center.map((v, i) => v - localMid[i]));
    const center = worldMid.map((v, i) => v + centerDelta[i]);
    const offset = rotate([0.5, 0.5, -0.68]);
    g.inspectView(
      center.map((v, i) => v + offset[i]),
      center,
    );
    document.getElementById("toast").style.visibility = "hidden";
  });
  await frames(5);
  const file = `docs/controller-steering-${direction}.png`;
  await page.screenshot({ path: file });
  await page.evaluate(() => {
    window.__game.clearInspectionView();
    document.getElementById("toast").style.visibility = "";
  });
  return file;
};

try {
  await page.addInitScript(() => {
    window.__cameraPad = {
      id: "Synthetic camera regression — not physical hardware",
      index: 2,
      mapping: "standard",
      connected: true,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })),
    };
    Object.defineProperty(navigator, "getGamepads", {
      value: () => [null, null, window.__cameraPad],
    });
  });
  await page.goto(
    `${process.env.GAME_URL || "http://127.0.0.1:5180"}/?test&revision=camera-controls`,
  );
  await page.waitForFunction(() => window.__game?.getState().ready);
  report.bundle = await page
    .locator('script[type="module"]')
    .getAttribute("src");
  await page.evaluate(() => window.__game.startTest());
  await page.waitForFunction(() => window.__game.getState().grounded >= 3);

  report.steering = [];
  for (const [label, steer, leftHigher] of [
    ["right", 0.85, true],
    ["left", -0.85, false],
  ]) {
    await axis(0, steer);
    await frames(25);
    const vehicle = await state();
    const wheel = await page.evaluate(
      () => window.__game.heroDetails().steeringWheel,
    );
    assert(
      wheel?.hands?.left && wheel?.hands?.right,
      "Steering inspection hook must expose both wrists",
    );
    assert(
      steer * vehicle.steering < 0,
      "Road-wheel direction must match vehicle steering convention",
    );
    const heightDifference = wheel.hands.left[1] - wheel.hands.right[1];
    assert(
      leftHigher ? heightDifference > 0.08 : heightDifference < -0.08,
      `${label} turn must move the driver's hands in the correct wheel direction (${heightDifference})`,
    );
    const screenshot = await captureSteering(label);
    report.steering.push({
      direction: label,
      roadWheelAngle: vehicle.steering,
      wheel,
      screenshot,
    });
  }
  await axis(0, 0);
  await frames(8);
  report.checks.push(
    "Left/right steering moves the seated driver's hands in the correct direction while preserving road-wheel steering",
  );

  await press(3);
  await phase("foot");
  for (const yaw of [0, 0.9, 2.2, -2.4]) {
    for (const control of ["W", "D", "LS up", "LS right"]) {
      await fixture(yaw);
      const before = await state();
      const sideways = control === "D" || control === "LS right";
      if (control === "W" || control === "D") await page.keyboard.down(control);
      else await axis(sideways ? 0 : 1, sideways ? 0.8 : -0.8);
      await frames(16);
      const after = await state();
      if (control === "W" || control === "D") await page.keyboard.up(control);
      else await axis(sideways ? 0 : 1, 0);
      const moved = horizontal(
        subtract(after.exploration.position, before.exploration.position),
      );
      const screenDirection = sideways ? right(after) : forward(after);
      const alignment = dot(normalized(moved), screenDirection);
      assert(length(moved) > 0.08, `${control} must move the explorer`);
      assert(
        alignment > 0.995,
        `${control} must follow displayed camera direction at yaw ${yaw}: ${alignment}`,
      );
      report.movement.push({
        yaw,
        control,
        distance: length(moved),
        alignment,
      });
    }
  }
  report.checks.push(
    "W/D and left-stick forward/right follow the displayed camera at four different headings",
  );

  await fixture(0);
  const lookBefore = await state();
  await axis(2, 0.7);
  await frames(15);
  await axis(2, 0);
  const lookAfter = await state();
  assert(
    dot(forward(lookAfter), right(lookBefore)) > 0.15,
    "Right-stick right must turn the view toward screen right",
  );
  const pitchBefore = elevation(lookAfter);
  await axis(3, 0.7);
  await frames(12);
  await axis(3, 0);
  const pitchAfter = elevation(await state());
  assert(
    pitchAfter > pitchBefore + 0.08,
    "Right-stick down must look downward",
  );
  report.look = {
    rightProjection: dot(forward(lookAfter), right(lookBefore)),
    pitchBefore,
    pitchAfter,
  };
  report.checks.push(
    "Right-stick horizontal and vertical look signs match a standard uninverted third-person camera",
  );

  await fixture(0);
  const mouseBefore = await state();
  await page.mouse.move(550, 390);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(750, 390, { steps: 8 });
  await page.mouse.up({ button: "right" });
  await frames(6);
  const mouseAfter = await state();
  assert(
    dot(forward(mouseAfter), right(mouseBefore)) > 0.3,
    "Rightward mouse dragging must turn the view toward screen right",
  );
  report.checks.push(
    "Actual right-button mouse drag turns the view in the expected direction",
  );

  await fixture(0);
  await page.keyboard.down("W");
  await axis(2, 0.65);
  const orbit = await samples(40);
  await axis(2, 0);
  await page.keyboard.up("W");
  const alignment = orbit
    .slice(8)
    .map((sample) =>
      dot(normalized(horizontal(sample.exploration.velocity)), forward(sample)),
    );
  report.orbit = {
    minimumMovementAlignment: Math.min(...alignment),
    minimumBoom: Math.min(...orbit.map(boom)),
  };
  assert(
    report.orbit.minimumMovementAlignment > 0.98,
    `Moving while orbiting must stay aligned to the displayed view: ${report.orbit.minimumMovementAlignment}`,
  );
  assert(
    report.orbit.minimumBoom > 4.3,
    "Unobstructed orbit must preserve the camera boom",
  );
  report.checks.push(
    "Continuous movement plus right-stick orbit stays aligned with the displayed camera without cutting inward",
  );

  await fixture(0);
  await page.keyboard.down("S");
  await frames(25);
  const recenterBefore = await state();
  await button(11, 1);
  const recenter = await samples(40);
  await button(11, 0);
  await page.keyboard.up("S");
  report.recenter = {
    beforeBoom: boom(recenterBefore),
    minimumBoom: Math.min(...recenter.map(boom)),
    maximumBoom: Math.max(...recenter.map(boom)),
    initialForward: forward(recenterBefore),
    finalForward: forward(recenter.at(-1)),
  };
  assert(
    report.recenter.minimumBoom > 4.3,
    `A 180-degree recenter must orbit around the actor rather than pass through him: ${report.recenter.minimumBoom}`,
  );
  assert(
    dot(report.recenter.initialForward, report.recenter.finalForward) < -0.9,
    "R3 recenter should turn the view to the backpedaling character's facing direction",
  );
  report.checks.push(
    "R3 recenter during backpedaling makes a stable 180-degree orbit with a full unobstructed boom",
  );

  await page.evaluate(() => {
    const g = window.__game;
    // The handling-ground wall occupies z=149.25..150.75 and y=0..2.
    g.setFootPosition([0, g.surfaceAt(0, 153) + 0.08, 153], 0);
  });
  await frames(12);
  const blocked = await state();
  assert(
    boom(blocked) < 3,
    `Test-ground wall should retract the camera: ${boom(blocked)}`,
  );
  await page.keyboard.down("W");
  const recovery = await samples(85);
  await page.keyboard.up("W");
  await frames(10);
  const clear = await state();
  report.collision = {
    blockedBoom: boom(blocked),
    recoveredBoom: boom(clear),
    samples: recovery.map(boom),
  };
  assert(
    boom(clear) > 4.3,
    `Camera should recover its clear boom after walking away from the wall: ${boom(clear)}`,
  );
  assert(
    recovery.every(
      (sample) =>
        dot(
          normalized(horizontal(sample.exploration.velocity)),
          forward(sample),
        ) > 0.98,
    ),
    "Camera retraction/recovery must not change the movement direction",
  );
  report.checks.push(
    "An actual handling-ground wall retracts the camera; walking away restores the boom without changing control direction",
  );
  await page.evaluate(() => window.__game.startFree());
  await page.waitForFunction(() => window.__game.getState().grounded >= 3);
  await press(3);
  await phase("foot");
  await frames(25);
  await page.screenshot({ path: "docs/camera-controls-walking.png" });
  report.screenshot = "docs/camera-controls-walking.png";
  assert.equal(
    await page.evaluate(() =>
      document.querySelector("#game").getContext("webgl2").getError(),
    ),
    0,
  );
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack ?? String(error);
  throw error;
} finally {
  await writeFile(
    "docs/camera-controls-verification.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
