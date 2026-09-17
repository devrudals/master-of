#!/usr/bin/env bun
// @bun

// bin/mo.ts
import { homedir as homedir2 } from "os";
import { readFileSync as readFileSync7, existsSync as existsSync13, readdirSync as readdirSync3, chmodSync as chmodSync2 } from "fs";
import { resolve as resolve9, join as join14 } from "path";

// src/core/config.ts
import { homedir } from "os";
import { join as join2, resolve as resolve2 } from "path";
import { existsSync as existsSync3, mkdirSync as mkdirSync2 } from "fs";

// src/core/boundary.ts
import { resolve, normalize, dirname, sep } from "path";
import { realpathSync, existsSync } from "fs";

class SecurityBoundaryViolation extends Error {
  targetPath;
  boundaryRoot;
  constructor(message, targetPath, boundaryRoot) {
    super(`[SecurityBoundaryViolation] ${message}: target '${targetPath}' is outside boundary '${boundaryRoot}'`);
    this.targetPath = targetPath;
    this.boundaryRoot = boundaryRoot;
    this.name = "SecurityBoundaryViolation";
  }
}
function contains(root, target) {
  if (target === root)
    return true;
  const prefix = root.endsWith(sep) ? root : root + sep;
  return target.startsWith(prefix);
}
function nearestExisting(p) {
  let current = p;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current)
      return null;
    current = parent;
  }
  return current;
}
function assertWithinSandbox(targetPath, boundaryRoot) {
  const normBoundary = normalize(resolve(boundaryRoot));
  const normTarget = normalize(resolve(targetPath));
  if (!contains(normBoundary, normTarget)) {
    throw new SecurityBoundaryViolation("Lexical path escapes sandbox", normTarget, normBoundary);
  }
  if (!existsSync(normBoundary))
    return normTarget;
  const realBoundary = realpathSync(normBoundary);
  if (existsSync(normTarget)) {
    const realTarget = realpathSync(normTarget);
    if (!contains(realBoundary, realTarget)) {
      throw new SecurityBoundaryViolation("Symlink traversal escapes sandbox", realTarget, realBoundary);
    }
    return realTarget;
  }
  const anchor = nearestExisting(normTarget);
  if (anchor) {
    const realAnchor = realpathSync(anchor);
    if (!contains(realBoundary, realAnchor)) {
      throw new SecurityBoundaryViolation("Symlinked parent escapes sandbox", realAnchor, realBoundary);
    }
  }
  return normTarget;
}
function isPathSafe(targetPath, allowedRoots) {
  try {
    const normTarget = normalize(resolve(targetPath));
    return allowedRoots.some((root) => contains(normalize(resolve(root)), normTarget));
  } catch {
    return false;
  }
}

// src/core/fs-atomic.ts
import { writeFileSync, renameSync, mkdirSync, readFileSync, existsSync as existsSync2, unlinkSync } from "fs";
import { dirname as dirname2, join } from "path";

// src/core/unicode.ts
function normalizeNFC(input) {
  if (!input)
    return "";
  return input.normalize("NFC");
}
function safeIncludes(haystack, needle) {
  if (!haystack || !needle)
    return false;
  const normHaystack = normalizeNFC(haystack).toLowerCase();
  const normNeedle = normalizeNFC(needle).toLowerCase().trim();
  return normHaystack.includes(normNeedle);
}
function estimateTokens(text) {
  if (!text)
    return 0;
  const normalized = normalizeNFC(text);
  let cjkCount = 0;
  let asciiCount = 0;
  for (let i = 0;i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    if (code >= 44032 && code <= 55215 || code >= 4352 && code <= 4607 || code >= 19968 && code <= 40959) {
      cjkCount++;
    } else {
      asciiCount++;
    }
  }
  return Math.round(cjkCount / 1.5 + asciiCount / 4);
}

