import { describe, expect, it } from "vitest";
import {
  computeSyndrome,
  computeTypeSyndrome,
  DISTANCES,
  identity,
  pauliFrom,
  qubitIndex,
  qubitRowCol,
  rotatedSurfaceCode,
  type Boundary,
  type StabilizerType,
} from "../../src/core/index";

/**
 * test_intent_lattice_stable_indexing
 *
 * INTENCIÓN: el índice de cúbit q = row·d + col y el orden de los estabilizadores (bloque
 *   Z, bloque X; dentro de cada bloque, barrido por filas del tablero extendido, i de −1 a
 *   d−1 y j de −1 a d−1) son un contrato con el decodificador (pesos genéricos
 *   splitmix64(0x53594E44 + q), docs/spec.md §3), con el fixture
 *   docs/validacion/min-weights.json (síndromes de PyMatching indexados igual), con la
 *   interfaz y con los puzles por URL (máscara de 2·d² bits, fase 2). Cambiarlos cambia el
 *   decodificador en silencio o rompe los enlaces compartidos.
 * CONTEXTO: dos implementaciones (TS y Python) tienen que construir el mismo código con la
 *   misma numeración sin leerse la una a la otra; el único lugar donde está escrita es aquí
 *   (y en docs/decisiones.md, 2026-10-16). Las tablas de d = 3 y d = 5 están escritas a
 *   mano siguiendo la regla, nunca generadas por el código que se prueba.
 * EXPIRA SI: pesos, fixtures y puzles pasan a expresarse por coordenadas (row, col) /
 *   (i, j) con un conversor único, o la referencia Python importa la geometría de un JSON
 *   exportado por el núcleo.
 */
describe("test_intent_lattice_stable_indexing", () => {
  it("qubit index is row·d + col and qubitRowCol inverts it", () => {
    for (const d of DISTANCES) {
      const code = rotatedSurfaceCode(d);
      for (let r = 0; r < d; r++) {
        for (let c = 0; c < d; c++) {
          const q = r * d + c;
          expect(qubitIndex(d, r, c)).toBe(q);
          expect(qubitRowCol(d, q)).toEqual([r, c]);
          expect(code.qubits[q]).toEqual({ index: q, row: r, col: c });
        }
      }
    }
  });

  it("stabilizers[k].index === k, Z block before X block, lexicographic (row, col) within a block", () => {
    for (const d of DISTANCES) {
      const code = rotatedSurfaceCode(d);
      const half = (d * d - 1) / 2;
      code.stabilizers.forEach((s, k) => {
        expect(s.index).toBe(k);
        expect(s.type).toBe(k < half ? "Z" : "X");
        expect(s.typeIndex).toBe(k < half ? k : k - half);
        if (k > 0 && k !== half) {
          const prev = code.stabilizers[k - 1]!;
          const before =
            prev.row < s.row || (prev.row === s.row && prev.col < s.col);
          expect(before).toBe(true);
        }
      });
      expect(code.typeOffset).toEqual({ Z: 0, X: half });
    }
  });

  // [type, i, j] by global index, hand-derived from the rule in docs/spec.md §3.
  const TABLE_D3: ReadonlyArray<[StabilizerType, number, number]> = [
    ["Z", 0, 0],
    ["Z", 0, 2],
    ["Z", 1, -1],
    ["Z", 1, 1],
    ["X", -1, 0],
    ["X", 0, 1],
    ["X", 1, 0],
    ["X", 2, 1],
  ];
  const TABLE_D5: ReadonlyArray<[StabilizerType, number, number]> = [
    ["Z", 0, 0],
    ["Z", 0, 2],
    ["Z", 0, 4],
    ["Z", 1, -1],
    ["Z", 1, 1],
    ["Z", 1, 3],
    ["Z", 2, 0],
    ["Z", 2, 2],
    ["Z", 2, 4],
    ["Z", 3, -1],
    ["Z", 3, 1],
    ["Z", 3, 3],
    ["X", -1, 0],
    ["X", -1, 2],
    ["X", 0, 1],
    ["X", 0, 3],
    ["X", 1, 0],
    ["X", 1, 2],
    ["X", 2, 1],
    ["X", 2, 3],
    ["X", 3, 0],
    ["X", 3, 2],
    ["X", 4, 1],
    ["X", 4, 3],
  ];

  for (const [d, table] of [
    [3, TABLE_D3],
    [5, TABLE_D5],
  ] as const) {
    it(`d = ${d}: the literal table of (type, i, j) by index`, () => {
      const code = rotatedSurfaceCode(d);
      expect(table.length).toBe(d * d - 1);
      expect(code.stabilizers.map((s) => [s.type, s.row, s.col])).toEqual(
        table.map((row) => [...row]),
      );
    });
  }
});

/**
 * test_intent_lattice_fixed_layout
 *
 * INTENCIÓN: la coloración (plaqueta (i, j) es Z si i + j es par) y la asignación de
 *   bordes (X arriba y abajo, Z a izquierda y derecha; row 0 arriba, col 0 izquierda)
 *   están fijadas por decisión (docs/decisiones.md 2026-10-16) para que el núcleo y la
 *   referencia Python construyan el mismo código y no una imagen especular; sin esto, un
 *   desacuerdo de layout sería indistinguible de un error del decodificador en la
 *   validación.
 * CONTEXTO: la regla de paridad sólo define la coloración con el origen fijado; la tabla
 *   de d = 3 de docs/spec.md §3 es el vector de prueba compartido. Las esquinas del tablero
 *   extendido (peso 1) no existen.
 * EXPIRA SI: la referencia Python deja de reimplementar la geometría y la lee de un
 *   fichero exportado por el núcleo (el test pasaría a comparar ese fichero).
 */
