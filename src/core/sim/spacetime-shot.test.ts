import { describe, expect, it } from "vitest";
import { identity, pauliFrom, type Pauli } from "../lattice/pauli";
import { rotatedSurfaceCode, type StabilizerType } from "../lattice/rotated";
import { computeTypeSyndrome } from "../lattice/syndrome";
import { nodeIndex, spacetimeGraph } from "../decoder/spacetime";
import { phenomenologicalNoise } from "../noise/phenomenological";
import { createRng, type Rng } from "../noise/rng";
import { LOGICAL_X, LOGICAL_Z } from "./shot";
import {
  createSpacetimeHistory,
  createSpacetimeShotContext,
  cumulativeErrorsOf,
  decodeSpacetimeHistory,
  decodeSpacetimeShot,
  detectorsOf,
  runSpacetimeShot,
  sampleSpacetimeHistory,
  readingsOf,
  type SpacetimeShotContext,
} from "./spacetime-shot";

const TYPES: readonly StabilizerType[] = ["Z", "X"];

/** Cumulative errors and flips of a history with no event: all identity, all zero. */
function emptyHistory(
  n: number,
  m: number,
  cycles: number,
): { errors: Pauli[]; flips: Uint8Array[] } {
  const errors: Pauli[] = [];
  const flips: Uint8Array[] = [];
  for (let r = 0; r < cycles; r++) {
    errors.push(identity(n));
    flips.push(new Uint8Array(m));
  }
  return { errors, flips };
}

/** Lit node indices of a detector vector. */
function lit(detectors: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < detectors.length; i++)
    if (detectors[i] !== 0) out.push(i);
  return out;
}

/** Puts `detectors` of both types into the context and decodes (manual mode). */
function decodeHistory(
  ctx: SpacetimeShotContext,
  cumulative: Pauli,
  history: { errors: Pauli[]; flips: Uint8Array[] },
): number {
  ctx.cumulative.x.set(cumulative.x);
  ctx.cumulative.z.set(cumulative.z);
  const cycles = ctx.noise.cycles;
  for (const type of TYPES) {
    detectorsOf(
      ctx.code,
      type,
      cycles,
      history.errors,
      history.flips,
      ctx.detectors[type],
    );
  }
  return decodeSpacetimeShot(ctx);
}

