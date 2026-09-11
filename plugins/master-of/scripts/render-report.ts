#!/usr/bin/env bun
// Regenerates ~/.claude/masterof/report.txt -- the pre-rendered, ready-to-print
// status report for "check-skills". This script does the formatting
// work ONCE (whenever registry.json or preferences.json changes); the skill
// itself just Reads the resulting file verbatim and prints it, at near-zero
// token cost. Run this after any edit to registry.json or preferences.json.
//
// Output is Korean throughout (category labels, descriptions, preference
// labels) -- NOT because Korean is hardcoded as correct, but because
// ~/.claude/masterof/config.json's `report_language` was set to "ko" when
// this database was first built, based on the user's actual language
// preference at that time (see config.json's `determined_from`). This
// script itself is the "ko" locale renderer; if report_language in
// config.json is ever something else, that's a signal this script (and the
// description_<lang> fields it reads) need to be regenerated for the new
// language -- it won't happen automatically.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { checkHealth, type Issue } from "./health";

const MASTEROF_DIR = join(homedir(), ".claude", "masterof");
const REGISTRY_FILE = join(MASTEROF_DIR, "registry.json");
const PREFS_FILE = join(MASTEROF_DIR, "preferences.json");
const CONFIG_FILE = join(MASTEROF_DIR, "config.json");
const OUT_FILE = join(MASTEROF_DIR, "report.txt");
const BRIEF_FILE = join(MASTEROF_DIR, "report-brief.txt");
const GATES_DIR = join(MASTEROF_DIR, "gates");
const SKILLS_ROOT = join(homedir(), ".claude", "skills", "master-of");
const THIS_SCRIPT_LOCALE = "ko"; // this renderer's hardcoded labels are Korean

const CATEGORY_ORDER = ["design", "dev", "research", "stock", "planning", "pipelines"];

// The gate files whose frontmatter `description` is what actually loads into
// every session now. The root master-of/SKILL.md ("./") IS counted: it used
// to be a "don't invoke me" pointer that `claude plugin details` didn't bill
// separately, but it's now the cross-domain multi-activation entry point with
// a real, longer description sitting in the system prompt like any other
// gate. Leaving it out would understate the current always-on cost.
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

// Rough chars-per-token heuristic (~4 chars/token, English-leaning text --
// same ballpark `claude plugin details` itself uses per its own "estimates
// and may differ from actual usage" disclaimer). Good enough for an
// order-of-magnitude savings figure, not exact accounting.
const CHARS_PER_TOKEN = 4;

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

function estimateTokens(charCount: number): number {
  return Math.round(charCount / CHARS_PER_TOKEN);
}

const CLUSTER_LABELS_KO: Record<string, string> = {
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
};

// Ambiguity-handling modes, in the order they're grouped under in the
// preferences section -- one heading per mode, with the categories using it
// listed as bullets underneath (and "0개" when none do), rather than one
// bullet per category naming its mode. Grouping by mode is what actually
// answers "어떻게 처리되고 있나" at a glance; a flat per-category list makes
// you read all 6 lines to find out whether any category uses, say,
// `conditional` at all.
const MODE_ORDER = ["always_ask", "fixed_default", "conditional", "smart"];
const MODE_LABEL_KO: Record<string, string> = {
  always_ask: "매번 물어보기",
  fixed_default: "고정 기본값",
  conditional: "조건부",
  smart: "AI 알아서 판단",
};

// Numbered list, "N. **name** | description" on one line. A literal " | "
// separator is used instead of padded/tabbed spacing: real tabs (and runs of
// plain spaces) collapse to a single space outside a code fence in Markdown
// renderers, so column-aligning the description text that way doesn't
// survive rendering. A run of NBSPs can fake a fixed gap, but can't align
// descriptions' first letters into a vertical column either -- that needs a
// gap whose width varies per row (padded out to the longest name), which
// only a real Markdown table does reliably across renderers (it aligns
// cells regardless of content width) -- at the cost of becoming a literal
// table instead of a flowing numbered list. Numbering restarts at 1 per
// group (per cluster for planning); entries are alphabetical by `name`
// within each group.
const SEP = " | ";

