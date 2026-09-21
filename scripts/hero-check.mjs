/** Visual review of the actual Blender assets in the production scene. */
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.setDefaultTimeout(60000);
const report = {
  date: new Date().toISOString(),
  errors: [],
  warnings: [],
  shots: [],
  checks: [],
};
page.on("pageerror", (error) => report.errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") report.errors.push(message.text());
  if (message.type() === "warning") report.warnings.push(message.text());
});
page.on("response", (response) => {
  if (response.status() >= 400)
    report.errors.push(`${response.status()} ${response.url()}`);
});
const frame = async (count = 5) =>
  page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
  }, count);
const capture = async (name) => {
  await frame();
  assert.equal(
    await page.evaluate(() =>
      document.querySelector("#game").getContext("webgl2").getError(),
    ),
    0,
  );
  const file = `docs/hero-${name}.png`;
  await page.screenshot({ path: file });
  report.shots.push({
    file,
    state: await page.evaluate(() => window.__game.getState()),
    detail: await page.evaluate(() => window.__game.heroDetails()),
  });
};
const inspect = async (kind) =>
  page.evaluate((kind) => {
    const g = window.__game,
      s = g.getState(),
      d = g.heroDetails();
    g.pause();
    document.getElementById("menu").style.visibility = "hidden";
    document.getElementById("toast").style.visibility = "hidden";
    const [x, y, z, w] = s.rotation;
    const yaw = Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
    const head = d.bones.head;
    if (kind === "portrait") {
      const standing = s.exploration.phase === "foot";
      const actorYaw = standing ? s.exploration.yaw : yaw;
      // Inspect the seated face over the driver's side, clear of the windshield rail.
      const forward = standing ? 1.16 : 0.7;
      const side = standing ? 0.3 : 1.2;
      g.inspectView(
        [
          head[0] + Math.sin(actorYaw) * forward + Math.cos(actorYaw) * side,
          head[1] + (standing ? 0.035 : 0.35),
          head[2] + Math.cos(actorYaw) * forward - Math.sin(actorYaw) * side,
        ],
        [head[0], head[1] - (standing ? 0.06 : 0.15), head[2]],
      );
    } else if (kind === "full") {
      const feet = s.exploration.position;
      const actorYaw = s.exploration.yaw;
      g.inspectView(
        [
          feet[0] + Math.sin(actorYaw) * 3.2 + Math.cos(actorYaw) * 0.5,
          feet[1] + 1.05,
          feet[2] + Math.cos(actorYaw) * 3.2 - Math.sin(actorYaw) * 0.5,
        ],
        [feet[0], feet[1] + 0.93, feet[2]],
      );
    } else {
      const seat = s.exploration.driver.seatWorld;
      g.inspectView(
        [
          s.position[0] + Math.cos(yaw) * 3.5 + Math.sin(yaw) * 1.55,
          s.position[1] + 1.6,
          s.position[2] - Math.sin(yaw) * 3.5 + Math.cos(yaw) * 1.55,
        ],
        [seat[0], seat[1] + 0.9, seat[2]],
      );
    }
  }, kind);
const resume = async () =>
  page.evaluate(() => {
    document.getElementById("menu").style.visibility = "";
    document.getElementById("toast").style.visibility = "";
    window.__game.clearInspectionView();
    window.__game.resume();
  });
try {
  await page.goto(
    `${process.env.GAME_URL || "http://127.0.0.1:5180"}/?test&revision=dad-coppola`,
    { waitUntil: "networkidle" },
  );
  await page.waitForFunction(() => window.__game?.getState().ready);
  await page.evaluate(() => window.__game.startFree());
  await page.waitForFunction(() => window.__game.getState().grounded >= 3);
  await inspect("car");
  await capture("dad-driving");
  await inspect("portrait");
  await capture("dad-seated-portrait");
  await resume();
  await frame(5);
  await page.keyboard.down("KeyF");
  await page.waitForTimeout(120);
  await page.keyboard.up("KeyF");
  await page.waitForFunction(() => {
    const e = window.__game.getState().exploration;
    return (
      e.phase === "exiting" &&
      e.transferProgress >= 0.4 &&
      e.transferProgress < 0.7
    );
  });
  await inspect("car");
  const transfer = await page.evaluate(
    () => window.__game.getState().exploration,
  );
  assert(
    transfer.doors.left.progress > 0.9 || transfer.doors.right.progress > 0.9,
  );
  await capture("dad-exiting");
  report.checks.push(
    "Actual F exit opens an exported door during the animated transfer",
  );
  await resume();
  await page.waitForFunction(
    () => window.__game.getState().exploration.phase === "foot",
  );
  assert.equal(
    await page.evaluate(
      () => window.__game.getState().exploration.doors.left.progress,
    ),
    0,
  );
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(900);
  await page.keyboard.up("KeyW");
  // Let the last gait blend settle before labeling a capture as standing.
  await page.waitForTimeout(900);
  assert.equal(
    await page.evaluate(() => window.__game.heroDetails().model.pose),
    "idle",
  );
  await inspect("full");
  await capture("dad-standing");
  await inspect("portrait");
  await capture("dad-portrait");
  await resume();
  await frame(5);
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("KeyW");
  await page.waitForFunction(() => {
    const v = window.__game.getState().exploration.velocity;
    return Math.hypot(v[0], v[2]) > 4;
  });
  await frame(8);
  assert.equal(
    await page.evaluate(() => window.__game.heroDetails().model.pose),
    "run",
  );
  await page.evaluate(() => window.__game.pause());
  await page.keyboard.up("KeyW");
  await page.keyboard.up("ShiftLeft");
  await inspect("full");
  await capture("dad-running");
  report.checks.push(
    "The Blender character remains visible and animated in seated, walking and running modes",
  );
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await writeFile(
    "docs/hero-verification.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}
console.log(
  JSON.stringify({
    passed: report.passed,
    checks: report.checks,
    screenshots: report.shots.map((s) => s.file),
    errors: report.errors,
  }),
);
