import { describe, it, expect, beforeEach } from "bun:test";
import { join } from "path";
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { ConfigManager } from "../src/core/config.ts";
import { RegistryManager } from "../src/core/registry.ts";
import { GateReporter } from "../src/core/reporter.ts";
import { SANDBOX } from "./helpers.ts";

const home = join(SANDBOX, "masterof-home-migration");
const claudeDir = join(home, "claude");
const dataDir = join(home, "data");

function writeLegacyRegistry() {
  const legacyDir = join(claudeDir, "masterof");
  mkdirSync(legacyDir, { recursive: true });
  mkdirSync(join(claudeDir, "skills-library", "design", "animate"), { recursive: true });
  writeFileSync(join(claudeDir, "skills-library", "design", "animate", "SKILL.md"), "---\nname: animate\ndescription: motion\n---\n");
  const v1 = {
    category_meta: {
      design: { label_ko: "디자인", desc_ko: "UI 폴리시" },
      planning: { label_ko: "GSD", desc_ko: "기획", bundle: { plugin_name: "GSD", desc_ko: "큰 플러그인" } },
    },
    design: [
      { name: "animate", description_ko: "애니메이션 설계", path: join(claudeDir, "skills-library", "design", "animate", "SKILL.md") },
      { name: "scaffold", description_ko: "스캐폴딩", path: "/opt/elsewhere/scaffold.md", type: "command" },
    ],
    planning: [
      { name: "gsd-plan", description_ko: "계획", path: join(claudeDir, "x", "SKILL.md"), cluster: "core" },
    ],
    pipelines: [
      { name: "paint", description_ko: "디자인 파이프라인", path: join(claudeDir, "p", "SKILL.md"), domain: "design" },
    ],
    always_on: [],
  };
  writeFileSync(join(legacyDir, "registry.json"), JSON.stringify(v1), "utf8");
}

describe("v1 registry migration", () => {
  beforeEach(() => {
    if (existsSync(home)) rmSync(home, { recursive: true, force: true });
    mkdirSync(claudeDir, { recursive: true });
  });

  it("imports the Claude-only v1 registry when no v2 registry exists yet", () => {
    writeLegacyRegistry();
    const config = new ConfigManager({ dataDir, sandboxRoot: SANDBOX, claudeDir });
    const registry = new RegistryManager(config);
    const reg = registry.getRegistry();

    expect(reg.schema_version).toBe(2);
    expect(Object.keys(reg.components).sort()).toEqual(["animate", "gsd-plan", "paint", "scaffold"]);

    const animate = registry.getComponent("animate")!;
    expect(animate.category).toBe("design");
    expect(animate.path_anchor).toBe("claude");
    expect(animate.rel_path).toBe(join("skills-library", "design", "animate", "SKILL.md"));
    expect(animate.description_ko).toBe("애니메이션 설계");
    expect(existsSync(registry.resolveFullPath(animate))).toBe(true);

    expect(registry.getComponent("scaffold")!.type).toBe("command");
    expect(registry.getComponent("scaffold")!.path_anchor).toBe("custom");
    expect(registry.getComponent("gsd-plan")!.cluster).toBe("core");
    expect(registry.getComponent("paint")!.domain).toBe("design");

    expect(reg.categories.design.label_ko).toBe("디자인");
    expect(reg.categories.planning.bundle?.plugin_name).toBe("GSD");
    // Categories the v1 file did not mention still get their defaults.
    expect(reg.categories.dev.label_en).toBe("Development Tools");
  });

  it("renders a domain's pipelines inline in that gate file", () => {
    writeLegacyRegistry();
    const config = new ConfigManager({ dataDir, sandboxRoot: SANDBOX, claudeDir });
    const registry = new RegistryManager(config);
    new GateReporter(config, registry).renderAll();

    const design = readFileSync(join(dataDir, "gates", "claude", "design.txt"), "utf8");
    expect(design).toContain("## 관련 파이프라인");
    expect(design).toContain("paint |");
    const dev = readFileSync(join(dataDir, "gates", "claude", "dev.txt"), "utf8");
    expect(dev).not.toContain("관련 파이프라인");
  });

  it("migrates a v1-shaped file sitting at the v2 path", () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "registry.json"), JSON.stringify({ category_meta: {}, design: [{ name: "a", path: "/x/SKILL.md" }] }));
    const registry = new RegistryManager(new ConfigManager({ dataDir, sandboxRoot: SANDBOX, claudeDir }));
    expect(registry.getRegistry().schema_version).toBe(2);
    expect(registry.getComponent("a")).toBeDefined();
  });

  it("quarantines a v2 file that lacks its component map", () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "registry.json"), JSON.stringify({ schema_version: 2 }));
    const registry = new RegistryManager(new ConfigManager({ dataDir, sandboxRoot: SANDBOX, claudeDir }));
    expect(Object.keys(registry.getRegistry().components)).toEqual([]);
    expect(readFileSync(join(dataDir, "registry.json"), "utf8")).toContain('"components"');
  });
});

