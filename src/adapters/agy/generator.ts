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

# check-skill-all — master-of 자가 점검 (전체)

master-of 전체 스킬 인벤토리 리포트를 확인합니다.

\`view_file\` 도구를 사용하여 전체 리포트 파일을 읽고 사용자에게 보여주세요:
\`${paths.reportFile}\`

(특정 도메인 하나만 확인하려면 해당 \`master-of-<domain>\` 게이트의 인덱스를 읽는 것이 훨씬 빠르고 저렴합니다.)
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
