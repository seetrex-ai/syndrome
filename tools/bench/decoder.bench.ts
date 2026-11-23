// npm run bench — shots per second of the TypeScript core in Node (docs/spec.md §7).
//
// One benchmark iteration = ONE shot (or one decode of both types, or one
// noise sample), so the `hz` column of the report is directly shots/s and
// `mean` is ms per shot (×1000 = ms per 1 000 shots; the §7 target is d = 7,
// p = 0.10 under 300 ms on a laptop and under 2 s on a mid-range phone). All
// buffers are created once per (d, p) and reused: this is the loop sim/ will
// run in the Worker.
//
// (a) shot: noise → two syndromes → two decodes → residual → verdict
// (b) decode only (both types), on syndromes pregenerated with the same noise
// (c) sampleNoise only
// (e) step(sampler, 1): one shot through the adaptive sampler of src/core/sim
//     (runShot + tally + rule check). Compare with (a) only as an order of
//     magnitude: (a) is the bench's own shot and pays Vitest's module-export
//     getters per call, so (e) − (a) does NOT bound step's overhead (measured
//     on 2026-10-16: (e) beat (a) by up to 116 % at d = 3).
// (d) GC events of every kind during 10⁵ shots at d = 9, p = 0.15
//     (PerformanceObserver on the "gc" entry type) at the largest distance;
//     the intent test counts only minor collections at d = 3 and fails on them.
//     Printed as a console line.
// (g) phenomenological model (phase 2): step(sampler, 1) with
//     PHENOMENOLOGICAL_MODEL at d = 7, p = 0.01 and 0.03 (d cycles, measurement
//     flips, spacetime MWPM): hz is shots/s. The matcher is grown by a warm-up
//     of 2 000 shots before timing, so growth is not in the measurement.
//
// Vitest 5 benchmark API: `bench` is a fixture of the test context
// (vite.config.ts `test.benchmark.include` selects this file).

import { PerformanceObserver } from "node:perf_hooks";
import { describe, test } from "vitest";
import {
  computeTypeSyndrome,
  createDecoder,
  createPointSampler,
  createRng,
  decode,
  identity,
  independentNoise,
  logicalEffect,
  multiplyInto,
  PHENOMENOLOGICAL_MODEL,
  rotatedSurfaceCode,
  sampleNoise,
  step,
  type Decoder,
  type IndependentNoise,
  type Pauli,
  type Rng,
  type RotatedSurfaceCode,
} from "../../src/core/index";

// Local bindings: an imported binding is a getter in Vitest's module runner.
const sample = sampleNoise;
const stepOnce = step;
// A rule that never fires within a bench: every iteration is exactly one shot.
const NEVER = { minFailures: 2, minShots: 1e9, maxShots: 1e9 } as const;
const DISTANCES = [3, 5, 7, 9] as const;
const PROBABILITIES = [0.05, 0.1, 0.15] as const;
const PREGENERATED = 4096;

interface Buffers {
  code: RotatedSurfaceCode;
  decoders: { Z: Decoder; X: Decoder };
  error: Pauli;
  correction: Pauli;
  residual: Pauli;
  synZ: Uint8Array;
  synX: Uint8Array;
  /** Pregenerated syndromes for (b): PREGENERATED per type. */
  preZ: Uint8Array[];
  preX: Uint8Array[];
}

function setup(d: number, p: number): Buffers {
  const code = rotatedSurfaceCode(d);
  const m = (code.n - 1) / 2;
  const b: Buffers = {
    code,
    decoders: { Z: createDecoder(code, "Z"), X: createDecoder(code, "X") },
    error: identity(code.n),
    correction: identity(code.n),
    residual: identity(code.n),
    synZ: new Uint8Array(m),
    synX: new Uint8Array(m),
    preZ: [],
    preX: [],
  };
  const rng = createRng(1);
  const noise = independentNoise(p);
  for (let i = 0; i < PREGENERATED; i++) {
    sample(noise, rng, b.error);
    b.preZ.push(computeTypeSyndrome(code, "Z", b.error, new Uint8Array(m)));
    b.preX.push(computeTypeSyndrome(code, "X", b.error, new Uint8Array(m)));
  }
  return b;
}

let failures = 0; // keeps the verdict observable so nothing is optimised away

/** Current Blossom capacity of the type-Z decoder of a 3D sampler (0 for a 2D one). */
function vertices(sampler: ReturnType<typeof createPointSampler>): number {
  const ctx = sampler.ctx;
  return "detectors" in ctx ? ctx.decoders.Z.matcherVertices : 0;
}

