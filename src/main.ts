import "./style.css";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Atmosphere } from "./atmosphere";
import { Presentation } from "./presentation";
import { createTrafficVisual } from "./traffic-visual";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  InputManager,
  emptyInput,
  BINDING_NAMES,
  type InputFrame,
  type InputSettings,
} from "./input";
import {
  Vehicle,
  handling,
  configureVehicleGeometry,
  vehicleGeometry,
} from "./vehicle";
import { Environment, nearestRoad, heightAt, makeTestMap } from "./roads";
import { FixedClock, RaceProgress, TakedownLedger } from "./rules";
import { Driver } from "./ai";
import { Sound } from "./audio";
import { Effects } from "./effects";
import {
  angleDiff,
  clamp,
  idleInput,
  type MapData,
  type Point,
  type DriveInput,
} from "./types";

type Screen =
  | "main"
  | "pause"
  | "settings"
  | "diagnostics"
  | "bindings"
  | "route"
  | "results"
  | null;
type MenuItem = {
  label: string;
  detail?: string;
  value?: string;
  action?: () => void;
  adjust?: (direction: number) => void;
};
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const clock = new FixedClock(),
  sound = new Sound();
let screen: Screen = "main",
  returnScreen: Screen = "main",
  focus = 0,
  items: MenuItem[] = [],
  safetyMessage = "",
  developer = false,
  ready = false;
let frame = emptyInput(),
  lastTime = 0,
  simTime = 0,
  physicsMs = 0,
  frameTimes: number[] = [],
  frameCount = 0,
  toastUntil = 0,
  lastHud = 0,
  quality = "";
let race = false,
  countdown = 0,
  lastCount = 4,
  mode: "neighborhood" | "test" = "neighborhood",
  raceFinished = false;
let world: RAPIER.World,
  events: RAPIER.EventQueue,
  environment: Environment,
  player: Vehicle,
  vehicles: Vehicle[] = [],
  drivers: Driver[] = [],
  visuals: T.Group[] = [],
  map: MapData,
  neighborhood: MapData,
  races: RaceProgress[] = [],
  template: T.Group,
  manifest: any;
const ledger = new TakedownLedger(),
  effects = new Effects();
let modelLoaded = false;
let cameraMode = 0,
  lookAngle = 0,
  lookPitch = 0;
let benchmarkDriver: Driver | null = null;
const camPos = new T.Vector3(),
  camTarget = new T.Vector3();
