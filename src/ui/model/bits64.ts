// Bit masks in base64url (RFC 4648 §5), most significant bit first, without
// padding: the codec of the challenge link (challenge/puzzle.ts, 2·d² error
// bits) and of the viewer link (spacetime/link.ts, the whole history of a
// shot). Decoding is exact: the text must have ceil(count / 6) characters, all
// in the alphabet, and every spare bit of the last character must be zero.

// prettier-ignore
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"; // i18n-exempt: base64url alphabet (RFC 4648 §5)

/** Characters needed for `count` bits: ceil(count / 6). */
export function encodedLength(count: number): number {
  return Math.ceil(count / 6);
}

/** `bits` (0/1 bytes) as base64url text, MSB first, no padding. */
export function encodeBits(bits: Uint8Array): string {
  const count = bits.length;
  let out = "";
  for (let i = 0; i < count; i += 6) {
    let sextet = 0;
    for (let k = 0; k < 6; k++) {
      sextet = (sextet << 1) | (i + k < count ? bits[i + k]! & 1 : 0);
    }
    out += ALPHABET[sextet]!;
  }
  return out;
}

/**
 * The `count` bits of `text`, or null unless it parses exactly: length
 * ceil(count / 6), every character in the alphabet, spare bits zero.
 */
export function decodeBits(text: string, count: number): Uint8Array | null {
  if (text.length !== encodedLength(count)) return null;
  const bits = new Uint8Array(count);
  for (let c = 0; c < text.length; c++) {
    const sextet = ALPHABET.indexOf(text[c]!);
    if (sextet < 0) return null;
    for (let k = 0; k < 6; k++) {
      const i = 6 * c + k;
      const value = (sextet >> (5 - k)) & 1;
      if (i >= count) {
        if (value !== 0) return null;
      } else {
        bits[i] = value;
      }
    }
  }
  return bits;
}