// ---------------------------------------------------------------------------
// Per-gate activation indexes (~/.claude/masterof/gates/<category>.txt)
//
// These exist purely for SPEED at activation time. A gate used to be told to
// `Read` registry.json and look at its own category array -- but Read pulls
// the WHOLE file, and registry.json is ~60KB / ~16k tokens. Opening one gate
// therefore cost ~16k tokens, while the entire always-on saving this system
// buys is ~5.8k tokens per session: a single gate activation put the user
// ~2.8x underwater on the plugin's whole reason for existing.
//
// Each gate file below carries only what the Activation Protocol actually
// needs -- name, the short localized description, and the path to Read -- for
// ONE category, so a gate reads 100-2,500 tokens instead of 16,000. Each also
// inlines that domain's related `pipelines` entries, so the protocol's
// "cross-check pipelines" step costs zero extra reads.
//
// `_all.txt` is the cross-domain variant: every category in one file (~5k
// tokens, still 3x cheaper than the old whole-registry read), for requests
// that span domains and need skills from several gates at once.
//
// GENERATED -- never hand-edit. registry.json stays the single source of
// truth; these are rebuilt from it by this script on every change, exactly
// like report.txt.
// ---------------------------------------------------------------------------
// Entries that depend on a plugin component (MCP server, agents) say so
// inline, with the component's status as of this render. The status can go
// stale between renders -- the SessionStart hook is the fresh source -- but
// even a stale "꺼짐" is enough to make the gate pause and check before
// activating a skill that can't work.
let brokenDeps = new Set<string>(); // "<cat>/<name>" with a disabled dependency
function depNote(cat: string, e: any): string {
  const r = e.requires;
  if (!r?.plugin) return "";
  const off = brokenDeps.has(`${cat}/${e.name}`);
  const what = (r.components || []).join(", ");
  return ` [의존: ${r.plugin} ${what}${off ? " — 현재 꺼짐" : ""}${r.critical ? ", 없으면 동작 불가" : ""}]`;
}
function entryLine(e: any, cat: string): string {
  return `${e.name} | ${e.description_ko || e.description}${depNote(cat, e)} | ${e.path}`;
}

function renderCategoryBlock(cat: string, reg: any, meta: any): string[] {
  const entries = reg[cat] || [];
  const m = meta[cat] || { label_ko: cat, desc_ko: "" };
  const out: string[] = [];
  out.push(`# ${cat} — ${m.label_ko} (${entries.length}개)`);
  out.push(`# ${m.desc_ko}`);
  out.push(`# 형식: 이름 | 설명 | Read할 경로`);
  out.push("");

  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));

  if (cat === "planning") {
    const byCluster = new Map<string, any[]>();
    for (const e of sorted) {
      const c = e.cluster || "utility";
      if (!byCluster.has(c)) byCluster.set(c, []);
      byCluster.get(c)!.push(e);
    }
    for (const [cluster, items] of byCluster) {
      out.push(`[${CLUSTER_LABELS_KO[cluster] || cluster}] (cluster: ${cluster})`);
      for (const e of items) out.push(entryLine(e, cat));
      out.push("");
    }
  } else if (cat === "pipelines") {
    for (const e of sorted) out.push(`${e.name} | (분야: ${e.domain}) ${e.description_ko || e.description}${depNote(cat, e)} | ${e.path}`);
    out.push("");
  } else {
    for (const e of sorted) out.push(entryLine(e, cat));
    out.push("");
  }

  // Inline this domain's pipelines so the protocol's scale cross-check needs
  // no second read. Skipped for the pipelines file itself (it IS the list).
  if (cat !== "pipelines") {
    const related = (reg.pipelines || [])
      .filter((p: any) => p.domain === cat)
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
    if (related.length > 0) {
      out.push(`## 관련 파이프라인 — 요청이 "전체/처음부터 끝까지" 규모일 때만 대안으로 제시 (단일 선택)`);
      for (const e of related) out.push(entryLine(e, "pipelines"));
      out.push("");
    }
  }
  return out;
}

