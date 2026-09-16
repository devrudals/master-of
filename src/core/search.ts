import { normalizeNFC, safeIncludes } from "./unicode.ts";
import type { RegistryComponent, UniversalRegistry } from "./types.ts";

/**
 * Single matching rule shared by the CLI and the MCP server, so the two
 * surfaces can never answer the same query differently.
 */
export function searchComponents(
  registry: UniversalRegistry,
  query: string,
  category?: string
): RegistryComponent[] {
  const cat = category ? normalizeNFC(category).trim().toLowerCase() : undefined;

  return Object.values(registry.components).filter((c) => {
    if (cat && normalizeNFC(c.category).toLowerCase() !== cat) return false;
    return (
      safeIncludes(c.name, query) ||
      safeIncludes(c.description, query) ||
      safeIncludes(c.description_ko || "", query) ||
      safeIncludes(c.description_en || "", query) ||
      safeIncludes(c.cluster || "", query)
    );
  });
}