// src/core/fs-atomic.ts
function writeAtomicSync(targetPath, content) {
  const dir = dirname2(targetPath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`);
  try {
    writeFileSync(tmpPath, normalizeNFC(content), "utf8");
    renameSync(tmpPath, targetPath);
  } catch (err) {
    if (existsSync2(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch {}
    }
    throw err;
  }
}
function readJsonOrNull(filePath) {
  try {
    if (!existsSync2(filePath))
      return null;
    const content = readFileSync(filePath, "utf8");
    return JSON.parse(normalizeNFC(content));
  } catch {
    return null;
  }
}
function readJsonSafe(filePath, fallback) {
  const parsed = readJsonOrNull(filePath);
  return parsed === null ? fallback : parsed;
}

// src/core/config.ts
class ConfigManager {
  paths;
  constructor(options) {
    const isSandbox = Boolean(options?.sandboxRoot || process.env.MASTER_OF_SANDBOX);
    const sandboxBoundary = options?.sandboxRoot || process.env.MASTER_OF_SANDBOX_ROOT;
    if (isSandbox && !sandboxBoundary) {
      throw new Error("MASTER_OF_SANDBOX is set but no boundary was given (MASTER_OF_SANDBOX_ROOT or --sandbox <dir>)");
    }
    let baseDir = options?.dataDir || process.env.MASTER_OF_HOME;
    if (!baseDir) {
      if (isSandbox && sandboxBoundary) {
        baseDir = join2(sandboxBoundary, "masterof-home");
      } else {
        baseDir = join2(homedir(), ".master-of");
      }
    }
    baseDir = resolve2(baseDir);
    if (isSandbox && sandboxBoundary) {
      assertWithinSandbox(baseDir, sandboxBoundary);
    }
    const claudeDir = options?.claudeDir || (isSandbox && sandboxBoundary ? join2(sandboxBoundary, "mock-claude") : join2(homedir(), ".claude"));
    const geminiDir = options?.geminiDir || (isSandbox && sandboxBoundary ? join2(sandboxBoundary, "mock-gemini") : join2(homedir(), ".gemini"));
    this.paths = {
      masterOfHome: baseDir,
      gatesDir: join2(baseDir, "gates"),
      registryFile: join2(baseDir, "registry.json"),
      preferencesFile: join2(baseDir, "preferences.json"),
      configFile: join2(baseDir, "config.json"),
      reportFile: join2(baseDir, "report.txt"),
      briefReportFile: join2(baseDir, "report-brief.txt"),
      claudeDir,
      geminiDir,
      isSandbox,
      sandboxBoundaryRoot: sandboxBoundary
    };
    mkdirSync2(this.paths.masterOfHome, { recursive: true });
    mkdirSync2(this.paths.gatesDir, { recursive: true });
  }
  getPaths() {
    return this.paths;
  }
  ensureConfigFile() {
    const fallback = {
      report_language: "ko",
      report_language_name: "Korean",
      determined_at: new Date().toISOString(),
      determined_from: "master-of v2 universal bootstrap"
    };
    if (!existsSync3(this.paths.configFile)) {
      writeAtomicSync(this.paths.configFile, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    return readJsonSafe(this.paths.configFile, fallback);
  }
  ensurePreferencesFile() {
    const fallback = {
      design: { mode: "always_ask" },
      dev: { mode: "always_ask" },
      research: { mode: "always_ask" },
      stock: { mode: "always_ask" },
      planning: { mode: "always_ask" },
      pipelines: { mode: "always_ask" }
    };
    if (!existsSync3(this.paths.preferencesFile)) {
      writeAtomicSync(this.paths.preferencesFile, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    return readJsonSafe(this.paths.preferencesFile, fallback);
  }
}

// src/core/registry.ts
import { existsSync as existsSync4, renameSync as renameSync2, statSync } from "fs";
import { resolve as resolve3, join as join3, relative, isAbsolute, sep as sep2 } from "path";

// src/core/types.ts
var DEFAULT_SOURCE = "claude";

// src/core/registry.ts
var DEFAULT_CATEGORIES = {
  design: {
    label_ko: "디자인 / UI / 모션",
    label_en: "Design / UI / Motion",
    description_ko: "UI 폴리시, 애니메이션, 컬러/타이포/레이아웃 리뷰, 디자인 시스템",
    description_en: "UI polish, animation, colors/typography/layout review, design systems"
  },
  dev: {
    label_ko: "개발 도구",
    label_en: "Development Tools",
    description_ko: "언어 가이드, 스택 패턴, 개발 유틸리티",
    description_en: "Language guides, tech stack patterns, dev utilities"
  },
  research: {
    label_ko: "리서치 / 웹 스크래핑",
    label_en: "Research / Web Scraping",
    description_ko: "웹 검색, 스크래핑, 브라우저 자동화, 데이터 추출",
    description_en: "Web search, scraping, browser automation, data extraction"
  },
  stock: {
    label_ko: "한국 주식 분석",
    label_en: "Korean Stock Analysis",
    description_ko: "주식 시세, 재무제표, 기업 정보 조회",
    description_en: "Stock market quotes, financial statements, corporate analysis"
  },
  planning: {
    label_ko: "GSD 프로젝트 관리",
    label_en: "GSD Project Planning",
    description_ko: "로드맵, 마일스톤, 이슈 관리",
    description_en: "Roadmap, milestones, issue management"
  },
  pipelines: {
    label_ko: "전체 파이프라인 (단일 선택)",
    label_en: "Full Pipelines (Single Selection)",
    description_ko: "프로젝트 전체 또는 대규모 워크플로우를 주도하는 엔드투엔드 파이프라인",
    description_en: "End-to-end pipelines orchestrating full workflows or multi-phase projects"
  }
};
function componentId(c) {
  const name = normalizeNFC(c.name);
  const source = c.source ?? DEFAULT_SOURCE;
  return source === DEFAULT_SOURCE || source === "custom" ? name : `${name}@${source}`;
}
var CLASSIFICATION_FIELDS = [
  "category",
  "cluster",
  "domain",
  "dependencies",
  "description_ko",
  "description_en",
  "classification"
];
function isRegistryShape(raw) {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) && raw.schema_version === 2 && raw.components !== null && typeof raw.components === "object" && !Array.isArray(raw.components) && raw.categories !== null && typeof raw.categories === "object" && !Array.isArray(raw.categories);
}
function isLegacyV1Shape(raw) {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) && !raw.schema_version && (typeof raw.category_meta === "object" || Object.values(raw).some(Array.isArray));
}

class RegistryManager {
  config;
  registry;
  registryPath;
  loadedMtimeMs = 0;
  constructor(config) {
    this.config = config;
    this.registryPath = config.getPaths().registryFile;
    this.registry = this.loadOrInit();
  }
  loadOrInit() {
    if (!existsSync4(this.registryPath)) {
      const legacy = this.legacyRegistryPath();
      const legacyRaw = legacy ? readJsonOrNull(legacy) : null;
      if (legacyRaw && isLegacyV1Shape(legacyRaw)) {
        process.stderr.write(`[master-of] importing v1 registry from ${legacy}
`);
        return this.migrateV1ToV2(legacyRaw);
      }
      return this.createFresh();
    }
    const raw = readJsonOrNull(this.registryPath);
    if (raw !== null && isLegacyV1Shape(raw)) {
      return this.migrateV1ToV2(raw);
    }
    if (!isRegistryShape(raw)) {
      const quarantine = `${this.registryPath}.corrupt-${Date.now()}`;
      try {
        renameSync2(this.registryPath, quarantine);
        process.stderr.write(`[master-of] registry.json was unreadable — moved to ${quarantine}, starting a fresh registry
`);
      } catch {
        process.stderr.write(`[master-of] registry.json is unreadable and could not be quarantined
`);
      }
      return this.createFresh();
    }
    this.loadedMtimeMs = this.currentMtimeMs();
    return raw;
  }
  legacyRegistryPath() {
    const candidate = join3(this.config.getPaths().claudeDir, "masterof", "registry.json");
    return existsSync4(candidate) ? candidate : null;
  }
  createFresh() {
    const initial = {
      schema_version: 2,
      updated_at: new Date().toISOString(),
      categories: { ...DEFAULT_CATEGORIES },
      components: {}
    };
    this.save(initial);
    return initial;
  }
  migrateV1ToV2(v1) {
    const categories = { ...DEFAULT_CATEGORIES };
    for (const [cat, meta] of Object.entries(v1.category_meta || {})) {
      if (cat === "always_on")
        continue;
      const fallback = DEFAULT_CATEGORIES[cat];
      categories[cat] = {
        label_ko: normalizeNFC(meta.label_ko || fallback?.label_ko || cat),
        label_en: normalizeNFC(meta.label_en || fallback?.label_en || meta.label_ko || cat),
        description_ko: normalizeNFC(meta.desc_ko || meta.description_ko || fallback?.description_ko || ""),
        description_en: normalizeNFC(meta.desc_en || meta.description_en || fallback?.description_en || ""),
        bundle: meta.bundle
      };
    }
    const components = {};
    for (const [cat, entries] of Object.entries(v1)) {
      if (!Array.isArray(entries))
        continue;
      for (const item of entries) {
        const sourcePath = normalizeNFC(item?.path || item?.rel_path || "");
        if (!item?.name || !sourcePath)
          continue;
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
          classification: "confirmed"
        };
      }
    }
    const v2 = {
      schema_version: 2,
      updated_at: new Date().toISOString(),
      categories,
      components
    };
    this.save(v2);
    return v2;
  }
  anchorForAbsolutePath(absPath) {
    const paths = this.config.getPaths();
    const within = (root) => {
      const r = resolve3(root);
      return absPath === r || absPath.startsWith(r + sep2);
    };
    if (absPath && within(paths.claudeDir))
      return { anchor: "claude", rel: relative(paths.claudeDir, absPath) };
    if (absPath && within(paths.geminiDir))
      return { anchor: "gemini", rel: relative(paths.geminiDir, absPath) };
    return { anchor: "custom", rel: absPath };
  }
  currentMtimeMs() {
    try {
      return statSync(this.registryPath).mtimeMs;
    } catch {
      return 0;
    }
  }
  reloadIfChanged() {
    const mtime = this.currentMtimeMs();
    if (mtime === this.loadedMtimeMs)
      return false;
    const raw = readJsonOrNull(this.registryPath);
    if (!isRegistryShape(raw))
      return false;
    this.registry = raw;
    this.loadedMtimeMs = mtime;
    return true;
  }
  getRegistry() {
    return this.registry;
  }
  getComponent(id) {
    const normId = normalizeNFC(id);
    const exact = this.registry.components[normId];
    if (exact)
      return exact;
    return Object.values(this.registry.components).find((c) => normalizeNFC(c.name) === normId);
  }
  idsForName(name) {
    const normName = normalizeNFC(name);
    return Object.entries(this.registry.components).filter(([, c]) => normalizeNFC(c.name) === normName).map(([id]) => id).sort();
  }
  findBySourceSuffix(id) {
    const at = id.lastIndexOf("@");
    if (at <= 0)
      return;
    const name = normalizeNFC(id.slice(0, at));
    const source = id.slice(at + 1).toLowerCase();
    return Object.values(this.registry.components).find((c) => normalizeNFC(c.name) === name && (c.source ?? DEFAULT_SOURCE) === source);
  }
  resolveOne(id) {
    const normId = normalizeNFC(id);
    const suffixed = this.findBySourceSuffix(normId);
    if (suffixed)
      return suffixed;
    const ids = this.idsForName(normId);
    if (ids.length === 1)
      return this.registry.components[ids[0]];
    if (ids.length > 1) {
      const choices = ids.map((i) => i.includes("@") ? i : `${i}@${this.registry.components[i].source ?? DEFAULT_SOURCE}`).join(", ");
      throw new Error(`'${normId}' exists in more than one source — name one of: ${choices}`);
    }
    throw new Error(`Component '${normId}' not found in the registry.`);
  }
  addComponent(component) {
    this.addComponents([component]);
  }
  addComponents(components) {
    if (components.length === 0)
      return;
    for (const component of components) {
      const id = componentId(component);
      this.registry.components[id] = {
        ...component,
        name: normalizeNFC(component.name),
        description: normalizeNFC(component.description),
        description_ko: component.description_ko ? normalizeNFC(component.description_ko) : undefined
      };
    }
    this.registry.updated_at = new Date().toISOString();
    this.save();
  }
  upsertScanned(scanned) {
    const added = [];
    const updated = [];
    const merged = [];
    for (const incoming of scanned) {
      const existing = this.registry.components[componentId(incoming)];
      if (!existing) {
        added.push(incoming.name);
        merged.push(incoming);
        continue;
      }
      updated.push(incoming.name);
      const next = { ...incoming };
      for (const field of CLASSIFICATION_FIELDS) {
        if (existing[field] !== undefined)
          next[field] = existing[field];
      }
      merged.push(next);
    }
    this.addComponents(merged);
    return { added, updated };
  }
  classify(id, category, extra) {
    const comp = this.resolveOne(id);
    if (!this.registry.categories[category]) {
      throw new Error(`Unknown category '${category}'. Known: ${Object.keys(this.registry.categories).join(", ")}`);
    }
    comp.category = category;
    if (extra?.cluster !== undefined)
      comp.cluster = extra.cluster || undefined;
    if (extra?.domain !== undefined)
      comp.domain = extra.domain || undefined;
    if (comp.classification === "ignored")
      comp.classification = "auto";
    if (extra?.description) {
      if (extra.language === "en")
        comp.description_en = normalizeNFC(extra.description);
      else
        comp.description_ko = normalizeNFC(extra.description);
    }
    comp.classification = "confirmed";
    this.registry.updated_at = new Date().toISOString();
    this.save();
    return comp;
  }
  ignore(id) {
    const comp = this.resolveOne(id);
    comp.classification = "ignored";
    this.registry.updated_at = new Date().toISOString();
    this.save();
    return comp;
  }
  static isGated(c) {
    return !c.always_on && c.classification !== "ignored";
  }
  unclassified() {
    return Object.values(this.registry.components).filter((c) => c.classification === "auto" && RegistryManager.isGated(c));
  }
  removeComponent(id) {
    let normId = normalizeNFC(id);
    try {
      normId = componentId(this.resolveOne(id));
    } catch (err) {
      if (/more than one source/.test(err.message))
        throw err;
      return false;
    }
    if (this.registry.components[normId]) {
      delete this.registry.components[normId];
      this.registry.updated_at = new Date().toISOString();
      this.save();
      return true;
    }
    return false;
  }
  pruneMissing(anchors) {
    const removed = [];
    for (const [id, comp] of Object.entries(this.registry.components)) {
      if (!anchors.includes(comp.path_anchor))
        continue;
      if (!existsSync4(this.resolveFullPath(comp))) {
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
  save(data) {
    const target = data || this.registry;
    writeAtomicSync(this.registryPath, JSON.stringify(target, null, 2));
    this.loadedMtimeMs = this.currentMtimeMs();
  }
  resolveFullPath(component) {
    if (isAbsolute(component.rel_path))
      return component.rel_path;
    const paths = this.config.getPaths();
    const roots = {
      claude: paths.claudeDir,
      gemini: paths.geminiDir,
      library: join3(paths.claudeDir, "skills-library"),
      sandbox: paths.sandboxBoundaryRoot || paths.masterOfHome,
      custom: paths.masterOfHome
    };
    return resolve3(roots[component.path_anchor] || paths.masterOfHome, component.rel_path);
  }
}

// src/core/scanner.ts
import { readdirSync, statSync as statSync2, readFileSync as readFileSync2, existsSync as existsSync5 } from "fs";
import { join as join4, relative as relative2, basename } from "path";
var SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".turbo",
  "dist",
  "build",
  ".next",
  ".cache",
  "coverage",
  ".system_generated",
  "projects",
  "todos",
  "shell-snapshots",
  "statsig",
  "debug",
  "logs",
  "history",
  "sessions",
  "transcripts",
  "tmp",
  "temp",
  "marketplaces",
  "master-of"
]);
var DEFAULT_MAX_DEPTH = 8;
var COMPONENT_DIRS = { commands: "command", agents: "agent" };
var CATEGORY_PATTERNS = [
  ["pipelines", /\b(pipeline|workflow|end-to-end|paint|impeccable|lifecycle)\b|오케스트레이션|파이프라인/],
  ["design", /\b(design|ui|ux|motion|animat\w*|css|styl(e|ing)|tailwind|colou?rs?|fonts?|typography|figma|layout)\b|디자인|모션|애니메이션|인터랙션/],
  ["stock", /\b(stocks?|finance|financial|market|invest\w*|krx|ticker|equit(y|ies))\b|주식|증권|재무/],
  ["planning", /\b(plan|planning|gsd|milestones?|roadmap|spec|backlog|issues?|sprint)\b|기획|스프린트|마일스톤|백로그/],
  ["research", /\b(research|scrap(e|ing)|web ?search|crawl\w*|fetch\w*|browser|extract\w*)\b|리서치|스크랩|크롤링/]
];
function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (first === '"' && last === '"' || first === "'" && last === "'") {
      return value.slice(1, -1);
    }
  }
  return value;
}
function parseFrontmatterFields(yaml) {
  const lines = yaml.split(/\r?\n/);
  const fields = {};
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
    const body = [];
    while (i < lines.length && (lines[i].trim() === "" || /^[ \t]/.test(lines[i]))) {
      body.push(lines[i].trim());
      i++;
    }
    const isBlockScalar = /^[|>][-+]?$/.test(head);
    const isLiteral = head.startsWith("|");
    const parts = isBlockScalar ? body : [head, ...body];
    const joined = isLiteral ? parts.join(`
`) : parts.join(" ").replace(/\s+/g, " ");
    fields[key] = unquote(joined.trim()).trim();
  }
  return fields;
}
function parseSkillFrontmatter(content, fallbackName) {
  const norm = normalizeNFC(content);
  const match = norm.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let name = fallbackName;
  let description = "";
  if (match) {
    const fields = parseFrontmatterFields(match[1]);
    if (fields.name)
      name = fields.name;
    if (fields.description)
      description = fields.description.replace(/\s+/g, " ").trim();
  }
  if (!description) {
    const body = match ? norm.slice(match.index + match[0].length) : norm;
    const firstLine = body.split(/\r?\n/).find((l) => l.trim());
    if (firstLine)
      description = firstLine.replace(/^#+\s*/, "").trim();
  }
  return { name: normalizeNFC(name), description: normalizeNFC(description) };
}
function dedupeByName(components, fullPathOf) {
  const mtimes = new Map;
  const mtimeOf = (c) => {
    if (!fullPathOf)
      return 0;
    const cached = mtimes.get(c);
    if (cached !== undefined)
      return cached;
    let m = 0;
    try {
      m = statSync2(fullPathOf(c)).mtimeMs;
    } catch {}
    mtimes.set(c, m);
    return m;
  };
  const depthOf = (c) => c.rel_path.split(/[\\/]/).length;
  const sorted = [...components].sort((a, b) => depthOf(a) - depthOf(b) || mtimeOf(b) - mtimeOf(a) || `${a.path_anchor}:${a.rel_path}`.localeCompare(`${b.path_anchor}:${b.rel_path}`));
  const byName = new Map;
  const dropped = new Map;
  for (const comp of sorted) {
    const id = `${comp.source ?? DEFAULT_SOURCE}:${normalizeNFC(comp.name)}`;
    if (byName.has(id)) {
      (dropped.get(id) ?? dropped.set(id, []).get(id)).push(comp.rel_path);
    } else {
      byName.set(id, comp);
    }
  }
  const collisions = [...dropped.entries()].map(([id, paths]) => ({ name: byName.get(id).name, kept: byName.get(id).rel_path, dropped: paths }));
  return { unique: [...byName.values()], collisions };
}

class SkillScanner {
  options;
  constructor(options) {
    this.options = options;
  }
  scanDirectory(rootDir, anchor, maxDepth = this.options?.maxDepth ?? DEFAULT_MAX_DEPTH) {
    const results = [];
    if (!existsSync5(rootDir))
      return results;
    const rootSkill = join4(rootDir, "SKILL.md");
    if (existsSync5(rootSkill)) {
      const comp = this.readSkillFile(rootSkill, rootDir, anchor, basename(rootDir));
      if (comp)
        results.push(comp);
    }
    this.walk(rootDir, rootDir, anchor, 0, maxDepth, results, existsSync5(rootSkill));
    return results;
  }
  walk(currentDir, rootDir, anchor, currentDepth, maxDepth, results, insideSkill) {
    if (currentDepth > maxDepth)
      return;
    let entries = [];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const normEntry = normalizeNFC(entry);
      if (SKIP_DIRS.has(normEntry) || normEntry.startsWith(".") || normEntry.includes("backup"))
        continue;
      const fullPath = join4(currentDir, normEntry);
      let stat;
      try {
        stat = statSync2(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        const componentType = insideSkill ? undefined : COMPONENT_DIRS[normEntry];
        if (componentType) {
          this.readComponentDir(fullPath, rootDir, anchor, componentType, results);
          continue;
        }
        const skillFile = join4(fullPath, "SKILL.md");
        const isSkill = existsSync5(skillFile);
        if (isSkill) {
          const comp = this.readSkillFile(skillFile, rootDir, anchor, normEntry);
          if (comp)
            results.push(comp);
        }
        this.walk(fullPath, rootDir, anchor, currentDepth + 1, maxDepth, results, insideSkill || isSkill);
      }
    }
  }
  readComponentDir(dir, rootDir, anchor, type, results) {
    let entries = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const normEntry = normalizeNFC(entry);
      if (!normEntry.endsWith(".md") || normEntry.startsWith("."))
        continue;
      const comp = this.readSkillFile(join4(dir, normEntry), rootDir, anchor, normEntry.slice(0, -3), type);
      if (comp)
        results.push(comp);
    }
  }
  readSkillFile(filePath, rootDir, anchor, fallbackName, type = "skill") {
    try {
      const content = readFileSync2(filePath, "utf8");
      const { name, description } = parseSkillFrontmatter(content, fallbackName);
      const relPath = relative2(rootDir, filePath);
      return {
        name: normalizeNFC(name),
        type,
        category: this.inferCategory(name, description),
        description: normalizeNFC(description),
        path_anchor: anchor,
        rel_path: normalizeNFC(relPath),
        source: anchor === "gemini" ? "gemini" : "claude",
        classification: "auto"
      };
    } catch {
      return null;
    }
  }
  inferCategory(name, description) {
    const text = `${name} ${description}`.toLowerCase();
    for (const [category, pattern] of CATEGORY_PATTERNS) {
      if (pattern.test(text))
        return category;
    }
    return "dev";
  }
}

// src/core/reporter.ts
import { join as join6 } from "path";

// src/core/gates.ts
import { resolve as resolve4 } from "path";
var PLAIN_NAME = /^[a-z0-9_][a-z0-9_-]*$/;
function gateFilePath(gatesDir, source, category) {
  return resolve4(gatesDir, source, `${category}.txt`);
}
function resolveGateFile(gatesDir, rawGate, rawSource = DEFAULT_SOURCE) {
  const gate = normalizeNFC(rawGate).trim().toLowerCase();
  const source = normalizeNFC(rawSource).trim().toLowerCase();
  if (!PLAIN_NAME.test(gate) || !PLAIN_NAME.test(source))
    return null;
  const gateFile = gateFilePath(gatesDir, source, gate);
  if (!isPathSafe(gateFile, [gatesDir]))
    return null;
  return gateFile;
}

// src/core/registry.ts
import { existsSync as existsSync6, renameSync as renameSync3, statSync as statSync3 } from "fs";
import { resolve as resolve5, join as join5, relative as relative3, isAbsolute as isAbsolute2, sep as sep3 } from "path";
var DEFAULT_CATEGORIES2 = {
  design: {
    label_ko: "디자인 / UI / 모션",
    label_en: "Design / UI / Motion",
    description_ko: "UI 폴리시, 애니메이션, 컬러/타이포/레이아웃 리뷰, 디자인 시스템",
    description_en: "UI polish, animation, colors/typography/layout review, design systems"
  },
  dev: {
    label_ko: "개발 도구",
    label_en: "Development Tools",
    description_ko: "언어 가이드, 스택 패턴, 개발 유틸리티",
    description_en: "Language guides, tech stack patterns, dev utilities"
  },
  research: {
    label_ko: "리서치 / 웹 스크래핑",
    label_en: "Research / Web Scraping",
    description_ko: "웹 검색, 스크래핑, 브라우저 자동화, 데이터 추출",
    description_en: "Web search, scraping, browser automation, data extraction"
  },
  stock: {
    label_ko: "한국 주식 분석",
    label_en: "Korean Stock Analysis",
    description_ko: "주식 시세, 재무제표, 기업 정보 조회",
    description_en: "Stock market quotes, financial statements, corporate analysis"
  },
  planning: {
    label_ko: "GSD 프로젝트 관리",
    label_en: "GSD Project Planning",
    description_ko: "로드맵, 마일스톤, 이슈 관리",
    description_en: "Roadmap, milestones, issue management"
  },
  pipelines: {
    label_ko: "전체 파이프라인 (단일 선택)",
    label_en: "Full Pipelines (Single Selection)",
    description_ko: "프로젝트 전체 또는 대규모 워크플로우를 주도하는 엔드투엔드 파이프라인",
    description_en: "End-to-end pipelines orchestrating full workflows or multi-phase projects"
  }
};
function componentId2(c) {
  const name = normalizeNFC(c.name);
  const source = c.source ?? DEFAULT_SOURCE;
  return source === DEFAULT_SOURCE || source === "custom" ? name : `${name}@${source}`;
}
var CLASSIFICATION_FIELDS2 = [
  "category",
  "cluster",
  "domain",
  "dependencies",
  "description_ko",
  "description_en",
  "classification"
];
function isRegistryShape2(raw) {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) && raw.schema_version === 2 && raw.components !== null && typeof raw.components === "object" && !Array.isArray(raw.components) && raw.categories !== null && typeof raw.categories === "object" && !Array.isArray(raw.categories);
}
function isLegacyV1Shape2(raw) {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) && !raw.schema_version && (typeof raw.category_meta === "object" || Object.values(raw).some(Array.isArray));
}

class RegistryManager2 {
  config;
  registry;
  registryPath;
  loadedMtimeMs = 0;
  constructor(config) {
    this.config = config;
    this.registryPath = config.getPaths().registryFile;
    this.registry = this.loadOrInit();
  }
  loadOrInit() {
    if (!existsSync6(this.registryPath)) {
      const legacy = this.legacyRegistryPath();
      const legacyRaw = legacy ? readJsonOrNull(legacy) : null;
      if (legacyRaw && isLegacyV1Shape2(legacyRaw)) {
        process.stderr.write(`[master-of] importing v1 registry from ${legacy}
`);
        return this.migrateV1ToV2(legacyRaw);
      }
      return this.createFresh();
    }
    const raw = readJsonOrNull(this.registryPath);
    if (raw !== null && isLegacyV1Shape2(raw)) {
      return this.migrateV1ToV2(raw);
    }
    if (!isRegistryShape2(raw)) {
      const quarantine = `${this.registryPath}.corrupt-${Date.now()}`;
      try {
        renameSync3(this.registryPath, quarantine);
        process.stderr.write(`[master-of] registry.json was unreadable — moved to ${quarantine}, starting a fresh registry
`);
      } catch {
        process.stderr.write(`[master-of] registry.json is unreadable and could not be quarantined
`);
      }
      return this.createFresh();
    }
    this.loadedMtimeMs = this.currentMtimeMs();
    return raw;
  }
  legacyRegistryPath() {
    const candidate = join5(this.config.getPaths().claudeDir, "masterof", "registry.json");
    return existsSync6(candidate) ? candidate : null;
  }
  createFresh() {
    const initial = {
      schema_version: 2,
      updated_at: new Date().toISOString(),
      categories: { ...DEFAULT_CATEGORIES2 },
      components: {}
    };
    this.save(initial);
    return initial;
  }
  migrateV1ToV2(v1) {
    const categories = { ...DEFAULT_CATEGORIES2 };
    for (const [cat, meta] of Object.entries(v1.category_meta || {})) {
      if (cat === "always_on")
        continue;
      const fallback = DEFAULT_CATEGORIES2[cat];
      categories[cat] = {
        label_ko: normalizeNFC(meta.label_ko || fallback?.label_ko || cat),
        label_en: normalizeNFC(meta.label_en || fallback?.label_en || meta.label_ko || cat),
        description_ko: normalizeNFC(meta.desc_ko || meta.description_ko || fallback?.description_ko || ""),
        description_en: normalizeNFC(meta.desc_en || meta.description_en || fallback?.description_en || ""),
        bundle: meta.bundle
      };
    }
    const components = {};
    for (const [cat, entries] of Object.entries(v1)) {
      if (!Array.isArray(entries))
        continue;
      for (const item of entries) {
        const sourcePath = normalizeNFC(item?.path || item?.rel_path || "");
        if (!item?.name || !sourcePath)
          continue;
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
          classification: "confirmed"
        };
      }
    }
    const v2 = {
      schema_version: 2,
      updated_at: new Date().toISOString(),
      categories,
      components
    };
    this.save(v2);
    return v2;
  }
  anchorForAbsolutePath(absPath) {
    const paths = this.config.getPaths();
    const within = (root) => {
      const r = resolve5(root);
      return absPath === r || absPath.startsWith(r + sep3);
    };
    if (absPath && within(paths.claudeDir))
      return { anchor: "claude", rel: relative3(paths.claudeDir, absPath) };
    if (absPath && within(paths.geminiDir))
      return { anchor: "gemini", rel: relative3(paths.geminiDir, absPath) };
    return { anchor: "custom", rel: absPath };
  }
  currentMtimeMs() {
    try {
      return statSync3(this.registryPath).mtimeMs;
    } catch {
      return 0;
    }
  }
  reloadIfChanged() {
    const mtime = this.currentMtimeMs();
    if (mtime === this.loadedMtimeMs)
      return false;
    const raw = readJsonOrNull(this.registryPath);
    if (!isRegistryShape2(raw))
      return false;
    this.registry = raw;
    this.loadedMtimeMs = mtime;
    return true;
  }
  getRegistry() {
    return this.registry;
  }
  getComponent(id) {
    const normId = normalizeNFC(id);
    const exact = this.registry.components[normId];
    if (exact)
      return exact;
    return Object.values(this.registry.components).find((c) => normalizeNFC(c.name) === normId);
  }
  idsForName(name) {
    const normName = normalizeNFC(name);
    return Object.entries(this.registry.components).filter(([, c]) => normalizeNFC(c.name) === normName).map(([id]) => id).sort();
  }
  findBySourceSuffix(id) {
    const at = id.lastIndexOf("@");
    if (at <= 0)
      return;
    const name = normalizeNFC(id.slice(0, at));
    const source = id.slice(at + 1).toLowerCase();
    return Object.values(this.registry.components).find((c) => normalizeNFC(c.name) === name && (c.source ?? DEFAULT_SOURCE) === source);
  }
  resolveOne(id) {
    const normId = normalizeNFC(id);
    const suffixed = this.findBySourceSuffix(normId);
    if (suffixed)
      return suffixed;
    const ids = this.idsForName(normId);
    if (ids.length === 1)
      return this.registry.components[ids[0]];
    if (ids.length > 1) {
      const choices = ids.map((i) => i.includes("@") ? i : `${i}@${this.registry.components[i].source ?? DEFAULT_SOURCE}`).join(", ");
      throw new Error(`'${normId}' exists in more than one source — name one of: ${choices}`);
    }
    throw new Error(`Component '${normId}' not found in the registry.`);
  }
  addComponent(component) {
    this.addComponents([component]);
  }
  addComponents(components) {
    if (components.length === 0)
      return;
    for (const component of components) {
      const id = componentId2(component);
      this.registry.components[id] = {
        ...component,
        name: normalizeNFC(component.name),
        description: normalizeNFC(component.description),
        description_ko: component.description_ko ? normalizeNFC(component.description_ko) : undefined
      };
    }
    this.registry.updated_at = new Date().toISOString();
    this.save();
  }
  upsertScanned(scanned) {
    const added = [];
    const updated = [];
    const merged = [];
    for (const incoming of scanned) {
      const existing = this.registry.components[componentId2(incoming)];
      if (!existing) {
        added.push(incoming.name);
        merged.push(incoming);
        continue;
      }
      updated.push(incoming.name);
      const next = { ...incoming };
      for (const field of CLASSIFICATION_FIELDS2) {
        if (existing[field] !== undefined)
          next[field] = existing[field];
      }
      merged.push(next);
    }
    this.addComponents(merged);
    return { added, updated };
  }
  classify(id, category, extra) {
    const comp = this.resolveOne(id);
    if (!this.registry.categories[category]) {
      throw new Error(`Unknown category '${category}'. Known: ${Object.keys(this.registry.categories).join(", ")}`);
    }
    comp.category = category;
    if (extra?.cluster !== undefined)
      comp.cluster = extra.cluster || undefined;
    if (extra?.domain !== undefined)
      comp.domain = extra.domain || undefined;
    if (comp.classification === "ignored")
      comp.classification = "auto";
    if (extra?.description) {
      if (extra.language === "en")
        comp.description_en = normalizeNFC(extra.description);
      else
        comp.description_ko = normalizeNFC(extra.description);
    }
    comp.classification = "confirmed";
    this.registry.updated_at = new Date().toISOString();
    this.save();
    return comp;
  }
  ignore(id) {
    const comp = this.resolveOne(id);
    comp.classification = "ignored";
    this.registry.updated_at = new Date().toISOString();
    this.save();
    return comp;
  }
  static isGated(c) {
    return !c.always_on && c.classification !== "ignored";
  }
  unclassified() {
    return Object.values(this.registry.components).filter((c) => c.classification === "auto" && RegistryManager2.isGated(c));
  }
  removeComponent(id) {
    let normId = normalizeNFC(id);
    try {
      normId = componentId2(this.resolveOne(id));
    } catch (err) {
      if (/more than one source/.test(err.message))
        throw err;
      return false;
    }
    if (this.registry.components[normId]) {
      delete this.registry.components[normId];
      this.registry.updated_at = new Date().toISOString();
      this.save();
      return true;
    }
    return false;
  }
  pruneMissing(anchors) {
    const removed = [];
    for (const [id, comp] of Object.entries(this.registry.components)) {
      if (!anchors.includes(comp.path_anchor))
        continue;
      if (!existsSync6(this.resolveFullPath(comp))) {
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
  save(data) {
    const target = data || this.registry;
    writeAtomicSync(this.registryPath, JSON.stringify(target, null, 2));
    this.loadedMtimeMs = this.currentMtimeMs();
  }
  resolveFullPath(component) {
    if (isAbsolute2(component.rel_path))
      return component.rel_path;
    const paths = this.config.getPaths();
    const roots = {
      claude: paths.claudeDir,
      gemini: paths.geminiDir,
      library: join5(paths.claudeDir, "skills-library"),
      sandbox: paths.sandboxBoundaryRoot || paths.masterOfHome,
      custom: paths.masterOfHome
    };
    return resolve5(roots[component.path_anchor] || paths.masterOfHome, component.rel_path);
  }
}

// src/core/reporter.ts
var GATE_DESCRIPTION_MAX = 200;
function clipDescription(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= GATE_DESCRIPTION_MAX)
    return flat;
  const head = flat.slice(0, GATE_DESCRIPTION_MAX);
  const sentenceEnd = Math.max(head.lastIndexOf(". "), head.lastIndexOf("。"), head.lastIndexOf("다. "));
  const cut = sentenceEnd > GATE_DESCRIPTION_MAX / 2 ? sentenceEnd + 1 : head.lastIndexOf(" ");
  return `${flat.slice(0, cut > 0 ? cut : GATE_DESCRIPTION_MAX).trimEnd()}…`;
}

class GateReporter {
  config;
  registryManager;
  healthChecker;
  constructor(config, registryManager, healthChecker) {
    this.config = config;
    this.registryManager = registryManager;
    this.healthChecker = healthChecker;
  }
  renderAll() {
    const paths = this.config.getPaths();
    const reg = this.registryManager.getRegistry();
    const configData = this.config.ensureConfigFile();
    const isEn = configData.report_language === "en";
    const components = Object.values(reg.components);
    const categoryMap = {};
    for (const cat of Object.keys(reg.categories)) {
      categoryMap[cat] = [];
    }
    const inDefaultSource = (c) => c.source === "custom" || (c.source ?? DEFAULT_SOURCE) === DEFAULT_SOURCE;
    let rawTokensBefore = 0;
    let alwaysOnTokens = 0;
    for (const comp of components) {
      const cat = comp.category || "dev";
      if (!categoryMap[cat])
        categoryMap[cat] = [];
      categoryMap[cat].push(comp);
      if (!inDefaultSource(comp))
        continue;
      const tokens = estimateTokens(`${comp.name}: ${comp.description}`);
      rawTokensBefore += tokens;
      if (comp.always_on)
        alwaysOnTokens += tokens;
    }
    const pipelinesByDomain = {};
    for (const comp of components) {
      if (comp.category === "pipelines" && comp.domain) {
        (pipelinesByDomain[comp.domain] ||= []).push(comp);
      }
    }
    const gateFilesCreated = [];
    let gateDescriptionsTotal = 0;
    const renderLine = (item) => {
      const typePrefix = item.type === "command" ? "[커맨드] " : item.type === "agent" ? "[에이전트] " : "";
      const itemDesc = clipDescription(isEn ? item.description_en || item.description : item.description_ko || item.description);
      const depNote = item.dependencies?.mcp_server ? ` [의존: ${item.dependencies.mcp_server} MCP]` : "";
      return `${typePrefix}${item.name} | ${itemDesc}${depNote} | ${item.rel_path}`;
    };
    const sources = new Set([DEFAULT_SOURCE, "gemini"]);
    for (const comp of components)
      if (comp.source && comp.source !== "custom")
        sources.add(comp.source);
    const inSource = (comp, source) => comp.source === "custom" || (comp.source ?? DEFAULT_SOURCE) === source;
    const gated = RegistryManager2.isGated;
    for (const [cat, meta] of Object.entries(reg.categories)) {
      const label = isEn ? meta?.label_en || cat : meta?.label_ko || cat;
      const desc = isEn ? meta?.description_en || "" : meta?.description_ko || "";
      gateDescriptionsTotal += estimateTokens(`${cat}: ${label} ${desc}`);
    }
    const anchorRoots = {
      claude: paths.claudeDir,
      gemini: paths.geminiDir,
      library: join6(paths.claudeDir, "skills-library"),
      sandbox: paths.sandboxBoundaryRoot || paths.masterOfHome,
      custom: paths.masterOfHome
    };
    const formatLine = (items) => {
      const anchors = new Set(items.filter((c) => !c.rel_path.startsWith("/")).map((c) => c.path_anchor));
      const prefix = anchors.size === 1 ? anchorRoots[[...anchors][0]] : null;
      if (!prefix) {
        return isEn ? `# Format: name | description | path (absolute, or relative to this entry's own root)` : `# 형식: 이름 | 설명 | 경로 (절대경로이거나 해당 항목의 기본 경로 기준)`;
      }
      return isEn ? `# Format: name | description | path — a path not starting with / is relative to ${prefix}/` : `# 형식: 이름 | 설명 | 경로 — 경로가 /로 시작하지 않으면 앞에 ${prefix}/ 를 붙여 Read`;
    };
    for (const source of sources) {
      const allSections = [];
      const alwaysOn = [];
      for (const cat of Object.keys(categoryMap)) {
        const meta = reg.categories[cat];
        const label = isEn ? meta?.label_en || cat : meta?.label_ko || cat;
        const desc = isEn ? meta?.description_en || "" : meta?.description_ko || "";
        const inView = categoryMap[cat].filter((c) => inSource(c, source));
        const items = inView.filter(gated);
        alwaysOn.push(...inView.filter((c) => !gated(c)));
        const lines = [];
        lines.push(`# ${cat} — ${label} (${items.length}${isEn ? " items" : "개"}, ${source})`);
        if (desc)
          lines.push(`# ${desc}`);
        lines.push(formatLine(items));
        lines.push("");
        items.sort((a, b) => a.name.localeCompare(b.name));
        for (const item of items)
          lines.push(renderLine(item));
        const related = (pipelinesByDomain[cat] || []).filter((c) => inSource(c, source) && gated(c));
        if (related.length > 0) {
          lines.push("");
          lines.push(isEn ? `## Related pipelines (pick at most one)` : `## 관련 파이프라인 (하나만 선택)`);
          related.sort((a, b) => a.name.localeCompare(b.name));
          for (const item of related)
            lines.push(renderLine(item));
        }
        const outPath = gateFilePath(paths.gatesDir, source, cat);
        writeAtomicSync(outPath, normalizeNFC(lines.join(`
`) + `
`));
        gateFilesCreated.push(outPath);
        allSections.push(lines.join(`
`));
      }
      const allLines = [
        isEn ? "# master-of combined index (use only when a request spans several domains)" : "# master-of 전체 통합 인덱스 (여러 분야를 한 번에 매칭할 때만 사용)",
        isEn ? "# For a single domain, gates/<domain>.txt is far cheaper." : "# 한 분야만 필요하면 gates/<분야>.txt 를 읽는 쪽이 훨씬 쌉니다.",
        "",
        ...allSections
      ];
      const allPath = gateFilePath(paths.gatesDir, source, "_all");
      writeAtomicSync(allPath, normalizeNFC(allLines.join(`
`) + `
`));
      gateFilesCreated.push(allPath);
      alwaysOn.sort((a, b) => a.name.localeCompare(b.name));
      const alwaysLines = [
        isEn ? `# always_on — loaded by the harness itself, not gated (${alwaysOn.length} items, ${source})` : `# always_on — 상시 활성 (게이트 없음) (${alwaysOn.length}개, ${source})`,
        formatLine(alwaysOn),
        "",
        ...alwaysOn.map(renderLine)
      ];
      const alwaysPath = gateFilePath(paths.gatesDir, source, "always_on");
      writeAtomicSync(alwaysPath, normalizeNFC(alwaysLines.join(`
`) + `
`));
      gateFilesCreated.push(alwaysPath);
    }
    const afterGating = gateDescriptionsTotal + alwaysOnTokens + 200;
    const saved = Math.max(0, rawTokensBefore - afterGating);
    const pct = rawTokensBefore > 0 ? Math.round(saved / rawTokensBefore * 100) : 0;
    const tokenSavings = { before: rawTokensBefore, after: afterGating, saved, pct };
    const brief = this.renderBriefReport(categoryMap, tokenSavings, isEn);
    const full = this.renderFullReport(categoryMap, tokenSavings, isEn);
    writeAtomicSync(paths.briefReportFile, brief);
    writeAtomicSync(paths.reportFile, full);
    return {
      gateFiles: gateFilesCreated,
      briefReport: brief,
      fullReport: full,
      tokenSavings
    };
  }
  renderCompactInventory(isEn) {
    const paths = this.config.getPaths();
    const reg = this.registryManager.getRegistry();
    const source = DEFAULT_SOURCE;
    const gated = (c) => (c.source === "custom" || (c.source ?? DEFAULT_SOURCE) === source) && RegistryManager2.isGated(c);
    const components = Object.values(reg.components);
    const categoryMap = {};
    for (const cat of Object.keys(reg.categories)) {
      categoryMap[cat] = [];
    }
    for (const comp of components) {
      const cat = comp.category || "dev";
      if (!categoryMap[cat])
        categoryMap[cat] = [];
      categoryMap[cat].push(comp);
    }
    const { tokenSavings } = this.renderAll();
    const lines = [];
    lines.push(isEn ? "# master-of Full Inventory Overview" : "# master-of 전체 인벤토리 현황");
    lines.push("");
    lines.push(isEn ? `Full raw report (${components.length} components) saved at: \`${paths.reportFile}\`` : `전체 ${components.length}개 세부 리포트 파일: \`${paths.reportFile}\``);
    lines.push("");
    lines.push(isEn ? "## 1. Domain Gates Overview" : "## 1. 도메인 게이트별 구성요소");
    for (const [cat, items] of Object.entries(categoryMap)) {
      const meta = reg.categories[cat];
      const label = isEn ? meta?.label_en || cat : meta?.label_ko || cat;
      const shown = items.filter(gated).sort((a, b) => a.name.localeCompare(b.name));
      const sample = shown.slice(0, 4).map((c) => c.name).join(", ");
      const sampleText = sample ? shown.length > 4 ? ` (${sample}, …)` : ` (${sample})` : "";
      lines.push(`- **/${cat}** ${label}: ${shown.length}${isEn ? " items" : "개"}${sampleText}`);
      lines.push(isEn ? `  → Drill down: \`mo gate ${cat}\`` : `  → 상세 목록: \`mo gate ${cat}\``);
    }
    lines.push("");
    const alwaysOnTotal = components.filter((c) => (c.source === "custom" || (c.source ?? DEFAULT_SOURCE) === source) && !RegistryManager2.isGated(c)).length;
    lines.push(isEn ? `## 2. Always-on Components (${alwaysOnTotal} items)` : `## 2. 상시 활성 구성요소 (${alwaysOnTotal}개)`);
    lines.push(isEn ? "Agents, hook-dependent plugins, and unparked raw skills loaded by the harness." : "에이전트, 훅 의존 플러그인, 미파킹 낱개 스킬 등 하네스가 상시 로드하는 구성요소.");
    lines.push("");
    lines.push(...this.renderTokenSavingsLines(tokenSavings, isEn));
    lines.push(isEn ? "*Tip: Use `mo gate <domain>` to view skills for a specific gate, or `mo full --raw` for the complete uncompressed list.*" : "*안내: 특정 게이트의 전수 목록은 `mo gate <domain>`, 원문 전체 출력은 `mo full --raw`를 사용하세요.*");
    lines.push("");
    return normalizeNFC(lines.join(`
`));
  }
  renderBriefReport(catMap, savings, isEn, includeSavings = true) {
    const reg = this.registryManager.getRegistry();
    const lines = [];
    lines.push(isEn ? "# master-of Status (Summary)" : "# master-of 현황 (요약)");
    lines.push("");
    const issues = this.healthChecker ? this.healthChecker.checkAll() : [];
    lines.push(isEn ? "## Health Diagnostics" : "## 점검 — 지금 고장 난 것");
    if (issues.length === 0) {
      lines.push(isEn ? "Health: nothing broken (all dependencies OK)" : "점검 결과: 문제 없음");
    } else {
      for (let i = 0;i < issues.length; i++) {
        const iss = issues[i];
        lines.push(`${i + 1}. **[${iss.severity.toUpperCase()}] ${iss.subject}** | ${iss.detail}`);
        lines.push(`   → ${iss.fix}`);
      }
    }
    lines.push("");
    lines.push(isEn ? "## Components per Domain Gate" : "## 게이트별 구성요소 수");
    const inDefaultView = (c) => (c.source === "custom" || (c.source ?? DEFAULT_SOURCE) === DEFAULT_SOURCE) && RegistryManager2.isGated(c);
    for (const [cat, items] of Object.entries(catMap)) {
      const meta = reg.categories[cat];
      const label = isEn ? meta?.label_en || cat : meta?.label_ko || cat;
      const shown = items.filter(inDefaultView).length;
      const hidden = items.length - shown;
      const note = hidden > 0 ? isEn ? ` (+${hidden} loaded/other sources)` : ` (+${hidden} 상시·타 소스)` : "";
      lines.push(`- **/${cat}** ${label}: ${shown}${isEn ? " items" : "개"}${note}`);
    }
    lines.push("");
    if (includeSavings) {
      lines.push(...this.renderTokenSavingsLines(savings, isEn));
    }
    return normalizeNFC(lines.join(`
`));
  }
  renderTokenSavingsLines(savings, isEn) {
    const lines = [];
    lines.push(isEn ? "## Estimated Token Savings" : "## 토큰 절약 추정치");
    lines.push("```");
    lines.push(`  ${savings.before.toLocaleString()} tok   ${isEn ? "before gating (all always-on)" : "게이트 적용 전 (전체 상시 노출)"}`);
    lines.push(`-   ${savings.after.toLocaleString()} tok   ${isEn ? "after gating (only domain gates)" : "게이트 적용 후 (도메인 게이트만)"}`);
    lines.push("───────────");
    lines.push(`  ${savings.saved.toLocaleString()} tok   ${isEn ? "saved" : "절약"} (${savings.pct}% ${isEn ? "reduction" : "감소"})`);
    lines.push("```");
    lines.push(`*(Generated: ${new Date().toISOString()})*`);
    lines.push("");
    return lines;
  }
  renderAlwaysOnSection(catMap, isEn) {
    const reg = this.registryManager.getRegistry();
    const inDefaultAlwaysOn = (c) => (c.source === "custom" || (c.source ?? DEFAULT_SOURCE) === DEFAULT_SOURCE) && !RegistryManager2.isGated(c);
    const byCat = {};
    let total = 0;
    for (const [cat, items] of Object.entries(catMap)) {
      const shown = items.filter(inDefaultAlwaysOn).sort((a, b) => a.name.localeCompare(b.name));
      if (shown.length > 0)
        byCat[cat] = shown;
      total += shown.length;
    }
    const lines = [];
    lines.push(isEn ? `## Always-on — loaded by the harness itself, not gated (${total})` : `## Always-on — 상시 활성 (게이트 없음, ${total}개)`);
    for (const [cat, items] of Object.entries(byCat)) {
      const meta = reg.categories[cat];
      const label = isEn ? meta?.label_en || cat : meta?.label_ko || cat;
      lines.push(`
### /${cat} — ${label} (${items.length})`);
      for (const item of items) {
        const typePrefix = item.type === "command" ? "[커맨드] " : item.type === "agent" ? "[에이전트] " : "";
        const desc = clipDescription(isEn ? item.description_en || item.description : item.description_ko || item.description);
        lines.push(`- ${typePrefix}**${item.name}**${item.cluster ? ` (${item.cluster})` : ""}: ${desc}`);
      }
    }
    lines.push("");
    return lines;
  }
  renderFullReport(catMap, savings, isEn) {
    const brief = this.renderBriefReport(catMap, savings, isEn, false);
    const reg = this.registryManager.getRegistry();
    const lines = [brief];
    const source = DEFAULT_SOURCE;
    const gated = (c) => (c.source === "custom" || (c.source ?? DEFAULT_SOURCE) === source) && RegistryManager2.isGated(c);
    const total = Object.values(catMap).flat().filter(gated).length;
    lines.push(isEn ? `## Full inventory — ${total} gated components (${source})` : `## 전체 구성요소 목록 — 게이트된 ${total}개 (${source})`);
    for (const [cat, items] of Object.entries(catMap)) {
      const meta = reg.categories[cat];
      const label = isEn ? meta?.label_en || cat : meta?.label_ko || cat;
      const shown = items.filter(gated).sort((a, b) => a.name.localeCompare(b.name));
      lines.push(`
### /${cat} — ${label} (${shown.length})`);
      for (const item of shown) {
        const typePrefix = item.type === "command" ? "[커맨드] " : item.type === "agent" ? "[에이전트] " : "";
        const desc = clipDescription(isEn ? item.description_en || item.description : item.description_ko || item.description);
        lines.push(`- ${typePrefix}**${item.name}**${item.cluster ? ` (${item.cluster})` : ""}: ${desc}`);
      }
    }
    lines.push("");
    lines.push(...this.renderAlwaysOnSection(catMap, isEn));
    lines.push(...this.renderTokenSavingsLines(savings, isEn));
    return normalizeNFC(lines.join(`
`));
  }
}

