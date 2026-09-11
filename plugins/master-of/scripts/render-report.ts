#!/usr/bin/env bun
// Regenerates everything a session reads from ~/.claude/masterof/:
//   report.txt / report-brief.txt  -- what check-skills(-all) print
//   gates/<category>.txt, _all.txt -- what a domain gate reads to activate
// This does the formatting ONCE (whenever registry.json or preferences.json
// changes); the skills just Read the result verbatim. Run it via
// <plugin root>/hooks/run.sh scripts/render-report.ts after any registry edit.
//
// Language: every user-facing string comes from the L table below, picked by
// ~/.claude/masterof/config.json's `report_language` ("ko" | "en"). The
// SessionStart hook bootstraps that file from the system LANG on first run,
// and check-skills may revise it from the user's actual session language.
// Per-entry text uses `description_<lang>` when present, else `description`.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { checkHealth, type Issue } from "./health.ts";

const MASTEROF_DIR = join(homedir(), ".claude", "masterof");
const REGISTRY_FILE = join(MASTEROF_DIR, "registry.json");
const PREFS_FILE = join(MASTEROF_DIR, "preferences.json");
const CONFIG_FILE = join(MASTEROF_DIR, "config.json");
const OUT_FILE = join(MASTEROF_DIR, "report.txt");
const BRIEF_FILE = join(MASTEROF_DIR, "report-brief.txt");
const GATES_DIR = join(MASTEROF_DIR, "gates");
// The plugin's own root, derived from this script's location rather than a
// fixed path: a skills-dir checkout lives at ~/.claude/skills/master-of, a
// marketplace install at ~/.claude/plugins/cache/<marketplace>/master-of/<ver>.
const SKILLS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const CATEGORY_ORDER = ["design", "dev", "research", "stock", "planning", "pipelines"];

// Every SKILL.md whose frontmatter `description` is always-on in a session.
// The root master-of/SKILL.md counts: it's the cross-domain entry point with
// a real description in the system prompt like any other gate.
const GATE_FILES = [
  "SKILL.md",
  "skills/design/SKILL.md",
  "skills/dev/SKILL.md",
  "skills/research/SKILL.md",
  "skills/stock/SKILL.md",
  "skills/planning/SKILL.md",
  "skills/pipelines/SKILL.md",
  "skills/check-skills/SKILL.md",
  "skills/check-skills-all/SKILL.md",
].map((p) => join(SKILLS_ROOT, p));

// Chars-per-token heuristics. ASCII ~4; Hangul/CJK tokenizes far denser
// (~1.5) -- checked against what `claude plugin details` reports for these
// same gate descriptions. Order-of-magnitude, not accounting.
const CHARS_PER_TOKEN = 4;
const CJK_CHARS_PER_TOKEN = 1.5;

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------
type Strings = {
  title: string;
  briefTitle: string;
  health: string;
  healthOk: string;
  healthIntro: string;
  critical: string;
  warning: string;
  total: (n: number) => string;
  mix: (s: number, c: number, a: number) => string;
  domain: (d: string) => string;
  bundles: string;
  bundlesIntro: string;
  bundleLine: (name: string, n: number, cat: string) => string;
  alwaysOnLabel: string;
  alwaysOnDesc: string;
  reason: (r: string) => string;
  bundleRow: (b: string, what: string, r: string, why: string) => string;
  prefs: string;
  modeCount: (n: number) => string;
  fixedDefault: (d: string) => string;
  conditional: (n: number, fb: string) => string;
  savings: string;
  before: (n: number) => string;
  after: (n: number) => string;
  saved: (pct: number) => string;
  savingsNote: string;
  generated: (iso: string) => string;
  counts: string;
  countLine: (cat: string, label: string, n: number, mix: string, note: string) => string;
  alwaysOnCount: (n: number) => string;
  bundleNote: (name: string, agentsNote: string) => string;
  agentsKept: (n: number) => string;
  briefHint: string;
  gateHeader: (cat: string, label: string, n: number) => string;
  gateFormat: string;
  gateFormatPrefixed: (prefix: string) => string;
  gateTypes: string;
  relatedPipelines: string;
  spawnedAgents: string;
  allHeader: string[];
  clusterLabel: (c: string) => string;
  modeLabel: Record<string, string>;
  typeTag: Record<string, string>;
  typeLabel: Record<string, string>;
  reasonText: Record<string, string>;
  userOnly: string;
  dep: (plugin: string, what: string, off: boolean, critical: boolean) => string;
  seeBundles: string;
};