describe("T-A5 injected histories: one mechanism, its detectors, its correction (phase2.md D1)", () => {
  for (const [d, cycles] of [
    [3, 3],
    [5, 2],
  ] as const) {
    const code = rotatedSurfaceCode(d);
    const m = (code.n - 1) / 2;
    const ctx = createSpacetimeShotContext(
      code,
      phenomenologicalNoise(0.1, cycles),
      createRng(1),
    );

    it(`d = ${d}, cycles = ${cycles}: a single measurement flip at (s, r) lights exactly (r, s) and (r + 1, s); correction empty, verdict 0`, () => {
      for (const type of TYPES) {
        const g = spacetimeGraph(code, type, cycles);
        for (let r = 1; r <= cycles; r++) {
          for (let s = 0; s < m; s++) {
            const h = emptyHistory(code.n, m, cycles);
            h.flips[r - 1]![s] = 1;
            const out = detectorsOf(
              code,
              type,
              cycles,
              h.errors,
              h.flips,
              new Uint8Array(g.nodes),
            );
            expect(lit(out)).toEqual([
              nodeIndex(g, r, s),
              nodeIndex(g, r + 1, s),
            ]);
            // The other type (its own flips are empty) sees nothing: flips
            // never touch the data.
            const otherType = type === "Z" ? "X" : "Z";
            const otherOut = detectorsOf(
              code,
              otherType,
              cycles,
              h.errors,
              emptyHistory(code.n, m, cycles).flips,
              new Uint8Array(g.nodes),
            );
            expect(lit(otherOut)).toEqual([]);
            // Decoded: a flip is explained by its time edge, no qubit touched.
            const bits = decodeHistoryOneType(ctx, type, h);
            expect(bits).toBe(0);
            expect(ctx.correction.x.every((b) => b === 0)).toBe(true);
            expect(ctx.correction.z.every((b) => b === 0)).toBe(true);
          }
        }
      }
    });

    it(`d = ${d}, cycles = ${cycles}: a single data error at (q, r) lights the 2D syndrome of q in layer r only; correction = that error, verdict 0`, () => {
      for (const type of TYPES) {
        const g = spacetimeGraph(code, type, cycles);
        const syndrome2d = new Uint8Array(m);
        for (let r = 1; r <= cycles; r++) {
          for (let q = 0; q < code.n; q++) {
            const error =
              type === "Z"
                ? pauliFrom(code.n, [q], [])
                : pauliFrom(code.n, [], [q]);
            const h = emptyHistory(code.n, m, cycles);
            for (let rr = r; rr <= cycles; rr++) {
              h.errors[rr - 1] = error;
            }
            const out = detectorsOf(
              code,
              type,
              cycles,
              h.errors,
              h.flips,
              new Uint8Array(g.nodes),
            );
            computeTypeSyndrome(code, type, error, syndrome2d);
            const expected: number[] = [];
            for (let s = 0; s < m; s++)
              if (syndrome2d[s] !== 0) expected.push(nodeIndex(g, r, s));
            expect(expected.length).toBeGreaterThan(0);
            expect(lit(out)).toEqual(expected);
            const bits = decodeHistory(ctx, error, h);
            expect(bits).toBe(0);
            // The correction is ONE qubit of this type (a single space edge)
            // and the residual is a stabilizer: identity for an interior
            // qubit; for two boundary qubits sharing their only check of
            // this type (e.g. (0,0) and (0,1) for type Z) the decoder may
            // pick the cheaper one and the residual is their weight-2
            // stabilizer. Null syndrome of both types + verdict 0 = stabilizer.
            const mask = type === "Z" ? ctx.correction.x : ctx.correction.z;
            const other = type === "Z" ? ctx.correction.z : ctx.correction.x;
            expect(mask.reduce((a, b) => a + b, 0)).toBe(1);
            expect(other.every((b) => b === 0)).toBe(true);
            for (const t of TYPES) {
              computeTypeSyndrome(code, t, ctx.residual, syndrome2d);
              expect(syndrome2d.every((b) => b === 0)).toBe(true);
            }
          }
        }
      }
    });

    it(`d = ${d}, cycles = ${cycles}: a flip in the LAST cycle lights the perfect layer (cycles + 1, s); a data error in the last cycle lights layer cycles only`, () => {
      const g = spacetimeGraph(code, "Z", cycles);
      const h = emptyHistory(code.n, m, cycles);
      h.flips[cycles - 1]![1] = 1;
      const out = detectorsOf(
        code,
        "Z",
        cycles,
        h.errors,
        h.flips,
        new Uint8Array(g.nodes),
      );
      expect(lit(out)).toEqual([
        nodeIndex(g, cycles, 1),
        nodeIndex(g, cycles + 1, 1),
      ]);
      const h2 = emptyHistory(code.n, m, cycles);
      const error = pauliFrom(code.n, [0], []);
      h2.errors[cycles - 1] = error;
      const out2 = detectorsOf(
        code,
        "Z",
        cycles,
        h2.errors,
        h2.flips,
        new Uint8Array(g.nodes),
      );
      for (const node of lit(out2))
        expect(Math.floor(node / m) + 1).toBe(cycles);
      expect(lit(out2).length).toBeGreaterThan(0);
    });
  }

  it("a data error that is undone in the next cycle (X then X on q) lights layer r and layer r + 1 with the same 2D syndrome", () => {
    const code = rotatedSurfaceCode(3);
    const m = 4;
    const g = spacetimeGraph(code, "Z", 3);
    const h = emptyHistory(code.n, m, 3);
    h.errors[0] = pauliFrom(9, [4], []); // cycle 1: X on the centre
    // cycle 2 and 3: back to identity (already identity)
    const out = detectorsOf(
      code,
      "Z",
      3,
      h.errors,
      h.flips,
      new Uint8Array(g.nodes),
    );
    const s2d = computeTypeSyndrome(
      code,
      "Z",
      pauliFrom(9, [4], []),
      new Uint8Array(m),
    );
    const expected: number[] = [];
    for (const r of [1, 2])
      for (let s = 0; s < m; s++) if (s2d[s]) expected.push(nodeIndex(g, r, s));
    expect(lit(out)).toEqual(expected);
  });

  it("detectorsOf rejects a bad history shape", () => {
    const code = rotatedSurfaceCode(3);
    const h = emptyHistory(9, 4, 2);
    expect(() =>
      detectorsOf(code, "Z", 2, h.errors, h.flips, new Uint8Array(11)),
    ).toThrow(RangeError);
    expect(() =>
      detectorsOf(code, "Z", 3, h.errors, h.flips, new Uint8Array(16)),
    ).toThrow(RangeError);
    expect(() =>
      detectorsOf(
        code,
        "Z",
        2,
        h.errors,
        [new Uint8Array(4), new Uint8Array(3)],
        new Uint8Array(12),
      ),
    ).toThrow(RangeError);
    expect(() => detectorsOf(code, "Z", 0, [], [], new Uint8Array(4))).toThrow(
      RangeError,
    );
  });
});

