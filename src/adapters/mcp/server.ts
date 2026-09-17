import { readFileSync, existsSync } from "fs";
import { dirname } from "path";
import { normalizeNFC } from "../../core/unicode.ts";
import { resolveGateFile } from "../../core/gates.ts";
import { searchComponents } from "../../core/search.ts";
import { DEFAULT_SOURCE } from "../../core/types.ts";
import type { ConfigManager } from "../../core/config.ts";
import { RegistryManager } from "../../core/registry.ts";
import type { HealthChecker } from "../../core/health.ts";

export class UniversalMcpServer {
  constructor(
    private config: ConfigManager,
    private registryManager: RegistryManager,
    private healthChecker?: HealthChecker
  ) {}

  startStdio(): void {
    let buffer = "";
    process.stdin.setEncoding("utf8");

    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          this.handleLine(line);
        }
      }
    });

    process.stderr.write("[master-of-mcp] Stdio MCP Server running\n");
  }

  handleLine(line: string): void {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch (err: any) {
      // No id could be recovered, so a JSON-RPC error has nowhere to go.
      process.stderr.write(`[master-of-mcp] Ignoring malformed line: ${err.message}\n`);
      return;
    }
    if (!message || message.jsonrpc !== "2.0") return;

    const { id, method, params } = message;
    try {

      if (method === "initialize") {
        this.respond(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "master-of", version: "2.0.0" },
        });
        return;
      }

      if (method === "notifications/initialized") {
        // Notification, no response required
        return;
      }

      if (method === "tools/list") {
        this.respond(id, {
          tools: [
            {
              name: "mo_list_gates",
              description: "List all active master-of domain gates with skill counts and token savings overview.",
              inputSchema: { type: "object", properties: {} },
            },
            {
              name: "mo_open_gate",
              description: "Opens a specific domain gate and returns its pre-rendered compact skill index (1~2KB).",
              inputSchema: {
                type: "object",
                properties: {
                  gate: {
                    type: "string",
                    description: "Gate name: 'design', 'dev', 'research', 'stock', 'planning', or 'pipelines'",
                  },
                  source: {
                    type: "string",
                    description: "Which harness's skills to list: 'claude' (default) or 'gemini'",
                  },
                },
                required: ["gate"],
              },
            },
            {
              name: "mo_search",
              description: "Fast keyword search across all indexed skills, commands, and agents.",
              inputSchema: {
                type: "object",
                properties: {
                  query: { type: "string", description: "Search query or keyword" },
                  category: { type: "string", description: "Optional category filter" },
                },
                required: ["query"],
              },
            },
            {
              name: "mo_get_skill",
              description: "Retrieves the full SKILL.md body and companion path for an identified skill.",
              inputSchema: {
                type: "object",
                properties: {
                  skill_name: { type: "string", description: "The exact name of the skill" },
                },
                required: ["skill_name"],
              },
            },
            {
              name: "mo_health_check",
              description: "Runs dependency, MCP, and broken path diagnostics.",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        });
        return;
      }

      if (method === "tools/call") {
        const { name, arguments: args } = params || {};
        let result;
        try {
          result = this.executeTool(name, args || {});
        } catch (err: any) {
          // A tool failure is still a valid response; the client must never hang on this id.
          result = { isError: true, content: [{ type: "text", text: `Tool '${name}' failed: ${err.message}` }] };
        }
        this.respond(id, result);
        return;
      }

      // Method not found
      this.sendError(id, -32601, `Method not found: ${method}`);
    } catch (err: any) {
      process.stderr.write(`[master-of-mcp] Error: ${err.message}\n`);
      if (id !== undefined) this.sendError(id, -32603, `Internal error: ${err.message}`);
    }
  }

  executeTool(name: string, args: any): any {
    this.registryManager.reloadIfChanged();
    const reg = this.registryManager.getRegistry();
    const paths = this.config.getPaths();
    const isEn = this.config.ensureConfigFile().report_language === "en";

    if (name === "mo_list_gates") {
      const gates = Object.entries(reg.categories).map(([key, meta]) => {
        const inGate = Object.values(reg.components).filter((c) => c.category === key && RegistryManager.isGated(c));
        const bySource: Record<string, number> = {};
        for (const c of inGate) bySource[c.source ?? DEFAULT_SOURCE] = (bySource[c.source ?? DEFAULT_SOURCE] || 0) + 1;
        const count = inGate.length;
        return {
          gate: key,
          items_by_source: bySource,
          label: isEn ? meta.label_en : meta.label_ko,
          description: isEn ? meta.description_en : meta.description_ko,
          items: count,
        };
      });
      return {
        content: [{ type: "text", text: JSON.stringify(gates, null, 2) }],
      };
    }

    if (name === "mo_open_gate") {
      const gateName = normalizeNFC(args.gate || "").trim().toLowerCase();
      const gateFile = resolveGateFile(paths.gatesDir, gateName, args.source || DEFAULT_SOURCE);
      if (!gateFile || !existsSync(gateFile)) {
        return {
          isError: true,
          content: [{ type: "text", text: `Gate '${gateName}' not found. Available gates: ${Object.keys(reg.categories).join(", ")}` }],
        };
      }
      const text = readFileSync(gateFile, "utf8");
      return {
        content: [{ type: "text", text: normalizeNFC(text) }],
      };
    }

    if (name === "mo_search") {
      const matches = searchComponents(reg, normalizeNFC(args.query || ""), args.category);

      const summary = matches.map((m) => ({
        name: m.name,
        category: m.category,
        description: (isEn ? m.description_en : m.description_ko) || m.description,
        path: m.rel_path,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }

    if (name === "mo_get_skill") {
      const skillName = normalizeNFC(args.skill_name || "");
      const comp = this.registryManager.getComponent(skillName);
      if (!comp) {
        return {
          isError: true,
          content: [{ type: "text", text: `Skill '${skillName}' not found in registry.` }],
        };
      }

      const fullPath = this.registryManager.resolveFullPath(comp);
      if (!existsSync(fullPath)) {
        return {
          isError: true,
          content: [{ type: "text", text: `Skill file not found on disk: ${fullPath}` }],
        };
      }

      const body = readFileSync(fullPath, "utf8");
      return {
        content: [
          {
            type: "text",
            // Relative references inside a skill (RECIPES.md, scripts/...) resolve
            // against its directory, so that is what the caller needs to carry.
            text: `# ${comp.name}\nBase directory: ${dirname(fullPath)}\n\n${normalizeNFC(body)}`,
          },
        ],
      };
    }

    if (name === "mo_health_check") {
      const issues = this.healthChecker ? this.healthChecker.checkAll() : [];
      return {
        content: [{ type: "text", text: JSON.stringify(issues, null, 2) }],
      };
    }

    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  }

  private respond(id: any, result: any): void {
    const payload = JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n";
    process.stdout.write(payload);
  }

  private sendError(id: any, code: number, message: string): void {
    const payload = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n";
    process.stdout.write(payload);
  }
}
