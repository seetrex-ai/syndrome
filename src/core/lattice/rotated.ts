// Rotated surface code of odd distance d (docs/spec.md §3).
//
// Geometry
//   Data qubits sit on the vertices of a d×d grid, (row, col) with row, col ∈ [0, d).
//   row 0 is the top edge on screen, col 0 the left edge. Qubit index q = row·d + col.
//   Stabilizers are the plaquettes of the board extended by one row above and below
//   (i = −1, i = d−1) and one column left and right (j = −1, j = d−1); plaquette (i, j)
//   covers the data qubits (i, j), (i, j+1), (i+1, j), (i+1, j+1) that lie on the board.
//   Colouring: plaquette (i, j) is type Z iff (i + j) is even, X iff odd. Interior
//   plaquettes (i, j ∈ [0, d−2]) have weight 4. On the extended rows only the X-type
//   plaquettes exist (j ∈ [0, d−2]) and on the extended columns only the Z-type ones
//   (i ∈ [0, d−2]): X boundaries top and bottom, Z boundaries left and right. The four
//   corners of the extended board ((−1,−1), (−1,d−1), (d−1,−1), (d−1,d−1)) would cover a
//   single qubit and are excluded; this is the only reading that yields the d²−1
//   stabilizers of §3 (docs/decisiones.md, 2026-10-16).
//   X_L is a full column of X (column 0 here), Z_L a full row of Z (row 0); every column
//   (row) is equivalent modulo stabilizers, see logicalXOnColumn / logicalZOnRow.
//
// Mutability
//   The typed arrays a code exposes (logicalX/logicalZ, each Stabilizer.operator, the
//   CSR tables supportOffsets/supportQubits and checksOfQubit) are shared, read-only
//   tables: a code is built once per distance and cached. They are typed
//   ReadonlyPauli / ReadonlyIntTable (index reads, length, iteration; no fill/set/
//   subarray and not assignable to Uint8Array/Int32Array), so both an index write
//   (`code.logicalZ.z[0] = 0`, TS2542) and handing a table to a mutator
//   (`multiplyInto(code.logicalZ, …)`, `clearPauli(s.operator)`) are compile errors,
//   pinned by @ts-expect-error cases in readonly.test.ts. At runtime the arrays are
//   ordinary typed arrays (Object.freeze does not reach into them): a cast could still
//   write, which is the remaining contract. Consumers that need a Pauli to edit (the UI
//   toggling errors, the simulation) take a copy with copyPauli / identity.
//
// Indexing (public contract, translingual: tools/reference and docs/validacion fixtures
// must use the same numbering; tests/intent/lattice-conventions.test.ts pins it)
//   Global stabilizer index 0 … d²−2: Z block first, X block second. Within a block,
//   row-major sweep of the extended board, i from −1 to d−1, j from −1 to d−1, skipping
//   corners and plaquettes of the other type. `typeIndex` is the position within the
//   block. `qubits` of each stabilizer are in ascending qubit index.
//
// Drawing (grid units, not pixels; the UI scales)
//   qubit (r, c) → (x = c, y = r); plaquette (i, j) → centre (j + 0.5, i + 0.5). SVG's y
//   grows downwards, so row 0 lands on top without inverting anything. A plaquette with
//   `boundary` set is drawn as a half disc or triangle pointing outwards.

import {
  identity,
  type Pauli,
  type ReadonlyNumbers,
  type ReadonlyPauli,
} from "./pauli";

/** Shared integer table of a code: index reads, length and iteration only. */
export type ReadonlyIntTable = ReadonlyNumbers;

export type StabilizerType = "X" | "Z";
export type Boundary = "top" | "bottom" | "left" | "right";

export interface Qubit {
  readonly index: number;
  readonly row: number;
  readonly col: number;
}

export interface Stabilizer {
  /** Global index 0 … d²−2: Z block first, then X block. */
  readonly index: number;
  readonly type: StabilizerType;
  /** Position within its type block, 0 … (d²−1)/2 − 1. */
  readonly typeIndex: number;
  /** Plaquette row i ∈ [−1, d−1]; −1 is the top boundary, d−1 the bottom one. */
  readonly row: number;
  /** Plaquette column j ∈ [−1, d−1]; −1 is the left boundary, d−1 the right one. */
  readonly col: number;
  /** null ⇔ weight 4 (interior plaquette). */
  readonly boundary: Boundary | null;
  /** Data qubit indices, ascending; length 4 or 2. */
  readonly qubits: readonly number[];
  /** The same stabilizer as a full-mask Pauli. */
  readonly operator: ReadonlyPauli;
}

