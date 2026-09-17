import { join } from "path";
import { writeAtomicSync } from "./fs-atomic.ts";
import { gateFilePath } from "./gates.ts";
import { RegistryManager } from "./registry.ts";
import { DEFAULT_SOURCE } from "./types.ts";
import { normalizeNFC, estimateTokens } from "./unicode.ts";
import type { ConfigManager } from "./config.ts";
import type { HealthChecker } from "./health.ts";
import type { RegistryComponent } from "./types.ts";

/** A gate index must stay a few hundred tokens: a skill's full multi-paragraph
 * description belongs in its SKILL.md, not in the line that points at it. */
export const GATE_DESCRIPTION_MAX = 200;

export function clipDescription(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= GATE_DESCRIPTION_MAX) return flat;
  // Prefer ending on a sentence boundary when one falls inside the budget.
  const head = flat.slice(0, GATE_DESCRIPTION_MAX);
  const sentenceEnd = Math.max(head.lastIndexOf(". "), head.lastIndexOf("。"), head.lastIndexOf("다. "));
  const cut = sentenceEnd > GATE_DESCRIPTION_MAX / 2 ? sentenceEnd + 1 : head.lastIndexOf(" ");
  return `${flat.slice(0, cut > 0 ? cut : GATE_DESCRIPTION_MAX).trimEnd()}…`;
}

export class GateReporter {
  constructor(
    private config: ConfigManager,
    private registryManager: RegistryManager,
    private healthChecker?: HealthChecker
  ) {}