// src/core/health.ts
import { existsSync as existsSync7 } from "fs";
import { join as join7, resolve as resolve6, delimiter } from "path";
var WINDOWS_EXTS = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat", ".com"] : [""];
function commandIsMissing(cmd) {
  if (!cmd || cmd.includes("${") || cmd.includes("$(") || cmd.includes("%"))
    return false;
  if (cmd.includes("/") || cmd.includes("\\")) {
    return !existsSync7(cmd);
  }
  const dirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  return !dirs.some((d) => WINDOWS_EXTS.some((ext) => existsSync7(join7(d, cmd + ext))));
}

class HealthChecker {
  config;
  registryManager;
  plugins;
  constructor(config, registryManager, plugins) {
    this.config = config;
    this.registryManager = registryManager;
    this.plugins = plugins;
  }
  claudeJsonPath() {
    return resolve6(this.config.getPaths().claudeDir, "..", ".claude.json");
  }
  mcpScopes(isEn) {
    const claudeJson = this.claudeJsonPath();
    if (!existsSync7(claudeJson))
      return null;
    const cfg = readJsonSafe(claudeJson, {});
    const scopes = [];
    if (cfg.mcpServers)
      scopes.push({ scope: isEn ? "global" : "전역", isGlobal: true, servers: cfg.mcpServers });
    for (const [project, value] of Object.entries(cfg.projects || {})) {
      if (value?.mcpServers && Object.keys(value.mcpServers).length > 0) {
        scopes.push({ scope: isEn ? `project ${project}` : `프로젝트 ${project}`, isGlobal: false, servers: value.mcpServers });
      }
    }
    return scopes;
  }
  checkAll() {
    const isEn = this.config.ensureConfigFile().report_language === "en";
    const scopes = this.mcpScopes(isEn);
    const issues = [...this.checkComponents(isEn, scopes), ...this.checkMcpServers(isEn, scopes)];
    return issues.sort((a, b) => a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1);
  }
  checkComponents(isEn, scopes) {
    const issues = [];
    const reg = this.registryManager.getRegistry();
    const configuredServers = scopes ? new Set(scopes.flatMap((s) => Object.keys(s.servers))) : null;
    const byPlugin = new Map;
    for (const comp of Object.values(reg.components)) {
      const fullPath = this.registryManager.resolveFullPath(comp);
      if (!existsSync7(fullPath)) {
        issues.push({
          kind: "missing_file",
          severity: "warning",
          subject: comp.name,
          detail: isEn ? `Target file not found at: ${fullPath}` : `대상 파일을 디스크에서 찾을 수 없음 (${fullPath})`,
          fix: isEn ? `Check if skill was moved or remove it with 'mo remove ${comp.name}'` : `스킬 경로를 확인하거나 'mo remove ${comp.name}'로 정리하세요`
        });
      }
      const pluginId = comp.dependencies?.plugin;
      if (pluginId)
        (byPlugin.get(pluginId) ?? byPlugin.set(pluginId, []).get(pluginId)).push(comp);
      const mcpName = comp.dependencies?.mcp_server;
      if (mcpName && comp.dependencies?.critical && configuredServers && !configuredServers.has(mcpName)) {
        issues.push({
          kind: "disabled_dependency",
          severity: "critical",
          subject: `${comp.name} -> ${mcpName}`,
          detail: isEn ? `Required MCP server '${mcpName}' is not configured` : `필수 의존 MCP 서버 '${mcpName}'가 설정되지 않음`,
          fix: isEn ? `Add MCP server '${mcpName}' or install its provider plugin` : `'${mcpName}' MCP 서버를 설정하거나 관련 플러그인을 설치하세요`
        });
      }
    }
    for (const [pluginId, comps] of byPlugin) {
      const state = this.plugins?.stateOf(pluginId);
      if (!state || state.enabled)
        continue;
      const critical = comps.some((c) => c.dependencies?.critical === true);
      const names = comps.map((c) => c.name).sort();
      const shown = names.length > 5 ? `${names.slice(0, 5).join(", ")} … (+${names.length - 5})` : names.join(", ");
      issues.push({
        kind: "disabled_dependency",
        severity: critical ? "critical" : "warning",
        subject: pluginId,
        detail: state.installed ? isEn ? `plugin is disabled, so its MCP servers/agents are dead for ${comps.length} gated component(s): ${shown}` : `플러그인이 꺼져 있어 게이트된 구성요소 ${comps.length}개의 MCP/에이전트가 죽어 있음: ${shown}` : isEn ? `plugin isn't installed; ${comps.length} registered component(s) point into it: ${shown}` : `플러그인이 설치되어 있지 않은데 구성요소 ${comps.length}개가 가리킴: ${shown}`,
        fix: state.installed ? isEn ? `claude plugin enable ${pluginId} — takes effect at the next session start` : `claude plugin enable ${pluginId} — 반영은 다음 세션부터입니다` : isEn ? `claude plugin install ${pluginId} — takes effect at the next session start` : `claude plugin install ${pluginId} — 반영은 다음 세션부터입니다`
      });
    }
    return issues;
  }
  checkMcpServers(isEn, scopes) {
    const issues = [];
    if (!scopes)
      return issues;
    const globalScope = scopes.find((s) => s.isGlobal);
    for (const { scope, isGlobal, servers } of scopes) {
      for (const [name, def] of Object.entries(servers)) {
        if (!isGlobal && globalScope && name in globalScope.servers) {
          issues.push({
            kind: "dead_mcp",
            severity: "warning",
            subject: `MCP ${name}`,
            detail: isEn ? `defined in both "${globalScope.scope}" and "${scope}" — which one applies isn't knowable from either file alone` : `"${globalScope.scope}"과 "${scope}" 양쪽에 중복 정의됨 — 어느 쪽이 적용되는지 파일만 봐서는 알 수 없음`,
            fix: isEn ? "delete one of the two definitions" : "한쪽 정의를 지워서 하나만 남기세요"
          });
        }
        if (commandIsMissing(def?.command)) {
          issues.push({
            kind: "dead_mcp",
            severity: "critical",
            subject: `MCP ${name}`,
            detail: isEn ? `the ${scope} config's command can't be found (${def.command}) — fails to connect every session` : `${scope} 설정의 실행 파일을 찾을 수 없음 (${def.command}) — 매 세션 연결 실패`,
            fix: isEn ? "reinstall that tool, or remove the server from the config if you don't use it" : "해당 도구를 재설치하거나, 안 쓴다면 설정에서 정의를 지우세요"
          });
        }
      }
    }
    return issues;
  }
}

