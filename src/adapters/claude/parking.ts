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

/** One account-synced Cowork skill pack found under plugins/synced/<uuid>/<domain>
 *  or skills/synced/<uuid>/<domain>. `root` is which of the two trees it lives in. */
export interface SyncedPackEntry {
  domain: string;
  root: "plugins" | "skills";
  uuidDir: string;
  paths: string[]; // every file/dir belonging to this domain (the folder itself, ~gN variants, .meta.json siblings)
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

/**
 * Discovers account-synced Cowork skill packs (plugins/synced/<uuid>/<domain>,
 * skills/synced/<uuid>/<domain>). These have no marketplace entry, but Claude
 * Code still recognizes each domain as a "<domain>@synced" plugin id that
 * `claude plugin enable|disable` can toggle — that toggle is what actually
 * hides them (see the `cowork` CLI command), because moving the files
 * themselves loses the race: the harness re-syncs a parked folder back onto
 * disk within the same session, before the plugin-id toggle takes effect on
 * whether Claude Code loads it at all.
 */
export class SyncedPacker {
  constructor(private config: ConfigManager) {}

  private roots(): Array<{ root: "plugins" | "skills"; dir: string }> {
    const claudeDir = this.config.getPaths().claudeDir;
    return [
      { root: "plugins", dir: join(claudeDir, "plugins", "synced") },
      { root: "skills", dir: join(claudeDir, "skills", "synced") },
    ];
  }

  /** Every domain pack currently present under plugins/synced/* or skills/synced/*. */
  list(): SyncedPackEntry[] {
    const entries: SyncedPackEntry[] = [];

    for (const { root, dir } of this.roots()) {
      if (!existsSync(dir)) continue;
      for (const uuidEntry of readdirSync(dir)) {
        if (uuidEntry.startsWith(".")) continue;
        const uuidDir = join(dir, uuidEntry);
        if (!statSync(uuidDir).isDirectory()) continue;

        const domains = new Set<string>();
        for (const child of readdirSync(uuidDir)) {
          if (child.startsWith(".") || child === "manifest.json" || child === ".staging") continue;
          // Strip a trailing "<domain>.meta.json" or a "<domain>~gN" version suffix
          // down to the bare domain name so variants group under one entry.
          const base = child.replace(/\.meta\.json$/, "").replace(/~g\d+$/, "");
          domains.add(base);
        }

        for (const domain of domains) {
          const paths = readdirSync(uuidDir)
            .filter((child) => {
              if (child.startsWith(".") || child === "manifest.json") return false;
              const base = child.replace(/\.meta\.json$/, "").replace(/~g\d+$/, "");
              return base === domain;
            })
            .map((child) => join(uuidDir, child));
          if (paths.length > 0) entries.push({ domain, root, uuidDir, paths });
        }
      }
    }

    return entries;
  }
}
