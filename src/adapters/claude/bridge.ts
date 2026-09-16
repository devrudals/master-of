import { join } from "path";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { writeAtomicSync } from "../../core/fs-atomic.ts";
import { gateFilePath } from "../../core/gates.ts";
import type { ConfigManager } from "../../core/config.ts";
import type { RegistryManager } from "../../core/registry.ts";
import type { GateReporter } from "../../core/reporter.ts";

export class ClaudeBridge {
  constructor(
    private config: ConfigManager,
    private registryManager: RegistryManager,
    private reporter?: GateReporter
  ) {}

  /**
   * Syncs pre-rendered gate index files and reports to Claude's masterof directory.
   * Copies are atomic: this is the path Claude actually Reads mid-session.
   */
  syncToClaude(targetClaudeMasterOfDir?: string): { syncedFiles: string[] } {
    const paths = this.config.getPaths();
    const dest = targetClaudeMasterOfDir || join(paths.claudeDir, "masterof");
    const destGates = join(dest, "gates");
    mkdirSync(destGates, { recursive: true });

    if (this.reporter) this.reporter.renderAll();

    const syncedFiles: string[] = [];
    const copyAtomic = (src: string, target: string) => {
      if (!existsSync(src)) return;
      writeAtomicSync(target, readFileSync(src, "utf8"));
      syncedFiles.push(target);
    };

    for (const cat of [...Object.keys(this.registryManager.getRegistry().categories), "_all", "always_on"]) {
      // Claude's masterof/gates is flat and only ever holds the claude-source view.
      copyAtomic(gateFilePath(paths.gatesDir, "claude", cat), join(destGates, `${cat}.txt`));
    }
    copyAtomic(paths.reportFile, join(dest, "report.txt"));
    copyAtomic(paths.briefReportFile, join(dest, "report-brief.txt"));

    return { syncedFiles };
  }
}
