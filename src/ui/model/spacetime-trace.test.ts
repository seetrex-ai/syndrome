import { describe, expect, it } from "vitest";
import {
  BOUNDARY,
  computeTypeSyndrome,
  nodeIndex,
  pauliFrom,
  qubitRowCol,
  rotatedSurfaceCode,
  type StabilizerType,
} from "../../core";
import {
  centralCycle,
  centralQubit,
  createSpacetimeTraceContext,
  decodeSpacetimeTrace,
  hasEvent,
  PRESET_KINDS,
  presetCheck,
  presetHistory,
  randomHistory,
} from "./spacetime-trace";

const TYPES: readonly StabilizerType[] = ["Z", "X"];

function lit(mask: { readonly length: number; readonly [i: number]: number }) {
  const out: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i] !== 0) out.push(i);
  return out;
}

function isDeepFrozen(value: unknown, seen = new Set<unknown>()): boolean {
  if (value === null || typeof value !== "object") return true;
  if (seen.has(value)) return true;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return true; // typed arrays cannot be frozen
  if (!Object.isFrozen(value)) return false;
  return Object.values(value as Record<string, unknown>).every((v) =>
    isDeepFrozen(v, seen),
  );
}

describe("T-G4 decodeSpacetimeTrace: a frozen photograph of a decoded history", () => {
  it("shares no buffer with the context: mutating ctx afterwards leaves the trace as decoded; equals the context's results", () => {
    const ctx = createSpacetimeTraceContext(5);
    const history = randomHistory(5, 0.05, 42);
    const trace = decodeSpacetimeTrace(ctx, history);
    expect(isDeepFrozen(trace)).toBe(true);
    expect(trace.d).toBe(5);
    expect(trace.cycles).toBe(5);
    expect(trace.layers).toBe(6);
    const detectorsZ = Array.from(ctx.detectors.Z);
    const correctionX = Array.from(ctx.correction.x);
    const residualZ = Array.from(ctx.residual.z);
    expect(Array.from(trace.detectors.Z)).toEqual(detectorsZ);
    expect(Array.from(trace.detectors.X)).toEqual(Array.from(ctx.detectors.X));
    expect(Array.from(trace.correction.x)).toEqual(correctionX);
    expect(Array.from(trace.residual.z)).toEqual(residualZ);
    expect(trace.chains.Z).toHaveLength(ctx.decoders.Z.pairCount);
    expect(trace.chains.X).toHaveLength(ctx.decoders.X.pairCount);
    // Mutate everything in the context and the input history.
    ctx.detectors.Z.fill(1);
    ctx.correction.x.fill(1);
    ctx.residual.z.fill(1);
    ctx.cumulative.x.fill(1);
    history.cycleErrors[0]!.x.fill(1);
    history.flips[0]!.Z.fill(1);
    expect(Array.from(trace.detectors.Z)).toEqual(detectorsZ);
    expect(Array.from(trace.correction.x)).toEqual(correctionX);
    expect(Array.from(trace.residual.z)).toEqual(residualZ);
    expect(lit(trace.history.cycleErrors[0]!.x).length).toBeLessThan(25);
    expect(lit(trace.history.flips[0]!.Z).length).toBeLessThan(12);
    // Decoding again from a copy gives the same photograph.
    const again = decodeSpacetimeTrace(ctx, randomHistory(5, 0.05, 42));
    expect(again).toEqual(trace);
    expect(again).not.toBe(trace);
  });

  it("chains resolve u / v / qubit from the graph tables and walk from a to b (or the boundary)", () => {
    const ctx = createSpacetimeTraceContext(5);
    const trace = decodeSpacetimeTrace(ctx, randomHistory(5, 0.08, 7));
    let edges = 0;
    for (const type of TYPES) {
      const g = ctx.decoders[type].graph;
      for (const chain of trace.chains[type]) {
        let node = chain.a;
        for (const e of chain.edges) {
          expect(e.u).toBe(g.edgeU[e.index]);
          expect(e.v).toBe(g.edgeV[e.index]);
          expect(e.qubit).toBe(g.edgeQubit[e.index]);
          expect(e.u === node || e.v === node).toBe(true);
          node = e.u === node ? e.v : e.u;
          edges++;
        }
        expect(node).toBe(chain.b === BOUNDARY ? BOUNDARY : chain.b);
      }
    }
    expect(edges).toBeGreaterThan(0);
  });

  it("the readings are the measured outcomes: their layer differences are the detectors, and the final layer is H·C_cycles", () => {
    const ctx = createSpacetimeTraceContext(3);
    const trace = decodeSpacetimeTrace(ctx, randomHistory(3, 0.2, 3));
    const m = 4;
    for (const type of TYPES) {
      const s = trace.readings[type];
      const det = trace.detectors[type];
      for (let i = 0; i < s.length; i++) {
        expect(det[i]).toBe(s[i]! ^ (i >= m ? s[i - m]! : 0));
      }
      const final = computeTypeSyndrome(
        ctx.code,
        type,
        trace.cumulative[trace.cycles - 1]!,
        new Uint8Array(m),
      );
      expect(Array.from(s).slice(trace.cycles * m)).toEqual(Array.from(final));
    }
  });

  it("randomHistory is deterministic by seed and uses cycles = d", () => {
    const a = randomHistory(7, 0.03, 123);
    const b = randomHistory(7, 0.03, 123);
    const c = randomHistory(7, 0.03, 124);
    expect(a.cycles).toBe(7);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(hasEvent(randomHistory(3, 0, 1))).toBe(false);
    expect(hasEvent(randomHistory(3, 1, 1))).toBe(true);
    expect(hasEvent(a)).toBe(true);
  });

  for (const d of [3, 5, 7, 9]) {
    it(`d = ${d}: presets are deterministic; "flip" is one flip of an interior X check in the central cycle and no error, "data" one X error on the central qubit, "both" the union`, () => {
      const r = centralCycle(d);
      expect(r).toBe((d + 1) / 2);
      const centre = centralQubit(d);
      expect(qubitRowCol(d, centre)).toEqual([(d - 1) / 2, (d - 1) / 2]);
      const code = rotatedSurfaceCode(d);
      const check = code.stabilizersByType.X[presetCheck(d)]!;
      expect(check.boundary).toBeNull();
      expect(check.type).toBe("X");
      for (const kind of PRESET_KINDS) {
        const h = presetHistory(d, kind);
        expect(h).toEqual(presetHistory(d, kind));
        expect(h.cycles).toBe(d);
        let flips = 0;
        let errors = 0;
        for (let rr = 1; rr <= d; rr++) {
          const f = h.flips[rr - 1]!;
          const e = h.cycleErrors[rr - 1]!;
          flips += lit(f.Z).length + lit(f.X).length;
          errors += lit(e.x).length + lit(e.z).length;
          if (rr === r) {
            expect(lit(f.X)).toEqual(kind === "data" ? [] : [check.typeIndex]);
            expect(lit(e.x)).toEqual(kind === "flip" ? [] : [centre]);
          }
        }
        expect(flips).toBe(kind === "data" ? 0 : 1);
        expect(errors).toBe(kind === "flip" ? 0 : 1);
      }
    });

    it(`d = ${d}: the decoded presets show the two mechanisms (H): "flip" → two detectors on one check a cycle apart, no qubit corrected; "data" → its syndrome in one layer, corrected by one qubit; verdict 0`, () => {
      const ctx = createSpacetimeTraceContext(d);
      const m = (d * d - 1) / 2;
      const r = centralCycle(d);
      const flip = decodeSpacetimeTrace(ctx, presetHistory(d, "flip"));
      const g = ctx.decoders.X.graph;
      const s = presetCheck(d);
      expect(lit(flip.detectors.X)).toEqual([
        nodeIndex(g, r, s),
        nodeIndex(g, r + 1, s),
      ]);
      expect(lit(flip.detectors.Z)).toEqual([]);
      expect(lit(flip.readings.X)).toEqual([nodeIndex(g, r, s)]);
      expect(lit(flip.correction.x)).toEqual([]);
      expect(lit(flip.correction.z)).toEqual([]);
      expect(flip.chains.X).toHaveLength(1);
      expect(flip.chains.X[0]!.edges).toHaveLength(1);
      expect(flip.chains.X[0]!.edges[0]!.qubit).toBe(-1);
      expect(flip.verdict).toBe(0);

      const data = decodeSpacetimeTrace(ctx, presetHistory(d, "data"));
      const centre = centralQubit(d);
      const syndrome = computeTypeSyndrome(
        ctx.code,
        "Z",
        pauliFrom(d * d, [centre], []),
        new Uint8Array(m),
      );
      const expectedLayer = lit(syndrome).map((idx) => (r - 1) * m + idx);
      expect(expectedLayer).toHaveLength(2);
      expect(lit(data.detectors.Z)).toEqual(expectedLayer);
      expect(lit(data.detectors.X)).toEqual([]);
      // Measured: the two checks read "changed" from cycle r to the final layer.
      const expectedMeasured: number[] = [];
      for (let layer = r; layer <= d + 1; layer++)
        for (const idx of lit(syndrome))
          expectedMeasured.push((layer - 1) * m + idx);
      expect(lit(data.readings.Z)).toEqual(expectedMeasured);
      expect(lit(data.correction.x)).toEqual([centre]);
      expect(lit(data.correction.z)).toEqual([]);
      expect(lit(data.residual.x)).toEqual([]);
      expect(data.verdict).toBe(0);

      const both = decodeSpacetimeTrace(ctx, presetHistory(d, "both"));
      expect(lit(both.detectors.X)).toEqual(lit(flip.detectors.X));
      expect(lit(both.detectors.Z)).toEqual(lit(data.detectors.Z));
      expect(lit(both.correction.x)).toEqual([centre]);
      expect(both.verdict).toBe(0);
    });
  }

  it("rejects a history of another distance", () => {
    const ctx = createSpacetimeTraceContext(3);
    expect(() => decodeSpacetimeTrace(ctx, randomHistory(5, 0.1, 1))).toThrow(
      RangeError,
    );
  });
});