// src/adapters/agy/generator.ts
import { join as join8 } from "path";
import { mkdirSync as mkdirSync3 } from "fs";
class AgyGateGenerator {
  config;
  registryManager;
  reporter;
  constructor(config, registryManager, reporter) {
    this.config = config;
    this.registryManager = registryManager;
    this.reporter = reporter;
  }
  generateAgyGates(targetSkillsDir) {
    mkdirSync3(targetSkillsDir, { recursive: true });
    if (this.reporter)
      this.reporter.renderAll();
    const reg = this.registryManager.getRegistry();
    const paths = this.config.getPaths();
    const createdDirs = [];
    for (const [cat, meta] of Object.entries(reg.categories)) {
      const skillName = `master-of-${cat}`;
      const skillDir = join8(targetSkillsDir, skillName);
      mkdirSync3(skillDir, { recursive: true });
      const gateIndexPath = gateFilePath(paths.gatesDir, "gemini", cat);
      const claudeGateIndexPath = gateFilePath(paths.gatesDir, "claude", cat);
      const content = `---
name: ${skillName}
description: "Gate for ${meta.label_en} / ${meta.label_ko}. Activates dormant ${cat} skills on demand when a task requires ${cat} capabilities."
---

# Gate: ${meta.label_ko} (${meta.label_en})

## Activation Instructions
This gate manages dormant skills for **${meta.label_ko}** to keep your system prompt context lean and avoid context budget exclusions.

1. Read the pre-rendered gate index:
   Use \`view_file\` to read the primary index: \`${gateIndexPath}\`
   (Claude Code의 스킬 라이브러리[GSD, Emil Design, Interfaces 등]까지 교차 탐색이 필요한 경우: \`${claudeGateIndexPath}\`)
2. Compare the user's task with the descriptions in that index.
3. Identify the 1-3 skills that best match the task.
4. Read the selected skill's \`SKILL.md\` using \`view_file\` and execute its instructions.
   - For Gemini paths: prepend \`${paths.geminiDir}/\` if relative
   - For Claude paths: prepend \`${paths.claudeDir}/\` if relative
`;
      writeAtomicSync(join8(skillDir, "SKILL.md"), normalizeNFC(content));
      createdDirs.push(skillDir);
    }
    const checkSkillDir = join8(targetSkillsDir, "check-skill");
    mkdirSync3(checkSkillDir, { recursive: true });
    const checkContent = `---
name: check-skill
description: "master-of 자가 점검 (요약 버전): 게이트별 구성요소 수, 깨진 의존성 및 MCP 진단, 토큰 절약 요약 리포트를 보여주고, 미파킹/미분류 스킬이 있으면 사용자에게 게이트 분류/주차를 적극 제안합니다. '현황', '점검', '자가점검', '상태' 요청 시 사용."
---

# check-skill — master-of 자가 점검 및 토큰 최적화 게이트키퍼

master-of 자가 점검을 수행하고, 미파킹(Always-on)/미분류 스킬로 인한 토큰 낭비를 진단하여 사용자에게 적극적으로 게이트 분류 및 주차(parking)를 제안합니다.

## 1단계: 현황 요약 리포트 확인 및 출력
\`view_file\` 도구를 사용하여 요약 리포트 파일을 읽고 사용자에게 보여주세요:
\`${paths.briefReportFile}\`

## 2단계: 미파킹(Always-on) 및 미분류 스킬 진단 (필수 실행)
\`run_command\` 도구를 사용하여 미파킹 낱개 스킬과 미분류 스킬 상태를 확인하세요:
\`\`\`bash
~/.master-of/mo unparked --json
~/.master-of/mo unclassified --json
\`\`\`

## 3단계: 적극적 토큰 최적화 제안 및 사용자 인터뷰 (핵심 의무!)
⚠️ **중요 (절대 리포트만 출력하고 수동적으로 멈추지 마세요)**:
- **미파킹 낱개 스킬(unparked)**이 1개 이상 존재하거나, **Always-on 토큰이 과도한 경우**(예: 10,000+ 토큰 상시 로드, 절약율 50% 미만):
  1. 현재 Always-on으로 방치되어 매 세션 낭비되는 토큰 규모(예: 약 30,000 토큰)와 미파킹 스킬 수를 사용자에게 명확히 경고하십시오.
  2. **반드시 사용자에게 먼저 질문(ask_question 도구 사용)**하여 추천 도메인 게이트로 일괄 주차(mo park --all)할지 제안하십시오:
     - 질문: "현재 N개의 미파킹 스킬로 인해 세션 시작 시 X 토큰이 상시 소모되고 있습니다. 추천 도메인 게이트로 일괄 주차/분류하여 토큰을 즉시 대폭 절약하시겠습니까?"
     - 선택지 1: "(Recommended) 낱개 스킬 전체를 추천 도메인 게이트로 일괄 주차 및 게이트 갱신 (토큰 즉시 ~85% 절약)"
     - 선택지 2: "특정 스킬만 Always-on으로 남기고 나머지 주차"
     - 선택지 3: "현재 상태 유지"
  3. 사용자가 1번을 선택하면:
     \`run_command\`로 \`~/.master-of/mo park --all\` 실행 후 \`~/.master-of/mo agy-setup\`을 실행하여 도메인 게이트를 즉시 최적화하고 새로 갱신된 절약 토큰을 보고하세요.
- **미분류 스킬(unclassified)**이 있는 경우:
  - 추론된 카테고리를 요약하여 보여주고, 사용자 동의 시 \`mo classify\`를 실행하도록 제안하세요.

(전체 스킬 목록 및 상세 인벤토리가 필요한 경우에는 \`check-skill-all\` 스킬을 사용하세요.)
`;
    writeAtomicSync(join8(checkSkillDir, "SKILL.md"), normalizeNFC(checkContent));
    createdDirs.push(checkSkillDir);
    const checkAllSkillDir = join8(targetSkillsDir, "check-skill-all");
    mkdirSync3(checkAllSkillDir, { recursive: true });
    const checkAllContent = `---
name: check-skill-all
description: "master-of 자가 점검 (전체 버전): 게이트별로 분류된 모든 스킬 인벤토리, 상시 활성(Always-on) 목록, 토큰 절약 상세 등 전체 리포트를 보여줍니다. '전체 목록', '전체 보여줘', '다 보여줘' 요청 시 사용."
---

# check-skill-all — master-of 자가 점검 (전체 인벤토리 현황)

master-of 전체 스킬 인벤토리 현황을 확인합니다.

1. 전체 인벤토리 요약 출력:
\`run_command\` 도구를 사용하여 다음 명령을 실행하고 그 출력을 보여주세요:
\`\`\`bash
~/.master-of/mo full
\`\`\`

2. 전체 원문 파일 안내:
모든 세부 스킬과 설명이 포함된 전체 원문 리포트(80KB)는 다음 파일에 저장되어 있습니다:
\`${paths.reportFile}\`
(수백 개의 스킬 목록을 채팅창에 한꺼번에 덤프하면 토큰 한도로 인해 응답이 끊기거나 멈출 수 있습니다. 기본적으로는 위 \`mo full\`의 컴팩트 인벤토리를 보여주고, 특정 도메인이 필요할 때는 해당 \`master-of-<domain>\` 게이트나 \`mo gate <domain>\`을 사용하도록 안내하세요.)
`;
    writeAtomicSync(join8(checkAllSkillDir, "SKILL.md"), normalizeNFC(checkAllContent));
    createdDirs.push(checkAllSkillDir);
    const masterOfCheckDir = join8(targetSkillsDir, "master-of-check");
    mkdirSync3(masterOfCheckDir, { recursive: true });
    writeAtomicSync(join8(masterOfCheckDir, "SKILL.md"), normalizeNFC(checkContent.replace("name: check-skill", "name: master-of-check")));
    createdDirs.push(masterOfCheckDir);
    return createdDirs;
  }
}

