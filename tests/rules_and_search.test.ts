import { describe, it, expect, beforeEach } from "bun:test";
import { join } from "path";
import { existsSync, rmSync } from "fs";
import { ConfigManager } from "../src/core/config.ts";
import { RegistryManager } from "../src/core/registry.ts";
import { GateReporter } from "../src/core/reporter.ts";
import { RuleGenerator } from "../src/adapters/rules/generator.ts";
import { UniversalMcpServer } from "../src/adapters/mcp/server.ts";
import { searchComponents } from "../src/core/search.ts";
import { SANDBOX } from "./helpers.ts";

const testDataDir = join(SANDBOX, "masterof-home-rules");

function freshSetup() {
  const config = new ConfigManager({ dataDir: testDataDir, sandboxRoot: SANDBOX });
  const registry = new RegistryManager(config);
  return { config, registry };
}

describe("RuleGenerator (Cursor / Windsurf / AGENTS.md adapter)", () => {
  beforeEach(() => {
    if (existsSync(testDataDir)) rmSync(testDataDir, { recursive: true, force: true });
  });

  it("lists every gate in AGENTS.md with activation instructions", () => {
    const { config, registry } = freshSetup();
    const md = new RuleGenerator(config, registry).generateAgentsMd();

    for (const gate of ["design", "dev", "research", "stock", "planning", "pipelines"]) {
      expect(md).toContain(`\`/${gate}\``);
    }
    expect(md).toContain("mo_open_gate");
    expect(md).toContain("mo_get_skill");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("emits an MCP snippet that is valid JSON pointing at this data dir", () => {
    const { config, registry } = freshSetup();
    const snippet = new RuleGenerator(config, registry).generateMcpSnippet();

    const parsed = JSON.parse(snippet);
    expect(parsed.mcpServers["master-of"].command).toBe("bun");
    expect(parsed.mcpServers["master-of"].args).toContain("mcp");
    const binArg = parsed.mcpServers["master-of"].args[1];
    expect(require("path").isAbsolute(binArg)).toBe(true);
    expect(existsSync(binArg)).toBe(true);
    expect(parsed.mcpServers["master-of"].args).toContain(config.getPaths().masterOfHome);
  });

  it("honors an alternate runtime", () => {
    const { config, registry } = freshSetup();
    const parsed = JSON.parse(new RuleGenerator(config, registry).generateMcpSnippet("node"));
    expect(parsed.mcpServers["master-of"].command).toBe("node");
  });
});

describe("Search parity between CLI and MCP surfaces", () => {
  beforeEach(() => {
    if (existsSync(testDataDir)) rmSync(testDataDir, { recursive: true, force: true });
  });

  it("matches on cluster and English description from both surfaces", () => {
    const { config, registry } = freshSetup();
    registry.addComponent({
      name: "phase-runner",
      type: "skill",
      category: "planning",
      description: "",
      description_en: "Runs a delivery phase",
      cluster: "milestone-tools",
      path_anchor: "sandbox",
      rel_path: "mock-claude/skills/sprint-planner/SKILL.md",
    });
    new GateReporter(config, registry).renderAll();
    const server = new UniversalMcpServer(config, registry);

    for (const query of ["milestone-tools", "delivery phase"]) {
      const direct = searchComponents(registry.getRegistry(), query).map((c) => c.name);
      const viaMcp = JSON.parse(server.executeTool("mo_search", { query }).content[0].text).map((c: any) => c.name);
      expect(direct).toEqual(["phase-runner"]);
      expect(viaMcp).toEqual(direct);
    }
  });

  it("respects the category filter", () => {
    const { config, registry } = freshSetup();
    registry.addComponents([
      { name: "ui-thing", type: "skill", category: "design", description: "shared keyword", path_anchor: "sandbox", rel_path: "a/SKILL.md" },
      { name: "dev-thing", type: "skill", category: "dev", description: "shared keyword", path_anchor: "sandbox", rel_path: "b/SKILL.md" },
    ]);

    const all = searchComponents(registry.getRegistry(), "shared keyword");
    const designOnly = searchComponents(registry.getRegistry(), "shared keyword", "Design");

    expect(all.length).toBe(2);
    expect(designOnly.map((c) => c.name)).toEqual(["ui-thing"]);
  });
});
