import { describe, it, expect, beforeEach } from "bun:test";
import { join } from "path";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { ConfigManager } from "../src/core/config.ts";
import { RegistryManager } from "../src/core/registry.ts";
import { HealthChecker } from "../src/core/health.ts";
import { SANDBOX } from "./helpers.ts";

describe("HealthChecker MCP diagnostics", () => {
  const home = join(SANDBOX, "masterof-home-health");
  const claudeDir = join(home, "fake-claude");
  const claudeJson = join(home, ".claude.json");

  const makeChecker = (claudeJsonContent: object) => {
    writeFileSync(claudeJson, JSON.stringify(claudeJsonContent), "utf8");
    const config = new ConfigManager({
      dataDir: join(home, "data"),
      sandboxRoot: SANDBOX,
      claudeDir,
    });
    return new HealthChecker(config, new RegistryManager(config));
  };

  beforeEach(() => {
    if (existsSync(home)) rmSync(home, { recursive: true, force: true });
    mkdirSync(claudeDir, { recursive: true });
  });

  it("flags an MCP server whose binary does not exist", () => {
    const checker = makeChecker({
      mcpServers: { ghost: { command: "/definitely/not/installed/ghost-mcp" } },
    });

    const dead = checker.checkAll().filter((i) => i.kind === "dead_mcp");
    expect(dead.length).toBe(1);
    expect(dead[0].severity).toBe("critical");
    expect(dead[0].subject).toBe("MCP ghost");
  });

  it("flags the same server defined in two scopes", () => {
    const checker = makeChecker({
      mcpServers: { shared: { command: "bun" } },
      projects: { "/some/project": { mcpServers: { shared: { command: "bun" } } } },
    });

    const dup = checker.checkAll().filter((i) => i.kind === "dead_mcp" && i.severity === "warning");
    expect(dup.length).toBe(1);
    expect(dup[0].subject).toBe("MCP shared");
  });

  it("does not judge commands it cannot resolve (env placeholders)", () => {
    const checker = makeChecker({
      mcpServers: {
        templated: { command: "${HOME}/bin/thing" },
        substituted: { command: "$(which node)" },
        onPath: { command: "bun" },
      },
    });

    expect(checker.checkAll().filter((i) => i.kind === "dead_mcp")).toEqual([]);
  });

  it("sorts critical issues ahead of warnings", () => {
    const checker = makeChecker({
      mcpServers: { shared: { command: "bun" }, ghost: { command: "/nope/ghost" } },
      projects: { "/p": { mcpServers: { shared: { command: "bun" } } } },
    });

    const issues = checker.checkAll();
    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(issues[0].severity).toBe("critical");
  });

  it("reports a registry component whose file is gone", () => {
    const checker = makeChecker({ mcpServers: {} });
    const config = new ConfigManager({ dataDir: join(home, "data"), sandboxRoot: SANDBOX, claudeDir });
    const registry = new RegistryManager(config);
    registry.addComponent({
      name: "vanished",
      type: "skill",
      category: "dev",
      description: "points at nothing",
      path_anchor: "sandbox",
      rel_path: "no/such/place/SKILL.md",
    });

    const issues = new HealthChecker(config, registry).checkAll();
    expect(issues.some((i) => i.kind === "missing_file" && i.subject === "vanished")).toBe(true);
  });
});

describe("HealthChecker scope handling", () => {
  const home = join(SANDBOX, "masterof-home-health-scope");
  const claudeDir = join(home, "fake-claude");
  const claudeJson = join(home, ".claude.json");

  beforeEach(() => {
    if (existsSync(home)) rmSync(home, { recursive: true, force: true });
    mkdirSync(claudeDir, { recursive: true });
  });

  const setup = (claudeJsonContent: object) => {
    writeFileSync(claudeJson, JSON.stringify(claudeJsonContent), "utf8");
    const config = new ConfigManager({ dataDir: join(home, "data"), sandboxRoot: SANDBOX, claudeDir });
    const registry = new RegistryManager(config);
    return { config, registry };
  };

  it("does not flag the same server name in two different projects", () => {
    const { config, registry } = setup({
      projects: {
        "/proj-a": { mcpServers: { local: { command: "bun" } } },
        "/proj-b": { mcpServers: { local: { command: "bun" } } },
      },
    });
    const dup = new HealthChecker(config, registry).checkAll().filter((i) => i.kind === "dead_mcp");
    expect(dup).toEqual([]);
  });

  it("accepts a critical dependency configured only at project scope", () => {
    const { config, registry } = setup({
      projects: { "/proj": { mcpServers: { figma: { command: "bun" } } } },
    });
    mkdirSync(join(claudeDir, "skills", "figma-skill"), { recursive: true });
    writeFileSync(join(claudeDir, "skills", "figma-skill", "SKILL.md"), "# x");
    registry.addComponent({
      name: "figma-skill",
      type: "skill",
      category: "design",
      description: "needs figma",
      path_anchor: "claude",
      rel_path: "skills/figma-skill/SKILL.md",
      dependencies: { mcp_server: "figma", critical: true },
    });

    const issues = new HealthChecker(config, registry).checkAll();
    expect(issues.filter((i) => i.kind === "disabled_dependency")).toEqual([]);
  });
});