// src/adapters/claude/bridge.ts
import { join as join9 } from "path";
import { existsSync as existsSync8, readFileSync as readFileSync3, mkdirSync as mkdirSync4 } from "fs";
class ClaudeBridge {
  config;
  registryManager;
  reporter;
  constructor(config, registryManager, reporter) {
    this.config = config;
    this.registryManager = registryManager;
    this.reporter = reporter;
  }
  syncToClaude(targetClaudeMasterOfDir) {
    const paths = this.config.getPaths();
    const dest = targetClaudeMasterOfDir || join9(paths.claudeDir, "masterof");
    const destGates = join9(dest, "gates");
    mkdirSync4(destGates, { recursive: true });
    if (this.reporter)
      this.reporter.renderAll();
    const syncedFiles = [];
    const copyAtomic = (src, target) => {
      if (!existsSync8(src))
        return;
      writeAtomicSync(target, readFileSync3(src, "utf8"));
      syncedFiles.push(target);
    };
    for (const cat of [...Object.keys(this.registryManager.getRegistry().categories), "_all", "always_on"]) {
      copyAtomic(gateFilePath(paths.gatesDir, "claude", cat), join9(destGates, `${cat}.txt`));
    }
    copyAtomic(paths.reportFile, join9(dest, "report.txt"));
    copyAtomic(paths.briefReportFile, join9(dest, "report-brief.txt"));
    return { syncedFiles };
  }
}

// src/adapters/claude/plugins.ts
import { join as join10, resolve as resolve7, sep as sep4 } from "path";
var CACHE_PATH = /^plugins[\\/]cache[\\/]([^\\/]+)[\\/]([^\\/]+)[\\/]([^\\/]+)[\\/]/;

