/** Real UI, controller, asset and transfer regression for the Lug Nuts garage. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import * as T from "three";

const base = process.env.GAME_URL || "http://127.0.0.1:5180";
const output = "output/playwright/lug-nuts";
const focusOnly = process.env.GARAGE_FOCUS_ONLY === "1";
const reportPath = `${output}/${focusOnly ? "focus-interruption" : "verification"}.json`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(45000);
const report = {
  date: new Date().toISOString(),
  methodology: focusOnly
    ? "Focused production-game check in system Edge using actual garage clicks, a delayed Lou GLB request, and browser blur/focus events. Confirms that focus loss prevents the delayed load from starting gameplay and that an explicit retry succeeds. This focused run does not exercise the full five-member driving flow or physical controller hardware."
    : "Production game in system Edge with actual menu clicks, keyboard events and synthetic standard Gamepad API snapshots. Every car drives, exits, walks away, walks back and re-enters through the actual render loop and physics. No movement simulation or placement hooks are used. Inspection views only frame screenshots. Distinct delivered GLBs are SHA-256 checked, with live geometry/character and steering-grip measurements. This does not claim physical controller or rumble verification.",
  checks: [],
  members: [],
  screenshots: [],
  errors: [],
  warnings: [],
};
const loadedModels = new Set();
page.on("pageerror", (error) => report.errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") report.errors.push(message.text());
  if (message.type() === "warning") report.warnings.push(message.text());
});
page.on("response", (response) => {
  if (response.status() >= 400)
    report.errors.push(`${response.status()} ${response.url()}`);
  if (response.url().endsWith(".glb") && response.ok())
    loadedModels.add(new URL(response.url()).pathname);
});
const frames = (count = 6) =>
  page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
  }, count);
const state = () => page.evaluate(() => window.__game.getState());
const detail = () => page.evaluate(() => window.__game.heroDetails());
const phase = (value) =>
  page.waitForFunction(
    (value) => window.__game.getState().exploration.phase === value,
    value,
  );
const button = (index, value) =>
  page.evaluate(
    ({ index, value }) => {
      window.__clubPad.buttons[index] = { value, pressed: value > 0.5 };
    },
    { index, value },
  );
const axes = (x = 0, y = 0) =>
  page.evaluate(
    ({ x, y }) => {
      window.__clubPad.axes[0] = x;
      window.__clubPad.axes[1] = y;
    },
    { x, y },
  );
const press = async (index) => {
  await button(index, 1);
  await frames(4);
  await button(index, 0);
  await frames(4);
};
const key = async (value) => {
  await page.keyboard.down(value);
  await frames(4);
  await page.keyboard.up(value);
  await frames(4);
};
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const shot = async (name) => {
  const file = `${output}/${name}.png`;
  await page.screenshot({ path: file });
  report.screenshots.push(file);
  return file;
};
const openGarage = async () => {
  const currentMember = (await state()).club.member;
  if ((await state()).screen === null) await press(9);
  await page.getByRole("button", { name: /The Lug Nuts/ }).click();
  await page.waitForFunction(
    () => window.__game.getState().screen === "garage",
  );
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll(".garage-car-image img, .garage-member img"),
    ].every((image) => image.complete && image.naturalWidth > 0),
  );
  assert.equal(
    (await state()).club.garageChoice,
    currentMember,
    "Opening the garage must highlight the current member",
  );
};
const carScreenshot = async (id) => {
  await page.evaluate(() => {
    const g = window.__game,
      s = g.getState();
    const [x, y, z, w] = s.rotation;
    const yaw = Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
    const local = (side, height, front) => [
      s.position[0] + Math.cos(yaw) * side + Math.sin(yaw) * front,
      s.position[1] + height,
      s.position[2] - Math.sin(yaw) * side + Math.cos(yaw) * front,
    ];
    g.inspectView(local(4.2, 2.1, 5.8), local(0, 0.5, 0));
    document.getElementById("toast").style.visibility = "hidden";
  });
  await frames(5);
  const file = await shot(`${id}-car`);
  await page.evaluate(() => {
    window.__game.clearInspectionView();
    document.getElementById("toast").style.visibility = "";
  });
  return file;
};
const verifyGrips = (hero, manifest, steering) => {
  const wheel = manifest.steeringWheel;
  const center = new T.Vector3(...wheel.center);
  const axis = new T.Vector3(...wheel.axis).normalize();
  const results = [];
  for (const [name, side] of [
    ["left", 1],
    ["right", -1],
  ]) {
    const expected = new T.Vector3(side * (wheel.radius - 0.031), 0, 0)
      .applyAxisAngle(axis, Math.max(-0.55, Math.min(0.55, steering)) * 1.7)
      .add(center)
      .addScaledVector(axis, 0.025);
    const actual = new T.Vector3(...hero.steeringWheel.hands[name]);
    const error = actual.distanceTo(expected);
    assert(
      error < 0.035,
      `${hero.model.memberId} ${name} wrist must meet this car's tilted rim (${error}m)`,
    );
    results.push({ hand: name, error, position: actual.toArray() });
  }
  return results;
};

const verifyFocusInterruptedLoading = async () => {
  const interrupted = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  interrupted.setDefaultTimeout(45000);
  let releaseModel;
  const release = new Promise((resolve) => {
    releaseModel = resolve;
  });
  let markRequested;
  const modelRequested = new Promise((resolve) => {
    markRequested = resolve;
  });
  interrupted.on("pageerror", (error) =>
    report.errors.push(`Focus-interruption page: ${error.message}`),
  );
  await interrupted.route("**/assets/club-cars/lou.glb", async (route) => {
    markRequested();
    await release;
    await route.continue();
  });
  try {
    await interrupted.goto(
      `${base}/?test&revision=lug-nuts-focus-interruption`,
    );
    await interrupted.waitForFunction(() => window.__game?.getState().ready);
    report.focusInterruption = {
      date: new Date().toISOString(),
      bundle: await interrupted
        .locator('script[type="module"]')
        .getAttribute("src"),
    };
    await interrupted.getByRole("button", { name: /The Lug Nuts/ }).click();
    await interrupted.locator('.garage-member[data-member="lou"]').click();
    await interrupted.locator(".garage-drive").click();
    await modelRequested;
    await interrupted.waitForFunction(() => window.__game.getState().club.busy);
    await interrupted.evaluate(() => window.dispatchEvent(new Event("blur")));
    await interrupted.waitForFunction(
      () => !window.__game.getState().club.busy,
    );
    let current = await interrupted.evaluate(() => window.__game.getState());
    assert.equal(current.screen, "garage");
    assert.equal(current.club.member, "joe");
    assert.match(
      await interrupted.locator(".garage-panel").innerText(),
      /Loading interrupted/i,
    );
    const delivered = interrupted.waitForResponse((response) =>
      response.url().endsWith("/lou.glb"),
    );
    releaseModel();
    await delivered;
    await interrupted.waitForTimeout(750);
    current = await interrupted.evaluate(() => window.__game.getState());
    assert.equal(
      current.screen,
      "garage",
      "Completing a delayed load must not resume after focus loss",
    );
    assert.equal(
      current.club.member,
      "joe",
      "Completing an interrupted load must not silently swap cars",
    );
    const file = `${output}/focus-interrupted-pending-load.png`;
    await interrupted.screenshot({ path: file });
    report.screenshots.push(file);
    await interrupted.evaluate(() => window.dispatchEvent(new Event("focus")));
    await interrupted.locator(".garage-drive").click();
    await interrupted.waitForFunction(() => {
      const state = window.__game.getState();
      return (
        state.club.member === "lou" && state.screen === null && !state.club.busy
      );
    });
    current = await interrupted.evaluate(() => window.__game.getState());
    assert.equal(current.exploration.phase, "driving");
    assert.equal(
      await interrupted.evaluate(
        () => window.__game.heroDetails().model.memberId,
      ),
      "lou",
    );
    report.focusInterruption.retryMember = current.club.member;
    report.focusInterruption.passed = true;
    report.checks.push(
      "Focus loss interrupts a pending Lou load; its eventual completion keeps Joe in the garage, and an explicit Drive retry loads Lou successfully",
    );
  } finally {
    releaseModel();
    await interrupted.close();
  }
};

