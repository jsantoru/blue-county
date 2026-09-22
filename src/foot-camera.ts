import { Vector3 } from "three";
import { angleDiff, clamp } from "./types";

export interface FootLookInput {
  lookX: number;
  lookY: number;
  mouseX: number;
  mouseY: number;
}

const DEFAULT_DISTANCE = 4.6;
const DEFAULT_PITCH = 0.22;
const BOOM_LIFT = 0.3;

/** One effective orbit angle drives both the displayed view and walking input. */
export class FootCameraOrbit {
  yaw = 0;
  pitch = DEFAULT_PITCH;
  private freeDistance = DEFAULT_DISTANCE;
  private boomLength = this.offset().length();
  private recenterYaw: number | null = null;

  private offset() {
    return new Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch) * this.freeDistance,
      Math.sin(this.pitch) * this.freeDistance + BOOM_LIFT,
      -Math.cos(this.yaw) * Math.cos(this.pitch) * this.freeDistance,
    );
  }

  reset(yaw: number, pitch = DEFAULT_PITCH) {
    this.setAngles(yaw, pitch);
    this.freeDistance = DEFAULT_DISTANCE;
    this.boomLength = this.offset().length();
  }

  /** Preserve the existing chase-camera position when beginning a car exit. */
  begin(position: Vector3, target: Vector3, fallbackYaw: number) {
    const offset = position.clone().sub(target);
    const horizontal = Math.hypot(offset.x, offset.z);
    const liftedY = offset.y - BOOM_LIFT;
    this.setAngles(
      horizontal > 0.001 ? Math.atan2(-offset.x, -offset.z) : fallbackYaw,
      Math.atan2(liftedY, Math.max(0.001, horizontal)),
    );
    this.freeDistance = Math.max(0.15, Math.hypot(horizontal, liftedY));
    this.boomLength = Math.max(0.15, offset.length());
  }

  /** Also used by deterministic placement hooks; it does not reset collision recovery. */
  setAngles(yaw: number, pitch = this.pitch) {
    this.yaw = yaw;
    this.pitch = clamp(pitch, -0.38, 1.1);
    this.recenterYaw = null;
  }

  recenter(characterYaw: number) {
    this.recenterYaw = characterYaw;
  }

  updateLook(input: FootLookInput, dt: number) {
    const step = clamp(dt, 0, 0.1);
    const yawDelta = -input.lookX * step * 2.5 - input.mouseX * 0.0025;
    const pitchDelta = input.lookY * step * 1.8 + input.mouseY * 0.002;
    if (yawDelta || pitchDelta) {
      this.setAngles(this.yaw + yawDelta, this.pitch + pitchDelta);
    } else if (this.recenterYaw !== null) {
      const blend = 1 - Math.exp(-step * 9);
      this.yaw += angleDiff(this.recenterYaw, this.yaw) * blend;
      this.pitch += (DEFAULT_PITCH - this.pitch) * blend;
      if (
        Math.abs(angleDiff(this.recenterYaw, this.yaw)) < 0.0001 &&
        Math.abs(this.pitch - DEFAULT_PITCH) < 0.0001
      )
        this.setAngles(this.recenterYaw, DEFAULT_PITCH);
    }
  }

  /**
   * Resolve collisions along the actual orbit ray. Only the boom length is
   * smoothed: interpolating world positions cuts through the actor on large turns.
   */
  position(
    target: Vector3,
    dt: number,
    clear: (desired: Vector3) => Vector3 = (desired) => desired,
  ) {
    const step = clamp(dt, 0, 0.1);
    this.freeDistance +=
      (DEFAULT_DISTANCE - this.freeDistance) * (1 - Math.exp(-step * 6));
    const offset = this.offset();
    const desiredLength = offset.length();
    const safe = clear(target.clone().add(offset));
    const safeLength = Math.max(
      0,
      Math.min(desiredLength, safe.distanceTo(target)),
    );
    if (safeLength < this.boomLength) this.boomLength = safeLength;
    else
      this.boomLength +=
        (safeLength - this.boomLength) * (1 - Math.exp(-step * 8));
    return target.clone().addScaledVector(offset.normalize(), this.boomLength);
  }
}
