/** Real keyboard/mouse plus explicit synthetic-pad and fixed-step exploration checks. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const secondPass = process.argv.includes("--second-pass");
const pass = secondPass ? "second" : "first";
const url = process.env.GAME_URL || "http://127.0.0.1:5180";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
page.setDefaultTimeout(30000);
const report = {
  date: new Date().toISOString(),
  pass,
  browser: await browser.version(),
  viewport: [1920, 1080],
  checks: [],
  screenshots: [],
  errors: [],
  warnings: [],
  methodology:
    "Keyboard and mouse actions exercise the real render-loop input. Synthetic Gamepad API snapshots verify software mappings and safety only, not physical hardware feel or rumble. Fixed-step hooks exercise the actual pedestrian and world physics for deterministic comparisons and distant collision samples. Screenshots require separate visual review.",
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

const state = () => page.evaluate(() => window.__game.getState());
const horizontal = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const finiteState = (snapshot) => {
  for (const values of [
    snapshot.position,
    snapshot.camera.position,
    snapshot.camera.target,
    snapshot.exploration.position,
    snapshot.exploration.velocity,
  ])
    assert(
      values.every(Number.isFinite),
      "Player and camera transforms must remain finite",
    );
};
const frames = (count = 4) =>
  page.evaluate(async (count) => {
    for (let n = 0; n < count; n++) await new Promise(requestAnimationFrame);
  }, count);
async function key(code, heldMs = 90) {
  await page.keyboard.down(code);
  await page.waitForTimeout(heldMs);
  await frames(3);
  await page.keyboard.up(code);
  await frames(4);
}
async function expectPhase(phase) {
  await page.waitForFunction(
    (phase) => window.__game.getState().exploration.phase === phase,
    phase,
  );
  await frames(5);
  const snapshot = await state();
  finiteState(snapshot);
  return snapshot;
}
async function capture(name) {
  await frames(6);
  const snapshot = await state();
  finiteState(snapshot);
  const glError = await page.evaluate(() =>
    document.querySelector("#game").getContext("webgl2").getError(),
  );
  assert.equal(glError, 0, `${name}: WebGL error`);
  const path = `docs/exploration-${pass}-${name}.png`;
  await page.screenshot({ path });
  report.screenshots.push({ path, state: snapshot });
}
async function footAt(x, z, yaw = 0) {
  await page.evaluate(
    ({ x, z, yaw }) => {
      const g = window.__game;
      g.pause();
      g.setFootPosition([x, g.surfaceAt(x, z) + 0.08, z], yaw);
      g.simulateFoot(
        { moveX: 0, moveY: 0, sprint: false, jump: false },
        0.5,
        yaw,
      );
      g.resume();
    },
    { x, z, yaw },
  );
  await frames(8);
  return state();
}
async function startHome() {
  await page.evaluate(() => window.__game.startFree());
  await expectPhase("driving");
  await page.waitForFunction(() => window.__game.getState().grounded >= 3);
  await frames(6);
}
async function installPad() {
  await page.evaluate(() => {
    window.__explorationPad = {
      id: "AUTOMATED EXPLORATION PAD — NOT PHYSICAL",
      index: 2,
      mapping: "standard",
      connected: true,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })),
    };
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [
        null,
        null,
        window.__explorationPad.connected ? window.__explorationPad : null,
      ],
    });
  });
}
async function padButton(index, holdFrames = 4) {
  await page.evaluate(
    ({ index }) => {
      window.__explorationPad.buttons[index] = { value: 1, pressed: true };
    },
    { index },
  );
  await frames(holdFrames);
  await page.evaluate(
    ({ index }) => {
      window.__explorationPad.buttons[index] = { value: 0, pressed: false };
    },
    { index },
  );
  await frames(5);
}

try {
  await page.goto(`${url}/?test&exploration-review=${pass}`);
  await page.waitForFunction(() => window.__game?.getState().ready, undefined, {
    timeout: 90000,
  });
  await page.getByRole("button", { name: "Drive from Home" }).click();
  await expectPhase("driving");
  await page.waitForFunction(() => window.__game.getState().grounded >= 3);
  await frames(12);
  const seated = await state();
  assert(
    seated.exploration.driver.visible && seated.exploration.driver.seated,
    "The driver must be visible in the US seat",
  );
  report.seated = seated.exploration;
  report.gpu = await page.evaluate(() => {
    const gl = document.querySelector("#game").getContext("webgl2"),
      ext = gl.getExtension("WEBGL_debug_renderer_info");
    return gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  });
  await capture("seated-driver");
  await page.evaluate(() => {
    const g = window.__game,
      s = g.getState(),
      seat = s.exploration.driver.seatWorld;
    const [x, y, z, w] = s.rotation;
    const heading = Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
    g.pause();
    document.getElementById("menu").style.visibility = "hidden";
    g.inspectView(
      [
        s.position[0] + Math.cos(heading) * 3.1 + Math.sin(heading) * 1.6,
        s.position[1] + 1.6,
        s.position[2] - Math.sin(heading) * 3.1 + Math.cos(heading) * 1.6,
      ],
      [seat[0], seat[1] + 0.95, seat[2]],
    );
  });
  await capture("driver-seat-detail");
  await page.evaluate(() => {
    document.getElementById("menu").style.visibility = "";
    window.__game.clearInspectionView();
    window.__game.resume();
  });
  await frames(8);

  await page.keyboard.down("KeyF");
  const exited = await expectPhase("foot");
  await page.waitForTimeout(800);
  assert.equal(
    (await state()).exploration.phase,
    "foot",
    "Held F must not immediately enter again",
  );
  await page.keyboard.up("KeyF");
  await frames(6);
  assert(
    exited.exploration.driver.visible && !exited.exploration.driver.seated,
  );
  assert(
    horizontal(exited.exploration.position, exited.position) > 1.1,
    "Exit must clear the chassis",
  );
  const exitFeet = exited.exploration.position;
  report.checks.push("Real keyboard exit and held-F transition debounce");
  await capture("first-exit");
  if (secondPass) {
    report.parkedCarCollision = await page.evaluate(() => {
      const g = window.__game,
        initial = g.getState(),
        start = initial.exploration.position;
      const yaw = initial.exploration.yaw,
        idle = { moveX: 0, moveY: 0, sprint: false, jump: false };
      g.pause();
      const path = [];
      for (let n = 0; n < 90; n++) {
        g.simulateFoot({ ...idle, moveX: 1 }, 1 / 60, yaw);
        const s = g.getState();
        const dx = s.exploration.position[0] - s.position[0],
          dz = s.exploration.position[2] - s.position[2];
        path.push({
          position: s.exploration.position,
          localSide: dx * Math.cos(yaw) - dz * Math.sin(yaw),
        });
      }
      const after = g.getState();
      g.setFootPosition(start, yaw);
      g.simulateFoot(idle, 0.3, yaw);
      g.resume();
      return { initialCar: initial.position, finalCar: after.position, path };
    });
    assert(
      report.parkedCarCollision.path.every((sample) => sample.localSide > 1.16),
      "Walking toward the parked car must stop outside its chassis",
    );
    assert(
      horizontal(
        report.parkedCarCollision.initialCar,
        report.parkedCarCollision.finalCar,
      ) < 0.005,
      "Walking into the parked car must not push it",
    );
    report.checks.push(
      "Independent second pass: walking directly into the parked chassis is blocked without moving the car",
    );
  }

  const beforeWalk = await state();
  await key("KeyW", 1100);
  const afterWalk = await state();
  const distance = horizontal(
    beforeWalk.exploration.position,
    afterWalk.exploration.position,
  );
  assert(
    distance > 1.5 && distance < 5,
    `Real keyboard walk distance ${distance}`,
  );
  assert(
    horizontal(beforeWalk.position, afterWalk.position) < 0.025,
    "Parked car must stay still while walking",
  );
  report.keyboardWalk = {
    distance,
    before: beforeWalk.exploration.position,
    after: afterWalk.exploration.position,
  };
  const jumpBase = (await state()).exploration.position[1];
  await page.keyboard.down("Space");
  const jumpSamples = await page.evaluate(async () => {
    const result = [],
      started = performance.now();
    while (performance.now() - started < 1550) {
      await new Promise(requestAnimationFrame);
      const s = window.__game.getState().exploration;
      result.push({
        position: s.position,
        grounded: s.grounded,
        velocity: s.velocity,
      });
    }
    return result;
  });
  await page.keyboard.up("Space");
  await frames(5);
  const apex = Math.max(...jumpSamples.map((s) => s.position[1])) - jumpBase;
  assert(apex > 0.65 && apex < 1.5, `Jump apex ${apex}`);
  assert(
    jumpSamples.at(-1).grounded,
    "Holding jump must still land rather than jumping repeatedly",
  );
  assert(jumpSamples.some((s) => !s.grounded && s.velocity[1] > 1));
  assert(jumpSamples.some((s) => !s.grounded && s.velocity[1] < -1));
  report.jump = { apex, samples: jumpSamples };
  report.checks.push(
    "Actual keyboard walk, single held jump, landing, and parked-car stability",
  );

  await footAt(exitFeet[0], exitFeet[2], exited.exploration.yaw);
  assert(
    (await state()).exploration.interaction.available,
    "Driver door must offer re-entry",
  );
  await key("KeyF");
  await expectPhase("driving");
  report.checks.push("Actual keyboard re-entry at the parked car");
  await key("KeyW", 1150);
  const driving = await state();
  assert(driving.speed > 2, "Re-entry must restore working throttle");
  await key("KeyF");
  assert.equal(
    (await state()).exploration.mode,
    "driving",
    "A moving car must reject unsafe exit",
  );
  report.checks.push(
    "Throttle restored after re-entry; moving-car exit rejected",
  );

  await startHome();
  await key("KeyF");
  await expectPhase("foot");
  await footAt(22, 0, Math.PI / 2);
  const mouseBefore = (await state()).exploration.cameraYaw;
  await page.mouse.move(1050, 400);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(1330, 445, { steps: 15 });
  await frames(5);
  await page.mouse.up({ button: "right" });
  await frames(5);
  report.mouse = {
    beforeYaw: mouseBefore,
    afterYaw: (await state()).exploration.cameraYaw,
  };
  assert(
    Math.abs((await state()).exploration.cameraYaw - mouseBefore) > 0.25,
    "Actual right-drag mouse events orbit the foot camera",
  );
  report.checks.push("Actual mouse right-drag orbit");
  if (secondPass) {
    await page.mouse.click(1050, 400);
    await page.waitForFunction(
      () => document.pointerLockElement?.id === "game",
    );
    const lockYaw = (await state()).exploration.cameraYaw;
    await page.mouse.move(1180, 440, { steps: 12 });
    await frames(7);
    assert(
      Math.abs((await state()).exploration.cameraYaw - lockYaw) > 0.1,
      "Pointer-locked mouse orbits the camera",
    );
    await key("Escape");
    assert.equal(
      (await state()).screen,
      "pause",
      "Escape releases mouse capture and pauses",
    );
    assert.equal(await page.evaluate(() => document.pointerLockElement), null);
    await page.getByRole("button", { name: /^Resume/ }).click();
    await frames(7);
    report.checks.push(
      "Independent second pass: pointer-lock mouse look and Escape release/pause",
    );
  }
  await footAt(22, 0, Math.PI / 2);
  await capture("backyard-lawn");

  report.collisions = await page.evaluate(() => {
    const g = window.__game,
      home = g.homeDetails();
    g.pause();
    const idle = { moveX: 0, moveY: 0, sprint: false, jump: false };
    const sample = (start, yaw, seconds) => {
      g.setFootPosition(
        [start[0], g.surfaceAt(start[0], start[1]) + 0.07, start[1]],
        yaw,
      );
      g.simulateFoot(idle, 0.45, yaw);
      const before = g.getState().exploration;
      const path = [];
      for (let n = 0; n < Math.round(seconds * 60); n++) {
        g.simulateFoot({ ...idle, moveY: 1, sprint: true }, 1 / 60, yaw);
        path.push(g.getState().exploration.position);
      }
      const after = g.getState().exploration;
      return { before, after, path };
    };
    const frame = home.frame,
      front = [
        frame.center[0] - frame.back[0] * (frame.depth / 2 + 3),
        frame.center[1] - frame.back[1] * (frame.depth / 2 + 3),
      ];
    const house = sample(front, Math.atan2(frame.back[0], frame.back[1]), 2);
    const tree = home.trees.trees[0],
      t = tree.position;
    const trunk = sample([t[0] - 3, t[2]], Math.PI / 2, 2);
    g.resume();
    return { house, trunk: { ...trunk, tree } };
  });
  const houseTravel = horizontal(
    report.collisions.house.before.position,
    report.collisions.house.after.position,
  );
  assert(
    houseTravel < 3.2,
    `House wall must stop the capsule: ${houseTravel}m`,
  );
  const tree = report.collisions.trunk.tree;
  const trunkDistance = Math.min(
    ...report.collisions.trunk.path.map((point) =>
      horizontal(point, tree.position),
    ),
  );
  assert(
    trunkDistance >= tree.radiusMeters + 0.18 && trunkDistance < 1.6,
    `Front tree collision clearance ${trunkDistance}m`,
  );
  report.checks.push(
    "Actual Home facade and photo-observed trunk block the pedestrian capsule",
  );
  await footAt(-11, 5, Math.PI / 2);
  await capture("front-yard");

  report.creekWalk = await page.evaluate(() => {
    const g = window.__game,
      stations = g.backyardDetails().data.stream.stations.slice(69, 81);
    g.pause();
    const [x, z] = stations[0].point,
      idle = { moveX: 0, moveY: 0, sprint: false, jump: false };
    g.setFootPosition([x, g.surfaceAt(x, z) + 0.06, z], 0);
    g.simulateFoot(idle, 0.5, 0);
    const samples = [];
    let target = 1;
    for (let i = 0; i < 1200 && target < stations.length; i++) {
      const s = g.getState().exploration,
        p = stations[target].point;
      if (Math.hypot(p[0] - s.position[0], p[1] - s.position[2]) < 0.6) {
        target++;
        continue;
      }
      g.simulateFoot(
        { ...idle, moveY: 1 },
        1 / 60,
        Math.atan2(p[0] - s.position[0], p[1] - s.position[2]),
      );
      if (i % 6 === 0) {
        const next = g.getState().exploration;
        samples.push({
          ...next,
          surfaceY: g.surfaceAt(next.position[0], next.position[2]),
        });
      }
    }
    g.simulateFoot(idle, 0.5, 0);
    g.resume();
    return { target, total: stations.length, samples };
  });
  assert.equal(
    report.creekWalk.target,
    report.creekWalk.total,
    "Follow the actual stream bed with character physics",
  );
  assert(
    report.creekWalk.samples.every((s) => s.position[1] > s.surfaceY - 0.12),
    "Stream floor must support the character",
  );
  assert(
    report.creekWalk.samples.filter((s) => s.grounded).length /
      report.creekWalk.samples.length >
      0.9,
    "Shallow creek walk remains grounded",
  );
  report.checks.push(
    "Continuous walking through the mapped stream channel with terrain support",
  );
  await capture("creek-exploration");

  await page.evaluate(() => window.__game.startTest());
  await expectPhase("driving");
  await page.waitForFunction(() => window.__game.getState().grounded >= 3);
  await key("KeyF");
  await expectPhase("foot");
  report.movement = await page.evaluate(() => {
    const g = window.__game,
      idle = { moveX: 0, moveY: 0, sprint: false, jump: false };
    g.pause();
    const results = {};
    for (const [label, command, yaw] of [
      ["walk", { moveY: 1 }, 0],
      ["sprint", { moveY: 1, sprint: true }, 0],
      ["diagonal", { moveX: Math.SQRT1_2, moveY: Math.SQRT1_2 }, 0],
      ["partial", { moveY: 0.4 }, 0],
      ["cameraRight", { moveY: 1 }, Math.PI / 2],
    ]) {
      g.setFootPosition([0, 0.1, 0], yaw);
      g.simulateFoot(idle, 0.5, yaw);
      const before = g.getState().exploration;
      g.simulateFoot({ ...idle, ...command }, 2, yaw);
      results[label] = { before, after: g.getState().exploration };
    }
    g.resume();
    return results;
  });
  const traveled = (label) =>
    horizontal(
      report.movement[label].before.position,
      report.movement[label].after.position,
    );
  assert(traveled("walk") > 4.3 && traveled("walk") < 5.2);
  assert(traveled("sprint") > 10 && traveled("sprint") < 11.6);
  assert(
    Math.abs(traveled("diagonal") / traveled("walk") - 1) < 0.03,
    "Diagonal travel stays within3% of forward travel across the actual terrain mesh",
  );
  assert(
    Math.abs(traveled("partial") / traveled("walk") - 0.4) < 0.025,
    "Partial analog speed stays proportional",
  );
  assert(
    report.movement.cameraRight.after.position[0] > 4.3 &&
      Math.abs(report.movement.cameraRight.after.position[2]) < 0.05,
    "Forward follows the camera's yaw",
  );
  report.checks.push(
    "Fixed-step walking/sprinting, normalized diagonals, analog speed and camera-relative movement",
  );
  if (secondPass) {
    report.boundary = await page.evaluate(() => {
      const g = window.__game;
      g.pause();
      g.setFootPosition([227.2, 0.1, 0], Math.PI / 2);
      const idle = { moveX: 0, moveY: 0, sprint: false, jump: false };
      g.simulateFoot(idle, 0.5, Math.PI / 2);
      const samples = [];
      for (let n = 0; n < 240; n++) {
        g.simulateFoot(
          { ...idle, moveY: 1, sprint: true },
          1 / 60,
          Math.PI / 2,
        );
        if (n % 5 === 0) samples.push(g.getState().exploration.position);
      }
      g.resume();
      return samples;
    });
    assert(
      report.boundary.every(
        (point) =>
          point.every(Number.isFinite) && point[0] < 228.01 && point[1] > -0.1,
      ),
      "Walking beyond map bounds returns to supported terrain",
    );
    report.checks.push(
      "Independent second pass: physical map-boundary approach remains supported and bounded",
    );
  }

  await startHome();
  await key("KeyF");
  await expectPhase("foot");
  await footAt(22, 0, Math.PI / 2);
  if (secondPass) {
    await page.keyboard.down("KeyW");
    await frames(20);
  }
  await key("Escape");
  if (secondPass) await page.keyboard.up("KeyW");
  assert.equal((await state()).screen, "pause");
  const paused = await state();
  const pausedPose = secondPass
    ? await page.evaluate(() => window.__game.characterPose())
    : null;
  await key("KeyW", 500);
  assert(
    horizontal(
      paused.exploration.position,
      (await state()).exploration.position,
    ) < 0.001,
    "Pause freezes exploration",
  );
  if (secondPass) {
    assert.deepEqual(
      await page.evaluate(() => window.__game.characterPose()),
      pausedPose,
      "Pausing while walking must freeze every character joint",
    );
    report.checks.push(
      "Independent second pass: paused walking pose freezes all character joints",
    );
  }
  await page.getByRole("button", { name: /^Resume/ }).click();
  assert.equal((await state()).screen, null);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await frames(5);
  assert.equal((await state()).screen, "pause");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await frames(5);
  assert.equal(
    (await state()).screen,
    "pause",
    "Focus return cannot automatically resume",
  );
  await key("Enter");
  assert.equal((await state()).screen, null);
  assert.equal((await state()).exploration.mode, "foot");
  report.checks.push(
    "Pause freezes foot movement; blur/focus requires deliberate resume",
  );

  for (const quality of ["low", "medium", "high"]) {
    await page.evaluate((quality) => window.__game.quality(quality), quality);
    await frames(10);
    const snapshot = await state();
    assert.equal(snapshot.exploration.mode, "foot");
    finiteState(snapshot);
  }
  report.checks.push(
    "All three quality settings preserve the active character",
  );

  await page.evaluate(() => window.__game.startRace());
  await frames(6);
  assert.equal((await state()).exploration.mode, "driving");
  await key("KeyF");
  assert.equal(
    (await state()).exploration.mode,
    "driving",
    "Race countdown prevents leaving the car",
  );
  await startHome();
  assert((await state()).exploration.driver.seated);
  report.checks.push(
    "Race transition seats the driver; race exit is gated; Return Home restores free drive",
  );

  if (secondPass) {
    await installPad();
    await padButton(0);
    assert.equal(
      (await state()).exploration.mode,
      "driving",
      "First controller button is selection only",
    );
    await padButton(3, 70);
    await expectPhase("foot");
    assert.equal(
      (await state()).exploration.phase,
      "foot",
      "Held Y does not reverse the exit transition",
    );
    const start = await state();
    await page.evaluate(() => {
      window.__explorationPad.axes[1] = -1;
      window.__explorationPad.buttons[0] = { value: 1, pressed: true };
    });
    await frames(50);
    await page.evaluate(() => {
      window.__explorationPad.axes[1] = 0;
      window.__explorationPad.buttons[0] = { value: 0, pressed: false };
    });
    await frames(8);
    assert(
      horizontal(
        start.exploration.position,
        (await state()).exploration.position,
      ) > 2.5,
      "Left stick + A sprints on foot",
    );
    const orbitBefore = (await state()).exploration.cameraYaw;
    await page.evaluate(() => {
      window.__explorationPad.axes[2] = 0.8;
    });
    await frames(35);
    await page.evaluate(() => {
      window.__explorationPad.axes[2] = 0;
    });
    await frames(4);
    assert(
      Math.abs((await state()).exploration.cameraYaw - orbitBefore) > 0.25,
      "Right stick orbits the foot camera",
    );
    await padButton(2);
    assert.equal((await state()).exploration.mode, "foot");
    await page.evaluate(() => {
      window.__explorationPad.connected = false;
    });
    await frames(5);
    assert.equal((await state()).screen, "pause");
    await page.evaluate(() => {
      window.__explorationPad.connected = true;
    });
    await padButton(0);
    assert.equal(
      (await state()).screen,
      "pause",
      "Reconnect selection does not resume",
    );
    await padButton(0);
    assert.equal((await state()).screen, null);
    assert.equal((await state()).exploration.mode, "foot");
    report.checks.push(
      "Independent second pass: synthetic Y transition, left-stick/A sprint, right-stick orbit, X jump and disconnect/reconnect safety",
    );

    for (let i = 0; i < 3; i++) {
      await startHome();
      await padButton(3);
      await expectPhase("foot");
      await padButton(3);
      await expectPhase("driving");
      await page.evaluate(() => window.__game.startTest());
      await frames(10);
      await startHome();
    }
    report.checks.push(
      "Independent second pass: repeated exit/re-entry and neighborhood/handling-ground disposal and recreation",
    );
  }
  await key("KeyF");
  await expectPhase("foot");
  await footAt(22, 0, Math.PI / 2);
  if (secondPass) {
    report.traffic = await page.evaluate(() => {
      const g = window.__game,
        idle = { moveX: 0, moveY: 0, sprint: false, jump: false };
      g.pause();
      g.simulateFoot(idle, 0.5, 0);
      const traffic = g.getState().ai.find((car) => car.id === 4),
        route = g.route();
      const next = route[Math.min(traffic.target, route.length - 1)];
      const dx = next[0] - traffic.position[0],
        dz = next[2] - traffic.position[2],
        length = Math.hypot(dx, dz) || 1;
      const distance =
        Math.max(11, (traffic.speed * traffic.speed) / 16 + 6) - 1.5;
      const x = traffic.position[0] + (dx / length) * distance,
        z = traffic.position[2] + (dz / length) * distance;
      g.setFootPosition([x, g.surfaceAt(x, z) + 0.08, z], Math.atan2(-dx, -dz));
      let last = traffic.position,
        maxStep = 0,
        minDistance = Infinity;
      const samples = [];
      for (let n = 0; n < 600; n++) {
        g.simulateFoot(idle, 1 / 60, Math.atan2(-dx, -dz));
        const s = g.getState(),
          car = s.ai.find((car) => car.id === 4);
        maxStep = Math.max(
          maxStep,
          Math.hypot(car.position[0] - last[0], car.position[2] - last[2]),
        );
        minDistance = Math.min(
          minDistance,
          Math.hypot(
            car.position[0] - s.exploration.position[0],
            car.position[2] - s.exploration.position[2],
          ),
        );
        last = car.position;
        if (n % 12 === 0)
          samples.push({ car, pedestrian: s.exploration.position });
      }
      const after = g.getState().ai.find((car) => car.id === 4);
      g.resume();
      return { before: traffic, after, samples, maxStep, minDistance };
    });
    assert.equal(
      report.traffic.after.life,
      report.traffic.before.life,
      "Yielding traffic must not recover/teleport through an explorer",
    );
    assert(
      report.traffic.after.speed < 0.5 && report.traffic.maxStep < 2,
      "Nearby traffic must stop smoothly and remain stopped",
    );
    assert(
      report.traffic.minDistance > 2,
      "Traffic must leave room for the explorer",
    );
    report.checks.push(
      "Independent second pass: traffic yields for 10 simulated seconds without stuck recovery or teleport",
    );
    await footAt(22, 0, Math.PI / 2);
    await page.keyboard.down("KeyW");
    await page.keyboard.down("ShiftLeft");
    await frames(23);
    await capture("running-to-woods");
    await page.keyboard.up("ShiftLeft");
    await page.keyboard.up("KeyW");
    await frames(8);
    await footAt(22, 0, Math.PI / 2);
    await page.evaluate(() => {
      window.__explorationPad.axes[1] = -1;
      window.__explorationPad.axes[2] = 0.48;
    });
    await page.waitForTimeout(2200);
    await capture("walking-orbit");
  }
  report.frameTiming = await page.evaluate(
    (moving) =>
      new Promise((resolve) => {
        const intervals = [];
        let started = 0,
          last = 0,
          movingFrames = 0,
          actualDistance = 0,
          lastPosition = null;
        const positions = [];
        const tick = (time) => {
          if (!started) started = time;
          if (last) intervals.push(time - last);
          last = time;
          const foot = window.__game.getState().exploration;
          if (lastPosition)
            actualDistance += Math.hypot(
              foot.position[0] - lastPosition[0],
              foot.position[2] - lastPosition[2],
            );
          lastPosition = foot.position;
          if (Math.hypot(foot.velocity[0], foot.velocity[2]) > 0.5)
            movingFrames++;
          if (intervals.length % 15 === 0) positions.push(foot.position);
          if (time - started < (moving ? 12000 : 8000))
            requestAnimationFrame(tick);
          else {
            const sorted = [...intervals].sort((a, b) => a - b),
              p = (n) => sorted[Math.floor((sorted.length - 1) * n)];
            resolve({
              seconds: (time - started) / 1000,
              scenario: moving
                ? "Continuous analog walking with right-stick orbit after 2.2s warmup"
                : "Stationary on foot after quality and scene transitions",
              movingFrames,
              actualDistance,
              positions,
              frames: sorted.length,
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
    secondPass,
  );
  if (secondPass) {
    await page.evaluate(() => {
      window.__explorationPad.axes[1] = 0;
      window.__explorationPad.axes[2] = 0;
    });
    await frames(8);
    assert(
      report.frameTiming.movingFrames / report.frameTiming.frames > 0.9,
      "The independent frame sample must contain active movement",
    );
    assert(
      report.frameTiming.actualDistance > report.frameTiming.seconds * 1.4,
      "Measured on-foot performance must include continuous actual ground travel",
    );
    await footAt(22, 0, Math.PI / 2);
  }
  await capture("final-exploration");
  if (secondPass) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await frames(12);
    const controls = await page.locator(".controls-bar").evaluate((el) => {
      const rect = el.getBoundingClientRect(),
        style = getComputedStyle(el);
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        display: style.display,
        visibility: style.visibility,
        fontSize: parseFloat(style.fontSize),
      };
    });
    assert(
      controls.display !== "none" &&
        controls.visibility !== "hidden" &&
        controls.height > 20,
      "Foot controls stay visible at1280×720",
    );
    assert(
      controls.x >= 0 &&
        controls.y >= 0 &&
        controls.x + controls.width <= 1280 &&
        controls.y + controls.height <= 720,
      "Foot controls stay inside the narrower viewport",
    );
    report.narrowViewport = { viewport: [1280, 720], controls };
    await capture("narrow-hud");
    report.checks.push(
      "Independent second pass: readable foot controls inside1280×720 viewport",
    );
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(
    JSON.stringify(
      {
        passed: true,
        pass,
        checks: report.checks,
        frameTiming: report.frameTiming,
        screenshots: report.screenshots.map((s) => s.path),
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
    `docs/exploration-${pass}-verification.json`,
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
