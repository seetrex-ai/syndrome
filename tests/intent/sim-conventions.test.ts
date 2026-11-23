import { constants, PerformanceObserver } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  createPointSampler,
  estimate,
  estimatePoint,
  independentNoise,
  createRng,
  createShotContext,
  pointRate,
  rotatedSurfaceCode,
  runShot,
  step,
  stop,
  VALIDATION_STOP_RULE,
  WILSON_Z95,
  wilsonInterval,
} from "../../src/core/index";

const code3 = rotatedSurfaceCode(3);

/**
 * test_intent_estimator_follows_stop_reason
 *
 * INTENCIÓN: el estimador insesgado de un punto depende de POR QUÉ se paró el muestreo:
 *   `(k − 1)/(N − 1)` (Haldane, muestreo binomial inverso) sólo cuando la parada cayó en
 *   el fallo k-ésimo; `k/N` cuando se paró por tiradas, por tope o por presupuesto. El
 *   motivo viaja en el resultado (`stopReason`) para que la gráfica, `browser.json` y la
 *   referencia Python apliquen la misma regla al mismo dato.
 * CONTEXTO: docs/spec.md §3 «Métrica del marcador» (sesgo ≈ 1/k de k/N con parada por
 *   fallos). En la malla de §6 todos los puntos paran por tiradas (tasks/plans/
 *   validation.md M3: el punto más escaso tiene ≈ 567 fallos en 10⁵), así que sin este
 *   test la rama por fallos sólo la vería el navegador.
 * EXPIRA SI: la regla pasa a ser de tiradas fijas o se abandona el muestreo adaptativo.
 */
describe("test_intent_estimator_follows_stop_reason", () => {
  it('pointRate: (k − 1)/(N − 1) for "failures", k/N otherwise', () => {
    expect(pointRate(100, 1001, "failures")).toBe(99 / 1000);
    expect(pointRate(100, 1001, "shots")).toBe(100 / 1001);
    expect(pointRate(100, 1001, "cap")).toBe(100 / 1001);
    expect(pointRate(100, 1001, "budget")).toBe(100 / 1001);
    // Haldane with k = 1 would be a 0 that is not an upper bound: refused.
    expect(() => pointRate(1, 100, "failures")).toThrow(RangeError);
    expect(() => pointRate(2, 1, "failures")).toThrow(RangeError);
    expect(pointRate(2, 2, "failures")).toBe(1);
  });

  it("estimatePoint carries the reason and applies its estimator", () => {
    const byShots = estimatePoint(code3, 0.1, 42, {
      minFailures: 10,
      minShots: 2000,
      maxShots: 100_000,
    });
    expect(byShots.stopReason).toBe("shots");
    expect(byShots.shots).toBe(2000);
    expect(byShots.estimate).toBe(byShots.failures / byShots.shots);

    const byFailures = estimatePoint(code3, 0.01, 2026, {
      minFailures: 10,
      minShots: 100,
      maxShots: 1_000_000,
    });
    expect(byFailures.stopReason).toBe("failures");
    expect(byFailures.failures).toBe(10);
    expect(byFailures.estimate).toBe(9 / (byFailures.shots - 1));
  });

  it("the validation rule is ≥ 100 failures AND ≥ 10⁵ shots, cap 10⁶", () => {
    expect(VALIDATION_STOP_RULE).toEqual({
      minFailures: 100,
      minShots: 100_000,
      maxShots: 1_000_000,
    });
  });
});

/**
 * test_intent_zero_failures_is_an_upper_bound
 *
 * INTENCIÓN: un punto sin fallos nunca se publica como «cero»: lleva `upperBoundOnly` y
 *   el extremo superior de Wilson para que la gráfica dibuje una cota (marcador abierto
 *   con flecha), y `low = 0` exacto, no el residuo de redondeo de la fórmula.
 * CONTEXTO: docs/spec.md §3 («un punto con cero fallos se dibuja como cota superior») y el
 *   eje logarítmico de la gráfica estrella, donde 0 no existe. Wald daría [0, 0].
 * EXPIRA SI: la gráfica deja de ser logarítmica.
 */
