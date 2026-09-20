import { clamp, type Point } from "./types";
export class FixedClock {
  accumulator = 0;
  readonly step = 1 / 60;
  dropped = 0;
  tick(elapsed: number, fn: (dt: number) => void) {
    this.accumulator += Math.min(0.1, Math.max(0, elapsed));
    let n = 0;
    while (this.accumulator + 1e-9 >= this.step && n < 6) {
      fn(this.step);
      this.accumulator -= this.step;
      n++;
    }
    if (this.accumulator >= this.step) {
      this.dropped += this.accumulator;
      this.accumulator = 0;
    }
    return clamp(this.accumulator / this.step, 0, 1);
  }
  reset() {
    this.accumulator = 0;
  }
}
export class ReverseGate {
  reverse = false;
  private releasedAtStop = false;
  update(speed: number, brake: number, throttle: number) {
    if (throttle > 0.12) {
      this.reverse = false;
      this.releasedAtStop = false;
    }
    if (Math.abs(speed) < 0.65) {
      if (brake < 0.08) this.releasedAtStop = true;
      else if (brake > 0.2 && this.releasedAtStop) {
        this.reverse = true;
        this.releasedAtStop = false;
      }
    } else if (speed > 1) this.releasedAtStop = false;
    return this.reverse;
  }
  reset() {
    this.reverse = false;
    this.releasedAtStop = false;
  }
}
export class BoostBank {
  value = 65;
  private awarded = new Map<string, number>();
  spend(dt: number, requested: boolean, speed: number, grounded: boolean) {
    const active = requested && grounded && speed > 2 && this.value > 0;
    if (active) this.value = clamp(this.value - dt * 19, 0, 100);
    return active;
  }
  earn(key: string, amount: number, time: number, cooldown = 5) {
    if (time - (this.awarded.get(key) ?? -Infinity) < cooldown) return false;
    this.awarded.set(key, time);
    this.value = clamp(this.value + amount, 0, 100);
    return true;
  }
  reset() {
    this.value = 65;
    this.awarded.clear();
  }
}
export class RaceProgress {
  next = 1;
  lap = 1;
  finished = false;
  elapsed = 0;
  crossings = 0;
  lastPosition: Point | null = null;
  blocked = 0;
  constructor(
    public points: Point[],
    public laps = 1,
    public circuit = false,
  ) {}
  reset() {
    this.next = 1;
    this.lap = 1;
    this.finished = false;
    this.elapsed = 0;
    this.crossings = 0;
    this.lastPosition = null;
    this.blocked = 0.5;
  }
  recovered(p: Point) {
    this.lastPosition = [...p];
    this.blocked = 0.7;
  }
  update(p: Point, dt: number) {
    if (this.finished) return false;
    this.elapsed += dt;
    this.blocked = Math.max(0, this.blocked - dt);
    const previous = this.lastPosition;
    this.lastPosition = [...p];
    if (!previous || this.blocked > 0) return false;
    const target = this.points[this.next],
      before =
        this.points[(this.next - 1 + this.points.length) % this.points.length];
    if (!target || !before) return false;
    const dx = target[0] - before[0],
      dz = target[2] - before[2],
      len = Math.hypot(dx, dz) || 1;
    const old =
      ((previous[0] - target[0]) * dx) / len +
      ((previous[2] - target[2]) * dz) / len;
    const now =
      ((p[0] - target[0]) * dx) / len + ((p[2] - target[2]) * dz) / len;
    const lateral = Math.abs(
      ((p[0] - target[0]) * dz) / len - ((p[2] - target[2]) * dx) / len,
    );
    if (
      old <= 0 &&
      now > 0 &&
      lateral < 14 &&
      Math.hypot(p[0] - previous[0], p[2] - previous[2]) < 12
    ) {
      this.crossings++;
      this.next++;
      if (this.next >= this.points.length) {
        if (this.circuit && this.lap < this.laps) {
          this.lap++;
          this.next = 1;
        } else this.finished = true;
      }
      return true;
    }
    return false;
  }
  get score() {
    return (this.lap - 1) * (this.points.length - 1) + this.next - 1;
  }
}
export class TakedownLedger {
  contacts = new Map<number, number>();
  credited = new Set<string>();
  contact(id: number, time: number) {
    this.contacts.set(id, time);
  }
  wreck(id: number, life: number, time: number) {
    const key = `${id}:${life}`;
    if (
      time - (this.contacts.get(id) ?? -Infinity) > 2.5 ||
      this.credited.has(key)
    )
      return false;
    this.credited.add(key);
    return true;
  }
  clear() {
    this.contacts.clear();
    this.credited.clear();
  }
}