function shot(b: Buffers, noise: IndependentNoise, rng: Rng): void {
  sample(noise, rng, b.error);
  computeTypeSyndrome(b.code, "Z", b.error, b.synZ);
  decode(b.decoders.Z, b.synZ, b.correction);
  computeTypeSyndrome(b.code, "X", b.error, b.synX);
  decode(b.decoders.X, b.synX, b.correction);
  multiplyInto(b.residual, b.error, b.correction);
  const effect = logicalEffect(b.code, b.residual);
  if (effect.x || effect.z) failures++;
}

describe("shots per second (hz = shots/s, mean = ms per shot)", () => {
  for (const d of DISTANCES) {
    for (const p of PROBABILITIES) {
      const label = `d = ${d}, p = ${p.toFixed(2)}`;
      test(label, async ({ bench }) => {
        const b = setup(d, p);
        const noise = independentNoise(p);
        const rng = createRng(1);
        const sampler = createPointSampler(b.code, p, 1, NEVER);
        let k = 0;
        await bench.compare(
          bench(`(a) shot        ${label}`, () => {
            shot(b, noise, rng);
          }),
          bench(`(b) decode only ${label}`, () => {
            const i = k++ & (PREGENERATED - 1);
            decode(b.decoders.Z, b.preZ[i]!, b.correction);
            decode(b.decoders.X, b.preX[i]!, b.correction);
          }),
          bench(`(c) sampleNoise ${label}`, () => {
            sample(noise, rng, b.error);
          }),
          bench(`(e) step        ${label}`, () => {
            stepOnce(sampler, 1);
          }),
          { time: 1000 },
        );
      });
    }
  }
});

describe("GC events during 10⁵ shots at d = 9, p = 0.15", () => {
  test("(d) GC count", async () => {
    const b = setup(9, 0.15);
    const noise = independentNoise(0.15);
    const rng = createRng(2);
    let gcEvents = 0;
    const observer = new PerformanceObserver((list) => {
      gcEvents += list.getEntries().length;
    });
    observer.observe({ entryTypes: ["gc"] });
    const t0 = performance.now();
    for (let i = 0; i < 100_000; i++) shot(b, noise, rng);
    const ms = performance.now() - t0;
    // The observer delivers asynchronously; let it flush before reading.
    await new Promise((resolve) => setTimeout(resolve, 50));
    observer.disconnect();
    console.log(
      `(d) d = 9, p = 0.15: 10⁵ shots in ${ms.toFixed(0)} ms (${(1e8 / ms) | 0} shots/s), ${gcEvents} GC events, cumulative logical failures over all benches ${failures}`,
    );
  });

  // (g) Phenomenological model, d = 7, p ∈ {0.01, 0.03}: shots/s of step().
  test("(g) phenomenological d = 7", async ({ bench }) => {
    const code = rotatedSurfaceCode(7);
    const samplers = [0.01, 0.03].map((p) => {
      const sampler = createPointSampler(
        code,
        p,
        1,
        NEVER,
        PHENOMENOLOGICAL_MODEL,
      );
      stepOnce(sampler, 2000); // warm-up: JIT and matcher growth
      return sampler;
    });
    await bench.compare(
      bench("(g) step phenomenological d = 7, p = 0.01", () => {
        stepOnce(samplers[0]!, 1);
      }),
      bench("(g) step phenomenological d = 7, p = 0.03", () => {
        stepOnce(samplers[1]!, 1);
      }),
      { time: 2000 },
    );
    console.log(
      `(g) matcher capacities after the bench: Z ${vertices(samplers[0]!)} / ${vertices(samplers[1]!)} at p = 0.01 / 0.03`,
    );
  });

  // (f) The same 10⁵ shots through the adaptive sampler in ONE step call (what
  // tools/validate does per point): GC events of step's own bookkeeping.
  test("(f) GC count through step(sampler, 10⁵)", async () => {
    const sampler = createPointSampler(rotatedSurfaceCode(9), 0.15, 2, NEVER);
    let gcEvents = 0;
    const observer = new PerformanceObserver((list) => {
      gcEvents += list.getEntries().length;
    });
    observer.observe({ entryTypes: ["gc"] });
    const t0 = performance.now();
    const reason = stepOnce(sampler, 100_000);
    const ms = performance.now() - t0;
    await new Promise((resolve) => setTimeout(resolve, 50));
    observer.disconnect();
    console.log(
      `(f) d = 9, p = 0.15: step(sampler, 10⁵) in ${ms.toFixed(0)} ms (${(1e8 / ms) | 0} shots/s), ${gcEvents} GC events, ${sampler.tally.failures} failures, stopReason ${String(reason)}`,
    );
  });
});
