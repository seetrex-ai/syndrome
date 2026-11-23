import { describe, expect, it, vi } from "vitest";
import {
  estimatePoint,
  pointSeed,
  rotatedSurfaceCode,
  type PointEstimate,
} from "../../src/core/index";

// d = 7 at p = 0.15 runs at ≈ 30 k shots/s on a laptop: 5·10³ shots ≈ 0.2 s;
// the margin is for the CI runner.
vi.setConfig({ testTimeout: 30_000 });

/**
 * test_scenario_more_qubits_fewer_errors
 *
 * INTENCIÓN: el mensaje del producto medido con la estadística real del núcleo
 *   (`estimatePoint`, Wilson 95 %): por debajo del umbral, `P_L(7) < P_L(5) < P_L(3)` con
 *   intervalos disjuntos; por encima, el orden se invierte. Es la gráfica estrella en
 *   forma de aserción.
 * CONTEXTO: docs/spec.md §1 (Willow: «más cúbits, menos errores»), §3 («Valores de
 *   referencia»: cruce entre 9 % y 11 %; tasks/plans/validation.md M3 lo sitúa entre 0,09
 *   y 0,10). Semillas fijas por punto (`pointSeed`): determinista, no flaky. Esperado a
 *   p = 0,03 con N = 2·10⁴: d7 ≈ [0,0047, 0,0068], d5 ≈ [0,0109, 0,0139], d3 ≈ [0,026,
 *   0,031]; a p = 0,15: 0,387 / 0,447 / 0,501 con σ ≈ 0,007.
 * EXPIRA SI: cambia el modelo de ruido de la gráfica por defecto (fenomenológico o
 *   despolarizante tienen otro umbral) o la malla deja de incluir d = 3, 5, 7.
 */
describe("test_scenario_more_qubits_fewer_errors", () => {
  const BASE = 20261016;

  function curve(p: number, shots: number): Record<number, PointEstimate> {
    const out: Record<number, PointEstimate> = {};
    for (const d of [3, 5, 7]) {
      out[d] = estimatePoint(rotatedSurfaceCode(d), p, pointSeed(BASE, d, p), {
        minFailures: 2,
        minShots: shots,
        maxShots: shots,
      });
    }
    return out;
  }

  it("p = 0.03, 2·10⁴ shots: P_L(7) < P_L(5) < P_L(3) with disjoint Wilson intervals", () => {
    const c = curve(0.03, 20_000);
    for (const d of [3, 5, 7]) {
      expect(c[d]!.shots).toBe(20_000);
      expect(c[d]!.failures).toBeGreaterThan(0);
    }
    expect(c[7]!.high).toBeLessThan(c[5]!.low);
    expect(c[5]!.high).toBeLessThan(c[3]!.low);
    expect(c[7]!.estimate).toBeLessThan(c[5]!.estimate);
    expect(c[5]!.estimate).toBeLessThan(c[3]!.estimate);
  });

  it("p = 0.15, 5·10³ shots: the order inverts above threshold, intervals still disjoint", () => {
    const c = curve(0.15, 5000);
    expect(c[3]!.estimate).toBeLessThan(c[5]!.estimate);
    expect(c[5]!.estimate).toBeLessThan(c[7]!.estimate);
    expect(c[3]!.high).toBeLessThan(c[5]!.low);
    expect(c[5]!.high).toBeLessThan(c[7]!.low);
  });
});