describe("test_intent_lattice_fixed_layout", () => {
  const LAYOUT_D3: ReadonlyArray<
    [StabilizerType, number, number, Boundary | null, number[]]
  > = [
    ["Z", 0, 0, null, [0, 1, 3, 4]],
    ["Z", 1, 1, null, [4, 5, 7, 8]],
    ["X", 0, 1, null, [1, 2, 4, 5]],
    ["X", 1, 0, null, [3, 4, 6, 7]],
    ["X", -1, 0, "top", [0, 1]],
    ["X", 2, 1, "bottom", [7, 8]],
    ["Z", 1, -1, "left", [3, 6]],
    ["Z", 0, 2, "right", [2, 5]],
  ];

  it("d = 3 has exactly the eight plaquettes of docs/spec.md §3", () => {
    const code = rotatedSurfaceCode(3);
    expect(code.stabilizers.length).toBe(8);
    for (const [type, i, j, boundary, qubits] of LAYOUT_D3) {
      const found = code.stabilizers.filter((s) => s.row === i && s.col === j);
      expect(found.length).toBe(1);
      expect(found[0]!.type).toBe(type);
      expect(found[0]!.boundary).toBe(boundary);
      expect([...found[0]!.qubits]).toEqual(qubits);
    }
  });

  it("every distance: top/bottom carry only X, left/right only Z, no corners", () => {
    for (const d of DISTANCES) {
      const code = rotatedSurfaceCode(d);
      for (const s of code.stabilizers) {
        const rowEdge = s.row === -1 || s.row === d - 1;
        const colEdge = s.col === -1 || s.col === d - 1;
        expect(rowEdge && colEdge).toBe(false);
        if (rowEdge) {
          expect(s.type).toBe("X");
          expect(s.boundary).toBe(s.row === -1 ? "top" : "bottom");
        } else if (colEdge) {
          expect(s.type).toBe("Z");
          expect(s.boundary).toBe(s.col === -1 ? "left" : "right");
        } else {
          expect(s.boundary).toBeNull();
          expect(s.type).toBe((s.row + s.col) % 2 === 0 ? "Z" : "X");
        }
      }
    }
  });
});

/**
 * test_intent_syndrome_into_buffer
 *
 * INTENCIÓN: la tirada Monte Carlo llama al síndrome millones de veces dentro del Worker
 *   (docs/spec.md §7: 1 000 tiradas a d = 7 en < 2 s en móvil medio); la API escribe en un
 *   buffer del llamante y devuelve ese mismo objeto, de modo que el bucle caliente pueda
 *   reutilizar un único buffer.
 * CONTEXTO: un Uint8Array por llamada son 10⁶ asignaciones por curva y pausas de GC en el
 *   Worker que la interfaz nota; la regla se fija en la firma para que no dependa de que
 *   cada consumidor la recuerde. **Lo que este test mide** es la forma de la firma:
 *   identidad del objeto devuelto, sobrescritura completa (incluidos los ceros) y rechazo
 *   de longitudes y tamaños de error incorrectos. **No mide** que la implementación no
 *   asigne por dentro: eso se comprobó aparte (medido el 2026-10-16: 0 eventos de GC
 *   en 10⁶ llamadas a computeSyndrome, computeTypeSyndrome y multiplyInto en d = 9) y
 *   pasa a vigilarlo `npm run bench` cuando exista (fase 1, `sim/`).
 * EXPIRA SI: la simulación masiva pasa a WebAssembly o el síndrome deja de estar en el
 *   bucle caliente.
 */
describe("test_intent_syndrome_into_buffer", () => {
  for (const d of DISTANCES) {
    it(`d = ${d}: returns the caller's buffer, overwrites it entirely, rejects wrong lengths`, () => {
      const code = rotatedSurfaceCode(d);
      const total = d * d - 1;
      const half = total / 2;
      const error = pauliFrom(code.n, [4], [4]);

      const out = new Uint8Array(total).fill(0xff);
      expect(computeSyndrome(code, error, out)).toBe(out);
      expect(out.every((b) => b === 0 || b === 1)).toBe(true);
      expect(computeSyndrome(code, identity(code.n), out)).toBe(out);
      expect(out.every((b) => b === 0)).toBe(true);

      for (const type of ["Z", "X"] as const) {
        const outT = new Uint8Array(half).fill(0xff);
        expect(computeTypeSyndrome(code, type, error, outT)).toBe(outT);
        expect(outT.every((b) => b === 0 || b === 1)).toBe(true);
        expect(() =>
          computeTypeSyndrome(code, type, error, new Uint8Array(half + 1)),
        ).toThrow(RangeError);
        expect(() =>
          computeTypeSyndrome(code, type, error, new Uint8Array(total)),
        ).toThrow(RangeError);
        expect(() =>
          computeTypeSyndrome(
            code,
            type,
            identity(code.n + 1),
            new Uint8Array(half),
          ),
        ).toThrow(RangeError);
      }
      expect(() =>
        computeSyndrome(code, error, new Uint8Array(total - 1)),
      ).toThrow(RangeError);
      expect(() =>
        computeSyndrome(code, error, new Uint8Array(total + 1)),
      ).toThrow(RangeError);
      expect(() =>
        computeSyndrome(code, identity(code.n + 1), new Uint8Array(total)),
      ).toThrow(RangeError);
    });
  }
});
