import { join, resolve, sep } from "path";
import { readJsonSafe } from "../../core/fs-atomic.ts";
import type { RegistryComponent, PluginStateProvider } from "../../core/types.ts";

/** plugins/cache/<marketplace>/<plugin>/<version>/... → "<plugin>@<marketplace>" */
const CACHE_PATH = /^plugins[\\/]cache[\\/]([^\\/]+)[\\/]([^\\/]+)[\\/]([^\\/]+)[\\/]/;

export interface PluginState {
  installed: boolean;
  enabled: boolean;
}

/**
 * What Claude Code knows about plugins: which are installed (and at which
 * cache path) and which the user has switched on. A skill under a plugin's
 * cache dir lives or dies with that plugin, so this is what health and sync
 * consult for anything under plugins/cache.
 */
export class ClaudePluginIndex implements PluginStateProvider {
  private states = new Map<string, PluginState>();
  private installPaths: string[] = [];

  constructor(claudeDir: string) {
    const installed = readJsonSafe<any>(join(claudeDir, "plugins", "installed_plugins.json"), {});
    const enabled: Record<string, boolean> = readJsonSafe<any>(join(claudeDir, "settings.json"), {}).enabledPlugins || {};

    for (const [id, entries] of Object.entries<any>(installed.plugins || {})) {
      this.states.set(id, { installed: true, enabled: enabled[id] === true });
      for (const entry of Array.isArray(entries) ? entries : [entries]) {
        if (entry?.installPath) this.installPaths.push(resolve(entry.installPath));
      }
    }
    for (const [id, on] of Object.entries(enabled)) {
      if (!this.states.has(id)) this.states.set(id, { installed: false, enabled: on === true });
    }
  }

  /** Plugin id owning a claude-anchored component, or null if it is not under plugins/cache. */
  static pluginIdOf(component: RegistryComponent): string | null {
    if (component.path_anchor !== "claude") return null;
    const m = component.rel_path.match(CACHE_PATH);
    return m ? `${m[2]}@${m[1]}` : null;
  }

  pluginIdOf(component: RegistryComponent): string | null {
    return ClaudePluginIndex.pluginIdOf(component);
  }

  stateOf(pluginId: string): PluginState | undefined {
    return this.states.get(pluginId);
  }

  /**
   * Whether Claude Code still loads this component at session start. Gating
   * only saves tokens for what is NOT loaded: skills parked in skills-library
   * and anything inside a disabled plugin. Everything else (~/.claude/skills,
   * agents, commands, enabled plugins, synced skills) is always-on regardless
   * of the index, so listing it in a gate would only make the model re-read it.
   */
  isDormant(component: RegistryComponent): boolean {
    if (component.path_anchor !== "claude") return false;
    if (/^skills-library[\\/]/.test(component.rel_path)) return true;
    const pluginId = ClaudePluginIndex.pluginIdOf(component);
    if (!pluginId) return false;
    const state = this.states.get(pluginId);
    return !!state && !state.enabled;
  }

  /** True for a plugins/cache path that no installed plugin version points at:
   * a leftover from an earlier install that would only shadow the live one. */
  isStaleCachePath(absolutePath: string): boolean {
    const norm = resolve(absolutePath);
    if (!/[\\/]plugins[\\/]cache[\\/]/.test(norm)) return false;
    if (this.installPaths.length === 0) return false;
    return !this.installPaths.some((p) => norm === p || norm.startsWith(p + sep));
  }
}
