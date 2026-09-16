import { existsSync, renameSync, statSync } from "fs";
import { resolve, join, relative, isAbsolute, sep } from "path";
import { normalizeNFC } from "./unicode.ts";
import { writeAtomicSync, readJsonOrNull } from "./fs-atomic.ts";
import { DEFAULT_SOURCE } from "./types.ts";
import type { UniversalRegistry, RegistryComponent, CategoryMeta, PathAnchor } from "./types.ts";
import type { ConfigManager } from "./config.ts";

export const DEFAULT_CATEGORIES: Record<string, CategoryMeta> = {
  design: {
    label_ko: "디자인 / UI / 모션",
    label_en: "Design / UI / Motion",
    description_ko: "UI 폴리시, 애니메이션, 컬러/타이포/레이아웃 리뷰, 디자인 시스템",
    description_en: "UI polish, animation, colors/typography/layout review, design systems",
  },
  dev: {
    label_ko: "개발 도구",
    label_en: "Development Tools",
    description_ko: "언어 가이드, 스택 패턴, 개발 유틸리티",
    description_en: "Language guides, tech stack patterns, dev utilities",
  },
  research: {
    label_ko: "리서치 / 웹 스크래핑",
    label_en: "Research / Web Scraping",
    description_ko: "웹 검색, 스크래핑, 브라우저 자동화, 데이터 추출",
    description_en: "Web search, scraping, browser automation, data extraction",
  },
  stock: {
    label_ko: "한국 주식 분석",
    label_en: "Korean Stock Analysis",
    description_ko: "주식 시세, 재무제표, 기업 정보 조회",
    description_en: "Stock market quotes, financial statements, corporate analysis",
  },
  planning: {
    label_ko: "GSD 프로젝트 관리",
    label_en: "GSD Project Planning",
    description_ko: "로드맵, 마일스톤, 이슈 관리",
    description_en: "Roadmap, milestones, issue management",
  },
  pipelines: {
    label_ko: "전체 파이프라인 (단일 선택)",
    label_en: "Full Pipelines (Single Selection)",
    description_ko: "프로젝트 전체 또는 대규모 워크플로우를 주도하는 엔드투엔드 파이프라인",
    description_en: "End-to-end pipelines orchestrating full workflows or multi-phase projects",
  },
};

/** The same skill can be installed in two harnesses, and each harness's gate
 * view must list it, so ids are per source. The default source keeps the bare
 * name for v1 compatibility; others get a suffix (`animate@gemini`). */
export function componentId(c: Pick<RegistryComponent, "name" | "source">): string {
  const name = normalizeNFC(c.name);
  const source = c.source ?? DEFAULT_SOURCE;
  return source === DEFAULT_SOURCE || source === "custom" ? name : `${name}@${source}`;
}

/** Fields the scanner cannot know; the registry's copy wins over a rescan. */
const CLASSIFICATION_FIELDS = [
  "category", "cluster", "domain", "dependencies", "always_on", "description_ko", "description_en", "classification",
] as const;

function isRegistryShape(raw: any): raw is UniversalRegistry {
  return (
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    raw.schema_version === 2 &&
    raw.components !== null &&
    typeof raw.components === "object" &&
    !Array.isArray(raw.components) &&
    raw.categories !== null &&
    typeof raw.categories === "object" &&
    !Array.isArray(raw.categories)
  );
}

/** The Claude-only v1 layout: category_meta plus one array per category. */
function isLegacyV1Shape(raw: any): boolean {
  return (
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    !raw.schema_version &&
    (typeof raw.category_meta === "object" || Object.values(raw).some(Array.isArray))
  );
}

export class RegistryManager {
  private registry: UniversalRegistry;
  private registryPath: string;
  private loadedMtimeMs = 0;

  constructor(private config: ConfigManager) {
    this.registryPath = config.getPaths().registryFile;
    this.registry = this.loadOrInit();
  }

  private loadOrInit(): UniversalRegistry {
    if (!existsSync(this.registryPath)) {
      const legacy = this.legacyRegistryPath();
      const legacyRaw = legacy ? readJsonOrNull<any>(legacy) : null;
      if (legacyRaw && isLegacyV1Shape(legacyRaw)) {
        process.stderr.write(`[master-of] importing v1 registry from ${legacy}\n`);
        return this.migrateV1ToV2(legacyRaw);
      }
      return this.createFresh();
    }

    const raw = readJsonOrNull<any>(this.registryPath);
    if (raw !== null && isLegacyV1Shape(raw)) {
      return this.migrateV1ToV2(raw);
    }
    if (!isRegistryShape(raw)) {
      // Overwriting an unreadable registry in place would destroy a
      // hand-edited or half-written file that is still recoverable.
      const quarantine = `${this.registryPath}.corrupt-${Date.now()}`;
      try {
        renameSync(this.registryPath, quarantine);
        process.stderr.write(
          `[master-of] registry.json was unreadable — moved to ${quarantine}, starting a fresh registry\n`
        );
      } catch {
        process.stderr.write(`[master-of] registry.json is unreadable and could not be quarantined\n`);
      }
      return this.createFresh();
    }

    this.loadedMtimeMs = this.currentMtimeMs();
    return raw;
  }

