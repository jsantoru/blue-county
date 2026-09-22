# Controller input and physical test checklist

Use current Windows Chrome or Edge on `http://localhost`. Connect a wired USB Xbox controller and focus the game page. The game automatically selects an exposed controller, including an idle one at a nonzero index. If the browser initially withholds controller data, press and release any button once; no right-stick gesture is needed. An initial mouse click may be needed for page focus and audio. In menus, a new button press on another device selects that device. During driving, incidental inputs from a second controller do not steal control. Detecting an idle controller also preserves active keyboard movement and menu navigation.

| Action | Xbox | Keyboard |
| --- | --- | --- |
| Steer | Left stick X | A/D or Left/Right |
| Throttle / brake | RT / LT, proportional | W/S or Up/Down |
| Boost | Hold A | Hold Shift |
| Handbrake | Hold X | Hold Space |
| Look back | Hold B | Hold B |
| Look around | Right stick | — |
| Enter / exit car | Y | F |
| Driving camera / recenter foot camera | Press right stick (R3) | C |
| Walk / run on foot | Left stick, proportional | WASD / arrow keys |
| Sprint on foot | Hold A | Hold Shift |
| Jump on foot | Press X | Space |
| Look around on foot | Right stick | Click to capture mouse, or hold right mouse button and drag |
| Pause / resume | Menu | Escape / P |
| Safe reset | Hold View for 0.7 seconds | Hold R for 0.7 seconds |
| Menu navigation | D-pad / left stick | Arrow keys / WASD |
| Confirm / back | A / B | Enter / Backspace or Escape |

Steering uses an axial rescaled deadzone with an adjustable curve and sensitivity, without temporal filtering. Triggers preserve the native analog `value`; no conversion to `pressed` occurs. Right-stick look and left-stick walking use radial deadzones; camera look respects the configured stick deadzone with a minimum of 0.15. Walking retains analog magnitude; keyboard diagonals are normalized so diagonal travel is no faster than forward travel. Directional menu repeat starts after 340 ms and continues at 100 ms intervals. Confirm, back, pause, camera, jump and interaction use press edges. Menu confirmations and safety resumes suppress only controls already held, each until its own release. A drifting stick or held button cannot lock unrelated controls. Reverse release/repress gating is part of vehicle logic, not the input module.

Car transfers debounce only F/Y. Hold the left stick while getting out and walking starts when the exit animation finishes. Hold RT while getting in and the car accelerates when entry finishes. Holding Y cannot reverse the transfer. There is no requirement to center both sticks and release every button together.

Settings remain saved under `beverly-run-input-v1` in local storage, with a version 2 payload: steering deadzone (default 0.12), sensitivity (1), curve (1.35), trigger deadzone (0.04), camera sensitivity (1), vibration (0.65), camera shake (0.35) and graphics quality (high). Version 1 settings and device remaps are preserved. Previous custom steering, boost and handbrake mappings initialize the corresponding horizontal movement, sprint and jump controls; only a standard pad's legacy Y camera mapping moves to R3 to make Y available for interaction. Unseen devices retain their pending migration across saves. Corrupt or blocked storage does not prevent play. Reset defaults clears saved custom bindings as well as settings.

## Unknown controller layouts

Only `mapping === 'standard'` receives Xbox defaults. Unknown layouts produce no assumed driving inputs. Diagnostics report that calibration is needed and show raw axes/buttons. Bindings are saved per device ID.

The UI can map every action by calling `startBindingCapture(name)`, presenting `input.calibration.instruction`, then polling normally until `input.calibration` becomes null. Capture steering, horizontal look and horizontal walking by moving the stick fully right; capture vertical look and vertical walking by moving fully down. Release triggers before starting capture, then squeeze fully. The capture supports buttons with fractional values and trigger axes whose rest is -1, 0 or +1. `cancelBindingCapture()` cancels, and `setBinding(name, binding)` supports manual binding edits. `getBindings()` returns the effective mapping. Unknown layouts can use keyboard navigation while being configured; map confirm, back and menu directions to enable controller navigation. They also need explicit movement, sprint, jump and interaction bindings for foot exploration. Standard layouts can also be remapped.

## Integration contract

Call `input.sample(realFrameDeltaSeconds, menuIsOpen)` once at the start of every animation frame, before fixed physics steps. The module obtains fresh `navigator.getGamepads()` data every call, filters null/disconnected entries, detects already connected devices, and copies button history for edges. Read `frame.actions` for menus. Use `consume()` for menu changes and explicit safety resumes: it snapshots held keys and mapped controller bindings and suppresses each independently until released. Use `consumeInteraction()` at both ends of a car transfer: it debounces F/Y and leaves movement, camera and pedals live. `sample(..., true)` keeps menu actions active but zeros driving and foot input.