describe("Sync semantics", () => {
  beforeEach(() => {
    if (existsSync(home)) rmSync(home, { recursive: true, force: true });
    mkdirSync(claudeDir, { recursive: true });
  });

  const comp = (name: string, overrides: object = {}) => ({
    name,
    type: "skill" as const,
    category: "dev",
    description: "fresh from disk",
    path_anchor: "claude" as const,
    rel_path: `skills/${name}/SKILL.md`,
    ...overrides,
  });

  it("upsertScanned keeps user classification but refreshes discovery fields", () => {
    const registry = new RegistryManager(new ConfigManager({ dataDir, sandboxRoot: SANDBOX, claudeDir }));
    registry.addComponent(comp("tool", { category: "research", cluster: "scrapers", always_on: true, description: "stale", description_ko: "한글" }));

    const result = registry.upsertScanned([comp("tool", { category: "dev", rel_path: "moved/tool/SKILL.md" }), comp("brand-new")]);

    expect(result.added).toEqual(["brand-new"]);
    expect(result.updated).toEqual(["tool"]);
    const tool = registry.getComponent("tool")!;
    expect(tool.category).toBe("research");
    expect(tool.cluster).toBe("scrapers");
    expect(tool.always_on).toBe(true);
    expect(tool.description_ko).toBe("한글");
    expect(tool.description).toBe("fresh from disk");
    expect(tool.rel_path).toBe("moved/tool/SKILL.md");
  });

  it("pruneMissing drops only components under the given anchors whose file is gone", () => {
    mkdirSync(join(claudeDir, "skills", "present"), { recursive: true });
    writeFileSync(join(claudeDir, "skills", "present", "SKILL.md"), "# present");
    const registry = new RegistryManager(new ConfigManager({ dataDir, sandboxRoot: SANDBOX, claudeDir }));
    registry.addComponents([
      comp("present"),
      comp("gone"),
      comp("custom-gone", { path_anchor: "custom", rel_path: "/no/such/SKILL.md" }),
    ]);

    const removed = registry.pruneMissing(["claude"]);

    expect(removed).toEqual(["gone"]);
    expect(registry.getComponent("present")).toBeDefined();
    expect(registry.getComponent("custom-gone")).toBeDefined();
  });

  it("reloadIfChanged picks up a registry rewritten by another process", () => {
    const config = new ConfigManager({ dataDir, sandboxRoot: SANDBOX, claudeDir });
    const reader = new RegistryManager(config);
    expect(reader.getComponent("late")).toBeUndefined();

    const writer = new RegistryManager(config);
    // Ensure the mtime moves even on coarse filesystems.
    const later = new Date(Date.now() + 2000);
    writer.addComponent(comp("late"));
    require("fs").utimesSync(config.getPaths().registryFile, later, later);

    expect(reader.reloadIfChanged()).toBe(true);
    expect(reader.getComponent("late")).toBeDefined();
    expect(reader.reloadIfChanged()).toBe(false);
  });

  it("resolveFullPath never depends on the process cwd", () => {
    const config = new ConfigManager({ dataDir, sandboxRoot: SANDBOX, claudeDir });
    const registry = new RegistryManager(config);
    const originalCwd = process.cwd();
    try {
      process.chdir("/");
      expect(registry.resolveFullPath(comp("x", { path_anchor: "custom", rel_path: "rel/SKILL.md" }))).toBe(join(dataDir, "rel", "SKILL.md"));
      expect(registry.resolveFullPath(comp("y", { path_anchor: "library", rel_path: "dev/y/SKILL.md" }))).toBe(join(claudeDir, "skills-library", "dev", "y", "SKILL.md"));
      expect(registry.resolveFullPath(comp("z", { path_anchor: "custom", rel_path: "/abs/SKILL.md" }))).toBe("/abs/SKILL.md");
    } finally {
      process.chdir(originalCwd);
    }
  });
});
