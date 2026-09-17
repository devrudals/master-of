import { describe, it, expect, beforeEach } from "bun:test";
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { ConfigManager } from "../src/core/config.ts";
import { RegistryManager } from "../src/core/registry.ts";
import { ClaudeSkillParker } from "../src/adapters/claude/parking.ts";
import { PROJECT_ROOT } from "./helpers.ts";

describe("ClaudeSkillParker", () => {
  const sandbox = join(PROJECT_ROOT, "sandbox");
  const testClaudeDir = join(sandbox, "test-parking-claude");

  beforeEach(() => {
    if (existsSync(testClaudeDir)) rmSync(testClaudeDir, { recursive: true, force: true });
    mkdirSync(join(testClaudeDir, "skills", "test-skill"), { recursive: true });
    writeFileSync(
      join(testClaudeDir, "skills", "test-skill", "SKILL.md"),
      "---\nname: test-skill\ndescription: A test skill for parking\n---\n# test-skill\n"
    );
  });

  it("lists unparked raw skills", () => {
    const config = new ConfigManager({ sandboxRoot: sandbox, claudeDir: testClaudeDir });
    const regManager = new RegistryManager(config);
    const parker = new ClaudeSkillParker(config, regManager);

    const unparked = parker.listUnparked();
    expect(unparked.length).toBe(1);
    expect(unparked[0].name).toBe("test-skill");
  });

  it("parks a raw skill into skills-library and makes it dormant", () => {
    const config = new ConfigManager({ sandboxRoot: sandbox, claudeDir: testClaudeDir });
    const regManager = new RegistryManager(config);
    const parker = new ClaudeSkillParker(config, regManager);

    const res = parker.parkSkill("test-skill", "research");
    expect(res.name).toBe("test-skill");
    expect(res.category).toBe("research");

    expect(existsSync(join(testClaudeDir, "skills", "test-skill"))).toBe(false);
    expect(existsSync(join(testClaudeDir, "skills-library", "research", "test-skill", "SKILL.md"))).toBe(true);

    // listUnparked should now be empty
    expect(parker.listUnparked().length).toBe(0);
  });

  it("unparks a skill back to skills directory", () => {
    const config = new ConfigManager({ sandboxRoot: sandbox, claudeDir: testClaudeDir });
    const regManager = new RegistryManager(config);
    const parker = new ClaudeSkillParker(config, regManager);

    parker.parkSkill("test-skill", "research");
    const unparkRes = parker.unparkSkill("test-skill");
    expect(unparkRes.name).toBe("test-skill");

    expect(existsSync(join(testClaudeDir, "skills", "test-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(testClaudeDir, "skills-library", "research", "test-skill"))).toBe(false);
  });

  it("refuses to park master-of", () => {
    const config = new ConfigManager({ sandboxRoot: sandbox, claudeDir: testClaudeDir });
    const regManager = new RegistryManager(config);
    const parker = new ClaudeSkillParker(config, regManager);

    expect(() => parker.parkSkill("master-of")).toThrow("Cannot park master-of");
  });
});
