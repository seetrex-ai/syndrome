import { describe, expect, it } from "vitest";
import {
  copyPauli,
  createRng,
  identity,
  independentNoise,
  multiplyInto,
  pauliFrom,
  rotatedSurfaceCode,
  sampleNoise,
  weight,
  type ReadonlyPauli,
} from "../../core";
import { createTraceContext, decodeTrace } from "../model/trace";
import {
  abandonedRecord,
  BONUS_POINTS,
  EMPTY_RECORD,
  hasOpenGame,
  judge,
  LEVEL_P,
  markOpenGame,
  OPEN_KEY,
  readRecord,
  RECORD_KEY,
  scoreOf,
  SOLVED_POINTS,
  STREAK_CAP,
  STREAK_STEP,
  TIME_LIMIT_S,
  writeRecord,
  type ChallengeRecord,
} from "./score";

const d = 5;
const code = rotatedSurfaceCode(d);
const ctx = createTraceContext(d);

/**
 * The first random error at or after `seed` that the decoder corrects (verdict
 * 0: C_MWPM is in the right class, so C_MWPM · X_L is not), with its correction.
 */
function sample(seed: number): { error: ReadonlyPauli; mwpm: ReadonlyPauli } {
  const error = identity(code.n);
  for (let s = seed; ; s++) {
    sampleNoise(independentNoise(LEVEL_P[5]), createRng(s), error);
    const trace = decodeTrace(ctx, error);
    if (trace.verdict === 0 && weight(trace.correction) > 0)
      return { error: trace.error, mwpm: trace.correction };
  }
}

function times(a: ReadonlyPauli, b: ReadonlyPauli): ReadonlyPauli {
  return multiplyInto(identity(a.n), a, b);
}

describe("judge", () => {
  const { error, mwpm } = sample(11);
  const stabilizer = code.stabilizers[3]!.operator;

  it("accepts the decoder's own correction, with the bonus", () => {
    const result = judge(code, error, mwpm, mwpm);
    expect(result).toEqual({
      accepted: true,
      bonus: true,
      flipsX: weight({ n: code.n, x: mwpm.x, z: identity(code.n).z }),
      flipsZ: weight({ n: code.n, x: identity(code.n).x, z: mwpm.z }),
      mwpmX: result.flipsX,
      mwpmZ: result.flipsZ,
    });
  });

  it("accepts C_MWPM · stabilizer (same class), without the bonus when it is heavier", () => {
    const flips = times(mwpm, stabilizer);
    const result = judge(code, error, flips, mwpm);
    expect(result.accepted).toBe(true);
    expect(result.flipsX + result.flipsZ).toBeGreaterThan(
      result.mwpmX + result.mwpmZ,
    );
    expect(result.bonus).toBe(false);
  });

  it("rejects C_MWPM · X_L and C_MWPM · Z_L (logical error left behind)", () => {
    expect(judge(code, error, times(mwpm, code.logicalX), mwpm).accepted).toBe(
      false,
    );
    expect(judge(code, error, times(mwpm, code.logicalZ), mwpm).accepted).toBe(
      false,
    );
  });

  it("rejects the identity when the syndrome is not empty, and never gives a bonus to a rejected answer", () => {
    const none = identity(code.n);
    const result = judge(code, error, none, mwpm);
    expect(result.accepted).toBe(false);
    expect(result.bonus).toBe(false);
    expect(result.flipsX).toBe(0);
    expect(result.flipsZ).toBe(0);
  });

  it("never grants the bonus to a rejected answer, even with the decoder's weights per type", () => {
    // "i3.gAA": X on (0,0); the decoder flips one X. One X flip on the centre
    // qubit has the same weights per type and leaves two defects.
    const code3 = rotatedSurfaceCode(3);
    const error3 = pauliFrom(9, [0], []);
    const mwpm3 = decodeTrace(createTraceContext(3), error3).correction;
    expect(weight(mwpm3)).toBe(1);
    const wrong = judge(code3, error3, pauliFrom(9, [4], []), mwpm3);
    expect(wrong.flipsX).toBe(wrong.mwpmX);
    expect(wrong.flipsZ).toBe(wrong.mwpmZ);
    expect(wrong.accepted).toBe(false);
    expect(wrong.bonus).toBe(false);
  });

  it("counts flips per type: a Y counts as one X and one Z", () => {
    const flips = pauliFrom(code.n, [0, 1], [1, 2]);
    const result = judge(code, error, flips, mwpm);
    expect(result.flipsX).toBe(2);
    expect(result.flipsZ).toBe(2);
  });

  it("the bonus is per-type weight equality, not identity of the correction", () => {
    // A rejected answer with the decoder's weights is not a bonus; an accepted
    // one with equal per-type weights but another support is.
    const { error: e, mwpm: c } = sample(23);
    expect(weight(c)).toBeGreaterThan(0);
    const x = weight({ n: code.n, x: c.x, z: identity(code.n).z });
    const z = weight({ n: code.n, x: identity(code.n).x, z: c.z });
    const r = judge(code, e, c, c);
    expect([r.mwpmX, r.mwpmZ]).toEqual([x, z]);
  });

  it("accepts a scratch buffer and leaves the inputs untouched", () => {
    const scratch = new Uint8Array(code.stabilizers.length);
    const flips = copyPauli(mwpm);
    const before = copyPauli(flips);
    judge(code, error, flips, mwpm, scratch);
    expect(flips).toEqual(before);
    expect(() => judge(code, error, flips, mwpm, new Uint8Array(1))).toThrow(
      RangeError,
    );
  });
});

