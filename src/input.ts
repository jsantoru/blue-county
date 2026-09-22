/** Browser Gamepad input. Poll exactly once at the beginning of every render frame. */
export type MenuAction =
  "up" | "down" | "left" | "right" | "confirm" | "back" | "pause" | "camera";
export type BindingName =
  | "steer"
  | "throttle"
  | "brake"
  | "boost"
  | "handbrake"
  | "lookBack"
  | "lookX"
  | "lookY"
  | "moveX"
  | "moveY"
  | "sprint"
  | "jump"
  | "interact"
  | "reset"
  | "camera"
  | "pause"
  | "confirm"
  | "back"
  | "menuUp"
  | "menuDown"
  | "menuLeft"
  | "menuRight";
export type Binding =
  | { kind: "button"; index: number }
  | {
      kind: "axis";
      index: number;
      invert?: boolean;
      rest?: number;
      end?: number;
    };
export type Bindings = Partial<Record<BindingName, Binding>>;
export interface InputSettings {
  deadzone: number;
  sensitivity: number;
  curve: number;
  triggerDeadzone: number;
  cameraSensitivity: number;
  vibration: number;
  shake: number;
  quality: "low" | "medium" | "high";
}
export const DEFAULT_SETTINGS: Readonly<InputSettings> = Object.freeze({
  deadzone: 0.12,
  sensitivity: 1,
  curve: 1.35,
  triggerDeadzone: 0.04,
  cameraSensitivity: 1,
  vibration: 0.65,
  shake: 0.35,
  quality: "high",
});
export const BINDING_NAMES: readonly BindingName[] = [
  "steer",
  "throttle",
  "brake",
  "boost",
  "handbrake",
  "lookBack",
  "lookX",
  "lookY",
  "moveX",
  "moveY",
  "sprint",
  "jump",
  "interact",
  "camera",
  "pause",
  "reset",
  "confirm",
  "back",
  "menuUp",
  "menuDown",
  "menuLeft",
  "menuRight",
];
export const STANDARD_BINDINGS: Readonly<Bindings> = Object.freeze({
  steer: { kind: "axis", index: 0 },
  throttle: { kind: "button", index: 7 },
  brake: { kind: "button", index: 6 },
  boost: { kind: "button", index: 0 },
  handbrake: { kind: "button", index: 2 },
  lookBack: { kind: "button", index: 1 },
  lookX: { kind: "axis", index: 2 },
  lookY: { kind: "axis", index: 3 },
  moveX: { kind: "axis", index: 0 },
  moveY: { kind: "axis", index: 1 },
  sprint: { kind: "button", index: 0 },
  jump: { kind: "button", index: 2 },
  interact: { kind: "button", index: 3 },
  camera: { kind: "button", index: 11 },
  pause: { kind: "button", index: 9 },
  reset: { kind: "button", index: 8 },
  confirm: { kind: "button", index: 0 },
  back: { kind: "button", index: 1 },
  menuUp: { kind: "button", index: 12 },
  menuDown: { kind: "button", index: 13 },
  menuLeft: { kind: "button", index: 14 },
  menuRight: { kind: "button", index: 15 },
});
export const MENU_ACTIONS: readonly MenuAction[] = [
  "up",
  "down",
  "left",
  "right",
  "confirm",
  "back",
  "pause",
  "camera",
];
export interface InputFrame {
  steer: number;
  throttle: number;
  brake: number;
  boost: boolean;
  handbrake: boolean;
  lookBack: boolean;
  lookX: number;
  lookY: number;
  /** Camera-relative movement: right and forward respectively, with length <= 1. */
  moveX: number;
  moveY: number;
  sprint: boolean;
  /** Press edges, never repeated while held. */
  jump: boolean;
  interact: boolean;
  /** Mouse displacement in pixels, sensitivity applied; consume without multiplying by dt. */
  mouseX: number;
  mouseY: number;
  reset: boolean;
  resetProgress: number;
  actions: Record<MenuAction, boolean>;
  source: "keyboard" | "gamepad" | "none";
}
interface HapticActuator {
  type?: string;
  effects?: readonly string[];
  playEffect?: (
    type: string,
    params: {
      startDelay: number;
      duration: number;
      strongMagnitude: number;
      weakMagnitude: number;
    },
  ) => Promise<unknown>;
  reset?: () => Promise<unknown>;
}
export interface PadState {
  id: string;
  index: number;
  mapping: string;
  connected: boolean;
  axes: readonly number[];
  buttons: readonly { value: number; pressed: boolean }[];
  vibrationActuator?: HapticActuator | null;
}
export type SafetyReason = "blur" | "hidden" | "disconnect";
interface InputEnvironment {
  getGamepads?: () => ArrayLike<PadState | null>;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  window?: Window | null;
  document?: Document | null;
  onSafetyPause?: (reason: SafetyReason) => void;
}
export interface CalibrationState {
  name: BindingName;
  instruction: string;
}
export interface ControllerDiagnostics {
  supported: boolean;
  error: string | null;
  activeIndex: number | null;
  activeDevice: string;
  mapping: string;
  needsCalibration: boolean;
  suspended: boolean;
  awaitingNeutral: boolean;
  rawAxes: number[];
  rawTriggers: { lt: number; rt: number } | null;
  rawButtons: number[];
  pressedButtons: number[];
  processed: InputFrame;
  haptics: "available" | "unsupported" | "rejected";
  devices: { index: number; id: string; mapping: string; active: boolean }[];
  calibration: CalibrationState | null;
}
const STORAGE_KEY = "beverly-run-input-v1";
const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
const emptyActions = (): Record<MenuAction, boolean> => ({
  up: false,
  down: false,
  left: false,
  right: false,
  confirm: false,
  back: false,
  pause: false,
  camera: false,
});
export const emptyInput = (): InputFrame => ({
  steer: 0,
  throttle: 0,
  brake: 0,
  boost: false,
  handbrake: false,
  lookBack: false,
  lookX: 0,
  lookY: 0,
  moveX: 0,
  moveY: 0,
  sprint: false,
  jump: false,
  interact: false,
  mouseX: 0,
  mouseY: 0,
  reset: false,
  resetProgress: 0,
  actions: emptyActions(),
  source: "none",
});

