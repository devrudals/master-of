#!/usr/bin/env bun
// SessionStart hook for the master-of skill-gate system.
//
// Every session start, this scans every SKILL.md Claude Code can currently see
// (raw skills under ~/.claude/skills, plus every skill bundled in every
// installed plugin — enabled or disabled, since a disabled plugin's files are
// still on disk) and compares that set against the paths already recorded in
// ~/.claude/masterof/state.json.
//
// - No diff -> silent exit, zero tokens spent.
// - SKILL.md paths on disk that registry.json doesn't know about -> emitted as
//   additionalContext so the running Claude instance classifies each one into
//   the right category in registry.json (creating a new one if none fits), and
//   disables the owning plugin if it's plugin-based, per the master-of SKILL.md.
// - registry.json paths that no longer exist on disk -> flagged so Claude
//   prunes the stale entries.
//
// Both diffs are taken against registry.json, NOT against a remembered
// snapshot, and that's deliberate:
//   * Additions: an earlier version recorded every scanned path in state.json
//     and diffed against that. Because the snapshot was saved unconditionally,
//     a session that found a new skill but ended before classifying it never
//     mentioned that skill again -- it stayed unclassified, ungated, and
//     silently always-on forever. Diffing against the registry is
//     self-healing: anything unclassified keeps surfacing until it's actually
//     filed (or explicitly dismissed via state.json's `dismissed` list).
//   * Removals: the snapshot only ever held what the scanner walks
//     (~/.claude/skills + installed plugins), but most registry entries are
//     raw skills that have since been MOVED to ~/.claude/skills-library to make
//     them dormant -- which the scanner deliberately doesn't walk. So deleting
//     a library skill could never be detected, and its gate would keep
//     offering a path that fails to Read. Checking each registry path's
//     existence directly covers all of them.
//
// This hook never edits registry.json itself — classification needs judgment
// (reading each SKILL.md's description, picking/creating a category), which
// belongs to the model, not this script. The script's only job is cheap,
// deterministic diffing.

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { checkHealth } from "../scripts/health.ts";

const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude");
// Where this plugin is installed. The harness sets CLAUDE_PLUGIN_ROOT for
// plugin hooks; when run by hand (check-skills' Step 0) fall back to this
// file's own location. Never a fixed ~/.claude/skills/... path -- a
// marketplace install lives under ~/.claude/plugins/cache instead.
const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || join(HERE, "..");
const SKILLS_DIR = join(CLAUDE_DIR, "skills");
const COMMANDS_DIR = join(CLAUDE_DIR, "commands");
const AGENTS_DIR = join(CLAUDE_DIR, "agents");
const INSTALLED_PLUGINS_FILE = join(CLAUDE_DIR, "plugins", "installed_plugins.json");
const MASTEROF_DIR = join(CLAUDE_DIR, "masterof");
const STATE_FILE = join(MASTEROF_DIR, "state.json");
const REGISTRY_FILE = join(MASTEROF_DIR, "registry.json");
const PREFS_FILE = join(MASTEROF_DIR, "preferences.json");
const CONFIG_FILE = join(MASTEROF_DIR, "config.json");

