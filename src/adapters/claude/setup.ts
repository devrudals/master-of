import { join } from "path";
import { existsSync, readFileSync, chmodSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { writeAtomicSync } from "../../core/fs-atomic.ts";
import { normalizeNFC } from "../../core/unicode.ts";
import type { ConfigManager } from "../../core/config.ts";

const MO_BIN = fileURLToPath(new URL("../../../bin/mo.ts", import.meta.url));

/** The gate skills are the activation protocol — Claude-side text that v2 keeps verbatim. */
const PROTOCOL_FILES = [
  "SKILL.md",
  "skills/design/SKILL.md",
  "skills/dev/SKILL.md",
  "skills/research/SKILL.md",
  "skills/stock/SKILL.md",
  "skills/planning/SKILL.md",
  "skills/pipelines/SKILL.md",
];

/**
 * Writes a Claude Code plugin directory whose gate skills are the existing
 * protocol files, but whose scan/classify/report engine is the v2 CLI:
 * a SessionStart hook that runs `mo session-start`, and a slim check-skills
 * skill that drives `mo status` / `mo unclassified` / `mo classify`.
 */
export class ClaudePluginInstaller {
  constructor(private config: ConfigManager) {}

  install(targetDir: string, protocolSourceDir: string): { written: string[]; missingProtocol: string[] } {
    const written: string[] = [];
    const missingProtocol: string[] = [];
    const write = (rel: string, content: string) => {
      const out = join(targetDir, rel);
      writeAtomicSync(out, normalizeNFC(content));
      written.push(out);
      return out;
    };

    // Check first, write nothing on a miss: a half-written plugin dir means a
    // live SessionStart hook and a plugin.json pointing at skills that do not exist.
    const protocol = new Map<string, string>();
    for (const rel of PROTOCOL_FILES) {
      const src = join(protocolSourceDir, rel);
      if (!existsSync(src)) missingProtocol.push(rel);
      else protocol.set(rel, readFileSync(src, "utf8"));
    }
    if (missingProtocol.length > 0) return { written, missingProtocol };
    for (const [rel, content] of protocol) write(rel, content);

    const dataDir = this.config.getPaths().masterOfHome;
    const mo = `bun run "${MO_BIN}" --data-dir "${dataDir}"`;

    write(
      ".claude-plugin/plugin.json",
      JSON.stringify(
        {
          $schema: "https://anthropic.com/claude-code/plugin.schema.json",
          name: "master-of",
          version: "2.0.0",
          description:
            "Skill-gate system (v2 universal core): keeps rarely-used skills dormant behind domain gates and activates only what a task needs. check-skills = status + classify; the scan engine is the mo CLI.",
          skills: [
            "./skills/check-skills",
            "./skills/check-skills-all",
            "./skills/design",
            "./skills/dev",
            "./skills/pipelines",
            "./skills/planning",
            "./skills/research",
            "./skills/stock",
            "./",
          ],
        },
        null,
        2
      ) + "\n"
    );

    write(
      "hooks/hooks.json",
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              { hooks: [{ type: "command", command: '"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"', timeout: 30 }] },
            ],
          },
        },
        null,
        2
      ) + "\n"
    );

    const hook = write(
      "hooks/session-start.sh",
      `#!/bin/sh
# master-of SessionStart bootstrap (v2 - Self-contained Plug-and-Play)
if [ -n "\${MASTER_OF_BIN:-}" ]; then
  exec "\$MASTER_OF_BIN" session-start
fi
if [ -n "\${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "\${CLAUDE_PLUGIN_ROOT}/bin/mo.mjs" ]; then
  exec node "\${CLAUDE_PLUGIN_ROOT}/bin/mo.mjs" session-start
fi
if [ -x "\${HOME}/.master-of/mo" ]; then
  exec "\${HOME}/.master-of/mo" session-start
fi
if command -v mo >/dev/null 2>&1; then
  exec mo session-start
fi
printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"master-of: mo CLI를 실행할 수 없습니다 (Node.js 환경 확인 필요)."}}'
`
    );
    chmodSync(hook, 0o755);

    write(
      "skills/check-skills/SKILL.md",
      `---
name: "check-skills"
description: "Status and management of the master-of skill-gate system: shows the brief report (per-gate counts, what is broken, token savings), and files newly discovered skills into the right gate. Invoke for '현황', '점검해줘', 'what skills are gated', 'why is X disabled', or when the SessionStart hook says components are unclassified. The scan itself is done by the mo CLI; this skill only judges categories."
allowed-tools: Read, Bash
---

# check-skills

The engine is the \`mo\` CLI at \`~/.master-of/mo\` (written by \`claude-setup\`).

Never edit registry.json by hand and never Read it — it is large; every
question below has a CLI command.

## 1. Status (「현황」, 「점검해줘」)

\`\`\`bash
~/.master-of/mo status
\`\`\`

Show the output as-is. It lists broken items with the fix for each.

## 2. Unclassified components

The hook reports how many components still carry the scanner's category guess.
To file them:

1. \`~/.master-of/mo unclassified --source claude --json\` — each entry has
   \`name\`, \`type\`, \`category\` (the guess), \`description\`, \`rel_path\`, \`source\`.
2. For each entry decide, from its description, which gate it belongs to:
   \`design\` / \`dev\` / \`research\` / \`stock\` / \`planning\` / \`pipelines\`.
   Rules of thumb: an end-to-end workflow that runs a whole project phase →
   \`pipelines\` (needs \`--domain <gate>\`); GSD/planning skills take
   \`--cluster <name>\`. Write a one-line Korean summary (\`--desc\`).
3. \`~/.master-of/mo classify <name> <gate> --desc "한 줄 요약" [--cluster x] [--domain gate]\`
   To permanently skip: \`~/.master-of/mo ignore <name>\`.
4. After the batch: \`~/.master-of/mo claude-sync\` re-renders the gate indexes.

Bulk first run (5+ entries): show a one-line plan per gate and get a yes
BEFORE running \`claude plugin disable\` or moving folders.

## 3. Everything else

| Goal | Command |
|---|---|
| Full inventory | \`~/.master-of/mo full\` |
| Search | \`~/.master-of/mo search <keyword>\` |
| Remove stale entry | \`~/.master-of/mo remove <name>\` |
| Re-scan now | \`~/.master-of/mo sync && ~/.master-of/mo claude-sync\` |
`
    );

    write(
      "skills/check-skills-all/SKILL.md",
      `---
name: "check-skills-all"
description: "Full inventory of the master-of skill-gate system — every gated component by domain, plus what is broken and token savings. Invoke when the user asks for the whole list ('전체 보여줘', '다 보여줘', '전체 목록'); for a quick status use check-skills."
allowed-tools: Read, Bash
---

# check-skills-all

The engine is the \`mo\` CLI at \`~/.master-of/mo\`.

1. Refresh the index (silent — do not print output):
   \`\`\`bash
   ~/.master-of/mo sync && ~/.master-of/mo claude-sync
   \`\`\`

2. Show the full inventory overview:
   \`\`\`bash
   ~/.master-of/mo full
   \`\`\`
   Show its output as-is — a token-safe overview of gated components grouped by gate,
   plus always-on items and token savings.

For a single gate only: \`~/.master-of/mo gate <name>\` (e.g. \`mo gate design\`).
(Full uncompressed 80KB report is at \`~/.master-of/report.txt\` or via \`mo full --raw\`.)
`
    );

    // Write a thin wrapper at ~/.master-of/mo so the plugin's session-start.sh
    // bootstrap can find the CLI without needing a hard-coded absolute path
    // baked into the plugin files. This is the canonical discovery path the
    // plugin's bootstrap hook checks first (after $MASTER_OF_BIN).
    const wrapperDir = dataDir;
    mkdirSync(wrapperDir, { recursive: true });
    const wrapperPath = join(wrapperDir, "mo");
    const wrapperContent = `#!/bin/sh\n# ~/.master-of/mo — generated by claude-setup (do not edit; re-run claude-setup to update)\nexec ${mo} "$@"\n`;
    writeAtomicSync(wrapperPath, wrapperContent);
    chmodSync(wrapperPath, 0o755);
    written.push(wrapperPath);

    return { written, missingProtocol };
  }
}

export function defaultClaudePluginDir(claudeDir: string): string {
  return join(claudeDir, "skills", "master-of");
}