  private legacyRegistryPath(): string | null {
    const candidate = join(this.config.getPaths().claudeDir, "masterof", "registry.json");
    return existsSync(candidate) ? candidate : null;
  }

  private createFresh(): UniversalRegistry {
    const initial: UniversalRegistry = {
      schema_version: 2,
      updated_at: new Date().toISOString(),
      categories: { ...DEFAULT_CATEGORIES },
      components: {},
    };
    this.save(initial);
    return initial;
  }

  private migrateV1ToV2(v1: any): UniversalRegistry {
    const categories: Record<string, CategoryMeta> = { ...DEFAULT_CATEGORIES };
    for (const [cat, meta] of Object.entries<any>(v1.category_meta || {})) {
      if (cat === "always_on") continue;
      const fallback = DEFAULT_CATEGORIES[cat];
      categories[cat] = {
        label_ko: normalizeNFC(meta.label_ko || fallback?.label_ko || cat),
        label_en: normalizeNFC(meta.label_en || fallback?.label_en || meta.label_ko || cat),
        description_ko: normalizeNFC(meta.desc_ko || meta.description_ko || fallback?.description_ko || ""),
        description_en: normalizeNFC(meta.desc_en || meta.description_en || fallback?.description_en || ""),
        bundle: meta.bundle,
      };
    }

    const components: Record<string, RegistryComponent> = {};
    for (const [cat, entries] of Object.entries<any>(v1)) {
      if (!Array.isArray(entries)) continue;
      for (const item of entries) {
        const sourcePath = normalizeNFC(item?.path || item?.rel_path || "");
        if (!item?.name || !sourcePath) continue;
        const id = normalizeNFC(item.name);
        const { anchor, rel } = this.anchorForAbsolutePath(sourcePath);
        components[id] = {
          name: id,
          type: item.type || "skill",
          category: cat === "always_on" ? item.category || "dev" : cat,
          description: normalizeNFC(item.description || item.description_ko || item.description_en || ""),
          description_ko: item.description_ko ? normalizeNFC(item.description_ko) : undefined,
          description_en: item.description_en ? normalizeNFC(item.description_en) : undefined,
          path_anchor: anchor,
          rel_path: rel,
          cluster: item.cluster,
          domain: item.domain,
          dependencies: item.dependencies || (item.requires?.plugin ? { plugin: item.requires.plugin, critical: !!item.requires.critical } : undefined),
          always_on: cat === "always_on" ? true : item.always_on,
          source: anchor === "gemini" ? "gemini" : "claude",
          classification: "confirmed",
        };
      }
    }

    const v2: UniversalRegistry = {
      schema_version: 2,
      updated_at: new Date().toISOString(),
      categories,
      components,
    };
    this.save(v2);
    return v2;
  }

  /** v1 stored absolute paths; v2 stores them relative to a known root so the
   * registry survives a home-directory move. */
  private anchorForAbsolutePath(absPath: string): { anchor: PathAnchor; rel: string } {
    const paths = this.config.getPaths();
    const within = (root: string) => {
      const r = resolve(root);
      return absPath === r || absPath.startsWith(r + sep);
    };
    if (absPath && within(paths.claudeDir)) return { anchor: "claude", rel: relative(paths.claudeDir, absPath) };
    if (absPath && within(paths.geminiDir)) return { anchor: "gemini", rel: relative(paths.geminiDir, absPath) };
    return { anchor: "custom", rel: absPath };
  }

  private currentMtimeMs(): number {
    try {
      return statSync(this.registryPath).mtimeMs;
    } catch {
      return 0;
    }
  }

  /** A long-lived MCP process must not keep answering from a snapshot after
   * `mo sync` has rewritten the file underneath it. */
  reloadIfChanged(): boolean {
    const mtime = this.currentMtimeMs();
    if (mtime === this.loadedMtimeMs) return false;
    const raw = readJsonOrNull<any>(this.registryPath);
    if (!isRegistryShape(raw)) return false;
    this.registry = raw;
    this.loadedMtimeMs = mtime;
    return true;
  }

