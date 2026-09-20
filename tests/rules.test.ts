import { describe, it, expect } from "vitest";
import {
  BoostBank,
  FixedClock,
  RaceProgress,
  ReverseGate,
  TakedownLedger,
} from "../src/rules";
import type { Point } from "../src/types";

describe("deliberate reverse selection", () => {
  it("does not reverse from a brake held throughout a forward stop", () => {
    const gate = new ReverseGate();
    for (const speed of [25, 12, 3, 0.5, 0, 0])
      expect(gate.update(speed, 0.7, 0)).toBe(false);
    expect(gate.update(0, 0, 0)).toBe(false);
    expect(gate.update(0, 0.7, 0)).toBe(true);
    expect(gate.update(-3, 0.7, 0)).toBe(true);
    expect(gate.update(-3, 0, 0.3)).toBe(false);
  });
  it("requires another deliberate release after reset", () => {
    const gate = new ReverseGate();
    gate.update(0, 0, 0);
    gate.update(0, 1, 0);
    gate.reset();
    expect(gate.update(0, 1, 0)).toBe(false);
    gate.update(0, 0, 0);
    expect(gate.update(0, 0.8, 0)).toBe(true);
  });
});

describe("fixed physics accumulator", () => {
  it.each([30, 60, 120])(
    "advances identical physics duration at %i rendered frames/s",
    (fps) => {
      const clock = new FixedClock();
      let elapsed = 0,
        steps = 0;
      for (let frame = 0; frame < fps * 5; frame++) {
        const alpha = clock.tick(1 / fps, (dt) => {
          elapsed += dt;
          steps++;
        });
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThanOrEqual(1);
      }
      expect(steps).toBe(300);
      expect(elapsed).toBeCloseTo(5, 9);
    },
  );
  it("bounds catch-up after a long stall and discards paused partial time", () => {
    const clock = new FixedClock();
    let steps = 0;
    clock.tick(10, () => steps++);
    expect(steps).toBeLessThanOrEqual(6);
    clock.tick(1 / 120, () => steps++);
    clock.reset();
    const before = steps;
    clock.tick(1 / 120, () => steps++);
    expect(steps).toBe(before);
    clock.tick(1 / 120, () => steps++);
    expect(steps).toBe(before + 1);
  });
});

describe("boost reserve accounting", () => {
  it("requires motion and ground contact and drains proportionally to time", () => {
    const bank = new BoostBank();
    expect(bank.spend(1, true, 0, true)).toBe(false);
    expect(bank.spend(1, true, 20, false)).toBe(false);
    expect(bank.spend(1, false, 20, true)).toBe(false);
    expect(bank.value).toBe(65);
    expect(bank.spend(0.5, true, 20, true)).toBe(true);
    expect(bank.value).toBeCloseTo(55.5);
    bank.spend(20, true, 20, true);
    expect(bank.value).toBe(0);
    expect(bank.spend(0.1, true, 20, true)).toBe(false);
  });
  it("deduplicates event cooldowns, caps reserve, and resets event history", () => {
    const bank = new BoostBank();
    bank.value = 10;
    expect(bank.earn("near-miss:7", 8, 1, 5)).toBe(true);
    expect(bank.earn("near-miss:7", 8, 5.9, 5)).toBe(false);
    expect(bank.value).toBe(18);
    expect(bank.earn("near-miss:7", 8, 6, 5)).toBe(true);
    expect(bank.earn("takedown:3:2", 200, 6)).toBe(true);
    expect(bank.value).toBe(100);
    bank.reset();
    expect(bank.value).toBe(65);
    expect(bank.earn("near-miss:7", 8, 0, 5)).toBe(true);
  });
});

const straight: Point[] = [
  [0, 0, 0],
  [0, 0, 10],
  [0, 0, 20],
  [0, 0, 30],
];
function cross(
  race: RaceProgress,
  target: Point,
  direction: Point = [0, 0, 1],
) {
  race.update(
    [target[0] - direction[0], target[1], target[2] - direction[2]],
    1 / 60,
  );
  return race.update(
    [target[0] + direction[0], target[1], target[2] + direction[2]],
    1 / 60,
  );
}
describe("ordered race gates", () => {
  it("requires checkpoint order, forward crossings, and a narrow physical crossing", () => {
    const race = new RaceProgress(straight);
    expect(cross(race, straight[2])).toBe(false);
    expect(race.next).toBe(1);
    expect(cross(race, straight[1], [0, 0, -1])).toBe(false);
    expect(cross(race, [20, 0, 10])).toBe(false);
    race.update([0, 0, 0], 1 / 60);
    expect(race.update([0, 0, 25], 1 / 60)).toBe(false);
    expect(cross(race, straight[1])).toBe(true);
    expect(race.next).toBe(2);
    expect(cross(race, straight[1])).toBe(false);
    expect(race.crossings).toBe(1);
    expect(cross(race, straight[2])).toBe(true);
    expect(cross(race, straight[3])).toBe(true);
    expect(race.finished).toBe(true);
    expect(race.score).toBe(3);
    const finishTime = race.elapsed;
    race.update([0, 0, 50], 3);
    expect(race.elapsed).toBe(finishTime);
  });
  it("recovery preserves next gate and cannot award progress across a teleport", () => {
    const race = new RaceProgress(straight);
    cross(race, straight[1]);
    race.recovered([0, 0, 19]);
    expect(race.update([0, 0, 21], 1 / 60)).toBe(false);
    expect(race.next).toBe(2);
    expect(race.crossings).toBe(1);
    for (let i = 0; i < 60; i++) race.update([0, 0, 21], 1 / 60);
    expect(race.finished).toBe(false);
    expect(cross(race, straight[2])).toBe(true);
    race.reset();
    expect(race.next).toBe(1);
    expect(race.lap).toBe(1);
    expect(race.crossings).toBe(0);
    expect(race.elapsed).toBe(0);
  });
  it("finishes a closed circuit only after all ordered gates on every lap", () => {
    const points: Point[] = [
      [0, 0, 0],
      [0, 0, 20],
      [20, 0, 20],
      [20, 0, 0],
      [0, 0, 0],
    ];
    const race = new RaceProgress(points, 3, true);
    for (let lap = 1; lap <= 3; lap++) {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i],
          len = Math.hypot(b[0] - a[0], b[2] - a[2]);
        expect(
          cross(race, b, [(b[0] - a[0]) / len, 0, (b[2] - a[2]) / len]),
        ).toBe(true);
      }
      expect(race.finished).toBe(lap === 3);
    }
    expect(race.crossings).toBe(12);
    expect(race.lap).toBe(3);
    expect(race.score).toBe(12);
  });
});

describe("takedown credit", () => {
  it("requires recent player contact and awards each opponent life once", () => {
    const ledger = new TakedownLedger();
    expect(ledger.wreck(3, 0, 1)).toBe(false);
    ledger.contact(3, 5);
    expect(ledger.wreck(3, 0, 8)).toBe(false);
    ledger.contact(3, 10);
    expect(ledger.wreck(3, 0, 12)).toBe(true);
    ledger.contact(3, 12);
    expect(ledger.wreck(3, 0, 12.1)).toBe(false);
    ledger.contact(3, 15);
    expect(ledger.wreck(3, 1, 16)).toBe(true);
    expect(ledger.wreck(4, 1, 16)).toBe(false);
    ledger.clear();
    expect(ledger.wreck(3, 1, 16)).toBe(false);
  });
});