Foot movement is `frame.moveX` (camera-relative right) and `frame.moveY` (camera-relative forward), with combined magnitude at most 1. `sprint` is held; `jump` and `interact` are single-frame press edges. Read interaction once per rendered frame. A physics loop must latch a jump until one fixed step consumes it, avoiding either a lost press on a frame with no step or multiple jumps on a frame with several steps.

`FootCameraOrbit` shares its effective yaw with walking physics and the displayed view. C/R3 recenters along the shortest arc; fresh look input cancels that motion. The camera follows an orbit around the character, with immediate inward collision correction and gradual outward recovery. Smoothing the boom length instead of its world position prevents the camera from cutting through the character on a 180-degree recenter.

Forward mouse displacement to `addMouseLook(dx, dy)` only when the game owns pointer lock or an intentional drag. `frame.mouseX` and `mouseY` are accumulated pixel displacement with camera sensitivity applied, consumed exactly once by `sample()`. Do not multiply these values by frame time; right-stick `lookX/lookY` remain rates. Menus, capture, mode consumption and safety pauses discard pending mouse movement so resuming cannot cause a camera snap.

Pass `onSafetyPause(reason)` to the constructor. Blur, hidden tabs and active-device disconnect invoke it, clear held keyboard state, latch driving off, and reset haptics. The game must pause simulation and zero its accumulator. Reconnection or returning focus does not resume. On an explicit new Resume/Start action call `resume()` and reset simulation accumulated time. Keep polling while paused so menu controls and diagnostics remain active. `clear()` clears transient state. `dispose()` removes listeners.

`diagnostics()` reports all connected devices, selected ID/index, mapping, calibration requirement, raw axes/buttons, raw standard LT/RT, processed frame, pressed button indexes, safety latch, held controls awaiting release, and haptic availability/rejection. Its legacy `awaitingNeutral` field now means some individual controls are suppressed; it is not a global movement lock. A detected actuator means the browser exposes it; it does not prove physical rumble was felt.

Call `rumble('impact' | 'slip' | 'boost', intensity)` for restrained dual-motor effects. It feature-detects support, throttles scheduling, permits impact to preempt lighter feedback, scales by the vibration setting and catches rejection. No impulse-trigger effects are requested. Gameplay never depends on haptics. `stopRumble()` stops the last actuator even if a disconnect has removed the current gamepad object.

## Evidence and required physical checks

The controller fix passes 41 focused input tests and the full 158-test suite. `npm run test:controller-transitions` exercises the actual production render loop with a synthetic controller whose right stick remains at 0.22 throughout. Three exits begin walking with left stick and Y still held; three entries begin driving with RT already held. Startup detection, first fresh A, deliberate resume after focus loss, automatic reconnect and held-Y debouncing all pass with zero browser/WebGL errors. See [the regression report](controller-transition-verification.json). These checks verify software behavior; the user's physical controller still needs a playtest.

Automated tests use synthetic `getGamepads()` snapshots and cover analog values, simultaneous controls, normalized keyboard movement, radial walking, foot action edges, mouse consumption, selection at nonzero indexes, fresh-object polling, unknown layouts, remapping, legacy settings migration, menu edges/repeat, confirmation consumption, reset hold, focus/disconnect safety, persistence, haptic throttling and rejection. This is software evidence only. No physical USB controller, end-to-end input latency, or felt rumble is claimed as verified.

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
- Stop, press Y and hold the left stick during exit; walking should begin immediately when the animation ends. Return to the door, press Y and hold RT during entry; driving should begin immediately when it finishes.
- Hold Y across the exit transition: it must not immediately enter the car again. Hold X: it must produce a single jump until released.
- Check gentle analog walking, full-stick movement and diagonal movement. Press R3 to change the driving camera.
- Disconnect or tab away while exploring on foot, then verify the same deliberate-resume safety behavior as driving.

API references checked 2026-09-20: [MDN Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API), [Navigator.getGamepads](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/getGamepads), [GamepadButton.value](https://developer.mozilla.org/en-US/docs/Web/API/GamepadButton/value), [vibrationActuator](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad/vibrationActuator), and [standard mapping and null entries](https://developer.mozilla.org/en-US/docs/Games/Techniques/Controls_Gamepad_API).
