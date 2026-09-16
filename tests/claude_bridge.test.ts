import { describe, it, expect, beforeEach } from "bun:test";
import { resolve, join } from "path";
import { existsSync, rmSync } from "fs";
import { ConfigManager } from "../src/core/config.ts";
import { RegistryManager } from "../src/core/registry.ts";
import { GateReporter } from "../src/core/reporter.ts";
import { ClaudeBridge } from "../src/adapters/claude/bridge.ts";
import { SANDBOX } from "./helpers.ts";

describe("ClaudeBridge Adapter Tests", () => {
  const sandbox = SANDBOX;
  const testDataDir = join(sandbox, "masterof-home-claude-test");
  const destClaudeDir = join(sandbox, "mock-claude-synced");

  beforeEach(() => {
    if (existsSync(testDataDir)) rmSync(testDataDir, { recursive: true, force: true });
    if (existsSync(destClaudeDir)) rmSync(destClaudeDir, { recursive: true, force: true });
  });

  it("syncs pre-rendered gates and reports to target claude masterof directory", () => {
    const config = new ConfigManager({
      dataDir: testDataDir,
      sandboxRoot: sandbox,
    });
    const regManager = new RegistryManager(config);
    const reporter = new GateReporter(config, regManager);
    reporter.renderAll();

    const bridge = new ClaudeBridge(config, regManager, reporter);
    const result = bridge.syncToClaude(destClaudeDir);

    expect(result.syncedFiles.length).toBeGreaterThan(0);
    expect(existsSync(join(destClaudeDir, "gates", "design.txt"))).toBe(true);
    expect(existsSync(join(destClaudeDir, "report-brief.txt"))).toBe(true);
  });
});