/** Decodes a one-type history (the other type's detectors are left at zero). */
function decodeHistoryOneType(
  ctx: SpacetimeShotContext,
  type: StabilizerType,
  history: { errors: Pauli[]; flips: Uint8Array[] },
): number {
  ctx.cumulative.x.fill(0);
  ctx.cumulative.z.fill(0);
  ctx.detectors.Z.fill(0);
  ctx.detectors.X.fill(0);
  detectorsOf(
    ctx.code,
    type,
    ctx.noise.cycles,
    history.errors,
    history.flips,
    ctx.detectors[type],
  );
  return decodeSpacetimeShot(ctx);
}

describe("T-A5 runSpacetimeShot: buffers, determinism, PRNG budget, both types", () => {
  it("consumes exactly cycles·(2n + 2m) draws per shot and is reproducible by seed", () => {
    const code = rotatedSurfaceCode(5);
    const noise = phenomenologicalNoise(0.05, 5);
    let calls = 0;
    const inner = createRng(2026);
    const counting: Rng = {
      seed: 2026,
      nextUint32: () => {
        calls++;
        return inner.nextUint32();
      },
      nextFloat: () => inner.nextFloat(),
    };
    const a = createSpacetimeShotContext(code, noise, counting);
    const b = createSpacetimeShotContext(code, noise, createRng(2026));
    for (let i = 0; i < 50; i++) {
      calls = 0;
      const bitsA = runSpacetimeShot(a);
      expect(calls).toBe(5 * (2 * 25 + 2 * 12));
      expect(runSpacetimeShot(b)).toBe(bitsA);
      expect(Array.from(a.residual.x)).toEqual(Array.from(b.residual.x));
      expect(Array.from(a.residual.z)).toEqual(Array.from(b.residual.z));
    }
  });

  it("the shot's detectors equal detectorsOf on the sampled history (cumulative and flips replayed with a twin Rng)", () => {
    const code = rotatedSurfaceCode(3);
    const cycles = 3;
    const noise = phenomenologicalNoise(0.15, cycles);
    const ctx = createSpacetimeShotContext(code, noise, createRng(77));
    const twin = createRng(77);
    const m = 4;
    for (let shot = 0; shot < 100; shot++) {
      const bits = runSpacetimeShot(ctx);
      expect([0, 1, 2, 3]).toContain(bits);
      // Replay the same draws: per cycle 2n data, m Z flips, m X flips.
      const errors: Pauli[] = [];
      const flipsZ: Uint8Array[] = [];
      const flipsX: Uint8Array[] = [];
      const cumulative = identity(code.n);
      const t = noise.threshold;
      for (let r = 1; r <= cycles; r++) {
        for (let q = 0; q < code.n; q++) {
          cumulative.x[q] = cumulative.x[q]! ^ (twin.nextUint32() < t ? 1 : 0);
          cumulative.z[q] = cumulative.z[q]! ^ (twin.nextUint32() < t ? 1 : 0);
        }
        const fz = new Uint8Array(m);
        const fx = new Uint8Array(m);
        for (let s = 0; s < m; s++) fz[s] = twin.nextUint32() < t ? 1 : 0;
        for (let s = 0; s < m; s++) fx[s] = twin.nextUint32() < t ? 1 : 0;
        errors.push({
          n: code.n,
          x: Uint8Array.from(cumulative.x),
          z: Uint8Array.from(cumulative.z),
        });
        flipsZ.push(fz);
        flipsX.push(fx);
      }
      expect(Array.from(ctx.cumulative.x)).toEqual(Array.from(cumulative.x));
      expect(Array.from(ctx.cumulative.z)).toEqual(Array.from(cumulative.z));
      const dz = detectorsOf(
        code,
        "Z",
        cycles,
        errors,
        flipsZ,
        new Uint8Array(m * (cycles + 1)),
      );
      const dx = detectorsOf(
        code,
        "X",
        cycles,
        errors,
        flipsX,
        new Uint8Array(m * (cycles + 1)),
      );
      expect(Array.from(ctx.detectors.Z)).toEqual(Array.from(dz));
      expect(Array.from(ctx.detectors.X)).toEqual(Array.from(dx));
    }
  });

  it("decodes BOTH types: at p = 0.3, d = 3, both LOGICAL_X and LOGICAL_Z failures occur in 2 000 shots, and a corrected shot has a null-syndrome residual", () => {
    const code = rotatedSurfaceCode(3);
    const ctx = createSpacetimeShotContext(
      code,
      phenomenologicalNoise(0.3, 3),
      createRng(9),
    );
    let x = 0;
    let z = 0;
    const syn = new Uint8Array(4);
    for (let i = 0; i < 2000; i++) {
      const bits = runSpacetimeShot(ctx);
      if (bits & LOGICAL_X) x++;
      if (bits & LOGICAL_Z) z++;
      // After decoding, the residual's syndrome equals the final-layer
      // syndrome of the cumulative error... which the perfect readout fixed:
      // the correction must leave a null syndrome in both types.
      computeTypeSyndrome(code, "Z", ctx.residual, syn);
      expect(syn.every((b) => b === 0)).toBe(true);
      computeTypeSyndrome(code, "X", ctx.residual, syn);
      expect(syn.every((b) => b === 0)).toBe(true);
    }
    expect(x).toBeGreaterThan(100);
    expect(z).toBeGreaterThan(100);
  });

  it("every buffer keeps its identity across 200 shots; the context is frozen", () => {
    const code = rotatedSurfaceCode(5);
    const ctx = createSpacetimeShotContext(
      code,
      phenomenologicalNoise(0.02, 5),
      createRng(4),
    );
    expect(Object.isFrozen(ctx)).toBe(true);
    const refs = [
      ctx.cycleError,
      ctx.cumulative,
      ctx.flips.Z,
      ctx.flips.X,
      ctx.previous.Z,
      ctx.previous.X,
      ctx.detectors.Z,
      ctx.detectors.X,
      ctx.correction,
      ctx.residual,
      ctx.decoders.Z.pairs,
      ctx.decoders.X.pairs,
    ];
    for (let i = 0; i < 200; i++) runSpacetimeShot(ctx);
    const after = [
      ctx.cycleError,
      ctx.cumulative,
      ctx.flips.Z,
      ctx.flips.X,
      ctx.previous.Z,
      ctx.previous.X,
      ctx.detectors.Z,
      ctx.detectors.X,
      ctx.correction,
      ctx.residual,
      ctx.decoders.Z.pairs,
      ctx.decoders.X.pairs,
    ];
    for (let i = 0; i < refs.length; i++) expect(after[i]).toBe(refs[i]);
    expect(ctx.detectors.Z.length).toBe(12 * 6);
  });
});