// The six domain gates this plugin ships (design/dev/research/stock/planning/
// pipelines -- each a real <plugin root>/skills/<cat>/SKILL.md
// file) need a matching registry.json entry to classify anything into, or
// every scan finds "added" skills with nowhere to put them. A fresh install
// (or a registry.json a user deleted by hand) has no such file, and without
// this, `loadRegisteredPaths()` fails open with `ok: false` and `added`
// silently comes back empty forever -- the hook would never again flag a
// single unclassified skill, on any future session, because it always reads
// as "nothing to compare against" rather than "nothing classified yet".
// Bootstrapping the skeleton (categories + empty arrays, no skill entries)
// the first time it's missing turns that into a one-time no-op instead of a
// permanent blind spot. Never overwrites an existing registry.json.
const DEFAULT_CATEGORY_META: Record<string, Record<string, string>> = {
  design: {
    label_ko: "디자인 / UI / 모션", desc_ko: "UI 폴리시, 애니메이션, 컬러/타이포/레이아웃 리뷰, 디자인 시스템",
    label_en: "Design / UI / motion", desc_en: "UI polish, animation, color/type/layout review, design systems",
  },
  dev: {
    label_ko: "개발 도구", desc_ko: "브라우저 자동화, MCP 서버 제작, 스킬 검색 등 개발 보조 도구",
    label_en: "Dev tooling", desc_en: "Browser automation, MCP server building, skill discovery and other dev helpers",
  },
  research: {
    label_ko: "리서치 / 웹 스크래핑", desc_ko: "웹 검색·추출·모니터링, 이미지 인식, 작업 관찰",
    label_en: "Research / web scraping", desc_en: "Web search, extraction, monitoring, image understanding, task observation",
  },
  stock: {
    label_ko: "주식 / 기업 분석", desc_ko: "종목/기업 리서치, 재무 분석 관련 스킬",
    label_en: "Stock / company analysis", desc_en: "Company and ticker research, financial analysis",
  },
  planning: {
    label_ko: "프로젝트 관리", desc_ko: "기획→실행→검증 전체 프로젝트 관리 프레임워크",
    label_en: "Project management", desc_en: "Plan → execute → verify project-management frameworks",
  },
  pipelines: {
    label_ko: "전체 파이프라인 (단일 선택)", desc_ko: "지원 스킬 조합이 아니라 하나를 골라 처음부터 끝까지 실행하는 완결형 워크플로우",
    label_en: "Whole pipelines (single-select)", desc_en: "End-to-end workflows you pick ONE of, rather than supporting skills you combine",
  },
  always_on: {
    label_ko: "상시 활성 (게이트 없음)", desc_ko: "훅 의존/무비용/은밀 자동발동 등의 이유로 게이트를 거치지 않고 항상 켜져있는 것들",
    label_en: "Always on (not gated)", desc_en: "Kept always-on on purpose: hook dependencies, near-zero cost, skills that must fire unprompted",
  },
};
const DOMAIN_CATEGORIES = Object.keys(DEFAULT_CATEGORY_META).filter((k) => k !== "always_on");

// Report language: decided from the system locale at bootstrap so the very
// first report is already in the right language, with no model step on the
// critical path. check-skills revises it if the user's session language
// turns out to differ (a Korean speaker on an en_US machine, say).
function detectLanguage(): "ko" | "en" {
  const env = [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG, process.env.LANGUAGE].find(Boolean) || "";
  return /^ko/i.test(env) ? "ko" : "en";
}

function bootstrapIfMissing() {
  mkdirSync(MASTEROF_DIR, { recursive: true });
  if (!existsSync(REGISTRY_FILE)) {
    const skeleton: any = { category_meta: { ...DEFAULT_CATEGORY_META } };
    for (const cat of DOMAIN_CATEGORIES) skeleton[cat] = [];
    skeleton.always_on = [];
    writeFileSync(REGISTRY_FILE, JSON.stringify(skeleton, null, 2));
  }
  if (!existsSync(PREFS_FILE)) {
    const prefs: any = {};
    for (const cat of DOMAIN_CATEGORIES) prefs[cat] = { mode: "always_ask" };
    writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
  }
  if (!existsSync(CONFIG_FILE)) {
    const l = detectLanguage();
    writeFileSync(
      CONFIG_FILE,
      JSON.stringify(
        {
          report_language: l,
          report_language_name: l === "ko" ? "Korean" : "English",
          determined_from: "system locale (LANG) at first SessionStart; check-skills may revise from the user's actual session language",
        },
        null,
        2
      )
    );
  }
}

// This plugin's own top-level directory is always exempt by exact name --
// its gate skills live nested under <plugin root>/skills/, not
// as top-level dirs themselves, so this only ever needs to match the one name.
const IGNORED_SKILL_DIR_PATTERNS = [/^master-of$/];

// At or above this many unclassified skills in one scan, the hook tells the
// model to confirm the plan with the user before moving/disabling anything.
// One or two new skills after an install is routine; thirty on a fresh
// install is the user's whole skill library being reorganized.
const BULK_THRESHOLD = 5;