export interface RotatedSurfaceCode {
  readonly d: number;
  /** Number of data qubits, d². */
  readonly n: number;
  readonly qubits: readonly Qubit[];
  readonly stabilizers: readonly Stabilizer[];
  readonly stabilizersByType: Readonly<
    Record<StabilizerType, readonly Stabilizer[]>
  >;
  /** Global index of the first stabilizer of each type: Z → 0, X → (d²−1)/2. */
  readonly typeOffset: Readonly<Record<StabilizerType, number>>;
  /** X on column 0. */
  readonly logicalX: ReadonlyPauli;
  /** Z on row 0. */
  readonly logicalZ: ReadonlyPauli;
  /** CSR by global index: qubits of stabilizer s are supportQubits[supportOffsets[s] … supportOffsets[s+1]). */
  readonly supportOffsets: ReadonlyIntTable;
  readonly supportQubits: ReadonlyIntTable;
  /**
   * For each type, length 2n: entries [2q, 2q+1] are the typeIndex values of the
   * (at most two) stabilizers of that type containing qubit q; −1 marks "none"
   * (the qubit is a boundary edge of the defect graph for that type).
   */
  readonly checksOfQubit: Readonly<Record<StabilizerType, ReadonlyIntTable>>;
}

export function qubitIndex(d: number, row: number, col: number): number {
  return row * d + col;
}

export function qubitRowCol(
  d: number,
  q: number,
): readonly [row: number, col: number] {
  return [Math.floor(q / d), q % d];
}

/** Z iff (i + j) is even. Valid for negative coordinates (−1 is odd). */
export function plaquetteType(i: number, j: number): StabilizerType {
  return ((i + j) & 1) === 0 ? "Z" : "X";
}

function boundaryOf(d: number, i: number, j: number): Boundary | null {
  if (i === -1) return "top";
  if (i === d - 1) return "bottom";
  if (j === -1) return "left";
  if (j === d - 1) return "right";
  return null;
}

function plaquetteExists(d: number, i: number, j: number): boolean {
  const rowEdge = i === -1 || i === d - 1;
  const colEdge = j === -1 || j === d - 1;
  if (rowEdge && colEdge) return false; // corner, would have weight 1
  const type = plaquetteType(i, j);
  if (rowEdge) return type === "X";
  if (colEdge) return type === "Z";
  return true;
}

function plaquetteQubits(d: number, i: number, j: number): number[] {
  const qubits: number[] = [];
  for (const r of [i, i + 1]) {
    if (r < 0 || r >= d) continue;
    for (const c of [j, j + 1]) {
      if (c < 0 || c >= d) continue;
      qubits.push(qubitIndex(d, r, c));
    }
  }
  return qubits; // already ascending: r outer, c inner
}

