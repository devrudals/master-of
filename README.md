# master-of

A skill-gate system for [Claude Code](https://claude.com/claude-code). Every
installed skill's description normally sits in the system prompt of *every*
session, whether that session ever needs it or not — a large personal skill
library can cost thousands of tokens per session before a single message is
sent. `master-of` keeps rarely-used skills dormant behind a handful of domain
gates, and opens a gate (reading only that gate's own small index, never the
full registry) only when a task actually needs something in it.

On the author's own setup — 141 skills, commands and agents across 9 plugins
and personal skill libraries — that's the difference between ~7,200
always-on tokens per session and ~900: an 88% cut, with zero loss of
capability, because nothing is deleted, just made dormant until a task
actually calls for it.

```
$ /master-of:check-skills
  7,224 tok   before gating (all 141 components always-on)
−   897 tok   after gating (9 gates exposed instead)
───────────
  6,327 tok   saved (88% reduction)
```

## What it does

- **Domain gates** (`design`, `dev`, `research`, `stock`, `planning`,
  `pipelines` out of the box — you can add your own): each is a thin,
  always-on pointer. Opening one reads a small pre-rendered index for that
  domain and activates just the 1-4 components a task needs — skills,
  commands or agents — not the whole category.
- **`check-skills`**: brief status — per-gate skill counts, a health check
  (dead MCP server binaries, gated skills whose owning plugin is disabled so
  they can't actually work), current ambiguity-handling preferences, and a
  token-savings estimate.
- **`check-skills-all`**: the same, plus the full skill-by-skill inventory.
- **Self-scanning**: a `SessionStart` hook diffs what's installed against
  what's classified, every session, at effectively zero cost when nothing
  changed. New skills get flagged for classification; skills whose files
  disappeared get flagged for pruning; broken dependencies get flagged with
  what would fix them. Nothing is auto-fixed — plugin enable/disable and MCP
  config changes only take effect at the *next* session start, so this system
  tells you what's broken and lets you decide.

## Install

### Step 1 — add the plugin

```
/plugin marketplace add devrudals/master-of
/plugin install master-of@master-of
```

Restart the session. The first `SessionStart` hook will tell you the mo CLI
needs setup.

### Step 2 — connect the v2 CLI (one time)

Clone this repo and run `claude-setup`:

```bash
git clone https://github.com/devrudals/master-of.git ~/master-of
bun run ~/master-of/bin/mo.ts claude-setup
```

This writes `~/.master-of/mo` (the permanent wrapper), generates the gate
index files Claude reads, and rewrites the hook inside
`~/.claude/skills/master-of/` to use it. Needs `bun` (≥ 1.1) on your PATH.

**Restart the session again.** From now on every session start rescans
automatically — zero setup from here on.

> **If you move or re-clone the repo**, re-run `claude-setup` from the new
> path to update the wrapper. The plugin itself does not need to be
> reinstalled.

## How it works, in four steps

1. **Session starts** → the hook (a few milliseconds) diffs your skills
   against `~/.master-of/registry.json`. Silent if nothing changed.
2. **You ask for work in a domain** → the model opens that one gate, reading
   only its pre-rendered index (a few hundred to a couple thousand tokens,
   not the whole registry), and activates just what the task needs.
3. **A new skill gets installed** → the hook flags it; the model classifies
   it into a gate (or creates a new one) and records why.
4. **You ask "what's gated?"** → `check-skills` answers from a cached report,
   not by re-deriving anything from the registry live.

## How much you have to do

Almost nothing, by design:

- **Install → restart.** The first session's hook lists every unclassified
  skill with its description; the model classifies them from that (no file
  reads), shows you a one-line plan for anything bulk (5+ skills), and after
  a yes makes them dormant. One more restart and the saving is live.
- **Ask for work.** Gates open themselves on clear work requests ("이 화면
  다듬어줘") — you don't type `/design`. Questions and mentions don't open
  anything.
- **Install more plugins later.** The next session's hook flags them; the
  model files them; you get a heads-up, not a task.
- **When something's ambiguous** the model asks (default) — or, if you tell
  it once, uses a fixed default / a rule / its own judgment per domain.
- **When something's broken** (a dead MCP binary, a gated skill whose plugin
  is off) you get one line at session start with the fix. Nothing is changed
  behind your back, because those fixes only apply at the next restart.

What you still own: the one-time first-run yes, restarts after enable/disable
changes, and the fixes the health check points at.

## Notes for other installs

- The six default domain gates (and their example skills mentioned in a
  couple of descriptions) reflect the author's own setup — nothing about the
  gating mechanism itself assumes any particular skill is installed. Classify
  your own skills into these gates, or ask `check-skills` to create a new
  gate, freely.
- Reports render in English or Korean. The first session picks from your
  system locale (`LANG`) and records it in `~/.master-of/config.json`;
  `check-skills` switches it if your actual session language differs. Other
  languages need a string table added to the two renderer scripts — PRs
  welcome.
- Disabling a plugin to gate its skill also disables anything else that
  plugin ships (MCP servers, agents). `check-skills`'s health check flags
  this when it makes a gated skill non-functional, but does not work around
  it — some skills genuinely need their plugin enabled to do anything.
- A gated skill is activated by reading its `SKILL.md`, not by the `Skill`
  tool, so `$ARGUMENTS` isn't substituted (the protocol tells the model to
  supply it from your request), `allowed-tools` doesn't pre-approve (you may
  see a permission prompt the skill wouldn't normally trigger), and
  `disable-model-invocation: true` skills are never auto-opened — they're
  offered by name for you to pick.
- Skills, **commands** and **agents** are all scanned and gated — from
  plugins (`skills/`, `commands/`, `agents/`) and from `~/.claude/commands`
  and `~/.claude/agents`. A gated command is activated by reading its prompt
  template; a gated agent by reading its system prompt and spawning a
  `general-purpose` agent with it. A gated skill that wants to spawn a gated
  agent by `subagent_type` resolves it through the same gate index.
- **The one thing deliberately NOT gated: agents that gated skills spawn
  often.** A framework like GSD ships 65 skills and 34 agents the skills
  spawn by `subagent_type`. Gating the agents would save ~2k tokens a
  session, but each spawn would then cost a read of the agent's prompt
  (4-12k tokens) — one phase run costs ten sessions' worth of the saving.
  So the rule is: gate the skills, keep the agents always-on (`always_on`
  with reason `spawn_cost`), and say so in the report. The model applies
  this by default when it sees that shape; it asks only when the set is
  small enough to be a toss-up.

## v2 universal core (`src/`, `bin/mo.ts`)

The same gate system as a harness-neutral CLI + MCP server, so Antigravity,
Cursor, Windsurf or any MCP-capable agent can read the same registry. It is
**Bun-only** (`bun >= 1.1`) — the entrypoint is TypeScript run directly, with
no build step, so `node bin/mo.ts` will not work. Key commands:

```
bun run bin/mo.ts sync                 # scan ~/.claude and ~/.gemini, render gates/<source>/<gate>.txt
bun run bin/mo.ts unclassified         # components still carrying the scanner's category guess
bun run bin/mo.ts classify <name> <gate> [--cluster x] [--domain gate]
bun run bin/mo.ts gate design [--source gemini]
bun run bin/mo.ts doctor               # dead MCP binaries, disabled plugins, missing files
bun run bin/mo.ts mcp-snippet          # paste into Cursor / Windsurf / Claude Desktop config
bun run bin/mo.ts cowork [list|on|off] [domain]  # toggle account-synced Cowork packs (figma, design, …)
bun test                               # 99 tests; bun run typecheck for tsc
```

Gate files are rendered per source so each harness only sees skills it can run;
the same skill installed in both harnesses is listed in both (`animate` and
`animate@gemini` in the registry). A rescan refreshes descriptions and paths
but never overwrites a category you confirmed with `classify`.

Claude Code accounts with the Cowork feature get a set of account-synced
skill packs (`figma`, `design`, `data`, `marketing`, `engineering`,
`product-management`, `productivity`, `pdf-viewer`, `cowork-plugin-management`,
plus a few individual document skills) mirrored onto disk under
`plugins/synced/` and `skills/synced/`. These have no marketplace entry, so
`claude plugin list` doesn't show them by default and moving or deleting the
files doesn't help — the account sync re-creates them within the same
session. They do, however, respond to `claude plugin enable/disable
<domain>@synced`, which is the switch `mo cowork` drives: it hides them from
every session's system prompt without touching the account-level sync, so
Cowork itself and its collaboration features keep working normally.

## License

MIT — see [LICENSE](./LICENSE).
