import { describe, expect, it } from "vitest";
import {
  computeTypeSyndrome,
  createDecoder,
  createRng,
  decode,
  identity,
  independentNoise,
  logicalEffect,
  multiplyInto,
  rotatedSurfaceCode,
  sampleNoise,
  type Decoder,
  type Pauli,
  type RotatedSurfaceCode,
} from "../../src/core/index";

/**
 * test_scenario_shot_noise_to_verdict
 *
 * INTENCIÓN: el flujo que `sim/` ejecutará millones de veces (ruido → síndrome por tipo →
 *   `decode` × 2 → residual → `logicalEffect`) compone entre las decisiones de noise/ y
 *   decoder/ (D2, D5–D7 de tasks/plans/decoder.md) y las de lattice con buffers creados
 *   una vez y reutilizados en cada tirada. **Lo que este test no mide** es que la tirada
 *   no asigne por dentro: eso lo cuenta `npm run bench` (eventos de GC por 10⁵ tiradas),
 *   que informa pero no falla. Y el
 *   mensaje del producto en forma mínima: por debajo del umbral, más distancia = menos
 *   fallos lógicos.
 * CONTEXTO: docs/spec.md §3 «Vocabulario» (tirada, defecto, corrección, residual, error
 *   lógico) y §7 (presupuesto del Worker). Semilla fija: determinista, no flaky. La
 *   estadística seria (Wilson, muestreo adaptativo, validación contra PyMatching) es de
 *   `sim/` y de `tools/`, no de este test.
 * EXPIRA SI: la tirada deja de pasar por el residual (p. ej. veredicto por clase de
 *   homología explícita) o el decodificador deja de escribir en el Pauli del llamante.
 */
describe("test_scenario_shot_noise_to_verdict", () => {
  interface Shot {
    code: RotatedSurfaceCode;
    decoders: { Z: Decoder; X: Decoder };
    error: Pauli;
    correction: Pauli;
    residual: Pauli;
    syndromes: { Z: Uint8Array; X: Uint8Array };
    check: Uint8Array;
  }

  function setup(d: number): Shot {
    const code = rotatedSurfaceCode(d);
    const m = (code.n - 1) / 2;
    return {
      code,
      decoders: { Z: createDecoder(code, "Z"), X: createDecoder(code, "X") },
      error: identity(code.n),
      correction: identity(code.n),
      residual: identity(code.n),
      syndromes: { Z: new Uint8Array(m), X: new Uint8Array(m) },
      check: new Uint8Array(m),
    };
  }

  /** Runs N shots with the buffers of `s`; returns the logical failure count. */
  function run(s: Shot, p: number, seed: number, N: number, verify: boolean) {
    const rng = createRng(seed);
    const noise = independentNoise(p);
    let failures = 0;
    for (let shot = 0; shot < N; shot++) {
      sampleNoise(noise, rng, s.error);
      for (const type of ["Z", "X"] as const) {
        computeTypeSyndrome(s.code, type, s.error, s.syndromes[type]);
        decode(s.decoders[type], s.syndromes[type], s.correction);
        if (verify) {
          // The correction reproduces the syndrome of the error, per type.
          computeTypeSyndrome(s.code, type, s.correction, s.check);
          expect(s.check).toEqual(s.syndromes[type]);
        }
      }
      multiplyInto(s.residual, s.error, s.correction);
      if (verify) {
        for (const type of ["Z", "X"] as const) {
          computeTypeSyndrome(s.code, type, s.residual, s.check);
          expect(s.check.every((b) => b === 0)).toBe(true);
        }
      }
      const effect = logicalEffect(s.code, s.residual);
      if (effect.x || effect.z) failures++;
    }
    return failures;
  }

  it.each([3, 5])(
    "d = %i, p = 0.10, 2 000 shots: syndromes match, residual has null syndrome, 0 < k < N, reproducible",
    (d) => {
      const s = setup(d);
      const k = run(s, 0.1, 2026, 2000, true);
      expect(k).toBeGreaterThan(0);
      expect(k).toBeLessThan(2000);
      expect(run(setup(d), 0.1, 2026, 2000, false)).toBe(k);
    },
  );

  it("p = 0.03, 20 000 shots: d = 5 fails less than d = 3 (the product's message)", () => {
    const k3 = run(setup(3), 0.03, 2026, 20_000, false);
    const k5 = run(setup(5), 0.03, 2026, 20_000, false);
    expect(k3).toBeGreaterThan(0);
    expect(k5).toBeLessThan(k3);
  });
});
