import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { join, relative, basename } from "path";
import { normalizeNFC } from "./unicode.ts";
import { DEFAULT_SOURCE } from "./types.ts";
import type { RegistryComponent, PathAnchor, ComponentType } from "./types.ts";

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".turbo", "dist", "build", ".next", ".cache", "coverage", ".system_generated",
  // Harness state dirs that never hold skills but can be enormous.
  "projects", "todos", "shell-snapshots", "statsig", "debug", "logs", "history", "sessions", "transcripts", "tmp", "temp",
  // Marketplace source checkouts carry one copy per harness (.cursor/, .pi/, ...);
  // the installed unit lives in plugins/cache and must not be shadowed by them.
  "marketplaces",
  // The gate system must not gate its own gate skills.
  "master-of",
]);

/** Deep enough for a marketplace plugin cache:
 * plugins/cache/<marketplace>/<plugin>/<version>/skills/<name>/SKILL.md */
const DEFAULT_MAX_DEPTH = 8;

/** Plugin directories whose *.md files are components, keyed by component type. */
const COMPONENT_DIRS: Record<string, ComponentType> = { commands: "command", agents: "agent" };

// ASCII terms are word-bounded so "guide"/"build" stop reading as "ui" and
// "explanation" as "plan"; Hangul has no \b, so those stay as substrings.
// Order matters: an end-to-end pipeline usually also mentions its domain.
const CATEGORY_PATTERNS: Array<[string, RegExp]> = [
  ["pipelines", /\b(pipeline|workflow|end-to-end|paint|impeccable|lifecycle)\b|오케스트레이션|파이프라인/],
  ["design", /\b(design|ui|ux|motion|animat\w*|css|styl(e|ing)|tailwind|colou?rs?|fonts?|typography|figma|layout)\b|디자인|모션|애니메이션|인터랙션/],
  ["stock", /\b(stocks?|finance|financial|market|invest\w*|krx|ticker|equit(y|ies))\b|주식|증권|재무/],
  ["planning", /\b(plan|planning|gsd|milestones?|roadmap|spec|backlog|issues?|sprint)\b|기획|스프린트|마일스톤|백로그/],
  ["research", /\b(research|scrap(e|ing)|web ?search|crawl\w*|fetch\w*|browser|extract\w*)\b|리서치|스크랩|크롤링/],
];

