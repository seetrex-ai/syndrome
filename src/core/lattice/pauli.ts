// Pauli group on n qubits, modulo global phases.
//
// An operator is stored as two byte masks: x[q] = 1 iff it has an X component on
// qubit q, z[q] = 1 iff it has a Z component. Y is x[q] = z[q] = 1. Phases are
// ignored on purpose (XZ = -iY, but the product is only tracked modulo ±1, ±i):
// commutation, syndromes and logical verdicts never depend on them, and nothing
// in this core needs the phase. Products are therefore XOR of masks.
//
// Representation chosen over bigint masks, Sets or bit-packed words because the
// syndrome loop reads individual qubits (each stabilizer touches 2–4 of them) and
// a byte read is the cheapest access; see tasks/plans/lattice.md D1.
//
// Two views of the same shape: `Pauli` is editable (the UI toggling errors, the
// simulation reusing a buffer); `ReadonlyPauli` is what every reader accepts and
// what the code's shared tables (logical operators, stabilizer operators) expose,
// so that `code.logicalZ.z[0] = 0` is a type error (TS2542) and not a silent
// corruption of every verdict for that distance. The read-only masks are NOT
// `Readonly<Uint8Array>`: TypeScript ignores `readonly` for assignability, so that
// type would still flow into `multiplyInto(out: Pauli, …)` or `clearPauli`. They
// are a structural view with index reads, `length` and iteration only; without
// `fill`/`set`/`subarray` it is not assignable to `Uint8Array`, and a shared table
// cannot be handed to any mutator (pinned in readonly.test.ts).

/** Read-only view of a numeric array: index reads, length and iteration, nothing else. */
export interface ReadonlyNumbers extends Iterable<number> {
  readonly [index: number]: number;
  readonly length: number;
}

export type ReadonlyMask = ReadonlyNumbers;

export interface ReadonlyPauli {
  readonly n: number;
  /** x[q] = 1 ⇔ X component on qubit q (X or Y). */
  readonly x: ReadonlyMask;
  /** z[q] = 1 ⇔ Z component on qubit q (Z or Y). */
  readonly z: ReadonlyMask;
}

export interface Pauli extends ReadonlyPauli {
  readonly x: Uint8Array;
  readonly z: Uint8Array;
}

/** Identity on n qubits. */
export function identity(n: number): Pauli {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`Pauli size must be a non-negative integer, got ${n}`);
  }
  return { n, x: new Uint8Array(n), z: new Uint8Array(n) };
}

/**
 * Pauli with X components on xQubits and Z components on zQubits (Y where both).
 * Set semantics: a repeated qubit index is the same as listing it once.
 */
export function pauliFrom(
  n: number,
  xQubits: Iterable<number>,
  zQubits: Iterable<number>,
): Pauli {
  const p = identity(n);
  for (const q of xQubits) {
    checkQubit(n, q);
    p.x[q] = 1;
  }
  for (const q of zQubits) {
    checkQubit(n, q);
    p.z[q] = 1;
  }
  return p;
}

function checkQubit(n: number, q: number): void {
  if (!Number.isInteger(q) || q < 0 || q >= n) {
    throw new RangeError(`qubit ${q} out of range [0, ${n})`);
  }
}

/** Editable copy (fresh masks). */
export function copyPauli(p: ReadonlyPauli): Pauli {
  return { n: p.n, x: Uint8Array.from(p.x), z: Uint8Array.from(p.z) };
}

/** Sets p to the identity in place. */
export function clearPauli(p: Pauli): void {
  p.x.fill(0);
  p.z.fill(0);
}

/**
 * out = a·b modulo phase (XOR of both masks). `out` may alias `a` or `b`.
 * Returns `out`. No allocation.
 */
export function multiplyInto(
  out: Pauli,
  a: ReadonlyPauli,
  b: ReadonlyPauli,
): Pauli {
  const n = out.n;
  if (a.n !== n || b.n !== n) {
    throw new RangeError(`Pauli sizes differ: ${out.n}, ${a.n}, ${b.n}`);
  }
  const ox = out.x;
  const oz = out.z;
  const ax = a.x;
  const az = a.z;
  const bx = b.x;
  const bz = b.z;
  for (let q = 0; q < n; q++) {
    ox[q] = (ax[q]! ^ bx[q]!) as number;
    oz[q] = (az[q]! ^ bz[q]!) as number;
  }
  return out;
}

/**
 * True iff a and b commute: the symplectic product
 * Σ_q (a.x[q]·b.z[q] + a.z[q]·b.x[q]) is even.
 */
export function commutes(a: ReadonlyPauli, b: ReadonlyPauli): boolean {
  const n = a.n;
  if (b.n !== n) {
    throw new RangeError(`Pauli sizes differ: ${a.n}, ${b.n}`);
  }
  const ax = a.x;
  const az = a.z;
  const bx = b.x;
  const bz = b.z;
  let parity = 0;
  for (let q = 0; q < n; q++) {
    parity ^= (ax[q]! & bz[q]!) ^ (az[q]! & bx[q]!);
  }
  return parity === 0;
}

/** Number of qubits on which p is not the identity. */
export function weight(p: ReadonlyPauli): number {
  const n = p.n;
  const x = p.x;
  const z = p.z;
  let w = 0;
  for (let q = 0; q < n; q++) {
    w += x[q]! | z[q]!;
  }
  return w;
}

export function pauliEquals(a: ReadonlyPauli, b: ReadonlyPauli): boolean {
  if (a.n !== b.n) {
    return false;
  }
  const n = a.n;
  for (let q = 0; q < n; q++) {
    if (a.x[q] !== b.x[q] || a.z[q] !== b.z[q]) {
      return false;
    }
  }
  return true;
}
