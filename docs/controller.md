# Controller input and physical test checklist

Use current Windows Chrome or Edge on `http://localhost`. Connect a wired USB Xbox controller, focus the game page, and press any controller button. The browser may withhold controller data until this interaction. The first press selects the controller and is consumed; release it before navigating. An initial mouse click may be needed for page focus and audio. The selected device need not have index zero. In menus, a new button press on another device selects that device. During driving, incidental inputs from a second controller do not steal control.

| Action | Xbox | Keyboard |
| --- | --- | --- |
| Steer | Left stick X | A/D or Left/Right |
| Throttle / brake | RT / LT, proportional | W/S or Up/Down |
| Boost | Hold A | Hold Shift |
| Handbrake | Hold X | Hold Space |
| Look back | Hold B | Hold B |
| Look around | Right stick | — |
| Camera | Y | C |
| Pause / resume | Menu | Escape / P |
| Safe reset | Hold View for 0.7 seconds | Hold R for 0.7 seconds |
| Menu navigation | D-pad / left stick | Arrow keys / WASD |
| Confirm / back | A / B | Enter / Backspace or Escape |

Steering uses an axial rescaled deadzone with an adjustable curve and sensitivity, without temporal filtering. Triggers preserve the native analog `value`; no conversion to `pressed` occurs. Right-stick look uses a radial deadzone. Directional menu repeat starts after 340 ms and continues at 100 ms intervals. Confirm, back, pause and camera use press edges. All controls must be released after a consumed confirmation, a controller selection, or a safety pause so a held A or RT cannot leak into driving. Reverse release/repress gating is part of vehicle logic, not the input module.

Settings are saved under `beverly-run-input-v1` in local storage: steering deadzone (default 0.12), sensitivity (1), curve (1.35), trigger deadzone (0.04), camera sensitivity (1), vibration (0.65), camera shake (0.35) and graphics quality (high). Corrupt or blocked storage does not prevent play. Reset defaults clears saved custom bindings as well as settings.

## Unknown controller layouts

Only `mapping === 'standard'` receives Xbox defaults. Unknown layouts produce no assumed driving inputs. Diagnostics report that calibration is needed and show raw axes/buttons. Bindings are saved per device ID.

The UI can map every action by calling `startBindingCapture(name)`, presenting `input.calibration.instruction`, then polling normally until `input.calibration` becomes null. Capture steering and horizontal look by moving the stick fully right; capture vertical look by moving fully down. Release triggers before starting capture, then squeeze fully. The capture supports buttons with fractional values and trigger axes whose rest is -1, 0 or +1. `cancelBindingCapture()` cancels, and `setBinding(name, binding)` supports manual binding edits. `getBindings()` returns the effective mapping. Unknown layouts can use keyboard navigation while being configured; map confirm, back and menu directions to enable controller navigation. Standard layouts can also be remapped.

## Integration contract

Call `input.sample(realFrameDeltaSeconds, menuIsOpen)` once at the start of every animation frame, before fixed physics steps. The module obtains fresh `navigator.getGamepads()` data every call, filters null/disconnected entries, detects already connected devices, and copies button history for edges. Read `frame.actions` for menus. Calling `consume()` after starting/changing modes consumes the current confirmation until controls are released. `sample(..., true)` keeps menu actions active but zeros driving input.

Pass `onSafetyPause(reason)` to the constructor. Blur, hidden tabs and active-device disconnect invoke it, clear held keyboard state, latch driving off, and reset haptics. The game must pause simulation and zero its accumulator. Reconnection or returning focus does not resume. On an explicit new Resume/Start action call `resume()` and reset simulation accumulated time. Keep polling while paused so menu controls and diagnostics remain active. `clear()` clears transient state. `dispose()` removes listeners.

`diagnostics()` reports all connected devices, selected ID/index, mapping, calibration requirement, raw axes/buttons, raw standard LT/RT, processed frame, pressed button indexes, safety latch and neutral gate, and haptic availability/rejection. A detected actuator means the browser exposes it; it does not prove physical rumble was felt.

Call `rumble('impact' | 'slip' | 'boost', intensity)` for restrained dual-motor effects. It feature-detects support, throttles scheduling, permits impact to preempt lighter feedback, scales by the vibration setting and catches rejection. No impulse-trigger effects are requested. Gameplay never depends on haptics. `stopRumble()` stops the last actuator even if a disconnect has removed the current gamepad object.

## Evidence and required physical checks

Automated tests use synthetic `getGamepads()` snapshots and cover analog values, simultaneous controls, selection at nonzero indexes, fresh-object polling, unknown layouts, remapping, menu edges/repeat, confirmation consumption, reset hold, focus/disconnect safety, persistence, haptic throttling and rejection. This is software evidence only. No physical USB controller, end-to-end input latency, or felt rumble is claimed as verified.

- Launch, select the pad, navigate every menu and adjust a slider without a mouse.
- Hold RT and LT partway; verify smooth partial acceleration and braking in diagnostics and in the car.
- Try ordinary cornering, brake-initiated drift, stronger X handbrake drift, and countersteer recovery.
- Hold A through a bend; verify acceleration and controlled steering.
- Compare a glancing wall scrape with a hard impact and recovery.
- Unplug while accelerating: the game must pause immediately and stop vibration.
- Reconnect, release all controls, explicitly resume; held throttle must not auto-resume.
- Tab away/back while driving; check the same safety behavior.
- Compare restrained impact/slip/boost rumble, and verify setting vibration to zero.
- Finish a race, navigate results and restart entirely with the controller.

API references checked 2026-09-20: [MDN Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API), [Navigator.getGamepads](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/getGamepads), [GamepadButton.value](https://developer.mozilla.org/en-US/docs/Web/API/GamepadButton/value), [vibrationActuator](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad/vibrationActuator), and [standard mapping and null entries](https://developer.mozilla.org/en-US/docs/Games/Techniques/Controls_Gamepad_API).