  renderAll(): {
    gateFiles: string[];
    briefReport: string;
    fullReport: string;
    tokenSavings: { before: number; after: number; saved: number; pct: number };
  } {
    const paths = this.config.getPaths();
    const reg = this.registryManager.getRegistry();
    const configData = this.config.ensureConfigFile();
    const isEn = configData.report_language === "en";

    const components = Object.values(reg.components);
    const categoryMap: Record<string, typeof components> = {};
    for (const cat of Object.keys(reg.categories)) {
      categoryMap[cat] = [];
    }

    let rawTokensBefore = 0;
    let alwaysOnTokens = 0;
    for (const comp of components) {
      const cat = comp.category || "dev";
      if (!categoryMap[cat]) categoryMap[cat] = [];
      categoryMap[cat].push(comp);
      const tokens = estimateTokens(`${comp.name}: ${comp.description}`);
      rawTokensBefore += tokens;
      // An always-on component is still loaded after gating, so it saves nothing.
      if (comp.always_on) alwaysOnTokens += tokens;
    }

    const pipelinesByDomain: Record<string, typeof components> = {};
    for (const comp of components) {
      if (comp.category === "pipelines" && comp.domain) {
        (pipelinesByDomain[comp.domain] ||= []).push(comp);
      }
    }

    const gateFilesCreated: string[] = [];
    let gateDescriptionsTotal = 0;

    const renderLine = (item: (typeof components)[number]) => {
      const typePrefix = item.type === "command" ? "[커맨드] " : item.type === "agent" ? "[에이전트] " : "";
      const itemDesc = clipDescription(isEn ? item.description_en || item.description : item.description_ko || item.description);
      const depNote = item.dependencies?.mcp_server ? ` [의존: ${item.dependencies.mcp_server} MCP]` : "";
      return `${typePrefix}${item.name} | ${itemDesc}${depNote} | ${item.rel_path}`;
    };

    // 1. Render one gate file per (source, category): gates/<source>/<category>.txt.
    // A "custom" component is harness-neutral and appears in every source's view.
    const sources = new Set<string>([DEFAULT_SOURCE, "gemini"]);
    for (const comp of components) if (comp.source && comp.source !== "custom") sources.add(comp.source);
    const inSource = (comp: RegistryComponent, source: string) =>
      comp.source === "custom" || (comp.source ?? DEFAULT_SOURCE) === source;
    const gated = RegistryManager.isGated;

    for (const [cat, meta] of Object.entries(reg.categories)) {
      const label = isEn ? meta?.label_en || cat : meta?.label_ko || cat;
      const desc = isEn ? meta?.description_en || "" : meta?.description_ko || "";
      gateDescriptionsTotal += estimateTokens(`${cat}: ${label} ${desc}`);
    }

    // Paths resolve from path_anchor, not from the source view, so the header can
    // only name a prefix when every listed line shares one anchor.
    const anchorRoots: Record<string, string> = {
      claude: paths.claudeDir,
      gemini: paths.geminiDir,
      library: join(paths.claudeDir, "skills-library"),
      sandbox: paths.sandboxBoundaryRoot || paths.masterOfHome,
      custom: paths.masterOfHome,
    };
    const formatLine = (items: RegistryComponent[]) => {
      const anchors = new Set(items.filter((c) => !c.rel_path.startsWith("/")).map((c) => c.path_anchor));
      const prefix = anchors.size === 1 ? anchorRoots[[...anchors][0]] : null;
      if (!prefix) {
        return isEn
          ? `# Format: name | description | path (absolute, or relative to this entry's own root)`
          : `# 형식: 이름 | 설명 | 경로 (절대경로이거나 해당 항목의 기본 경로 기준)`;
      }
      return isEn
        ? `# Format: name | description | path — a path not starting with / is relative to ${prefix}/`
        : `# 형식: 이름 | 설명 | 경로 — 경로가 /로 시작하지 않으면 앞에 ${prefix}/ 를 붙여 Read`;
    };

    for (const source of sources) {
      const allSections: string[] = [];
      const alwaysOn: RegistryComponent[] = [];

      for (const cat of Object.keys(categoryMap)) {
        const meta = reg.categories[cat];
        const label = isEn ? meta?.label_en || cat : meta?.label_ko || cat;
        const desc = isEn ? meta?.description_en || "" : meta?.description_ko || "";
        const inView = categoryMap[cat].filter((c) => inSource(c, source));
        // Always-on components are still loaded after gating, so a gate line
        // would only send the model back to a file it already has.
        const items = inView.filter(gated);
        alwaysOn.push(...inView.filter((c) => !gated(c)));

        const lines: string[] = [];
        lines.push(`# ${cat} — ${label} (${items.length}${isEn ? " items" : "개"}, ${source})`);
        if (desc) lines.push(`# ${desc}`);
        lines.push(formatLine(items));
        lines.push("");

        items.sort((a, b) => a.name.localeCompare(b.name));
        for (const item of items) lines.push(renderLine(item));

        // The activation protocol judges task scale from this section, so a domain
        // gate must carry its own pipelines inline rather than require a second read.
        const related = (pipelinesByDomain[cat] || []).filter((c) => inSource(c, source) && gated(c));
        if (related.length > 0) {
          lines.push("");
          lines.push(isEn ? `## Related pipelines (pick at most one)` : `## 관련 파이프라인 (하나만 선택)`);
          related.sort((a, b) => a.name.localeCompare(b.name));
          for (const item of related) lines.push(renderLine(item));
        }

        const outPath = gateFilePath(paths.gatesDir, source, cat);
        writeAtomicSync(outPath, normalizeNFC(lines.join("\n") + "\n"));
        gateFilesCreated.push(outPath);
        allSections.push(lines.join("\n"));
      }

      // Cross-domain fallback: every gate in one read, for requests whose domain is unclear.
      const allLines = [
        isEn
          ? "# master-of combined index (use only when a request spans several domains)"
          : "# master-of 전체 통합 인덱스 (여러 분야를 한 번에 매칭할 때만 사용)",
        isEn
          ? "# For a single domain, gates/<domain>.txt is far cheaper."
          : "# 한 분야만 필요하면 gates/<분야>.txt 를 읽는 쪽이 훨씬 쌉니다.",
        "",
        ...allSections,
      ];
      const allPath = gateFilePath(paths.gatesDir, source, "_all");
      writeAtomicSync(allPath, normalizeNFC(allLines.join("\n") + "\n"));
      gateFilesCreated.push(allPath);

      // What the harness still loads on its own; listed so the report can say so.
      alwaysOn.sort((a, b) => a.name.localeCompare(b.name));
      const alwaysLines = [
        isEn
          ? `# always_on — loaded by the harness itself, not gated (${alwaysOn.length} items, ${source})`
          : `# always_on — 상시 활성 (게이트 없음) (${alwaysOn.length}개, ${source})`,
        formatLine(alwaysOn),
        "",
        ...alwaysOn.map(renderLine),
      ];
      const alwaysPath = gateFilePath(paths.gatesDir, source, "always_on");
      writeAtomicSync(alwaysPath, normalizeNFC(alwaysLines.join("\n") + "\n"));
      gateFilesCreated.push(alwaysPath);
    }

    // 2. Token savings calculation
    const afterGating = gateDescriptionsTotal + alwaysOnTokens + 200; // gate descriptions + still-loaded items + base activation prompt
    const saved = Math.max(0, rawTokensBefore - afterGating);
    const pct = rawTokensBefore > 0 ? Math.round((saved / rawTokensBefore) * 100) : 0;
    const tokenSavings = { before: rawTokensBefore, after: afterGating, saved, pct };

    // 3. Render brief and full reports
    const brief = this.renderBriefReport(categoryMap, tokenSavings, isEn);
    const full = this.renderFullReport(categoryMap, tokenSavings, isEn);

    writeAtomicSync(paths.briefReportFile, brief);
    writeAtomicSync(paths.reportFile, full);

    return {
      gateFiles: gateFilesCreated,
      briefReport: brief,
      fullReport: full,
      tokenSavings,
    };
  }