const KO: Strings = {
  title: "# master-of 스킬 게이트 시스템 — 현황판",
  briefTitle: "# master-of 현황 (요약)",
  health: "## 점검 — 지금 고장 난 것",
  healthOk: "문제 없음 — MCP 서버 실행 파일과 게이트 스킬의 플러그인 의존성이 모두 정상입니다.",
  healthIntro: "자동으로 고치지 않습니다. 플러그인 on/off와 MCP 설정은 **다음 세션 시작 시** 반영되므로, 고친 뒤 새 세션에서 확인하세요.",
  critical: "심각",
  warning: "주의",
  total: (n) => `총 ${n}개`,
  mix: (s, c, a) => ` (스킬 ${s} · 커맨드 ${c} · 에이전트 ${a})`,
  domain: (d) => `(분야: ${d})`,
  bundles: "## 멀티 스킬 플러그인",
  bundlesIntro:
    "여러 스킬을 하나로 묶어 배포하는 대용량 플러그인입니다. 개별 스킬로 펼쳐 보여주지 않지만, " +
    "이미 알맞은 master-of 게이트 안에 전부 분류되어 있어 요청 시 그대로 찾아 활성화됩니다.",
  bundleLine: (name, n, cat) => `- **${name}** (스킬 ${n}개) — \`${cat}\` 게이트 안에 이미 분류되어 있음`,
  alwaysOnLabel: "상시 활성 (게이트 없음)",
  alwaysOnDesc: "훅 의존/무비용/은밀 자동발동 등의 이유로 게이트를 거치지 않고 항상 켜져있는 것들",
  reason: (r) => `(사유: ${r})`,
  bundleRow: (b, what, r, why) => `**${b} ${what}** (사유: ${r}) | ${why} — 세부는 "멀티 스킬 플러그인" 참조`,
  prefs: "## 애매할 때 처리 방식",
  modeCount: (n) => `(${n}개)`,
  fixedDefault: (d) => ` — 기본값: ${d}`,
  conditional: (n, fb) => ` — 규칙 ${n}개, 폴백: ${fb}`,
  savings: "## 토큰 절약 추정치 (세션마다 always-on으로 소모되는 비용 기준)",
  before: (n) => `게이트 적용 전 (구성요소 ${n}개가 전부 평소에 노출됐다면)`,
  after: (n) => `게이트 적용 후 (지금, 게이트 ${n}개만 노출)`,
  saved: (pct) => `절약 (${pct}% 감소)`,
  savingsNote:
    "*문자수 기반 추정치입니다 (영문 4자/한글 1.5자 ≈ 1 tok) — 실제 토큰화 결과와 다를 수 있음. always_on 항목은 게이트 여부와 무관하게 원래도 켜져있었으므로 이 계산에서 제외.*",
  generated: (iso) => `*(생성 시각: ${iso})*`,
  counts: "## 게이트별 구성요소 수",
  countLine: (cat, label, n, mix, note) => `- **/${cat}** ${label}: ${n}개${mix}${note}`,
  alwaysOnCount: (n) => `- **상시 활성** (게이트 없음): ${n}개`,
  bundleNote: (name, agentsNote) => ` — ${name} 플러그인 전체가 여기 분류됨${agentsNote}`,
  agentsKept: (n) => ` (에이전트 ${n}개는 스폰 비용 때문에 상시)`,
  briefHint: '*전체 목록은 "전체 보여줘", 한 분야만은 "design에 뭐 있어"처럼 요청하세요.*',
  gateHeader: (cat, label, n) => `# ${cat} — ${label} (${n}개)`,
  gateFormat: "# 형식: 이름 | 설명 | Read할 경로",
  gateFormatPrefixed: (prefix) => `# 형식: 이름 | 설명 | 경로 — 경로가 /로 시작하지 않으면 앞에 ${prefix} 를 붙여 Read`,
  gateTypes: "# [커맨드] = 본문이 프롬프트 템플릿, 요청을 $ARGUMENTS로 넣고 따름 · [에이전트] = 본문이 시스템 프롬프트, general-purpose 에이전트에 넣어 스폰",
  relatedPipelines: '## 관련 파이프라인 — 요청이 "전체/처음부터 끝까지" 규모일 때만 대안으로 제시 (단일 선택)',
  spawnedAgents: "## 위 항목이 스폰하는 에이전트 — 부모 스킬이 subagent_type으로 요구하면 여기서 찾아 general-purpose로 스폰",
  allHeader: ["# master-of 전체 통합 인덱스 (여러 분야를 한 번에 매칭할 때만 사용)", "# 한 분야만 필요하면 gates/<분야>.txt 를 읽는 쪽이 훨씬 쌉니다."],
  clusterLabel: (c) =>
    ({
      core_loop: "핵심 루프",
      audit_review: "감사/리뷰",
      milestone: "마일스톤",
      research_ideate: "탐색/아이디어",
      workspace_state: "작업공간/상태",
      docs: "문서",
      ui: "UI",
      ai_eval: "AI 평가",
      ns_meta: "네임스페이스 진입점",
      utility: "유틸리티",
    })[c] || c,
  modeLabel: { always_ask: "매번 물어보기", fixed_default: "고정 기본값", conditional: "조건부", smart: "AI 알아서 판단" },
  typeTag: { command: "[커맨드] ", agent: "[에이전트] " },
  typeLabel: { raw_agent: "에이전트", raw_command: "커맨드", raw_skill: "스킬", plugin: "플러그인" },
  reasonText: {
    spawn_cost: "게이트된 부모 스킬이 자주 스폰 — 게이트하면 스폰마다 파일을 Read해야 해서 절약분보다 비용이 큼",
    hook_dependency: "훅이 이 플러그인에 묶여 있어 끄면 훅도 죽음",
    output_style: "출력 스타일 — 게이트할 대상이 아님",
    near_zero_cost: "상시 비용이 거의 0",
    silent_opportunistic: "사용자가 이름을 몰라도 스스로 발동해야 하는 스킬",
  },
  userOnly: " [사용자 지명 시에만]",
  dep: (plugin, what, off, critical) => ` [의존: ${plugin} ${what}${off ? " — 현재 꺼짐" : ""}${critical ? ", 없으면 동작 불가" : ""}]`,
  seeBundles: "멀티 스킬 플러그인",
};

