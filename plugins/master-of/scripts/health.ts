#!/usr/bin/env bun
// Dependency + MCP health checks for the master-of system.
//
// Why this exists: gating a skill makes it dormant, but a skill is not a
// self-contained thing. It can depend on components that gating (or plain
// breakage) has killed underneath it:
//
//   * A gated skill whose owning plugin is disabled loses that plugin's MCP
//     servers and agents too -- `claude plugin disable` is all-or-nothing,
//     there is no per-component switch. `21st-ui` is the sharp case: the skill
//     is nothing but instructions for calling the 21st MCP server, so with the
//     plugin off it can be "activated" and still do nothing.
//   * An MCP server can be configured but dead (binary uninstalled, dangling
//     symlink, moved path). It then fails at every session start, and the only
//     signal is an error block in the model's context that nobody reads.
//
// Neither is auto-fixable from here, and deliberately so. Enabling a plugin
// or repairing an MCP command only takes effect at the NEXT session start
// (components are loaded once, at startup -- `claude plugin init` says as
// much: "auto-loads next session"), so silently flipping something on would
// produce a config that claims to work and a session where it doesn't. The
// job of this module is to make the broken state visible and say what would
// fix it; the user decides.
//
// Shared by the SessionStart hook (surfaces issues at session start) and
// render-report.ts (renders the 점검 section of report.txt), so the two can
// never disagree about what's broken.

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude");
const CLAUDE_JSON = join(HOME, ".claude.json");
const SETTINGS_FILE = join(CLAUDE_DIR, "settings.json");
const REGISTRY_FILE = join(CLAUDE_DIR, "masterof", "registry.json");
const INSTALLED_PLUGINS_FILE = join(CLAUDE_DIR, "plugins", "installed_plugins.json");
const CONFIG_FILE = join(CLAUDE_DIR, "masterof", "config.json");

// Messages in the report language (config.json `report_language`, ko|en).
function lang(): "ko" | "en" {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8")).report_language === "en" ? "en" : "ko";
  } catch {
    return "ko";
  }
}
const MSG = {
  ko: {
    scopeGlobal: "전역",
    scopeProject: (p: string) => `프로젝트 ${p}`,
    dupDetail: (a: string, b: string) => `"${a}"과 "${b}" 양쪽에 중복 정의됨 — 어느 쪽이 적용되는지 파일만 봐서는 알 수 없음`,
    dupFix: "한쪽 정의를 지워서 하나만 남기세요",
    deadDetail: (scope: string, cmd: string) => `${scope} 설정의 실행 파일을 찾을 수 없음 (${cmd}) — 매 세션 연결 실패`,
    deadFix: "해당 도구를 재설치하거나, 안 쓴다면 설정에서 정의를 지우세요",
    component: "구성요소",
    offDetail: (plugin: string, what: string, critical: boolean) =>
      `${plugin} 플러그인이 꺼져 있어 이 스킬이 쓰는 ${what}가 죽어 있음` +
      (critical ? " — 이 스킬은 그것 없이는 아무 동작도 못 함" : " — 스킬 본문은 읽히지만 일부 기능 불가"),
    notInstalledDetail: (plugin: string, what: string) => `${plugin} 플러그인이 설치되어 있지 않아 ${what}를 쓸 수 없음`,
    enableFix: (plugin: string) => `claude plugin enable ${plugin} — 단, 반영은 다음 세션부터입니다`,
    installFix: (plugin: string) => `claude plugin install ${plugin} — 반영은 다음 세션부터입니다`,
    ok: "점검 결과: 문제 없음",
    critical: "심각",
    warning: "주의",
  },
  en: {
    scopeGlobal: "global",
    scopeProject: (p: string) => `project ${p}`,
    dupDetail: (a: string, b: string) => `defined in both "${a}" and "${b}" — which one applies isn't knowable from either file alone`,
    dupFix: "delete one of the two definitions",
    deadDetail: (scope: string, cmd: string) => `the ${scope} config's command can't be found (${cmd}) — fails to connect every session`,
    deadFix: "reinstall that tool, or remove the server from the config if you don't use it",
    component: "component",
    offDetail: (plugin: string, what: string, critical: boolean) =>
      `plugin ${plugin} is disabled, so the ${what} this skill uses is dead` +
      (critical ? " — the skill can't do anything without it" : " — the skill's body still works, some features won't"),
    notInstalledDetail: (plugin: string, what: string) => `plugin ${plugin} isn't installed, so its ${what} isn't available`,
    enableFix: (plugin: string) => `claude plugin enable ${plugin} — takes effect at the next session start`,
    installFix: (plugin: string) => `claude plugin install ${plugin} — takes effect at the next session start`,
    ok: "Health: nothing broken",
    critical: "CRITICAL",
    warning: "warning",
  },
};

