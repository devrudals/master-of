---
name: "check-skills"
description: "Status and management of the master-of skill-gate system: shows the brief report (per-gate counts, what is broken, token savings), and files newly discovered skills into the right gate. Invoke for '현황', '점검해줘', 'what skills are gated', 'why is X disabled', or when the SessionStart hook says components are unclassified. Also the first-time setup guide when mo CLI is not yet configured."
allowed-tools: Read, Bash
---

# check-skills

The engine is the `mo` CLI. Everywhere below, `mo` means the wrapper at
`~/.master-of/mo` (written by `claude-setup` — see Setup below).

Never read `registry.json` directly and never edit it by hand — it is large,
and every question below has a CLI command that reads it correctly.

---

## Setup (first time only)

If the SessionStart hook said "mo CLI를 찾을 수 없습니다", run setup now:

```bash
# Find where bun + bin/mo.ts live (user cloned the repo somewhere):
which bun          # confirm bun is available
ls ~/Documents/0.\ Claude-projects/projects/master-of/bin/mo.ts   # adjust if cloned elsewhere
```

Then run claude-setup from the repo:
```bash
bun run ~/Documents/0.\ Claude-projects/projects/master-of/bin/mo.ts claude-setup
```

This writes `~/.master-of/mo` (the wrapper), the gate index files, and
the hooks inside `~/.claude/skills/master-of/`. After this, all future
sessions work automatically — no manual setup again.

Tell the user to **restart the session** after setup completes.

---

## 1. Status (「현황」, 「점검해줘」)

```bash
~/.master-of/mo status
```

Show the output as-is. It lists broken items (disabled plugins whose gates
still offer them, dead MCP servers) with the fix for each.

## 2. Unclassified components

The SessionStart hook reports how many components still carry the scanner's
category guess. To file them:

1. `~/.master-of/mo unclassified --source claude --json` — each entry has
   `name`, `type`, `category` (the guess), `description`, `rel_path`, `source`.
2. For each entry decide, from its description, which gate it belongs to:
   `design` / `dev` / `research` / `stock` / `planning` / `pipelines`.
   Rules of thumb:
   - An end-to-end workflow that runs a whole project phase → `pipelines`
     (needs `--domain <gate>` to surface from that gate's index too)
   - GSD/planning skills → `planning`, add `--cluster <name>`
   - A skill whose only job is to call a plugin's MCP server → mark it
     `requires` that plugin; it's hollow when the plugin is disabled
   Write a one-line Korean summary for `--desc`.
3. `~/.master-of/mo classify <name> <gate> --desc "한 줄 요약" [--cluster x] [--domain gate]`
   To permanently skip a component (harness-internal helper, exact duplicate):
   `~/.master-of/mo ignore <name>`
4. After the batch: `~/.master-of/mo claude-sync` re-renders the gate indexes.

**Bulk first run (5+ entries)**: classify them all, then show a one-line plan
per gate ("design ← a, b, c; planning ← …") and get a yes BEFORE running
`claude plugin disable` or moving folders. Reorganising a full library without
asking is not routine.

### Dormancy rules (how to make a component stop loading every session)

| Component type | How to gate it |
|---|---|
| Raw skill (`~/.claude/skills/<name>/SKILL.md`) | `mo classify` → `mo claude-sync` moves it to `~/.claude/skills-library/<cat>/` |
| Raw command (`~/.claude/commands/<name>.md`) | Same — moved to `~/.claude/skills-library/<cat>/_commands/` |
| Raw agent (`~/.claude/agents/<name>.md`) | Same — moved to `~/.claude/skills-library/<cat>/_agents/` |
| Plugin-bundled component | `claude plugin disable <plugin>@<marketplace>` |
| Agents spawned by gated skills | Keep always-on (file under `always_on` with `reason: "spawn_cost"`) — reading each on every spawn costs more than their always-on tax |

## 3. Everything else

| Goal | Command |
|---|---|
| Full inventory | `~/.master-of/mo full` |
| Search | `~/.master-of/mo search <keyword>` |
| Remove a stale entry | `~/.master-of/mo remove <name>` |
| Re-scan now | `~/.master-of/mo sync && ~/.master-of/mo claude-sync` |
| Gate files up to date? | `~/.master-of/mo claude-sync` (re-renders indexes) |

## 4. Brief report

Run `~/.master-of/mo status` and show its output. That's the brief view.
For the full inventory the user asked for the whole list ("전체 보여줘"),
use the sibling skill `check-skills-all`.

### Permanent exemptions

Some plugins/skills are never gated (hook-dependent, output-style, near-zero
cost, silently-opportunistic). These are tracked in the `always_on` section
of the v2 registry — `mo status` shows them. To add one:
`~/.master-of/mo always-on <name> --reason <reason>`.
