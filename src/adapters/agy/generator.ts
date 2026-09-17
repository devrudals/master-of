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

    // 2. Generate master-of-check skill for AGY
    const checkSkillDir = join(targetSkillsDir, "master-of-check");
    mkdirSync(checkSkillDir, { recursive: true });
    const checkContent = `---
name: master-of-check
description: "Checks master-of status, token savings, and health diagnostics across all dormant skills and domain gates."
---

# master-of Status & Health Check

Read the brief status report at: \`${paths.briefReportFile}\`
If the user asks for the complete inventory, read: \`${paths.reportFile}\`
`;
    writeAtomicSync(join(checkSkillDir, "SKILL.md"), normalizeNFC(checkContent));
    createdDirs.push(checkSkillDir);

    return createdDirs;
  }
}
