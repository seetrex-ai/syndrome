// A challenge puzzle and its link (tasks/plans/phase2.md D11, docs/spec.md §4.6).
// The link carries the error mask itself, never a seed: `2·d²` bits (the X
// components of every qubit in index order, then the Z components), most
// significant bit first, in base64url without padding. Changing the PRNG can
// never break a link, and tests/intent/challenge-conventions pins it.

import {
  computeSyndrome,
  copyPauli,
  createRng,
  DISTANCES,
  identity,
  independentNoise,
  rotatedSurfaceCode,
  sampleNoise,
  type Distance,
  type ReadonlyPauli,
  type RotatedSurfaceCode,
} from "../../core";
import { decodeBits, encodeBits, encodedLength } from "../model/bits64";

/** Noise model the puzzle was drawn from; phase 2 adds no other to the challenge. */
export type PuzzleModel = "independent";
// i18n-exempt: noise model tag of the link (a single-literal alias keeps no alias symbol for TAG_TYPES)
const MODEL: PuzzleModel = "independent";

export interface Puzzle {
  readonly d: Distance;
  readonly model: PuzzleModel;
  readonly error: ReadonlyPauli;
}

// Link grammar: `<model letter><d>.<mask>` after the `#c=` hash parameter.
// i18n-exempt: URL hash parameter and model letter of the link grammar
const LINK = { hash: "#c=", model: "i" };
export const HASH_PREFIX = LINK.hash;
const LINK_SHAPE = /^([a-z])([1-9]\d*)\.([A-Za-z0-9_-]+)$/;

/** Mask characters of a link of distance d: ceil(2d²/6) → 3, 9, 17, 27. */
export function maskLength(d: number): number {
  return encodedLength(2 * d * d);
}

function isDistance(d: number): d is Distance {
  return (DISTANCES as readonly number[]).includes(d);
}

export function encodePuzzle(puzzle: Puzzle): string {
  const { d, error } = puzzle;
  const n = d * d;
  const bits = new Uint8Array(2 * n);
  for (let q = 0; q < n; q++) {
    bits[q] = error.x[q]! & 1;
    bits[n + q] = error.z[q]! & 1;
  }
  return `${LINK.model}${d}.${encodeBits(bits)}`;
}

/**
 * The puzzle a link text describes, or null unless it parses exactly (no
 * padding, no spare bit set) AND its error leaves at least one defect: an
 * empty board, a stabilizer or a bare logical operator is no puzzle (nothing
 * to correct, or nothing that could be).
 */
export function decodePuzzle(text: string): Puzzle | null {
  const match = LINK_SHAPE.exec(text);
  if (match === null) return null;
  const letter = match[1]!;
  const digits = match[2]!;
  const mask = match[3]!;
  if (letter !== LINK.model) return null;
  const d = Number(digits);
  if (!isDistance(d)) return null;
  const n = d * d;
  const bits = decodeBits(mask, 2 * n);
  if (bits === null) return null;
  const error = identity(n);
  error.x.set(bits.subarray(0, n));
  error.z.set(bits.subarray(n));
  return hasDefect(rotatedSurfaceCode(d), error) ? freeze(d, error) : null;
}

function hasDefect(code: RotatedSurfaceCode, error: ReadonlyPauli): boolean {
  const syndrome = computeSyndrome(
    code,
    error,
    new Uint8Array(code.stabilizers.length),
  );
  return syndrome.some((bit) => bit === 1);
}

/** The puzzle of a `#c=…` location hash, or null (no link, or a bad one). */
export function puzzleFromHash(hash: string): Puzzle | null {
  return hash.startsWith(HASH_PREFIX)
    ? decodePuzzle(hash.slice(HASH_PREFIX.length))
    : null;
}

/** Seeds drawn at most before an error with no defects is returned anyway. */
export const MAX_DRAWS = 32;

/**
 * A random puzzle of distance d with independent X/Z noise at probability p:
 * seeds from `nextSeed` are drawn until the error has at least one defect (an
 * empty board is no puzzle; a stabilizer, rare, is none either), at most
 * MAX_DRAWS times. With p = 0 the empty error is the honest answer.
 */
export function drawPuzzle(
  d: Distance,
  p: number,
  nextSeed: () => number,
): Puzzle {
  const code = rotatedSurfaceCode(d);
  const noise = independentNoise(p);
  const error = identity(code.n);
  for (let draws = 0; draws < MAX_DRAWS; draws++) {
    sampleNoise(noise, createRng(nextSeed()), error);
    if (hasDefect(code, error)) break;
  }
  return freeze(d, error);
}

function freeze(d: Distance, error: ReadonlyPauli): Puzzle {
  const puzzle: Puzzle = {
    d,
    model: MODEL,
    error: Object.freeze(copyPauli(error)),
  };
  return Object.freeze(puzzle);
}