/** Axial steering deadzone with full travel retained. No temporal filtering. */
export function rescaleDeadzone(value: number, deadzone: number): number {
  const v = clamp(value, -1, 1),
    d = clamp(deadzone, 0, 0.95);
  return Math.abs(v) <= d ? 0 : (Math.sign(v) * (Math.abs(v) - d)) / (1 - d);
}
export function processSteering(
  value: number,
  settings: Pick<InputSettings, "deadzone" | "curve" | "sensitivity">,
): number {
  const v = rescaleDeadzone(value, settings.deadzone);
  return clamp(
    Math.sign(v) * Math.pow(Math.abs(v), settings.curve) * settings.sensitivity,
    -1,
    1,
  );
}
export function processTrigger(value: number, deadzone: number): number {
  return Math.max(0, rescaleDeadzone(clamp(value), deadzone));
}
/** Radial camera deadzone avoids diagonal drift and retains direction. */
export function processLook(
  x: number,
  y: number,
  deadzone = 0.15,
): [number, number] {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length <= deadzone) return [0, 0];
  const magnitude = Math.min(1, (length - deadzone) / (1 - deadzone));
  return [(x / length) * magnitude, (y / length) * magnitude];
}
export function normalizeSettings(
  candidate: Partial<InputSettings>,
): InputSettings {
  const number = (key: keyof InputSettings, min: number, max: number) =>
    typeof candidate[key] === "number" && Number.isFinite(candidate[key])
      ? clamp(candidate[key] as number, min, max)
      : (DEFAULT_SETTINGS[key] as number);
  return {
    deadzone: number("deadzone", 0, 0.45),
    sensitivity: number("sensitivity", 0.4, 1.8),
    curve: number("curve", 0.5, 2.5),
    triggerDeadzone: number("triggerDeadzone", 0, 0.3),
    cameraSensitivity: number("cameraSensitivity", 0.3, 2),
    vibration: number("vibration", 0, 1),
    shake: number("shake", 0, 1),
    quality: ["low", "medium", "high"].includes(candidate.quality ?? "")
      ? candidate.quality!
      : DEFAULT_SETTINGS.quality,
  };
}
export function readBinding(
  pad: PadState,
  binding: Binding | undefined,
): number {
  if (!binding || !Number.isInteger(binding.index) || binding.index < 0)
    return 0;
  if (binding.kind === "button")
    return clamp(pad.buttons[binding.index]?.value ?? 0);
  const value = clamp(pad.axes[binding.index] ?? 0, -1, 1);
  if (binding.rest !== undefined && binding.end !== undefined) {
    const range = binding.end - binding.rest;
    return Math.abs(range) < 0.01 ? 0 : clamp((value - binding.rest) / range);
  }
  return value * (binding.invert ? -1 : 1);
}

