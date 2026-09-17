import { join } from "path";
import { existsSync, readFileSync, chmodSync } from "fs";
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
# SessionStart: rescan, re-render the gates Claude reads, and report only what
# changed. Silent (zero tokens) when nothing did. Without bun the gate files from
# the last run keep working; only the rescan is skipped.
if command -v bun >/dev/null 2>&1; then
  exec ${mo} session-start
fi
printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"master-of: bun not found, so skills were not rescanned this session (gates from the last scan still work). Tell the user once: install bun (https://bun.sh)."}}'
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

The engine is the \`mo\` CLI. Everywhere below, \`mo\` stands for exactly:

    ${mo}

Never edit registry.json by hand and never Read it — it is large; every
question below has a command.

## 1. Status ("현황", "점검")

Run \`mo status\` and show its output as-is. It already lists what is
broken (disabled plugins, dead MCP binaries, missing files) with the fix for each.

## 2. Unclassified components

The hook reports how many components still carry the scanner's category guess.
To file them:

1. \`mo unclassified --source claude --json\` — each entry has \`name\`, \`type\`, \`category\`
   (the guess), \`description\`, \`rel_path\`, \`source\`.
2. For each entry decide, from its description, the gate it belongs to:
   \`design\` / \`dev\` / \`research\` / \`stock\` / \`planning\` / \`pipelines\`.
   Rules of thumb: an end-to-end workflow that runs a whole project phase is a
   \`pipelines\` entry and needs \`--domain <gate>\` (the gate whose index should
   offer it); GSD/planning skills take \`--cluster <name>\` grouping related ones.
   Write a one-line Korean summary of what it does (\`--desc\`); the gate index
   shows that instead of the original description.
3. \`mo classify <name> <gate> --desc "<한 줄 요약>" [--cluster x] [--domain gate]\`
   For a component that should never be gated or listed (a harness-internal
   helper, a duplicate copy): \`mo ignore <name>\`.
4. After the batch: \`mo claude-sync\` re-renders the gates Claude reads.

Bulk first run (dozens of entries): show a one-line plan per gate ("design ←
a, b, c; planning ← …") and get a yes before running the classify commands.

## 3. Everything else

- Full inventory: \`mo full\`
- Search: \`mo search <keyword>\`
- Remove a stale entry: \`mo remove <name>\`
- Rescan by hand: \`mo sync && ${mo} claude-sync\`
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

1. Run \`${mo} sync && ${mo} claude-sync\` (silent — this just refreshes the
   report file on disk; do not print its output).
2. Read \`${dataDir}/report.txt\` with the Read tool and paste its ENTIRE
   content, top to bottom, as plain Markdown (not in a code fence, not
   re-typed from memory of the Bash output). The user asked for the whole
   list: do not summarize, do not truncate, do not group it differently,
   even though it is long (one line per gated component, grouped by gate).
   For a summary they would have asked for \`check-skills\`.
`
    );

    return { written, missingProtocol };
  }
}

export function defaultClaudePluginDir(claudeDir: string): string {
  return join(claudeDir, "skills", "master-of");
}