try {
  if (!focusOnly) {
    await page.addInitScript(() => {
      window.__clubPad = {
        id: "Synthetic Lug Nuts regression — not physical hardware",
        index: 2,
        mapping: "standard",
        connected: true,
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({
          value: 0,
          pressed: false,
        })),
      };
      Object.defineProperty(navigator, "getGamepads", {
        value: () => [null, null, window.__clubPad],
      });
    });
    await page.goto(`${base}/?test&revision=lug-nuts-garage`);
    await page.waitForFunction(() => window.__game?.getState().ready);
    report.bundle = await page
      .locator('script[type="module"]')
      .getAttribute("src");
    assert.equal((await state()).club.member, "joe");

    await openGarage();
    assert.equal(await page.locator(".garage-member").count(), 5);
    assert.match(
      await page.locator(".garage-disclosure").innerText(),
      /stand-in characters/,
    );
    await shot("garage-joe-initial");
    report.layouts = [];
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await frames(5);
      const layout = await page.evaluate(() => {
        const panel = document.querySelector(".garage-panel");
        const bounds = panel.getBoundingClientRect();
        return {
          viewport: [innerWidth, innerHeight],
          left: bounds.left,
          right: bounds.right,
          contentWidth: panel.scrollWidth,
          visibleWidth: panel.clientWidth,
          documentWidth: document.documentElement.scrollWidth,
        };
      });
      assert(
        layout.left >= -1 && layout.right <= viewport.width + 1,
        "Garage panel must fit viewport width",
      );
      assert(
        layout.contentWidth <= layout.visibleWidth + 1,
        "Garage content must not overflow sideways",
      );
      await shot(`garage-${viewport.width}x${viewport.height}`);
      await page.locator(".garage-drive").scrollIntoViewIfNeeded();
      const driveBounds = await page.locator(".garage-drive").boundingBox();
      assert(
        driveBounds &&
          driveBounds.y >= 0 &&
          driveBounds.y + driveBounds.height <= viewport.height + 1,
        "Drive action must remain reachable on compact screens",
      );
      report.layouts.push(layout);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => {
      document.querySelector(".garage-panel").scrollTop = 0;
      document.getElementById("menu").scrollTop = 0;
    });
    await frames(5);
    report.checks.push(
      "Garage fits 1280×720 and 390×844 widths, and its Drive action stays reachable by scrolling",
    );
    await key("ArrowLeft");
    assert.equal((await state()).club.garageChoice, "ed");
    await key("ArrowRight");
    await key("ArrowRight");
    assert.equal((await state()).club.garageChoice, "lou");
    await key("Enter");
    assert.equal((await state()).screen, "garage");
    assert.equal((await state()).club.member, "joe");
    await key("Escape");
    assert.equal((await state()).screen, "main");
    assert.equal((await state()).club.member, "joe");
    report.checks.push(
      "Keyboard arrows wrap the five-member roster; selecting a profile and cancelling preserves Joe",
    );

    await openGarage();
    await press(15);
    assert.equal((await state()).club.garageChoice, "lou");
    await press(0);
    assert.equal((await state()).club.member, "joe");
    await press(1);
    assert.equal((await state()).screen, "main");
    report.checks.push(
      "Controller D-pad/A navigates and selects; B cancels without replacing the active driver or car",
    );

    for (const [i, id] of ["joe", "lou", "chris", "craig", "ed"].entries()) {
      await openGarage();
      if (id === "lou") {
        await press(15); // Joe -> Lou, real controller menu flow.
        assert.equal((await state()).club.garageChoice, id);
        await press(0);
        await shot(`${id}-garage`);
        await press(0);
      } else if (id === "chris") {
        await key("ArrowRight"); // Lou -> Chris, real keyboard menu flow.
        assert.equal((await state()).club.garageChoice, id);
        await key("Enter");
        await shot(`${id}-garage`);
        await key("Enter");
      } else {
        await page.locator(`.garage-member[data-member="${id}"]`).click();
        await shot(`${id}-garage`);
        await page.locator(".garage-drive").click();
      }
      await page.waitForFunction((id) => {
        const s = window.__game.getState();
        return s.club.member === id && s.screen === null && !s.club.busy;
      }, id);
      await page.waitForFunction(() => window.__game.getState().grounded >= 3);
      await frames(8);
      const selected = await state(),
        hero = await detail();
      assert.equal(selected.exploration.phase, "driving");
      assert.equal(selected.exploration.driver.seated, true);
      assert.equal(hero.model.memberId, id);
      assert.equal(hero.model.provisional, id !== "joe");
      assert(
        loadedModels.has(selected.club.asset),
        `Selected ${id} model must actually have loaded`,
      );
      const asset = await page.request.get(`${base}${selected.club.asset}`);
      assert(asset.ok());
      const hash = createHash("sha256")
        .update(await asset.body())
        .digest("hex");
      const manifestURL =
        id === "joe"
          ? "/assets/vehicle-manifest.json"
          : `/assets/club-cars/${id}-manifest.json`;
      const manifestResponse = await page.request.get(`${base}${manifestURL}`);
      assert(manifestResponse.ok());
      const manifest = await manifestResponse.json();
      assert.equal(
        hero.vehicle.name,
        manifest.name,
        "Live car metadata must match the selected asset manifest",
      );
      const grips = verifyGrips(hero, manifest, selected.steering);
      const head = hero.bonesCarLocal.head;
      assert(head.every(Number.isFinite));
      assert(head[0] > 0.15, `${id} must sit on the US-left side`);
      assert(
        head[1] > selected.club.seatAnchor[1] + 1.1,
        `${id} seated head must remain above the seat`,
      );
      const result = {
        member: id,
        name: selected.club.name,
        car: selected.club.car,
        asset: selected.club.asset,
        sha256: hash,
        vehicle: hero.vehicle,
        geometry: selected.club.geometry,
        character: hero.model,
        seatAnchor: selected.club.seatAnchor,
        headCarLocal: head,
        grips,
        screenshot: await carScreenshot(id),
      };

      const beforeDrive = await state();
      await button(7, 0.65);
      await frames(28);
      await button(7, 0);
      await button(6, 0.85);
      await page.waitForFunction(
        () => Math.abs(window.__game.getState().speed) < 0.28,
      );
      await button(6, 0);
      await frames(8);
      const parked = await state();
      result.drivenDistance = distance(beforeDrive.position, parked.position);
      assert(result.drivenDistance > 0.25, `${id}'s car must drive under RT`);
      await page.waitForFunction(
        () => window.__game.getState().exploration.interaction.available,
      );
      await press(3);
      await phase("foot");
      await frames(25);
      const exited = await state(),
        onFoot = await detail();
      assert.equal(onFoot.model.memberId, id);
      assert.equal(exited.exploration.driver.seated, false);
      assert.equal(exited.exploration.driver.visible, true);
      const cameraDirection = new T.Vector3()
        .fromArray(exited.camera.target)
        .sub(new T.Vector3().fromArray(exited.camera.position))
        .setY(0)
        .normalize();
      const cameraRight = new T.Vector3(
        -cameraDirection.z,
        0,
        cameraDirection.x,
      );
      const outward = new T.Vector3()
        .fromArray(exited.exploration.position)
        .sub(new T.Vector3().fromArray(exited.position))
        .setY(0);
      const stick = Math.sign(outward.dot(cameraRight)) * 0.65;
      await axes(stick, 0);
      await frames(24);
      await axes();
      await frames(10);
      const walked = await state();
      result.walkedDistance = distance(
        exited.exploration.position,
        walked.exploration.position,
      );
      assert(
        result.walkedDistance > 0.2,
        `${id} must walk independently of the car`,
      );
      assert(
        distance(exited.position, walked.position) < 0.03,
        `${id}'s parked car must remain parked`,
      );
      result.onFootScreenshot = await shot(`${id}-on-foot`);

      // Walk back to the previously observed door through normal controller input.
      for (let attempt = 0; attempt < 10; attempt++) {
        const s = await state();
        if (
          distance(s.exploration.position, exited.exploration.position) < 0.065
        )
          break;
        const delta = new T.Vector3()
          .fromArray(exited.exploration.position)
          .sub(new T.Vector3().fromArray(s.exploration.position))
          .setY(0);
        const f = new T.Vector3()
          .fromArray(s.camera.target)
          .sub(new T.Vector3().fromArray(s.camera.position))
          .setY(0)
          .normalize();
        const r = new T.Vector3(-f.z, 0, f.x);
        const strength = Math.min(0.65, 0.24 + delta.length() * 0.55);
        delta.normalize();
        await axes(delta.dot(r) * strength, -delta.dot(f) * strength);
        await frames(10);
      }
      await axes();
      await frames(12);
      const returned = await state();
      result.returnDistance = distance(
        exited.exploration.position,
        returned.exploration.position,
      );
      assert(
        returned.exploration.interaction.available,
        `${id} should be able to re-enter after walking back (${result.returnDistance}m from the exit)`,
      );
      await press(3);
      await phase("driving");
      await frames(12);
      const reentered = await state();
      assert.equal(reentered.exploration.driver.seated, true);
      assert.equal((await detail()).model.memberId, id);
      verifyGrips(await detail(), manifest, reentered.steering);
      assert.equal(
        await page.evaluate(() =>
          document.querySelector("#game").getContext("webgl2").getError(),
        ),
        0,
      );
      report.members.push(result);
      console.log(
        `Verified ${i + 1}/5: ${selected.club.name} — ${selected.club.car}`,
      );
    }
    assert.equal(
      new Set(report.members.map((member) => member.sha256)).size,
      5,
      "Five selected members must load five distinct delivered car GLBs",
    );
    assert.equal(
      new Set(
        report.members.map((member) =>
          member.vehicle.bounds.map((n) => n.toFixed(2)).join(","),
        ),
      ).size,
      5,
      "Live scene geometry should distinguish all five car bodies",
    );
    report.checks.push(
      "All five drivers load distinct car GLBs and live geometry, fit US-left seats and steering rims, drive, exit, walk and re-enter",
    );
    report.checks.push(
      "Lou can be committed with controller D-pad/A, Chris with keyboard arrows/Enter, and the remaining members with mouse selection",
    );

    await openGarage();
    await page.locator('.garage-member[data-member="craig"]').click();
    await page.locator(".garage-back").click();
    assert.equal((await state()).club.member, "ed");
    await page.reload();
    await page.waitForFunction(() => window.__game?.getState().ready);
    const restored = await state();
    assert.equal(restored.club.member, "ed");
    assert.equal(restored.club.car, "Buick Woody Wagon");
    assert.equal((await detail()).model.memberId, "ed");
    await shot("persisted-ed-main-menu");
    await page.getByRole("button", { name: /Drive from Home/ }).click();
    await page.waitForFunction(() => window.__game.getState().screen === null);
    assert.equal((await state()).club.member, "ed");
    report.checks.push(
      "Cancelling a new profile preserves Ed; reload restores Ed, his Buick and his character and can start driving normally",
    );

    await page.evaluate(() => window.__game.startRace());
    await page.waitForFunction(() => {
      const s = window.__game.getState();
      return s.race && s.countdown <= 0 && s.screen === null;
    });
    const raceStart = await state();
    assert.equal(raceStart.club.member, "ed");
    assert.equal(raceStart.exploration.phase, "driving");
    assert(raceStart.ai.length >= 3);
    await button(7, 0.75);
    await frames(35);
    await button(7, 0);
    const racing = await state();
    assert(
      distance(raceStart.position, racing.position) > 0.4,
      "Selected Buick must drive after the race countdown",
    );
    report.race = {
      member: racing.club.member,
      drivenDistance: distance(raceStart.position, racing.position),
      aiCount: racing.ai.length,
    };
    report.checks.push(
      "The selected Buick survives race setup and drives after the countdown with rivals present",
    );

    const delayed = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    delayed.setDefaultTimeout(45000);
    let releaseModel;
    const release = new Promise((resolve) => {
      releaseModel = resolve;
    });
    let markRequested;
    const modelRequested = new Promise((resolve) => {
      markRequested = resolve;
    });
    delayed.on("pageerror", (error) =>
      report.errors.push(`Cancel-load page: ${error.message}`),
    );
    await delayed.route("**/assets/club-cars/lou.glb", async (route) => {
      markRequested();
      await release;
      await route.continue();
    });
    try {
      await delayed.goto(`${base}/?test&revision=lug-nuts-cancel-loading`);
      await delayed.waitForFunction(() => window.__game?.getState().ready);
      await delayed.getByRole("button", { name: /The Lug Nuts/ }).click();
      await delayed.locator('.garage-member[data-member="lou"]').click();
      await delayed.locator(".garage-drive").click();
      await modelRequested;
      await delayed.waitForFunction(() => window.__game.getState().club.busy);
      await delayed.locator(".garage-back").click();
      assert.equal(
        await delayed.evaluate(() => window.__game.getState().screen),
        "main",
      );
      const delivered = delayed.waitForResponse((response) =>
        response.url().endsWith("/lou.glb"),
      );
      releaseModel();
      await delivered;
      await delayed.waitForTimeout(750);
      assert.equal(
        await delayed.evaluate(() => window.__game.getState().club.member),
        "joe",
      );
      assert.equal(
        await delayed.evaluate(() => window.__game.getState().screen),
        "main",
      );
      const file = `${output}/cancelled-pending-load.png`;
      await delayed.screenshot({ path: file });
      report.screenshots.push(file);
      report.checks.push(
        "Cancelling Lou while his GLB is still loading keeps Joe active when the delayed request finishes",
      );
    } finally {
      releaseModel();
      await delayed.close();
    }
  }
  await verifyFocusInterruptedLoading();
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack ?? String(error);
  report.lastState = await state().catch(() => null);
  report.lastInput = await page
    .evaluate(() => window.__game.input.diagnostics())
    .catch(() => null);
  await shot("failure").catch(() => {});
  throw error;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  await browser.close();
}
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      checks: report.checks,
      members: report.members.map((member) => member.member),
      errors: report.errors,
      report: reportPath,
    },
    null,
    2,
  ),
);
