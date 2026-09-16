import { describe, it, expect, beforeEach } from "bun:test";
import { join } from "path";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { resolveGateFile } from "../src/core/gates.ts";
import { ConfigManager } from "../src/core/config.ts";
import { RegistryManager } from "../src/core/registry.ts";
import { GateReporter } from "../src/core/reporter.ts";
import { UniversalMcpServer } from "../src/adapters/mcp/server.ts";
import { SANDBOX } from "./helpers.ts";

describe("Gate path resolution rejects untrusted names", () => {
  const gatesDir = join(SANDBOX, "masterof-home-gates", "gates");

  it("resolves a plain gate name inside gatesDir", () => {
    const resolved = resolveGateFile(gatesDir, "design");
    expect(resolved).toBe(join(gatesDir, "claude", "design.txt"));
    expect(resolveGateFile(gatesDir, "design", "gemini")).toBe(join(gatesDir, "gemini", "design.txt"));
  });

  it("rejects parent traversal, absolute paths and separators", () => {
    expect(resolveGateFile(gatesDir, "../../report")).toBeNull();
    expect(resolveGateFile(gatesDir, "../../../../../etc/passwd")).toBeNull();
    expect(resolveGateFile(gatesDir, "/etc/passwd")).toBeNull();
    expect(resolveGateFile(gatesDir, "design/../../secret")).toBeNull();
    expect(resolveGateFile(gatesDir, "..")).toBeNull();
    expect(resolveGateFile(gatesDir, "")).toBeNull();
    expect(resolveGateFile(gatesDir, "design", "../claude")).toBeNull();
  });
});

describe("mo_open_gate refuses to read outside the gates directory", () => {
  const testDataDir = join(SANDBOX, "masterof-home-traversal");
  const secretFile = join(SANDBOX, "masterof-home-traversal-secret.txt");

  beforeEach(() => {
    if (existsSync(testDataDir)) rmSync(testDataDir, { recursive: true, force: true });
    mkdirSync(SANDBOX, { recursive: true });
    writeFileSync(secretFile, "TOP SECRET CONTENTS\n", "utf8");
  });

  it("returns an error instead of a file reached via ../", () => {
    const config = new ConfigManager({ dataDir: testDataDir, sandboxRoot: SANDBOX });
    const regManager = new RegistryManager(config);
    new GateReporter(config, regManager).renderAll();
    const server = new UniversalMcpServer(config, regManager);

    // gatesDir is <testDataDir>/gates, so this escapes to the sibling secret file.
    const result = server.executeTool("mo_open_gate", { gate: "../../../masterof-home-traversal-secret" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain("TOP SECRET");
  });
});
