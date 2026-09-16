import { describe, it, expect, beforeEach } from "bun:test";
import { resolve, join } from "path";
import { existsSync, rmSync } from "fs";
import { ConfigManager } from "../src/core/config.ts";
import { RegistryManager } from "../src/core/registry.ts";
import { GateReporter } from "../src/core/reporter.ts";
import { UniversalMcpServer } from "../src/adapters/mcp/server.ts";
import { SANDBOX } from "./helpers.ts";

describe("Universal MCP Server Protocol Tests", () => {
  const sandbox = SANDBOX;
  const testDataDir = join(sandbox, "masterof-home-mcp");

  beforeEach(() => {
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it("handles tools/list and tools/call correctly", () => {
    const config = new ConfigManager({
      dataDir: testDataDir,
      sandboxRoot: sandbox,
    });
    const regManager = new RegistryManager(config);

    regManager.addComponent({
      name: "test-ui-skill",
      type: "skill",
      category: "design",
      description: "Test UI Design Skill for MCP verification",
      path_anchor: "sandbox",
      rel_path: "mock-claude/skills/better-ui/SKILL.md",
    });

    const reporter = new GateReporter(config, regManager);
    reporter.renderAll();

    const mcpServer = new UniversalMcpServer(config, regManager);

    // 1. Test executeTool: mo_list_gates
    const listRes = mcpServer.executeTool("mo_list_gates", {});
    expect(listRes.content).toBeDefined();
    const gatesJson = JSON.parse(listRes.content[0].text);
    expect(gatesJson.length).toBe(6);
    const designGate = gatesJson.find((g: any) => g.gate === "design");
    expect(designGate).toBeDefined();
    expect(designGate.items).toBe(1);

    // 2. Test executeTool: mo_open_gate
    const openRes = mcpServer.executeTool("mo_open_gate", { gate: "design" });
    expect(openRes.content[0].text).toContain("test-ui-skill");

    // 3. Test executeTool: mo_search
    const searchRes = mcpServer.executeTool("mo_search", { query: "Design" });
    const searchMatches = JSON.parse(searchRes.content[0].text);
    expect(searchMatches.length).toBe(1);
    expect(searchMatches[0].name).toBe("test-ui-skill");

    // 4. Test executeTool: mo_get_skill
    const getRes = mcpServer.executeTool("mo_get_skill", { skill_name: "test-ui-skill" });
    expect(getRes.content[0].text).toContain("Better UI Skill");
    expect(getRes.content[0].text).toContain(`Base directory: ${join(sandbox, "mock-claude", "skills", "better-ui")}\n`);
  });
});
