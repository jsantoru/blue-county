import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  InputManager,
  MenuRepeater,
  normalizeSettings,
  processLook,
  processSteering,
  processTrigger,
  readBinding,
  rescaleDeadzone,
  type PadState,
} from "../src/input";

function makePad(index = 2, mapping = "standard"): PadState {
  return {
    id: `Test USB ${index}`,
    index,
    mapping,
    connected: true,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })),
  };
}
function button(pad: PadState, index: number, value: number): void {
  (pad.buttons as { value: number; pressed: boolean }[])[index] = {
    value,
    pressed: value > 0.5,
  };
}
function axis(pad: PadState, index: number, value: number): void {
  (pad.axes as number[])[index] = value;
}
function harness(pad = makePad()) {
  let pads: (PadState | null)[] = [null, null, pad];
  const getGamepads = vi.fn(() => pads);
  const onSafetyPause = vi.fn();
  const storage = {
    getItem: vi.fn(() => null as string | null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
  const input = new InputManager({
    getGamepads,
    onSafetyPause,
    storage,
    window: null,
    document: null,
  });
  const select = () => {
    button(pad, 0, 1);
    input.sample(1 / 60, true);
    button(pad, 0, 0);
    input.sample(1 / 60, true);
  };
  return {
    input,
    pad,
    select,
    getGamepads,
    onSafetyPause,
    storage,
    setPads: (value: (PadState | null)[]) => {
      pads = value;
    },
  };
}
const actions = (patch = {}) => ({
  up: false,
  down: false,
  left: false,
  right: false,
  confirm: false,
  back: false,
  pause: false,
  camera: false,
  ...patch,
});

function keyEvent(host: Window, code: string, down: boolean): void {
  const event = new Event(down ? "keydown" : "keyup", { cancelable: true });
  Object.defineProperties(event, {
    code: { value: code },
    repeat: { value: false },
  });
  host.dispatchEvent(event);
}

describe("on-foot controls", () => {
  it("retains keyboard/mouse hints while a selected controller is idle, ignoring stick drift", () => {
    const host = new EventTarget() as Window,
      pad = makePad();
    const input = new InputManager({
      getGamepads: () => [pad],
      window: host,
      document: null,
      storage: null,
    });
    button(pad, 0, 1);
    input.sample(1 / 60);
    button(pad, 0, 0);
    input.sample(1 / 60);
    expect(input.sample(1 / 60).source).toBe("gamepad");
    keyEvent(host, "KeyW", true);
    expect(input.sample(1 / 60).source).toBe("keyboard");
    keyEvent(host, "KeyW", false);
    axis(pad, 0, 0.06);
    axis(pad, 1, -0.05);
    expect(input.sample(1 / 60).source).toBe("keyboard");
    axis(pad, 1, -0.8);
    expect(input.sample(1 / 60).source).toBe("gamepad");
    input.consume();
    expect(input.sample(1 / 60)).toMatchObject({ source: "gamepad", moveY: 0 });
    axis(pad, 1, 0);
    input.sample(1 / 60);
    input.addMouseLook(6, 0);
    expect(input.sample(1 / 60).source).toBe("keyboard");
    expect(input.sample(1 / 60).source).toBe("keyboard");
    input.dispose();
  });
  it("keeps diagonal keyboard movement normalized and separate from driving axes", () => {
    const host = new EventTarget() as Window;
    const input = new InputManager({
      window: host,
      document: null,
      storage: null,
      getGamepads: () => [],
    });
    keyEvent(host, "KeyW", true);
    keyEvent(host, "KeyD", true);
    keyEvent(host, "ShiftLeft", true);
    const diagonal = input.sample(1 / 60);
    expect(Math.hypot(diagonal.moveX, diagonal.moveY)).toBeCloseTo(1);
    expect(diagonal.moveX).toBeCloseTo(Math.SQRT1_2);
    expect(diagonal.moveY).toBeCloseTo(Math.SQRT1_2);
    expect(diagonal).toMatchObject({
      throttle: 1,
      steer: 1,
      sprint: true,
      boost: true,
    });
    keyEvent(host, "KeyD", false);
    expect(input.sample(1 / 60).moveY).toBe(1);
    keyEvent(host, "KeyS", true);
    expect(input.sample(1 / 60).moveY).toBe(0);
    input.dispose();
  });
  it("uses a radial left-stick deadzone and retains analog walking speed", () => {
    const { input, pad, select } = harness();
    select();
    axis(pad, 0, 0.07);
    axis(pad, 1, -0.07);
    expect(input.sample(1 / 60)).toMatchObject({ moveX: 0, moveY: 0 });
    axis(pad, 0, 0);
    axis(pad, 1, -0.6);
    expect(input.sample(1 / 60).moveY).toBeCloseTo(0.5);
    axis(pad, 0, 1);
    axis(pad, 1, -1);
    const diagonal = input.sample(1 / 60);
    expect(Math.hypot(diagonal.moveX, diagonal.moveY)).toBeCloseTo(1);
    expect(diagonal.moveX).toBeCloseTo(diagonal.moveY);
  });
  it("uses Y/F and X/Space press edges and moves camera cycling to R3", () => {
    const { input, pad, select } = harness();
    select();
    button(pad, 3, 1);
    button(pad, 2, 1);
    const first = input.sample(1 / 60);
    expect(first).toMatchObject({ interact: true, jump: true });
    expect(first.actions.camera).toBe(false);
    for (let i = 0; i < 90; i++)
      expect(input.sample(1 / 60)).toMatchObject({
        interact: false,
        jump: false,
      });
    button(pad, 3, 0);
    button(pad, 2, 0);
    input.sample(1 / 60);
    // Completing a transfer with Y already released must not swallow a new press.
    input.consumeInteraction();
    button(pad, 3, 1);
    button(pad, 11, 1);
    expect(input.sample(1 / 60)).toMatchObject({
      interact: true,
      actions: { camera: true },
    });
    expect(input.sample(1 / 60).actions.camera).toBe(false);

    const host = new EventTarget() as Window;
    const keyboard = new InputManager({
      window: host,
      document: null,
      storage: null,
      getGamepads: () => [],
    });
    keyEvent(host, "KeyF", true);
    keyEvent(host, "Space", true);
    expect(keyboard.sample(1 / 60)).toMatchObject({
      interact: true,
      jump: true,
    });
    expect(keyboard.sample(1 / 60)).toMatchObject({
      interact: false,
      jump: false,
    });
    keyboard.dispose();
  });

  it("stops idle walking and camera drift after both sticks have been used", () => {
    const { input, pad, select } = harness();
    select();
    axis(pad, 0, 0.8);
    axis(pad, 2, 0.8);
    expect(input.sample(1 / 60).moveX).toBeCloseTo(0.75);
    // Return to a noisy center after deliberate movement. No consume()/menu
    // gate is involved: these values must be rejected by the radial deadzones.
    axis(pad, 0, 0.14);
    axis(pad, 1, 0.08);
    axis(pad, 2, 0.18);
    axis(pad, 3, -0.08);
    for (let i = 0; i < 300; i++) {
      const frame = input.sample(1 / 60);
      expect(frame).toMatchObject({ moveX: 0, moveY: 0, lookX: 0, lookY: 0 });
    }
    // Driving has its own more sensitive deadzone; fixing drift must not dull it.
    expect(input.sample(1 / 60).steer).toBeGreaterThan(0);
    axis(pad, 1, 0);
    axis(pad, 0, 0.25);
    expect(input.sample(1 / 60).moveX).toBeCloseTo(0.0625);
    input.addMouseLook(1, -1);
    expect(input.sample(1 / 60)).toMatchObject({ mouseX: 1, mouseY: -1 });
  });

  it("tunes walking, camera and steering deadzones independently", () => {
    const { input, pad, select } = harness();
    select();
    input.updateSettings({ walkingDeadzone: 0.3, cameraDeadzone: 0.1 });
    axis(pad, 0, 0.25);
    axis(pad, 2, 0.25);
    const frame = input.sample(1 / 60);
    expect(frame.moveX).toBe(0);
    expect(frame.lookX).toBeCloseTo((0.25 - 0.1) / 0.9);
    expect(frame.steer).toBeCloseTo(processSteering(0.25, DEFAULT_SETTINGS));
    expect(input.settings.deadzone).toBe(DEFAULT_SETTINGS.deadzone);
  });
  it("allows walking before Y is released after exit while debouncing the interaction", () => {
    const { input, pad, select } = harness();
    select();
    axis(pad, 1, -1);
    button(pad, 3, 1);
    expect(input.sample(1 / 60).interact).toBe(true);
    input.consumeInteraction();
    for (let i = 0; i < 120; i++)
      expect(input.sample(1 / 60)).toMatchObject({ moveY: 1, interact: false });
    button(pad, 2, 1);
    expect(input.sample(1 / 60)).toMatchObject({
      moveY: 1,
      jump: true,
      interact: false,
    });
    button(pad, 3, 0);
    button(pad, 2, 0);
    input.sample(1 / 60);
    button(pad, 3, 1);
    expect(input.sample(1 / 60)).toMatchObject({
      moveY: 1,
      interact: true,
    });
  });
  it("preserves an accelerator held during entry when the transfer completes", () => {
    const { input, pad, select } = harness();
    select();
    button(pad, 3, 1);
    expect(input.sample(1 / 60).interact).toBe(true);
    input.consumeInteraction();
    button(pad, 7, 0.75);
    axis(pad, 0, 0.6);
    button(pad, 3, 0);
    for (let i = 0; i < 100; i++) input.sample(1 / 60);
    // main debounces interaction again at the end of the seat transfer.
    input.consumeInteraction();
    const frame = input.sample(1 / 60);
    expect(frame.throttle).toBeCloseTo(processTrigger(0.75, 0.04));
    expect(frame.steer).toBeGreaterThan(0.3);
    expect(frame.interact).toBe(false);
  });
  it("debounces keyboard interaction without stopping held movement or mouse look", () => {
    const host = new EventTarget() as Window;
    const input = new InputManager({
      window: host,
      document: null,
      storage: null,
      getGamepads: () => [],
    });
    keyEvent(host, "KeyW", true);
    keyEvent(host, "KeyF", true);
    expect(input.sample(1 / 60).interact).toBe(true);
    input.consumeInteraction();
    input.addMouseLook(12, -4);
    expect(input.sample(1 / 60)).toMatchObject({
      moveY: 1,
      throttle: 1,
      interact: false,
      mouseX: 12,
      mouseY: -4,
    });
    keyEvent(host, "KeyF", false);
    input.sample(1 / 60);
    keyEvent(host, "KeyF", true);
    expect(input.sample(1 / 60).interact).toBe(true);
    input.dispose();
  });
  it("silences foot actions in menus, on disconnect and until deliberate resume", () => {
    const { input, pad, select, setPads } = harness();
    select();
    axis(pad, 1, -1);
    button(pad, 0, 1);
    button(pad, 2, 1);
    button(pad, 3, 1);
    expect(input.sample(1 / 60, true)).toMatchObject({
      moveY: 0,
      sprint: false,
      jump: false,
      interact: false,
    });
    // Menu-held jump/interact cannot become a fresh edge merely because the menu closes.
    expect(input.sample(1 / 60)).toMatchObject({
      jump: false,
      interact: false,
    });
    setPads([]);
    expect(input.sample(1 / 60)).toMatchObject({
      moveY: 0,
      sprint: false,
      jump: false,
      interact: false,
    });
    setPads([pad]);
    input.sample(1 / 60);
    axis(pad, 1, 0);
    for (const i of [0, 2, 3]) button(pad, i, 0);
    input.sample(1 / 60);
    axis(pad, 1, -1);
    expect(input.sample(1 / 60).moveY).toBe(0);
    input.resume();
    axis(pad, 1, 0);
    input.sample(1 / 60);
    axis(pad, 1, -1);
    expect(input.sample(1 / 60).moveY).toBe(1);
  });
  it("consumes mouse movement exactly once and discards it across every safety gate", () => {
    const { input, pad, select, setPads } = harness();
    select();
    input.updateSettings({ cameraSensitivity: 1.5 });
    input.addMouseLook(10, -5);
    input.addMouseLook(2, 1);
    expect(input.sample(1 / 60)).toMatchObject({ mouseX: 18, mouseY: -6 });
    expect(input.sample(1 / 60)).toMatchObject({ mouseX: 0, mouseY: 0 });
    input.addMouseLook(40, 30);
    expect(input.sample(1 / 60, true)).toMatchObject({ mouseX: 0, mouseY: 0 });
    expect(input.sample(1 / 60)).toMatchObject({ mouseX: 0, mouseY: 0 });
    input.addMouseLook(20, 20);
    input.consume();
    expect(input.sample(1 / 60)).toMatchObject({ mouseX: 0, mouseY: 0 });
    input.startBindingCapture("interact");
    input.addMouseLook(20, 20);
    expect(input.sample(1 / 60)).toMatchObject({ mouseX: 0, mouseY: 0 });
    input.cancelBindingCapture();
    input.sample(1 / 60);
    input.addMouseLook(20, 20);
    setPads([]);
    expect(input.sample(1 / 60)).toMatchObject({ mouseX: 0, mouseY: 0 });
    input.addMouseLook(20, 20);
    setPads([pad]);
    expect(input.sample(1 / 60)).toMatchObject({ mouseX: 0, mouseY: 0 });
  });
  it("migrates old standard remaps without colliding with interact or losing default movement", () => {
    const pad = makePad();
    const storage = {
      getItem: () =>
        JSON.stringify({
          version: 1,
          settings: { deadzone: 0.2 },
          bindings: {
            [pad.id]: {
              camera: { kind: "button", index: 3 },
              boost: { kind: "button", index: 4 },
            },
          },
        }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const input = new InputManager({
      getGamepads: () => [pad],
      storage,
      window: null,
      document: null,
    });
    button(pad, 0, 1);
    input.sample(1 / 60);
    button(pad, 0, 0);
    input.sample(1 / 60);
    expect(input.settings.deadzone).toBe(0.2);
    expect(input.getBindings()).toMatchObject({
      camera: { kind: "button", index: 11 },
      interact: { kind: "button", index: 3 },
      moveX: { kind: "axis", index: 0 },
      moveY: { kind: "axis", index: 1 },
      boost: { kind: "button", index: 4 },
      sprint: { kind: "button", index: 4 },
    });
    expect(JSON.parse(storage.setItem.mock.calls.at(-1)![1]).version).toBe(2);
  });
  it("does not assume foot axes on unknown devices and supports signed movement capture", () => {
    const { input, pad, select } = harness(makePad(2, ""));
    select();
    axis(pad, 0, 1);
    axis(pad, 1, -1);
    button(pad, 3, 1);
    expect(input.sample(1 / 60)).toMatchObject({
      moveX: 0,
      moveY: 0,
      interact: false,
    });
    axis(pad, 0, 0);
    axis(pad, 1, 0);
    button(pad, 3, 0);
    input.startBindingCapture("moveY");
    expect(input.calibration?.instruction).toContain("DOWN");
    axis(pad, 4, -1);
    input.sample(1 / 60);
    expect(input.getBindings().moveY).toEqual({
      kind: "axis",
      index: 4,
      invert: true,
    });
    axis(pad, 4, 0);
    input.sample(1 / 60);
    axis(pad, 4, 1);
    expect(input.sample(1 / 60).moveY).toBe(1);
  });
  it("retains pending migrations for disconnected devices when settings are saved", () => {
    const pad = makePad();
    let saved = JSON.stringify({
      version: 1,
      bindings: { [pad.id]: { camera: { kind: "button", index: 3 } } },
    });
    const storage = {
      getItem: () => saved,
      setItem: (_key: string, value: string) => {
        saved = value;
      },
      removeItem: vi.fn(),
    };
    const beforeConnect = new InputManager({
      getGamepads: () => [],
      storage,
      window: null,
      document: null,
    });
    beforeConnect.updateSettings({ cameraSensitivity: 1.2 });
    expect(JSON.parse(saved).version).toBe(2);
    beforeConnect.dispose();
    const restored = new InputManager({
      getGamepads: () => [pad],
      storage,
      window: null,
      document: null,
    });
    button(pad, 0, 1);
    restored.sample(1 / 60);
    button(pad, 0, 0);
    restored.sample(1 / 60);
    expect(restored.getBindings().camera).toEqual({
      kind: "button",
      index: 11,
    });
    expect(restored.settings.cameraSensitivity).toBe(1.2);
    expect(JSON.parse(saved).legacyBindings).toEqual([]);
    restored.dispose();
  });
  it("preserves a nonstandard device's camera mapping instead of guessing its Y button", () => {
    const pad = makePad(2, "");
    const storage = {
      getItem: () =>
        JSON.stringify({
          version: 1,
          bindings: {
            [pad.id]: {
              camera: { kind: "button", index: 3 },
              steer: { kind: "axis", index: 4, invert: true },
            },
          },
        }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const input = new InputManager({
      getGamepads: () => [pad],
      storage,
      window: null,
      document: null,
    });
    button(pad, 0, 1);
    input.sample(1 / 60);
    button(pad, 0, 0);
    input.sample(1 / 60);
    expect(input.getBindings().camera).toEqual({ kind: "button", index: 3 });
    expect(input.getBindings().moveX).toEqual({
      kind: "axis",
      index: 4,
      invert: true,
    });
    expect(input.getBindings().interact).toBeUndefined();
    input.dispose();
  });
});

describe("analog processing", () => {
  it("migrates shared deadzones without losing stronger old filtering or explicit new preferences", () => {
    expect(normalizeSettings({ deadzone: 0.12 })).toMatchObject({
      walkingDeadzone: 0.2,
      cameraDeadzone: 0.22,
    });
    expect(normalizeSettings({ deadzone: 0.35 })).toMatchObject({
      deadzone: 0.35,
      walkingDeadzone: 0.35,
      cameraDeadzone: 0.35,
    });
    expect(
      normalizeSettings({
        deadzone: 0.35,
        walkingDeadzone: 0.15,
        cameraDeadzone: 0.18,
      }),
    ).toMatchObject({
      deadzone: 0.35,
      walkingDeadzone: 0.15,
      cameraDeadzone: 0.18,
    });
    expect(
      normalizeSettings({ walkingDeadzone: -1, cameraDeadzone: 2 }),
    ).toMatchObject({
      walkingDeadzone: 0,
      cameraDeadzone: 0.45,
    });
  });
  it("rescales outside the deadzone, preserving endpoints and symmetry", () => {
    expect(rescaleDeadzone(0.1, 0.12)).toBe(0);
    expect(rescaleDeadzone(0.56, 0.12)).toBeCloseTo(0.5);
    expect(rescaleDeadzone(-0.56, 0.12)).toBeCloseTo(-0.5);
    expect(rescaleDeadzone(1, 0.12)).toBe(1);
    expect(rescaleDeadzone(-1, 0.12)).toBe(-1);
  });
  it("preserves partial trigger values independently of pressed", () => {
    const pad = makePad();
    button(pad, 7, 0.25);
    button(pad, 6, 0.7);
    expect(pad.buttons[7].pressed).toBe(false);
    expect(readBinding(pad, { kind: "button", index: 7 })).toBe(0.25);
    expect(processTrigger(0.25, 0.04)).toBeCloseTo(0.21875);
    expect(processTrigger(0.7, 0.04)).toBeCloseTo(0.6875);
    expect(processTrigger(1, 0.04)).toBe(1);
    expect(processTrigger(0.02, 0.04)).toBe(0);
  });
  it("applies predictable response curve with no time filter", () => {
    expect(
      processSteering(0.56, { deadzone: 0.12, curve: 2, sensitivity: 1 }),
    ).toBeCloseTo(0.25);
    expect(processSteering(1, { ...DEFAULT_SETTINGS, sensitivity: 1.8 })).toBe(
      1,
    );
    expect(processSteering(-1, { ...DEFAULT_SETTINGS, sensitivity: 1.8 })).toBe(
      -1,
    );
    expect(processLook(0.08, -0.08)).toEqual([0, 0]);
    expect(Math.hypot(...processLook(1, 1))).toBeCloseTo(1);
  });
  it("handles calibrated trigger axes with -1 idle or inverted range", () => {
    const pad = makePad();
    axis(pad, 2, -1);
    expect(readBinding(pad, { kind: "axis", index: 2, rest: -1, end: 1 })).toBe(
      0,
    );
    axis(pad, 2, 0);
    expect(readBinding(pad, { kind: "axis", index: 2, rest: -1, end: 1 })).toBe(
      0.5,
    );
    axis(pad, 2, -1);
    expect(readBinding(pad, { kind: "axis", index: 2, rest: 1, end: -1 })).toBe(
      1,
    );
  });
  it("rejects malformed settings and clamps all saved ranges", () => {
    expect(
      normalizeSettings({
        curve: NaN,
        deadzone: 5,
        vibration: -2,
        quality: "ultra" as never,
      }),
    ).toMatchObject({
      curve: DEFAULT_SETTINGS.curve,
      deadzone: 0.45,
      vibration: 0,
      quality: "high",
    });
  });
});

describe("frame polling, selection and safety", () => {
  it("recognizes an exposed neutral controller without a right-stick gesture", () => {
    const { input, pad } = harness();
    expect(input.sample(1 / 60).source).toBe("none");
    expect(input.diagnostics().activeIndex).toBe(2);
    button(pad, 7, 0.65);
    const frame = input.sample(1 / 60);
    expect(frame.source).toBe("gamepad");
    expect(frame.throttle).toBeCloseTo(processTrigger(0.65, 0.04));
  });
  it("prefers a fresh controller button over an idle device at initial selection", () => {
    const { input, pad, setPads } = harness();
    const other = makePad(5);
    button(other, 0, 1);
    setPads([null, null, pad, null, null, other]);
    expect(input.sample(1 / 60).boost).toBe(false);
    expect(input.diagnostics().activeIndex).toBe(5);
    // The held selection press is consumed, but a new pedal input still works.
    button(other, 7, 0.7);
    const frame = input.sample(1 / 60);
    expect(frame.boost).toBe(false);
    expect(frame.throttle).toBeCloseTo(processTrigger(0.7, 0.04));
  });
  it("prefers a standard controller to an idle unknown device", () => {
    const { input, pad, setPads } = harness();
    const unknown = makePad(0, "");
    setPads([unknown, null, pad]);
    input.sample(1 / 60);
    expect(input.diagnostics()).toMatchObject({
      activeIndex: 2,
      needsCalibration: false,
    });
  });
  it("does not replace keyboard hints merely because an idle controller appears", () => {
    const host = new EventTarget() as Window;
    const pad = makePad();
    let pads: PadState[] = [];
    const input = new InputManager({
      window: host,
      document: null,
      storage: null,
      getGamepads: () => pads,
    });
    keyEvent(host, "KeyW", true);
    expect(input.sample(1 / 60).source).toBe("keyboard");
    keyEvent(host, "KeyW", false);
    input.sample(1 / 60);
    pads = [pad];
    expect(input.sample(1 / 60).source).toBe("keyboard");
    expect(input.diagnostics().activeIndex).toBe(2);
    axis(pad, 1, -0.7);
    expect(input.sample(1 / 60).source).toBe("gamepad");
    input.dispose();
  });
  it("does not let a right-stick resting offset block fresh movement or throttle", () => {
    const { input, pad, select } = harness();
    axis(pad, 2, 0.22);
    select();
    axis(pad, 1, -0.8);
    button(pad, 7, 0.65);
    for (let i = 0; i < 120; i++) {
      const frame = input.sample(1 / 60);
      expect(frame.moveY).toBeCloseTo((0.8 - 0.2) / (1 - 0.2));
      expect(frame.throttle).toBeCloseTo(processTrigger(0.65, 0.04));
    }
    // Releasing the consumed camera axis re-arms just that axis.
    axis(pad, 2, 0);
    input.sample(1 / 60);
    axis(pad, 2, 0.7);
    expect(input.sample(1 / 60).lookX).toBeGreaterThan(0.6);
  });
  it("keeps held keyboard movement active when a controller is automatically adopted", () => {
    const host = new EventTarget() as Window;
    const pad = makePad();
    let pads: PadState[] = [];
    const input = new InputManager({
      window: host,
      document: null,
      storage: null,
      getGamepads: () => pads,
    });
    keyEvent(host, "KeyW", true);
    expect(input.sample(1 / 60).moveY).toBe(1);
    // The new device may expose resting offsets or a stick already held.
    axis(pad, 0, 0.6);
    axis(pad, 2, 0.22);
    pads = [pad];
    const frame = input.sample(1 / 60);
    expect(input.diagnostics().activeIndex).toBe(2);
    expect(frame).toMatchObject({
      source: "keyboard",
      moveY: 1,
      throttle: 1,
      steer: 0,
      lookX: 0,
    });
    expect(input.sample(1 / 60)).toMatchObject({ moveY: 1, throttle: 1 });
    keyEvent(host, "KeyW", false);
    axis(pad, 0, 0);
    axis(pad, 2, 0);
    input.sample(1 / 60);
    axis(pad, 0, 0.6);
    expect(input.sample(1 / 60).steer).toBeGreaterThan(0.3);
    input.dispose();
  });
  it("preserves keyboard menu edges and repeat timing when an idle pad appears", () => {
    const host = new EventTarget() as Window;
    let pads: PadState[] = [];
    const input = new InputManager({
      window: host,
      document: null,
      storage: null,
      getGamepads: () => pads,
    });
    keyEvent(host, "ArrowDown", true);
    expect(input.sample(0.1, true).actions.down).toBe(true);
    expect(input.sample(0.1, true).actions.down).toBe(false);
    pads = [makePad()];
    keyEvent(host, "Enter", true);
    expect(input.sample(0.1, true).actions).toMatchObject({
      down: false,
      confirm: true,
    });
    expect(input.sample(0.1, true).actions.down).toBe(false);
    expect(input.sample(0.05, true).actions.down).toBe(true);
    input.dispose();
  });
  it("releases consumed controls independently while allowing other new inputs", () => {
    const { input, pad, select } = harness();
    select();
    button(pad, 0, 1);
    button(pad, 7, 1);
    input.sample(1 / 60, true);
    input.consume();
    button(pad, 6, 0.5);
    let frame = input.sample(1 / 60);
    expect(frame).toMatchObject({ boost: false, sprint: false, throttle: 0 });
    expect(frame.brake).toBeCloseTo(processTrigger(0.5, 0.04));
    button(pad, 0, 0);
    input.sample(1 / 60);
    button(pad, 0, 1);
    frame = input.sample(1 / 60);
    expect(frame).toMatchObject({ boost: true, sprint: true, throttle: 0 });
    // RT does not require another control to be released when it is re-armed.
    button(pad, 7, 0);
    input.sample(1 / 60);
    button(pad, 7, 0.6);
    expect(input.sample(1 / 60).throttle).toBeCloseTo(
      processTrigger(0.6, 0.04),
    );
  });
  it("discards pre-menu mouse deltas but accepts new look while a consumed button remains held", () => {
    const { input, pad, select } = harness();
    select();
    button(pad, 0, 1);
    input.sample(1 / 60, true);
    input.addMouseLook(80, 40);
    input.consume();
    expect(input.sample(1 / 60)).toMatchObject({ mouseX: 0, mouseY: 0 });
    input.addMouseLook(9, -3);
    expect(input.sample(1 / 60)).toMatchObject({
      mouseX: 9,
      mouseY: -3,
      boost: false,
      sprint: false,
    });
  });
  it("applies the separate camera deadzone to drift and retains full travel", () => {
    const { input, pad, select } = harness();
    select();
    input.updateSettings({ cameraDeadzone: 0.3 });
    axis(pad, 2, 0.2);
    axis(pad, 3, 0.1);
    expect(input.sample(1 / 60)).toMatchObject({ lookX: 0, lookY: 0 });
    axis(pad, 2, 1);
    axis(pad, 3, 0);
    expect(input.sample(1 / 60)).toMatchObject({ lookX: 1, lookY: 0 });
  });
  it("does not let a held keyboard menu confirmation block fresh gameplay controls", () => {
    const host = new EventTarget() as Window;
    const input = new InputManager({
      window: host,
      document: null,
      storage: null,
      getGamepads: () => [],
    });
    keyEvent(host, "Enter", true);
    expect(input.sample(1 / 60, true).actions.confirm).toBe(true);
    input.consume();
    keyEvent(host, "KeyW", true);
    keyEvent(host, "Space", true);
    const frame = input.sample(1 / 60);
    expect(frame).toMatchObject({ moveY: 1, throttle: 1, jump: true });
    expect(frame.actions.confirm).toBe(false);
    expect(input.sample(1 / 60).jump).toBe(false);
    input.dispose();
  });
  it("selects an already connected device at index 2, consumes selection, polls fresh each frame", () => {
    const { input, pad, getGamepads, select } = harness();
    expect(input.sample(1 / 60).source).toBe("none");
    select();
    expect(input.diagnostics().activeIndex).toBe(2);
    expect(input.sample(1 / 60).boost).toBe(false);
    button(pad, 7, 0.5);
    button(pad, 6, 0.25);
    button(pad, 2, 1);
    axis(pad, 0, -0.65);
    const frame = input.sample(1 / 60);
    expect(frame.throttle).toBeCloseTo(
      processTrigger(0.5, DEFAULT_SETTINGS.triggerDeadzone),
    );
    expect(frame.brake).toBeCloseTo(
      processTrigger(0.25, DEFAULT_SETTINGS.triggerDeadzone),
    );
    expect(frame.handbrake).toBe(true);
    expect(frame.steer).toBeLessThan(0);
    expect(getGamepads).toHaveBeenCalledTimes(5);
  });
  it("gets a replacement gamepad object each frame, without stale references", () => {
    const { input, select, setPads } = harness();
    select();
    const fresh = makePad();
    button(fresh, 7, 0.8);
    setPads([null, null, fresh]);
    expect(input.sample(1 / 60).throttle).toBeCloseTo(
      processTrigger(0.8, 0.04),
    );
  });
  it("shows processed inputs in diagnostics while menu gameplay remains silent", () => {
    const { input, pad, select } = harness();
    select();
    button(pad, 7, 0.5);
    axis(pad, 0, 0.7);
    expect(input.sample(1 / 60, true).throttle).toBe(0);
    expect(input.diagnostics().processed.throttle).toBeCloseTo(
      processTrigger(0.5, 0.04),
    );
    expect(input.diagnostics().processed.steer).toBeGreaterThan(0.4);
  });
  it("changes active controller by a new button press in menus, not from incidental stick motion", () => {
    const { input, select, pad, setPads } = harness();
    select();
    const other = makePad(5);
    axis(other, 0, 1);
    setPads([null, null, pad, null, null, other]);
    input.sample(1 / 60, true);
    expect(input.diagnostics().activeIndex).toBe(2);
    button(other, 0, 1);
    input.sample(1 / 60, true);
    expect(input.diagnostics().activeIndex).toBe(5);
    expect(input.diagnostics().processed.boost).toBe(false);
  });
  it("consumes confirmation until neutral so A cannot also boost", () => {
    const { input, pad, select } = harness();
    select();
    button(pad, 0, 1);
    expect(input.sample(1 / 60, true).actions.confirm).toBe(true);
    input.consume();
    expect(input.sample(1 / 60).boost).toBe(false);
    button(pad, 0, 0);
    input.sample(1 / 60);
    button(pad, 0, 1);
    expect(input.sample(1 / 60).boost).toBe(true);
  });
  it("pauses on active disconnect, clears throttle, requires selection and deliberate resume", () => {
    const { input, pad, select, setPads, onSafetyPause } = harness();
    select();
    button(pad, 7, 1);
    expect(input.sample(1 / 60).throttle).toBe(1);
    setPads([null, null, null]);
    expect(input.sample(1 / 60).throttle).toBe(0);
    expect(onSafetyPause).toHaveBeenCalledWith("disconnect");
    expect(input.diagnostics().suspended).toBe(true);
    setPads([null, null, pad]);
    input.sample(1 / 60);
    expect(input.sample(1 / 60).throttle).toBe(0);
    button(pad, 7, 0);
    input.sample(1 / 60);
    button(pad, 0, 1);
    expect(input.sample(1 / 60, true).actions.confirm).toBe(true);
    input.resume();
    expect(input.sample(1 / 60).boost).toBe(false);
    button(pad, 0, 0);
    input.sample(1 / 60);
    button(pad, 7, 0.6);
    expect(input.sample(1 / 60).throttle).toBeGreaterThan(0.5);
  });
  it("latched pause prevents movement after focus loss until explicit resume", () => {
    const host = new EventTarget() as Window;
    const pad = makePad();
    const onSafetyPause = vi.fn();
    const input = new InputManager({
      getGamepads: () => [null, pad],
      window: host,
      document: null,
      storage: null,
      onSafetyPause,
    });
    button(pad, 0, 1);
    input.sample(1 / 60);
    button(pad, 0, 0);
    input.sample(1 / 60);
    button(pad, 7, 1);
    expect(input.sample(1 / 60).throttle).toBe(1);
    host.dispatchEvent(new Event("blur"));
    expect(onSafetyPause).toHaveBeenCalledWith("blur");
    host.dispatchEvent(new Event("focus"));
    expect(input.sample(1 / 60).throttle).toBe(0);
    button(pad, 7, 0);
    input.sample(1 / 60);
    button(pad, 7, 1);
    expect(input.sample(1 / 60).throttle).toBe(0);
    input.resume();
    button(pad, 7, 0);
    input.sample(1 / 60);
    button(pad, 7, 1);
    expect(input.sample(1 / 60).throttle).toBe(1);
    input.dispose();
  });
  it("holds reset for 0.7 seconds, fires once and requires release", () => {
    const { input, pad, select } = harness();
    select();
    button(pad, 8, 1);
    let resets = 0;
    for (let i = 0; i < 100; i++) if (input.sample(1 / 60).reset) resets++;
    expect(resets).toBe(1);
    button(pad, 8, 0);
    input.sample(1 / 60);
    button(pad, 8, 1);
    for (let i = 0; i < 50; i++) if (input.sample(1 / 60).reset) resets++;
    expect(resets).toBe(2);
  });
});

describe("menu, remapping and haptics", () => {
  it("uses edges for confirm and deliberate repeat for directions", () => {
    const repeater = new MenuRepeater();
    expect(
      repeater.step(actions({ confirm: true, down: true }), 0.016),
    ).toMatchObject({ confirm: true, down: true });
    expect(
      repeater.step(actions({ confirm: true, down: true }), 0.2),
    ).toMatchObject({ confirm: false, down: false });
    expect(
      repeater.step(actions({ confirm: true, down: true }), 0.15),
    ).toMatchObject({ confirm: false, down: true });
    expect(
      repeater.step(actions({ confirm: true, down: true }), 0.1),
    ).toMatchObject({ confirm: false, down: true });
    repeater.step(actions(), 0.016);
    expect(repeater.step(actions({ confirm: true }), 0.016).confirm).toBe(true);
  });
  it("does not assume a layout on unknown devices and supports axis/button capture", () => {
    const { input, pad, select, storage } = harness(makePad(2, ""));
    select();
    axis(pad, 0, 1);
    button(pad, 7, 1);
    expect(input.sample(1 / 60).throttle).toBe(0);
    expect(input.diagnostics().needsCalibration).toBe(true);
    axis(pad, 0, 0);
    button(pad, 7, 0);
    input.sample(1 / 60);
    input.startBindingCapture("steer");
    axis(pad, 2, -1);
    input.sample(1 / 60);
    expect(input.getBindings().steer).toEqual({
      kind: "axis",
      index: 2,
      invert: true,
    });
    axis(pad, 2, 0);
    input.sample(1 / 60);
    input.startBindingCapture("throttle");
    for (const value of [0.1, 0.3, 0.5, 0.7]) {
      button(pad, 4, value);
      input.sample(1 / 60);
    }
    expect(input.getBindings().throttle).toEqual({ kind: "button", index: 4 });
    expect(storage.setItem).toHaveBeenCalled();
  });
  it("persists settings and restores defaults", () => {
    const { input, storage } = harness();
    input.updateSettings({ deadzone: 0.2, curve: 2, vibration: 0 });
    const data = storage.setItem.mock.calls.at(-1)![1];
    const restored = new InputManager({
      storage: { ...storage, getItem: () => data },
      window: null,
      document: null,
    });
    expect(restored.settings).toMatchObject({
      deadzone: 0.2,
      curve: 2,
      vibration: 0,
    });
    restored.resetDefaults();
    expect(restored.settings).toEqual(DEFAULT_SETTINGS);
  });
  it("throttles effects, preempts slip with impact, stops on pause and tolerates rejection", async () => {
    const { input, pad, select } = harness();
    const playEffect = vi.fn().mockResolvedValue("complete"),
      reset = vi.fn().mockResolvedValue("complete");
    pad.vibrationActuator = { playEffect, reset };
    select();
    expect(input.rumble("slip", 0.6)).toBe(true);
    for (let i = 0; i < 5; i++) expect(input.rumble("slip", 0.6)).toBe(false);
    expect(input.rumble("impact", 1)).toBe(true);
    expect(playEffect).toHaveBeenCalledTimes(2);
    input.safetyPause("disconnect");
    expect(reset).toHaveBeenCalled();
    expect(input.rumble("boost")).toBe(false);
    input.resume();
    input.sample(1 / 60);
    playEffect.mockRejectedValueOnce(new Error("not supported"));
    expect(input.rumble("impact")).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(input.diagnostics().haptics).toBe("rejected");
    expect(input.rumble("impact")).toBe(false);
  });
});