/** Builds the rotated surface code of distance d. Throws RangeError unless d is an odd integer ≥ 3. */
export function rotatedSurfaceCode(d: number): RotatedSurfaceCode {
  if (!Number.isInteger(d) || d < 3 || d % 2 !== 1) {
    throw new RangeError(`distance must be an odd integer >= 3, got ${d}`);
  }
  const n = d * d;

  const qubits: Qubit[] = [];
  for (let row = 0; row < d; row++) {
    for (let col = 0; col < d; col++) {
      qubits.push(Object.freeze({ index: qubitIndex(d, row, col), row, col }));
    }
  }

  const stabilizers: Stabilizer[] = [];
  const byType: Record<StabilizerType, Stabilizer[]> = { Z: [], X: [] };
  for (const type of ["Z", "X"] as const) {
    for (let i = -1; i <= d - 1; i++) {
      for (let j = -1; j <= d - 1; j++) {
        if (!plaquetteExists(d, i, j) || plaquetteType(i, j) !== type) continue;
        const support = plaquetteQubits(d, i, j);
        const operator = identity(n);
        const mask = type === "X" ? operator.x : operator.z;
        for (const q of support) mask[q] = 1;
        const stabilizer: Stabilizer = Object.freeze({
          index: stabilizers.length,
          type,
          typeIndex: byType[type].length,
          row: i,
          col: j,
          boundary: boundaryOf(d, i, j),
          qubits: Object.freeze(support),
          operator,
        });
        stabilizers.push(stabilizer);
        byType[type].push(stabilizer);
      }
    }
  }
  if (stabilizers.length !== n - 1) {
    throw new Error(
      `geometry bug: ${stabilizers.length} stabilizers, expected ${n - 1}`,
    );
  }
  const typeOffset = Object.freeze({ Z: 0, X: byType.Z.length });

  // CSR tables.
  const supportOffsets = new Int32Array(stabilizers.length + 1);
  let total = 0;
  for (const s of stabilizers) {
    total += s.qubits.length;
    supportOffsets[s.index + 1] = total;
  }
  const supportQubits = new Int32Array(total);
  for (const s of stabilizers) {
    let k = supportOffsets[s.index]!;
    for (const q of s.qubits) supportQubits[k++] = q;
  }

  // Edge list of the defect graph per type: the ≤ 2 stabilizers of that type on each qubit.
  const checksOfQubit = {
    Z: new Int32Array(2 * n).fill(-1),
    X: new Int32Array(2 * n).fill(-1),
  };
  for (const type of ["Z", "X"] as const) {
    const table = checksOfQubit[type];
    for (const s of byType[type]) {
      for (const q of s.qubits) {
        if (table[2 * q] === -1) table[2 * q] = s.typeIndex;
        else if (table[2 * q + 1] === -1) table[2 * q + 1] = s.typeIndex;
        else
          throw new Error(
            `geometry bug: qubit ${q} in more than two ${type} stabilizers`,
          );
      }
    }
  }

  // Built as editable Paulis, exposed as ReadonlyPauli.
  const logicalX = identity(n);
  const logicalZ = identity(n);
  for (let r = 0; r < d; r++) logicalX.x[qubitIndex(d, r, 0)] = 1;
  for (let c = 0; c < d; c++) logicalZ.z[qubitIndex(d, 0, c)] = 1;
  const code: RotatedSurfaceCode = {
    d,
    n,
    qubits: Object.freeze(qubits),
    stabilizers: Object.freeze(stabilizers),
    stabilizersByType: Object.freeze({
      Z: Object.freeze(byType.Z),
      X: Object.freeze(byType.X),
    }),
    typeOffset,
    logicalX,
    logicalZ,
    supportOffsets,
    supportQubits,
    checksOfQubit: Object.freeze(checksOfQubit),
  };
  return Object.freeze(code);
}

/** X on every qubit of column `col`: a representative of X_L (all columns are equivalent modulo stabilizers). */
export function logicalXOnColumn(code: RotatedSurfaceCode, col: number): Pauli {
  checkCoordinate(code.d, col);
  const p = identity(code.n);
  for (let r = 0; r < code.d; r++) p.x[qubitIndex(code.d, r, col)] = 1;
  return p;
}

/** Z on every qubit of row `row`: a representative of Z_L (all rows are equivalent modulo stabilizers). */
export function logicalZOnRow(code: RotatedSurfaceCode, row: number): Pauli {
  checkCoordinate(code.d, row);
  const p = identity(code.n);
  for (let c = 0; c < code.d; c++) p.z[qubitIndex(code.d, row, c)] = 1;
  return p;
}

function checkCoordinate(d: number, v: number): void {
  if (!Number.isInteger(v) || v < 0 || v >= d) {
    throw new RangeError(`coordinate ${v} out of range [0, ${d})`);
  }
}

/**
 * The typeIndex values of the stabilizers of `type` containing qubit q, as the
 * edge of the defect graph that an error on q represents: [a, b] with b = −1 (or
 * both −1, never for this code) when the edge goes to the boundary.
 */
export function incidentStabilizers(
  code: RotatedSurfaceCode,
  type: StabilizerType,
  q: number,
): readonly [number, number] {
  if (!Number.isInteger(q) || q < 0 || q >= code.n) {
    throw new RangeError(`qubit ${q} out of range [0, ${code.n})`);
  }
  const table = code.checksOfQubit[type];
  return [table[2 * q]!, table[2 * q + 1]!];
}