/** Every entry of a typed array or a Pauli's masks, as plain arrays, for equality. */
const bytes = (a: Uint8Array | Int32Array) => Array.from(a);
const masks = (p: Pauli) => [bytes(p.x), bytes(p.z)];

describe("T-G1 an explicit history decodes byte for byte like the shot that drew it (phase2-g.md D1)", () => {
  for (const d of [3, 5, 7]) {
    for (const p of [0.01, 0.03]) {
      it(`d = ${d}, p = ${p}: 300 consecutive seeds of one stream, plus 5 fresh seeds: same detectors, cumulative, correction, residual, pairs and verdict`, () => {
        const code = rotatedSurfaceCode(d);
        const cycles = d;
        const noise = phenomenologicalNoise(p, cycles);
        const seeds = [20261017, 1, 2, 3, 4, 5];
        for (const seed of seeds) {
          const shots = seed === seeds[0] ? 300 : 1;
          const a = createSpacetimeShotContext(code, noise, createRng(seed));
          const b = createSpacetimeShotContext(code, noise, createRng(0));
          const twin = createRng(seed);
          const history = createSpacetimeHistory(code, cycles);
          for (let i = 0; i < shots; i++) {
            const bitsA = runSpacetimeShot(a);
            sampleSpacetimeHistory(noise, twin, code, history);
            const bitsB = decodeSpacetimeHistory(b, history);
            expect(bitsB).toBe(bitsA);
            expect(bytes(b.detectors.Z)).toEqual(bytes(a.detectors.Z));
            expect(bytes(b.detectors.X)).toEqual(bytes(a.detectors.X));
            expect(masks(b.cumulative)).toEqual(masks(a.cumulative));
            expect(masks(b.correction)).toEqual(masks(a.correction));
            expect(masks(b.residual)).toEqual(masks(a.residual));
            for (const type of TYPES) {
              const da = a.decoders[type];
              const db = b.decoders[type];
              expect(db.pairCount).toBe(da.pairCount);
              expect(db.defectCount).toBe(da.defectCount);
              expect(bytes(db.pairs.subarray(0, 2 * db.pairCount))).toEqual(
                bytes(da.pairs.subarray(0, 2 * da.pairCount)),
              );
            }
          }
          // The twin stream is in step with the shot's: the next draws agree.
          expect(twin.nextUint32()).toBe(a.rng.nextUint32());
        }
      });
    }
  }

  it("sampleSpacetimeHistory consumes exactly cycles·(2n + 2m) draws, in the shot's order (cycle errors are E_r, not accumulated)", () => {
    const code = rotatedSurfaceCode(5);
    const cycles = 5;
    const noise = phenomenologicalNoise(0.2, cycles);
    let calls = 0;
    const inner = createRng(2026);
    const counting: Rng = {
      seed: 2026,
      nextUint32: () => {
        calls++;
        return inner.nextUint32();
      },
      nextFloat: () => inner.nextFloat(),
    };
    const history = createSpacetimeHistory(code, cycles);
    sampleSpacetimeHistory(noise, counting, code, history);
    expect(calls).toBe(cycles * (2 * 25 + 2 * 12));
    // Replay the draws: per cycle 2n data (X then Z per qubit), m Z flips, m X flips.
    const twin = createRng(2026);
    const t = noise.threshold;
    for (let r = 1; r <= cycles; r++) {
      const e = history.cycleErrors[r - 1]!;
      for (let q = 0; q < code.n; q++) {
        expect(e.x[q]).toBe(twin.nextUint32() < t ? 1 : 0);
        expect(e.z[q]).toBe(twin.nextUint32() < t ? 1 : 0);
      }
      for (let s = 0; s < 12; s++)
        expect(history.flips[r - 1]!.Z[s]).toBe(twin.nextUint32() < t ? 1 : 0);
      for (let s = 0; s < 12; s++)
        expect(history.flips[r - 1]!.X[s]).toBe(twin.nextUint32() < t ? 1 : 0);
    }
  });

  it("cumulativeErrorsOf is the running product C_r = C_{r−1}·E_r", () => {
    const code = rotatedSurfaceCode(3);
    const history = createSpacetimeHistory(code, 3);
    history.cycleErrors[0]!.x[4] = 1; // X on the centre in cycle 1
    history.cycleErrors[1]!.x[4] = 1; // undone in cycle 2
    history.cycleErrors[1]!.z[0] = 1; // Z on qubit 0 in cycle 2
    history.cycleErrors[2]!.x[0] = 1; // X on qubit 0 in cycle 3 → Y
    const out = cumulativeErrorsOf(
      history,
      Array.from({ length: 3 }, () => pauliFrom(9, [1, 2], [1])),
    );
    expect(masks(out[0]!)).toEqual(masks(pauliFrom(9, [4], [])));
    expect(masks(out[1]!)).toEqual(masks(pauliFrom(9, [], [0])));
    expect(masks(out[2]!)).toEqual(masks(pauliFrom(9, [0], [0])));
    expect(() => cumulativeErrorsOf(history, [identity(9)])).toThrow(
      RangeError,
    );
  });

  it("rejects a history of another cycles count or distance, and cycles < 1", () => {
    const code = rotatedSurfaceCode(3);
    expect(() => createSpacetimeHistory(code, 0)).toThrow(RangeError);
    expect(() => createSpacetimeHistory(code, 1.5)).toThrow(RangeError);
    const ctx = createSpacetimeShotContext(
      code,
      phenomenologicalNoise(0.1, 3),
      createRng(1),
    );
    expect(() =>
      decodeSpacetimeHistory(ctx, createSpacetimeHistory(code, 2)),
    ).toThrow(RangeError);
    expect(() =>
      decodeSpacetimeHistory(
        ctx,
        createSpacetimeHistory(rotatedSurfaceCode(5), 3),
      ),
    ).toThrow(RangeError);
    expect(() =>
      sampleSpacetimeHistory(
        phenomenologicalNoise(0.1, 2),
        createRng(1),
        code,
        createSpacetimeHistory(code, 3),
      ),
    ).toThrow(RangeError);
    // ctx.cycleError and the rng are not touched by a history decode.
    const before = ctx.rng.nextUint32();
    const twin = createRng(1);
    twin.nextUint32();
    decodeSpacetimeHistory(ctx, createSpacetimeHistory(code, 3));
    expect(ctx.rng.nextUint32()).toBe(twin.nextUint32());
    expect(before).not.toBeUndefined();
  });
});

