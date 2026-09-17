import { join } from "path";
import { mkdirSync } from "fs";
import { writeAtomicSync } from "../../core/fs-atomic.ts";
import { normalizeNFC } from "../../core/unicode.ts";
import { gateFilePath } from "../../core/gates.ts";
import type { ConfigManager } from "../../core/config.ts";
import type { RegistryManager } from "../../core/registry.ts";
import type { GateReporter } from "../../core/reporter.ts";

export class AgyGateGenerator {
  constructor(
    private config: ConfigManager,
    private registryManager: RegistryManager,
    private reporter?: GateReporter
  ) {}

  generateAgyGates(targetSkillsDir: string): string[] {
    mkdirSync(targetSkillsDir, { recursive: true });
    // The generated skills embed gate file paths, so those files must exist.
    if (this.reporter) this.reporter.renderAll();

    const reg = this.registryManager.getRegistry();
    const paths = this.config.getPaths();
    const createdDirs: string[] = [];

    // 1. Generate gate skills
    for (const [cat, meta] of Object.entries(reg.categories)) {
      const skillName = `master-of-${cat}`;
      const skillDir = join(targetSkillsDir, skillName);
      mkdirSync(skillDir, { recursive: true });

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

      writeAtomicSync(join(skillDir, "SKILL.md"), normalizeNFC(content));
      createdDirs.push(skillDir);
    }

    // 2. Generate check-skill (summary) and check-skill-all (full) for AGY
    const checkSkillDir = join(targetSkillsDir, "check-skill");
    mkdirSync(checkSkillDir, { recursive: true });
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
    writeAtomicSync(join(checkSkillDir, "SKILL.md"), normalizeNFC(checkContent));
    createdDirs.push(checkSkillDir);

    const checkAllSkillDir = join(targetSkillsDir, "check-skill-all");
    mkdirSync(checkAllSkillDir, { recursive: true });
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
    writeAtomicSync(join(checkAllSkillDir, "SKILL.md"), normalizeNFC(checkAllContent));
    createdDirs.push(checkAllSkillDir);

    // Keep master-of-check for backward compatibility
    const masterOfCheckDir = join(targetSkillsDir, "master-of-check");
    mkdirSync(masterOfCheckDir, { recursive: true });
    writeAtomicSync(join(masterOfCheckDir, "SKILL.md"), normalizeNFC(checkContent.replace("name: check-skill", "name: master-of-check")));
    createdDirs.push(masterOfCheckDir);

    // 3. Install master-of plugin, lifecycle hooks, and global rules for Antigravity
    this.setupAgyPlugin();

    return createdDirs;
  }

  setupAgyPlugin(): void {
    const paths = this.config.getPaths();
    const pluginDir = join(paths.geminiDir, "config", "plugins", "master-of");
    mkdirSync(join(pluginDir, "rules"), { recursive: true });

    // 1. Manifest
    const manifest = {
      name: "master-of",
      version: "2.0.0",
      description: "Universal AI Skill & Context Gateway - 토큰 최적화 및 도메인 게이트웨이",
    };
    writeAtomicSync(join(pluginDir, "plugin.json"), JSON.stringify(manifest, null, 2) + "\n");

    // 2. Lifecycle Hooks: PreInvocation hook for session start
    const hooks = {
      "master-of-gatekeeper": {
        PreInvocation: [
          {
            type: "command",
            command: "~/.master-of/mo session-start --agy",
            timeout: 15,
          },
        ],
      },
    };
    writeAtomicSync(join(pluginDir, "hooks.json"), JSON.stringify(hooks, null, 2) + "\n");

    // 3. Rule: AGENTS.md in plugin and ~/.gemini/config/rules/master-of.md
    const ruleContent = `# master-of Session Start & Skill Gatekeeper Rule

When starting a conversation turn or when asked about skills, token usage, or status:
1. If unparked raw skills exist (causing heavy Always-on token consumption, e.g. 176 skills consuming 30,000+ tokens) or if unclassified components exist:
   - Proactively inform the user about the wasted tokens.
   - Propose to batch-park them into their recommended domain gates using \`mo park --all\` to save 85%+ tokens immediately.
   - In Antigravity, use \`ask_question\` tool to ask the user.
   - When approved by the user, execute \`~/.master-of/mo park --all\` and update the gate status.
`;
    writeAtomicSync(join(pluginDir, "rules", "AGENTS.md"), normalizeNFC(ruleContent));

    const globalRulesDir = join(paths.geminiDir, "config", "rules");
    mkdirSync(globalRulesDir, { recursive: true });
    writeAtomicSync(join(globalRulesDir, "master-of.md"), normalizeNFC(ruleContent));
  }
}
