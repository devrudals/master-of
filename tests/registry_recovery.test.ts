import { describe, it, expect, beforeEach } from "bun:test";
import { join } from "path";
import { existsSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "fs";
import { ConfigManager } from "../src/core/config.ts";
import { RegistryManager } from "../src/core/registry.ts";
import { SANDBOX } from "./helpers.ts";

describe("Registry corruption recovery", () => {
  const testDataDir = join(SANDBOX, "masterof-home-corrupt");

  beforeEach(() => {
    if (existsSync(testDataDir)) rmSync(testDataDir, { recursive: true, force: true });
    mkdirSync(testDataDir, { recursive: true });
  });

  it("quarantines an unparseable registry instead of overwriting it", () => {
    const corrupt = '{"schema_version": 2, "components": {"animate"';
    writeFileSync(join(testDataDir, "registry.json"), corrupt, "utf8");

    const config = new ConfigManager({ dataDir: testDataDir, sandboxRoot: SANDBOX });
    const manager = new RegistryManager(config);

    const quarantined = readdirSync(testDataDir).filter((f) => f.startsWith("registry.json.corrupt-"));
    expect(quarantined.length).toBe(1);
    expect(readFileSync(join(testDataDir, quarantined[0]), "utf8")).toBe(corrupt);

    // A fresh, usable registry takes its place.
    expect(manager.getRegistry().schema_version).toBe(2);
    expect(Object.keys(manager.getRegistry().components).length).toBe(0);
  });

  it("quarantines valid JSON that is not a registry object", () => {
    writeFileSync(join(testDataDir, "registry.json"), "[1, 2, 3]", "utf8");

    new RegistryManager(new ConfigManager({ dataDir: testDataDir, sandboxRoot: SANDBOX }));

    expect(readdirSync(testDataDir).some((f) => f.startsWith("registry.json.corrupt-"))).toBe(true);
  });

  it("migrates a v1 registry without discarding its components", () => {
    // Real v1 layout: category_meta plus one array per category, absolute paths.
    const v1 = {
      category_meta: { design: { label_ko: "디자인", desc_ko: "UI" } },
      design: [{ name: "animate", description_ko: "motion", path: "/abs/a/SKILL.md" }],
    };
    writeFileSync(join(testDataDir, "registry.json"), JSON.stringify(v1), "utf8");

    const manager = new RegistryManager(new ConfigManager({ dataDir: testDataDir, sandboxRoot: SANDBOX }));

    expect(manager.getRegistry().schema_version).toBe(2);
    expect(manager.getComponent("animate")?.description).toBe("motion");
    expect(readdirSync(testDataDir).some((f) => f.startsWith("registry.json.corrupt-"))).toBe(false);
  });
});

describe("Batched component writes", () => {
  const testDataDir = join(SANDBOX, "masterof-home-batch");

  beforeEach(() => {
    if (existsSync(testDataDir)) rmSync(testDataDir, { recursive: true, force: true });
  });

  it("addComponents persists every component in a single save", () => {
    const config = new ConfigManager({ dataDir: testDataDir, sandboxRoot: SANDBOX });
    const manager = new RegistryManager(config);

    let saves = 0;
    const originalSave = manager.save.bind(manager);
    manager.save = ((data?: any) => {
      saves++;
      return originalSave(data);
    }) as typeof manager.save;

    manager.addComponents([
      { name: "a", type: "skill", category: "dev", description: "A", path_anchor: "sandbox", rel_path: "a/SKILL.md" },
      { name: "b", type: "skill", category: "dev", description: "B", path_anchor: "sandbox", rel_path: "b/SKILL.md" },
      { name: "c", type: "skill", category: "dev", description: "C", path_anchor: "sandbox", rel_path: "c/SKILL.md" },
    ]);

    expect(saves).toBe(1);
    expect(Object.keys(manager.getRegistry().components).length).toBe(3);

    const onDisk = JSON.parse(readFileSync(join(testDataDir, "registry.json"), "utf8"));
    expect(Object.keys(onDisk.components).sort()).toEqual(["a", "b", "c"]);
  });

  it("addComponents on an empty list writes nothing", () => {
    const manager = new RegistryManager(new ConfigManager({ dataDir: testDataDir, sandboxRoot: SANDBOX }));
    let saves = 0;
    manager.save = (() => { saves++; }) as typeof manager.save;
    manager.addComponents([]);
    expect(saves).toBe(0);
  });
});