let cameraInitialized = false;
let inspectionView: { position: T.Vector3; target: T.Vector3 } | null = null;
let homeBrakeHold = false;
const renderer = new T.WebGLRenderer({
  canvas: $<HTMLCanvasElement>("game"),
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFShadowMap;
const scene = new T.Scene();
scene.fog = new T.Fog(0xbdcbd0, 210, 1280);
const camera = new T.PerspectiveCamera(62, innerWidth / innerHeight, 0.2, 2200);
const hemi = new T.HemisphereLight(0xc7ddec, 0x52604a, 0.62);
scene.add(hemi);
const sun = new T.DirectionalLight(0xffedd5, 2.6);
sun.position.set(100, 140, -80);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = -65;
sun.shadow.camera.right = 65;
sun.shadow.camera.top = 65;
sun.shadow.camera.bottom = -65;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 350;
sun.shadow.bias = -0.00015;
sun.shadow.normalBias = 0.025;
sun.shadow.radius = 3;
scene.add(sun, sun.target);
const atmosphere = new Atmosphere(scene, renderer);
const shadowRight = new T.Vector3()
  .crossVectors(new T.Vector3(0, 1, 0), atmosphere.sunDirection)
  .normalize();
const shadowUp = new T.Vector3()
  .crossVectors(atmosphere.sunDirection, shadowRight)
  .normalize();
function placeSun(target: T.Vector3) {
  // Quantize in the light's plane so foliage shadows do not crawl across the
  // asphalt every time the chase camera/car moves a fraction of a texel.
  const texel =
    (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
  const x = target.dot(shadowRight),
    y = target.dot(shadowUp);
  sun.target.position
    .copy(target)
    .addScaledVector(shadowRight, Math.round(x / texel) * texel - x)
    .addScaledVector(shadowUp, Math.round(y / texel) * texel - y);
  sun.position
    .copy(sun.target.position)
    .addScaledVector(atmosphere.sunDirection, 180);
}
const presentation = new Presentation(renderer, camera);
scene.add(effects.root);
const routeMarkers = new T.Group();
scene.add(routeMarkers);
const input = new InputManager({
  onSafetyPause: (reason) => {
    if (!ready) return;
    safetyMessage =
      reason === "disconnect"
        ? "Controller disconnected. Reconnect, release controls, then choose Resume."
        : "Paused for focus loss. Return to the game, release controls, then choose Resume.";
    if (screen === null) setScreen("pause");
    else renderMenu();
    clock.reset();
  },
});
function toast(text: string, seconds = 2) {
  $("toast").textContent = text;
  toastUntil = performance.now() + seconds * 1000;
}
function setScreen(next: Screen) {
  screen = next;
  focus = 0;
  input.consume();
  if (next) input.stopRumble();
  clock.reset();
  renderMenu();
}
function resume() {
  sound.start();
  input.resume();
  safetyMessage = "";
  setScreen(null);
}
function setQuality() {
  if (quality === input.settings.quality) return;
  quality = input.settings.quality;
  environment?.setQuality(input.settings.quality);
  presentation.setQuality(input.settings.quality);
  renderer.setPixelRatio(quality === "low" ? 0.75 : 1);
  const shadowsChanged = renderer.shadowMap.enabled !== (quality !== "low");
  renderer.shadowMap.enabled = quality !== "low";
  if (shadowsChanged) {
    // Three's shader cache does not invalidate when only shadowMap.enabled changes.
    // A stale PCF sampler otherwise reads an ordinary fallback texture on Low.
    const materials = new Set<T.Material>();
    scene.traverse((object) => {
      if (object instanceof T.Mesh || object instanceof T.Sprite)
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          materials.add(material);
    });
    for (const material of materials) material.needsUpdate = true;
  }
  sun.shadow.mapSize.set(
    quality === "high" ? 4096 : 1024,
    quality === "high" ? 4096 : 1024,
  );
  sun.shadow.map?.dispose();
  sun.shadow.map = null;
}
function buildScene(test: boolean) {
  if (environment) {
    scene.remove(environment.root);
    environment.dispose();
  }
  if (world) {
    for (const v of vehicles) world.removeRigidBody(v.body);
  }
  for (const v of visuals) {
    v.userData.dispose?.();
    scene.remove(v);
  }
  vehicles = [];
  drivers = [];
  visuals = [];
  races = [];
  mode = test ? "test" : "neighborhood";
  map = test ? makeTestMap() : neighborhood;
  environment = new Environment(map, world, test);
  environment.setQuality(input.settings.quality);
  scene.add(environment.root);
  const home = map.home;
  player = new Vehicle(
    world,
    0,
    [home.position[0], home.position[1] + 0.85, home.position[2]],
    home.heading,
  );
  vehicles.push(player);
  const visual = new T.Group();
  const real = template.clone(true);
  real.position.y = vehicleGeometry.visualOffsetY;
  visual.add(real);
  visual.userData.car = real;
  scene.add(visual);
  visuals.push(visual);
  if (!test) {
    for (let i = 1; i <= 6; i++) {
      const index = Math.min(
        map.route.points.length - 2,
        Math.floor(map.route.points.length * (i <= 3 ? 0.02 * i : 0.13 * i)),
      );
      const p = map.route.points[index],
        next = map.route.points[index + 1];
      const heading = Math.atan2(next[0] - p[0], next[2] - p[2]);
      const car = new Vehicle(world, i, [p[0], p[1] + 0.85, p[2]], heading);
      vehicles.push(car);
      const driver = new Driver(car, map.route.points, i > 3);
      driver.target = index + 1;
      driver.speed = i > 3 ? 12 + (i % 3) : 22 + i * 1.3;
      drivers.push(driver);
      const g = new T.Group(),
        m = createTrafficVisual(
          [0, 0xc26442, 0x789fa1, 0xe0c68a, 0xc3c6b7, 0x384e69, 0x9f907c][i],
          i - 1,
        );
      m.position.y = -0.78;
      g.add(m);
      g.userData.dispose = m.userData.dispose;
      scene.add(g);
      visuals.push(g);
    }
  }
  while (routeMarkers.children.length) {
    const child = routeMarkers.children[0];
    routeMarkers.remove(child);
    if (child instanceof T.Mesh) child.geometry.dispose();
  }
  const arrows: number[] = [];
  map.route.points.forEach((p, i) => {
    if (i % 5 !== 0 || i >= map.route.points.length - 1) return;
    const b = map.route.points[i + 1],
      heading = Math.atan2(b[0] - p[0], b[2] - p[2]);
    for (const [x, z] of [
      [0, 3],
      [-1.2, -1],
      [0, 0],
      [0, 3],
      [0, 0],
      [1.2, -1],
    ]) {
      const wx = p[0] + x * Math.cos(heading) + z * Math.sin(heading),
        wz = p[2] - x * Math.sin(heading) + z * Math.cos(heading);
      arrows.push(wx, heightAt(map, wx, wz) + 0.16, wz);
    }
  });
  const ag = new T.BufferGeometry();
  ag.setAttribute("position", new T.Float32BufferAttribute(arrows, 3));
  routeMarkers.add(
    new T.Mesh(
      ag,
      new T.MeshBasicMaterial({
        color: 0xffd281,
        side: T.DoubleSide,
        depthTest: true,
      }),
    ),
  );
  routeMarkers.visible = false;
  world.step();
  vehicles.forEach((v) => v.sync());
  race = false;
  raceFinished = false;
  countdown = 0;
  ledger.clear();
  cameraInitialized = false;
  clock.reset();
}
function setHomeBrakeHold(active: boolean) {
  homeBrakeHold = active;
  // Static parking restraint: allow suspension to settle vertically without
  // the velocity-based tire model slowly slipping down the driveway grade.
  player?.body.setEnabledTranslations(!active, true, !active, true);
}
function startFree() {
  sound.start();
  if (mode !== "neighborhood") buildScene(false);
  race = false;
  raceFinished = false;
  countdown = 0;
  player.reset(
    [
      map.home.position[0],
      heightAt(map, map.home.position[0], map.home.position[2]),
      map.home.position[2],
    ],
    map.home.heading,
  );
  setHomeBrakeHold(!!map.home.departurePath);
  input.resume();
  setScreen(null);
  toast("HOME · BEVERLY DRIVE");
}
function startTest() {
  setHomeBrakeHold(false);
  sound.start();
  buildScene(true);
  input.resume();
  setScreen(null);
  toast("HANDLING GROUNDS");
}
function startRace() {
  setHomeBrakeHold(false);
  sound.start();
  if (mode !== "neighborhood") buildScene(false);
  race = true;
  raceFinished = false;
  countdown = 3.5;
  lastCount = 4;
  ledger.clear();
  races = [];
  const points = map.route.points;
  const p = points[0],
    b = points[1];
  const heading = Math.atan2(b[0] - p[0], b[2] - p[2]);
  for (let i = 0; i < 4; i++) {
    const back = 4 + Math.floor(i / 2) * 7,
      side = i % 2 ? 2 : -2;
    const spawn: Point = [
      p[0] - Math.sin(heading) * back + Math.cos(heading) * side,
      p[1],
      p[2] - Math.cos(heading) * back - Math.sin(heading) * side,
    ];
    spawn[1] = heightAt(map, spawn[0], spawn[2]);
    vehicles[i].reset(spawn, heading);
    vehicles[i].bank.reset();
    const progress = new RaceProgress(
      points,
      map.route.laps,
      map.route.type === "circuit",
    );
    progress.reset();
    races.push(progress);
    if (i > 0) {
      drivers[i - 1].target = 1;
      drivers[i - 1].stuck = 0;
    }
  }
  cameraInitialized = false;
  input.resume();
  setScreen(null);
  toast(map.route.name, 2);
}
function recover(v = player) {
  if (v === player) setHomeBrakeHold(false);
  let p: Point, heading: number;
  if (race && v.id < 4) {
    const cp = races[v.id];
    const idx = Math.max(0, cp.next - 1);
    p = [...map.route.points[idx]];
    const next =
      map.route.points[Math.min(idx + 1, map.route.points.length - 1)];
    heading = Math.atan2(next[0] - p[0], next[2] - p[2]);
    p[0] += Math.cos(heading) * (v.id % 2 ? 2 : -2);
    p[2] -= Math.sin(heading) * (v.id % 2 ? 2 : -2);
    cp.recovered(p);
    if (v.id > 0) drivers[v.id - 1].target = Math.max(1, cp.next);
  } else {
    const n = nearestRoad(map, v.position.x, v.position.z);
    p = n.position;
    heading = n.heading;
  }
  v.reset(p, heading);
  if (v === player) {
    toast("BACK ON THE ROAD", 1.5);
    cameraInitialized = false;
  } else drivers[v.id - 1].stuck = 0;
}
function settingsItems(): MenuItem[] {
  const sliders: [keyof InputSettings, string, number, number, number][] = [
    ["deadzone", "Steering deadzone", 0, 0.4, 0.01],
    ["curve", "Steering response", 0.5, 2.5, 0.05],
    ["sensitivity", "Steering sensitivity", 0.4, 1.8, 0.05],
    ["triggerDeadzone", "Trigger deadzone", 0, 0.3, 0.01],
    ["cameraSensitivity", "Camera sensitivity", 0.3, 2, 0.1],
    ["vibration", "Vibration strength", 0, 1, 0.1],
    ["shake", "Camera motion", 0, 1, 0.1],
  ];
  return [
    ...sliders.map(([key, label, min, max, step]) => ({
      label,
      value: `‹ ${(input.settings[key] as number).toFixed(2)} ›`,
      adjust: (d: number) => {
        input.updateSettings({
          [key]: clamp((input.settings[key] as number) + d * step, min, max),
        });
        renderMenu();
      },
    })),
    {
      label: "Graphics",
      value: `‹ ${input.settings.quality.toUpperCase()} ›`,
      adjust: (d) => {
        const q = ["low", "medium", "high"] as const;
        input.updateSettings({
          quality: q[(q.indexOf(input.settings.quality) + d + 3) % 3],
        });
        setQuality();
        renderMenu();
      },
    },
    {
      label: "Handling preset",
      value: handling.grip > 1.7 ? "PLANTED" : "BALANCED",
      action: () => {
        const planted = handling.grip <= 1.7;
        handling.grip = planted ? 1.9 : 1.65;
        handling.steerLow = planted ? 0.46 : 0.51;
        localStorage.setItem(
          "blue-county-handling",
          planted ? "planted" : "balanced",
        );
        renderMenu();
      },
    },
    {
      label: "Developer telemetry",
      value: developer ? "ON" : "OFF",
      action: () => {
        developer = !developer;
        renderMenu();
      },
    },
    {
      label: "Restore defaults",
      action: () => {
        input.resetDefaults();
        handling.grip = 1.65;
        handling.steerLow = 0.51;
        localStorage.removeItem("blue-county-handling");
        setQuality();
        renderMenu();
      },
    },
    { label: "Back", action: () => setScreen(returnScreen) },
  ];
}
function renderMenu() {
  const el = $("menu");
  if (!screen) {
    el.innerHTML = "";
    return;
  }
  let title = "",
    intro = "",
    extra = "";
  const settings = () => {
      returnScreen = screen;
      setScreen("settings");
    },
    diagnostics = () => {
      returnScreen = screen;
      setScreen("diagnostics");
    };
  if (screen === "main") {
    title = "BLUE<br>COUNTY<small>WARWICK / 442</small>";
    intro =
      "Your dad’s blue Oldsmobile. Familiar roads.<br>A little more room to open it up.<br><small>Click once for focus and audio. Press a controller button to select it, release, then use A to start.</small>";
    items = [
      {
        label: "Drive from Home",
        detail: "Beverly Drive · free drive",
        action: startFree,
      },
      {
        label: "Race the Ridge",
        detail: "3 laps · 3 rivals · local roads",
        action: startRace,
      },
      {
        label: "Handling grounds",
        detail: "Slalom, braking, circle & ramp",
        action: startTest,
      },
      { label: "Controller & diagnostics", action: diagnostics },
      { label: "Settings & handling", action: settings },
      { label: "Explore the route", action: () => setScreen("route") },
    ];
  } else if (screen === "pause") {
    title = "Take a breath.";
    intro = race
      ? "The race is paused. Resume when you’re ready."
      : "The county can wait.";
    items = [
      { label: "Resume", action: resume },
      { label: "Restart race", action: startRace },
      {
        label: "Return Home",
        detail: race
          ? "Exit this race and return to Beverly Drive"
          : "Beverly Drive",
        action: startFree,
      },
      { label: "Controller & diagnostics", action: diagnostics },
      { label: "Settings & handling", action: settings },
      { label: "Main menu", action: () => setScreen("main") },
    ];
  } else if (screen === "settings") {
    title = "Make it yours.";
    intro = "Use ← → or the D-pad to adjust. Changes save automatically.";
    items = settingsItems();
  } else if (screen === "diagnostics") {
    title = "Controller check.";
    intro =
      "Click once for focus/audio, then press a button on your controller to select it. Standard Xbox layout is automatic.";
    extra = '<pre class="diag" id="diagnostic-data"></pre>';
    items = [
      { label: "Calibrate / remap", action: () => setScreen("bindings") },
      { label: "Test vibration", action: () => input.rumble("impact", 0.6) },
      { label: "Back", action: () => setScreen(returnScreen) },
    ];
  } else if (screen === "bindings") {
    title = "Your controls.";
    intro =
      "Select a control, release everything, then move the axis or press the button. Axis triggers capture rest and travel.";
    extra =
      '<div class="safety" id="calibration">Select a binding below.</div>';
    items = BINDING_NAMES.map((name) => ({
      label: name,
      value: input.getBindings()[name]
        ? JSON.stringify(input.getBindings()[name])
        : "UNBOUND",
      action: () => {
        input.startBindingCapture(name);
        renderMenu();
      },
    }));
    items.push({
      label: "Cancel capture / back",
      action: () => {
        input.cancelBindingCapture();
        setScreen("diagnostics");
      },
    });
  } else if (screen === "route") {
    title = "Roads worth knowing.";
    intro =
      "Home on Beverly Drive. Race on the connected Ridge loop. Cached open map data; no live map service during play.";
    extra = `<img class="route-preview" src="/map/route-preview.svg" alt="Verified Warwick road network and race route"><p class="route-list">${escape(neighborhood.route.streets.join(" → "))}</p><p class="intro">House location: high confidence, two address sources agree. Building appearance and vegetation are approximations. Elevation: USGS 3DEP, softened by coarse sampling.</p>`;
    items = [
      { label: "Drive from Home", action: startFree },
      { label: "Back", action: () => setScreen("main") },
    ];
  } else if (screen === "results") {
    title = "A good run.";
    intro = "The Ridge circuit · race complete";
    const pos = position();
    extra = `<div class="results"><div><strong>${pos}<small> / 4</small></strong><br><span>FINISH POSITION</span></div><div><strong>${formatTime(races[0].elapsed)}</strong><br><span>RACE TIME</span></div></div>`;
    items = [
      { label: "Race again", action: startRace },
      { label: "Return Home", action: startFree },
      { label: "Main menu", action: () => setScreen("main") },
    ];
  }
  el.innerHTML = `<section class="panel"><div class="eyebrow">1968 Oldsmobile 442 · Warwick, New York</div><${screen === "main" ? "h1" : "h2"}>${title}</${screen === "main" ? "h1" : "h2"}><p class="intro">${intro}</p>${safetyMessage ? `<div class="safety">${escape(safetyMessage)}</div>` : ""}${extra}<nav class="menu-items">${items.map((item, i) => `<button class="menu-item ${i === focus ? "focus" : ""}" data-index="${i}"><span>${escape(item.label)}${item.detail ? `<small>${escape(item.detail)}</small>` : ""}</span><span class="value">${item.value ? escape(item.value) : "↗"}</span></button>`).join("")}</nav><div class="foot"><span class="key green">A</span> Select <span class="key">B</span> Back · D-pad to navigate<br>Keyboard: arrows / Enter / Esc · Drive: WASD · Shift boost<br>Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors · ODbL</a> · USGS elevation</div></section>`;
  el.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    button.onclick = () => {
      sound.start();
      focus = Number(button.dataset.index);
      const item = items[focus];
      if (item.adjust) item.adjust(1);
      else item.action?.();
    };
    button.onmouseenter = () => {
      focus = Number(button.dataset.index);
      updateFocus();
    };
  });
  updateFocus();
}
function updateFocus() {
  const buttons = $("menu").querySelectorAll("button");
  buttons.forEach((b, i) => b.classList.toggle("focus", i === focus));
  buttons[focus]?.scrollIntoView({ block: "nearest" });
}
let wasCalibrating = false;
function menuInput(f: InputFrame) {
  if (input.calibration) {
    wasCalibrating = true;
    const el = $("calibration");
    if (el) el.textContent = input.calibration.instruction;
    return;
  }
  if (wasCalibrating) {
    wasCalibrating = false;
    renderMenu();
  }
  if (f.actions.up) {
    focus = (focus - 1 + items.length) % items.length;
    updateFocus();
  }
  if (f.actions.down) {
    focus = (focus + 1) % items.length;
    updateFocus();
  }
  if (f.actions.left) items[focus]?.adjust?.(-1);
  if (f.actions.right) items[focus]?.adjust?.(1);
  if (f.actions.confirm) {
    sound.start();
    items[focus]?.action?.();
  }
  if (f.actions.back) {
    if (screen === "pause") resume();
    else if (screen === "settings" || screen === "diagnostics")
      setScreen(returnScreen);
    else if (screen === "bindings") setScreen("diagnostics");
    else if (screen !== "main") setScreen("main");
  }
  if (f.actions.pause && screen === "pause") resume();
}
function formatTime(t: number) {
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;
}
function position() {
  if (!race || !races.length) return 1;
  const score = (i: number) => {
    const r = races[i],
      v = vehicles[i],
      cp = r.points[Math.min(r.next, r.points.length - 1)];
    return r.finished
      ? 1e7 - r.elapsed
      : r.score * 10000 -
          Math.hypot(cp[0] - v.position.x, cp[2] - v.position.z);
  };
  return 1 + races.slice(1).filter((_, j) => score(j + 1) > score(0)).length;
}
function updateDiagnostics() {
  const el = $("diagnostic-data");
  if (!el) return;
  const d = input.diagnostics();
  el.textContent = `${d.activeDevice}\nMapping: ${d.mapping || "none"} | index: ${d.activeIndex ?? "—"}\nHaptics: ${d.haptics} | neutral gate: ${d.awaitingNeutral}\nRaw axes: ${d.rawAxes.map((n) => n.toFixed(3)).join(" ")}\nLT / RT: ${d.rawTriggers ? `${d.rawTriggers.lt.toFixed(3)} / ${d.rawTriggers.rt.toFixed(3)}` : "—"}\nProcessed steer: ${d.processed.steer.toFixed(3)}\nThrottle / brake: ${d.processed.throttle.toFixed(3)} / ${d.processed.brake.toFixed(3)}\nButtons: ${d.pressedButtons.join(", ") || "none"}\nDevices: ${d.devices.length}${d.needsCalibration ? "\nUnknown mapping: use Calibrate / remap." : ""}`;
}
function simulate(dt: number) {
  simTime += dt;
  const start = performance.now();
  let control: DriveInput = frame;
  // Hold the parked Home car on its driveway grade until deliberate pedal input.
  if (homeBrakeHold) {
    if (
      frame.throttle > 0.01 ||
      frame.brake > 0.01 ||
      frame.boost ||
      frame.handbrake
    )
      setHomeBrakeHold(false);
    else control = { ...frame, brake: 1 };
  }
  if (countdown > 0) {
    countdown -= dt;
    control = { ...idleInput, brake: 1 };
    const c = Math.ceil(countdown);
    if (c !== lastCount) {
      lastCount = c;
      sound.tone(c === 0 ? 880 : 440, 0.12);
      if (c === 0) toast("GO", 1);
    }
  }
  if (frame.reset) {
    recover();
    frame.reset = false;
  }
  const near = nearestRoad(map, player.position.x, player.position.z);
  player.step(
    control,
    dt,
    simTime,
    near.distance < near.road.width / 2 + 1 ||
      environment.isDriveway(player.position.x, player.position.z),
  );
  for (const d of drivers) {
    const v = d.vehicle;
    let command =
      countdown > 0 && v.id < 4 ? { ...idleInput, brake: 1 } : d.input(dt);
    if (race && v.id < 4 && races[v.id]?.finished)
      command = { ...idleInput, brake: 1 };
    v.step(command, dt, simTime, true);
    if (d.stuck > 4) recover(v);
  }
  world.step(events);
  vehicles.forEach((v) => v.sync());
  events.drainContactForceEvents((event) => {
    const a = vehicles.find((v) => v.collider.handle === event.collider1()),
      b = vehicles.find((v) => v.collider.handle === event.collider2()),
      force = event.totalForceMagnitude();
    if (a && b && ((a.id === 0 && b.id <= 3) || (b.id === 0 && a.id <= 3))) {
      const other = a.id === 0 ? b : a;
      ledger.contact(other.id, simTime);
    }
    for (const v of [a, b]) {
      if (!v || v.protection > 0 || simTime - v.lastImpact < 0.25) continue;
      v.lastImpact = simTime;
      const severity = (force * dt) / handling.mass;
      if (v.id === 0) {
        sound.impact(severity);
        input.rumble("impact", clamp(severity / 13, 0.1, 1));
        effects.impact(v.position, Math.min(15, severity));
        if (severity > 9) toast("HARD HIT · HOLD VIEW TO RECOVER", 1.4);
        else if (severity > 2.5) toast("SCRAPE", 0.7);
      } else if (
        v.id <= 3 &&
        severity > 9 &&
        ledger.wreck(v.id, v.life, simTime)
      ) {
        player.bank.earn(`takedown:${v.id}:${v.life}`, 28, simTime, 99999);
        toast("TAKEDOWN  +28 BOOST");
        setTimeout(() => {
          if (vehicles.includes(v)) recover(v);
        }, 700);
      }
    }
  });
  if (race && countdown <= 0) {
    for (let i = 0; i < 4; i++) {
      const v = vehicles[i],
        r = races[i];
      if (r.update([v.position.x, v.position.y, v.position.z], dt) && i === 0) {
        sound.tone(660, 0.055, 0.12);
        if (r.finished) {
          raceFinished = true;
          setScreen("results");
        } else if (r.next === 1) toast(`LAP ${r.lap} / ${r.laps}`);
      }
    }
  }
  for (const v of vehicles) {
    const b = map.bounds;
    if (
      v.position.y < heightAt(map, v.position.x, v.position.z) - 8 ||
      v.position.x < b.minX + 4 ||
      v.position.x > b.maxX - 4 ||
      v.position.z < b.minZ + 4 ||
      v.position.z > b.maxZ - 4
    )
      recover(v);
    const carUp = new T.Vector3(0, 1, 0).applyQuaternion(v.rotation);
    if (carUp.y < 0.25) {
      v.stuck += dt;
      if (v.stuck > 2) recover(v);
    } else v.stuck = 0;
  }
  if (player.speed > 18 && player.grounded > 1) {
    for (const other of vehicles.slice(4)) {
      const distance = player.position.distanceTo(other.position);
      if (
        distance > 2.6 &&
        distance < 5.4 &&
        player.speed - other.speed > 5 &&
        simTime - player.lastImpact > 1
      ) {
        if (player.bank.earn(`near:${other.id}`, 5, simTime, 8))
          toast("CLOSE CALL +5", 0.8);
      }
    }
    const forward = new T.Vector3(0, 0, 1).applyQuaternion(player.rotation);
    const direction =
      forward.x * Math.sin(near.heading) + forward.z * Math.cos(near.heading);
    if (
      near.side * Math.sign(direction) > 1 &&
      near.distance < near.road.width / 2
    )
      player.bank.earn("oncoming", 1, simTime, 1);
  }
  if (player.boosting) input.rumble("boost", 0.2);
  else if (Math.abs(player.slip) > 0.14 && player.grounded > 1)
    input.rumble("slip", Math.min(0.4, Math.abs(player.slip)));
  effects.update(player, dt, simTime);
  physicsMs = performance.now() - start;
}
function renderVehicles(alpha: number) {
  routeMarkers.visible = race;
  vehicles.forEach((v, i) => {
    const root = visuals[i];
    root.position.lerpVectors(v.previous, v.position, alpha);
    root.quaternion.slerpQuaternions(v.previousRotation, v.rotation, alpha);
    if (i === 0) {
      const real = root.userData.car as T.Group;
      manifest.wheels.forEach((w: any, j: number) => {
        const steer = real.getObjectByName(w.steerNode),
          spin = real.getObjectByName(w.spinNode);
        if (steer) {
          steer.rotation.y = w.steering ? v.steering : 0;
          steer.position.y = clamp(v.wheelHeights[j], 0.16, 0.62);
        }
        if (spin) spin.rotation.x = v.wheelSpin;
      });
      root.visible = true;
    }
  });
}
function updateCamera(dt: number) {
  if (inspectionView) {
    camera.position.copy(inspectionView.position);
    camera.lookAt(inspectionView.target);
    camera.fov = 52;
    camera.updateProjectionMatrix();
    placeSun(inspectionView.target);
    return;
  }
  const p = visuals[0].position,
    q = visuals[0].quaternion;
  const forward = new T.Vector3(0, 0, 1).applyQuaternion(q);
  forward.y = 0;
  forward.normalize();
  const heading = Math.atan2(forward.x, forward.z);
  const desiredLook = frame.lookBack ? Math.PI : -frame.lookX * 1.9;
  lookAngle += angleDiff(desiredLook, lookAngle) * Math.min(1, dt * 12);
  lookPitch += (frame.lookY * 0.7 - lookPitch) * Math.min(1, dt * 12);
  const chase = heading + lookAngle,
    dist = cameraMode === 1 ? 4.5 : 8.4 + player.speed * 0.035,
    height = cameraMode === 1 ? 2.1 : 3.7;
  const target = p
    .clone()
    .add(
      new T.Vector3(
        forward.x * (cameraMode === 1 ? 12 : 7 + player.speed * 0.12),
        1.2,
        forward.z * (cameraMode === 1 ? 12 : 7 + player.speed * 0.12),
      ),
    );
  if (frame.lookBack || Math.abs(lookAngle) > 0.3)
    target
      .copy(p)
      .add(new T.Vector3(Math.sin(chase) * 6, 1.2, Math.cos(chase) * 6));
  const desired = p
    .clone()
    .add(
      new T.Vector3(
        -Math.sin(chase) * dist,
        height + lookPitch * 3,
        -Math.cos(chase) * dist,
      ),
    );
  desired.y = Math.max(desired.y, heightAt(map, desired.x, desired.z) + 1.2);
  const origin = p.clone().add(new T.Vector3(0, 1, 0)),
    delta = desired.clone().sub(origin),
    length = delta.length();
  const hit = world.castRay(
    new RAPIER.Ray(origin, delta.normalize()),
    length,
    true,
    undefined,
    undefined,
    player.collider,
    player.body,
    (c) => !c.parent() || c.parent()!.isFixed(),
  );
  if (hit)
    desired
      .copy(origin)
      .addScaledVector(delta, Math.max(1.5, hit.timeOfImpact - 0.4));
  if (!cameraInitialized) {
    camPos.copy(desired);
    camTarget.copy(target);
    cameraInitialized = true;
  } else {
    camPos.lerp(desired, 1 - Math.exp(-dt * 14));
    camTarget.lerp(target, 1 - Math.exp(-dt * 18));
  }
  camera.position.copy(camPos);
  const shake = player.boosting ? input.settings.shake * 0.012 : 0;
  camera.position.y += Math.sin(simTime * 38) * shake;
  camera.lookAt(camTarget);
  camera.fov +=
    (62 +
      Math.min(8, player.speed * 0.12) +
      (player.boosting ? 3 : 0) -
      camera.fov) *
    Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
  placeSun(p);
}
function drawMinimap() {
  const canvas = $<HTMLCanvasElement>("minimap-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d")!,
    w = 440,
    h = 320;
  ctx.clearRect(0, 0, w, h);
  const survey = map.beverlySurvey;
  const localLoop =
    !race &&
    survey &&
    player.position.x > survey.bounds.minX - 80 &&
    player.position.x < survey.bounds.maxX + 80 &&
    player.position.z > survey.bounds.minZ - 80 &&
    player.position.z < survey.bounds.maxZ + 80;
  const scale = localLoop ? 0.47 : 0.28,
    cx = localLoop
      ? (survey.bounds.minX + survey.bounds.maxX) / 2
      : player.position.x,
    cz = localLoop
      ? (survey.bounds.minZ + survey.bounds.maxZ) / 2
      : player.position.z;
  const transform = (p: Point) => [
    (p[0] - cx) * scale + w / 2,
    (p[2] - cz) * scale + h / 2,
  ];
  const path = (points: Point[], color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    points.forEach((p, i) => {
      const [x, z] = transform(p);
      i ? ctx.lineTo(x, z) : ctx.moveTo(x, z);
    });
    ctx.stroke();
  };
  for (const road of map.roads) path(road.points, "#8b9b8e", 2);
  if (localLoop) {
    for (const d of survey.driveways)
      path(
        d.points.map(([x, z]: number[]) => [x, 0, z]),
        "#5f746a",
        1,
      );
    path(survey.loop.points, "#b8e8ba", 3);
  }
  if (race) path(map.route.points, "#e7bd77", 3);
  const home = transform(map.home.position);
  ctx.fillStyle = "#b8e8ba";
  ctx.fillRect(home[0] - 4, home[1] - 4, 8, 8);
  ctx.font = "16px Arial";
  ctx.fillText("H", home[0] + 8, home[1] + 5);
  for (const v of vehicles.slice(1, 4)) {
    const pos = transform([v.position.x, 0, v.position.z]);
    ctx.fillStyle = "#dd9366";
    ctx.beginPath();
    ctx.arc(pos[0], pos[1], 4, 0, 7);
    ctx.fill();
  }
  ctx.save();
  const playerPixel = transform([player.position.x, 0, player.position.z]);
  ctx.translate(...(playerPixel as [number, number]));
  const f = new T.Vector3(0, 0, 1).applyQuaternion(player.rotation);
  ctx.rotate(-Math.atan2(f.x, f.z));
  ctx.fillStyle = "#fff4d3";
  ctx.beginPath();
  ctx.moveTo(0, 9);
  ctx.lineTo(-7, -7);
  ctx.lineTo(7, -7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function hud() {
  const near = nearestRoad(map, player.position.x, player.position.z);
  const stats = race
    ? `<div class="race-stat"><b>${position()} <small>/ 4</small></b><span>POSITION</span></div><div class="race-stat"><b>${races[0]?.lap || 1} <small>/ ${map.route.laps}</small></b><span>LAP</span></div><div class="race-stat"><b>${formatTime(races[0]?.elapsed || 0)}</b><span>TIME</span></div>`
    : '<span class="badge">FREE DRIVE</span>';
  const r = races[0],
    cp = r && map.route.points[Math.min(r.next, map.route.points.length - 1)];
  $("hud").innerHTML =
    `<div class="topbar"><div><div class="brand">BLUE COUNTY</div><div class="place">${escape(near.road.name || "Warwick")} · ${mode === "test" ? "Handling grounds" : "New York"}</div></div><div class="race-status">${stats}</div></div><div class="speedometer"><span class="speed">${Math.round(player.speed * 2.23694)}</span><span class="unit">MPH</span><div class="boost-meter"><i style="width:${player.bank.value}%"></i></div><div class="boost-label"><span>${player.reverse.reverse ? "REVERSE" : `GEAR ${player.gear}`} · ${Math.round(player.rpm)} RPM</span><span><span class="key green">A</span>BOOST</span></div></div><div class="minimap"><div class="map-title"><span>${race ? "RIDGE CIRCUIT" : "LOCAL ROADS"}</span><span>N ↑</span></div><canvas width="440" height="320" id="minimap-canvas"></canvas><div class="map-credit">© OpenStreetMap contributors · ODbL</div></div><div class="controls-bar"><span class="key">RT</span> Throttle <span class="key">LT</span> Brake <span class="key">X</span> Handbrake<br><span class="key">Y</span> Camera <span class="key">View</span> Hold to recover <span class="key">Menu</span> Pause</div>${race && cp ? `<div class="next-turn">NEXT CHECKPOINT<br><b>${Math.round(Math.hypot(cp[0] - player.position.x, cp[2] - player.position.z))} m</b> · ${Math.min(r.next, map.route.points.length - 1)} / ${map.route.points.length - 1}</div>` : ""}${countdown > 0 ? `<div class="center-count">${Math.ceil(countdown)}</div>` : ""}${developer ? `<div class="dev">${renderer.domElement.width} × ${renderer.domElement.height} · ${quality}\nFrame p50 / p95: ${percentile(0.5).toFixed(1)} / ${percentile(0.95).toFixed(1)} ms\nPhysics: ${physicsMs.toFixed(2)} ms · 60 Hz\nSpeed: ${player.speed.toFixed(2)} m/s\nSteer: ${player.steering.toFixed(3)} rad\nSlip: ${((player.slip * 180) / Math.PI).toFixed(1)}° · drift ${player.drift.toFixed(2)}\nWheels grounded: ${player.grounded} / 4\nBoost: ${player.bank.value.toFixed(1)}\nDraws: ${renderer.info.render.calls} · triangles ${renderer.info.render.triangles}</div>` : ""}`;
  drawMinimap();
}
function percentile(p: number) {
  const a = [...frameTimes].sort((a, b) => a - b);
  return a[Math.floor((a.length - 1) * p)] || 0;
}
function animate(now: number) {
  requestAnimationFrame(animate);
  const dt = lastTime ? Math.min(0.1, (now - lastTime) / 1000) : 1 / 60;
  lastTime = now;
  frame = input.sample(dt, screen !== null);
  if (!ready) return;
  if (benchmarkDriver && !screen)
    frame = { ...frame, ...benchmarkDriver.input(dt) };
  if (screen) menuInput(frame);
  else {
    if (frame.actions.pause) setScreen("pause");
    if (frame.actions.camera) cameraMode = (cameraMode + 1) % 2;
  }
  let alpha = 1;
  if (!screen) {
    alpha = clock.tick(dt, simulate);
    frameTimes.push(dt * 1000);
    if (frameTimes.length > 1800) frameTimes.shift();
    frameCount++;
  } else clock.reset();
  renderVehicles(alpha);
  updateCamera(dt);
  environment.update(now / 1000, camera);
  atmosphere.update(now / 1000, camera);
  sound.update(player, frame.throttle, screen !== null);
  presentation.render(scene);
  if (now - lastHud > 100) {
    hud();
    updateDiagnostics();
    lastHud = now;
  }
  if (now > toastUntil) $("toast").textContent = "";
}
window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  presentation.resize(innerWidth, innerHeight);
});
window.addEventListener("keydown", (event) => {
  if (event.code === "F3") {
    developer = !developer;
    event.preventDefault();
  }
});
window.addEventListener("pointerdown", () => sound.start(), { once: true });
async function init() {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  world.integrationParameters.maxCcdSubsteps = 4;
  events = new RAPIER.EventQueue(true);
  const [m, v, gltf] = await Promise.all([
    fetch("/map/warwick.json").then((r) => {
      if (!r.ok) throw new Error("Warwick map is missing. Run npm run map.");
      return r.json();
    }),
    fetch("/assets/vehicle-manifest.json").then((r) => r.json()),
    new GLTFLoader().loadAsync("/assets/oldsmobile-442.glb"),
  ]);
  neighborhood = m;
  manifest = v;
  configureVehicleGeometry(manifest);
  template = gltf.scene;
  template.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  modelLoaded = true;
  await atmosphere.loadReflections(
    scene,
    renderer,
    "/textures/greenwich-park-1k.hdr",
  );
  if (localStorage.getItem("blue-county-handling") === "planted") {
    handling.grip = 1.9;
    handling.steerLow = 0.46;
  }
  buildScene(false);
  setQuality();
  await environment.materials.ready;
  renderVehicles(1);
  updateCamera(1 / 60);
  environment.update(0, camera);
  atmosphere.update(0, camera);
  await renderer.compileAsync(scene, camera);
  // Warm shadow programs, multisampling, and texture uploads under the loading screen.
  presentation.render(scene);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  ready = true;
  $("loading").remove();
  renderMenu();
  requestAnimationFrame(animate);
}
// Developer-only hooks are gated by an explicit query flag; never treated as physical controller evidence.
if (new URLSearchParams(location.search).has("test")) {
  let testDriver: Driver | null = null;
  (window as any).__game = {
    referenceFacades: () => {
      const facades: unknown[] = [];
      environment.root.traverse((object) => {
        if (object.userData.referenceFacades)
          facades.push(...object.userData.referenceFacades);
      });
      return facades;
    },
    getState: () => ({
      ready,
      screen,
      mode,
      race,
      countdown,
      modelLoaded,
      position: player?.position.toArray(),
      rotation: player?.rotation.toArray(),
      chassisHalfExtents: player && player.collider.halfExtents(),
      speed: player?.speed,
      grounded: player?.grounded,
      slip: player?.slip,
      boost: player?.bank.value,
      checkpoint: races[0]?.next,
      lap: races[0]?.lap,
      finished: raceFinished,
      routePoints: map?.route.points.length,
      near:
        player &&
        nearestRoad(map, player.position.x, player.position.z).distance,
      ai: drivers.map((d) => ({
        id: d.vehicle.id,
        target: d.target,
        speed: d.vehicle.speed,
        position: d.vehicle.position.toArray(),
        checkpoint: races[d.vehicle.id]?.next,
        lap: races[d.vehicle.id]?.lap,
      })),
      testDriver: testDriver && {
        target: testDriver.target,
        command: testDriver.input(0),
      },
      metrics: {
        quality,
        frames: frameCount,
        p50: percentile(0.5),
        p95: percentile(0.95),
        physicsMs,
        width: renderer.domElement.width,
        height: renderer.domElement.height,
        draws: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        vegetation: environment?.vegetation?.stats,
        scenery: environment?.root.children
          .map((o) => o.userData.neighborhoodStats || o.userData.statistics)
          .filter(Boolean),
      },
      renderer: renderer
        .getContext()
        .getParameter(renderer.getContext().RENDERER),
    }),
    startFree,
    inspectView: (position: Point, target: Point) => {
      inspectionView = {
        position: new T.Vector3(...position),
        target: new T.Vector3(...target),
      };
    },
    clearInspectionView: () => {
      inspectionView = null;
      cameraInitialized = false;
    },
    quality: (value: "low" | "medium" | "high") => {
      input.updateSettings({ quality: value });
      setQuality();
    },
    startRace,
    startTest,
    resume,
    pause: () => setScreen("pause"),
    recover,
    route: () => map.route.points,
    neighborhoodSurvey: () => map.beverlySurvey,
    surfaceAt: (x: number, z: number) => heightAt(map, x, z),
    beginNeighborhoodDrive: () => {
      startFree();
      let path: Point[] = map.beverlySurvey.loop.points.slice(0, -1);
      const departure = map.home.departurePath ?? [map.home.position];
      const roadStart = departure[departure.length - 1];
      let i = path.reduce(
        (best, p, index) =>
          Math.hypot(p[0] - roadStart[0], p[2] - roadStart[2]) <
          Math.hypot(path[best][0] - roadStart[0], path[best][2] - roadStart[2])
            ? index
            : best,
        0,
      );
      const a = path[i],
        b = path[(i + 1) % path.length];
      if (
        Math.abs(
          angleDiff(Math.atan2(b[0] - a[0], b[2] - a[2]), map.home.heading),
        ) >
        Math.PI / 2
      ) {
        path.reverse();
        i = path.length - 1 - i;
      }
      path = [...departure, ...path.slice(i + 1), ...path.slice(0, i + 2)];
      benchmarkDriver = new Driver(player, path);
      benchmarkDriver.speed = 11;
      frameTimes = [];
      return { points: path.length, path };
    },
    advanceNeighborhoodDrive: (seconds: number) => {
      if (!benchmarkDriver) throw new Error("Start neighborhood drive first");
      const d = benchmarkDriver;
      let steps = 0,
        airborne = 0;
      for (; steps < seconds * 60 && !d.finished; steps++) {
        frame = { ...emptyInput(), ...d.input(1 / 60) };
        simulate(1 / 60);
        if (player.grounded < 2) airborne++;
      }
      renderVehicles(1);
      updateCamera(1 / 60);
      return {
        finished: d.finished,
        target: d.target,
        points: d.path.length,
        steps,
        airborne,
        state: (window as any).__game.getState(),
      };
    },
    beginBenchmark: () => {
      startRace();
      benchmarkDriver = new Driver(player, map.route.points);
      frameTimes = [];
      frameCount = 0;
    },
    endBenchmark: () => {
      benchmarkDriver = null;
      setScreen("pause");
      return (window as any).__game.getState();
    },
    driveHomeExit: () => {
      startFree();
      const road = map.roads.find((r) => r.name === "Beverly Drive")!;
      const departure = map.home.departurePath ?? [map.home.position];
      const roadStart = departure[departure.length - 1];
      let index = 0,
        best = Infinity;
      road.points.forEach((p, i) => {
        const d = Math.hypot(p[0] - roadStart[0], p[2] - roadStart[2]);
        if (d < best) {
          best = d;
          index = i;
        }
      });
      const a = road.points[index],
        b = road.points[Math.min(index + 1, road.points.length - 1)];
      const forward =
        Math.abs(
          angleDiff(Math.atan2(b[0] - a[0], b[2] - a[2]), map.home.heading),
        ) <
        Math.PI / 2;
      const path: Point[] = [
        ...departure,
        ...(forward
          ? road.points.slice(index)
          : road.points.slice(0, index + 1).reverse()),
      ];
      const end = path[path.length - 1];
      let bestRoad = map.roads[0],
        join = 0,
        dist = Infinity;
      for (const r of map.roads.filter((r) => r.name === "West Ridge Road"))
        r.points.forEach((p, i) => {
          const d = Math.hypot(p[0] - end[0], p[2] - end[2]);
          if (d < dist) {
            dist = d;
            bestRoad = r;
            join = i;
          }
        });
      const tail = bestRoad.points.slice(join + 1);
      path.push(
        ...(tail.length > 4
          ? tail
          : bestRoad.points.slice(0, join).reverse()
        ).slice(0, 20),
      );
      const driver = new Driver(player, path);
      driver.speed = 12;
      for (let t = 0; t < 60 * 60; t++) {
        frame = { ...emptyInput(), ...driver.input(1 / 60) };
        simulate(1 / 60);
        if (driver.target >= path.length - 1) break;
      }
      setScreen("pause");
      return {
        state: (window as any).__game.getState(),
        road: nearestRoad(map, player.position.x, player.position.z).road.name,
        pathPoints: path.length,
        driverTarget: driver.target,
      };
    },
    simulateInput: (command: DriveInput, seconds: number) => {
      frame = { ...emptyInput(), ...command };
      for (let t = 0; t < seconds; t += 1 / 60) simulate(1 / 60);
      return (window as any).__game.getState();
    },
    driveAI: (seconds: number) => {
      const d = (testDriver = new Driver(player, map.route.points));
      d.target = races[0]?.next || 1;
      for (let t = 0; t < seconds; t += 1 / 60) {
        frame = { ...emptyInput(), ...d.input(1 / 60) };
        simulate(1 / 60);
        if (raceFinished) break;
      }
      setScreen(raceFinished ? "results" : "pause");
      return (window as any).__game.getState();
    },
    teleport: (point: Point, heading: number) => {
      setHomeBrakeHold(false);
      player.reset(point, heading);
    },
    input,
  };
}
init().catch((error) => {
  console.error(error);
  $("loading").innerHTML =
    `Couldn’t start<span>${escape(String(error))}</span>`;
});