class ClaudePluginIndex {
  states = new Map;
  installPaths = [];
  constructor(claudeDir) {
    const installed = readJsonSafe(join10(claudeDir, "plugins", "installed_plugins.json"), {});
    const enabled = readJsonSafe(join10(claudeDir, "settings.json"), {}).enabledPlugins || {};
    for (const [id, entries] of Object.entries(installed.plugins || {})) {
      this.states.set(id, { installed: true, enabled: enabled[id] === true });
      for (const entry of Array.isArray(entries) ? entries : [entries]) {
        if (entry?.installPath)
          this.installPaths.push(resolve7(entry.installPath));
      }
    }
    for (const [id, on] of Object.entries(enabled)) {
      if (!this.states.has(id))
        this.states.set(id, { installed: false, enabled: on === true });
    }
  }
  static pluginIdOf(component) {
    if (component.path_anchor !== "claude")
      return null;
    const m = component.rel_path.match(CACHE_PATH);
    return m ? `${m[2]}@${m[1]}` : null;
  }
  pluginIdOf(component) {
    return ClaudePluginIndex.pluginIdOf(component);
  }
  stateOf(pluginId) {
    return this.states.get(pluginId);
  }
  isDormant(component) {
    if (component.path_anchor !== "claude")
      return false;
    if (/^skills-library[\\/]/.test(component.rel_path))
      return true;
    const pluginId = ClaudePluginIndex.pluginIdOf(component);
    if (!pluginId)
      return false;
    const state = this.states.get(pluginId);
    return !!state && !state.enabled;
  }
  isStaleCachePath(absolutePath) {
    const norm = resolve7(absolutePath);
    if (!/[\\/]plugins[\\/]cache[\\/]/.test(norm))
      return false;
    if (this.installPaths.length === 0)
      return false;
    return !this.installPaths.some((p) => norm === p || norm.startsWith(p + sep4));
  }
}

// src/adapters/claude/setup.ts
import { join as join11 } from "path";
import { existsSync as existsSync9, readFileSync as readFileSync4, chmodSync, mkdirSync as mkdirSync5 } from "fs";
import { fileURLToPath } from "url";
var MO_BIN = fileURLToPath(new URL("../../../bin/mo.ts", import.meta.url));
var PROTOCOL_FILES = [
  "SKILL.md",
  "skills/design/SKILL.md",
  "skills/dev/SKILL.md",
  "skills/research/SKILL.md",
  "skills/stock/SKILL.md",
  "skills/planning/SKILL.md",
  "skills/pipelines/SKILL.md"
];

class ClaudePluginInstaller {
  config;
  constructor(config) {
    this.config = config;
  }
  install(targetDir, protocolSourceDir) {
    const written = [];
    const missingProtocol = [];
    const write = (rel, content) => {
      const out = join11(targetDir, rel);
      writeAtomicSync(out, normalizeNFC(content));
      written.push(out);
      return out;
    };
    const protocol = new Map;
    for (const rel of PROTOCOL_FILES) {
      const src = join11(protocolSourceDir, rel);
      if (!existsSync9(src))
        missingProtocol.push(rel);
      else
        protocol.set(rel, readFileSync4(src, "utf8"));
    }
    if (missingProtocol.length > 0)
      return { written, missingProtocol };
    for (const [rel, content] of protocol)
      write(rel, content);
    const dataDir = this.config.getPaths().masterOfHome;
    const mo = `bun run "${MO_BIN}" --data-dir "${dataDir}"`;
    write(".claude-plugin/plugin.json", JSON.stringify({
      $schema: "https://anthropic.com/claude-code/plugin.schema.json",
      name: "master-of",
      version: "2.0.0",
      description: "Skill-gate system (v2 universal core): keeps rarely-used skills dormant behind domain gates and activates only what a task needs. check-skills = status + classify; the scan engine is the mo CLI.",
      skills: [
        "./skills/check-skills",
        "./skills/check-skills-all",
        "./skills/design",
        "./skills/dev",
        "./skills/pipelines",
        "./skills/planning",
        "./skills/research",
        "./skills/stock",
        "./"
      ]
    }, null, 2) + `
`);
    write("hooks/hooks.json", JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: '"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"', timeout: 30 }] }
        ]
      }
    }, null, 2) + `
`);
    const hook = write("hooks/session-start.sh", `#!/bin/sh
# master-of SessionStart bootstrap (v2 - Self-contained Plug-and-Play)
if [ -n "\${MASTER_OF_BIN:-}" ]; then
  exec "$MASTER_OF_BIN" session-start
fi
if [ -n "\${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "\${CLAUDE_PLUGIN_ROOT}/bin/mo.mjs" ]; then
  exec node "\${CLAUDE_PLUGIN_ROOT}/bin/mo.mjs" session-start
fi
if [ -x "\${HOME}/.master-of/mo" ]; then
  exec "\${HOME}/.master-of/mo" session-start
fi
if command -v mo >/dev/null 2>&1; then
  exec mo session-start
fi
printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"master-of: mo CLI를 실행할 수 없습니다 (Node.js 환경 확인 필요)."}}'
`);
    chmodSync(hook, 493);
    write("skills/check-skills/SKILL.md", `---
name: "check-skills"
description: "Status and management of the master-of skill-gate system: shows the brief report (per-gate counts, what is broken, token savings), and files newly discovered skills into the right gate. Invoke for '현황', '점검해줘', 'what skills are gated', 'why is X disabled', or when the SessionStart hook says components are unclassified. The scan itself is done by the mo CLI; this skill only judges categories."
allowed-tools: Read, Bash
---

# check-skills

The engine is the \`mo\` CLI at \`~/.master-of/mo\` (written by \`claude-setup\`).

Never edit registry.json by hand and never Read it — it is large; every
question below has a CLI command.

## 1. Status (「현황」, 「점검해줘」)

\`\`\`bash
~/.master-of/mo status
\`\`\`

Show the output as-is. It lists broken items with the fix for each.

## 2. Unclassified components

The hook reports how many components still carry the scanner's category guess.
To file them:

1. \`~/.master-of/mo unclassified --source claude --json\` — each entry has
   \`name\`, \`type\`, \`category\` (the guess), \`description\`, \`rel_path\`, \`source\`.
2. For each entry decide, from its description, which gate it belongs to:
   \`design\` / \`dev\` / \`research\` / \`stock\` / \`planning\` / \`pipelines\`.
   Rules of thumb: an end-to-end workflow that runs a whole project phase →
   \`pipelines\` (needs \`--domain <gate>\`); GSD/planning skills take
   \`--cluster <name>\`. Write a one-line Korean summary (\`--desc\`).
3. \`~/.master-of/mo classify <name> <gate> --desc "한 줄 요약" [--cluster x] [--domain gate]\`
   To permanently skip: \`~/.master-of/mo ignore <name>\`.
4. After the batch: \`~/.master-of/mo claude-sync\` re-renders the gate indexes.

Bulk first run (5+ entries): show a one-line plan per gate and get a yes
BEFORE running \`claude plugin disable\` or moving folders.

## 3. Everything else

| Goal | Command |
|---|---|
| Full inventory | \`~/.master-of/mo full\` |
| Search | \`~/.master-of/mo search <keyword>\` |
| Remove stale entry | \`~/.master-of/mo remove <name>\` |
| Re-scan now | \`~/.master-of/mo sync && ~/.master-of/mo claude-sync\` |
`);
    write("skills/check-skills-all/SKILL.md", `---
name: "check-skills-all"
description: "Full inventory of the master-of skill-gate system — every gated component by domain, plus what is broken and token savings. Invoke when the user asks for the whole list ('전체 보여줘', '다 보여줘', '전체 목록'); for a quick status use check-skills."
allowed-tools: Read, Bash
---

# check-skills-all

The engine is the \`mo\` CLI at \`~/.master-of/mo\`.

1. Refresh the index (silent — do not print output):
   \`\`\`bash
   ~/.master-of/mo sync && ~/.master-of/mo claude-sync
   \`\`\`

2. Show the full inventory overview:
   \`\`\`bash
   ~/.master-of/mo full
   \`\`\`
   Show its output as-is — a token-safe overview of gated components grouped by gate,
   plus always-on items and token savings.

For a single gate only: \`~/.master-of/mo gate <name>\` (e.g. \`mo gate design\`).
(Full uncompressed 80KB report is at \`~/.master-of/report.txt\` or via \`mo full --raw\`.)
`);
    const wrapperDir = dataDir;
    mkdirSync5(wrapperDir, { recursive: true });
    const wrapperPath = join11(wrapperDir, "mo");
    const wrapperContent = `#!/bin/sh
# ~/.master-of/mo — generated by claude-setup (do not edit; re-run claude-setup to update)
exec ${mo} "$@"
`;
    writeAtomicSync(wrapperPath, wrapperContent);
    chmodSync(wrapperPath, 493);
    written.push(wrapperPath);
    return { written, missingProtocol };
  }
}
function defaultClaudePluginDir(claudeDir) {
  return join11(claudeDir, "skills", "master-of");
}

// src/adapters/claude/parking.ts
import { readdirSync as readdirSync2, existsSync as existsSync10, mkdirSync as mkdirSync6, renameSync as renameSync4, statSync as statSync4 } from "fs";
import { join as join12 } from "path";
class ClaudeSkillParker {
  config;
  registryManager;
  constructor(config, registryManager) {
    this.config = config;
    this.registryManager = registryManager;
  }
  listUnparked() {
    const claudeDir = this.config.getPaths().claudeDir;
    const skillsDir = join12(claudeDir, "skills");
    if (!existsSync10(skillsDir))
      return [];
    const results = [];
    for (const entry of readdirSync2(skillsDir)) {
      const norm = normalizeNFC(entry);
      if (norm.startsWith(".") || norm === "master-of")
        continue;
      const fullPath = join12(skillsDir, norm);
      try {
        if (!statSync4(fullPath).isDirectory())
          continue;
      } catch {
        continue;
      }
      if (!existsSync10(join12(fullPath, "SKILL.md")))
        continue;
      const comp = this.registryManager.getComponent(norm);
      const category = comp?.category || "dev";
      results.push({ name: norm, path: fullPath, category });
    }
    return results;
  }
  parkSkill(name, targetCategory) {
    if (name === "master-of") {
      throw new Error("Cannot park master-of: it is the gate system itself.");
    }
    const claudeDir = this.config.getPaths().claudeDir;
    const skillsDir = join12(claudeDir, "skills");
    const sourceDir = join12(skillsDir, name);
    if (!existsSync10(sourceDir)) {
      throw new Error(`Skill '${name}' not found in ${skillsDir}`);
    }
    const category = targetCategory || this.registryManager.getComponent(name)?.category || "dev";
    const libraryDir = join12(claudeDir, "skills-library", category);
    mkdirSync6(libraryDir, { recursive: true });
    const destDir = join12(libraryDir, name);
    if (existsSync10(destDir)) {
      throw new Error(`Target directory already exists: ${destDir}`);
    }
    renameSync4(sourceDir, destDir);
    return {
      name,
      category,
      from: sourceDir,
      to: destDir
    };
  }
  unparkSkill(name) {
    const claudeDir = this.config.getPaths().claudeDir;
    const libraryBase = join12(claudeDir, "skills-library");
    const skillsDir = join12(claudeDir, "skills");
    if (!existsSync10(libraryBase)) {
      throw new Error(`skills-library does not exist: ${libraryBase}`);
    }
    let sourceDir = null;
    for (const cat of readdirSync2(libraryBase)) {
      const candidate = join12(libraryBase, cat, name);
      if (existsSync10(candidate)) {
        sourceDir = candidate;
        break;
      }
    }
    if (!sourceDir) {
      throw new Error(`Parked skill '${name}' not found in ${libraryBase}`);
    }
    const destDir = join12(skillsDir, name);
    if (existsSync10(destDir)) {
      throw new Error(`Target directory already exists: ${destDir}`);
    }
    mkdirSync6(skillsDir, { recursive: true });
    renameSync4(sourceDir, destDir);
    return { name, from: sourceDir, to: destDir };
  }
  parkAll() {
    const unparked = this.listUnparked();
    const results = [];
    for (const item of unparked) {
      results.push(this.parkSkill(item.name, item.category));
    }
    return results;
  }
}

// src/core/fs-atomic.ts
import { writeFileSync as writeFileSync2, renameSync as renameSync5, mkdirSync as mkdirSync7, readFileSync as readFileSync5, existsSync as existsSync11, unlinkSync as unlinkSync2 } from "fs";
import { dirname as dirname3, join as join13 } from "path";
function writeAtomicSync2(targetPath, content) {
  const dir = dirname3(targetPath);
  mkdirSync7(dir, { recursive: true });
  const tmpPath = join13(dir, `.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`);
  try {
    writeFileSync2(tmpPath, normalizeNFC(content), "utf8");
    renameSync5(tmpPath, targetPath);
  } catch (err) {
    if (existsSync11(tmpPath)) {
      try {
        unlinkSync2(tmpPath);
      } catch {}
    }
    throw err;
  }
}
function readJsonOrNull2(filePath) {
  try {
    if (!existsSync11(filePath))
      return null;
    const content = readFileSync5(filePath, "utf8");
    return JSON.parse(normalizeNFC(content));
  } catch {
    return null;
  }
}
function readJsonSafe2(filePath, fallback) {
  const parsed = readJsonOrNull2(filePath);
  return parsed === null ? fallback : parsed;
}

// src/adapters/rules/generator.ts
import { fileURLToPath as fileURLToPath2 } from "url";
var MO_BIN2 = fileURLToPath2(new URL("../../../bin/mo.ts", import.meta.url));

class RuleGenerator {
  config;
  registryManager;
  constructor(config, registryManager) {
    this.config = config;
    this.registryManager = registryManager;
  }
  generateAgentsMd() {
    const reg = this.registryManager.getRegistry();
    const lines = [
      "# master-of Skill Gateway Instructions",
      "",
      "This project uses **master-of** to keep system prompt tokens lean by gating 100+ dormant skills behind domain gates.",
      "",
      "## Available Domain Gates"
    ];
    for (const [key, meta] of Object.entries(reg.categories)) {
      lines.push(`- \`/${key}\`: ${meta.label_ko} (${meta.label_en}) — ${meta.description_ko}`);
    }
    lines.push("");
    lines.push("## How to Activate Skills On Demand");
    lines.push("1. When user requests work in a domain, query the gate index:");
    lines.push(`   - Via CLI: \`bun run ${MO_BIN2} gate <domain>\``);
    lines.push("   - Via MCP Tool: `mo_open_gate(gate: '<domain>')`");
    lines.push("2. Review the 1-line index entries (`name | description | path`).");
    lines.push("3. Read only the matching skill(s) via file read or `mo_get_skill`.");
    lines.push("4. Execute the task following that skill's instructions.");
    return normalizeNFC(lines.join(`
`) + `
`);
  }
  generateMcpSnippet(nodeOrBun = "bun") {
    const paths = this.config.getPaths();
    const snippet = {
      mcpServers: {
        "master-of": {
          command: nodeOrBun,
          args: ["run", MO_BIN2, "mcp", "--data-dir", paths.masterOfHome]
        }
      }
    };
    return JSON.stringify(snippet, null, 2);
  }
}