  getRegistry(): UniversalRegistry {
    return this.registry;
  }

  /** Accepts a full id (`animate@gemini`) or a bare name; a bare name prefers
   * the default source and falls back to whichever source has it. */
  getComponent(id: string): RegistryComponent | undefined {
    const normId = normalizeNFC(id);
    const exact = this.registry.components[normId];
    if (exact) return exact;
    return Object.values(this.registry.components).find((c) => normalizeNFC(c.name) === normId);
  }

  addComponent(component: RegistryComponent): void {
    this.addComponents([component]);
  }

  /** Writes once for the whole batch — a per-component save reserializes the
   * entire registry on every skill during a full scan. */
  addComponents(components: RegistryComponent[]): void {
    if (components.length === 0) return;

    for (const component of components) {
      const id = componentId(component);
      this.registry.components[id] = {
        ...component,
        name: normalizeNFC(component.name),
        description: normalizeNFC(component.description),
        description_ko: component.description_ko ? normalizeNFC(component.description_ko) : undefined,
      };
    }
    this.registry.updated_at = new Date().toISOString();
    this.save();
  }

  /**
   * Merges a fresh scan into the registry. Discovery fields (description, path,
   * type) refresh from disk; classification the user or a previous run settled
   * on is kept, because a rescan only re-guesses it by regex.
   */
  upsertScanned(scanned: RegistryComponent[]): { added: string[]; updated: string[] } {
    const added: string[] = [];
    const updated: string[] = [];
    const merged: RegistryComponent[] = [];

    for (const incoming of scanned) {
      const existing = this.registry.components[componentId(incoming)];
      if (!existing) {
        added.push(incoming.name);
        merged.push(incoming);
        continue;
      }
      updated.push(incoming.name);
      const next: RegistryComponent = { ...incoming };
      for (const field of CLASSIFICATION_FIELDS) {
        if (existing[field] !== undefined) (next as any)[field] = existing[field];
      }
      merged.push(next);
    }

    this.addComponents(merged);
    return { added, updated };
  }

  /** Settles a component's category (and optionally cluster/domain) by hand. */
  classify(id: string, category: string, extra?: { cluster?: string; domain?: string }): RegistryComponent | null {
    const comp = this.getComponent(id);
    if (!comp) return null;
    if (!this.registry.categories[category]) {
      throw new Error(`Unknown category '${category}'. Known: ${Object.keys(this.registry.categories).join(", ")}`);
    }
    comp.category = category;
    if (extra?.cluster !== undefined) comp.cluster = extra.cluster || undefined;
    if (extra?.domain !== undefined) comp.domain = extra.domain || undefined;
    comp.classification = "confirmed";
    this.registry.updated_at = new Date().toISOString();
    this.save();
    return comp;
  }

  unclassified(): RegistryComponent[] {
    return Object.values(this.registry.components).filter((c) => c.classification === "auto");
  }

  removeComponent(id: string): boolean {
    const comp = this.getComponent(id);
    const normId = comp ? componentId(comp) : normalizeNFC(id);
    if (this.registry.components[normId]) {
      delete this.registry.components[normId];
      this.registry.updated_at = new Date().toISOString();
      this.save();
      return true;
    }
    return false;
  }

  /** Drops components under the given anchors whose file is gone. */
  pruneMissing(anchors: PathAnchor[]): string[] {
    const removed: string[] = [];
    for (const [id, comp] of Object.entries(this.registry.components)) {
      if (!anchors.includes(comp.path_anchor)) continue;
      if (!existsSync(this.resolveFullPath(comp))) {
        delete this.registry.components[id];
        removed.push(id);
      }
    }
    if (removed.length > 0) {
      this.registry.updated_at = new Date().toISOString();
      this.save();
    }
    return removed;
  }

  save(data?: UniversalRegistry): void {
    const target = data || this.registry;
    writeAtomicSync(this.registryPath, JSON.stringify(target, null, 2));
    this.loadedMtimeMs = this.currentMtimeMs();
  }

  /** Never falls back to process.cwd(): an MCP host's launch directory must not
   * change which file a registry entry points at. */
  resolveFullPath(component: RegistryComponent): string {
    if (isAbsolute(component.rel_path)) return component.rel_path;

    const paths = this.config.getPaths();
    const roots: Record<PathAnchor, string> = {
      claude: paths.claudeDir,
      gemini: paths.geminiDir,
      library: join(paths.claudeDir, "skills-library"),
      sandbox: paths.sandboxBoundaryRoot || paths.masterOfHome,
      custom: paths.masterOfHome,
    };
    return resolve(roots[component.path_anchor] || paths.masterOfHome, component.rel_path);
  }
}
