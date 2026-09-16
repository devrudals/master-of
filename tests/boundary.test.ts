import { describe, it, expect } from "bun:test";
import { join } from "path";
import { assertWithinSandbox, SecurityBoundaryViolation, isPathSafe } from "../src/core/boundary.ts";
import { SANDBOX } from "./helpers.ts";

describe("Security Boundary Guard (Jail Guard)", () => {
  const sandbox = SANDBOX;

  it("allows paths strictly inside sandbox", () => {
    const validPath = join(sandbox, "masterof-home", "registry.json");
    expect(() => assertWithinSandbox(validPath, sandbox)).not.toThrow();
  });

  it("throws SecurityBoundaryViolation when lexical path escapes sandbox", () => {
    const escapePath = "/Users/dlrudals/.claude/masterof/registry.json";
    expect(() => assertWithinSandbox(escapePath, sandbox)).toThrow(SecurityBoundaryViolation);
  });

  it("throws SecurityBoundaryViolation on parent traversal attempts (../)", () => {
    const traversalPath = join(sandbox, "..", "..", ".claude");
    expect(() => assertWithinSandbox(traversalPath, sandbox)).toThrow(SecurityBoundaryViolation);
  });

  it("isPathSafe correctly validates allowed roots", () => {
    expect(isPathSafe(join(sandbox, "file.txt"), [sandbox])).toBe(true);
    expect(isPathSafe("/etc/passwd", [sandbox])).toBe(false);
  });

  it("rejects a sibling directory that merely shares the boundary's name prefix", () => {
    const sibling = `${sandbox}-evil`;
    expect(() => assertWithinSandbox(join(sibling, "registry.json"), sandbox)).toThrow(SecurityBoundaryViolation);
    expect(isPathSafe(join(sibling, "registry.json"), [sandbox])).toBe(false);
  });

  it("treats the boundary itself as inside the boundary", () => {
    expect(() => assertWithinSandbox(sandbox, sandbox)).not.toThrow();
    expect(isPathSafe(sandbox, [sandbox])).toBe(true);
  });
});