// src/adapters/mcp/server.ts
import { readFileSync as readFileSync6, existsSync as existsSync12 } from "fs";
import { dirname as dirname4 } from "path";

// src/core/search.ts
function searchComponents(registry, query, category) {
  const cat = category ? normalizeNFC(category).trim().toLowerCase() : undefined;
  return Object.values(registry.components).filter((c) => {
    if (cat && normalizeNFC(c.category).toLowerCase() !== cat)
      return false;
    return safeIncludes(c.name, query) || safeIncludes(c.description, query) || safeIncludes(c.description_ko || "", query) || safeIncludes(c.description_en || "", query) || safeIncludes(c.cluster || "", query);
  });
}

// src/adapters/mcp/server.ts
class UniversalMcpServer {
  config;
  registryManager;
  healthChecker;
  constructor(config, registryManager, healthChecker) {
    this.config = config;
    this.registryManager = registryManager;
    this.healthChecker = healthChecker;
  }
  startStdio() {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf(`
`)) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          this.handleLine(line);
        }
      }
    });
    process.stderr.write(`[master-of-mcp] Stdio MCP Server running
`);
  }
  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (err) {
      process.stderr.write(`[master-of-mcp] Ignoring malformed line: ${err.message}
`);
      return;
    }
    if (!message || message.jsonrpc !== "2.0")
      return;
    const { id, method, params } = message;
    try {
      if (method === "initialize") {
        this.respond(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "master-of", version: "2.0.0" }
        });
        return;
      }
      if (method === "notifications/initialized") {
        return;
      }
      if (method === "tools/list") {
        this.respond(id, {
          tools: [
            {
              name: "mo_list_gates",
              description: "List all active master-of domain gates with skill counts and token savings overview.",
              inputSchema: { type: "object", properties: {} }
            },
            {
              name: "mo_open_gate",
              description: "Opens a specific domain gate and returns its pre-rendered compact skill index (1~2KB).",
              inputSchema: {
                type: "object",
                properties: {
                  gate: {
                    type: "string",
                    description: "Gate name: 'design', 'dev', 'research', 'stock', 'planning', or 'pipelines'"
                  },
                  source: {
                    type: "string",
                    description: "Which harness's skills to list: 'claude' (default) or 'gemini'"
                  }
                },
                required: ["gate"]
              }
            },
            {
              name: "mo_search",
              description: "Fast keyword search across all indexed skills, commands, and agents.",
              inputSchema: {
                type: "object",
                properties: {
                  query: { type: "string", description: "Search query or keyword" },
                  category: { type: "string", description: "Optional category filter" }
                },
                required: ["query"]
              }
            },
            {
              name: "mo_get_skill",
              description: "Retrieves the full SKILL.md body and companion path for an identified skill.",
              inputSchema: {
                type: "object",
                properties: {
                  skill_name: { type: "string", description: "The exact name of the skill" }
                },
                required: ["skill_name"]
              }
            },
            {
              name: "mo_health_check",
              description: "Runs dependency, MCP, and broken path diagnostics.",
              inputSchema: { type: "object", properties: {} }
            }
          ]
        });
        return;
      }
      if (method === "tools/call") {
        const { name, arguments: args } = params || {};
        let result;
        try {
          result = this.executeTool(name, args || {});
        } catch (err) {
          result = { isError: true, content: [{ type: "text", text: `Tool '${name}' failed: ${err.message}` }] };
        }
        this.respond(id, result);
        return;
      }
      this.sendError(id, -32601, `Method not found: ${method}`);
    } catch (err) {
      process.stderr.write(`[master-of-mcp] Error: ${err.message}
`);
      if (id !== undefined)
        this.sendError(id, -32603, `Internal error: ${err.message}`);
    }
  }
  executeTool(name, args) {
    this.registryManager.reloadIfChanged();
    const reg = this.registryManager.getRegistry();
    const paths = this.config.getPaths();
    const isEn = this.config.ensureConfigFile().report_language === "en";
    if (name === "mo_list_gates") {
      const gates = Object.entries(reg.categories).map(([key, meta]) => {
        const inGate = Object.values(reg.components).filter((c) => c.category === key && RegistryManager2.isGated(c));
        const bySource = {};
        for (const c of inGate)
          bySource[c.source ?? DEFAULT_SOURCE] = (bySource[c.source ?? DEFAULT_SOURCE] || 0) + 1;
        const count = inGate.length;
        return {
          gate: key,
          items_by_source: bySource,
          label: isEn ? meta.label_en : meta.label_ko,
          description: isEn ? meta.description_en : meta.description_ko,
          items: count
        };
      });
      return {
        content: [{ type: "text", text: JSON.stringify(gates, null, 2) }]
      };
    }
    if (name === "mo_open_gate") {
      const gateName = normalizeNFC(args.gate || "").trim().toLowerCase();
      const gateFile = resolveGateFile(paths.gatesDir, gateName, args.source || DEFAULT_SOURCE);
      if (!gateFile || !existsSync12(gateFile)) {
        return {
          isError: true,
          content: [{ type: "text", text: `Gate '${gateName}' not found. Available gates: ${Object.keys(reg.categories).join(", ")}` }]
        };
      }
      const text = readFileSync6(gateFile, "utf8");
      return {
        content: [{ type: "text", text: normalizeNFC(text) }]
      };
    }
    if (name === "mo_search") {
      const matches = searchComponents(reg, normalizeNFC(args.query || ""), args.category);
      const summary = matches.map((m) => ({
        name: m.name,
        category: m.category,
        description: (isEn ? m.description_en : m.description_ko) || m.description,
        path: m.rel_path
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }]
      };
    }
    if (name === "mo_get_skill") {
      const skillName = normalizeNFC(args.skill_name || "");
      const comp = this.registryManager.getComponent(skillName);
      if (!comp) {
        return {
          isError: true,
          content: [{ type: "text", text: `Skill '${skillName}' not found in registry.` }]
        };
      }
      const fullPath = this.registryManager.resolveFullPath(comp);
      if (!existsSync12(fullPath)) {
        return {
          isError: true,
          content: [{ type: "text", text: `Skill file not found on disk: ${fullPath}` }]
        };
      }
      const body = readFileSync6(fullPath, "utf8");
      return {
        content: [
          {
            type: "text",
            text: `# ${comp.name}
Base directory: ${dirname4(fullPath)}

${normalizeNFC(body)}`
          }
        ]
      };
    }
    if (name === "mo_health_check") {
      const issues = this.healthChecker ? this.healthChecker.checkAll() : [];
      return {
        content: [{ type: "text", text: JSON.stringify(issues, null, 2) }]
      };
    }
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }]
    };
  }
  respond(id, result) {
    const payload = JSON.stringify({ jsonrpc: "2.0", id, result }) + `
`;
    process.stdout.write(payload);
  }
  sendError(id, code, message) {
    const payload = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + `
`;
    process.stdout.write(payload);
  }
}

// src/core/gates.ts
import { resolve as resolve8 } from "path";
var PLAIN_NAME2 = /^[a-z0-9_][a-z0-9_-]*$/;
function gateFilePath2(gatesDir, source, category) {
  return resolve8(gatesDir, source, `${category}.txt`);
}
function resolveGateFile2(gatesDir, rawGate, rawSource = DEFAULT_SOURCE) {
  const gate = normalizeNFC(rawGate).trim().toLowerCase();
  const source = normalizeNFC(rawSource).trim().toLowerCase();
  if (!PLAIN_NAME2.test(gate) || !PLAIN_NAME2.test(source))
    return null;
  const gateFile = gateFilePath2(gatesDir, source, gate);
  if (!isPathSafe(gateFile, [gatesDir]))
    return null;
  return gateFile;
}

// src/core/search.ts
function searchComponents2(registry, query, category) {
  const cat = category ? normalizeNFC(category).trim().toLowerCase() : undefined;
  return Object.values(registry.components).filter((c) => {
    if (cat && normalizeNFC(c.category).toLowerCase() !== cat)
      return false;
    return safeIncludes(c.name, query) || safeIncludes(c.description, query) || safeIncludes(c.description_ko || "", query) || safeIncludes(c.description_en || "", query) || safeIncludes(c.cluster || "", query);
  });
}

