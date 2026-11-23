import { describe, expect, it } from "vitest";
import * as core from "./index";
import {
  computeSyndrome,
  computeTypeSyndrome,
  correctionChains,
  createDecoder,
  createMatcher,
  createRng,
  createShotContext,
  decode,
  defectGraph,
  DISTANCES,
  estimatePoint,
  exactFailureCounts,
  identity,
  independentNoise,
  NO_EDGE,
  pauliFrom,
  rotatedSurfaceCode,
  runShot,
  sampleNoise,
  VALIDATION_STOP_RULE,
  wilsonInterval,
} from "./index";

describe("DISTANCES", () => {
  it("lists odd distances from 3 upward in increasing order", () => {
    expect(DISTANCES[0]).toBe(3);
    for (const d of DISTANCES) {
      expect(d % 2).toBe(1);
    }
    for (let i = 1; i < DISTANCES.length; i++) {
      expect(DISTANCES[i]).toBeGreaterThan(DISTANCES[i - 1] ?? 0);
    }
  });
});

describe("public core API", () => {
  it("re-exports the lattice: a code can be built and its syndrome computed", () => {
    for (const d of DISTANCES) {
      const code = rotatedSurfaceCode(d);
      expect(code.d).toBe(d);
      const out = computeSyndrome(
        code,
        identity(code.n),
        new Uint8Array(d * d - 1),
      );
      expect(out.every((b) => b === 0)).toBe(true);
    }
  });

  it("re-exports noise and the defect graph: an error can be sampled and both graphs built", () => {
    const code = rotatedSurfaceCode(3);
    const error = sampleNoise(
      independentNoise(0.5),
      createRng(1),
      identity(code.n),
    );
    expect(error.n).toBe(9);
    expect(defectGraph(code, "Z").m).toBe(4);
    expect(defectGraph(code, "X").m).toBe(4);
  });

  it("re-exports the decoder: a shot can be decoded through the public API", () => {
    const code = rotatedSurfaceCode(3);
    const decoder = createDecoder(code, "Z");
    const error = pauliFrom(9, [0], []);
    const syndrome = computeTypeSyndrome(code, "Z", error, new Uint8Array(4));
    const correction = identity(9);
    expect(decode(decoder, syndrome, correction)).toBeGreaterThan(0);
    expect(decoder.pairCount).toBe(1);
    expect(correctionChains(decoder)).toHaveLength(1);
    expect(createMatcher(2).maxVertices).toBe(2);
    expect(NO_EDGE).toBe(2 ** 40);
  });

  it("re-exports sim: a full shot, a point estimate and the exact d = 3 counts through the public API", () => {
    const code = rotatedSurfaceCode(3);
    const ctx = createShotContext(code, independentNoise(0.1), createRng(1));
    const bits = runShot(ctx);
    expect([0, 1, 2, 3]).toContain(bits);
    expect(typeof core.runShot).toBe("function");
    expect(typeof core.estimatePoint).toBe("function");
    expect(typeof core.exactFailureCounts).toBe("function");
    const e = estimatePoint(code, 0.1, 1, {
      minFailures: 2,
      minShots: 50,
      maxShots: 50,
    });
    expect(e.shots).toBe(50);
    expect(e.stopReason).toBe("shots");
    expect(exactFailureCounts(code, "Z")).toHaveLength(10);
    expect(VALIDATION_STOP_RULE.minShots).toBe(100_000);
    expect(wilsonInterval(0, 10).high).toBeCloseTo(0.2775327999, 9);
  });

  it("does not export the test-only DP oracle", () => {
    expect("exactMatchingWeight" in core).toBe(false);
    expect("ORACLE_MAX_DEFECTS" in core).toBe(false);
  });

  it("re-exports the phenomenological model (phase 2): noise, edge weights, spacetime decoder, shot, model specs and the exact cycles = 1 counts", () => {
    const code = rotatedSurfaceCode(3);
    const noise = core.phenomenologicalNoise(0.02, 3);
    expect(noise.kind).toBe("phenomenological");
    expect(core.edgeWeight(0)).toBe(16766926);
    expect(core.spaceEdgeIndex(code, 4, 2, 3)).toBe(13);
    expect(core.timeEdgeIndex(code, 1, 3, 3)).toBe(27 + 8 + 1);
    const g = core.spacetimeGraph(code, "Z", 3);
    expect(g.nodes).toBe(16);
    expect(g.edgeCount).toBe(39);
    const decoder = core.createSpacetimeDecoder(code, "Z", 3);
    expect(core.decodeSpacetime(decoder, new Uint8Array(16), identity(9))).toBe(
      0,
    );
    const ctx = core.createSpacetimeShotContext(code, noise, createRng(1));
    expect([0, 1, 2, 3]).toContain(core.runSpacetimeShot(ctx));
    expect(
      core
        .detectorsOf(
          code,
          "Z",
          1,
          [identity(9)],
          [new Uint8Array(4)],
          new Uint8Array(8),
        )
        .every((b) => b === 0),
    ).toBe(true);
    expect(core.INDEPENDENT_MODEL.kind).toBe("independent");
    expect(core.PHENOMENOLOGICAL_MODEL.kind).toBe("phenomenological");
    const e = core.estimatePoint(
      code,
      0.02,
      1,
      { minFailures: 2, minShots: 50, maxShots: 50 },
      core.PHENOMENOLOGICAL_MODEL,
    );
    expect(e.shots).toBe(50);
    expect(core.exactSpacetimeFailureCounts(code, "Z", 1)).toHaveLength(14);
    expect(core.EXACT_SPACETIME_MECHANISMS).toBe(13);
    expect(typeof core.exactSpacetimeRates).toBe("function");
    expect(core.SPACETIME_INITIAL_DEFECTS).toBe(32);
  });
});
