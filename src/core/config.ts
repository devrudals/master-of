import { homedir } from "os";
import { join, resolve } from "path";
import { existsSync, mkdirSync } from "fs";
import { assertWithinSandbox } from "./boundary.ts";
import { readJsonSafe, writeAtomicSync } from "./fs-atomic.ts";
import type { MasterOfConfig, Preferences } from "./types.ts";

export interface SystemPaths {
  masterOfHome: string;
  gatesDir: string;
  registryFile: string;
  preferencesFile: string;
  configFile: string;
  reportFile: string;
  briefReportFile: string;
  claudeDir: string;
  geminiDir: string;
  isSandbox: boolean;
  sandboxBoundaryRoot?: string;
}

export class ConfigManager {
  private paths: SystemPaths;

  constructor(options?: {
    dataDir?: string;
    sandboxRoot?: string;
    claudeDir?: string;
    geminiDir?: string;
  }) {
    const isSandbox = Boolean(options?.sandboxRoot || process.env.MASTER_OF_SANDBOX);
    const sandboxBoundary = options?.sandboxRoot || process.env.MASTER_OF_SANDBOX_ROOT;
    if (isSandbox && !sandboxBoundary) {
      throw new Error("MASTER_OF_SANDBOX is set but no boundary was given (MASTER_OF_SANDBOX_ROOT or --sandbox <dir>)");
    }

    let baseDir = options?.dataDir || process.env.MASTER_OF_HOME;
    if (!baseDir) {
      if (isSandbox && sandboxBoundary) {
        baseDir = join(sandboxBoundary, "masterof-home");
      } else {
        baseDir = join(homedir(), ".master-of");
      }
    }

    baseDir = resolve(baseDir);

    if (isSandbox && sandboxBoundary) {
      assertWithinSandbox(baseDir, sandboxBoundary);
    }

    const claudeDir = options?.claudeDir || (isSandbox && sandboxBoundary ? join(sandboxBoundary, "mock-claude") : join(homedir(), ".claude"));
    const geminiDir = options?.geminiDir || (isSandbox && sandboxBoundary ? join(sandboxBoundary, "mock-gemini") : join(homedir(), ".gemini"));

    this.paths = {
      masterOfHome: baseDir,
      gatesDir: join(baseDir, "gates"),
      registryFile: join(baseDir, "registry.json"),
      preferencesFile: join(baseDir, "preferences.json"),
      configFile: join(baseDir, "config.json"),
      reportFile: join(baseDir, "report.txt"),
      briefReportFile: join(baseDir, "report-brief.txt"),
      claudeDir,
      geminiDir,
      isSandbox,
      sandboxBoundaryRoot: sandboxBoundary,
    };

    mkdirSync(this.paths.masterOfHome, { recursive: true });
    mkdirSync(this.paths.gatesDir, { recursive: true });
  }

  getPaths(): SystemPaths {
    return this.paths;
  }

  ensureConfigFile(): MasterOfConfig {
    const fallback: MasterOfConfig = {
      report_language: "ko",
      report_language_name: "Korean",
      determined_at: new Date().toISOString(),
      determined_from: "master-of v2 universal bootstrap",
    };
    if (!existsSync(this.paths.configFile)) {
      writeAtomicSync(this.paths.configFile, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    return readJsonSafe<MasterOfConfig>(this.paths.configFile, fallback);
  }

  ensurePreferencesFile(): Preferences {
    const fallback: Preferences = {
      design: { mode: "always_ask" },
      dev: { mode: "always_ask" },
      research: { mode: "always_ask" },
      stock: { mode: "always_ask" },
      planning: { mode: "always_ask" },
      pipelines: { mode: "always_ask" },
    };
    if (!existsSync(this.paths.preferencesFile)) {
      writeAtomicSync(this.paths.preferencesFile, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    return readJsonSafe<Preferences>(this.paths.preferencesFile, fallback);
  }
}
