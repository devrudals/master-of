import { describe, it, expect, beforeEach } from "bun:test";
import { resolve, join } from "path";
import { existsSync, readFileSync, rmSync } from "fs";
import { ConfigManager } from "../src/core/config.ts";
import { RegistryManager } from "../src/core/registry.ts";
import { SkillScanner } from "../src/core/scanner.ts";
import { GateReporter } from "../src/core/reporter.ts";
import { SANDBOX } from "./helpers.ts";

describe("Scanner, Registry v2 and Gate Reporter", () => {
  const sandbox = SANDBOX;
  const testDataDir = join(sandbox, "masterof-home-test");

  beforeEach(() => {
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it("scans mock directories, populates registry, and generates gate files", () => {
    const config = new ConfigManager({
      dataDir: testDataDir,
      sandboxRoot: sandbox,
      claudeDir: join(sandbox, "mock-claude"),
      geminiDir: join(sandbox, "mock-gemini"),
    });

    const registryManager = new RegistryManager(config);
    const scanner = new SkillScanner();

    // Scan Claude mock skills
    const claudeSkills = scanner.scanDirectory(join(sandbox, "mock-claude", "skills"), "sandbox");
    expect(claudeSkills.length).toBe(7);

    for (const skill of claudeSkills) {
      registryManager.addComponent(skill);
    }

    // Scan Gemini mock skills
    const geminiSkills = scanner.scanDirectory(join(sandbox, "mock-gemini", "skills"), "sandbox");
    expect(geminiSkills.length).toBe(2);

    for (const skill of geminiSkills) {
      registryManager.addComponent({ ...skill, source: "gemini" });
    }

    // Verify registry size & categories
    const reg = registryManager.getRegistry();
    expect(Object.keys(reg.components).length).toBe(9);
    expect(reg.components["animate"].category).toBe("design");
    expect(reg.components["better-ui"].category).toBe("design");
    expect(reg.components["web-scraper"].category).toBe("research");
    expect(reg.components["krx-analyzer"].category).toBe("stock");
    expect(reg.components["sprint-planner"].category).toBe("planning");
    expect(reg.components["end-to-end-builder"].category).toBe("pipelines");

    // Render Gate files
    const reporter = new GateReporter(config, registryManager);
    const result = reporter.renderAll();

    expect(result.gateFiles.length).toBe(16);
    expect(result.tokenSavings.before).toBeGreaterThan(0);
    expect(result.tokenSavings.after).toBeGreaterThan(0);

    // Verify pre-rendered gate index contents
    const designGatePath = join(testDataDir, "gates", "claude", "design.txt");
    expect(existsSync(designGatePath)).toBe(true);
    const designContent = readFileSync(designGatePath, "utf8");
    expect(designContent).toContain("animate |");
    expect(designContent).toContain("better-ui |");

    // Each harness only sees its own skills.
    const geminiNames = geminiSkills.map((s) => s.name);
    const claudeView = readFileSync(join(testDataDir, "gates", "claude", `${geminiSkills[0].category}.txt`), "utf8");
    const geminiView = readFileSync(join(testDataDir, "gates", "gemini", `${geminiSkills[0].category}.txt`), "utf8");
    expect(claudeView).not.toContain(`${geminiNames[0]} |`);
    expect(geminiView).toContain(`${geminiNames[0]} |`);
    expect(geminiView).not.toContain("animate |");

    // Verify report.txt and report-brief.txt
    const briefPath = join(testDataDir, "report-brief.txt");
    expect(existsSync(briefPath)).toBe(true);
    const briefContent = readFileSync(briefPath, "utf8");
    expect(briefContent).toContain("master-of 현황 (요약)");
    expect(briefContent).toContain("/design");
  });
});

describe("Scanner depth and token accounting", () => {
  const sandbox = SANDBOX;
  const home = join(sandbox, "masterof-home-depth");

  beforeEach(() => {
    if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  });

  it("reaches a marketplace plugin cache skill seven levels down", () => {
    const deep = join(home, "claude", "plugins", "cache", "mkt", "plug", "1.0.0", "skills", "deep-skill");
    require("fs").mkdirSync(deep, { recursive: true });
    require("fs").writeFileSync(join(deep, "SKILL.md"), "---\nname: deep-skill\ndescription: buried\n---\n");

    const found = new SkillScanner().scanDirectory(join(home, "claude"), "claude");
    expect(found.map((c) => c.name)).toEqual(["deep-skill"]);
  });

  it("skips harness state directories", () => {
    const skipped = join(home, "claude", "projects", "some-proj", "skill-like");
    require("fs").mkdirSync(skipped, { recursive: true });
    require("fs").writeFileSync(join(skipped, "SKILL.md"), "---\nname: ghost\n---\n");

    expect(new SkillScanner().scanDirectory(join(home, "claude"), "claude")).toEqual([]);
  });

  it("does not count always-on components as saved tokens", () => {
    const config = new ConfigManager({ dataDir: home, sandboxRoot: sandbox });
    const registry = new RegistryManager(config);
    const desc = "a reasonably long description so the token estimate is not zero";
    registry.addComponents([
      { name: "gated", type: "skill", category: "dev", description: desc, path_anchor: "sandbox", rel_path: "a/SKILL.md" },
      { name: "pinned", type: "skill", category: "dev", description: desc, path_anchor: "sandbox", rel_path: "b/SKILL.md", always_on: true },
    ]);
    const { tokenSavings } = new GateReporter(config, registry).renderAll();

    const perItem = tokenSavings.before / 2;
    // Only the gated item can be saved; the always-on one is still loaded.
    expect(tokenSavings.after).toBeGreaterThanOrEqual(perItem);
    expect(tokenSavings.saved).toBeLessThanOrEqual(perItem);
  });
});

describe("Scanner descent and collisions", () => {
  const home = join(SANDBOX, "masterof-home-descent");
  const fs = require("fs");

  beforeEach(() => {
    if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  });

  const skill = (dir: string, name: string) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\n`);
  };

  it("keeps descending below a directory that has its own SKILL.md", () => {
    const plugin = join(home, "claude", "plugins", "cache", "mkt", "plug", "0.1.0");
    skill(plugin, "plug-root");
    skill(join(plugin, "skills", "inner"), "inner");

    const names = new SkillScanner().scanDirectory(join(home, "claude"), "claude").map((c) => c.name).sort();
    expect(names).toEqual(["inner", "plug-root"]);
  });

  it("registers the scan root itself when it is a skill, without double counting", () => {
    skill(join(home, "one"), "one");
    const found = new SkillScanner().scanDirectory(join(home, "one"), "custom");
    expect(found.map((c) => c.name)).toEqual(["one"]);
  });

  it("never registers master-of's own gate skills", () => {
    skill(join(home, "claude", "skills", "master-of", "skills", "design"), "design");
    skill(join(home, "claude", "plugins", "cache", "master-of", "master-of", "0.1.0", "skills", "dev"), "dev");
    skill(join(home, "claude", "skills", "other"), "other");
    expect(new SkillScanner().scanDirectory(join(home, "claude"), "claude").map((c) => c.name)).toEqual(["other"]);
  });

  it("ignores marketplace source checkouts", () => {
    skill(join(home, "claude", "plugins", "marketplaces", "vendor", ".cursor", "skills", "dup"), "dup");
    skill(join(home, "claude", "plugins", "cache", "vendor", "plug", "1.0.0", "skills", "dup"), "dup");

    const found = new SkillScanner().scanDirectory(join(home, "claude"), "claude");
    expect(found.length).toBe(1);
    expect(found[0].rel_path).toContain("plugins/cache");
  });

  it("dedupeByName keeps the first path and reports the rest", () => {
    const { dedupeByName } = require("../src/core/scanner.ts");
    const mk = (rel: string) => ({ name: "same", type: "skill", category: "dev", description: "", path_anchor: "claude", rel_path: rel });
    const { unique, collisions } = dedupeByName([mk("z/same/SKILL.md"), mk("a/same/SKILL.md"), mk("m/same/SKILL.md")]);

    expect(unique.length).toBe(1);
    expect(unique[0].rel_path).toBe("a/same/SKILL.md");
    expect(collisions).toEqual([{ name: "same", kept: "a/same/SKILL.md", dropped: ["m/same/SKILL.md", "z/same/SKILL.md"] }]);
  });

  it("keeps the same skill name from two harnesses as two components", () => {
    const { dedupeByName } = require("../src/core/scanner.ts");
    const mk = (source: string, rel: string) => ({ name: "apple-design", type: "skill", category: "design", description: "", path_anchor: source, rel_path: rel, source });
    const { unique, collisions } = dedupeByName([mk("claude", "skills-library/design/apple-design/SKILL.md"), mk("gemini", "config/skills/apple-design/SKILL.md")]);
    expect(unique.length).toBe(2);
    expect(collisions).toEqual([]);

    const config = new ConfigManager({ dataDir: home, sandboxRoot: SANDBOX });
    const registry = new RegistryManager(config);
    registry.addComponents(unique as any);
    expect(Object.keys(registry.getRegistry().components).sort()).toEqual(["apple-design", "apple-design@gemini"]);
    expect(registry.getComponent("apple-design")!.source).toBe("claude");
    expect(registry.getComponent("apple-design@gemini")!.source).toBe("gemini");
    // The bare name is ambiguous now, so removal must be told which copy.
    expect(() => registry.removeComponent("apple-design")).toThrow(/more than one source/);
    registry.removeComponent("apple-design@claude");
    expect(registry.getComponent("apple-design")!.source).toBe("gemini");
  });

  it("dedupeByName prefers a shallow skill over a copy nested in its adapters", () => {
    const { dedupeByName } = require("../src/core/scanner.ts");
    const mk = (rel: string) => ({ name: "find-skill", type: "skill", category: "dev", description: "", path_anchor: "claude", rel_path: rel });
    const { unique } = dedupeByName([mk("a/find-skill/adapters/codex/SKILL.md"), mk("z/find-skill/SKILL.md")]);
    expect(unique[0].rel_path).toBe("z/find-skill/SKILL.md");
  });

  it("dedupeByName prefers the most recently written copy at equal depth", () => {
    const { dedupeByName } = require("../src/core/scanner.ts");
    skill(join(home, "old", "v"), "v");
    skill(join(home, "new", "v"), "v");
    const past = new Date(Date.now() - 100_000);
    fs.utimesSync(join(home, "old", "v", "SKILL.md"), past, past);
    const mk = (rel: string) => ({ name: "v", type: "skill", category: "dev", description: "", path_anchor: "custom", rel_path: rel });
    const { unique } = dedupeByName([mk("old/v/SKILL.md"), mk("new/v/SKILL.md")], (c: any) => join(home, c.rel_path));
    expect(unique[0].rel_path).toBe("new/v/SKILL.md");
  });
});

describe("Category inference and component discovery", () => {
  const home = join(SANDBOX, "masterof-home-infer");
  const fs = require("fs");

  beforeEach(() => {
    if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  });

  const write = (rel: string, name: string, description: string) => {
    const file = join(home, rel);
    fs.mkdirSync(require("path").dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\nname: ${name}\ndescription: ${description}\n---\n`);
  };
  const scan = () => Object.fromEntries(new SkillScanner().scanDirectory(home, "custom").map((c) => [c.name, c]));

  it("does not read 'guide', 'build' or 'explanation' as design/planning terms", () => {
    write("a/SKILL.md", "firebase-guide", "Comprehensive guide for building Firebase apps");
    write("b/SKILL.md", "gemini-lookup", "Delegates simple explanation questions to Gemini");
    write("c/SKILL.md", "dart-ffi", "Guide agents to use package:ffigen for Dart");
    const found = scan();
    expect(found["firebase-guide"].category).toBe("dev");
    expect(found["gemini-lookup"].category).toBe("dev");
    expect(found["dart-ffi"].category).toBe("dev");
  });

  it("still classifies genuine domain terms, in English and Korean", () => {
    write("a/SKILL.md", "animate", "애니메이션을 처음부터 설계");
    write("b/SKILL.md", "krx-tool", "Korean stock market quotes");
    write("c/SKILL.md", "sprint", "Plan the next sprint milestones");
    write("d/SKILL.md", "scraper", "Scrape pages with a headless browser");
    write("e/SKILL.md", "paint", "End-to-end design pipeline");
    const found = scan();
    expect(found["animate"].category).toBe("design");
    expect(found["krx-tool"].category).toBe("stock");
    expect(found["sprint"].category).toBe("planning");
    expect(found["scraper"].category).toBe("research");
    expect(found["paint"].category).toBe("pipelines");
  });

  it("discovers commands/*.md and agents/*.md with their type", () => {
    write("plug/commands/scaffold.md", "component-scaffold", "Scaffold a component");
    write("plug/agents/reviewer.md", "code-reviewer", "Reviews code");
    write("plug/agents/.hidden.md", "hidden", "ignored");
    write("plug/agents/notes.txt", "notes", "ignored");
    const found = scan();
    expect(found["component-scaffold"].type).toBe("command");
    expect(found["component-scaffold"].rel_path).toBe("plug/commands/scaffold.md");
    expect(found["code-reviewer"].type).toBe("agent");
    expect(Object.keys(found).sort()).toEqual(["code-reviewer", "component-scaffold"]);
  });

  it("treats agents/ inside a skill as that skill's helpers, not components", () => {
    write("plug/skills/skill-creator/SKILL.md", "skill-creator", "Creates skills");
    write("plug/skills/skill-creator/agents/grader.md", "grader", "internal helper");
    write("plug/agents/top-level.md", "top-level", "plugin agent");
    const found = scan();
    expect(Object.keys(found).sort()).toEqual(["skill-creator", "top-level"]);
  });
});
