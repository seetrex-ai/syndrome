import { constants, PerformanceObserver } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import {
  BOUNDARY,
  createPointSampler,
  createSpacetimeDecoder,
  decodeSpacetime,
  detectorsOf,
  edgeWeight,
  estimate,
  estimatePoint,
  identity,
  MAX_EDGE_WEIGHT,
  pauliFrom,
  PHENOMENOLOGICAL_MODEL,
  pointSeed,
  qubitWeight,
  rotatedSurfaceCode,
  spaceEdgeIndex,
  spacetimeGraph,
  step,
  timeEdgeIndex,
  VALIDATION_STOP_RULE,
  type Pauli,
} from "../../src/core/index";

// The 192-defect decode of T-I4 and the GC measurement of T-I5 take a few
// seconds on a laptop; the margin is for the CI runner.
vi.setConfig({ testTimeout: 60_000 });

/**
 * test_intent_independent_model_untouched
 *
 * INTENCIÓN: añadir el segundo modelo de ruido (fenomenológico, fase 2) no cambia ni una
 *   tirada del primero. `estimatePoint` con la regla de validación, la semilla de la malla
 *   (base 20261016, `pointSeed`) y sin modelo explícito reproduce LITERALMENTE los recuentos
 *   publicados en `docs/validacion/browser.json`: d = 3, p = 0,1 → 22 569 fallos (X 12 023,
 *   Z 12 008) en 10⁵ tiradas; d = 5, p = 0,03 → 1 247 (620 / 631).
 * CONTEXTO: tasks/plans/phase2.md D2 («el modelo de fase 1 no cambia ni un bit: segundo
 *   modelo por extensión, nunca por modificación del camino caliente»). `validate.yml` lo
 *   comprueba en CI sobre los 24 puntos con `git diff --exit-code`; este test lo hace en
 *   cada commit sobre dos puntos. Un cambio en el orden de consumo del PRNG, en los pesos
 *   2D o en la regla de parada cambia estos enteros.
 * EXPIRA SI: se regenera `browser.json` por una decisión nueva de pesos o semilla
 *   (entonces los literales se actualizan en el mismo commit que el fichero).
 */
describe("test_intent_independent_model_untouched", () => {
  const SEED_BASE = 20261016; // browser.json "seed"

  it("d = 3, p = 0.1: 22 569 failures (12 023 X, 12 008 Z) in 10⁵ shots", () => {
    const e = estimatePoint(
      rotatedSurfaceCode(3),
      0.1,
      pointSeed(SEED_BASE, 3, 0.1),
      VALIDATION_STOP_RULE,
    );
    expect(e.shots).toBe(100_000);
    expect(e.stopReason).toBe("shots");
    expect(e.failures).toBe(22_569);
    expect(e.failuresX).toBe(12_023);
    expect(e.failuresZ).toBe(12_008);
  });

  it("d = 5, p = 0.03: 1 247 failures (620 X, 631 Z) in 10⁵ shots", () => {
    const e = estimatePoint(
      rotatedSurfaceCode(5),
      0.03,
      pointSeed(SEED_BASE, 5, 0.03),
      VALIDATION_STOP_RULE,
    );
    expect(e.shots).toBe(100_000);
    expect(e.stopReason).toBe("shots");
    expect(e.failures).toBe(1_247);
    expect(e.failuresX).toBe(620);
    expect(e.failuresZ).toBe(631);
  });
});

/**
 * test_intent_phenomenological_model_untouched
 *
 * INTENCIÓN: exponer la historia de una tirada para el visor (`SpacetimeHistory`,
 *   `readingsOf`, `decodeSpacetimeHistory`, `spacetimeChains`) no cambia ni una tirada del
 *   modelo fenomenológico. `estimatePoint` con `PHENOMENOLOGICAL_MODEL`, la regla de
 *   validación y la semilla de la malla (base 20261016, `pointSeed`) reproduce LITERALMENTE
 *   los recuentos publicados en `docs/validacion/browser-phenomenological.json`: d = 3,
 *   p = 0,01 → 2 089 fallos (X 1 075, Z 1 023) en 10⁵ tiradas; d = 3, p = 0,02 → 7 394
 *   (3 794 / 3 726).
 * CONTEXTO: tasks/plans/phase2-g.md D1 (el camino caliente `runSpacetimeShot` no se toca:
 *   la historia se muestrea y decodifica por funciones hermanas). `validate.yml` lo
 *   comprueba en CI sobre los 24 puntos con `git diff --exit-code`; este test lo hace en
 *   cada commit sobre dos puntos baratos (d = 3, ≈ 0,5 s cada uno).
 * EXPIRA SI: se regenera `browser-phenomenological.json` por una decisión nueva (pesos,
 *   semilla, convención de capas); entonces los literales se actualizan en el mismo commit.
 */