describe("test_intent_zero_failures_is_an_upper_bound", () => {
  it("a capped point at p = 0 reports upperBoundOnly with Wilson's upper end", () => {
    const e = estimatePoint(code3, 0, 1, {
      minFailures: 1000,
      minShots: 10,
      maxShots: 500,
    });
    expect(e.failures).toBe(0);
    expect(e.estimate).toBe(0);
    expect(e.upperBoundOnly).toBe(true);
    expect(e.low).toBe(0);
    expect(e.high).toBe(wilsonInterval(0, 500).high);
    expect(e.high).toBeGreaterThan(0);
  });

  it("a point IN PROGRESS with no failures yet is an upper bound too (what the live chart sees)", () => {
    const sampler = createPointSampler(code3, 0, 1, {
      minFailures: 100,
      minShots: 1000,
      maxShots: 1000,
    });
    expect(step(sampler, 100)).toBeNull();
    const e = estimate(sampler);
    expect(e.stopReason).toBeNull();
    expect(e.shots).toBe(100);
    expect(e.failures).toBe(0);
    expect(e.estimate).toBe(0);
    expect(e.upperBoundOnly).toBe(true);
    expect(e.low).toBe(0);
    expect(e.high).toBe(wilsonInterval(0, 100).high);
  });

  it('a point cut by the time budget ("budget") with no failures is an upper bound, never a zero', () => {
    // The browser case: d = 7 at low p, stopped by the Worker's time budget.
    const sampler = createPointSampler(code3, 0, 1, {
      minFailures: 100,
      minShots: 100_000,
      maxShots: 1_000_000,
    });
    expect(step(sampler, 250)).toBeNull();
    stop(sampler, "budget");
    const e = estimate(sampler);
    expect(e.stopReason).toBe("budget");
    expect(e.failures).toBe(0);
    expect(e.estimate).toBe(0);
    expect(e.upperBoundOnly).toBe(true);
    expect(e.low).toBe(0);
    expect(e.high).toBe(wilsonInterval(0, 250).high);
    // And before any shot at all: still an upper bound, interval [0, 1].
    const untouched = createPointSampler(code3, 0.1, 2, VALIDATION_STOP_RULE);
    stop(untouched, "budget");
    const u = estimate(untouched);
    expect(u.shots).toBe(0);
    expect(u.upperBoundOnly).toBe(true);
    expect(u.low).toBe(0);
    expect(u.high).toBe(1);
  });

  it("wilsonInterval(0, n).high = z²/(n + z²) (closed form) for n ∈ {1, 10, 10⁶}", () => {
    const z2 = WILSON_Z95 * WILSON_Z95;
    for (const n of [1, 10, 1_000_000]) {
      const w = wilsonInterval(0, n);
      expect(w.low).toBe(0);
      expect(w.high).toBeCloseTo(z2 / (n + z2), 12);
    }
  });
});

/**
 * test_intent_sampler_steps_without_allocating
 *
 * INTENCIÓN: `step` avanza un `tally` sellado y los buffers del `ShotContext` sin crear
 *   objetos por tirada; `estimate()` es la única llamada que asigna y se invoca por lote
 *   (mensaje de progreso del Worker), no por tirada.
 * CONTEXTO: docs/spec.md §7 (~10⁶ tiradas por curva en el Worker). Dos medidas: la FORMA
 *   (identidad del tally y de los buffers a través de 50 `step`, tipo del retorno, objeto
 *   nuevo en `estimate`) y la ASIGNACIÓN de verdad, contando eventos de GC con
 *   `PerformanceObserver` durante 3·10⁵ tiradas en d = 3 (≈ 0,3 s): el árbol da 0, y un
 *   control positivo que asigna un array de 128 números por iteración da decenas (medido el
 *   2026-10-16: un mutante que copia el residual en `runShot` da 17 recolecciones
 *   menores en 3·10⁵ tiradas). **Suelo de sensibilidad:** con tolerancia ≤ 1 detecta
 *   ≳ 40 B por tirada; un `HeapNumber` de 12 B por tirada pasa (≈ 2 recolecciones por 10⁶
 *   tiradas, sin daño observable). «Sin crear objetos» significa, medido, «menos de ~40 B».
 *   Los workers de Vitest son procesos separados, así que el recuento es de este proceso.
 * EXPIRA SI: la simulación masiva sale del hilo del Worker a WebAssembly o el tally pasa
 *   a ser inmutable por diseño.
 */