describe("T-G2 readingsOf: the measured outcomes whose differences are the detectors (phase2-g.md D1)", () => {
  function diffOf(s: Uint8Array, m: number): Uint8Array {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      out[i] = s[i]! ^ (i >= m ? s[i - m]! : 0);
    }
    return out;
  }

  for (const d of [3, 5, 7]) {
    const code = rotatedSurfaceCode(d);
    const cycles = d;
    const m = (code.n - 1) / 2;
    it(`d = ${d}: detectorsOf ≡ diff(readingsOf) with s_0 = 0 over 500 random histories, p = 1 included`, () => {
      const rng = createRng(7 + d);
      const history = createSpacetimeHistory(code, cycles);
      const cumulative = Array.from({ length: cycles }, () => identity(code.n));
      for (let i = 0; i < 500; i++) {
        const p = i < 10 ? 1 : i < 20 ? 0 : rng.nextFloat() * 0.3;
        sampleSpacetimeHistory(
          phenomenologicalNoise(p, cycles),
          rng,
          code,
          history,
        );
        cumulativeErrorsOf(history, cumulative);
        for (const type of TYPES) {
          const flips = history.flips.map((f) => f[type]);
          const s = readingsOf(
            code,
            type,
            cycles,
            cumulative,
            flips,
            new Uint8Array(m * (cycles + 1)),
          );
          const det = detectorsOf(
            code,
            type,
            cycles,
            cumulative,
            flips,
            new Uint8Array(m * (cycles + 1)),
          );
          expect(bytes(diffOf(s, m))).toEqual(bytes(det));
        }
      }
    });

    it(`d = ${d}: one flip at (s, r) lights exactly (r, s); a data error from r₀ lights the 2D syndrome in every layer ≥ r₀ (final one included) and nothing before`, () => {
      const none = identity(code.n);
      for (const type of TYPES) {
        const out = new Uint8Array(m * (cycles + 1));
        for (let r = 1; r <= cycles; r++) {
          for (let s = 0; s < m; s++) {
            const flips = Array.from(
              { length: cycles },
              () => new Uint8Array(m),
            );
            flips[r - 1]![s] = 1;
            readingsOf(
              code,
              type,
              cycles,
              Array.from({ length: cycles }, () => none),
              flips,
              out,
            );
            expect(lit(out), `${type} flip (${s}, ${r})`).toEqual([
              (r - 1) * m + s,
            ]);
          }
        }
        const syndrome2d = new Uint8Array(m);
        for (let r0 = 1; r0 <= cycles; r0++) {
          for (let q = 0; q < code.n; q++) {
            const error =
              type === "Z"
                ? pauliFrom(code.n, [q], [])
                : pauliFrom(code.n, [], [q]);
            computeTypeSyndrome(code, type, error, syndrome2d);
            const errors = Array.from({ length: cycles }, (_, i) =>
              i + 1 >= r0 ? error : none,
            );
            readingsOf(
              code,
              type,
              cycles,
              errors,
              Array.from({ length: cycles }, () => new Uint8Array(m)),
              out,
            );
            for (let layer = 1; layer <= cycles + 1; layer++) {
              expect(
                bytes(out.subarray((layer - 1) * m, layer * m)),
                `${type} error on ${q} from ${r0}, layer ${layer}`,
              ).toEqual(
                layer >= r0 ? bytes(syndrome2d) : new Array<number>(m).fill(0),
              );
            }
          }
        }
      }
    });
  }

  it("the final layer is the perfect readout: flips full of ones change every noisy layer and not the last one", () => {
    const code = rotatedSurfaceCode(3);
    const cycles = 3;
    const m = 4;
    const errors = Array.from({ length: cycles }, () => pauliFrom(9, [4], [4]));
    const clean = readingsOf(
      code,
      "Z",
      cycles,
      errors,
      Array.from({ length: cycles }, () => new Uint8Array(m)),
      new Uint8Array(m * (cycles + 1)),
    );
    const flipped = readingsOf(
      code,
      "Z",
      cycles,
      errors,
      Array.from({ length: cycles }, () => new Uint8Array(m).fill(1)),
      new Uint8Array(m * (cycles + 1)),
    );
    for (let i = 0; i < cycles * m; i++) {
      expect(flipped[i]).toBe(clean[i]! ^ 1);
    }
    expect(bytes(flipped.subarray(cycles * m))).toEqual(
      bytes(clean.subarray(cycles * m)),
    );
    expect(bytes(clean.subarray(cycles * m))).toEqual(
      bytes(computeTypeSyndrome(code, "Z", errors[2]!, new Uint8Array(m))),
    );
  });

  it("rejects a bad shape exactly as detectorsOf", () => {
    const code = rotatedSurfaceCode(3);
    const h = emptyHistory(9, 4, 2);
    expect(() =>
      readingsOf(code, "Z", 2, h.errors, h.flips, new Uint8Array(11)),
    ).toThrow(RangeError);
    expect(() =>
      readingsOf(code, "Z", 3, h.errors, h.flips, new Uint8Array(16)),
    ).toThrow(RangeError);
    expect(() =>
      readingsOf(
        code,
        "Z",
        2,
        h.errors,
        [new Uint8Array(4), new Uint8Array(3)],
        new Uint8Array(12),
      ),
    ).toThrow(RangeError);
    expect(() => readingsOf(code, "Z", 0, [], [], new Uint8Array(4))).toThrow(
      RangeError,
    );
  });
});
