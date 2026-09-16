import { fileURLToPath } from "url";
import { normalizeNFC } from "../../core/unicode.ts";
import type { ConfigManager } from "../../core/config.ts";
import type { RegistryManager } from "../../core/registry.ts";

/** Absolute: the MCP host (Cursor, Windsurf, Claude Desktop) launches the
 * server from its own working directory, never from this repo. */
const MO_BIN = fileURLToPath(new URL("../../../bin/mo.ts", import.meta.url));

export class RuleGenerator {
  constructor(
    private config: ConfigManager,
    private registryManager: RegistryManager
  ) {}

  generateAgentsMd(): string {
    const reg = this.registryManager.getRegistry();
    const lines: string[] = [
      "# master-of Skill Gateway Instructions",
      "",
      "This project uses **master-of** to keep system prompt tokens lean by gating 100+ dormant skills behind domain gates.",
      "",
      "## Available Domain Gates",
    ];

    for (const [key, meta] of Object.entries(reg.categories)) {
      lines.push(`- \`/${key}\`: ${meta.label_ko} (${meta.label_en}) — ${meta.description_ko}`);
    }

    lines.push("");
    lines.push("## How to Activate Skills On Demand");
    lines.push("1. When user requests work in a domain, query the gate index:");
    lines.push(`   - Via CLI: \`bun run ${MO_BIN} gate <domain>\``);
    lines.push("   - Via MCP Tool: `mo_open_gate(gate: '<domain>')`");
    lines.push("2. Review the 1-line index entries (`name | description | path`).");
    lines.push("3. Read only the matching skill(s) via file read or `mo_get_skill`.");
    lines.push("4. Execute the task following that skill's instructions.");

    return normalizeNFC(lines.join("\n") + "\n");
  }

  generateMcpSnippet(nodeOrBun = "bun"): string {
    const paths = this.config.getPaths();
    const snippet = {
      mcpServers: {
        "master-of": {
          command: nodeOrBun,
          args: ["run", MO_BIN, "mcp", "--data-dir", paths.masterOfHome],
        },
      },
    };
    return JSON.stringify(snippet, null, 2);
  }
}
