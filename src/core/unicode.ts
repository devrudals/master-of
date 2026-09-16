/**
 * Unicode normalization and safe string utilities.
 * Crucial for macOS where HFS+/APFS decomposes Hangul into NFD form.
 */

export function normalizeNFC(input: string | null | undefined): string {
  if (!input) return "";
  return input.normalize("NFC");
}

export function safeIncludes(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  const normHaystack = normalizeNFC(haystack).toLowerCase();
  const normNeedle = normalizeNFC(needle).toLowerCase().trim();
  return normHaystack.includes(normNeedle);
}

/**
 * Character-based token estimation.
 * Hangul / CJK: ~1.5 chars per token
 * ASCII: ~4 chars per token
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const normalized = normalizeNFC(text);
  let cjkCount = 0;
  let asciiCount = 0;

  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    // Hangul syllables (AC00-D7AF), Hangul Jamo (1100-11FF), CJK Unified Ideographs (4E00-9FFF)
    if ((code >= 0xac00 && code <= 0xd7af) || (code >= 0x1100 && code <= 0x11ff) || (code >= 0x4e00 && code <= 0x9fff)) {
      cjkCount++;
    } else {
      asciiCount++;
    }
  }

  return Math.round(cjkCount / 1.5 + asciiCount / 4);
}
