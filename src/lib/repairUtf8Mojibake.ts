/**
 * Repairs text that was decoded as Latin-1 before its UTF-8 bytes reached us.
 * Some public catalog endpoints return this form for CJK metadata. The
 * conversion is deliberately conservative: legitimate characters outside
 * the Latin-1 byte range are left alone, and invalid UTF-8 is not rewritten.
 */
export function repairUtf8Mojibake(value: string): string {
  let current = value;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const codePoints = Array.from(current);
    if (codePoints.some((character) => character.codePointAt(0)! > 0xff)) return current;

    const bytes = Uint8Array.from(codePoints, (character) => character.codePointAt(0)!);
    let repaired: string;
    try {
      repaired = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return current;
    }

    if (repaired === current) return current;
    current = repaired;
  }

  return current;
}
