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

describe("analog processing", () => {
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