describe("test_intent_phenomenological_model_untouched", () => {
  const SEED_BASE = 20261016; // browser-phenomenological.json "seed"

  it("d = 3, p = 0.01: 2 089 failures (1 075 X, 1 023 Z) in 10⁵ shots", () => {
    const e = estimatePoint(
      rotatedSurfaceCode(3),
      0.01,
      pointSeed(SEED_BASE, 3, 0.01),
      VALIDATION_STOP_RULE,
      PHENOMENOLOGICAL_MODEL,
    );
    expect(e.shots).toBe(100_000);
    expect(e.stopReason).toBe("shots");
    expect(e.failures).toBe(2_089);
    expect(e.failuresX).toBe(1_075);
    expect(e.failuresZ).toBe(1_023);
  });

  it("d = 3, p = 0.02: 7 394 failures (3 794 X, 3 726 Z) in 10⁵ shots", () => {
    const e = estimatePoint(
      rotatedSurfaceCode(3),
      0.02,
      pointSeed(SEED_BASE, 3, 0.02),
      VALIDATION_STOP_RULE,
      PHENOMENOLOGICAL_MODEL,
    );
    expect(e.shots).toBe(100_000);
    expect(e.stopReason).toBe("shots");
    expect(e.failures).toBe(7_394);
    expect(e.failuresX).toBe(3_794);
    expect(e.failuresZ).toBe(3_726);
  });
});

/**
 * test_intent_spacetime_graph_is_the_error_model
 *
 * INTENCIÓN: cada mecanismo de ruido de la convención D1 es EXACTAMENTE una arista del
 *   grafo espacio-temporal y cada arista exactamente un mecanismo (biyección), y la
 *   última capa (lectura final perfecta) no tiene aristas espaciales. Un error de datos
 *   `(q, r)` enciende los ≤ 2 detectores `(r, checks(q))` de la MISMA capa (frontera si
 *   uno); un fallo de medición `(s, r)` enciende `(r, s)` y `(r + 1, s)`; no hay frontera
 *   temporal.
 * CONTEXTO: tasks/plans/phase2.md D1/D4 y M9. La plomería 3D (capas, diferencias con el
 *   ciclo anterior, capa perfecta) es donde un bug no se ve en estadística: «detectores =
 *   síndromes» o «aristas espaciales en la última capa» cambian P_L unas décimas, por
 *   debajo de la σ de un punto, y sólo una comprobación mecanismo a mecanismo los ve.
 * EXPIRA SI: se adopta otra convención (p. ej. ruido de datos también antes de la
 *   lectura final), con línea en docs/decisiones.md y nueva validación.
 */