// Only MINOR collections (scavenges of the young generation) are counted: they
// are what per-shot allocation provokes. A major or incremental cycle that the
// tree does not cause (observed once per ~2 s at d = 9 on
// 2026-10-16) would otherwise turn the test red on a slow runner.
function minorGcEventsDuring(work: () => void): Promise<number> {
  let count = 0;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      // `detail` is on Node's PerformanceEntry at runtime; the lib typing omits it.
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
  ); // let entries flush
}

describe("test_intent_sampler_steps_without_allocating", () => {
  it("3·10⁵ shots through step() trigger no garbage collection (positive control: an allocating loop does)", async () => {
    const sampler = createPointSampler(code3, 0.1, 11, {
      minFailures: 10 ** 9,
      minShots: 10 ** 9,
      maxShots: 10 ** 9,
    });
    step(sampler, 20_000); // warm-up: JIT and any lazy initialisation
    const gcDuringShots = await minorGcEventsDuring(() => {
      step(sampler, 300_000);
    });
    // Positive control: ~300 MB of short-lived JS-heap objects (plain arrays;
    // a typed array's backing store lives off-heap and does not pressure the
    // young generation), far above any semi-space size, so it provokes minor
    // collections whatever the process history (an earlier 9-byte-per-iteration
    // control gave only 2 in a process that had already grown its young generation).
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

  it("tally and context buffers keep their identity across 50 steps", () => {
    const sampler = createPointSampler(code3, 0.1, 7, {
      minFailures: 10,
      minShots: 100_000,
      maxShots: 100_000,
    });
    const tally = sampler.tally;
    const ctx = sampler.ctx;
    // Without a model argument the sampler is the phase 1 one (phase2.md D2):
    // a ShotContext (with `error`), not a SpacetimeShotContext.
    expect(ctx.noise.kind).toBe("independent");
    if (!("error" in ctx)) throw new Error("expected a 2D context");
    const { error, correction, residual } = ctx;
    const synZ = ctx.syndromes.Z;
    const synX = ctx.syndromes.X;
    for (let i = 0; i < 50; i++) {
      const reason = step(sampler, 20);
      expect(reason).toBeNull();
      expect(sampler.tally).toBe(tally);
      expect(sampler.ctx).toBe(ctx);
      expect(ctx.error).toBe(error);
      expect(ctx.correction).toBe(correction);
      expect(ctx.residual).toBe(residual);
      expect(ctx.syndromes.Z).toBe(synZ);
      expect(ctx.syndromes.X).toBe(synX);
    }
    expect(tally.shots).toBe(1000);
    expect(Object.isSealed(tally)).toBe(true);
    const a = estimate(sampler);
    const b = estimate(sampler);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("step returns null or a StopReason string; runShot returns an integer", () => {
    const sampler = createPointSampler(code3, 0.1, 7, {
      minFailures: 2,
      minShots: 10,
      maxShots: 10,
    });
    const first = step(sampler, 5);
    expect(first).toBeNull();
    const second = step(sampler, 5);
    expect(typeof second).toBe("string");
    expect(["shots", "failures", "cap", "budget"]).toContain(second);
    const ctx = createShotContext(code3, independentNoise(0.1), createRng(7));
    expect(Number.isInteger(runShot(ctx))).toBe(true);
  });
});