// Everything else that's permanently exempt (hook-dependent plugins,
// output-style/near-zero-cost plugins, silently-opportunistic raw skills)
// is tracked as data in registry.json's "always_on" array now, NOT hardcoded
// here -- so classifying something as a permanent exemption is a JSON edit
// `check-skills` makes, not a code change. Read it at scan time.
function loadAlwaysOnExemptions(): {
  pluginIds: Set<string>;
  rawSkillNames: Set<string>;
  rawCommandNames: Set<string>;
  rawAgentNames: Set<string>;
} {
  const pluginIds = new Set<string>();
  const rawSkillNames = new Set<string>();
  const rawCommandNames = new Set<string>();
  const rawAgentNames = new Set<string>();
  try {
    const reg = JSON.parse(readFileSync(REGISTRY_FILE, "utf8"));
    for (const e of reg.always_on || []) {
      if (e.type === "plugin" && e.identifier) pluginIds.add(e.identifier);
      if (e.type === "raw_skill" && e.identifier) rawSkillNames.add(e.identifier);
      if (e.type === "raw_command" && e.identifier) rawCommandNames.add(e.identifier);
      if (e.type === "raw_agent" && e.identifier) rawAgentNames.add(e.identifier);
    }
  } catch {
    // registry.json missing/malformed -> no exemptions beyond the pattern above.
    // Fails open (nothing exempt), not closed -- worst case something that
    // should be exempt gets flagged as "new" once, harmless.
  }
  return { pluginIds, rawSkillNames, rawCommandNames, rawAgentNames };
}

type Kind = "skill" | "command" | "agent";
type Found = { path: string; source: string; type: Kind };

