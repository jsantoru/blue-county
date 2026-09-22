/** Regression for overlapping controller inputs; synthetic pad, actual game loop. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(30000);
const report = {
  date: new Date().toISOString(),
  methodology:
    "Synthetic Gamepad API input through the real render loop. Right stick stays at 0.22 throughout: it never reaches neutral. Walking and driving are actual physics; each return-to-door fixture restores the previously observed exit position. No physical controller or rumble verification is claimed.",
  checks: [],
  cycles: [],
  errors: [],
};
page.on("pageerror", (error) => report.errors.push(error.message));
page.on("response", (response) => {
  if (response.status() >= 400)
    report.errors.push(`${response.status()} ${response.url()}`);
});
const frames = (count = 6) =>
  page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
  }, count);
const state = () => page.evaluate(() => window.__game.getState());
const button = (index, value) =>
  page.evaluate(
    ({ index, value }) => {
      window.__transitionPad.buttons[index] = { value, pressed: value > 0.5 };
    },
    { index, value },
  );
const axis = (index, value) =>
  page.evaluate(
    ({ index, value }) => {
      window.__transitionPad.axes[index] = value;
    },
    { index, value },
  );
const press = async (index) => {
  await button(index, 1);
  await frames();
  await button(index, 0);
  await frames();
};
const phase = (name) =>
  page.waitForFunction(
    (name) => window.__game.getState().exploration.phase === name,
    name,
  );
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

try {
  await page.addInitScript(() => {
    window.__transitionPad = {
      id: "Synthetic overlap regression — not physical hardware",
      index: 2,
      mapping: "standard",
      connected: true,
      axes: [0, 0, 0.22, 0],
      buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })),
    };
    Object.defineProperty(navigator, "getGamepads", {
      value: () => [
        null,
        null,
        window.__transitionPad.connected ? window.__transitionPad : null,
      ],
    });
  });
  await page.goto(
    `${process.env.GAME_URL || "http://127.0.0.1:5180"}/?test&revision=controller-overlap`,
  );
  await page.waitForFunction(() => window.__game?.getState().ready);
  report.bundle = await page
    .locator('script[type="module"]')
    .getAttribute("src");
  await frames();
  assert.equal(
    await page.evaluate(() => window.__game.input.diagnostics().activeIndex),
    2,
  );
  report.checks.push(
    "Exposed controller detected without any button or right-stick gesture",
  );
  await press(0);
  assert.equal((await state()).screen, null);
  report.checks.push(
    "First fresh A starts Home despite persistent right-stick offset",
  );

  for (let cycle = 0; cycle < 3; cycle++) {
    if (cycle) {
      await page.evaluate(() => window.__game.startFree());
      await frames();
    }
    await page.waitForFunction(() => window.__game.getState().grounded >= 3);
    await button(3, 1);
    await phase("exiting");
    const exit = await state();
    await axis(1, -0.8);
    await phase("foot");
    await frames(12);
    const walking = await state();
    assert(
      distance(exit.exploration.position, walking.exploration.position) > 0.1,
      "Held left stick must walk immediately after exiting while Y is still held",
    );
    assert.equal(walking.exploration.phase, "foot");
    await button(3, 0);
    await axis(1, 0);
    await frames();
    await page.evaluate(
      ({ position, yaw }) => window.__game.setFootPosition(position, yaw),
      exit.exploration,
    );
    await page.waitForFunction(
      () => window.__game.getState().exploration.interaction.available,
    );
    await button(3, 1);
    await phase("entering");
    await button(7, 0.85);
    const entering = await state();
    await phase("driving");
    await frames(40);
    const driving = await state();
    const traveled = distance(entering.position, driving.position);
    assert(
      traveled > 0.3,
      "RT held during entry must drive as soon as entry finishes",
    );
    assert.equal(driving.exploration.phase, "driving");
    const diag = await page.evaluate(() => window.__game.input.diagnostics());
    assert.equal(diag.rawAxes[2], 0.22);
    report.cycles.push({
      cycle: cycle + 1,
      walked: distance(exit.exploration.position, walking.exploration.position),
      driven: traveled,
      rightStick: diag.rawAxes[2],
    });
    await button(3, 0);
    await button(7, 0);
    await frames();
  }
  report.checks.push(
    "Three exits accept overlapping held Y/left stick without a neutral frame",
    "Three entries accept RT held before completion without re-pressing",
    "Held Y never reverses the transfer; right-stick offset never blocks locomotion",
  );

  await button(7, 1);
  await frames();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await frames();
  assert.equal((await state()).screen, "pause");
  const paused = await state();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await frames(15);
  assert.equal((await state()).screen, "pause");
  assert(distance(paused.position, (await state()).position) < 0.001);
  await button(7, 0);
  await press(0);
  assert.equal((await state()).screen, null);
  report.checks.push(
    "Focus loss still pauses until explicit Resume; drift does not block Resume",
  );

  await page.evaluate(() => {
    window.__transitionPad.connected = false;
  });
  await frames();
  assert.equal((await state()).screen, "pause");
  await page.evaluate(() => {
    window.__transitionPad.connected = true;
  });
  await frames();
  assert.equal(
    await page.evaluate(() => window.__game.input.diagnostics().activeIndex),
    2,
  );
  assert.equal((await state()).screen, "pause");
  await press(0);
  assert.equal((await state()).screen, null);
  report.checks.push(
    "Reconnect is detected automatically and still requires deliberate Resume",
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
    "docs/controller-transition-verification.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