describe("test_intent_spacetime_graph_is_the_error_model", () => {
  function lit(v: Uint8Array): number[] {
    const out: number[] = [];
    for (let i = 0; i < v.length; i++) if (v[i] !== 0) out.push(i);
    return out;
  }

  for (const d of [3, 5]) {
    for (const cycles of [1, d]) {
      it(`d = ${d}, cycles = ${cycles}: every single mechanism lights exactly the endpoints of its edge, both types`, () => {
        const code = rotatedSurfaceCode(d);
        const n = code.n;
        const m = (n - 1) / 2;
        for (const type of ["Z", "X"] as const) {
          const g = spacetimeGraph(code, type, cycles);
          const out = new Uint8Array(g.nodes);
          const covered = new Uint8Array(g.edgeCount);
          // Data errors (q, r): a mechanism of THIS type's errors only.
          for (let r = 1; r <= cycles; r++) {
            for (let q = 0; q < n; q++) {
              const errors: Pauli[] = [];
              const flips: Uint8Array[] = [];
              const e =
                type === "Z" ? pauliFrom(n, [q], []) : pauliFrom(n, [], [q]);
              for (let rr = 1; rr <= cycles; rr++) {
                errors.push(rr >= r ? e : identity(n));
                flips.push(new Uint8Array(m));
              }
              detectorsOf(code, type, cycles, errors, flips, out);
              const edge = spaceEdgeIndex(code, q, r, cycles);
              const ends = [g.edgeU[edge]!, g.edgeV[edge]!]
                .filter((x) => x !== BOUNDARY)
                .sort((a, b) => a - b);
              expect(lit(out), `data (${q}, ${r}) type ${type}`).toEqual(ends);
              expect(g.edgeQubit[edge]).toBe(q);
              covered[edge] = 1;
            }
          }
          // Measurement flips (s, r).
          for (let r = 1; r <= cycles; r++) {
            for (let s = 0; s < m; s++) {
              const errors: Pauli[] = [];
              const flips: Uint8Array[] = [];
              for (let rr = 1; rr <= cycles; rr++) {
                errors.push(identity(n));
                const f = new Uint8Array(m);
                if (rr === r) f[s] = 1;
                flips.push(f);
              }
              detectorsOf(code, type, cycles, errors, flips, out);
              const edge = timeEdgeIndex(code, s, r, cycles);
              expect(lit(out), `flip (${s}, ${r}) type ${type}`).toEqual([
                g.edgeU[edge]!,
                g.edgeV[edge]!,
              ]);
              expect(g.edgeV[edge]).not.toBe(BOUNDARY);
              expect(g.edgeQubit[edge]).toBe(-1);
              covered[edge] = 1;
            }
          }
          // Bijection: every edge was some mechanism, and the count is M9.
          expect(covered.every((b) => b === 1)).toBe(true);
          expect(g.edgeCount).toBe(n * cycles + m * cycles);
          // The last layer is perfect: no space edge has an endpoint there.
          for (let e = 0; e < g.edgeCount; e++) {
            if (g.edgeQubit[e]! >= 0) {
              expect(Math.floor(g.edgeU[e]! / m)).toBeLessThan(cycles);
            }
          }
        }
      });
    }
  }

  it("M9: 39 / 185 / 511 / 1 089 edges per type with cycles = d", () => {
    const counts = [3, 5, 7, 9].map(
      (d) => spacetimeGraph(rotatedSurfaceCode(d), "Z", d).edgeCount,
    );
    expect(counts).toEqual([39, 185, 511, 1089]);
  });
});

/**
 * test_intent_weights_shared_by_edge_index
 *
 * INTENCIÓN: el TS y la referencia Python computan los MISMOS enteros por arista:
 *   `W_e = S + floor(top53_e · S / (1000 · 2⁵³))` con `top53_e = splitmix64(0x53594E44 + e)
 *   >> 11`, la fórmula de fase 1 sobre un índice de arista. Con `cycles = 1` y sin
 *   temporales el índice es el cúbit: `qubitWeight(q) === edgeWeight(q)`, y los pesos ya
 *   validados de fase 1 no cambian. El máximo sigue bajo el techo de PyMatching.
 * CONTEXTO: tasks/plans/phase2.md D3. La igualdad exacta de pesos mínimos con
 *   `min-weights-phenomenological.json` exige los mismos enteros en ambos lados; la tabla
 *   se repite literalmente (no se importa) para que un cambio de fórmula se vea aquí.
 *   En 3D NO se afirma que los pesos sean distintos (1 061 valores sobre 1 089 índices).
 * EXPIRA SI: cambia la fórmula de §3 (línea en decisiones y nueva validación) o la
 *   referencia deja de ser PyMatching.
 */
describe("test_intent_weights_shared_by_edge_index", () => {
  const TABLE: ReadonlyArray<[e: number, W: number]> = [
    [0, 16766926],
    [81, 16764263],
    [343, 16770859],
    [511, 16774866],
    [1088, 16773412],
  ];

  it("the literal W_e table (TS and Python, 2026-10-17)", () => {
    for (const [e, W] of TABLE) expect(edgeWeight(e)).toBe(W);
  });

  it("edgeWeight === qubitWeight on [0, 121)", () => {
    for (let q = 0; q < 121; q++) expect(edgeWeight(q)).toBe(qubitWeight(q));
  });

  it("every W_e for e < 1 089 is an integer ≤ 16 777 215, and the graph stores exactly edgeWeight(e)", () => {
    let max = 0;
    for (let e = 0; e < 1089; e++) {
      const W = edgeWeight(e);
      expect(Number.isInteger(W)).toBe(true);
      if (W > max) max = W;
    }
    expect(max).toBeLessThanOrEqual(MAX_EDGE_WEIGHT);
    const g = spacetimeGraph(rotatedSurfaceCode(5), "X", 5);
    for (let e = 0; e < g.edgeCount; e++) {
      expect(g.edgeWeight[e]).toBe(edgeWeight(e));
    }
  });
});

