import { describe, it, expect, beforeEach, afterAll } from "bun:test";
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

  afterAll(() => {
    if (existsSync(testClaudeDir)) rmSync(testClaudeDir, { recursive: true, force: true });
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

describe("ClaudeSkillParker — single-file agents/commands", () => {
  const sandbox = join(PROJECT_ROOT, "sandbox");
  const testClaudeDir = join(sandbox, "test-parking-agents-claude");

  beforeEach(() => {
    if (existsSync(testClaudeDir)) rmSync(testClaudeDir, { recursive: true, force: true });
    mkdirSync(join(testClaudeDir, "agents"), { recursive: true });
    writeFileSync(
      join(testClaudeDir, "agents", "test-agent.md"),
      "---\nname: test-agent\ndescription: A test agent for parking\n---\n# test-agent\n"
    );
    mkdirSync(join(testClaudeDir, "commands"), { recursive: true });
    writeFileSync(
      join(testClaudeDir, "commands", "test-command.md"),
      "---\nname: test-command\ndescription: A test command for parking\n---\n# test-command\n"
    );
  });

  afterAll(() => {
    if (existsSync(testClaudeDir)) rmSync(testClaudeDir, { recursive: true, force: true });
  });

  it("parks a single-file agent into skills-library/<cat>/agents/", () => {
    const config = new ConfigManager({ sandboxRoot: sandbox, claudeDir: testClaudeDir });
    const regManager = new RegistryManager(config);
    const parker = new ClaudeSkillParker(config, regManager);

    const res = parker.parkComponentFile("test-agent", "agents", "planning");
    expect(res.name).toBe("test-agent");
    expect(res.category).toBe("planning");

    expect(existsSync(join(testClaudeDir, "agents", "test-agent.md"))).toBe(false);
    expect(existsSync(join(testClaudeDir, "skills-library", "planning", "agents", "test-agent.md"))).toBe(true);
  });

  it("unparks a single-file agent back to ~/.claude/agents/", () => {
    const config = new ConfigManager({ sandboxRoot: sandbox, claudeDir: testClaudeDir });
    const regManager = new RegistryManager(config);
    const parker = new ClaudeSkillParker(config, regManager);

    parker.parkComponentFile("test-agent", "agents", "planning");
    const res = parker.unparkComponentFile("test-agent", "agents");
    expect(res.name).toBe("test-agent");

    expect(existsSync(join(testClaudeDir, "agents", "test-agent.md"))).toBe(true);
    expect(existsSync(join(testClaudeDir, "skills-library", "planning", "agents", "test-agent.md"))).toBe(false);
  });

  it("parks a single-file command into skills-library/<cat>/commands/", () => {
    const config = new ConfigManager({ sandboxRoot: sandbox, claudeDir: testClaudeDir });
    const regManager = new RegistryManager(config);
    const parker = new ClaudeSkillParker(config, regManager);

    const res = parker.parkComponentFile("test-command", "commands", "dev");
    expect(existsSync(join(testClaudeDir, "commands", "test-command.md"))).toBe(false);
    expect(existsSync(join(testClaudeDir, "skills-library", "dev", "commands", "test-command.md"))).toBe(true);
    expect(res.category).toBe("dev");
  });

  it("throws a clear error when the agent file doesn't exist", () => {
    const config = new ConfigManager({ sandboxRoot: sandbox, claudeDir: testClaudeDir });
    const regManager = new RegistryManager(config);
    const parker = new ClaudeSkillParker(config, regManager);

    expect(() => parker.parkComponentFile("does-not-exist", "agents")).toThrow("not found");
  });
});
