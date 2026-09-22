import * as T from "three";

export interface SteeringWheelSpec {
  node: string;
  center: [number, number, number];
  /** Unit axis toward the driver, in the imported car's coordinates. */
  axis: [number, number, number];
  radius: number;
}

/** Road steering is negative for a right turn. The axis faces the driver,
 * so the same negative rotation is clockwise from the driver's seat. */
export function steeringWheelAngle(steering: number): number {
  return (
    T.MathUtils.clamp(Number.isFinite(steering) ? steering : 0, -0.55, 0.55) *
    1.7
  );
}

/** Both the real wheel and the driver's wrists use this exact tilted plane. */
export function steeringWheelGrip(
  spec: SteeringWheelSpec,
  side: 1 | -1,
  steering: number,
): T.Vector3 {
  const axis = new T.Vector3(...spec.axis).normalize();
  // The wrist sits just inside the rim; the fingers curl over the wood.
  return new T.Vector3(side * (spec.radius - 0.031), 0, 0)
    .applyAxisAngle(axis, steeringWheelAngle(steering))
    .add(new T.Vector3(...spec.center))
    .addScaledVector(axis, 0.025);
}

export class SteeringWheelVisual {
  private readonly node: T.Object3D;
  private readonly neutral: T.Quaternion;
  private readonly axis: T.Vector3;
  private readonly rotation = new T.Quaternion();

  constructor(root: T.Object3D, spec: SteeringWheelSpec) {
    const node = root.getObjectByName(spec.node);
    if (!node)
      throw new Error("The 442 model is missing its steering-wheel pivot.");
    this.node = node;
    this.neutral = node.quaternion.clone();
    this.axis = new T.Vector3(...spec.axis).normalize();
  }

  update(steering: number): void {
    this.node.quaternion
      .copy(this.neutral)
      .multiply(
        this.rotation.setFromAxisAngle(this.axis, steeringWheelAngle(steering)),
      );
  }
}
