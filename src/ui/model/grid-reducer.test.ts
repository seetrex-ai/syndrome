import { describe, expect, it } from "vitest";
import {
  copyPauli,
  createRng,
  identity,
  independentNoise,
  pauliEquals,
  sampleNoise,
} from "../../core";
import { gridReducer, initialGridState } from "./grid-reducer";

const d = 3;
const q = 4;

function pauliOf(state: ReturnType<typeof initialGridState>, i: number) {
  return `${state.error.x[i]}${state.error.z[i]}`;
}

describe("gridReducer", () => {
  it("toggleX cycles I → X → I and Z → Y → Z", () => {
    const s0 = initialGridState(d);
    const s1 = gridReducer(s0, { type: "toggleX", q });
    expect(pauliOf(s1, q)).toBe("10");
    const s2 = gridReducer(s1, { type: "toggleX", q });
    expect(pauliOf(s2, q)).toBe("00");
    const z = gridReducer(s0, { type: "toggleZ", q });
    expect(pauliOf(z, q)).toBe("01");
    const y = gridReducer(z, { type: "toggleX", q });
    expect(pauliOf(y, q)).toBe("11");
    expect(pauliOf(gridReducer(y, { type: "toggleX", q }), q)).toBe("01");
  });

  it("toggleZ cycles I → Z and X → Y", () => {
    const s0 = initialGridState(d);
    expect(pauliOf(gridReducer(s0, { type: "toggleZ", q }), q)).toBe("01");
    const x = gridReducer(s0, { type: "toggleX", q });
    expect(pauliOf(gridReducer(x, { type: "toggleZ", q }), q)).toBe("11");
  });

  it("never mutates the previous state", () => {
    const s0 = initialGridState(d);
    const before = copyPauli(s0.error);
    const s1 = gridReducer(s0, { type: "toggleX", q });
    gridReducer(s1, { type: "toggleZ", q });
    gridReducer(s1, { type: "randomize", p: 0.5, seed: 1 });
    gridReducer(s1, { type: "clear" });
    expect(pauliEquals(s0.error, before)).toBe(true);
    expect(pauliEquals(s0.error, s1.error)).toBe(false);
    expect(s1.error.x).not.toBe(s0.error.x);
    expect(Object.isFrozen(s1)).toBe(true);
    expect(Object.isFrozen(s1.error)).toBe(true);
  });

  it("increments the revision on every change", () => {
    const s0 = initialGridState(d);
    const s1 = gridReducer(s0, { type: "toggleX", q });
    const s2 = gridReducer(s1, { type: "clear" });
    expect([s0.revision, s1.revision, s2.revision]).toEqual([0, 1, 2]);
  });

  it("randomize reproduces sampleNoise with the same seed", () => {
    const s = gridReducer(initialGridState(d), {
      type: "randomize",
      p: 0.3,
      seed: 12345,
    });
    const expected = sampleNoise(
      independentNoise(0.3),
      createRng(12345),
      identity(d * d),
    );
    expect(pauliEquals(s.error, expected)).toBe(true);
    const other = gridReducer(initialGridState(d), {
      type: "randomize",
      p: 0.3,
      seed: 12346,
    });
    expect(pauliEquals(other.error, expected)).toBe(false);
  });

  it("clear returns the identity and setDistance clears to the new size", () => {
    const s = gridReducer(initialGridState(d), { type: "toggleX", q });
    const cleared = gridReducer(s, { type: "clear" });
    expect(pauliEquals(cleared.error, identity(d * d))).toBe(true);
    const bigger = gridReducer(s, { type: "setDistance", d: 5 });
    expect(bigger.d).toBe(5);
    expect(bigger.error.n).toBe(25);
    expect(pauliEquals(bigger.error, identity(25))).toBe(true);
    expect(gridReducer(s, { type: "setDistance", d })).toBe(s);
  });

  it("ignores a qubit index outside the code (a press that outlived a distance change)", () => {
    const s = gridReducer(initialGridState(d), { type: "toggleX", q });
    // d = 7 → 3 with a press pending on q = 40: no throw, no change.
    expect(gridReducer(s, { type: "toggleX", q: 40 })).toBe(s);
    expect(gridReducer(s, { type: "toggleZ", q: 9 })).toBe(s);
    expect(gridReducer(s, { type: "toggleZ", q: -1 })).toBe(s);
    expect(gridReducer(s, { type: "toggleX", q: 1.5 })).toBe(s);
    expect(pauliOf(s, q)).toBe("10");
  });
});

describe("initialGridState and setDistance with a shot", () => {
  const shot = { p: 0.5, seed: 7 };

  it("initialGridState(d, shot) draws sampleNoise with the shot's p and seed, revision 0, frozen", () => {
    const s = initialGridState(3, shot);
    const expected = identity(9);
    sampleNoise(independentNoise(0.5), createRng(7), expected);
    expect(pauliEquals(s.error, expected)).toBe(true);
    expect(s.revision).toBe(0);
    expect(Object.isFrozen(s.error)).toBe(true);
    expect(pauliEquals(initialGridState(3).error, identity(9))).toBe(true);
  });

  it("setDistance with a shot gives the new size with that shot; without one, the empty grid; same d, same state", () => {
    const s0 = initialGridState(3, shot);
    const next = { p: 0.5, seed: 9 };
    const s1 = gridReducer(s0, { type: "setDistance", d: 5, shot: next });
    expect(s1.d).toBe(5);
    expect(pauliEquals(s1.error, initialGridState(5, next).error)).toBe(true);
    expect(pauliEquals(s1.error, initialGridState(5, shot).error)).toBe(false);
    const s2 = gridReducer(s0, { type: "setDistance", d: 5 });
    expect(pauliEquals(s2.error, identity(25))).toBe(true);
    expect(gridReducer(s0, { type: "setDistance", d: 3, shot: next })).toBe(s0);
  });
});