describe("scoreOf", () => {
  it("solved: SOLVED·d, plus BONUS·d with the bonus; the streak grows by one", () => {
    expect(scoreOf({ accepted: true, bonus: false }, 3, 0)).toEqual({
      points: SOLVED_POINTS * 3,
      streak: 1,
    });
    expect(scoreOf({ accepted: true, bonus: true }, 7, 0)).toEqual({
      points: (SOLVED_POINTS + BONUS_POINTS) * 7,
      streak: 1,
    });
  });

  it("multiplies by 1 + STREAK_STEP·streak, capped at STREAK_CAP", () => {
    const base = SOLVED_POINTS * 5;
    expect(scoreOf({ accepted: true, bonus: false }, 5, 5).points).toBe(
      Math.round(base * (1 + STREAK_STEP * 5)),
    );
    expect(scoreOf({ accepted: true, bonus: false }, 5, 20)).toEqual({
      points: base * STREAK_CAP,
      streak: 21,
    });
    expect(1 + STREAK_STEP * 20).toBeGreaterThan(STREAK_CAP);
  });

  it("a failure gives 0 points and resets the streak", () => {
    expect(scoreOf({ accepted: false, bonus: false }, 7, 9)).toEqual({
      points: 0,
      streak: 0,
    });
  });

  it("points are integers for every distance and streak", () => {
    for (const dist of [3, 5, 7, 9]) {
      for (let streak = 0; streak <= 25; streak++) {
        for (const bonus of [false, true]) {
          const { points } = scoreOf({ accepted: true, bonus }, dist, streak);
          expect(Number.isInteger(points)).toBe(true);
          expect(points).toBeGreaterThan(0);
        }
      }
    }
  });

  it("the initial values live in one block: time limits, level p", () => {
    expect(TIME_LIMIT_S).toEqual({ 3: 20, 5: 40, 7: 60, 9: 90 });
    expect(LEVEL_P).toEqual({ 3: 0.08, 5: 0.06, 7: 0.05, 9: 0.05 });
  });
});

describe("record persistence", () => {
  function fakeStorage(
    initial?: string,
  ): Storage & { store: Map<string, string> } {
    const store = new Map<string, string>();
    if (initial !== undefined) store.set(RECORD_KEY, initial);
    return {
      store,
      length: 0,
      clear: () => store.clear(),
      key: () => null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  }

  it("round-trips a record under RECORD_KEY", () => {
    const storage = fakeStorage();
    const record: ChallengeRecord = {
      best: 45,
      streak: 2,
      played: 7,
      solved: 5,
    };
    writeRecord(storage, record);
    expect(readRecord(storage)).toEqual(record);
    expect(JSON.parse(storage.store.get(RECORD_KEY)!)).toEqual(record);
  });

  it("falls back to the empty record on absence, garbage, wrong shape or a throwing storage", () => {
    expect(readRecord(fakeStorage())).toEqual(EMPTY_RECORD);
    expect(readRecord(fakeStorage("{not json"))).toEqual(EMPTY_RECORD);
    expect(readRecord(fakeStorage('{"best":"x"}'))).toEqual(EMPTY_RECORD);
    expect(readRecord(fakeStorage("[1,2]"))).toEqual(EMPTY_RECORD);
    expect(
      readRecord(fakeStorage('{"best":-1,"streak":0,"played":0,"solved":0}')),
    ).toEqual(EMPTY_RECORD);
    expect(readRecord(undefined)).toEqual(EMPTY_RECORD);
    const throwing = fakeStorage();
    throwing.getItem = () => {
      throw new Error("private mode");
    };
    throwing.setItem = () => {
      throw new Error("quota");
    };
    expect(readRecord(throwing)).toEqual(EMPTY_RECORD);
    expect(() => writeRecord(throwing, EMPTY_RECORD)).not.toThrow();
    expect(() => writeRecord(undefined, EMPTY_RECORD)).not.toThrow();
  });

  it("an abandoned game is a failure: streak 0, played + 1, best and solved intact", () => {
    const record: ChallengeRecord = {
      best: 50,
      streak: 5,
      played: 7,
      solved: 6,
    };
    expect(abandonedRecord(record)).toEqual({
      best: 50,
      streak: 0,
      played: 8,
      solved: 6,
    });
    expect(record.streak).toBe(5);
  });

  it("marks the game in progress under OPEN_KEY, apart from the record, and clears it with null; a throwing storage is survived", () => {
    const storage = fakeStorage();
    expect(hasOpenGame(storage)).toBe(false);
    markOpenGame(storage, { startedAt: 1000, d: 5 });
    expect(hasOpenGame(storage)).toBe(true);
    expect(JSON.parse(storage.store.get(OPEN_KEY)!)).toEqual({
      startedAt: 1000,
      d: 5,
    });
    expect(storage.store.has(RECORD_KEY)).toBe(false);
    markOpenGame(storage, null);
    expect(hasOpenGame(storage)).toBe(false);
    expect(storage.store.has(OPEN_KEY)).toBe(false);
    const throwing = fakeStorage();
    throwing.getItem = () => {
      throw new Error("private mode");
    };
    throwing.setItem = () => {
      throw new Error("quota");
    };
    throwing.removeItem = () => {
      throw new Error("blocked");
    };
    expect(hasOpenGame(throwing)).toBe(false);
    expect(() => markOpenGame(throwing, { startedAt: 1, d: 3 })).not.toThrow();
    expect(() => markOpenGame(throwing, null)).not.toThrow();
    expect(hasOpenGame(undefined)).toBe(false);
    expect(() => markOpenGame(undefined, null)).not.toThrow();
  });
});
