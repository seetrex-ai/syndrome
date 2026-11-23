import { describe, expect, it } from "vitest";
import {
  computeSyndrome,
  identity,
  isStabilizerEquivalent,
  logicalEffect,
  logicalXOnColumn,
  logicalZOnRow,
  multiplyInto,
  pauliEquals,
  pauliFrom,
  qubitIndex,
  rotatedSurfaceCode,
  type Pauli,
  type RotatedSurfaceCode,
} from "../../src/core/index";

/**
 * test_scenario_error_to_verdict
 *
 * INTENCIÓN: las cuatro decisiones del módulo lattice (álgebra de Pauli, geometría,
 *   síndrome, veredicto) componen como la tirada Monte Carlo y el modo reto las usarán:
 *   error E → síndrome → corrección C con el mismo síndrome → residual R = E·C con
 *   síndrome nulo → veredicto {x, z} y pertenencia al grupo de estabilizadores. El caso
 *   (b) es el mensaje del producto: corregir «por el otro lado» deja un error lógico.
 * CONTEXTO: docs/spec.md §3 «Vocabulario» define el error lógico por el residual (X lógico ⇔
 *   anticommuta con Z_L), y §4.6 acepta en el reto cualquier C cuyo residual sea un
 *   estabilizador.
 * EXPIRA SI: el veredicto se calcula de otra forma, p. ej. por clase de homología
 *   explícita, o la tirada deja de pasar por el residual.
 */
describe("test_scenario_error_to_verdict", () => {
  function run(
    code: RotatedSurfaceCode,
    error: Pauli,
    correction: Pauli,
  ): { residual: Pauli; equivalent: boolean; x: boolean; z: boolean } {
    const n = code.stabilizers.length;
    const sE = computeSyndrome(code, error, new Uint8Array(n));
    const sC = computeSyndrome(code, correction, new Uint8Array(n));
    expect(sC).toEqual(sE); // the correction is valid: same syndrome
    const residual = multiplyInto(identity(code.n), error, correction);
    const sR = computeSyndrome(code, residual, new Uint8Array(n));
    expect(sR.every((b) => b === 0)).toBe(true);
    const effect = logicalEffect(code, residual);
    return {
      residual,
      equivalent: isStabilizerEquivalent(code, residual),
      x: effect.x,
      z: effect.z,
    };
  }

  const d3 = rotatedSurfaceCode(3);
  const q3 = (r: number, c: number) => qubitIndex(3, r, c);

  it("(a) E = X(0,0), C = X(0,0): residual I, equivalent, no logical error", () => {
    const e = pauliFrom(9, [q3(0, 0)], []);
    const r = run(d3, e, pauliFrom(9, [q3(0, 0)], []));
    expect(pauliEquals(r.residual, identity(9))).toBe(true);
    expect(r).toMatchObject({ equivalent: true, x: false, z: false });
  });

  it("(b) E = X(0,0), C = X(1,0)·X(2,0): residual X_L, logical X error", () => {
    const e = pauliFrom(9, [q3(0, 0)], []);
    const r = run(d3, e, pauliFrom(9, [q3(1, 0), q3(2, 0)], []));
    expect(pauliEquals(r.residual, d3.logicalX)).toBe(true);
    expect(r).toMatchObject({ equivalent: false, x: true, z: false });
  });

  it("(c) E = X(1,1), C = X(0,1)·X(0,2)·X(1,2): residual is the stabilizer X(0,1), equivalent", () => {
    const e = pauliFrom(9, [q3(1, 1)], []);
    const r = run(d3, e, pauliFrom(9, [q3(0, 1), q3(0, 2), q3(1, 2)], []));
    const stabilizer = d3.stabilizers.find(
      (s) => s.type === "X" && s.row === 0 && s.col === 1,
    )!;
    expect(pauliEquals(r.residual, stabilizer.operator)).toBe(true);
    expect(r).toMatchObject({ equivalent: true, x: false, z: false });
  });

  it("(d) E = Y(1,1), C = X(0,1)·X(2,1)·Z(1,0)·Z(1,2): residual X_col(1)·Z_row(1), both logical errors", () => {
    const e = pauliFrom(9, [q3(1, 1)], [q3(1, 1)]);
    const c = pauliFrom(9, [q3(0, 1), q3(2, 1)], [q3(1, 0), q3(1, 2)]);
    const r = run(d3, e, c);
    const expected = multiplyInto(
      identity(9),
      logicalXOnColumn(d3, 1),
      logicalZOnRow(d3, 1),
    );
    expect(pauliEquals(r.residual, expected)).toBe(true);
    expect(r).toMatchObject({ equivalent: false, x: true, z: true });
  });

  it("d = 5: E = X(0,2) corrected down column 2 leaves X_col(2), logical X error", () => {
    const d5 = rotatedSurfaceCode(5);
    const e = pauliFrom(25, [qubitIndex(5, 0, 2)], []);
    const c = pauliFrom(
      25,
      [1, 2, 3, 4].map((row) => qubitIndex(5, row, 2)),
      [],
    );
    const r = run(d5, e, c);
    expect(pauliEquals(r.residual, logicalXOnColumn(d5, 2))).toBe(true);
    expect(r).toMatchObject({ equivalent: false, x: true, z: false });
  });
});
