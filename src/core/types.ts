export type ComponentType = "skill" | "command" | "agent";
export type PathAnchor = "claude" | "gemini" | "library" | "sandbox" | "custom";

export interface ComponentDependencies {
  mcp_server?: string;
  plugin?: string;
  critical?: boolean;
}

export interface RegistryComponent {
  name: string;
  type: ComponentType;
  category: string;
  description: string;
  description_ko?: string;
  description_en?: string;
  path_anchor: PathAnchor;
  rel_path: string;
  full_path?: string;
  cluster?: string;
  /** For a pipeline: the domain gate whose index lists it under 관련 파이프라인. */
  domain?: string;
  dependencies?: ComponentDependencies;
  always_on?: boolean;
  source?: ComponentSource;
  /** "auto" = category is the scanner's regex guess; "confirmed" = a person or
   * a migrated v1 registry settled it. Only "auto" entries show up as unclassified. */
  classification?: "auto" | "confirmed";
}

export type ComponentSource = "claude" | "gemini" | "custom";
export const DEFAULT_SOURCE: ComponentSource = "claude";

export interface CategoryMeta {
  label_ko: string;
  label_en: string;
  description_ko: string;
  description_en: string;
  bundle?: {
    plugin_name: string;
    desc_ko: string;
    desc_en?: string;
    agents_always_on?: {
      count: number;
      desc_ko: string;
      desc_en?: string;
    };
  };
}

export interface UniversalRegistry {
  schema_version: 2;
  updated_at: string;
  categories: Record<string, CategoryMeta>;
  components: Record<string, RegistryComponent>;
}

export type PreferenceMode = "always_ask" | "fixed_default" | "conditional" | "smart";

export interface CategoryPreference {
  mode: PreferenceMode;
  default?: string;
  rules?: Array<{ when: string; use: string }>;
  fallback?: PreferenceMode | string;
}

export type Preferences = Record<string, CategoryPreference>;

export interface MasterOfConfig {
  report_language: "ko" | "en";
  report_language_name: string;
  determined_at: string;
  determined_from: string;
}

export interface HealthIssue {
  kind: "dead_mcp" | "disabled_dependency" | "missing_file" | "path_leak";
  severity: "critical" | "warning";
  subject: string;
  detail: string;
  fix: string;
}

export interface ScanResult {
  added: RegistryComponent[];
  removed: string[];
  totalScanned: number;
}

/** Supplied by a harness adapter: whether the plugin owning a component is
 * installed and switched on. Core never reads harness config itself. */
export interface PluginStateProvider {
  pluginIdOf(component: RegistryComponent): string | null;
  stateOf(pluginId: string): { installed: boolean; enabled: boolean } | undefined;
}