/** Menus repeat after 340 ms, then every 100 ms; confirm/back never repeat. */
export class MenuRepeater {
  private held = new Map<MenuAction, number>();
  step(
    current: Record<MenuAction, boolean>,
    dt: number,
  ): Record<MenuAction, boolean> {
    const result = emptyActions();
    for (const action of MENU_ACTIONS) {
      if (!current[action]) {
        this.held.delete(action);
        continue;
      }
      const before = this.held.get(action);
      if (before === undefined) {
        result[action] = true;
        this.held.set(action, 0);
        continue;
      }
      const after = before + Math.max(0, dt);
      const direction =
        action === "up" ||
        action === "down" ||
        action === "left" ||
        action === "right";
      if (
        direction &&
        after >= 0.34 &&
        (before < 0.34 ||
          Math.floor((after - 0.34) / 0.1) > Math.floor((before - 0.34) / 0.1))
      )
        result[action] = true;
      this.held.set(action, after);
    }
    return result;
  }
  clear(): void {
    this.held.clear();
  }
}

function validBinding(value: unknown): value is Binding {
  if (!value || typeof value !== "object") return false;
  const binding = value as Binding;
  return (
    (binding.kind === "axis" || binding.kind === "button") &&
    Number.isInteger(binding.index) &&
    binding.index >= 0 &&
    binding.index < 128 &&
    (binding.kind !== "axis" ||
      ((binding.rest === undefined || Number.isFinite(binding.rest)) &&
        (binding.end === undefined || Number.isFinite(binding.end))))
  );
}
function padKey(pad: PadState): string {
  return `${pad.index}:${pad.id}`;
}
const gameplayKeys = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
  "Space",
  "KeyB",
  "KeyC",
  "KeyP",
  "Escape",
  "Enter",
  "Backspace",
  "KeyR",
  "KeyF",
]);

export class InputManager {
  settings: InputSettings;
  private getPads: () => ArrayLike<PadState | null>;
  private storage: InputEnvironment["storage"];
  private hostWindow: Window | null;
  private hostDocument: Document | null;
  private pauseCallback?: (reason: SafetyReason) => void;
  private apiSupported: boolean;
  private apiError: string | null = null;
  private pads: PadState[] = [];
  private active: { index: number; id: string } | null = null;
  private previousPadButtons = new Map<string, boolean[]>();
  private customBindings: Record<string, Bindings> = {};
  private legacyBindings = new Set<string>();
  private keys = new Set<string>();
  private repeater = new MenuRepeater();
  private frame = emptyInput();
  private lastSource: InputFrame["source"] = "none";
  private diagnosticFrame = emptyInput();
  private blockedKeys = new Set<string>();
  private blockedBindings = new Set<BindingName>();
  private get needsNeutral() {
    return this.blockedKeys.size > 0 || this.blockedBindings.size > 0;
  }
  private focused = true;
  private safetySuspended = false;
  private resetHeld = 0;
  private resetFired = false;
  private footHeld = { jump: false, interact: false };
  private mouse = { x: 0, y: 0 };
  private capture: {
    name: BindingName;
    axes: number[];
    buttons: number[];
  } | null = null;
  private hapticFailure = false;
  private hapticElapsed = Infinity;
  private lastHapticPriority = 0;
  private lastActuator: HapticActuator | null = null;
  private disposers: (() => void)[] = [];

