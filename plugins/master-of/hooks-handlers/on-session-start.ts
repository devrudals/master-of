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
import { join } from "path";
import { homedir } from "os";
import { checkHealth } from "../scripts/health";

const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude");
const SKILLS_DIR = join(CLAUDE_DIR, "skills");
const INSTALLED_PLUGINS_FILE = join(CLAUDE_DIR, "plugins", "installed_plugins.json");
const MASTEROF_DIR = join(CLAUDE_DIR, "masterof");
const STATE_FILE = join(MASTEROF_DIR, "state.json");
const REGISTRY_FILE = join(MASTEROF_DIR, "registry.json");
const PREFS_FILE = join(MASTEROF_DIR, "preferences.json");

// The six domain gates this plugin ships (design/dev/research/stock/planning/
// pipelines -- each a real ~/.claude/skills/master-of/skills/<cat>/SKILL.md
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
const DEFAULT_CATEGORY_META: Record<string, { label_ko: string; desc_ko: string }> = {
  design: { label_ko: "디자인 / UI / 모션", desc_ko: "UI 폴리시, 애니메이션, 컬러/타이포/레이아웃 리뷰, 디자인 시스템" },
  dev: { label_ko: "개발 도구", desc_ko: "브라우저 자동화, MCP 서버 제작, 스킬 검색 등 개발 보조 도구" },
  research: { label_ko: "리서치 / 웹 스크래핑", desc_ko: "웹 검색·추출·모니터링, 이미지 인식, 작업 관찰" },
  stock: { label_ko: "주식 / 기업 분석", desc_ko: "종목/기업 리서치, 재무 분석 관련 스킬" },
  planning: { label_ko: "프로젝트 관리", desc_ko: "기획→실행→검증 전체 프로젝트 관리 프레임워크" },
  pipelines: { label_ko: "전체 파이프라인 (단일 선택)", desc_ko: "지원 스킬 조합이 아니라 하나를 골라 처음부터 끝까지 실행하는 완결형 워크플로우" },
};
const DOMAIN_CATEGORIES = Object.keys(DEFAULT_CATEGORY_META);

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
}

// This plugin's own top-level directory is always exempt by exact name --
// its gate skills live nested under ~/.claude/skills/master-of/skills/, not
// as top-level dirs themselves, so this only ever needs to match the one name.
const IGNORED_SKILL_DIR_PATTERNS = [/^master-of$/];

// Everything else that's permanently exempt (hook-dependent plugins,
// output-style/near-zero-cost plugins, silently-opportunistic raw skills)
// is tracked as data in registry.json's "always_on" array now, NOT hardcoded
// here -- so classifying something as a permanent exemption is a JSON edit
// `check-skills` makes, not a code change. Read it at scan time.
function loadAlwaysOnExemptions(): { pluginIds: Set<string>; rawSkillNames: Set<string> } {
  const pluginIds = new Set<string>();
  const rawSkillNames = new Set<string>();
  try {
    const reg = JSON.parse(readFileSync(REGISTRY_FILE, "utf8"));
    for (const e of reg.always_on || []) {
      if (e.type === "plugin" && e.identifier) pluginIds.add(e.identifier);
      if (e.type === "raw_skill" && e.identifier) rawSkillNames.add(e.identifier);
    }
  } catch {
    // registry.json missing/malformed -> no exemptions beyond the pattern above.
    // Fails open (nothing exempt), not closed -- worst case something that
    // should be exempt gets flagged as "new" once, harmless.
  }
  return { pluginIds, rawSkillNames };
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
function scanRawSkills(rawSkillNames: Set<string>): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];
  for (const name of safeReaddir(SKILLS_DIR)) {
    if (isIgnoredRawSkill(name, rawSkillNames)) continue;
    const skillMd = join(SKILLS_DIR, name, "SKILL.md");
    if (existsSync(skillMd)) out.push({ path: skillMd, source: `raw:${name}` });
  }
  return out;
}

// Plugin skills: every skill bundled in every *installed* plugin (regardless
// of enabled/disabled state -- disabled plugins' files are still on disk and
// still valid Read targets for a master-of gate).
function scanPluginSkills(pluginIds: Set<string>): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];
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
      if (existsSync(skillMd)) out.push({ path: skillMd, source: `plugin:${pluginId}::${skillName}` });
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
  const { pluginIds, rawSkillNames } = loadAlwaysOnExemptions();
  const current = [...scanRawSkills(rawSkillNames), ...scanPluginSkills(pluginIds)];
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
    lines.push("master-of 점검: 지금 고장 난 것이 있습니다 (자동으로 고치지 않음 — 사용자에게 한 줄로 알리고 넘어가세요).");
    for (const i of health) lines.push(`  - ${i.subject}: ${i.detail}. 해결: ${i.fix}`);
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
  if (added.length > 0) {
    lines.push(`\n${added.length} SKILL.md source(s) on disk are not classified in registry.json:`);
    for (const a of added) lines.push(`  - ${a.source}  (${a.path})`);
  }
  if (removed.length > 0) {
    lines.push(`\n${removed.length} registry.json entr(ies) point at a path that no longer exists:`);
    for (const r of removed) lines.push(`  - ${r}`);
  }
  lines.push(
    "\nRead ~/.claude/skills/master-of/skills/check-skills/SKILL.md " +
      "(the 'check-skills' skill) and follow Step 1 there to classify the " +
      "additions and prune the removals into ~/.claude/masterof/registry.json. Do this " +
      "before moving on to whatever the user actually asked for this session, unless " +
      "it's clearly urgent -- a short heads-up about what got filed where is enough, " +
      "no need to ask permission for routine classification."
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