const EN: Strings = {
  title: "# master-of skill-gate system — status",
  briefTitle: "# master-of status (brief)",
  health: "## Health — what's broken right now",
  healthOk: "Nothing broken — every MCP server binary resolves and every gated skill's plugin dependency is enabled.",
  healthIntro: "Nothing here is fixed automatically. Plugin enable/disable and MCP config changes take effect at the **next session start** — fix, then restart to confirm.",
  critical: "CRITICAL",
  warning: "warning",
  total: (n) => `${n} total`,
  mix: (s, c, a) => ` (${s} skills · ${c} commands · ${a} agents)`,
  domain: (d) => `(domain: ${d})`,
  bundles: "## Multi-skill plugins",
  bundlesIntro:
    "Large plugins that ship many skills as one bundle. They aren't expanded here, but every member is " +
    "already classified into the right master-of gate and activates normally on request.",
  bundleLine: (name, n, cat) => `- **${name}** (${n} skills) — already classified under the \`${cat}\` gate`,
  alwaysOnLabel: "Always on (not gated)",
  alwaysOnDesc: "Kept always-on on purpose — hook dependencies, near-zero cost, skills that must fire unprompted, etc.",
  reason: (r) => `(reason: ${r})`,
  bundleRow: (b, what, r, why) => `**${b} ${what}** (reason: ${r}) | ${why} — see "Multi-skill plugins"`,
  prefs: "## When a request is ambiguous",
  modeCount: (n) => `(${n})`,
  fixedDefault: (d) => ` — default: ${d}`,
  conditional: (n, fb) => ` — ${n} rule(s), fallback: ${fb}`,
  savings: "## Estimated token saving (always-on cost per session)",
  before: (n) => `before gating (if all ${n} components were always-on)`,
  after: (n) => `after gating (now: only ${n} gate descriptions)`,
  saved: (pct) => `saved (${pct}% less)`,
  savingsNote:
    "*Character-based estimate (≈4 ASCII / 1.5 CJK chars per token) — actual tokenization may differ. always_on items were on regardless of gating and are excluded.*",
  generated: (iso) => `*(generated: ${iso})*`,
  counts: "## Components per gate",
  countLine: (cat, label, n, mix, note) => `- **/${cat}** ${label}: ${n}${mix}${note}`,
  alwaysOnCount: (n) => `- **always on** (not gated): ${n}`,
  bundleNote: (name, agentsNote) => ` — the whole ${name} plugin is classified here${agentsNote}`,
  agentsKept: (n) => ` (${n} agents kept always-on for spawn cost)`,
  briefHint: '*Ask "show everything" for the full list, or "what\'s in design" for one gate.*',
  gateHeader: (cat, label, n) => `# ${cat} — ${label} (${n})`,
  gateFormat: "# format: name | description | path to Read",
  gateFormatPrefixed: (prefix) => `# format: name | description | path — if the path doesn't start with /, prepend ${prefix} before Reading`,
  gateTypes: "# [command] = body is a prompt template, put the request in as $ARGUMENTS and follow it · [agent] = body is a system prompt, spawn a general-purpose agent with it",
  relatedPipelines: '## Related pipelines — offer only for whole-workflow requests ("end to end", "do all of it"); single-select',
  spawnedAgents: "## Agents spawned by the entries above — when a parent skill asks for one by subagent_type, find it here and spawn general-purpose with its body",
  allHeader: ["# master-of combined index (only for matching across several domains at once)", "# For one domain, reading gates/<domain>.txt is much cheaper."],
  clusterLabel: (c) => c,
  modeLabel: { always_ask: "Always ask", fixed_default: "Fixed default", conditional: "Conditional", smart: "Model decides" },
  typeTag: { command: "[command] ", agent: "[agent] " },
  typeLabel: { raw_agent: "agents", raw_command: "commands", raw_skill: "skills", plugin: "plugins" },
  reasonText: {
    spawn_cost: "spawned often by gated parent skills — gating them would cost a file read per spawn, more than it saves",
    hook_dependency: "its hooks would die with the plugin",
    output_style: "an output style — nothing to gate",
    near_zero_cost: "always-on cost is near zero",
    silent_opportunistic: "must fire on its own without the user naming it",
  },
  userOnly: " [user-invoked only]",
  dep: (plugin, what, off, critical) => ` [needs: ${plugin} ${what}${off ? " — currently OFF" : ""}${critical ? ", can't work without it" : ""}]`,
  seeBundles: "Multi-skill plugins",
};

