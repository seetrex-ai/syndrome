import { describe, expect, it, vi } from "vitest";
import {
  estimatePoint,
  PHENOMENOLOGICAL_MODEL,
  pointSeed,
  rotatedSurfaceCode,
  type PointEstimate,
} from "../../src/core/index";

// d = 7 with 7 cycles runs at ≈ 27 000 shots/s at p = 0.01 and ≈ 1 800 at
// p = 0.04 on a laptop (measured by npm run bench, case (g), 2026-10-17; the
// plan's M4 estimate of 4 000 was 5× pessimistic): the test takes ≈ 5.5 s.
// The 60 s timeout is margin for the CI runner.
vi.setConfig({ testTimeout: 120_000 });

/**
 * test_scenario_phenomenological_more_qubits_fewer_errors
 *
 * INTENCIÓN: la hipótesis H de la fase 2 medida con el núcleo (tasks/plans/phase2.md §1):
 *   con fallos de medición (`q = p`), d ciclos y lectura final perfecta, por debajo del
 *   cruce `P_L(7) < P_L(5) < P_L(3)` con intervalos de Wilson disjuntos; por encima, el
 *   orden se invierte. El cruce de este modelo está en ≈ 2–2,5 % para d = 3, 5, 7 (M3), no
 *   en el 10 % de fase 1 ni en el 3 % asintótico.
 * CONTEXTO: docs/spec.md §3 («Ruido fenomenológico … umbral ≈3 %»), phase2.md M3 (sonda con
 *   PyMatching: en p = 0,01, P_L ≈ 0,021 / 0,012 / 0,0037; en p = 0,04, 0,225 / 0,313 /
 *   0,384). Semillas fijas por punto (`pointSeed`): determinista, no flaky. Con N = 2·10⁴
 *   en p = 0,01 los intervalos esperados son d7 ≈ [0,0029, 0,0047], d5 ≈ [0,0103, 0,0133],
 *   d3 ≈ [0,019, 0,023]: disjuntos.
 * EXPIRA SI: cambia la convención D1 del modelo (nueva validación) o la malla deja de
 *   incluir d = 3, 5, 7.
 */
describe("test_scenario_phenomenological_more_qubits_fewer_errors", () => {
  const BASE = 20261016;

  function curve(p: number, shots: number): Record<number, PointEstimate> {
    const out: Record<number, PointEstimate> = {};
    for (const d of [3, 5, 7]) {
      out[d] = estimatePoint(
        rotatedSurfaceCode(d),
        p,
        pointSeed(BASE, d, p),
        { minFailures: 2, minShots: shots, maxShots: shots },
        PHENOMENOLOGICAL_MODEL,
      );
    }
    return out;
  }

  it("p = 0.01, 2·10⁴ shots: P_L(7) < P_L(5) < P_L(3) with disjoint Wilson intervals", () => {
    const c = curve(0.01, 20_000);
    for (const d of [3, 5, 7]) {
      expect(c[d]!.shots).toBe(20_000);
      expect(c[d]!.failures).toBeGreaterThan(0);
    }
    expect(c[7]!.high).toBeLessThan(c[5]!.low);
    expect(c[5]!.high).toBeLessThan(c[3]!.low);
    expect(c[7]!.estimate).toBeLessThan(c[5]!.estimate);
    expect(c[5]!.estimate).toBeLessThan(c[3]!.estimate);
    // Order of magnitude of M3 (one seed, N = 2·10⁴ there too).
    expect(c[3]!.estimate).toBeGreaterThan(0.015);
    expect(c[3]!.estimate).toBeLessThan(0.03);
    expect(c[7]!.estimate).toBeLessThan(0.006);
  });

  it("p = 0.04, 4·10³ shots: the order inverts above the crossing, intervals still disjoint", () => {
    const c = curve(0.04, 4_000);
    expect(c[3]!.estimate).toBeLessThan(c[5]!.estimate);
    expect(c[5]!.estimate).toBeLessThan(c[7]!.estimate);
    expect(c[3]!.high).toBeLessThan(c[5]!.low);
    expect(c[5]!.high).toBeLessThan(c[7]!.low);
  });
});
