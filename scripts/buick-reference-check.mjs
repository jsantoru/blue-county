/** Actual-game Buick reference views, delivered-asset proof and transfer checks. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const stage = process.argv.includes("--after") ? "after" : "before";
const base = process.env.GAME_URL || "http://127.0.0.1:5180";
const root = "output/playwright/buick-reference";
const directory = `${root}/${stage}`;
await mkdir(directory, { recursive: true });
const fixtures =
  stage === "after"
    ? JSON.parse(
        await readFile(`${root}/fixtures.json`, "utf8").catch((error) => {
          if (error.code !== "ENOENT") throw error;
          return readFile("docs/buick-reference-fixtures.json", "utf8");
        }),
      )
    : { views: {} };
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
page.setDefaultTimeout(45000);
const report = {
  date: new Date().toISOString(),
  stage,
  methodology:
    "Actual production game in system Edge at High 1920×1080. Saved world-space cameras and unchanged Home spawn preserve before/after framing. No special lighting or movement simulation. Door is opened with keyboard F and paused mid-transfer. GLB served over HTTP is SHA-256 checked. After-only driving, walking and re-entry use the normal keyboard input and render loop.",
  shots: [],
  checks: [],
  errors: [],
  warnings: [],
};
const loadedAssets = new Set();
page.on("pageerror", (error) => report.errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") report.errors.push(message.text());
  if (message.type() === "warning") report.warnings.push(message.text());
});
page.on("response", (response) => {
  if (response.status() >= 400)
    report.errors.push(`HTTP ${response.status()} ${response.url()}`);
  if (response.ok() && response.url().endsWith(".glb"))
    loadedAssets.add(new URL(response.url()).pathname);
});
const frames = (n = 8) =>
  page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame);
  }, n);
const state = () => page.evaluate(() => window.__game.getState());
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const key = async (key, n = 4) => {
  await page.keyboard.down(key);
  await frames(n);
  await page.keyboard.up(key);
  await frames(3);
};
const showUI = () =>
  page.evaluate(() => {
    for (const id of ["menu", "hud", "toast"])
      document.getElementById(id).style.visibility = "";
  });
const resume = async () => {
  await showUI();
  await key("Escape");
  await page.waitForFunction(() => window.__game.getState().screen === null);
};
const capture = async (name, fixture = name) => {
  await page.evaluate(({ position, target }) => {
    window.__game.pause();
    window.__game.inspectView(position, target);
    for (const id of ["menu", "hud", "toast"])
      document.getElementById(id).style.visibility = "hidden";
  }, fixtures.views[fixture]);
  await frames(10);
  assert.equal(
    await page.evaluate(() =>
      document.querySelector("#game").getContext("webgl2").getError(),
    ),
    0,
  );
  const s = await state();
  const path = `${directory}/${name}.png`;
  await page.screenshot({ path });
  report.shots.push({
    name,
    path,
    camera: s.camera,
    position: s.position,
    rotation: s.rotation,
    phase: s.exploration.phase,
    progress: s.exploration.transferProgress,
    doors: s.exploration.doors,
  });
  console.log(`Captured ${stage}: ${name}`);
};

try {
  await page.goto(`${base}/?test&revision=buick-reference-${stage}`);
  await page.waitForFunction(() => window.__game?.getState().ready);
  report.bundle = await page
    .locator('script[type="module"]')
    .getAttribute("src");
  await page.evaluate(() => window.__game.quality("high"));
  await page.getByRole("button", { name: /The Lug Nuts/ }).click();
  await page.locator('.garage-member[data-member="ed"]').click();
  await page.locator(".garage-drive").click();
  await page.waitForFunction(() => {
    const s = window.__game.getState();
    return (
      s.club.member === "ed" &&
      !s.club.busy &&
      s.screen === null &&
      s.grounded >= 3
    );
  });
  await frames(20);
  await page.evaluate(() => window.__game.pause());
  const parked = await state();
  report.club = parked.club;
  report.hero = await page.evaluate(() => window.__game.heroDetails());
  assert(
    loadedAssets.has(parked.club.asset),
    "Selected Ed GLB must have loaded in the game",
  );
  const response = await page.request.get(`${base}${parked.club.asset}`);
  assert(response.ok(), "Ed GLB must be served over HTTP");
  const body = await response.body();
  report.deliveredAsset = {
    url: response.url(),
    status: response.status(),
    bytes: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
  const manifestResponse = await page.request.get(
    `${base}/assets/club-cars/ed-manifest.json`,
  );
  assert(manifestResponse.ok());
  report.manifest = await manifestResponse.json();
  assert.equal(report.hero.vehicle.name, report.manifest.name);
  const [x, y, z, w] = parked.rotation;
  const yaw = Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
  if (stage === "before") {
    fixtures.position = parked.position;
    fixtures.heading = yaw;
    fixtures.sha256 = report.deliveredAsset.sha256;
    const local = (side, height, front) => [
      parked.position[0] + Math.cos(yaw) * side + Math.sin(yaw) * front,
      parked.position[1] + height,
      parked.position[2] - Math.sin(yaw) * side + Math.cos(yaw) * front,
    ];
    fixtures.views = {
      "ed-side-profile": {
        position: local(6.3, 1.05, 0),
        target: local(0, 1.05, 0),
      },
      "ed-front-three-quarter": {
        position: local(4.2, 2.1, 5.8),
        target: local(0, 0.5, 0),
      },
      "ed-window-belt-detail": {
        position: local(3.3, 1.23, -0.55),
        target: local(0, 1.2, -0.55),
      },
      "ed-door-open": {
        position: local(4.5, 1.7, 3.3),
        target: local(0.35, 1.0, 0.2),
      },
    };
  } else {
    assert(
      Math.hypot(...parked.position.map((v, i) => v - fixtures.position[i])) <
        0.003,
      "Unchanged parked transform must match baseline within3mm",
    );
    assert(
      Math.abs(
        Math.atan2(
          Math.sin(yaw - fixtures.heading),
          Math.cos(yaw - fixtures.heading),
        ),
      ) < 0.0001,
    );
    assert.notEqual(
      report.deliveredAsset.sha256,
      fixtures.sha256,
      "Corrected Buick asset must differ from baseline GLB",
    );
    report.sourceAssetSha256 = createHash("sha256")
      .update(await readFile(`public${parked.club.asset}`))
      .digest("hex");
    assert.equal(
      report.deliveredAsset.sha256,
      report.sourceAssetSha256,
      "Production HTTP model must match the corrected source GLB",
    );
  }
  for (const name of [
    "ed-side-profile",
    "ed-front-three-quarter",
    "ed-window-belt-detail",
  ])
    await capture(name);
  await page.evaluate(() => window.__game.clearInspectionView());
  await resume();
  await page.keyboard.down("f");
  await frames(3);
  await page.keyboard.up("f");
  await page.waitForFunction(
    () => {
      const s = window.__game.getState();
      if (
        s.exploration.phase !== "exiting" ||
        s.exploration.transferProgress < 0.49
      )
        return false;
      window.__game.pause();
      return true;
    },
    undefined,
    { polling: "raf" },
  );
  await capture("ed-door-open");
  const opened = await state();
  assert.equal(opened.exploration.phase, "exiting");
  assert(
    opened.exploration.transferProgress < 0.72,
    "Door capture must stay mid-transfer",
  );
  report.checks.push(
    "High side profile, unchanged front three-quarter, window-belt detail and keyboard-opened door captured from saved cameras",
    "Live Ed geometry/manifest and HTTP-delivered GLB identity recorded",
  );
  if (stage === "after") {
    await page.evaluate(() => window.__game.clearInspectionView());
    await resume();
    await page.waitForFunction(
      () => window.__game.getState().exploration.phase === "foot",
    );
    await frames(20);
    const exited = await state();
    assert.equal(exited.exploration.driver.seated, false);
    assert.equal(exited.exploration.driver.visible, true);
    const forwardX = exited.camera.target[0] - exited.camera.position[0];
    const forwardZ = exited.camera.target[2] - exited.camera.position[2];
    const outwardX = exited.exploration.position[0] - exited.position[0];
    const outwardZ = exited.exploration.position[2] - exited.position[2];
    const away = -forwardZ * outwardX + forwardX * outwardZ >= 0 ? "d" : "a";
    await key(away, 22);
    await frames(8);
    const walked = await state();
    const walkedDistance = distance(
      exited.exploration.position,
      walked.exploration.position,
    );
    assert(walkedDistance > 0.2, "Ed must move independently on foot");
    assert(
      distance(exited.position, walked.position) < 0.03,
      "Parked wagon must stay still while Ed walks",
    );
    const path = `${directory}/ed-on-foot.png`;
    await page.screenshot({ path });
    report.shots.push({
      name: "ed-on-foot",
      path,
      camera: walked.camera,
      phase: walked.exploration.phase,
    });
    await key(away === "d" ? "a" : "d", 22);
    await frames(12);
    const returned = await state();
    assert(
      returned.exploration.interaction.available,
      "Ed can return to the car door",
    );
    await key("f");
    await page.waitForFunction(
      () => window.__game.getState().exploration.phase === "driving",
    );
    await frames(12);
    const entered = await state();
    assert.equal(entered.exploration.driver.seated, true);
    assert.equal(entered.exploration.doors.left.progress, 0);
    assert.equal(entered.exploration.doors.right.progress, 0);
    const beforeDrive = entered.position;
    await key("w", 28);
    await page.keyboard.down("s");
    await page.waitForFunction(
      () => Math.abs(window.__game.getState().speed) < 0.28,
      undefined,
      { polling: "raf" },
    );
    await page.keyboard.up("s");
    await frames(8);
    const driven = await state();
    const drivenDistance = distance(beforeDrive, driven.position);
    assert(
      drivenDistance > 0.25,
      "Re-entered wagon must drive with normal keyboard throttle",
    );
    report.functionality = {
      walkedDistance,
      drivenDistance,
      distanceFromExitAfterReturn: distance(
        exited.exploration.position,
        returned.exploration.position,
      ),
      seatedAfterReentry: entered.exploration.driver.seated,
      stoppedSpeed: driven.speed,
      exitDoors: opened.exploration.doors,
      doorsAfterReentry: entered.exploration.doors,
    };
    report.checks.push(
      "Actual keyboard exit, walk away, walk back, re-entry and subsequent driving work through the production loop",
      "HTTP-delivered corrected model matches the source GLB hash and differs from the baseline",
    );
  }
  assert.equal(
    await page.evaluate(() =>
      document.querySelector("#game").getContext("webgl2").getError(),
    ),
    0,
    "No WebGL error after the complete capture and interaction flow",
  );
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack ?? String(error);
  throw error;
} finally {
  if (stage === "before")
    await writeFile(
      `${root}/fixtures.json`,
      JSON.stringify(fixtures, null, 2) + "\n",
    );
  await writeFile(
    `${directory}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}
console.log(
  JSON.stringify(
    {
      stage,
      bundle: report.bundle,
      passed: report.passed,
      asset: report.deliveredAsset,
      report: `${directory}/report.json`,
    },
    null,
    2,
  ),
);
