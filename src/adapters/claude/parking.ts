import { readdirSync, existsSync, mkdirSync, renameSync, statSync } from "fs";
import { join } from "path";
import { normalizeNFC } from "../../core/unicode.ts";
import type { ConfigManager } from "../../core/config.ts";
import type { RegistryManager } from "../../core/registry.ts";

export interface ParkResult {
  name: string;
  category: string;
  from: string;
  to: string;
}

export class ClaudeSkillParker {
  constructor(
    private config: ConfigManager,
    private registryManager: RegistryManager
  ) {}

  /**
   * Lists raw skill directories under ~/.claude/skills/ that are currently
   * always-on and could be parked in skills-library to become dormant.
   */
  listUnparked(): Array<{ name: string; path: string; category: string }> {
    const claudeDir = this.config.getPaths().claudeDir;
    const skillsDir = join(claudeDir, "skills");
    if (!existsSync(skillsDir)) return [];

    const results: Array<{ name: string; path: string; category: string }> = [];

    for (const entry of readdirSync(skillsDir)) {
      const norm = normalizeNFC(entry);
      if (norm.startsWith(".") || norm === "master-of") continue;

      const fullPath = join(skillsDir, norm);
      try {
        if (!statSync(fullPath).isDirectory()) continue;
      } catch {
        continue;
      }

      if (!existsSync(join(fullPath, "SKILL.md"))) continue;

      const comp = this.registryManager.getComponent(norm);
      const category = comp?.category || "dev";

      results.push({ name: norm, path: fullPath, category });
    }

    return results;
  }

  /**
   * Moves a raw skill directory from ~/.claude/skills/<name> to
   * ~/.claude/skills-library/<category>/<name>.
   */
  parkSkill(name: string, targetCategory?: string): ParkResult {
    if (name === "master-of") {
      throw new Error("Cannot park master-of: it is the gate system itself.");
    }

    const claudeDir = this.config.getPaths().claudeDir;
    const skillsDir = join(claudeDir, "skills");
    const sourceDir = join(skillsDir, name);

    if (!existsSync(sourceDir)) {
      throw new Error(`Skill '${name}' not found in ${skillsDir}`);
    }

    const category = targetCategory || this.registryManager.getComponent(name)?.category || "dev";
    const libraryDir = join(claudeDir, "skills-library", category);
    mkdirSync(libraryDir, { recursive: true });

    const destDir = join(libraryDir, name);
    if (existsSync(destDir)) {
      throw new Error(`Target directory already exists: ${destDir}`);
    }

    renameSync(sourceDir, destDir);

    return {
      name,
      category,
      from: sourceDir,
      to: destDir,
    };
  }

  /**
   * Moves a parked skill back from ~/.claude/skills-library/<cat>/<name> to ~/.claude/skills/<name>.
   */
  unparkSkill(name: string): { name: string; from: string; to: string } {
    const claudeDir = this.config.getPaths().claudeDir;
    const libraryBase = join(claudeDir, "skills-library");
    const skillsDir = join(claudeDir, "skills");

    if (!existsSync(libraryBase)) {
      throw new Error(`skills-library does not exist: ${libraryBase}`);
    }

    let sourceDir: string | null = null;
    for (const cat of readdirSync(libraryBase)) {
      const candidate = join(libraryBase, cat, name);
      if (existsSync(candidate)) {
        sourceDir = candidate;
        break;
      }
    }

    if (!sourceDir) {
      throw new Error(`Parked skill '${name}' not found in ${libraryBase}`);
    }

    const destDir = join(skillsDir, name);
    if (existsSync(destDir)) {
      throw new Error(`Target directory already exists: ${destDir}`);
    }

    mkdirSync(skillsDir, { recursive: true });
    renameSync(sourceDir, destDir);

    return { name, from: sourceDir, to: destDir };
  }

  /**
   * Parks all raw skills found in ~/.claude/skills/ into skills-library/.
   */
  parkAll(): ParkResult[] {
    const unparked = this.listUnparked();
    const results: ParkResult[] = [];
    for (const item of unparked) {
      results.push(this.parkSkill(item.name, item.category));
    }
    return results;
  }
}