// bin/mo.ts
var args = process.argv.slice(2);
var dataDir;
var sandboxRoot;
var isJson = false;
var source;
var cluster;
var domain;
var desc;
var protocolFrom;
var cleanArgs = [];
for (let i = 0;i < args.length; i++) {
  const a = args[i];
  if (a === "--data-dir" && i + 1 < args.length) {
    dataDir = args[++i];
  } else if (a === "--sandbox" && i + 1 < args.length) {
    sandboxRoot = args[++i];
  } else if (a === "--json") {
    isJson = true;
  } else if (a === "--source" && i + 1 < args.length) {
    source = args[++i];
  } else if (a === "--cluster" && i + 1 < args.length) {
    cluster = args[++i];
  } else if (a === "--domain" && i + 1 < args.length) {
    domain = args[++i];
  } else if (a === "--desc" && i + 1 < args.length) {
    desc = args[++i];
  } else if (a === "--protocol-from" && i + 1 < args.length) {
    protocolFrom = args[++i];
  } else {
    cleanArgs.push(a);
  }
}
var config = new ConfigManager({ dataDir, sandboxRoot });
var registryExistedBefore = existsSync13(config.getPaths().registryFile);
var registryManager = new RegistryManager(config);
var registryWasQuarantined = registryExistedBefore && readdirSync3(config.getPaths().masterOfHome).some((f) => f.startsWith("registry.json.corrupt-"));
var pluginIndex = new ClaudePluginIndex(config.getPaths().claudeDir);
var healthChecker = new HealthChecker(config, registryManager, pluginIndex);
var reporter = new GateReporter(config, registryManager, healthChecker);
function assertOwnsClaudeDir(explicitTarget) {
  if (explicitTarget)
    return;
  const paths = config.getPaths();
  const defaultHome = resolve9(homedir2(), ".master-of");
  if (paths.masterOfHome === defaultHome)
    return;
  if (!paths.claudeDir.startsWith(resolve9(homedir2(), ".claude")))
    return;
  console.error(`Refusing to write ${join14(paths.claudeDir, "masterof")} from data dir ${paths.masterOfHome}.
` + `Those gate files belong to the default data dir (${defaultHome}). Pass an explicit target directory to write elsewhere.`);
  process.exit(1);
}
var command = cleanArgs[0] || "status";
switch (command) {
  case "status":
  case "check": {
    const { briefReport, tokenSavings } = reporter.renderAll();
    if (isJson) {
      console.log(JSON.stringify(tokenSavings, null, 2));
    } else {
      console.log(briefReport);
    }
    break;
  }
  case "full": {
    const isRaw = cleanArgs.includes("--raw") || cleanArgs.includes("--all") || args.includes("--raw");
    if (isRaw) {
      const { fullReport } = reporter.renderAll();
      console.log(fullReport);
    } else {
      const isEn = config.ensureConfigFile().report_language === "en";
      console.log(reporter.renderCompactInventory(isEn));
    }
    break;
  }
  case "gate": {
    const gateName = (cleanArgs[1] || "").trim().toLowerCase();
    if (!gateName) {
      console.error("Usage: mo gate <category>  (e.g., mo gate design)");
      process.exit(1);
    }
    const gatePath = resolveGateFile2(config.getPaths().gatesDir, gateName, source);
    if (!gatePath) {
      console.error(`Gate '${gateName}' is not a valid gate name.`);
      process.exit(1);
    }
    if (!existsSync13(gatePath)) {
      reporter.renderAll();
    }
    if (existsSync13(gatePath)) {
      console.log(readFileSync7(gatePath, "utf8"));
    } else {
      console.error(`Gate '${gateName}' not found.`);
      process.exit(1);
    }
    break;
  }
  case "search": {
    const query = cleanArgs.slice(1).join(" ");
    if (!query) {
      console.error("Usage: mo search <keyword>");
      process.exit(1);
    }
    const matches = searchComponents2(registryManager.getRegistry(), query);
    if (isJson) {
      console.log(JSON.stringify(matches, null, 2));
    } else {
      console.log(`
Search results for '${query}': (${matches.length} found)
`);
      for (const m of matches) {
        console.log(`- [${m.category}] ${m.name}: ${m.description_ko || m.description}`);
      }
      console.log("");
    }
    break;
  }
  case "doctor": {
    const issues = healthChecker.checkAll();
    if (isJson) {
      console.log(JSON.stringify(issues, null, 2));
    } else {
      console.log(`
# master-of Doctor Diagnostics
`);
      if (issues.length === 0) {
        console.log(`\u2713 All checks passed. No broken dependencies or missing files found.
`);
      } else {
        for (const iss of issues) {
          console.log(`[${iss.severity.toUpperCase()}] ${iss.subject}: ${iss.detail}`);
          console.log(`  Fix: ${iss.fix}
`);
        }
      }
    }
    break;
  }
  case "sync": {
    const scanner = new SkillScanner;
    const paths = config.getPaths();
    const fullPathOf = (c) => registryManager.resolveFullPath(c);
    const { unique: scanned, collisions } = dedupeByName([
      ...(existsSync13(paths.claudeDir) ? scanner.scanDirectory(paths.claudeDir, "claude") : []).filter((c) => !pluginIndex.isStaleCachePath(fullPathOf(c))).map((c) => ({ ...c, always_on: !pluginIndex.isDormant(c) })),
      ...existsSync13(paths.geminiDir) ? scanner.scanDirectory(paths.geminiDir, "gemini") : []
    ], fullPathOf);
    const { added, updated } = registryManager.upsertScanned(scanned);
    const pruned = registryManager.pruneMissing(["claude", "gemini"]);
    const { tokenSavings } = reporter.renderAll();
    if (isJson) {
      console.log(JSON.stringify({ scanned: scanned.length, added, updated: updated.length, pruned, collisions, tokenSavings }, null, 2));
    } else {
      console.log(`\u2713 Synced ${scanned.length} components (${added.length} new, ${updated.length} refreshed, ${pruned.length} pruned). Token reduction: ${tokenSavings.pct}% saved.`);
      for (const c of collisions) {
        console.error(`! '${c.name}' found at ${1 + c.dropped.length} paths \u2014 kept ${c.kept}, ignored ${c.dropped.join(", ")}`);
      }
    }
    break;
  }
  case "classify": {
    const [, name, category] = cleanArgs;
    if (!name || !category) {
      console.error("Usage: mo classify <component-name> <category> [--cluster <name>] [--domain <gate>]");
      process.exit(1);
    }
    try {
      const language = config.ensureConfigFile().report_language;
      const comp = registryManager.classify(name, category, { cluster, domain, description: desc, language });
      if (!comp) {
        console.error(`Component '${name}' not found in the registry.`);
        process.exit(1);
      }
      reporter.renderAll();
      console.log(`\u2713 ${comp.name} \u2192 /${comp.category}${comp.cluster ? ` (${comp.cluster})` : ""}`);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    break;
  }
  case "ignore": {
    const name = cleanArgs[1];
    if (!name) {
      console.error("Usage: mo ignore <component-name>");
      process.exit(1);
    }
    if (!registryManager.ignore(name)) {
      console.error(`Component '${name}' not found in the registry.`);
      process.exit(1);
    }
    reporter.renderAll();
    console.log(`\u2713 '${name}' ignored \u2014 out of every gate and the unclassified list.`);
    break;
  }
  case "claude-setup": {
    const targetDir = cleanArgs[1] || defaultClaudePluginDir(config.getPaths().claudeDir);
    const protocolDir = protocolFrom || targetDir;
    const installer = new ClaudePluginInstaller(config);
    const { written, missingProtocol } = installer.install(targetDir, protocolDir);
    console.log(`\u2713 Wrote ${written.length} plugin files to ${targetDir}`);
    if (missingProtocol.length > 0) {
      console.error(`! Protocol files not found in ${protocolDir}: ${missingProtocol.join(", ")} \u2014 gates will not activate until they exist.`);
      process.exit(1);
    }
    break;
  }
  case "session-start": {
    const paths = config.getPaths();
    const scanner = new SkillScanner;
    const fullPathOf = (c) => registryManager.resolveFullPath(c);
    const { unique } = dedupeByName([
      ...(existsSync13(paths.claudeDir) ? scanner.scanDirectory(paths.claudeDir, "claude") : []).filter((c) => !pluginIndex.isStaleCachePath(fullPathOf(c))).map((c) => ({ ...c, always_on: !pluginIndex.isDormant(c) })),
      ...existsSync13(paths.geminiDir) ? scanner.scanDirectory(paths.geminiDir, "gemini") : []
    ], fullPathOf);
    registryManager.upsertScanned(unique);
    registryManager.pruneMissing(["claude", "gemini"]);
    assertOwnsClaudeDir();
    new ClaudeBridge(config, registryManager, reporter).syncToClaude();
    const wrapperPath = resolve9(paths.masterOfHome, "mo");
    if (!existsSync13(wrapperPath)) {
      const scriptPath = resolve9(process.argv[1]);
      const execLine = scriptPath.endsWith(".ts") ? `exec bun run "${scriptPath}" --data-dir "${paths.masterOfHome}" "$@"` : `exec node "${scriptPath}" --data-dir "${paths.masterOfHome}" "$@"`;
      const wrapperContent = `#!/bin/sh
# ~/.master-of/mo \u2014 generated automatically
${execLine}
`;
      writeAtomicSync2(wrapperPath, wrapperContent);
      chmodSync2(wrapperPath, 493);
    }
    const issues = healthChecker.checkAll();
    const pending = registryManager.unclassified().filter((c) => (c.source ?? "claude") === "claude");
    const parker = new ClaudeSkillParker(config, registryManager);
    const unparked = parker.listUnparked();
    const stateFile = resolve9(paths.masterOfHome, "state.json");
    const prev = readJsonSafe2(stateFile, {});
    const issueKeys = issues.map((i) => `${i.kind}:${i.subject}`).sort();
    const pendingNames = pending.map((c) => componentId(c)).sort();
    const unparkedNames = unparked.map((u) => u.name).sort();
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b ?? null);
    const unparkedChanged = !same(unparkedNames, prev.unparked_names);
    const changed = !same(pendingNames, prev.pending_names) || !same(issueKeys, prev.issue_keys) || unparkedChanged;
    const lines = [];
    if (registryWasQuarantined) {
      lines.push(`master-of: registry.json was unreadable and was moved aside, so every confirmed classification is gone and ${pendingNames.length} component(s) fell back to the scanner's guess. Tell the user this happened and that ${paths.masterOfHome} holds a registry.json.corrupt-* they may want to restore from.`);
    }
    if (issues.length > 0) {
      lines.push(`master-of: ${issues.length} health issue(s) \u2014 say so in one line; 'check-skills' has the fixes.`);
      for (const i of issues.slice(0, 5))
        lines.push(`- [${i.severity}] ${i.subject}: ${i.fix}`);
      if (issues.length > 5)
        lines.push(`- \u2026 +${issues.length - 5} more`);
    }
    if (unparked.length > 0 && unparkedChanged) {
      lines.push(`master-of: ${unparked.length} raw skill(s) in ~/.claude/skills/ are always-on. Run 'mo park --all' (or 'mo park <name>') to park them in skills-library and make them dormant.`);
    }
    if (pending.length > 0) {
      lines.push(`master-of: ${pending.length} Claude component(s) still carry the scanner's category guess (they are gated under that guess meanwhile). Do NOT classify now; mention it in one line and offer 'check-skills' when the user has time.`);
    }
    writeAtomicSync2(stateFile, JSON.stringify({ issue_keys: issueKeys, pending_names: pendingNames, unparked_names: unparkedNames, at: new Date().toISOString() }, null, 2));
    if (!changed && !registryWasQuarantined)
      break;
    if (lines.length === 0)
      break;
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join(`
`) } }));
    break;
  }
  case "unclassified": {
    const pending = registryManager.unclassified().filter((c) => !source || (c.source ?? "claude") === source);
    if (isJson) {
      console.log(JSON.stringify(pending, null, 2));
    } else if (pending.length === 0) {
      console.log("\u2713 Every component has a confirmed category.");
    } else {
      console.log(`
${pending.length} component(s) still carry the scanner's guess \u2014 confirm with: mo classify <name> <category>
`);
      for (const c of pending) {
        const typePrefix = c.type === "skill" ? "" : `[${c.type}] `;
        console.log(`- ${typePrefix}${c.name}  (guess: ${c.category}, ${c.source ?? "claude"})
    ${c.description.slice(0, 120)}`);
      }
      console.log("");
    }
    break;
  }
  case "remove": {
    const name = cleanArgs[1];
    if (!name) {
      console.error("Usage: mo remove <component-name>");
      process.exit(1);
    }
    if (registryManager.removeComponent(name)) {
      reporter.renderAll();
      console.log(`\u2713 Removed '${name}' from the registry.`);
    } else {
      console.error(`Component '${name}' not found in the registry.`);
      process.exit(1);
    }
    break;
  }
  case "agy-setup": {
    const targetDir = cleanArgs[1] || resolve9(config.getPaths().geminiDir, "config", "skills");
    const gen = new AgyGateGenerator(config, registryManager, reporter);
    const created = gen.generateAgyGates(targetDir);
    console.log(`\u2713 Generated ${created.length} AGY gate skills in: ${targetDir}`);
    break;
  }
  case "claude-sync": {
    const targetDir = cleanArgs[1];
    assertOwnsClaudeDir(targetDir);
    const bridge = new ClaudeBridge(config, registryManager, reporter);
    const { syncedFiles } = bridge.syncToClaude(targetDir);
    console.log(`\u2713 Synced ${syncedFiles.length} gate & report files to Claude masterof directory.`);
    break;
  }
  case "unparked": {
    const parker = new ClaudeSkillParker(config, registryManager);
    const list = parker.listUnparked();
    if (isJson) {
      console.log(JSON.stringify(list, null, 2));
    } else if (list.length === 0) {
      console.log("\u2713 No unparked raw skills in ~/.claude/skills/. All skills are dormant in skills-library.");
    } else {
      console.log(`
${list.length} raw skill(s) currently always-on in ~/.claude/skills/:
`);
      for (const item of list) {
        console.log(`- ${item.name} (suggested gate: /${item.category})`);
      }
      console.log(`
Run 'mo park --all' to move all to skills-library and save tokens.
`);
    }
    break;
  }
  case "park": {
    const target = cleanArgs[1];
    const targetCat = cleanArgs[2];
    if (!target) {
      console.error("Usage: mo park <skill-name> [category]  OR  mo park --all");
      process.exit(1);
    }
    assertOwnsClaudeDir();
    const parker = new ClaudeSkillParker(config, registryManager);
    if (target === "--all") {
      const results = parker.parkAll();
      console.log(`\u2713 Parked ${results.length} skills into skills-library.`);
    } else {
      const res = parker.parkSkill(target, targetCat);
      console.log(`\u2713 Parked '${res.name}' into skills-library/${res.category}/${res.name}`);
    }
    const scanner = new SkillScanner;
    const paths = config.getPaths();
    const fullPathOf = (c) => registryManager.resolveFullPath(c);
    const { unique: scanned } = dedupeByName([
      ...(existsSync13(paths.claudeDir) ? scanner.scanDirectory(paths.claudeDir, "claude") : []).filter((c) => !pluginIndex.isStaleCachePath(fullPathOf(c))).map((c) => ({ ...c, always_on: !pluginIndex.isDormant(c) })),
      ...existsSync13(paths.geminiDir) ? scanner.scanDirectory(paths.geminiDir, "gemini") : []
    ], fullPathOf);
    registryManager.upsertScanned(scanned);
    registryManager.pruneMissing(["claude", "gemini"]);
    if (existsSync13(paths.claudeDir)) {
      new ClaudeBridge(config, registryManager, reporter).syncToClaude();
    }
    const { tokenSavings } = reporter.renderAll();
    console.log(`\u2713 Gates refreshed. Token reduction: ${tokenSavings.pct}% saved (${tokenSavings.before - tokenSavings.after} tok saved).`);
    break;
  }
  case "unpark": {
    const target = cleanArgs[1];
    if (!target) {
      console.error("Usage: mo unpark <skill-name>");
      process.exit(1);
    }
    assertOwnsClaudeDir();
    const parker = new ClaudeSkillParker(config, registryManager);
    const res = parker.unparkSkill(target);
    console.log(`\u2713 Unparked '${res.name}' back to ~/.claude/skills/${res.name}`);
    const scanner = new SkillScanner;
    const paths = config.getPaths();
    const fullPathOf = (c) => registryManager.resolveFullPath(c);
    const { unique: scanned } = dedupeByName([
      ...(existsSync13(paths.claudeDir) ? scanner.scanDirectory(paths.claudeDir, "claude") : []).filter((c) => !pluginIndex.isStaleCachePath(fullPathOf(c))).map((c) => ({ ...c, always_on: !pluginIndex.isDormant(c) })),
      ...existsSync13(paths.geminiDir) ? scanner.scanDirectory(paths.geminiDir, "gemini") : []
    ], fullPathOf);
    registryManager.upsertScanned(scanned);
    registryManager.pruneMissing(["claude", "gemini"]);
    if (existsSync13(paths.claudeDir)) {
      new ClaudeBridge(config, registryManager, reporter).syncToClaude();
    }
    const { tokenSavings } = reporter.renderAll();
    console.log(`\u2713 Gates refreshed. Token reduction: ${tokenSavings.pct}% saved.`);
    break;
  }
  case "init-agents": {
    const ruleGen = new RuleGenerator(config, registryManager);
    const agentsMd = ruleGen.generateAgentsMd();
    console.log(agentsMd);
    break;
  }
  case "mcp-snippet": {
    const ruleGen = new RuleGenerator(config, registryManager);
    console.log(ruleGen.generateMcpSnippet());
    break;
  }
  case "mcp": {
    const mcpServer = new UniversalMcpServer(config, registryManager, healthChecker);
    mcpServer.startStdio();
    break;
  }
  case "help":
  case "--help":
  default: {
    const isUnknown = command !== "help" && command !== "--help";
    if (isUnknown)
      console.error(`Unknown command: ${command}
`);
    (isUnknown ? console.error : console.log)(`
master-of (v2.0.0) \u2014 Universal AI Skill & Context Gateway

Usage:
  mo [command] [options]

Commands:
  status, check     Show brief gate status, broken dependencies & token savings
  full [--raw]      Show skill inventory (safe compact summary by default; --raw for full text)
  gate <domain>     Print pre-rendered gate index (e.g. mo gate design --source gemini)
  search <query>    Search across all indexed skills
  doctor            Run diagnostic health checks
  sync              Scan Claude/AGY skills, prune gone files, regenerate gates
  classify <name> <category>  Confirm a component's gate (--desc "<one-liner>", --cluster, --domain)
  ignore <name>     Keep a component out of every gate and the unclassified list
  claude-setup [dir]  Write the Claude Code plugin (gate skills + hook driven by mo)
  session-start     Hook entry: rescan, re-render, report only what changed
  unclassified      List components still carrying the scanner's category guess (--source filters)
  remove <name>     Remove one component from the registry
  agy-setup [dir]   Generate AGY gate skills (master-of-design, master-of-dev, etc.)
  claude-sync [dir] Sync gate & report files to Claude masterof directory
  unparked          List raw skills currently always-on in ~/.claude/skills
  park <name> [cat] Park a raw skill into skills-library (or mo park --all)
  unpark <name>     Move a parked skill back to ~/.claude/skills
  init-agents       Output AGENTS.md / Cursor rules template
  mcp-snippet       Output JSON config for Cursor, Windsurf, Claude Desktop
  mcp               Start Model Context Protocol (MCP) Stdio server

Options:
  --data-dir <dir>  Use custom master-of data directory
  --sandbox <dir>   Enforce sandbox boundary
  --source <name>   Gate view to read: claude (default) or gemini
  --json            Output in JSON format
`);
    if (isUnknown)
      process.exit(1);
    break;
  }
}