let LANG = "ko";
let L: Strings = KO;
function loc(e: any, key: string): string {
  return e[`${key}_${LANG}`] || e[`${key}_ko`] || e[key] || "";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function extractDescription(path: string): string {
  try {
    const text = readFileSync(path, "utf8");
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) return "";
    const m = fm[1].match(/^description:\s*"?(.*?)"?$/m);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

function estimateTokens(text: string): number {
  let cjk = 0;
  for (const ch of text) if (ch.charCodeAt(0) > 0x1100) cjk++;
  return Math.round(cjk / CJK_CHARS_PER_TOKEN + (text.length - cjk) / CHARS_PER_TOKEN);
}

const MODE_ORDER = ["always_ask", "fixed_default", "conditional", "smart"];

// A literal " | " separator: runs of whitespace collapse outside a code
// fence and can't column-align descriptions anyway (only a real table can).
const SEP = " | ";

// ---------------------------------------------------------------------------
// Gate indexes (~/.claude/masterof/gates/<category>.txt)
//
// A gate used to Read registry.json (~60KB / ~16k tokens) to activate one
// skill -- 2.5x the plugin's whole per-session saving, on one activation.
// These files carry only name / short description / path for ONE category
// (100-2,500 tokens), inline that domain's related pipelines, and list the
// agents its entries spawn. `_all.txt` is the cross-domain fallback.
// GENERATED -- never hand-edit; registry.json is the source of truth.
// ---------------------------------------------------------------------------
let brokenDeps = new Set<string>(); // "<cat>/<name>" with a disabled dependency

// `disable-model-invocation: true` in a skill's frontmatter means its author
// wants it run only when the user names it. A gate now opens itself on
// clear work requests, so the flag must be visible in the index before the
// skill is read.
function userOnlyNote(e: any): string {
  try {
    const fm = readFileSync(e.path, "utf8").split("---")[1] || "";
    return /^disable-model-invocation:\s*true/m.test(fm) ? L.userOnly : "";
  } catch {
    return "";
  }
}

function depNote(cat: string, e: any): string {
  const r = e.requires;
  if (!r?.plugin) return "";
  return L.dep(r.plugin, (r.components || []).join(", "), brokenDeps.has(`${cat}/${e.name}`), !!r.critical);
}

// Paths are absolute (Read needs that) and within one gate mostly share a
// long directory; factoring it into the header cuts ~40% off the biggest
// gate file. Entries outside the prefix keep their full path.
let pathPrefix = "";
function commonDirPrefix(paths: string[]): string {
  if (paths.length < 2) return "";
  const parts = paths.map((p) => p.split("/"));
  const first = parts[0];
  let n = 0;
  while (n < first.length - 1 && parts.every((q) => q[n] === first[n])) n++;
  const prefix = first.slice(0, n).join("/");
  return prefix.length >= 20 ? prefix + "/" : "";
}
function shortPath(p: string): string {
  return pathPrefix && p.startsWith(pathPrefix) ? p.slice(pathPrefix.length) : p;
}
function typeTag(e: any): string {
  return L.typeTag[e.type] || "";
}
function entryLine(e: any, cat: string, extra = ""): string {
  return `${typeTag(e)}${e.name} | ${extra}${loc(e, "description")}${userOnlyNote(e)}${depNote(cat, e)} | ${shortPath(e.path)}`;
}

function renderCategoryBlock(cat: string, reg: any, meta: any): string[] {
  const entries = reg[cat] || [];
  const m = meta[cat] || {};
  const out: string[] = [];
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const related = cat === "pipelines" ? [] : (reg.pipelines || []).filter((p: any) => p.domain === cat);
  pathPrefix = commonDirPrefix([...sorted, ...related].map((e: any) => e.path));

  out.push(L.gateHeader(cat, loc(m, "label") || cat, entries.length));
  out.push(`# ${loc(m, "desc")}`);
  out.push(pathPrefix ? L.gateFormatPrefixed(pathPrefix) : L.gateFormat);
  if ([...sorted, ...related].some((e: any) => e.type === "command" || e.type === "agent")) out.push(L.gateTypes);
  out.push("");

  if (cat === "planning") {
    const byCluster = new Map<string, any[]>();
    for (const e of sorted) {
      const c = e.cluster || "utility";
      if (!byCluster.has(c)) byCluster.set(c, []);
      byCluster.get(c)!.push(e);
    }
    for (const [cluster, items] of byCluster) {
      out.push(`[${L.clusterLabel(cluster)}] (cluster: ${cluster})`);
      for (const e of items) out.push(entryLine(e, cat));
      out.push("");
    }
  } else if (cat === "pipelines") {
    for (const e of sorted) out.push(entryLine(e, cat, `${L.domain(e.domain)} `));
    out.push("");
  } else {
    for (const e of sorted) out.push(entryLine(e, cat));
    out.push("");
  }

  if (cat !== "pipelines") {
    const rel = [...related].sort((a: any, b: any) => a.name.localeCompare(b.name));
    if (rel.length > 0) {
      out.push(L.relatedPipelines);
      for (const e of rel) out.push(entryLine(e, "pipelines"));
      out.push("");
    }
  }

  // Agents spawned by entries in this block (`spawned_by`) are listed here
  // even if filed elsewhere, so a parent's spawn resolves from its own gate.
  const namesHere = new Set<string>([...sorted, ...related].map((e: any) => e.name));
  const children: any[] = [];
  for (const k of CATEGORY_ORDER) {
    for (const e of reg[k] || []) {
      if (e.spawned_by && namesHere.has(e.spawned_by) && !namesHere.has(e.name)) children.push(e);
    }
  }
  if (children.length > 0) {
    out.push(L.spawnedAgents);
    for (const e of children.sort((a, b) => a.name.localeCompare(b.name))) out.push(entryLine(e, cat));
    out.push("");
  }
  return out;
}

function renderGates(reg: any, meta: any) {
  mkdirSync(GATES_DIR, { recursive: true });
  const all: string[] = [...L.allHeader, ""];
  for (const cat of CATEGORY_ORDER) {
    const block = renderCategoryBlock(cat, reg, meta);
    writeFileSync(join(GATES_DIR, `${cat}.txt`), block.join("\n") + "\n");
    all.push(...block, "");
  }
  writeFileSync(join(GATES_DIR, "_all.txt"), all.join("\n") + "\n");
  return CATEGORY_ORDER.length + 1;
}

function renderHealth(issues: Issue[]): string[] {
  const out = ["", L.health, ""];
  if (issues.length === 0) {
    out.push(L.healthOk);
    return out;
  }
  out.push(L.healthIntro, "");
  issues.forEach((i, n) => {
    out.push(`${n + 1}. **[${i.severity === "critical" ? L.critical : L.warning}] ${i.subject}** | ${i.detail}`);
    out.push(`   → ${i.fix}`);
  });
  return out;
}

function typeMix(entries: any[]): string {
  const by: Record<string, number> = {};
  for (const e of entries) by[e.type || "skill"] = (by[e.type || "skill"] || 0) + 1;
  return Object.keys(by).length > 1 ? L.mix(by.skill || 0, by.command || 0, by.agent || 0) : "";
}

// ---------------------------------------------------------------------------
function main() {
  try {
    const config = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    LANG = config.report_language === "en" ? "en" : "ko";
    if (config.report_language && config.report_language !== "ko" && config.report_language !== "en") {
      console.error(`WARNING: report_language "${config.report_language}" has no renderer; falling back to Korean.`);
    }
  } catch {
    console.error(`WARNING: ${CONFIG_FILE} not found; rendering in Korean. The SessionStart hook normally writes it.`);
  }
  L = LANG === "en" ? EN : KO;

  const reg = JSON.parse(readFileSync(REGISTRY_FILE, "utf8"));
  const issues = checkHealth();
  brokenDeps = new Set(issues.filter((i) => i.kind === "disabled_dependency").map((i) => i.subject));
  const prefs = JSON.parse(readFileSync(PREFS_FILE, "utf8"));
  const meta = reg.category_meta || {};

  const lines: string[] = [L.title, ...renderHealth(issues)];

  // Bundled categories (GSD's 65 skills under "planning") don't get a
  // top-level section; they're summarized once under "multi-skill plugins".
  const bundleCats: { cat: string; m: any; count: number }[] = [];

  for (const cat of CATEGORY_ORDER) {
    const entries = reg[cat] || [];
    const m = meta[cat] || {};
    if (m.bundle) {
      bundleCats.push({ cat, m, count: entries.length });
      continue;
    }
    lines.push("", `## ${loc(m, "label") || cat}`, "");
    lines.push(`${loc(m, "desc")} — ${L.total(entries.length)}${typeMix(entries)}`);

    const numbered = (items: any[], extra?: (e: any) => string) => {
      [...items]
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((e, i) => {
          const tag = extra ? ` ${extra(e)}` : "";
          lines.push(`${i + 1}. ${typeTag(e)}**${e.name}**${tag}${SEP}${loc(e, "description")}`);
        });
    };

    if (cat === "planning") {
      const byCluster = new Map<string, any[]>();
      for (const e of entries) {
        const c = e.cluster || "utility";
        if (!byCluster.has(c)) byCluster.set(c, []);
        byCluster.get(c)!.push(e);
      }
      for (const [cluster, items] of byCluster) {
        lines.push("", `**[${L.clusterLabel(cluster)}]**`, "");
        numbered(items);
      }
    } else if (cat === "pipelines") {
      lines.push("");
      numbered(entries, (e) => L.domain(e.domain));
    } else {
      lines.push("");
      numbered(entries);
    }
  }

  if (bundleCats.length > 0) {
    lines.push("", L.bundles, "", L.bundlesIntro, "");
    for (const { cat, m, count } of bundleCats) {
      lines.push(L.bundleLine(m.bundle.plugin_name, count, cat));
      const ao = m.bundle.agents_always_on;
      if (ao) lines.push(`  - ${loc(ao, "desc")}`);
    }
  }

  // always_on: entries sharing a `bundle` collapse to one line.
  const alwaysOn = reg.always_on || [];
  const aoMeta = meta.always_on || {};
  lines.push("", `## ${loc(aoMeta, "label") || L.alwaysOnLabel}`, "");
  lines.push(`${loc(aoMeta, "desc") || L.alwaysOnDesc} — ${L.total(alwaysOn.length)}`, "");
  const singles = alwaysOn.filter((e: any) => !e.bundle);
  const bundles = new Map<string, any[]>();
  for (const e of alwaysOn) if (e.bundle) bundles.set(e.bundle, [...(bundles.get(e.bundle) || []), e]);
  const rows: string[] = [];
  for (const e of [...singles].sort((a: any, b: any) => a.name.localeCompare(b.name))) {
    rows.push(`**${e.name}** ${L.reason(e.reason)}${SEP}${loc(e, "description")}`);
  }
  for (const [b, es] of bundles) {
    const kinds = new Map<string, number>();
    for (const e of es) kinds.set(e.type, (kinds.get(e.type) || 0) + 1);
    const what = [...kinds].map(([k, n]) => (LANG === "en" ? `${n} ${L.typeLabel[k] || k}` : `${L.typeLabel[k] || k} ${n}개`)).join(", ");
    rows.push(L.bundleRow(b, what, es[0].reason, L.reasonText[es[0].reason] || es[0].reason));
  }
  rows.forEach((r, i) => lines.push(`${i + 1}. ${r}`));

  // Preferences + savings: shared tail for full and brief.
  const tail: string[] = ["", L.prefs];
  for (const mode of MODE_ORDER) {
    const cats = CATEGORY_ORDER.filter((cat) => (prefs[cat]?.mode || "always_ask") === mode);
    tail.push("", `**${L.modeLabel[mode] || mode}** ${L.modeCount(cats.length)}`);
    for (const cat of cats) {
      const p = prefs[cat];
      const detail =
        mode === "fixed_default" ? L.fixedDefault(p.default) : mode === "conditional" ? L.conditional((p.rules || []).length, p.fallback) : "";
      tail.push(`- ${loc(meta[cat] || {}, "label") || cat}${detail}`);
    }
  }

  let beforeTokens = 0;
  let gatedCount = 0;
  for (const cat of CATEGORY_ORDER) {
    for (const e of reg[cat] || []) {
      beforeTokens += estimateTokens(e.description || "");
      gatedCount++;
    }
  }
  let afterTokens = 0;
  for (const f of GATE_FILES) afterTokens += estimateTokens(extractDescription(f));
  const savings = beforeTokens - afterTokens;
  const savingsPct = beforeTokens > 0 ? Math.round((savings / beforeTokens) * 100) : 0;

  // A code fence: monospace, and the only way to right-align a subtraction.
  const width = Math.max(beforeTokens.toLocaleString().length, afterTokens.toLocaleString().length, savings.toLocaleString().length);
  const pad = (n: number) => n.toLocaleString().padStart(width);
  tail.push("", L.savings, "", "```");
  tail.push(`  ${pad(beforeTokens)} tok   ${L.before(gatedCount)}`);
  tail.push(`− ${pad(afterTokens)} tok   ${L.after(GATE_FILES.length)}`);
  tail.push("─".repeat(width + 6));
  tail.push(`  ${pad(savings)} tok   ${L.saved(savingsPct)}`);
  tail.push("```", "", L.savingsNote, "", L.generated(new Date().toISOString()));

  lines.push(...tail);
  writeFileSync(OUT_FILE, lines.join("\n") + "\n");

  // Brief: the default answer to "what's gated?" -- ~1/5 the tokens.
  const brief: string[] = [L.briefTitle, ...renderHealth(issues), "", L.counts, ""];
  for (const cat of CATEGORY_ORDER) {
    const m = meta[cat] || {};
    const entries = reg[cat] || [];
    const ao = m.bundle?.agents_always_on;
    const note = m.bundle ? L.bundleNote(m.bundle.plugin_name, ao ? L.agentsKept(ao.count) : "") : "";
    brief.push(L.countLine(cat, loc(m, "label") || cat, entries.length, typeMix(entries), note));
  }
  brief.push(L.alwaysOnCount(alwaysOn.length), "", L.briefHint, ...tail);
  writeFileSync(BRIEF_FILE, brief.join("\n") + "\n");

  const gateCount = renderGates(reg, meta);
  console.log(`report.txt regenerated (${lines.length} lines, ${LANG}) -> ${OUT_FILE}`);
  console.log(`report-brief.txt regenerated (${brief.length} lines) -> ${BRIEF_FILE}`);
  console.log(`gates regenerated (${gateCount} files) -> ${GATES_DIR}/`);
}

main();