function renderGates(reg: any, meta: any) {
  mkdirSync(GATES_DIR, { recursive: true });
  const all: string[] = [
    "# master-of 전체 통합 인덱스 (여러 분야를 한 번에 매칭할 때만 사용)",
    "# 한 분야만 필요하면 gates/<분야>.txt 를 읽는 쪽이 훨씬 쌉니다.",
    "",
  ];
  for (const cat of CATEGORY_ORDER) {
    const block = renderCategoryBlock(cat, reg, meta);
    writeFileSync(join(GATES_DIR, `${cat}.txt`), block.join("\n") + "\n");
    all.push(...block, "");
  }
  writeFileSync(join(GATES_DIR, "_all.txt"), all.join("\n") + "\n");
  return CATEGORY_ORDER.length + 1;
}

function renderHealth(issues: Issue[]): string[] {
  const out = ["", "## 점검 — 지금 고장 난 것", ""];
  if (issues.length === 0) {
    out.push("문제 없음 — MCP 서버 실행 파일과 게이트 스킬의 플러그인 의존성이 모두 정상입니다.");
    return out;
  }
  out.push("자동으로 고치지 않습니다. 플러그인 on/off와 MCP 설정은 **다음 세션 시작 시** 반영되므로, 고친 뒤 새 세션에서 확인하세요.");
  out.push("");
  issues.forEach((i, n) => {
    out.push(`${n + 1}. **[${i.severity === "critical" ? "심각" : "주의"}] ${i.subject}** | ${i.detail}`);
    out.push(`   → ${i.fix}`);
  });
  return out;
}