  private renderBriefReport(
    catMap: Record<string, RegistryComponent[]>,
    savings: { before: number; after: number; saved: number; pct: number },
    isEn: boolean
  ): string {
    const reg = this.registryManager.getRegistry();
    const lines: string[] = [];

    lines.push(isEn ? "# master-of Status (Summary)" : "# master-of 현황 (요약)");
    lines.push("");

    // Health section
    const issues = this.healthChecker ? this.healthChecker.checkAll() : [];
    lines.push(isEn ? "## Health Diagnostics" : "## 점검 — 지금 고장 난 것");
    if (issues.length === 0) {
      lines.push(isEn ? "Health: nothing broken (all dependencies OK)" : "점검 결과: 문제 없음");
    } else {
      for (let i = 0; i < issues.length; i++) {
        const iss = issues[i];
        lines.push(`${i + 1}. **[${iss.severity.toUpperCase()}] ${iss.subject}** | ${iss.detail}`);
        lines.push(`   → ${iss.fix}`);
      }
    }
    lines.push("");

    // Gate counts — what the gate files actually list, so the summary and the
    // indexes can never disagree.
    lines.push(isEn ? "## Components per Domain Gate" : "## 게이트별 구성요소 수");
    const inDefaultView = (c: RegistryComponent) =>
      (c.source === "custom" || (c.source ?? DEFAULT_SOURCE) === DEFAULT_SOURCE) && RegistryManager.isGated(c);
    for (const [cat, items] of Object.entries(catMap)) {
      const meta = reg.categories[cat];
      const label = isEn ? meta?.label_en || cat : meta?.label_ko || cat;
      const shown = items.filter(inDefaultView).length;
      const hidden = items.length - shown;
      const note = hidden > 0 ? (isEn ? ` (+${hidden} loaded/other sources)` : ` (+${hidden} 상시·타 소스)`) : "";
      lines.push(`- **/${cat}** ${label}: ${shown}${isEn ? " items" : "개"}${note}`);
    }
    lines.push("");

    // Token savings
    lines.push(isEn ? "## Estimated Token Savings" : "## 토큰 절약 추정치");
    lines.push("```");
    lines.push(`  ${savings.before.toLocaleString()} tok   ${isEn ? "before gating (all always-on)" : "게이트 적용 전 (전체 상시 노출)"}`);
    lines.push(`-   ${savings.after.toLocaleString()} tok   ${isEn ? "after gating (only domain gates)" : "게이트 적용 후 (도메인 게이트만)"}`);
    lines.push("───────────");
    lines.push(`  ${savings.saved.toLocaleString()} tok   ${isEn ? "saved" : "절약"} (${savings.pct}% ${isEn ? "reduction" : "감소"})`);
    lines.push("```");
    lines.push(`*(Generated: ${new Date().toISOString()})*`);
    lines.push("");

    return normalizeNFC(lines.join("\n"));
  }

  /** The inventory a harness user cares about is what its gates offer: the
   * default source's dormant components, exactly as the gate files list them. */
  private renderFullReport(
    catMap: Record<string, RegistryComponent[]>,
    savings: { before: number; after: number; saved: number; pct: number },
    isEn: boolean
  ): string {
    const brief = this.renderBriefReport(catMap, savings, isEn);
    const reg = this.registryManager.getRegistry();
    const lines: string[] = [brief];
    const source = DEFAULT_SOURCE;
    const gated = (c: RegistryComponent) =>
      (c.source === "custom" || (c.source ?? DEFAULT_SOURCE) === source) && RegistryManager.isGated(c);

    const total = Object.values(catMap).flat().filter(gated).length;
    lines.push(isEn ? `## Full inventory — ${total} gated components (${source})` : `## 전체 구성요소 목록 — 게이트된 ${total}개 (${source})`);
    for (const [cat, items] of Object.entries(catMap)) {
      const meta = reg.categories[cat];
      const label = isEn ? meta?.label_en || cat : meta?.label_ko || cat;
      const shown = items.filter(gated).sort((a, b) => a.name.localeCompare(b.name));
      lines.push(`\n### /${cat} — ${label} (${shown.length})`);
      for (const item of shown) {
        const typePrefix = item.type === "command" ? "[커맨드] " : item.type === "agent" ? "[에이전트] " : "";
        const desc = clipDescription(isEn ? item.description_en || item.description : item.description_ko || item.description);
        lines.push(`- ${typePrefix}**${item.name}**${item.cluster ? ` (${item.cluster})` : ""}: ${desc}`);
      }
    }

    return normalizeNFC(lines.join("\n"));
  }
}
