import { Vehicle, handling } from "./vehicle";
import { angleDiff, clamp, type DriveInput, type Point } from "./types";
export class Driver {
  target = 1;
  stuck = 0;
  speed = 22;
  path: Point[];
  lane = 0;
  finished = false;
  constructor(
    public vehicle: Vehicle,
    path: Point[],
    public civilian = false,
  ) {
    this.path = path;
    this.speed = civilian ? 13 : 25;
    // Positive path-normal offset is physical left in the game's +Z-forward axes.
    this.lane = civilian ? -2.4 : 0;
  }
  input(dt: number): DriveInput {
    const v = this.vehicle,
      p = v.position,
      path = this.path;
    let a = path[Math.max(0, this.target - 1)],
      b = path[this.target];
    if (!b)
      return {
        steer: 0,
        throttle: 0,
        brake: 1,
        boost: false,
        handbrake: false,
      };
    let dx = b[0] - a[0],
      dz = b[2] - a[2],
      len = Math.hypot(dx, dz) || 1;
    const along = ((p.x - b[0]) * dx + (p.z - b[2]) * dz) / len;
    const lateral = Math.abs(((p.x - b[0]) * dz - (p.z - b[2]) * dx) / len);
    // Advance at the actual gate; proximity switching skipped sharp junctions.
    if (along >= 0 && lateral < 12) {
      this.target++;
      if (this.target >= path.length) {
        this.target = 1;
        this.finished = true;
      }
      a = path[this.target - 1];
      b = path[this.target];
      dx = b[0] - a[0];
      dz = b[2] - a[2];
      len = Math.hypot(dx, dz) || 1;
    }
    const direction = Math.atan2(dx, dz),
      projection = clamp(
        ((p.x - a[0]) * dx + (p.z - a[2]) * dz) / (len * len),
        0,
        1,
      );
    const heading = Math.atan2(
      2 * (v.rotation.w * v.rotation.y + v.rotation.x * v.rotation.z),
      1 - 2 * (v.rotation.y * v.rotation.y + v.rotation.x * v.rotation.x),
    );
    let corner = 0,
      previewDistance = 0;
    for (
      let i = this.target;
      i < path.length - 1 && previewDistance < Math.max(24, v.speed * 1.7);
      i++
    ) {
      const c = path[i],
        d = path[i + 1];
      previewDistance += Math.hypot(d[0] - c[0], d[2] - c[2]);
      corner = Math.max(
        corner,
        Math.abs(angleDiff(Math.atan2(d[0] - c[0], d[2] - c[2]), direction)),
      );
    }
    // Look ahead from projected car position rather than the next waypoint.
    let target: Point = [
      a[0] + dx * projection,
      a[1] + (b[1] - a[1]) * projection,
      a[2] + dz * projection,
    ];
    let remaining = clamp(5 + v.speed * 0.35, 5, 14) / (1 + corner * 0.23);
    for (let i = this.target; i < path.length; i++) {
      const next = path[i],
        seg = Math.hypot(next[0] - target[0], next[2] - target[2]);
      if (seg >= remaining) {
        const t = remaining / (seg || 1);
        target = [
          target[0] + (next[0] - target[0]) * t,
          target[1] + (next[1] - target[1]) * t,
          target[2] + (next[2] - target[2]) * t,
        ];
        break;
      }
      remaining -= seg;
      target = next;
    }
    const tx = target[0] + Math.cos(direction) * this.lane,
      tz = target[2] - Math.sin(direction) * this.lane;
    const error = angleDiff(Math.atan2(tx - p.x, tz - p.z), heading),
      distance = Math.max(3, Math.hypot(tx - p.x, tz - p.z));
    const availableSteer =
      handling.steerLow / (1 + v.speed * handling.steerFalloff);
    const steer = clamp(
      Math.atan2(2 * 2.845 * Math.sin(error), distance) / availableSteer,
      -1,
      1,
    );
    const desired = Math.min(
      Math.max(5, this.speed / (1 + corner * 1.7)),
      this.speed / (1 + Math.abs(error) * 1.3),
    );
    this.stuck = v.speed < 2 ? this.stuck + dt : 0;
    return {
      steer: -steer,
      throttle: clamp((desired - v.speed) * 0.35, 0, 0.9),
      brake: clamp((v.speed - desired) * 0.25, 0, 0.85),
      boost: false,
      handbrake: false,
    };
  }
}
