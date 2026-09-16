import { describe, it, expect, beforeEach } from "bun:test";
import { join } from "path";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { ConfigManager } from "../src/core/config.ts";
import { RegistryManager } from "../src/core/registry.ts";
import { HealthChecker } from "../src/core/health.ts";
import { clipDescription, GATE_DESCRIPTION_MAX } from "../src/core/reporter.ts";
import { ClaudePluginIndex } from "../src/adapters/claude/plugins.ts";
import { SANDBOX } from "./helpers.ts";

const home = join(SANDBOX, "masterof-home-plugins");
const claudeDir = join(home, "claude");

function setupClaude() {
  mkdirSync(join(claudeDir, "plugins"), { recursive: true });
  const live = join(claudeDir, "plugins", "cache", "mkt", "tool", "2.0.0");
  const stale = join(claudeDir, "plugins", "cache", "mkt", "tool", "1.0.0");
  for (const v of [live, stale]) {
    mkdirSync(join(v, "skills", "tool-skill"), { recursive: true });
    writeFileSync(join(v, "skills", "tool-skill", "SKILL.md"), "---\nname: tool-skill\ndescription: x\n---\n");
  }
  writeFileSync(
    join(claudeDir, "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "tool@mkt": [{ installPath: live, version: "2.0.0" }], "off@mkt": [{ installPath: join(claudeDir, "plugins", "cache", "mkt", "off", "1.0.0") }] } })
  );
  writeFileSync(join(claudeDir, "settings.json"), JSON.stringify({ enabledPlugins: { "tool@mkt": true, "off@mkt": false } }));
  return { live, stale };
}

describe("ClaudePluginIndex", () => {
  beforeEach(() => {
    if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  });

  it("derives the plugin id from a cache path and reports its state", () => {
    setupClaude();
    const index = new ClaudePluginIndex(claudeDir);
    const comp = { name: "s", type: "skill" as const, category: "dev", description: "", path_anchor: "claude" as const, rel_path: "plugins/cache/mkt/off/1.0.0/skills/s/SKILL.md" };
    expect(index.pluginIdOf(comp)).toBe("off@mkt");
    expect(index.stateOf("off@mkt")).toEqual({ installed: true, enabled: false });
    expect(index.stateOf("tool@mkt")).toEqual({ installed: true, enabled: true });
    expect(index.stateOf("never@mkt")).toBeUndefined();
    expect(index.pluginIdOf({ ...comp, rel_path: "skills-library/dev/s/SKILL.md" })).toBeNull();
  });

  it("marks cache dirs no installed version points at as stale", () => {
    const { live, stale } = setupClaude();
    const index = new ClaudePluginIndex(claudeDir);
    expect(index.isStaleCachePath(join(stale, "skills", "tool-skill", "SKILL.md"))).toBe(true);
    expect(index.isStaleCachePath(join(live, "skills", "tool-skill", "SKILL.md"))).toBe(false);
    expect(index.isStaleCachePath(join(claudeDir, "skills-library", "x", "SKILL.md"))).toBe(false);
  });

  it("is inert when Claude has no plugin records", () => {
    mkdirSync(claudeDir, { recursive: true });
    const index = new ClaudePluginIndex(claudeDir);
    expect(index.isStaleCachePath(join(claudeDir, "plugins", "cache", "a", "b", "1", "SKILL.md"))).toBe(false);
  });

  it("health flags a skill whose plugin is disabled, with the enable command", () => {
    setupClaude();
    const config = new ConfigManager({ dataDir: join(home, "data"), sandboxRoot: SANDBOX, claudeDir });
    const registry = new RegistryManager(config);
    mkdirSync(join(claudeDir, "plugins", "cache", "mkt", "off", "1.0.0", "skills", "off-skill"), { recursive: true });
    writeFileSync(join(claudeDir, "plugins", "cache", "mkt", "off", "1.0.0", "skills", "off-skill", "SKILL.md"), "# off");
    registry.addComponents([
      { name: "off-skill", type: "skill", category: "dev", description: "", path_anchor: "claude", rel_path: "plugins/cache/mkt/off/1.0.0/skills/off-skill/SKILL.md" },
      { name: "tool-skill", type: "skill", category: "dev", description: "", path_anchor: "claude", rel_path: "plugins/cache/mkt/tool/2.0.0/skills/tool-skill/SKILL.md" },
    ]);

    const issues = new HealthChecker(config, registry, new ClaudePluginIndex(claudeDir)).checkAll();
    const off = issues.filter((i) => i.kind === "disabled_dependency");
    expect(off.length).toBe(1);
    expect(off[0].subject).toBe("off@mkt");
    expect(off[0].detail).toContain("off-skill");
    expect(off[0].detail).not.toContain("tool-skill");
    expect(off[0].fix).toContain("claude plugin enable off@mkt");
  });
});

describe("Gate description clipping", () => {
  it("leaves short descriptions untouched and flattens whitespace", () => {
    expect(clipDescription("a  short\n description")).toBe("a short description");
  });

  it("clips a long description at a sentence boundary within budget", () => {
    const long = "First sentence is here. " + "x".repeat(GATE_DESCRIPTION_MAX);
    const clipped = clipDescription(long);
    expect(clipped).toBe("First sentence is here.…");
  });

  it("never exceeds the budget even without sentence boundaries", () => {
    const clipped = clipDescription("word ".repeat(200));
    expect(clipped.length).toBeLessThanOrEqual(GATE_DESCRIPTION_MAX + 1);
    expect(clipped.endsWith("…")).toBe(true);
  });
});

describe("Dormancy and gate exclusion", () => {
  beforeEach(() => {
    if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  });

  it("only skills-library and disabled-plugin components count as dormant", () => {
    setupClaude();
    const index = new ClaudePluginIndex(claudeDir);
    const mk = (rel: string) => ({ name: "x", type: "skill" as const, category: "dev", description: "", path_anchor: "claude" as const, rel_path: rel });
    expect(index.isDormant(mk("skills-library/dev/x/SKILL.md"))).toBe(true);
    expect(index.isDormant(mk("plugins/cache/mkt/off/1.0.0/skills/x/SKILL.md"))).toBe(true);
    expect(index.isDormant(mk("plugins/cache/mkt/tool/2.0.0/skills/x/SKILL.md"))).toBe(false);
    expect(index.isDormant(mk("skills/x/SKILL.md"))).toBe(false);
    expect(index.isDormant(mk("agents/x.md"))).toBe(false);
  });

  it("keeps always-on components out of gate files, lists them in always_on.txt and _all.txt exists", () => {
    const config = new ConfigManager({ dataDir: join(home, "data"), sandboxRoot: SANDBOX, claudeDir });
    const registry = new RegistryManager(config);
    registry.addComponents([
      { name: "gated", type: "skill", category: "dev", description: "d", path_anchor: "sandbox", rel_path: "a/SKILL.md" },
      { name: "loaded", type: "agent", category: "dev", description: "d", path_anchor: "sandbox", rel_path: "b.md", always_on: true },
    ]);
    const { GateReporter } = require("../src/core/reporter.ts");
    new GateReporter(config, registry).renderAll();
    const { readFileSync } = require("fs");
    const dev = readFileSync(join(home, "data", "gates", "claude", "dev.txt"), "utf8");
    const always = readFileSync(join(home, "data", "gates", "claude", "always_on.txt"), "utf8");
    const all = readFileSync(join(home, "data", "gates", "claude", "_all.txt"), "utf8");
    expect(dev).toContain("gated |");
    expect(dev).not.toContain("loaded |");
    expect(dev).toContain(`앞에 ${claudeDir}/ 를 붙여`);
    expect(always).toContain("[에이전트] loaded |");
    expect(all).toContain("# dev —");
    expect(all).toContain("gated |");
  });
});