  constructor(options: InputEnvironment = {}) {
    this.hostWindow =
      options.window === undefined
        ? typeof window === "undefined"
          ? null
          : window
        : options.window;
    this.hostDocument =
      options.document === undefined
        ? typeof document === "undefined"
          ? null
          : document
        : options.document;
    let browserStorage: Storage | null = null;
    try {
      browserStorage = this.hostWindow?.localStorage ?? null;
    } catch {
      /* private browsing may deny storage */
    }
    this.storage =
      options.storage === undefined ? browserStorage : options.storage;
    this.apiSupported =
      !!options.getGamepads ||
      (typeof navigator !== "undefined" &&
        typeof navigator.getGamepads === "function");
    this.getPads =
      options.getGamepads ??
      (() =>
        typeof navigator !== "undefined" && navigator.getGamepads
          ? (navigator.getGamepads() as unknown as (PadState | null)[])
          : []);
    this.pauseCallback = options.onSafetyPause;
    this.settings = { ...DEFAULT_SETTINGS };
    this.load();
    this.focused = !this.hostDocument?.hidden;
    const listen = (
      target: EventTarget | null,
      name: string,
      fn: EventListener,
    ) => {
      target?.addEventListener(name, fn);
      this.disposers.push(() => target?.removeEventListener(name, fn));
    };
    listen(this.hostWindow, "keydown", ((event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")
      )
        return;
      if (gameplayKeys.has(event.code)) {
        event.preventDefault();
        if (!event.repeat) this.keys.add(event.code);
      }
    }) as EventListener);
    listen(this.hostWindow, "keyup", ((event: KeyboardEvent) => {
      this.keys.delete(event.code);
      this.blockedKeys.delete(event.code);
    }) as EventListener);
    listen(this.hostWindow, "blur", () => this.safetyPause("blur"));
    listen(this.hostWindow, "focus", () => {
      this.focused = !this.hostDocument?.hidden;
    });
    listen(this.hostDocument, "visibilitychange", () => {
      if (this.hostDocument?.hidden) this.safetyPause("hidden");
      else this.focused = true;
    });
    listen(this.hostWindow, "gamepaddisconnected", ((event: GamepadEvent) => {
      if (this.active?.index === event.gamepad.index) {
        this.active = null;
        this.safetyPause("disconnect");
      }
    }) as EventListener);
  }

  private load(): void {
    try {
      const saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? "null");
      if (!saved || ![1, 2].includes(saved.version)) return;
      this.settings = normalizeSettings(saved.settings ?? {});
      if (saved.bindings && typeof saved.bindings === "object") {
        for (const [id, bindings] of Object.entries(saved.bindings)) {
          if (!bindings || typeof bindings !== "object") continue;
          const cleaned: Bindings = {};
          for (const name of BINDING_NAMES)
            if (validBinding((bindings as Bindings)[name]))
              cleaned[name] = (bindings as Bindings)[name];
          this.customBindings[id] = cleaned;
          if (
            saved.version === 1 ||
            (Array.isArray(saved.legacyBindings) &&
              saved.legacyBindings.includes(id))
          )
            this.legacyBindings.add(id);
        }
      }
    } catch {
      /* Corrupt/blocked settings must never prevent driving. */
    }
  }
  private persist(): void {
    try {
      this.storage?.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 2,
          settings: this.settings,
          bindings: this.customBindings,
          legacyBindings: [...this.legacyBindings],
        }),
      );
    } catch {
      /* storage optional */
    }
  }
  updateSettings(patch: Partial<InputSettings>): void {
    this.settings = normalizeSettings({ ...this.settings, ...patch });
    this.persist();
    if (this.settings.vibration === 0) this.stopRumble();
  }
  resetDefaults(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    this.customBindings = {};
    this.legacyBindings.clear();
    this.persist();
    this.consume();
  }
  getBindings(): Bindings {
    const pad = this.activePad();
    if (pad && this.legacyBindings.has(pad.id)) {
      const custom = this.customBindings[pad.id];
      // Carry intentional remaps into their matching foot controls. Only standard pads
      // have a known Y button: move that legacy camera binding to R3 so Y can interact.
      if (custom) {
        if (!custom.moveX && custom.steer) custom.moveX = { ...custom.steer };
        if (!custom.sprint && custom.boost) custom.sprint = { ...custom.boost };
        if (!custom.jump && custom.handbrake)
          custom.jump = { ...custom.handbrake };
        if (
          pad.mapping === "standard" &&
          custom.camera?.kind === "button" &&
          custom.camera.index === 3 &&
          !custom.interact
        )
          custom.camera = { kind: "button", index: 11 };
      }
      this.legacyBindings.delete(pad.id);
      this.persist();
    }
    return pad
      ? {
          ...(pad.mapping === "standard" ? STANDARD_BINDINGS : {}),
          ...this.customBindings[pad.id],
        }
      : {};
  }
  setBinding(name: BindingName, binding: Binding): boolean {
    const pad = this.activePad();
    if (!pad || !BINDING_NAMES.includes(name) || !validBinding(binding))
      return false;
    this.customBindings[pad.id] = {
      ...this.customBindings[pad.id],
      [name]: { ...binding },
    };
    this.persist();
    this.consume();
    return true;
  }
  get calibration(): CalibrationState | null {
    if (!this.capture) return null;
    const name = this.capture.name;
    const instruction =
      name === "steer" || name === "lookX" || name === "moveX"
        ? "Move the stick fully RIGHT, then release."
        : name === "lookY" || name === "moveY"
          ? "Move the stick fully DOWN, then release."
          : name === "throttle" || name === "brake"
            ? "Release the trigger first, then squeeze it fully."
            : "Press the desired controller button.";
    return { name, instruction };
  }
  startBindingCapture(name: BindingName): boolean {
    const pad = this.activePad();
    if (!pad) return false;
    this.capture = {
      name,
      axes: [...pad.axes],
      buttons: pad.buttons.map((button) => button.value),
    };
    this.consume();
    return true;
  }
  cancelBindingCapture(): void {
    this.capture = null;
    this.consume();
  }
  private captureBinding(pad: PadState): void {
    const capture = this.capture;
    if (!capture) return;
    const signed = ["steer", "lookX", "lookY", "moveX", "moveY"].includes(
      capture.name,
    );
    if (!signed) {
      const button = pad.buttons.findIndex(
        (value, index) =>
          value.value > 0.65 && (capture.buttons[index] ?? 0) < 0.3,
      );
      if (button !== -1) {
        this.setBinding(capture.name, { kind: "button", index: button });
        this.capture = null;
        return;
      }
      // A held confirmation button at capture start must be released before it can be mapped.
      capture.buttons = pad.buttons.map((button, index) =>
        button.value < 0.3 ? 0 : (capture.buttons[index] ?? 0),
      );
    }
    const axis = pad.axes.findIndex(
      (value, index) => Math.abs(value - (capture.axes[index] ?? 0)) > 0.6,
    );
    if (axis === -1) return;
    const rest = capture.axes[axis] ?? 0;
    const delta = pad.axes[axis] - rest;
    this.setBinding(
      capture.name,
      signed
        ? { kind: "axis", index: axis, invert: delta < 0 }
        : { kind: "axis", index: axis, rest, end: delta > 0 ? 1 : -1 },
    );
    this.capture = null;
  }

  private activePad(): PadState | undefined {
    return this.pads.find(
      (pad) => pad.index === this.active?.index && pad.id === this.active.id,
    );
  }
  /** Safety latch never resumes automatically when focus/controller returns. */
  safetyPause(reason: SafetyReason): void {
    if (reason !== "disconnect") this.focused = false;
    this.safetySuspended = true;
    this.clear();
    this.pauseCallback?.(reason);
  }
  /** Call only after a new, explicit Resume/Start action. */
  resume(): void {
    this.safetySuspended = false;
    this.consume();
  }
  private bindingActive(name: BindingName, pad: PadState, bindings: Bindings) {
    const read = (key: BindingName) => readBinding(pad, bindings[key]);
    if (name === "throttle" || name === "brake")
      return processTrigger(read(name), this.settings.triggerDeadzone) > 0;
    if (name === "steer") return Math.abs(read(name)) > this.settings.deadzone;
    if (name === "moveX" || name === "moveY")
      return Math.hypot(read("moveX"), read("moveY")) > this.settings.deadzone;
    if (name === "lookX" || name === "lookY")
      return (
        Math.hypot(read("lookX"), read("lookY")) >
        Math.max(0.15, this.settings.deadzone)
      );
    return read(name) > 0.5;
  }

  private suppressHeldPadControls(): void {
    this.blockedBindings.clear();
    const pad = this.activePad(),
      bindings = this.getBindings();
    if (pad)
      for (const name of BINDING_NAMES)
        if (this.bindingActive(name, pad, bindings))
          this.blockedBindings.add(name);
  }

  /** Suppress only controls already held; each becomes usable on its own release. */
  consume(): void {
    this.blockedKeys = new Set(this.keys);
    this.suppressHeldPadControls();
    this.repeater.clear();
    this.resetHeld = 0;
    this.resetFired = false;
    this.footHeld = { jump: false, interact: false };
    this.mouse = { x: 0, y: 0 };
    this.frame = emptyInput();
    this.diagnosticFrame = emptyInput();
  }
  /** Car transfers debounce F/Y without interrupting walking, look or pedals. */
  consumeInteraction(): void {
    const keyHeld = this.keys.has("KeyF");
    if (keyHeld) this.blockedKeys.add("KeyF");
    const pad = this.activePad();
    const padHeld =
      !!pad && this.bindingActive("interact", pad, this.getBindings());
    if (padHeld) this.blockedBindings.add("interact");
    this.footHeld.interact = keyHeld || padHeld;
    this.mouse = { x: 0, y: 0 };
    this.frame = emptyInput();
  }
  clear(): void {
    this.keys.clear();
    this.capture = null;
    this.consume();
    this.stopRumble();
  }

  /** The game forwards mouse events only while its canvas owns pointer lock or a drag. */
  addMouseLook(dx: number, dy: number): void {
    if (!this.focused || this.safetySuspended || this.capture) return;
    this.mouse.x += clamp(dx, -800, 800);
    this.mouse.y += clamp(dy, -800, 800);
  }

  sample(dt: number, menuMode = false): InputFrame {
    const step = clamp(dt, 0, 0.1);
    const mouse = this.mouse;
    this.mouse = { x: 0, y: 0 };
    this.hapticElapsed += step;
    try {
      this.pads = Array.from(this.getPads()).filter(
        (pad): pad is PadState => !!pad?.connected,
      );
      this.apiError = null;
    } catch (error) {
      this.pads = [];
      this.apiError = error instanceof Error ? error.message : String(error);
    }
    if (this.active && !this.activePad()) {
      this.active = null;
      this.safetyPause("disconnect");
    }
    let selected = false;
    let candidate: PadState | undefined;
    for (const pad of this.pads) {
      const key = padKey(pad),
        previous = this.previousPadButtons.get(key) ?? [];
      const rising = pad.buttons.some(
        (button, index) => button.value > 0.5 && !previous[index],
      );
      if (
        this.focused &&
        rising &&
        (!this.active || (menuMode && pad.index !== this.active.index))
      ) {
        candidate = pad;
        break;
      }
    }
    const explicitSelection = !!candidate;
    // Browsers expose pads after a user gesture. Once exposed, an idle pad is
    // already usable: don't require an extra button or right-stick gesture.
    if (this.focused && !this.active && !candidate)
      candidate =
        this.pads.find((pad) => pad.mapping === "standard") ?? this.pads[0];
    if (candidate) {
      this.stopRumble();
      this.active = { index: candidate.index, id: candidate.id };
      if (candidate.buttons.some((button) => button.value > 0.5))
        this.lastSource = "gamepad";
      this.hapticFailure = false;
      this.capture = null;
      if (explicitSelection) {
        this.consume();
        selected = true;
      } else this.suppressHeldPadControls();
    }
    // Save copies, never retain a Gamepad object as the source for the next frame.
    const currentKeys = new Set(this.pads.map(padKey));
    for (const key of this.previousPadButtons.keys())
      if (!currentKeys.has(key)) this.previousPadButtons.delete(key);
    for (const pad of this.pads)
      this.previousPadButtons.set(
        padKey(pad),
        pad.buttons.map((button) => button.value > 0.5),
      );
    const pad = this.activePad();
    if (pad && this.capture) {
      this.captureBinding(pad);
      this.frame = emptyInput();
      this.diagnosticFrame = emptyInput();
      return this.frame;
    }
    if (!this.focused || selected) {
      this.frame = { ...emptyInput(), source: this.lastSource };
      this.diagnosticFrame = emptyInput();
      return this.frame;
    }
    const bindings = this.getBindings();
    for (const code of this.blockedKeys)
      if (!this.keys.has(code)) this.blockedKeys.delete(code);
    for (const name of this.blockedBindings)
      if (!pad || !this.bindingActive(name, pad, bindings))
        this.blockedBindings.delete(name);
    const readControls = (raw = false) => {
      const value = (name: BindingName) =>
        pad && (raw || !this.blockedBindings.has(name))
          ? readBinding(pad, bindings[name])
          : 0;
      const held = (name: BindingName) => value(name) > 0.5;
      const key = (...codes: string[]) =>
        codes.some(
          (code) => this.keys.has(code) && (raw || !this.blockedKeys.has(code)),
        );
      const steer = processSteering(value("steer"), this.settings);
      const throttle = processTrigger(
        value("throttle"),
        this.settings.triggerDeadzone,
      );
      const brake = processTrigger(
        value("brake"),
        this.settings.triggerDeadzone,
      );
      const look = processLook(
        value("lookX"),
        value("lookY"),
        Math.max(0.15, this.settings.deadzone),
      );
      const movement = processLook(
        value("moveX"),
        -value("moveY"),
        this.settings.deadzone,
      );
      const keyboardX =
        Number(key("KeyD", "ArrowRight")) - Number(key("KeyA", "ArrowLeft"));
      const keyboardY =
        Number(key("KeyW", "ArrowUp")) - Number(key("KeyS", "ArrowDown"));
      const keyboardLength = Math.max(1, Math.hypot(keyboardX, keyboardY));
      const current = emptyInput();
      current.steer = key("KeyA", "KeyD", "ArrowLeft", "ArrowRight")
        ? Number(key("KeyD", "ArrowRight")) - Number(key("KeyA", "ArrowLeft"))
        : steer;
      current.throttle = Math.max(throttle, Number(key("KeyW", "ArrowUp")));
      current.brake = Math.max(brake, Number(key("KeyS", "ArrowDown")));
      current.boost = held("boost") || key("ShiftLeft", "ShiftRight");
      current.handbrake = held("handbrake") || key("Space");
      current.lookBack = held("lookBack") || key("KeyB");
      current.lookX = look[0] * this.settings.cameraSensitivity;
      current.lookY = look[1] * this.settings.cameraSensitivity;
      const keyboardMove = key(
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      );
      current.moveX = keyboardMove ? keyboardX / keyboardLength : movement[0];
      current.moveY = keyboardMove ? keyboardY / keyboardLength : movement[1];
      current.sprint = held("sprint") || key("ShiftLeft", "ShiftRight");
      const jump = held("jump") || key("Space");
      const interact = held("interact") || key("KeyF");
      current.jump = jump && !this.footHeld.jump;
      current.interact = interact && !this.footHeld.interact;
      current.mouseX = mouse.x * this.settings.cameraSensitivity;
      current.mouseY = mouse.y * this.settings.cameraSensitivity;
      const reset = held("reset") || key("KeyR");
      const menuX = value("steer");
      const menuY = value("moveY");
      const menuHeld: Record<MenuAction, boolean> = {
        up: held("menuUp") || menuY < -0.6 || key("ArrowUp", "KeyW"),
        down: held("menuDown") || menuY > 0.6 || key("ArrowDown", "KeyS"),
        left: held("menuLeft") || menuX < -0.6 || key("ArrowLeft", "KeyA"),
        right: held("menuRight") || menuX > 0.6 || key("ArrowRight", "KeyD"),
        confirm: held("confirm") || key("Enter"),
        back: held("back") || key("Backspace", "Escape"),
        pause: held("pause") || key("Escape", "KeyP"),
        camera: held("camera") || key("KeyC"),
      };
      return { current, menuHeld, jump, interact, reset };
    };
    const { current, menuHeld, jump, interact, reset } = readControls();
    const raw = readControls(true);
    this.footHeld = { jump, interact };
    // Keep the most recently used device in the HUD after release. Merely having
    // an idle controller connected must not replace keyboard/mouse hints.
    if (this.keys.size || mouse.x || mouse.y) this.lastSource = "keyboard";
    else if (
      pad &&
      (Math.abs(raw.current.steer) > 0.02 ||
        raw.current.throttle > 0.01 ||
        raw.current.brake > 0.01 ||
        Math.hypot(raw.current.lookX, raw.current.lookY) > 0.02 ||
        Math.hypot(raw.current.moveX, raw.current.moveY) > 0.02 ||
        raw.current.boost ||
        raw.current.handbrake ||
        raw.current.lookBack ||
        raw.current.sprint ||
        raw.jump ||
        raw.interact ||
        raw.reset ||
        Object.values(raw.menuHeld).some(Boolean))
    )
      this.lastSource = "gamepad";
    current.source = this.lastSource;
    // Diagnostics retain processed hardware values even when the menu or safety gate silences gameplay.
    this.diagnosticFrame = { ...raw.current, source: current.source };
    current.actions = this.repeater.step(menuHeld, step);
    if (reset && !menuMode && !this.safetySuspended) {
      this.resetHeld += step;
      current.resetProgress = Math.min(1, this.resetHeld / 0.7);
      if (this.resetHeld >= 0.7 && !this.resetFired) {
        current.reset = true;
        this.resetFired = true;
      }
    } else {
      this.resetHeld = 0;
      this.resetFired = false;
    }
    if (menuMode || this.safetySuspended) {
      this.frame = {
        ...emptyInput(),
        actions: current.actions,
        source: current.source,
      };
    } else this.frame = current;
    return this.frame;
  }

  diagnostics(): ControllerDiagnostics {
    const pad = this.activePad();
    const bindings = this.getBindings();
    return {
      supported: this.apiSupported,
      error: this.apiError,
      activeIndex: pad?.index ?? null,
      activeDevice: pad?.id ?? "Keyboard / press a controller button",
      mapping: pad?.mapping || "unknown",
      needsCalibration:
        !!pad &&
        pad.mapping !== "standard" &&
        [
          "steer",
          "throttle",
          "brake",
          "confirm",
          "back",
          "pause",
          "moveX",
          "moveY",
          "sprint",
          "jump",
          "interact",
        ].some((name) => !bindings[name as BindingName]),
      suspended: this.safetySuspended,
      awaitingNeutral: this.needsNeutral,
      rawAxes: pad ? [...pad.axes] : [],
      rawTriggers:
        pad?.mapping === "standard"
          ? { lt: pad.buttons[6]?.value ?? 0, rt: pad.buttons[7]?.value ?? 0 }
          : null,
      rawButtons: pad?.buttons.map((button) => button.value) ?? [],
      pressedButtons:
        pad?.buttons.flatMap((button, index) =>
          button.pressed || button.value > 0.5 ? [index] : [],
        ) ?? [],
      processed: {
        ...this.diagnosticFrame,
        actions: { ...this.diagnosticFrame.actions },
      },
      haptics: this.hapticFailure
        ? "rejected"
        : pad?.vibrationActuator?.playEffect
          ? "available"
          : "unsupported",
      devices: this.pads.map((device) => ({
        index: device.index,
        id: device.id,
        mapping: device.mapping,
        active: device === pad,
      })),
      calibration: this.calibration,
    };
  }

  /** At most ~8 short effects/second. Impact may preempt a weaker effect. */
  rumble(kind: "impact" | "slip" | "boost", intensity = 1): boolean {
    if (
      this.settings.vibration <= 0 ||
      !this.focused ||
      this.safetySuspended ||
      this.hapticFailure
    )
      return false;
    const actuator = this.activePad()?.vibrationActuator;
    if (!actuator?.playEffect) return false;
    const priority = kind === "impact" ? 3 : kind === "boost" ? 2 : 1;
    const cooldown = kind === "impact" ? 0.13 : kind === "boost" ? 0.25 : 0.18;
    if (this.hapticElapsed < cooldown && priority <= this.lastHapticPriority)
      return false;
    const scale = clamp(intensity) * this.settings.vibration;
    if (scale < 0.015) return false;
    const profile =
      kind === "impact"
        ? { duration: 110, strongMagnitude: 0.75, weakMagnitude: 0.38 }
        : kind === "boost"
          ? { duration: 85, strongMagnitude: 0.12, weakMagnitude: 0.25 }
          : { duration: 65, strongMagnitude: 0.06, weakMagnitude: 0.16 };
    this.hapticElapsed = 0;
    this.lastHapticPriority = priority;
    this.lastActuator = actuator;
    try {
      void Promise.resolve(
        actuator.playEffect("dual-rumble", {
          startDelay: 0,
          duration: profile.duration,
          strongMagnitude: profile.strongMagnitude * scale,
          weakMagnitude: profile.weakMagnitude * scale,
        }),
      ).catch(() => {
        this.hapticFailure = true;
      });
      return true;
    } catch {
      this.hapticFailure = true;
      return false;
    }
  }
  stopRumble(): void {
    const actuator = this.lastActuator ?? this.activePad()?.vibrationActuator;
    try {
      if (actuator?.reset)
        void Promise.resolve(actuator.reset()).catch(() => {});
    } catch {
      /* unsupported reset */
    }
    this.lastActuator = null;
    this.hapticElapsed = Infinity;
    this.lastHapticPriority = 0;
  }
  dispose(): void {
    this.stopRumble();
    for (const remove of this.disposers) remove();
    this.disposers = [];
  }
}
