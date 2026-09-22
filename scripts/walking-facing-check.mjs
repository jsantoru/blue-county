/** Rendered character facing after real vehicle exits, not just physics yaw. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const before = process.argv.includes("--before");
const directory = `output/playwright/walking-facing/${before ? "before" : "after"}`;
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(45000);
const report = {
  date: new Date().toISOString(),
  before,
  methodology:
    "Production game in Edge. Cars are placed at repeatable headings on the handling grounds; exits use normal keyboard F and the complete transfer animation. Movement uses normal keyboard events or synthetic standard Gamepad API polling. Facing and up vectors come from the actual rendered character world transform, independently of physics yaw. Movement samples use real frame-to-frame positions. No simulated walking hooks are used. Physical controller feel is not measured.",
  exits: [],
  directions: [],
  screenshots: [],
  errors: [],
  warnings: [],
};
page.on("pageerror", (e) => report.errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") report.errors.push(m.text());
  if (m.type() === "warning") report.warnings.push(m.text());
});
page.on("response", (r) => {
  if (r.status() >= 400) report.errors.push(`${r.status()} ${r.url()}`);
});
const frames = (n) =>
  page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame);
  }, n);
const state = () => page.evaluate(() => window.__game.getState());
const axes = (x = 0, y = 0, look = 0) =>
  page.evaluate(
    (v) => {
      window.__facingPad.axes = v;
    },
    [x, y, look, 0],
  );
const key = async (value) => {
  await page.keyboard.down(value);
  await frames(3);
  await page.keyboard.up(value);
  await frames(3);
};
const phase = (p) =>
  page.waitForFunction(
    (p) => window.__game.getState().exploration.phase === p,
    p,
  );
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const norm = (a) => {
  const l = Math.hypot(...a) || 1;
  return a.map((v) => v / l);
};
const xz = (a) => [a[0], a[2]];
const delta = (a, b) => a.map((v, i) => v - b[i]);
const capture = async (name) => {
  const path = `${directory}/${name}.png`;
  await page.screenshot({ path });
  report.screenshots.push(path);
};
const measure = async (count = 36) => {
  const rows = await page.evaluate(async (count) => {
    const rows = [];
    // High-refresh displays can render several frames per fixed physics step.
    // Sample distinct positions, rather than treating those frames as a stall.
    for (let i = 0; i < count * 12 && rows.length < count; i++) {
      await new Promise(requestAnimationFrame);
      const s = window.__game.getState();
      const last = rows.at(-1)?.position;
      if (
        last &&
        Math.hypot(
          s.exploration.position[0] - last[0],
          s.exploration.position[2] - last[2],
        ) < 0.000001
      )
        continue;
      rows.push({
        position: s.exploration.position,
        yaw: s.exploration.yaw,
        forward: s.exploration.driver.worldForward,
        up: s.exploration.driver.worldUp,
        camera: s.camera,
        phase: s.exploration.phase,
      });
    }
    return rows;
  }, count);
  const moving = rows
    .slice(1)
    .map((s, i) => {
      const travel = xz(delta(s.position, rows[i].position));
      return {
        distance: Math.hypot(...travel),
        alignment: dot(norm(travel), norm(xz(s.forward))),
      };
    })
    .filter((v) => v.distance > 0.0001);
  assert(
    moving.length > count / 2,
    "Must measure actual movement, not a stationary facing pose",
  );
  return {
    minimumFacingAlignment: Math.min(...moving.map((v) => v.alignment)),
    minimumUpright: Math.min(...rows.map((s) => s.up[1])),
    minimumYawAlignment: Math.min(
      ...rows.map((s) =>
        dot(norm(xz(s.forward)), [Math.sin(s.yaw), Math.cos(s.yaw)]),
      ),
    ),
    distance: Math.hypot(...xz(delta(rows.at(-1).position, rows[0].position))),
    travelDirection: norm(xz(delta(rows.at(-1).position, rows[0].position))),
    viewForward: norm(
      xz(delta(rows[0].camera.target, rows[0].camera.position)),
    ),
    samples: rows.length,
  };
};
const assertFacing = (r) => {
  assert(
    r.minimumFacingAlignment > 0.985,
    `Rendered character must face actual travel: ${JSON.stringify(r)}`,
  );
  assert(
    r.minimumYawAlignment > 0.9999,
    "Rendered character must follow the physics heading",
  );
  assert(
    r.minimumUpright > 0.9999,
    "Walking root must clear the parked car's pitch/roll",
  );
};
try {
  await page.addInitScript(() => {
    window.__facingPad = {
      id: "Synthetic walking-facing check",
      index: 2,
      mapping: "standard",
      connected: true,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })),
    };
    Object.defineProperty(navigator, "getGamepads", {
      value: () => [null, null, window.__facingPad],
    });
  });
  await page.goto(
    `${process.env.GAME_URL || "http://127.0.0.1:5180"}/?test&revision=walking-facing-${before ? "before" : "after"}`,
  );
  await page.waitForFunction(() => window.__game?.getState().ready);
  report.bundle = await page
    .locator('script[type="module"]')
    .getAttribute("src");
  for (const member of before
    ? ["lou"]
    : ["lou", "joe", "chris", "craig", "ed"]) {
    await axes();
    if ((await state()).screen === null) await key("Escape");
    await page.getByRole("button", { name: /The Lug Nuts/ }).click();
    await page.locator(`.garage-member[data-member="${member}"]`).click();
    await page.locator(".garage-drive").click();
    await page.waitForFunction((member) => {
      const s = window.__game.getState();
      return s.club.member === member && !s.club.busy && s.screen === null;
    }, member);
    for (const heading of before
      ? [Math.PI]
      : [0, Math.PI / 2 + 0.12, Math.PI, -Math.PI / 2 - 0.12]) {
      await axes();
      await page.evaluate((heading) => {
        window.__game.startTest();
        window.__game.teleport([0, 1, -10], heading);
      }, heading);
      await page.waitForFunction(
        () =>
          window.__game.getState().grounded === 4 &&
          Math.abs(window.__game.getState().speed) < 0.1,
      );
      await frames(45);
      await key("f");
      await phase("foot");
      await axes(0, -1);
      await frames(55);
      const result = { member, heading, ...(await measure()) };
      report.exits.push(result);
      console.log(
        JSON.stringify({
          member,
          heading,
          alignment: result.minimumFacingAlignment,
        }),
      );
      if (member === "lou" && heading === Math.PI)
        await capture("lou-forward-after-exit");
      if (before)
        assert(
          result.minimumFacingAlignment < -0.9,
          "Baseline must reproduce facing backwards",
        );
      else {
        assertFacing(result);
        assert(
          dot(result.travelDirection, result.viewForward) > 0.999,
          "Stick up must move away along displayed view",
        );
      }
      await axes();
      await frames(15);
    }
    if (before) break;
    // Retain the transform produced by the last real exit. Placement only gives
    // directions an unobstructed start; it deliberately does not touch the visual.
    for (const [label, x, y, keyName] of [
      ["gentle forward", 0, -0.26, null],
      ["right", 1, 0, null],
      ["back", 0, 1, null],
      ["left", -1, 0, null],
      ["keyboard up", 0, 0, "ArrowUp"],
    ]) {
      await axes();
      await page.evaluate(() =>
        window.__game.setFootPosition([0, 0.1, 10], 2.4),
      );
      await frames(8);
      if (keyName) await page.keyboard.down(keyName);
      else await axes(x, y);
      await frames(55);
      const result = { member, label, ...(await measure()) };
      report.directions.push(result);
      assertFacing(result);
      const f = result.viewForward;
      const expected =
        label === "right"
          ? [-f[1], f[0]]
          : label === "left"
            ? [f[1], -f[0]]
            : label === "back"
              ? f.map((v) => -v)
              : f;
      assert(
        dot(expected, result.travelDirection) > 0.999,
        `${member}: ${label} camera-relative movement`,
      );
      if (keyName) await page.keyboard.up(keyName);
      await axes();
      await frames(15);
    }
    // Orbit while already walking, then let turning settle before measuring.
    await axes(0, -1, 0.8);
    await frames(40);
    await axes(0, -1, 0);
    await frames(40);
    const orbit = {
      member,
      label: "forward after live camera orbit",
      ...(await measure()),
    };
    assertFacing(orbit);
    report.directions.push(orbit);
    await axes();
    await frames(15);
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failureState = await state();
  report.input = await page.evaluate(() => window.__game.input.diagnostics());
  await capture("failure");
  report.failure = error.stack ?? String(error);
  throw error;
} finally {
  await writeFile(
    `${directory}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}
console.log(
  JSON.stringify({
    passed: report.passed,
    before,
    exits: report.exits.length,
    directions: report.directions.length,
    report: `${directory}/report.json`,
  }),
);