/**
 * test_intent_matcher_grows_never_drops
 *
 * INTENCIÓN: ningún síndrome se descarta por su tamaño (un tope duro sesgaría las colas,
 *   justo el «ajuste» que prohíbe la regla dura 4 (docs/spec.md §2)) y la memoria
 *   inicial es pequeña: el matcher arranca con ≤ 64 vértices y crece bajo demanda hasta `2·nodes`, nunca más.
 * CONTEXTO: tasks/plans/phase2.md D4 y las restricciones del árbol: las matrices densas
 *   de Blossom son `(2N + 1)²` (12 MB a d = 7, 50 MB a d = 9 si se dimensionan al peor
 *   caso), dos decodificadores por distancia dentro del Worker de un móvil.
 * EXPIRA SI: llega un matcher disperso con memoria O(E) (Sparse Blossom, union-find).
 */
describe("test_intent_matcher_grows_never_drops", () => {
  it("initial capacity ≤ 64 vertices for d ∈ {3, 5, 7, 9} with cycles = d", () => {
    for (const d of [3, 5, 7, 9]) {
      const dec = createSpacetimeDecoder(rotatedSurfaceCode(d), "Z", d);
      expect(dec.matcherVertices).toBeLessThanOrEqual(64);
      expect(dec.matcherVertices).toBe(2 * Math.min(dec.graph.nodes, 32));
    }
  });

  it("every node lit at d = 7, cycles = 7 (192 defects) decodes with a valid matching, capacity exactly 2·nodes, no Error", () => {
    const code = rotatedSurfaceCode(7);
    const dec = createSpacetimeDecoder(code, "Z", 7);
    const nodes = dec.graph.nodes;
    expect(nodes).toBe(192);
    const detectors = new Uint8Array(nodes).fill(1);
    const correction = identity(code.n);
    const total = decodeSpacetime(dec, detectors, correction);
    expect(total).toBeGreaterThan(0);
    expect(dec.defectCount).toBe(nodes);
    expect(dec.matcherVertices).toBe(2 * nodes);
    const seen = new Set<number>();
    for (let p = 0; p < dec.pairCount; p++) {
      seen.add(dec.pairs[2 * p]!);
      const b = dec.pairs[2 * p + 1]!;
      if (b !== BOUNDARY) seen.add(b);
    }
    expect(seen.size).toBe(nodes);
    // A later small syndrome uses the grown matcher; the capacity stays.
    detectors.fill(0);
    detectors[0] = 1;
    detectors[1] = 1;
    decodeSpacetime(dec, detectors, correction);
    expect(dec.matcherVertices).toBe(2 * nodes);
  });

  it("growth is monotone through random syndromes of increasing size (never shrinks, never beyond 2·nodes)", () => {
    const code = rotatedSurfaceCode(5);
    const dec = createSpacetimeDecoder(code, "X", 5, 2);
    const nodes = dec.graph.nodes;
    const correction = identity(code.n);
    let last = dec.matcherVertices;
    for (let k = 1; k <= nodes; k += 7) {
      const detectors = new Uint8Array(nodes);
      for (let i = 0; i < k; i++) detectors[(i * 11) % nodes] = 1;
      decodeSpacetime(dec, detectors, correction);
      expect(dec.matcherVertices).toBeGreaterThanOrEqual(last);
      expect(dec.matcherVertices).toBeGreaterThanOrEqual(2 * dec.defectCount);
      expect(dec.matcherVertices).toBeLessThanOrEqual(2 * nodes);
      last = dec.matcherVertices;
    }
  });
});

