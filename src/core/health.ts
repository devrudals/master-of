import { existsSync } from "fs";
import { join, resolve, delimiter } from "path";
import { readJsonSafe } from "./fs-atomic.ts";
import type { ConfigManager } from "./config.ts";
import type { RegistryManager } from "./registry.ts";
import type { HealthIssue, PluginStateProvider } from "./types.ts";

const WINDOWS_EXTS = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat", ".com"] : [""];

/**
 * Resolves an MCP server's launch command the way a shell would. Returns false
 * when the command can't be judged (env-var placeholders, http/sse servers):
 * a false "this is broken" every session is worse than missing one real break.
 */
export function commandIsMissing(cmd: string | undefined): boolean {
  if (!cmd || cmd.includes("${") || cmd.includes("$(") || cmd.includes("%")) return false;
  if (cmd.includes("/") || cmd.includes("\\")) {
    // existsSync follows symlinks, so a dangling link correctly reads as missing.
    return !existsSync(cmd);
  }
  const dirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  return !dirs.some((d: string) => WINDOWS_EXTS.some((ext) => existsSync(join(d, cmd + ext))));
}

type McpScope = { scope: string; isGlobal: boolean; servers: Record<string, any> };

export class HealthChecker {
  constructor(
    private config: ConfigManager,
    private registryManager: RegistryManager,
    private plugins?: PluginStateProvider
  ) {}

  private claudeJsonPath(): string {
    return resolve(this.config.getPaths().claudeDir, "..", ".claude.json");
  }

  /** Every place Claude can define an MCP server: global plus each project. */
  private mcpScopes(isEn: boolean): McpScope[] | null {
    const claudeJson = this.claudeJsonPath();
    if (!existsSync(claudeJson)) return null;

    const cfg = readJsonSafe<any>(claudeJson, {});
    const scopes: McpScope[] = [];
    if (cfg.mcpServers) scopes.push({ scope: isEn ? "global" : "전역", isGlobal: true, servers: cfg.mcpServers });
    for (const [project, value] of Object.entries<any>(cfg.projects || {})) {
      if (value?.mcpServers && Object.keys(value.mcpServers).length > 0) {
        scopes.push({ scope: isEn ? `project ${project}` : `프로젝트 ${project}`, isGlobal: false, servers: value.mcpServers });
      }
    }
    return scopes;
  }

  checkAll(): HealthIssue[] {
    const isEn = this.config.ensureConfigFile().report_language === "en";
    const scopes = this.mcpScopes(isEn);
    const issues = [...this.checkComponents(isEn, scopes), ...this.checkMcpServers(isEn, scopes)];
    // Critical first, so a one-line summary always leads with the worst thing.
    return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
  }

