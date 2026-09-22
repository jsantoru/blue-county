/** Explicit synthetic-pad integration checks; never evidence of physical hardware feel or rumble. */
import { chromium } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "msedge",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const url = process.env.GAME_URL || "http://127.0.0.1:5174";
try {
  await page.goto(`${url}/?test`);
  await page.waitForFunction(() => window.__game?.getState().ready);
  await page.mouse.click(1800, 500);
  await page.evaluate(() => {
    window.__syntheticPad = {
      id: "AUTOMATED TEST PAD — NOT PHYSICAL",
      index: 2,
      mapping: "standard",
      connected: true,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })),
    };
    Object.defineProperty(navigator, "getGamepads", {
      value: () => [
        null,
        null,
        window.__syntheticPad.connected ? window.__syntheticPad : null,
      ],
    });
  });
  const state = () => page.evaluate(() => window.__game.getState());
  const press = async (index) => {
    await page.evaluate(async (i) => {
      const frames = async () => {
        for (let n = 0; n < 3; n++) await new Promise(requestAnimationFrame);
      };
      window.__syntheticPad.buttons[i] = { value: 1, pressed: true };
      // Guarantee the game samples both edges even during a slow render/startup frame.
      await frames();
      window.__syntheticPad.buttons[i] = { value: 0, pressed: false };
      await frames();
    }, index);
  };
  const analog = async (values) => {
    await page.evaluate((values) => {
      window.__syntheticPad.axes[0] = values.steer ?? 0;
      window.__syntheticPad.buttons[7] = {
        value: values.rt ?? 0,
        pressed: (values.rt ?? 0) > 0.5,
      };
      window.__syntheticPad.buttons[6] = {
        value: values.lt ?? 0,
        pressed: (values.lt ?? 0) > 0.5,
      };
    }, values);
    await page.waitForTimeout(150);
  };
  await page.waitForFunction(
    () => window.__game.input.diagnostics().activeIndex === 2,
  );
  assert.equal(
    (await state()).screen,
    "main",
    "An exposed idle controller is detected without activating the menu",
  );
  for (let i = 0; i < 3; i++) await press(13);
  await press(0);
  assert.equal((await state()).screen, "diagnostics");
  await analog({ rt: 0.52, lt: 0.28, steer: 0.6 });
  const diag = await page.evaluate(() => window.__game.input.diagnostics());
  assert.ok(diag.processed.throttle > 0.49 && diag.processed.throttle < 0.51);
  assert.ok(diag.processed.brake > 0.24 && diag.processed.brake < 0.26);
  assert.equal(diag.activeIndex, 2);
  await analog({});
  await press(1);
  assert.equal((await state()).screen, "main");
  for (let i = 0; i < 4; i++) await press(13);
  await press(0);
  assert.equal((await state()).screen, "settings");
  const deadzone = await page.evaluate(
    () => window.__game.input.settings.deadzone,
  );
  await press(15);
  assert.ok(
    (await page.evaluate(() => window.__game.input.settings.deadzone)) >
      deadzone,
  );
  await press(1);
  await press(0);
  assert.equal((await state()).screen, null);
  await analog({ rt: 0.4 });
  await page.waitForTimeout(900);
  assert.ok((await state()).speed > 1);
  await page.evaluate(() => (window.__syntheticPad.connected = false));
  await page.waitForTimeout(150);
  assert.equal(
    (await state()).screen,
    "pause",
    "disconnect pauses while accelerating",
  );
  await page.evaluate(() => {
    window.__syntheticPad.connected = true;
    window.__syntheticPad.buttons.forEach((b) => {
      b.value = 0;
      b.pressed = false;
    });
  });
  await press(0);
  assert.equal(
    (await state()).screen,
    "pause",
    "device selection does not resume",
  );
  await press(0);
  assert.equal((await state()).screen, null);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(100);
  assert.equal((await state()).screen, "pause");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(150);
  await press(0);
  assert.equal((await state()).screen, null);
  await press(9);
  await press(13);
  await press(0);
  assert.equal((await state()).race, true);
  assert.ok((await state()).countdown > 0);
  const finish = await page.evaluate(() => window.__game.driveAI(650));
  assert.equal(finish.finished, true);
  assert.equal(finish.lap, 3);
  assert.equal(finish.checkpoint, finish.routePoints);
  assert.equal(finish.screen, "results");
  await page.screenshot({ path: "docs/browser-race-results.png" });
  const finishText = await page.locator("#menu").innerText();
  await press(0);
  const restarted = await state();
  assert.equal(restarted.finished, false);
  assert.equal(restarted.lap, 1);
  assert.equal(restarted.checkpoint, 1);
  assert.ok(restarted.countdown > 0);
  await press(9);
  await press(13);
  await press(13);
  await press(0);
  const home = await state();
  assert.equal(home.race, false);
  assert.equal(home.screen, null);
  const homeAnchor = await page.evaluate(
    async () => (await (await fetch("/map/warwick.json")).json()).home.position,
  );
  assert.ok(
    Math.hypot(
      home.position[0] - homeAnchor[0],
      home.position[2] - homeAnchor[2],
    ) < 2,
  );
  await page.evaluate(() =>
    window.__game.input.updateSettings({ deadzone: 0.12 }),
  );
  assert.deepEqual(errors, []);
  await mkdir("docs", { recursive: true });
  const report = {
    date: new Date().toISOString(),
    browser: await browser.version(),
    viewport: { width: 1920, height: 1080 },
    input:
      "Synthetic Gamepad API snapshots at index2; no physical controller evidence",
    checks: [
      "nonzero device selection and confirmation consumption",
      "diagnostics partial simultaneous analog triggers",
      "controller-only settings slider",
      "controller acceleration",
      "unplug pause and deliberate reconnect resume",
      "blur/focus pause and deliberate resume",
      "controller-only race start",
      "full actual-physics 3-lap race with 777 ordered gates",
      "controller-only results restart",
      "controller-only Return Home exits race",
    ],
    finish: {
      lap: finish.lap,
      checkpoint: finish.checkpoint,
      routePoints: finish.routePoints,
      result: finishText,
    },
    errors,
  };
  await writeFile(
    "docs/browser-verification.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