/**
 * test_intent_spacetime_shot_steps_without_allocating
 *
 * INTENCIÓN: como `test_intent_sampler_steps_without_allocating` (sim-conventions) para
 *   el modelo fenomenológico: `step` avanza el tally sellado y los buffers del
 *   `SpacetimeShotContext` sin crear objetos por tirada. La ÚNICA asignación admitida es
 *   el crecimiento del matcher (D4), que ocurre O(log M) veces en la vida del
 *   decodificador: el test lo fuerza ANTES (síndrome con todos los nodos) y mide después.
 * CONTEXTO: docs/spec.md §7; el Worker ejecuta ~10⁵–10⁶ tiradas 3D por curva. Dos medidas:
 *   la FORMA (identidad de buffers y de la capacidad del matcher a través de 50 `step`) y
 *   la ASIGNACIÓN (recolecciones menores durante 5·10⁴ tiradas en d = 3, con el mismo
 *   control positivo que en 2D).
 * EXPIRA SI: la simulación masiva sale del hilo del Worker a WebAssembly o el tally pasa
 *   a ser inmutable por diseño.
 */
function minorGcEventsDuring(work: () => void): Promise<number> {
  let count = 0;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const detail = (entry as { detail?: { kind?: number } }).detail;
      if (detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR) count++;
    }
  });
  observer.observe({ entryTypes: ["gc"] });
  work();
  return new Promise((resolve) =>
    setTimeout(() => {
      observer.disconnect();
      resolve(count);
    }, 100),
  );
}

describe("test_intent_spacetime_shot_steps_without_allocating", () => {
  const NEVER = { minFailures: 10 ** 9, minShots: 10 ** 9, maxShots: 10 ** 9 };

  it("tally, context buffers and matcher capacity keep their identity across 50 steps once the matcher has grown", () => {
    const sampler = createPointSampler(
      rotatedSurfaceCode(5),
      0.03,
      7,
      NEVER,
      PHENOMENOLOGICAL_MODEL,
    );
    const ctx = sampler.ctx;
    if (!("detectors" in ctx)) throw new Error("expected a 3D context");
    // Force the growth first: every node lit, both types.
    const scratch = identity(ctx.code.n);
    decodeSpacetime(
      ctx.decoders.Z,
      new Uint8Array(ctx.decoders.Z.graph.nodes).fill(1),
      scratch,
    );
    decodeSpacetime(
      ctx.decoders.X,
      new Uint8Array(ctx.decoders.X.graph.nodes).fill(1),
      scratch,
    );
    const capZ = ctx.decoders.Z.matcherVertices;
    const capX = ctx.decoders.X.matcherVertices;
    expect(capZ).toBe(2 * ctx.decoders.Z.graph.nodes);
    const tally = sampler.tally;
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
    for (let i = 0; i < 50; i++) {
      expect(step(sampler, 20)).toBeNull();
      expect(sampler.tally).toBe(tally);
      expect(sampler.ctx).toBe(ctx);
      const now = [
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
      for (let j = 0; j < refs.length; j++) expect(now[j]).toBe(refs[j]);
      expect(ctx.decoders.Z.matcherVertices).toBe(capZ);
      expect(ctx.decoders.X.matcherVertices).toBe(capX);
    }
    expect(tally.shots).toBe(1000);
    expect(Object.isSealed(tally)).toBe(true);
    const a = estimate(sampler);
    const b = estimate(sampler);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("5·10⁴ spacetime shots at d = 3 through step() trigger no minor GC (positive control: an allocating loop does)", async () => {
    const sampler = createPointSampler(
      rotatedSurfaceCode(3),
      0.05,
      11,
      NEVER,
      PHENOMENOLOGICAL_MODEL,
    );
    const ctx = sampler.ctx;
    if (!("detectors" in ctx)) throw new Error("expected a 3D context");
    const scratch = identity(9);
    decodeSpacetime(ctx.decoders.Z, new Uint8Array(16).fill(1), scratch);
    decodeSpacetime(ctx.decoders.X, new Uint8Array(16).fill(1), scratch);
    step(sampler, 5_000); // warm-up
    const gcDuringShots = await minorGcEventsDuring(() => {
      step(sampler, 50_000);
    });
    const sink: number[] = [];
    const gcDuringAllocations = await minorGcEventsDuring(() => {
      for (let i = 0; i < 300_000; i++) {
        const block: number[] = new Array<number>(128).fill(i);
        sink.push(block[i & 127]!);
        if (sink.length > 1000) sink.length = 0;
      }
    });
    expect(gcDuringAllocations).toBeGreaterThanOrEqual(3);
    expect(gcDuringShots).toBeLessThanOrEqual(1);
  });
});