  private checkComponents(isEn: boolean, scopes: McpScope[] | null): HealthIssue[] {
    const issues: HealthIssue[] = [];
    const reg = this.registryManager.getRegistry();
    const configuredServers = scopes
      ? new Set(scopes.flatMap((s) => Object.keys(s.servers)))
      : null;

    const byPlugin = new Map<string, typeof reg.components[string][]>();

    for (const comp of Object.values(reg.components)) {
      const fullPath = this.registryManager.resolveFullPath(comp);
      if (!existsSync(fullPath)) {
        issues.push({
          kind: "missing_file",
          severity: "warning",
          subject: comp.name,
          detail: isEn
            ? `Target file not found at: ${fullPath}`
            : `대상 파일을 디스크에서 찾을 수 없음 (${fullPath})`,
          fix: isEn
            ? `Check if skill was moved or remove it with 'mo remove ${comp.name}'`
            : `스킬 경로를 확인하거나 'mo remove ${comp.name}'로 정리하세요`,
        });
      }

      // Only an explicit dependency counts: disabling a plugin is how a skill is
      // gated in the first place, so "its plugin is off" is the normal state,
      // not a fault — unless the skill declared it cannot run without it.
      const pluginId = comp.dependencies?.plugin;
      if (pluginId) (byPlugin.get(pluginId) ?? byPlugin.set(pluginId, []).get(pluginId)!).push(comp);

      const mcpName = comp.dependencies?.mcp_server;
      if (mcpName && comp.dependencies?.critical && configuredServers && !configuredServers.has(mcpName)) {
        issues.push({
          kind: "disabled_dependency",
          severity: "critical",
          subject: `${comp.name} -> ${mcpName}`,
          detail: isEn
            ? `Required MCP server '${mcpName}' is not configured`
            : `필수 의존 MCP 서버 '${mcpName}'가 설정되지 않음`,
          fix: isEn
            ? `Add MCP server '${mcpName}' or install its provider plugin`
            : `'${mcpName}' MCP 서버를 설정하거나 관련 플러그인을 설치하세요`,
        });
      }
    }

    // One issue per plugin, not per skill: what's broken is the plugin, and a
    // 40-line list of its skills hides everything else in the summary.
    for (const [pluginId, comps] of byPlugin) {
      const state = this.plugins?.stateOf(pluginId);
      if (!state || state.enabled) continue;
      const critical = comps.some((c) => c.dependencies?.critical === true);
      const names = comps.map((c) => c.name).sort();
      const shown = names.length > 5 ? `${names.slice(0, 5).join(", ")} … (+${names.length - 5})` : names.join(", ");
      issues.push({
        kind: "disabled_dependency",
        severity: critical ? "critical" : "warning",
        subject: pluginId,
        detail: state.installed
          ? isEn
            ? `plugin is disabled, so its MCP servers/agents are dead for ${comps.length} gated component(s): ${shown}`
            : `플러그인이 꺼져 있어 게이트된 구성요소 ${comps.length}개의 MCP/에이전트가 죽어 있음: ${shown}`
          : isEn
            ? `plugin isn't installed; ${comps.length} registered component(s) point into it: ${shown}`
            : `플러그인이 설치되어 있지 않은데 구성요소 ${comps.length}개가 가리킴: ${shown}`,
        fix: state.installed
          ? isEn ? `claude plugin enable ${pluginId} — takes effect at the next session start` : `claude plugin enable ${pluginId} — 반영은 다음 세션부터입니다`
          : isEn ? `claude plugin install ${pluginId} — takes effect at the next session start` : `claude plugin install ${pluginId} — 반영은 다음 세션부터입니다`,
      });
    }

    return issues;
  }

  /**
   * A configured MCP server can still be dead: its binary was uninstalled, its
   * path dangles, or the same name is defined in two scopes so which one wins
   * isn't knowable from either file alone. Both fail silently at session start.
   */
  private checkMcpServers(isEn: boolean, scopes: McpScope[] | null): HealthIssue[] {
    const issues: HealthIssue[] = [];
    if (!scopes) return issues;

    // Two projects each defining their own "foo" never collide; only a global
    // definition shadowed by a project one is ambiguous.
    const globalScope = scopes.find((s) => s.isGlobal);
    for (const { scope, isGlobal, servers } of scopes) {
      for (const [name, def] of Object.entries<any>(servers)) {
        if (!isGlobal && globalScope && name in globalScope.servers) {
          issues.push({
            kind: "dead_mcp",
            severity: "warning",
            subject: `MCP ${name}`,
            detail: isEn
              ? `defined in both "${globalScope.scope}" and "${scope}" — which one applies isn't knowable from either file alone`
              : `"${globalScope.scope}"과 "${scope}" 양쪽에 중복 정의됨 — 어느 쪽이 적용되는지 파일만 봐서는 알 수 없음`,
            fix: isEn ? "delete one of the two definitions" : "한쪽 정의를 지워서 하나만 남기세요",
          });
        }

        if (commandIsMissing(def?.command)) {
          issues.push({
            kind: "dead_mcp",
            severity: "critical",
            subject: `MCP ${name}`,
            detail: isEn
              ? `the ${scope} config's command can't be found (${def.command}) — fails to connect every session`
              : `${scope} 설정의 실행 파일을 찾을 수 없음 (${def.command}) — 매 세션 연결 실패`,
            fix: isEn
              ? "reinstall that tool, or remove the server from the config if you don't use it"
              : "해당 도구를 재설치하거나, 안 쓴다면 설정에서 정의를 지우세요",
          });
        }
      }
    }

    return issues;
  }
}
