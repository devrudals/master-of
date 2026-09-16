import { describe, it, expect } from "bun:test";
import { normalizeNFC, safeIncludes, estimateTokens } from "../src/core/unicode.ts";

describe("Unicode and Safe Search Utilities", () => {
  it("normalizes macOS decomposed NFD Hangul into NFC", () => {
    // '디자인' in NFD (decomposed)
    const nfd = "디자인".normalize("NFD");
    expect(nfd.length).toBeGreaterThan(3); // Decomposed into jamo

    const normalized = normalizeNFC(nfd);
    expect(normalized).toBe("디자인");
    expect(normalized.length).toBe(3);
  });

  it("safely matches strings across NFD and NFC encodings", () => {
    const textNFD = "이 화면의 디자인을 다듬어줘".normalize("NFD");
    const queryNFC = "디자인".normalize("NFC");

    expect(safeIncludes(textNFD, queryNFC)).toBe(true);
  });

  it("handles ReDoS special characters safely without crashing", () => {
    const text = "regex (test) [abc] *+? {1,2}";
    expect(safeIncludes(text, "(test)")).toBe(true);
    expect(safeIncludes(text, "*+?")).toBe(true);
  });

  it("accurately estimates tokens for Hangul and ASCII", () => {
    const asciiText = "Hello world this is a test"; // 26 chars / 4 ≈ 6.5 -> 7
    expect(estimateTokens(asciiText)).toBeGreaterThan(4);

    const hangulText = "안녕하세요 세계"; // 8 Hangul chars / 1.5 ≈ 5.3
    expect(estimateTokens(hangulText)).toBeGreaterThan(3);
  });
});