function main() {
  const reg = JSON.parse(readFileSync(REGISTRY_FILE, "utf8"));
  const issues = checkHealth();
  brokenDeps = new Set(issues.filter((i) => i.kind === "disabled_dependency").map((i) => i.subject));
  const prefs = JSON.parse(readFileSync(PREFS_FILE, "utf8"));
  const meta = reg.category_meta || {};

  try {
    const config = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    if (config.report_language && config.report_language !== THIS_SCRIPT_LOCALE) {
      console.error(
        `WARNING: config.json.report_language is "${config.report_language}" but this script ` +
          `only knows how to render "${THIS_SCRIPT_LOCALE}" labels. description_${config.report_language} ` +
          `fields and this renderer both need updating for the new language -- proceeding with ` +
          `Korean labels anyway, which will be wrong.`
      );
    }
  } catch {
    console.error(
      `WARNING: ${CONFIG_FILE} not found. This script is assuming Korean ("${THIS_SCRIPT_LOCALE}") ` +
        `without confirming that's still the user's preference -- see check-skills's ` +
        `"Report language" section for what should happen instead (determine + write config.json first).`
    );
  }

  const lines: string[] = [];
  lines.push("# master-of 스킬 게이트 시스템 — 현황판");
  lines.push(...renderHealth(issues));

  // Bundled categories (e.g. GSD's 65 skills under "planning") don't get
  // their own top-level "## <label>" section -- printing that section's
  // header + desc + count line back to back with no blank line between the
  // bundle summary and its continuation collapses into one run-on paragraph
  // in most Markdown renderers (a "- item\n  continuation" pair with no
  // blank line is one soft-wrapped list item, not two lines). Every one of
  // these skills is still fully classified in registry.json (cluster tags
  // and all) for lookup purposes -- see the domain gate's own Activation
  // Protocol -- this report just doesn't expand it. Instead each bundle is
  // collected here and summarized once under "멀티 스킬 플러그인" below.
  const bundleCats: { cat: string; m: any; count: number }[] = [];

  for (const cat of CATEGORY_ORDER) {
    const entries = reg[cat] || [];
    const m = meta[cat] || { label_ko: cat, desc_ko: "" };

    if (m.bundle) {
      bundleCats.push({ cat, m, count: entries.length });
      continue;
    }

    lines.push("");
    lines.push(`## ${m.label_ko}`);
    lines.push("");
    lines.push(`${m.desc_ko} — 총 ${entries.length}개`);

    const sortByName = (arr: any[]) => [...arr].sort((a, b) => a.name.localeCompare(b.name));
    const numbered = (items: any[], extra?: (e: any) => string) => {
      sortByName(items).forEach((e, i) => {
        const tag = extra ? ` ${extra(e)}` : "";
        lines.push(`${i + 1}. **${e.name}**${tag}${SEP}${e.description_ko || e.description}`);
      });
    };

    if (cat === "planning") {
      // sub-group by cluster, Korean cluster labels, alphabetical within cluster
      const byCluster = new Map<string, any[]>();
      for (const e of entries) {
        const c = e.cluster || "utility";
        if (!byCluster.has(c)) byCluster.set(c, []);
        byCluster.get(c)!.push(e);
      }
      for (const [cluster, items] of byCluster) {
        lines.push("");
        lines.push(`**[${CLUSTER_LABELS_KO[cluster] || cluster}]**`);
        lines.push("");
        numbered(items);
      }
    } else if (cat === "pipelines") {
      lines.push("");
      numbered(entries, (e) => `(분야: ${e.domain})`);
    } else {
      lines.push("");
      numbered(entries);
    }
  }

  // multi-skill plugin bundles section
  if (bundleCats.length > 0) {
    lines.push("");
    lines.push("## 멀티 스킬 플러그인");
    lines.push("");
    lines.push(
      "여러 스킬을 하나로 묶어 배포하는 대용량 플러그인입니다. 개별 스킬로 펼쳐 보여주지 않지만, " +
        "이미 알맞은 master-of 게이트 안에 전부 분류되어 있어 요청 시 그대로 찾아 활성화됩니다."
    );
    lines.push("");
    for (const { cat, m, count } of bundleCats) {
      lines.push(`- **${m.bundle.plugin_name}** (스킬 ${count}개) — \`${cat}\` 게이트 안에 이미 분류되어 있음`);
    }
  }

  // always_on section
  const alwaysOn = reg.always_on || [];
  const aoMeta = meta.always_on || { label_ko: "상시 활성", desc_ko: "" };
  lines.push("");
  lines.push(`## ${aoMeta.label_ko}`);
  lines.push("");
  lines.push(`${aoMeta.desc_ko} — 총 ${alwaysOn.length}개`);
  lines.push("");
  [...alwaysOn]
    .sort((a: any, b: any) => a.name.localeCompare(b.name))
    .forEach((e: any, i: number) => {
      lines.push(`${i + 1}. **${e.name}** (사유: ${e.reason})${SEP}${e.description_ko || e.description}`);
    });

  // Preferences + savings are shared by the full and brief reports, so they
  // are built once into `tail` and appended to both.
  const tail: string[] = [];
  tail.push("");
  tail.push("## 애매할 때 처리 방식");
  for (const mode of MODE_ORDER) {
    const cats = CATEGORY_ORDER.filter((cat) => (prefs[cat]?.mode || "always_ask") === mode);
    tail.push("");
    tail.push(`**${MODE_LABEL_KO[mode] || mode}** (${cats.length}개)`);
    for (const cat of cats) {
      const p = prefs[cat];
      const label = (meta[cat] || { label_ko: cat }).label_ko;
      const detail =
        mode === "fixed_default"
          ? ` — 기본값: ${p.default}`
          : mode === "conditional"
            ? ` — 규칙 ${(p.rules || []).length}개, 폴백: ${p.fallback}`
            : "";
      tail.push(`- ${label}${detail}`);
    }
  }

  // token savings estimate -- computed here (script run), never at report-read
  // time, so check-skills's Step 2 never re-derives this either.
  let beforeTokens = 0;
  let gatedCount = 0;
  for (const cat of CATEGORY_ORDER) {
    for (const e of reg[cat] || []) {
      beforeTokens += estimateTokens((e.description || "").length);
      gatedCount++;
    }
  }
  let afterTokens = 0;
  for (const f of GATE_FILES) afterTokens += estimateTokens(extractDescription(f).length);
  const savings = beforeTokens - afterTokens;
  const savingsPct = beforeTokens > 0 ? Math.round((savings / beforeTokens) * 100) : 0;

  tail.push("");
  tail.push("## 토큰 절약 추정치 (세션마다 always-on으로 소모되는 비용 기준)");
  tail.push("");
  // Rendered as a code fence, not bullets: a fenced block gets the host's
  // monospace font (the "다른 폰트" a Notion equation block also uses) and
  // is the only way to right-align the numbers into a subtraction layout --
  // plain Markdown text collapses padding spaces the same way it collapses
  // tabs (see the SEP comment above).
  const width = Math.max(
    beforeTokens.toLocaleString().length,
    afterTokens.toLocaleString().length,
    savings.toLocaleString().length
  );
  const pad = (n: number) => n.toLocaleString().padStart(width);
  tail.push("```");
  tail.push(`  ${pad(beforeTokens)} tok   게이트 적용 전 (스킬 ${gatedCount}개가 전부 평소에 노출됐다면)`);
  tail.push(`− ${pad(afterTokens)} tok   게이트 적용 후 (지금, 게이트 ${GATE_FILES.length}개만 노출)`);
  tail.push(`${"─".repeat(width + 6)}`);
  tail.push(`  ${pad(savings)} tok   절약 (${savingsPct}% 감소)`);
  tail.push("```");
  tail.push("");
  tail.push("*문자수/4로 어림한 추정치입니다 — 실제 토큰화 결과와 다를 수 있음. always_on 항목은 게이트 여부와 무관하게 원래도 켜져있었으므로 이 계산에서 제외.*");
  tail.push("");
  tail.push(`*(생성 시각: ${new Date().toISOString()})*`);

  lines.push(...tail);
  writeFileSync(OUT_FILE, lines.join("\n") + "\n");

  // Brief report: the default answer to "스킬 뭐 있어?". Counts per gate, what
  // is broken, preferences, savings -- ~1/5 the tokens of the full list. The
  // full report is one request away ("전체 보여줘"); reprinting 129 names by
  // default was the single biggest output cost in the whole system.
  const brief: string[] = [];
  brief.push("# master-of 현황 (요약)");
  brief.push(...renderHealth(issues));
  brief.push("");
  brief.push("## 게이트별 스킬 수");
  brief.push("");
  for (const cat of CATEGORY_ORDER) {
    const m = meta[cat] || { label_ko: cat };
    const n = (reg[cat] || []).length;
    const note = m.bundle ? ` — ${m.bundle.plugin_name} 플러그인 전체가 여기 분류됨` : "";
    brief.push(`- **/${cat}** ${m.label_ko}: ${n}개${note}`);
  }
  brief.push(`- **상시 활성** (게이트 없음): ${alwaysOn.length}개`);
  brief.push("");
  brief.push("*전체 목록은 \"전체 보여줘\", 한 분야만은 \"design에 뭐 있어\"처럼 요청하세요.*");
  brief.push(...tail);
  writeFileSync(BRIEF_FILE, brief.join("\n") + "\n");

  const gateCount = renderGates(reg, meta);
  console.log(`report.txt regenerated (${lines.length} lines) -> ${OUT_FILE}`);
  console.log(`report-brief.txt regenerated (${brief.length} lines) -> ${BRIEF_FILE}`);
  console.log(`gates regenerated (${gateCount} files) -> ${GATES_DIR}/`);
}

main();