// The frontmatter `description` is what classification actually needs
// (which domain, is it a whole pipeline, should it be always-on). Shipping it
// in the hook output means a fresh install with 50 skills classifies from
// ~50 short lines instead of 50 full-file Reads -- the difference between a
// first session that costs ~3k tokens and one that costs ~100k.
function frontmatterDescription(path: string): string {
  try {
    const text = readFileSync(path, "utf8");
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) return "";
    const m = fm[1].match(/^description:\s*["']?([\s\S]*?)["']?\s*$/m);
    const d = (m ? m[1] : "").replace(/\s+/g, " ").trim();
    return d.length > 240 ? d.slice(0, 237) + "..." : d;
  } catch {
    return "";
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function isIgnoredRawSkill(name: string, rawSkillNames: Set<string>): boolean {
  if (rawSkillNames.has(name)) return true;
  return IGNORED_SKILL_DIR_PATTERNS.some((re) => re.test(name));
}

// Raw skills: every ~/.claude/skills/<name>/SKILL.md not in the ignore list.
function scanRawSkills(rawSkillNames: Set<string>): Found[] {
  const out: Found[] = [];
  for (const name of safeReaddir(SKILLS_DIR)) {
    if (isIgnoredRawSkill(name, rawSkillNames)) continue;
    const skillMd = join(SKILLS_DIR, name, "SKILL.md");
    if (existsSync(skillMd)) out.push({ path: skillMd, source: `raw:${name}`, type: "skill" });
  }
  return out;
}

// Commands and agents are always-on the same way skills are: every
// ~/.claude/commands/<x>.md is a slash command in every session, every
// ~/.claude/agents/<x>.md is a subagent type listed in every system prompt.
// A skill-only scan leaves those invisible -- which for a framework that
// ships 30+ agents is a bigger always-on bill than its skills.
function safeReadMdFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(".md"))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function scanRawExtras(rawCommandNames: Set<string>, rawAgentNames: Set<string>): Found[] {
  const out: Found[] = [];
  for (const f of safeReadMdFiles(COMMANDS_DIR)) {
    const name = f.slice(0, -3);
    if (rawCommandNames.has(name)) continue;
    out.push({ path: join(COMMANDS_DIR, f), source: `raw:${name}`, type: "command" });
  }
  for (const f of safeReadMdFiles(AGENTS_DIR)) {
    const name = f.slice(0, -3);
    if (rawAgentNames.has(name)) continue;
    out.push({ path: join(AGENTS_DIR, f), source: `raw:${name}`, type: "agent" });
  }
  return out;
}

// Plugin skills: every skill bundled in every *installed* plugin (regardless
// of enabled/disabled state -- disabled plugins' files are still on disk and
// still valid Read targets for a master-of gate).
function scanPluginComponents(pluginIds: Set<string>): Found[] {
  const out: Found[] = [];
  let installed: any;
  try {
    installed = JSON.parse(readFileSync(INSTALLED_PLUGINS_FILE, "utf8"));
  } catch {
    return out;
  }
  const plugins = installed?.plugins || {};
  for (const pluginId of Object.keys(plugins)) {
    if (pluginIds.has(pluginId)) continue;
    const entries = plugins[pluginId];
    if (!Array.isArray(entries) || entries.length === 0) continue;
    const installPath = entries[0]?.installPath;
    if (!installPath || !existsSync(installPath)) continue;
    const skillsDir = join(installPath, "skills");
    for (const skillName of safeReaddir(skillsDir)) {
      const skillMd = join(skillsDir, skillName, "SKILL.md");
      if (existsSync(skillMd)) out.push({ path: skillMd, source: `plugin:${pluginId}::${skillName}`, type: "skill" });
    }
    // Standard plugin layout only (commands/*.md, agents/*.md). A manifest
    // that points these at custom paths isn't followed -- rare, and a wrong
    // guess would flag files that aren't components at all.
    for (const f of safeReadMdFiles(join(installPath, "commands"))) {
      out.push({ path: join(installPath, "commands", f), source: `plugin:${pluginId}::${f.slice(0, -3)}`, type: "command" });
    }
    for (const f of safeReadMdFiles(join(installPath, "agents"))) {
      out.push({ path: join(installPath, "agents", f), source: `plugin:${pluginId}::${f.slice(0, -3)}`, type: "agent" });
    }
  }
  return out;
}

function loadState(): { seenPaths: string[]; dismissed: string[] } {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    return { seenPaths: s.seenPaths || [], dismissed: s.dismissed || [] };
  } catch {
    return { seenPaths: [], dismissed: [] };
  }
}

// seenPaths is kept for diagnostics only (what the scanner could see last
// run) -- no decision is made from it. `dismissed` is the one escape hatch:
// a path listed there is never reported as unclassified again, for a skill
// the user has deliberately decided not to file. Nothing writes to it
// automatically; it's a manual JSON edit, the same way always_on is.
function saveState(seenPaths: string[], dismissed: string[]) {
  mkdirSync(MASTEROF_DIR, { recursive: true });
  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      { seenPaths: seenPaths.sort(), dismissed, lastScan: new Date().toISOString() },
      null,
      2
    )
  );
}

// Every path registry.json currently claims to manage, across all domain
// categories and always_on (whose entries may or may not carry a path).
function loadRegisteredPaths(): { paths: Map<string, string>; ok: boolean } {
  const paths = new Map<string, string>(); // path -> "<category>/<name>"
  try {
    const reg = JSON.parse(readFileSync(REGISTRY_FILE, "utf8"));
    for (const key of Object.keys(reg)) {
      if (key === "category_meta") continue;
      const arr = reg[key];
      if (!Array.isArray(arr)) continue;
      for (const e of arr) {
        if (e?.path) paths.set(e.path, `${key}/${e.name}`);
      }
    }
    return { paths, ok: true };
  } catch {
    // Missing/malformed registry: report nothing rather than flagging every
    // skill on disk as unclassified. check-skills handles a broken
    // registry; a SessionStart hook shouldn't dump 129 lines into context.
    return { paths, ok: false };
  }
}

