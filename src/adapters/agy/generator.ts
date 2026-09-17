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
      const content = `---
name: ${skillName}
description: "Gate for ${meta.label_en} / ${meta.label_ko}. Activates dormant ${cat} skills on demand when a task requires ${cat} capabilities."
---

# Gate: ${meta.label_ko} (${meta.label_en})

## Activation Instructions
This gate manages dormant skills for **${meta.label_ko}** to keep your system prompt context lean and avoid context budget exclusions.

1. Read the pre-rendered gate index:
   Use \`view_file\` to read: \`${gateIndexPath}\`
2. Compare the user's task with the descriptions in that index.
3. Identify the 1-3 skills that best match the task.
4. Read the selected skill's \`SKILL.md\` using \`view_file\` and execute its instructions.
`;

      writeAtomicSync(join(skillDir, "SKILL.md"), normalizeNFC(content));
      createdDirs.push(skillDir);
    }

    // 2. Generate check-skill (summary) and check-skill-all (full) for AGY
    const checkSkillDir = join(targetSkillsDir, "check-skill");
    mkdirSync(checkSkillDir, { recursive: true });
    const checkContent = `---
name: check-skill
description: "master-of 자가 점검 (요약 버전): 게이트별 구성요소 수, 깨진 의존성 및 MCP 진단, 토큰 절약 요약 리포트를 보여줍니다. '현황', '점검', '자가점검', '상태' 요청 시 사용."
---

# check-skill — master-of 자가 점검 (요약)

master-of 자가 점검 요약 리포트를 확인합니다.

\`view_file\` 도구를 사용하여 요약 리포트 파일을 읽고 사용자에게 보여주세요:
\`${paths.briefReportFile}\`

(전체 스킬 목록 및 Always-on 상세가 필요한 경우에는 \`check-skill-all\` 스킬을 사용하세요.)
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

    return createdDirs;
  }
}
