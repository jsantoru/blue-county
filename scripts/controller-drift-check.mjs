/** Real-loop controller rest-offset and gentle-walking regression. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(30000);
const report = {
  date: new Date().toISOString(),
  methodology:
    "Actual production render loop and pedestrian physics with a synthetic standard Gamepad API controller. Tests use a modest diagonal resting offset both at startup and after deliberate stick use, followed by gentle four-direction movement. Only placement fixtures are used; movement and camera look go through normal input polling. No physical hardware or rumble verification is claimed.",
  checks: [],
  drift: [],
  gentleMovement: [],
  errors: [],
};
page.on("pageerror", (error) => report.errors.push(error.message));
page.on("response", (response) => {
  if (response.status() >= 400)
    report.errors.push(`${response.status()} ${response.url()}`);
});
const rest = [0.14, 0.08, 0.18, -0.08];
const frames = (count = 6) =>
  page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
  }, count);
const state = () => page.evaluate(() => window.__game.getState());
const axes = (values) =>
  page.evaluate((values) => {
    window.__driftPad.axes = [...values];
  }, values);
const press = async (index) => {
  await page.evaluate((index) => {
    window.__driftPad.buttons[index] = { value: 1, pressed: true };
  }, index);
  await frames(4);
  await page.evaluate((index) => {
    window.__driftPad.buttons[index] = { value: 0, pressed: false };
  }, index);
  await frames(4);
};
const xz = (v) => [v[0], v[2]];
const diff = (a, b) => a.map((v, i) => v - b[i]);
const norm = (v) => {
  const length = Math.hypot(...v) || 1;
  return v.map((a) => a / length);
};
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const forward = (s) => norm(xz(diff(s.camera.target, s.camera.position)));
const horizontalDistance = (a, b) => Math.hypot(...xz(diff(a, b)));
const inspectIdle = async (label) => {
  const before = await state();
  const snapshots = await page.evaluate(async () => {
    const results = [];
    for (let i = 0; i < 120; i++) {
      await new Promise(requestAnimationFrame);
      const { camera, exploration } = window.__game.getState();
      results.push({ camera, exploration });
    }
    return results;
  });
  const processed = await page.evaluate(
    () => window.__game.input.diagnostics().processed,
  );
  for (const field of ["moveX", "moveY", "lookX", "lookY"])
    assert.equal(
      processed[field],
      0,
      `${label}: resting ${field} must filter to zero even in raw diagnostics`,
    );
  const result = {
    phase: label,
    rawAxes: await page.evaluate(() => [...window.__driftPad.axes]),
    frames: snapshots.length,
    maxPlayerDrift: Math.max(
      ...snapshots.map((s) =>
        horizontalDistance(s.exploration.position, before.exploration.position),
      ),
    ),
    maxCameraDrift: Math.max(
      ...snapshots.map((s) =>
        horizontalDistance(s.camera.position, before.camera.position),
      ),
    ),
    maxYawChange: Math.max(
      ...snapshots.map((s) =>
        Math.abs(s.exploration.cameraYaw - before.exploration.cameraYaw),
      ),
    ),
    minimumForwardAlignment: Math.min(
      ...snapshots.map((s) => dot(forward(before), forward(s))),
    ),
    processed: Object.fromEntries(
      ["moveX", "moveY", "lookX", "lookY"].map((key) => [key, processed[key]]),
    ),
  };
  assert(
    result.maxPlayerDrift < 0.015,
    `${label}: resting left stick must not walk (${result.maxPlayerDrift}m)`,
  );
  assert(
    result.maxCameraDrift < 0.015,
    `${label}: resting sticks must not translate the camera (${result.maxCameraDrift}m)`,
  );
  assert(
    result.maxYawChange < 0.00001,
    `${label}: resting right stick must not orbit (${result.maxYawChange}rad)`,
  );
  assert(
    result.minimumForwardAlignment > 0.999999,
    `${label}: displayed camera direction must remain stable`,
  );
  report.drift.push(result);
};

try {
  await page.addInitScript((rest) => {
    window.__driftPad = {
      id: "Synthetic rest-offset regression — not physical hardware",
      index: 2,
      mapping: "standard",
      connected: true,
      axes: [...rest],
      buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })),
    };
    Object.defineProperty(navigator, "getGamepads", {
      value: () => [null, null, window.__driftPad],
    });
  }, rest);
  await page.goto(
    `${process.env.GAME_URL || "http://127.0.0.1:5180"}/?test&revision=controller-drift`,
  );
  await page.waitForFunction(() => window.__game?.getState().ready);
  report.bundle = await page
    .locator('script[type="module"]')
    .getAttribute("src");
  await page.evaluate(() => window.__game.startTest());
  await page.waitForFunction(() => window.__game.getState().grounded >= 3);
  await press(3);
  await page.waitForFunction(
    () => window.__game.getState().exploration.phase === "foot",
  );
  await page.evaluate(() => window.__game.setFootPosition([0, 0.1, 0], 0));
  await frames(25);
  await inspectIdle("startup resting offsets");
  report.checks.push(
    "Startup resting offsets of LS (0.14, 0.08) and RS (0.18, -0.08) produce no walking or camera drift over 120 actual frames",
  );

  // Clear any held-control suppression before deliberately using both sticks.
  // The subsequent rest test must pass because of filtering, not a consume gate.
  await axes([0, 0, 0, 0]);
  await frames(8);
  const activeBefore = await state();
  await axes([0.65, -0.1, 0.7, -0.35]);
  await frames(30);
  const activeAfter = await state();
  assert(
    horizontalDistance(
      activeBefore.exploration.position,
      activeAfter.exploration.position,
    ) > 0.15,
    "Deliberate left-stick input must work before the after-use drift regression",
  );
  assert(
    Math.abs(
      activeAfter.exploration.cameraYaw - activeBefore.exploration.cameraYaw,
    ) > 0.15,
    "Deliberate right-stick input must work before the after-use drift regression",
  );
  await axes(rest);
  await frames(45); // Allow physical walking deceleration to settle.
  await inspectIdle("resting offsets after deliberate stick use");
  report.checks.push(
    "After real movement and camera look, releasing directly to imperfect rest stays still for 120 frames without menu/transition input suppression",
  );

  for (const [label, x, y] of [
    ["forward", 0, -0.25],
    ["right", 0.25, 0],
    ["backward", 0, 0.25],
    ["left", -0.25, 0],
  ]) {
    await axes([0, 0, 0, 0]);
    await frames(5);
    await page.evaluate(() => window.__game.setFootPosition([0, 0.1, 0], 0.7));
    await frames(12);
    const before = await state();
    await axes([x, y, 0, 0]);
    await frames(48);
    const after = await state();
    const processed = await page.evaluate(
      () => window.__game.input.diagnostics().processed,
    );
    const magnitude = Math.hypot(processed.moveX, processed.moveY);
    const velocity = norm(xz(after.exploration.velocity));
    const f = forward(after);
    const r = [-f[1], f[0]];
    const expected =
      label === "forward"
        ? f
        : label === "backward"
          ? f.map((v) => -v)
          : label === "right"
            ? r
            : r.map((v) => -v);
    const facing = [
      Math.sin(after.exploration.yaw),
      Math.cos(after.exploration.yaw),
    ];
    const result = {
      direction: label,
      rawAxes: [x, y],
      processedMagnitude: magnitude,
      distance: horizontalDistance(
        after.exploration.position,
        before.exploration.position,
      ),
      velocityAlignmentToViewDirection: dot(velocity, expected),
      facingAlignmentToVelocity: dot(facing, velocity),
    };
    assert(
      magnitude > 0 && magnitude < 0.08,
      `Gentle ${label} must exercise movement below the former facing threshold (${magnitude})`,
    );
    assert(
      result.distance > 0.045,
      `Gentle ${label} must actually walk (${result.distance}m)`,
    );
    assert(
      result.velocityAlignmentToViewDirection > 0.995,
      `Gentle ${label} must follow the displayed view`,
    );
    assert(
      result.facingAlignmentToVelocity > 0.995,
      `Gentle ${label} must turn the body toward travel instead of sliding backward (${result.facingAlignmentToVelocity})`,
    );
    report.gentleMovement.push(result);
  }
  await axes(rest);
  await frames(45);
  report.checks.push(
    "Gentle 0.25 raw left-stick movement works in all four camera-relative directions and turns the character to face actual travel below the former 0.08 facing threshold",
  );
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
    "docs/controller-drift-verification.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