function main() {
  bootstrapIfMissing();
  const { pluginIds, rawSkillNames, rawCommandNames, rawAgentNames } = loadAlwaysOnExemptions();
  const current: Found[] = [
    ...scanRawSkills(rawSkillNames),
    ...scanRawExtras(rawCommandNames, rawAgentNames),
    ...scanPluginComponents(pluginIds),
  ];
  const currentPaths = current.map((c) => c.path);

  const state = loadState();
  const dismissed = new Set(state.dismissed);
  const { paths: registered, ok: registryOk } = loadRegisteredPaths();

  // On disk but not in registry.json -> needs classifying. Re-reported every
  // session until it's filed, so an interrupted pass can't lose it.
  const added = registryOk
    ? current.filter((c) => !registered.has(c.path) && !dismissed.has(c.path))
    : [];

  // In registry.json but gone from disk -> stale entry whose gate would hand
  // out a path that fails to Read. Covers skills-library entries the scanner
  // itself never walks.
  const removed = [...registered.entries()]
    .filter(([p]) => !existsSync(p))
    .map(([p, label]) => `${label}  (${p})`);

  saveState(currentPaths, state.dismissed);

  // Broken dependencies the user asked to be told about (dead MCP binaries,
  // gated skills whose plugin is off so they can't work). Only `critical`
  // ones surface here, one line each, every session until fixed or dismissed
  // -- a warning-level partial (some agents off) belongs in the report, not
  // in every session's opening context. Dismiss by adding the issue's
  // subject (e.g. "MCP gbrain") to state.json's `dismissed`.
  const health = checkHealth().filter(
    (i) => i.severity === "critical" && !dismissed.has(i.subject)
  );

  if (added.length === 0 && removed.length === 0 && health.length === 0) {
    process.stdout.write(JSON.stringify({}));
    return;
  }

  const lines: string[] = [];
  if (health.length > 0) {
    lines.push("master-of health: something is broken right now (nothing is auto-fixed -- tell the user in one line each, in their language, then move on).");
    for (const i of health) lines.push(`  - ${i.subject}: ${i.detail}. Fix: ${i.fix}`);
    if (added.length === 0 && removed.length === 0) {
      lines.push(
        "\nThat's all -- registry.json itself is in sync. Mention the above to the user briefly " +
          "(one line each), then proceed with whatever they asked. Don't run the fix yourself."
      );
      process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") } })
      );
      return;
    }
    lines.push("");
  }
  lines.push("master-of: registry.json is out of sync with what's on disk.");
  if (added.length >= BULK_THRESHOLD) {
    lines.push(
      `\nThis is a bulk change (${added.length} unclassified) -- most likely a first run. ` +
        "Classify them all, but BEFORE moving any folders or disabling any plugin, show the " +
        "user a one-line plan (what goes where, which plugins get disabled) and get a yes. " +
        "Bulk filesystem changes in someone's first session without asking is not 'routine'."
    );
  }
  if (added.length > 0) {
    lines.push(`\n${added.length} component(s) on disk are not classified in registry.json (type in brackets):`);
    for (const a of added) {
      lines.push(`  - [${a.type}] ${a.source}  (${a.path})`);
      const d = frontmatterDescription(a.path);
      if (d) lines.push(`      ${d}`);
    }
  }
  if (removed.length > 0) {
    lines.push(`\n${removed.length} registry.json entr(ies) point at a path that no longer exists:`);
    for (const r of removed) lines.push(`  - ${r}`);
  }
  lines.push(
    `\nRead ${PLUGIN_ROOT}/skills/check-skills/SKILL.md ` +
      "(the 'check-skills' skill) and follow Step 1 there to classify the " +
      "additions and prune the removals into ~/.claude/masterof/registry.json. The " +
      "description under each addition is usually enough to classify it -- Read the " +
      "SKILL.md itself only when it isn't. Do this before moving on to whatever the " +
      "user actually asked for this session, unless it's clearly urgent -- a short " +
      "heads-up about what got filed where is enough, no need to ask permission for " +
      "routine classification. If classifying involved `claude plugin disable` or moving " +
      "a skill into ~/.claude/skills-library, say so and tell the user those take effect " +
      "at the NEXT session start (the current session still has them loaded). " +
      `Scripts that file refers to as <plugin root>/... live under ${PLUGIN_ROOT}.`
  );

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: lines.join("\n"),
      },
    })
  );
}

main();
