import { describe, expect, it } from "vitest";
import {
  BOUNDARY,
  LOGICAL_X,
  LOGICAL_Z,
  pauliFrom,
  qubitIndex,
} from "../../core";
import { createTraceContext, decodeTrace } from "./trace";

const d = 3;
const n = d * d;

function litPlaquettes(mask: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i] !== 0) out.push(i);
  return out;
}

describe("decodeTrace", () => {
  it("X on the centre qubit of d = 3 lights exactly the Z plaquettes (0,0) and (1,1) and corrects with one qubit", () => {
    const ctx = createTraceContext(d);
    const q = qubitIndex(d, 1, 1);
    const trace = decodeTrace(ctx, pauliFrom(n, [q], []));
    const lit = litPlaquettes(trace.syndromes.Z).map((t) => {
      const s = ctx.code.stabilizersByType.Z[t]!;
      return [s.row, s.col];
    });
    expect(lit).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(litPlaquettes(trace.syndromes.X)).toEqual([]);
    expect(trace.chains.X).toEqual([]);
    expect(trace.chains.Z).toHaveLength(1);
    expect(trace.chains.Z[0]!.qubits).toEqual([q]);
    expect(trace.chains.Z[0]!.b).not.toBe(BOUNDARY);
    expect(trace.verdict).toBe(0);
    expect(trace.correction.x[q]).toBe(1);
    expect([...trace.residual.x]).toEqual(new Array(n).fill(0));
  });

  it("X on a full column has a null syndrome, no chains and a logical X verdict", () => {
    const ctx = createTraceContext(d);
    const column = [0, 1, 2].map((r) => qubitIndex(d, r, 0));
    const trace = decodeTrace(ctx, pauliFrom(n, column, []));
    expect(litPlaquettes(trace.syndromes.Z)).toEqual([]);
    expect(litPlaquettes(trace.syndromes.X)).toEqual([]);
    expect(trace.chains.Z).toEqual([]);
    expect(trace.chains.X).toEqual([]);
    expect(trace.verdict & LOGICAL_X).toBe(LOGICAL_X);
    expect(trace.verdict & LOGICAL_Z).toBe(0);
  });

  it("Z on a full row gives a logical Z verdict; X and Z together give both bits", () => {
    const ctx = createTraceContext(d);
    const row = [0, 1, 2].map((c) => qubitIndex(d, 0, c));
    expect(decodeTrace(ctx, pauliFrom(n, [], row)).verdict).toBe(LOGICAL_Z);
    const column = [0, 1, 2].map((r) => qubitIndex(d, r, 0));
    expect(decodeTrace(ctx, pauliFrom(n, column, row)).verdict).toBe(
      LOGICAL_X | LOGICAL_Z,
    );
  });

  it("is frozen and shares no buffer with the context: a later decode does not change it", () => {
    const ctx = createTraceContext(d);
    const q = qubitIndex(d, 1, 1);
    const trace = decodeTrace(ctx, pauliFrom(n, [q], []));
    expect(Object.isFrozen(trace)).toBe(true);
    expect(Object.isFrozen(trace.chains)).toBe(true);
    expect(Object.isFrozen(trace.chains.Z)).toBe(true);
    expect(Object.isFrozen(trace.chains.Z[0])).toBe(true);
    expect(Object.isFrozen(trace.chains.Z[0]!.qubits)).toBe(true);
    expect(Object.isFrozen(trace.error)).toBe(true);
    expect(trace.error.x).not.toBe(ctx.error.x);
    expect(trace.syndromes.Z).not.toBe(ctx.syndromes.Z);

    const before = {
      error: [...trace.error.x],
      syndrome: [...trace.syndromes.Z],
      correction: [...trace.correction.x],
      residual: [...trace.residual.x],
    };
    // Mutate the context directly and decode something else through it.
    ctx.error.x.fill(1);
    decodeTrace(ctx, pauliFrom(n, [0, 1, 2], []));
    expect([...trace.error.x]).toEqual(before.error);
    expect([...trace.syndromes.Z]).toEqual(before.syndrome);
    expect([...trace.correction.x]).toEqual(before.correction);
    expect([...trace.residual.x]).toEqual(before.residual);
  });

  it("rejects an error of another size", () => {
    const ctx = createTraceContext(d);
    expect(() => decodeTrace(ctx, pauliFrom(25, [], []))).toThrow(RangeError);
  });
});