export interface FrontmatterResult {
  name: string;
  description: string;
  type?: ComponentType;
  allowedTools?: string;
  cluster?: string;
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Reads the top-level keys of a frontmatter block, including plain scalars that
 * wrap onto indented continuation lines and block scalars (`>`, `>-`, `|`, `|-`).
 * A new key is recognized only at zero indentation, so a continuation line that
 * happens to contain a colon ("IMPORTANT: ...") stays part of its value.
 */
export function parseFrontmatterFields(yaml: string): Record<string, string> {
  const lines = yaml.split(/\r?\n/);
  const fields: Record<string, string> = {};
  let i = 0;

  while (i < lines.length) {
    const keyLine = lines[i].match(/^([A-Za-z0-9_.-]+):[ \t]*(.*)$/);
    if (!keyLine) {
      i++;
      continue;
    }

    const key = keyLine[1];
    const head = keyLine[2].trim();
    i++;

    const body: string[] = [];
    while (i < lines.length && (lines[i].trim() === "" || /^[ \t]/.test(lines[i]))) {
      body.push(lines[i].trim());
      i++;
    }

    const isBlockScalar = /^[|>][-+]?$/.test(head);
    const isLiteral = head.startsWith("|");
    const parts = isBlockScalar ? body : [head, ...body];
    const joined = isLiteral ? parts.join("\n") : parts.join(" ").replace(/\s+/g, " ");
    fields[key] = unquote(joined.trim()).trim();
  }

  return fields;
}

export function parseSkillFrontmatter(content: string, fallbackName: string): FrontmatterResult {
  const norm = normalizeNFC(content);
  const match = norm.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let name = fallbackName;
  let description = "";

  if (match) {
    const fields = parseFrontmatterFields(match[1]);
    if (fields.name) name = fields.name;
    // The gate index is one line per entry, so a literal block scalar's
    // newlines must not survive into the description.
    if (fields.description) description = fields.description.replace(/\s+/g, " ").trim();
  }

  // Fallback if description empty: first heading or first line of the body,
  // never a frontmatter line.
  if (!description) {
    const body = match ? norm.slice(match.index! + match[0].length) : norm;
    const firstLine = body.split(/\r?\n/).find((l) => l.trim());
    if (firstLine) description = firstLine.replace(/^#+\s*/, "").trim();
  }

  return { name: normalizeNFC(name), description: normalizeNFC(description) };
}

export interface NameCollision {
  name: string;
  kept: string;
  dropped: string[];
}

/**
 * Registry ids are skill names, so two SKILL.md files sharing a name cannot both
 * be registered. Prefers the shallowest path (a skill over a copy nested in its
 * adapters/), then the most recently written (a newer plugin version over a
 * stale cache entry), then path order — and reports the rest so a sync never
 * silently discards a skill.
 */
export function dedupeByName(
  components: RegistryComponent[],
  fullPathOf?: (c: RegistryComponent) => string
): { unique: RegistryComponent[]; collisions: NameCollision[] } {
  // One stat per component, not one per comparison.
  const mtimes = new Map<RegistryComponent, number>();
  const mtimeOf = (c: RegistryComponent): number => {
    if (!fullPathOf) return 0;
    const cached = mtimes.get(c);
    if (cached !== undefined) return cached;
    let m = 0;
    try {
      m = statSync(fullPathOf(c)).mtimeMs;
    } catch {}
    mtimes.set(c, m);
    return m;
  };
  const depthOf = (c: RegistryComponent) => c.rel_path.split(/[\\/]/).length;

  const sorted = [...components].sort((a, b) =>
    depthOf(a) - depthOf(b) ||
    mtimeOf(b) - mtimeOf(a) ||
    `${a.path_anchor}:${a.rel_path}`.localeCompare(`${b.path_anchor}:${b.rel_path}`)
  );
  const byName = new Map<string, RegistryComponent>();
  const dropped = new Map<string, string[]>();

  for (const comp of sorted) {
    // Same name in two harnesses is two installs, not a collision.
    const id = `${comp.source ?? DEFAULT_SOURCE}:${normalizeNFC(comp.name)}`;
    if (byName.has(id)) {
      (dropped.get(id) ?? dropped.set(id, []).get(id)!).push(comp.rel_path);
    } else {
      byName.set(id, comp);
    }
  }

  const collisions = [...dropped.entries()].map(([id, paths]) => ({ name: byName.get(id)!.name, kept: byName.get(id)!.rel_path, dropped: paths }));
  return { unique: [...byName.values()], collisions };
}

export class SkillScanner {
  constructor(private options?: { maxDepth?: number }) {}

  scanDirectory(rootDir: string, anchor: PathAnchor, maxDepth = this.options?.maxDepth ?? DEFAULT_MAX_DEPTH): RegistryComponent[] {
    const results: RegistryComponent[] = [];
    if (!existsSync(rootDir)) return results;

    // The root may itself be a skill directory.
    const rootSkill = join(rootDir, "SKILL.md");
    if (existsSync(rootSkill)) {
      const comp = this.readSkillFile(rootSkill, rootDir, anchor, basename(rootDir));
      if (comp) results.push(comp);
    }

    this.walk(rootDir, rootDir, anchor, 0, maxDepth, results, existsSync(rootSkill));
    return results;
  }

  private walk(
    currentDir: string,
    rootDir: string,
    anchor: PathAnchor,
    currentDepth: number,
    maxDepth: number,
    results: RegistryComponent[],
    insideSkill: boolean
  ): void {
    if (currentDepth > maxDepth) return;

    let entries: string[] = [];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const normEntry = normalizeNFC(entry);
      if (SKIP_DIRS.has(normEntry) || normEntry.startsWith(".") || normEntry.includes("backup")) continue;

      const fullPath = join(currentDir, normEntry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        // agents/ or commands/ nested inside a skill are that skill's helpers,
        // not plugin-level components (skill-creator/agents/grader.md).
        const componentType = insideSkill ? undefined : COMPONENT_DIRS[normEntry];
        if (componentType) {
          this.readComponentDir(fullPath, rootDir, anchor, componentType, results);
          continue;
        }

        const skillFile = join(fullPath, "SKILL.md");
        const isSkill = existsSync(skillFile);
        if (isSkill) {
          const comp = this.readSkillFile(skillFile, rootDir, anchor, normEntry);
          if (comp) results.push(comp);
        }
        // A plugin root can carry its own SKILL.md and still nest skills/<name>/
        // underneath, so a hit must not stop the descent.
        this.walk(fullPath, rootDir, anchor, currentDepth + 1, maxDepth, results, insideSkill || isSkill);
      }
    }
  }

  /** commands/*.md and agents/*.md: one component per file, named by the file. */
  private readComponentDir(dir: string, rootDir: string, anchor: PathAnchor, type: ComponentType, results: RegistryComponent[]): void {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const normEntry = normalizeNFC(entry);
      if (!normEntry.endsWith(".md") || normEntry.startsWith(".")) continue;
      const comp = this.readSkillFile(join(dir, normEntry), rootDir, anchor, normEntry.slice(0, -3), type);
      if (comp) results.push(comp);
    }
  }

  private readSkillFile(
    filePath: string,
    rootDir: string,
    anchor: PathAnchor,
    fallbackName: string,
    type: ComponentType = "skill"
  ): RegistryComponent | null {
    try {
      const content = readFileSync(filePath, "utf8");
      const { name, description } = parseSkillFrontmatter(content, fallbackName);
      const relPath = relative(rootDir, filePath);

      return {
        name: normalizeNFC(name),
        type,
        category: this.inferCategory(name, description),
        description: normalizeNFC(description),
        path_anchor: anchor,
        rel_path: normalizeNFC(relPath),
        source: anchor === "gemini" ? "gemini" : "claude",
        classification: "auto",
      };
    } catch {
      return null;
    }
  }

  /** A first guess for a newly discovered skill; the registry keeps whatever
   * classification the user later settles on (see RegistryManager.upsertScanned). */
  private inferCategory(name: string, description: string): string {
    const text = `${name} ${description}`.toLowerCase();
    for (const [category, pattern] of CATEGORY_PATTERNS) {
      if (pattern.test(text)) return category;
    }
    return "dev";
  }
}
