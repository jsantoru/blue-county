import * as T from "three";

/** Physical vehicle sides in the model: +X is the US driver's left. */
export type VehicleDoorSide = 1 | -1;

export const VEHICLE_DOOR_ANGLE = T.MathUtils.degToRad(68);

/** The Blender-exported rigid door assembly; unrelated to chassis physics. */
export class VehicleDoors {
  private readonly hinges: Record<"left" | "right", T.Object3D>;
  private readonly closed: Record<"left" | "right", T.Quaternion>;
  private readonly progress = { left: 0, right: 0 };
  private readonly axis = new T.Vector3(0, 1, 0);
  private readonly rotation = new T.Quaternion();

  constructor(root: T.Object3D) {
    const left = root.getObjectByName("DoorHinge_L"),
      right = root.getObjectByName("DoorHinge_R");
    if (!left || !right)
      throw new Error("The 442 model is missing its exported door hinges.");
    this.hinges = { left, right };
    this.closed = {
      left: left.quaternion.clone(),
      right: right.quaternion.clone(),
    };
    this.closeAll();
  }

  /** 0 = latched, 1 = fully open. Timing/easing belongs to the interaction. */
  setOpen(side: VehicleDoorSide, amount: number): void {
    const key = side === 1 ? "left" : "right";
    const progress = T.MathUtils.clamp(
      Number.isFinite(amount) ? amount : 0,
      0,
      1,
    );
    const angle = -side * VEHICLE_DOOR_ANGLE * progress;
    this.progress[key] = progress;
    this.hinges[key].quaternion
      .copy(this.closed[key])
      .multiply(this.rotation.setFromAxisAngle(this.axis, angle));
    this.hinges[key].userData.open_progress = progress;
  }

  closeAll(): void {
    this.setOpen(1, 0);
    this.setOpen(-1, 0);
  }

  /** Snapshot for interaction/inspection; no mutable scene objects leak out. */
  getState() {
    return {
      left: {
        progress: this.progress.left,
        angle: -VEHICLE_DOOR_ANGLE * this.progress.left,
      },
      right: {
        progress: this.progress.right,
        angle: VEHICLE_DOOR_ANGLE * this.progress.right,
      },
    };
  }
}
