# master-of

A skill-gate system for [Claude Code](https://claude.com/claude-code). Every
installed skill's description normally sits in the system prompt of *every*
session, whether that session ever needs it or not — a large personal skill
library can cost thousands of tokens per session before a single message is
sent. `master-of` keeps rarely-used skills dormant behind a handful of domain
gates, and opens a gate (reading only that gate's own small index, never the
full registry) only when a task actually needs something in it.

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

```
/plugin marketplace add devrudals/master-of
/plugin install master-of@master-of
```

Restart the session. The first `SessionStart` hook run bootstraps an empty
registry (the six domain gates, no skills classified yet) and starts scanning
your installed skills for classification.

> If you're developing this plugin locally from a cloned copy of
> `~/.claude/skills/master-of` (or another skills-dir checkout) *and* also
> install the marketplace version, both register as a plugin named
> `master-of` and the marketplace one wins — the local dev copy won't load
> until you rename one of them. Not an issue for a normal install.

## How it works, in four steps

1. **Session starts** → the hook (a few milliseconds) diffs your skills
   against `~/.claude/masterof/registry.json`. Silent if nothing changed.
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
- Status reports are rendered in Korean by default (`~/.claude/masterof/config.json`'s
  `report_language`); `check-skills` determines this from your session's
  language on first run if the file is missing. Multi-language descriptions
  per skill are supported by the data model but only the Korean renderer
  ships today — a PR adding another locale's renderer is welcome.
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
  agent by `subagent_type` resolves it through the same gate index. The
  one tradeoff the model will ask you about: a large agent set that gated
  skills spawn often (a framework with 30 agents) costs a file read per
  spawn once gated, which can exceed what it saves — you choose.

## License

MIT — see [LICENSE](./LICENSE).
