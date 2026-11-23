// The viewer's link (tasks/plans/phase2-g.md D8): `#v=f<d>.<mask>` carries the
// WHOLE history of a shot, never a seed (changing the PRNG can never break a
// link; tests/intent/viewer-conventions pins it). Per cycle r = 1 … d, in the
// order the shot draws them (phase2.md D1): x[0..n), z[0..n), fZ[0..m), fX[0..m),
// so reading the mask is reading the shot; d·(2n + 2m) bits → 13 / 62 / 171 /
// 363 base64url characters for d = 3 / 5 / 7 / 9. `cycles = d` always.

import {
  createSpacetimeHistory,
  DISTANCES,
  rotatedSurfaceCode,
  type Distance,
  type SpacetimeHistory,
} from "../../core";
import { decodeBits, encodeBits, encodedLength } from "../model/bits64";

// Link grammar: `<model letter><d>.<mask>` after the `#v=` hash parameter.
// i18n-exempt: URL hash parameter and model letter of the viewer link grammar
const LINK = { hash: "#v=", model: "f" };
export const VIEWER_HASH_PREFIX = LINK.hash;
const LINK_SHAPE = /^([a-z])([1-9]\d*)\.([A-Za-z0-9_-]+)$/;

/** Bits of a history of distance d with cycles = d: d·(2n + 2m) = d·(3d² − 1). */
export function historyBits(d: number): number {
  const n = d * d;
  const m = (n - 1) / 2;
  return d * (2 * n + 2 * m);
}

/** Mask characters of a viewer link: ceil(historyBits(d) / 6) → 13, 62, 171, 363. */
export function historyMaskLength(d: number): number {
  return encodedLength(historyBits(d));
}

function isDistance(d: number): d is Distance {
  return (DISTANCES as readonly number[]).includes(d);
}

/** `f<d>.<mask>` of a history with cycles = d. RangeError otherwise. */
export function encodeHistory(d: Distance, history: SpacetimeHistory): string {
  if (history.cycles !== d) {
    throw new RangeError(
      `the viewer link needs cycles = d = ${d}, got ${history.cycles}`,
    );
  }
  const n = d * d;
  const m = (n - 1) / 2;
  const bits = new Uint8Array(historyBits(d));
  let i = 0;
  for (let r = 1; r <= d; r++) {
    const e = history.cycleErrors[r - 1]!;
    const f = history.flips[r - 1]!;
    for (let q = 0; q < n; q++) bits[i++] = e.x[q]! & 1;
    for (let q = 0; q < n; q++) bits[i++] = e.z[q]! & 1;
    for (let s = 0; s < m; s++) bits[i++] = f.Z[s]! & 1;
    for (let s = 0; s < m; s++) bits[i++] = f.X[s]! & 1;
  }
  return `${LINK.model}${d}.${encodeBits(bits)}`;
}

/** The history a link text describes, or null unless it parses exactly. */
export function decodeHistory(
  text: string,
): { readonly d: Distance; readonly history: SpacetimeHistory } | null {
  const match = LINK_SHAPE.exec(text);
  if (match === null) return null;
  if (match[1] !== LINK.model) return null;
  const d = Number(match[2]);
  if (!isDistance(d)) return null;
  const bits = decodeBits(match[3]!, historyBits(d));
  if (bits === null) return null;
  const n = d * d;
  const m = (n - 1) / 2;
  const history = createSpacetimeHistory(rotatedSurfaceCode(d), d);
  let i = 0;
  for (let r = 1; r <= d; r++) {
    const e = history.cycleErrors[r - 1]!;
    const f = history.flips[r - 1]!;
    e.x.set(bits.subarray(i, i + n));
    i += n;
    e.z.set(bits.subarray(i, i + n));
    i += n;
    f.Z.set(bits.subarray(i, i + m));
    i += m;
    f.X.set(bits.subarray(i, i + m));
    i += m;
  }
  return { d, history };
}

/** The history of a `#v=…` location hash, or null (no viewer link, or a bad one). */
export function historyFromHash(
  hash: string,
): { readonly d: Distance; readonly history: SpacetimeHistory } | null {
  return hash.startsWith(LINK.hash)
    ? decodeHistory(hash.slice(LINK.hash.length))
    : null;
}

/** Whether a hash claims to be a viewer link (`#v=`), parsable or not. */
export function isViewerLink(hash: string): boolean {
  return hash.startsWith(LINK.hash);
}