export type Issue = {
  kind: "dead_mcp" | "disabled_dependency";
  severity: "critical" | "warning";
  subject: string; // the skill or server the issue is about
  detail: string; // what's wrong, in the report language
  fix: string; // what would fix it, in the report language
};

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// Resolve an MCP server's launch command the way a shell would. Returns null
// when the command can't be judged (env-var placeholders, http/sse servers) --
// unjudgeable is reported as healthy, since a false "this is broken" every
// session is worse than missing one genuinely broken server.
function commandIsMissing(cmd: string | undefined): boolean {
  if (!cmd || cmd.includes("${") || cmd.includes("$(")) return false;
  if (cmd.includes("/")) {
    // existsSync follows symlinks, so a dangling link correctly reads as missing.
    return !existsSync(cmd);
  }
  const dirs = (process.env.PATH || "").split(":").filter(Boolean);
  return !dirs.some((d) => existsSync(join(d, cmd)));
}

function checkMcpServers(): Issue[] {
  const issues: Issue[] = [];
  const cfg = readJson(CLAUDE_JSON);
  if (!cfg) return issues;
  const m = MSG[lang()];

  const sources: { scope: string; servers: Record<string, any> }[] = [];
  if (cfg.mcpServers) sources.push({ scope: m.scopeGlobal, servers: cfg.mcpServers });
  for (const [proj, v] of Object.entries<any>(cfg.projects || {})) {
    if (v?.mcpServers && Object.keys(v.mcpServers).length > 0) {
      sources.push({ scope: m.scopeProject(proj), servers: v.mcpServers });
    }
  }

  // Same server name defined in more than one scope: whichever wins is not
  // obvious from any single file, which is exactly how one of them rots
  // unnoticed.
  const seen = new Map<string, string>();
  for (const { scope, servers } of sources) {
    for (const [name, def] of Object.entries<any>(servers)) {
      if (seen.has(name)) {
        issues.push({
          kind: "dead_mcp",
          severity: "warning",
          subject: `MCP ${name}`,
          detail: m.dupDetail(seen.get(name)!, scope),
          fix: m.dupFix,
        });
      } else {
        seen.set(name, scope);
      }
      if (def?.command && commandIsMissing(def.command)) {
        issues.push({
          kind: "dead_mcp",
          severity: "critical",
          subject: `MCP ${name}`,
          detail: m.deadDetail(scope, def.command),
          fix: m.deadFix,
        });
      }
    }
  }
  return issues;
}

function checkDisabledDependencies(): Issue[] {
  const issues: Issue[] = [];
  const reg = readJson(REGISTRY_FILE);
  const settings = readJson(SETTINGS_FILE);
  const installed = readJson(INSTALLED_PLUGINS_FILE);
  if (!reg || !settings) return issues;
  const enabled: Record<string, boolean> = settings.enabledPlugins || {};
  const m = MSG[lang()];

  for (const key of Object.keys(reg)) {
    if (key === "category_meta") continue;
    const arr = reg[key];
    if (!Array.isArray(arr)) continue;
    for (const e of arr) {
      const req = e?.requires;
      if (!req?.plugin) continue;
      const isInstalled = !!installed?.plugins?.[req.plugin];
      const isEnabled = enabled[req.plugin] === true;
      if (isEnabled) continue;
      const what = (req.components || []).join(", ") || m.component;
      issues.push({
        kind: "disabled_dependency",
        severity: req.critical ? "critical" : "warning",
        subject: `${key}/${e.name}`,
        detail: isInstalled ? m.offDetail(req.plugin, what, !!req.critical) : m.notInstalledDetail(req.plugin, what),
        fix: isInstalled ? m.enableFix(req.plugin) : m.installFix(req.plugin),
      });
    }
  }
  return issues;
}

export function checkHealth(): Issue[] {
  const all = [...checkMcpServers(), ...checkDisabledDependencies()];
  // critical first, so a one-line summary always leads with the worst thing.
  return all.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
}

// Run directly for a quick manual check. Detected by path, not
// import.meta.main -- that's bun / node 24+ only, and node 22-23 is a
// supported runtime here.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const issues = checkHealth();
  const m = MSG[lang()];
  if (issues.length === 0) {
    console.log(m.ok);
  } else {
    for (const i of issues) {
      console.log(`[${i.severity === "critical" ? m.critical : m.warning}] ${i.subject}: ${i.detail}\n   → ${i.fix}`);
    }
  }
}
