---
name: "check-skills"
description: "Brief status of the master-of skill-gate system: scans for new/removed skills and plugins, classifies them into the right domain gate, then shows the SHORT report — per-gate counts, what is currently broken (dead MCP servers, gated skills whose plugin is off), preference modes, token savings. Runs automatically at SessionStart via a hook for the scan step; invoke it for 'what skills are gated', '현황', '점검해줘', 'why is X disabled', or any master-of status question. For the full list use check-skills-all."
allowed-tools: Read, Edit, Write, Bash
---

# check-skills (brief)

This is the one skill in this plugin that manages state instead of gating a
domain — everything else (`design`/`dev`/`research`/`stock`/`planning`)
just activates things on request. This one scans, classifies, and reports.

Two ways it runs:
- **Automatically**, once per session, via the `SessionStart` hook
  (`hooks-handlers/on-session-start.ts`) — the hook does the cheap
  deterministic diffing (zero LLM cost when nothing changed) and, only when
  something changed, injects an instruction to come here and follow step 1.
- **On demand**, when the user invokes it directly (by name, or by asking a
  status/management question) — in that case do the fresh scan yourself
  first (step 0 below), then always show the report (step 2), regardless of
  whether anything changed.

**`<plugin root>` below** means this plugin's install directory: two levels
above this skill's own base directory (the "Base directory for this skill"
line you got when invoked, minus `/skills/check-skills`), or the root the
SessionStart hook named in its message. It is NOT a fixed path — a
skills-dir checkout and a marketplace install live in different places.

## Step 0 — manual scan (on-demand invocations only)

If you were invoked directly by the user rather than by the hook's injected
context, run the scan yourself before reporting:
```
bun <plugin root>/hooks-handlers/on-session-start.ts
```
Its stdout tells you what's new/gone, exactly like the automatic hook would.
Proceed to Step 1 if it reports anything, otherwise skip straight to Step 2.

## Step 1 — classify what the scan found

The scan covers three component kinds, and the hook tags each line with
its type: `[skill]` (a `SKILL.md`), `[command]` (a `commands/<name>.md` —
a slash command's prompt template), `[agent]` (an `agents/<name>.md` — a
subagent's system prompt). All three cost always-on tokens and all three
are gated into the same domain categories; record `type` on the entry
(`"command"` / `"agent"`; omit for skills). Classify a command or agent by
what it *does*, same as a skill — a command that scaffolds React
components is `design`, an agent that reviews a finished build is whatever
domain that build is in.

For each newly-found component:

1. `Read` it.
2. Pick the best-fitting category in `~/.claude/masterof/registry.json`
   (`design`, `dev`, `research`, `stock`, `planning`, `pipelines`, or a
   category you create — see below). A skill whose job is to run one
   complete multi-step workflow end-to-end, where the user picks *one*
   option rather than composing several supporting skills (a full design
   pipeline, a full GSD phase-execution mode, a whole image-to-code
   conversion) belongs in `pipelines`, not a domain category — see
   `pipelines`'s SKILL.md for the exact test and its single-select
   Activation Protocol variant.
3. Decide how to make it dormant:
   - **Raw skill** (folder directly under `~/.claude/skills/`): move it into
     `~/.claude/skills-library/<category>/`.
   - **Raw command / raw agent** (`~/.claude/commands/<name>.md`,
     `~/.claude/agents/<name>.md`): move the file into
     `~/.claude/skills-library/<category>/_commands/` or `_agents/`. The
     `_`-prefixed dirs keep them apart from skill folders in the same
     category.
   - **Agents that gated skills spawn — decide as a set, and ask.** A
     framework often ships N skills plus M agents those skills spawn by
     `subagent_type`. Gating the agents saves their always-on cost, but every
     spawn from a gated skill then costs a parent-side `Read` of the agent's
     file (~1-3k tokens each). For a small set that's fine; for a large,
     frequently-spawned set (10+ agents, several spawns per workflow run)
     it can cost more per session than it saves. Quantify both sides in one
     line (always-on saving vs. reads per typical run) and let the user
     pick: gate them, or file them in `always_on` with reason
     `spawn_cost`. Don't decide this one silently either way.
   - **Plugin-provided component** (skill, command or agent): don't move anything — plugin files are
     addressed in place. Run `claude plugin disable <plugin>@<marketplace>`
     instead. A single plugin can bundle skills that belong in *different*
     categories (e.g. `interfaces` bundles 10, all filed under `design`) —
     evaluate each bundled skill on its own merits, not the plugin as a unit.
     Disabling the plugin once covers all its skills either way.
4. **If it's a plugin skill, check what else the plugin ships** (`claude
   plugin details <name>`): MCP servers, agents. Disabling the plugin kills
   those too, and a skill that exists only to call the plugin's MCP server
   (21st-ui) becomes a no-op once gated. Record that as
   `requires: {plugin: "<id>", components: ["MCP 서버"], critical: true|false}`
   on the entry — `critical` when the skill can't do anything without it,
   otherwise `false` (body still useful, some sub-features off). The health
   check reads this field; nothing else knows a skill is hollow.
5. Append `{name, description, description_<lang>, path}` (plus `cluster` for
   `planning` entries — if GSD is installed, its own taxonomy is in
   `~/.claude/gsd-core/bin/lib/clusters.cjs` (strip the `gsd-` prefix to
   match); otherwise pick from the cluster names the planning gate lists, or
   default `"utility"`; plus `domain`
   for `pipelines` entries — which existing category's requests should also
   surface this pipeline as an alternative, see `pipelines` for how
   that's used) to the right array in `registry.json`. `<lang>` is whatever
   `~/.claude/masterof/config.json`'s `report_language` currently is
   (`"ko"` today, hence `description_ko`) — see "Report language" below for
   where that value comes from and what to do if it's ever missing. It's a
   concise one-line translation/summary of `description` in that language —
   the cached report (Step 2) is always rendered in it, so every entry needs
   one; write it yourself when classifying, don't leave it out.
6. **Or**, decide it should never be gated at all (see "Permanent exemptions"
   below) and append it to the `always_on` array instead (also with a
   `description_ko`) — same idea, a judgment call recorded as data, not a
   domain assignment.
7. If nothing fits, create a new category (named plainly after the domain,
   the same way `design`/`dev`/`research`/`stock`/`planning` are — no prefix):
   - Add the array to `registry.json`, plus a `category_meta.<name>` entry
     with `label_ko`/`desc_ko`, and a `preferences.json` entry
     (`{"mode": "always_ask"}`).
   - That's all that's needed: the renderer emits `gates/<name>.txt` for it
     and the root `master-of` skill routes to it (its description covers
     "a category with no gate of its own"). A dedicated `/master-of:<name>`
     gate would need a new `skills/<name>/SKILL.md` in the plugin source
     itself — don't write into the install directory (a marketplace update
     would wipe it); if the user wants one, that's a fork/PR of the plugin.
8. **Keep the gate's own description in sync.** A domain gate's frontmatter
   `description` is the only thing visible in the system prompt — if it
   doesn't name a newly-added member, the model has no reason to ever open
   that gate for a matching request. Update it when relevant.
9. Mention briefly what got filed where — no permission needed for routine
   classification (a few new skills). Ask only if a skill's category is
   genuinely ambiguous, or it looks like it needs a domain the user hasn't
   defined yet. **Exception — bulk changes (5+ at once, i.e. a first run):**
   classify them all, then show a one-line plan (what goes where, which
   plugins get disabled, which folders move) and get a yes BEFORE touching
   the filesystem or running `claude plugin disable`. Reorganizing someone's
   whole skill library in their first session without asking is not routine.

For paths that vanished (uninstalled/deleted): remove the matching
`registry.json` entries (domain categories AND `always_on`). If a category
empties out, leave the empty array and gate in place rather than deleting it
— something may get reinstalled there.

**Whenever `registry.json` or `preferences.json` changes for any reason**
(new classification, removal, a category added, a preference mode changed),
regenerate the cached renders before finishing:
```
bun <plugin root>/scripts/render-report.ts
```
That one command rebuilds BOTH `report.txt` (this skill's Step 2) and
`~/.claude/masterof/gates/*.txt` (the per-gate activation indexes every domain
gate reads). Skipping it doesn't just stale the report — it leaves the gates
pointing at an index that no longer matches the registry, so a newly
classified skill stays invisible to its own gate. registry.json is the source
of truth; both renders are derived, never hand-edited.

### Report language (`~/.claude/masterof/config.json`)

Every `description_<lang>` field and the entire rendered `report.txt` are in
Korean today — but that's not a hardcoded rule, it's a recorded decision.
`~/.claude/masterof/config.json` holds `report_language` (`"ko"`),
`report_language_name`, and `determined_from`: it says this was set from the
user's actual language preference in this Claude Code setup at the moment
the master-of database was first built, not an assumption baked into this
skill. If that file is ever missing (e.g. this is a fresh setup that hasn't
built its database yet), **that's the trigger to determine it now**: read
the user's evident language preference from the current session/output style
and write `config.json` before generating any `description_<lang>` fields —
don't default to Korean or English without checking. If the user's language
preference later changes, they'd update `config.json` themselves (or ask you
to) and `description_<lang>`/`report.txt` would need regenerating to match;
this skill doesn't watch for that on its own.

### Permanent exemptions (`registry.json`'s `always_on` array — data, not code)

Some things are never scanned/gated, for reasons stronger than "rarely used".
This is tracked as an array of `{name, type: "plugin"|"raw_skill", identifier,
path?, reason, description}` entries in `registry.json`'s `always_on` key —
the hook script reads it at scan time to build its ignore set, so adding or
removing an exemption is a JSON edit here, never a code change. Current
`reason` values in use:
- `hook_dependency` (`claude-mem`): disabling the plugin would kill its
  `SessionStart`/`PostToolUse`/`Stop` hooks (memory capture), not just hide
  its skills. Its 20 bundled skills stay always-on as a side effect.
- `output_style` (`fluent-korean`): not skill-shaped, nothing to gate.
- `near_zero_cost` (`perplexity`): MCP-only, measured always-on cost ~0 tok.
- `silent_opportunistic` (`gemini-lookup`): designed to fire without the user
  ever naming it (auto-delegate simple lookups to save tokens) — gating it
  behind a master-of gate call the user doesn't know exists defeats its purpose.
- `spawn_cost` (an agent set): agents that gated skills spawn so often that
  reading each one's file per spawn would cost more than keeping them
  always-on. Recorded per agent as `{type: "raw_agent", identifier:
  "<name>", reason: "spawn_cost"}` (or `raw_command` for a command kept for
  the same reason), after the user chose it — see Step 1.

When classifying a newly-found skill/plugin, ask whether it fits one of these
same *characteristics* (not just whether it happens to resemble one of the
four current examples) — a hook-dependent plugin, an output-style/near-zero
plugin, or a silently-opportunistic skill all belong in `always_on` with the
matching `reason`, whatever their name is.

## Step 2 — report (always runs when invoked directly; read-only, cheap)

Don't read `registry.json` or reconstruct anything here. This skill shows
the **brief** report only — `~/.claude/masterof/report-brief.txt` (~1/5 the
size of the full one): per-gate counts, what's currently broken, preference
modes, token savings. Reprinting every gated skill by default was the single
biggest output cost in the system, so the full list lives in the sibling
skill `check-skills-all`; if the user asked for the whole list ("전체
보여줘", "다 보여줘"), point them there or just follow that skill instead.
One exception: if they asked about ONE category ("design에 뭐 있어"), show
just that category's section from `report.txt` — that's a targeted lookup,
not the full dump.

Then:

1. `Read` the chosen file and show it to the user **verbatim,
   as plain Markdown in your reply — NOT inside a ``` code fence**. The file
   is already proper Markdown (headings + a numbered list, alphabetically
   sorted by name within each group), not multi-line bullets and not
   tables — earlier versions tried both (multi-line bullets read fine but
   run long; a table renders each entry cramped onto one line) before
   settling on `N. **name** | description` per entry, one line each: a
   category heading, one line of plain-text description below it, then the
   numbered entries. The separator is a literal `|`; padded/tabbed spacing
   was tried first and dropped, since runs of whitespace collapse outside a
   code fence and can't column-align the descriptions anyway (only a real
   Markdown table can, at the cost of cramping each row). The token-savings
   footer IS deliberately inside a code fence — it's laid out as a
   subtraction and needs the monospace column alignment. Don't reflow any of
   it into anything else — paste it as-is.
2. A category whose `category_meta` entry has a `bundle` field (currently
   just `planning`, i.e. GSD's 65 skills) does NOT get its own category
   section at all. Every such bundle is instead summarized as one line under
   a single `## 멀티 스킬 플러그인` section — "installed, already sorted into
   the `<gate>` gate" — see "Large bundled plugins" below for why. That's
   expected, not a truncation bug: the full per-skill classification still
   exists in `registry.json` and in `gates/planning.txt`, so the gate itself
   still activates individual gsd-* skills normally; it's only the status
   report that doesn't expand it.
3. That's it otherwise. The file already contains every category (Korean
   labels + descriptions), the `always_on` section, the current preference
   mode per category, AND the token-savings estimate — all pre-rendered by
   `scripts/render-report.ts` at classification time. This is the entire
   point of caching it: Step 2 costs one file read, never a JSON-to-prose
   formatting pass.
4. **Paste the chosen file whole, top to bottom.** Don't drop the trailing
   sections (preference modes, token savings) because the lists already feel
   like "enough" — the point of caching is that showing all of it is free.
5. **The `## 점검` section is the one part that asks something of you.** It
   lists what is broken right now (a dead MCP binary, a gated skill whose
   plugin is off so it can't work) and the command that would fix each. Relay
   it as-is and **do not run the fix yourself**: plugin on/off and MCP config
   only take effect at the next session start, so flipping something silently
   would leave the user with a config that claims to work and a session where
   it doesn't. The user decides; if they say go, run the command and tell them
   to restart. The same `critical` items also surface at every session start
   via the hook until fixed — the user can silence one by adding its subject
   (e.g. `"MCP gbrain"`) to `state.json`'s `dismissed` list.

### Large bundled plugins (`category_meta.<category>.bundle`)

Some plugins bundle far more skills than a typical category (GSD's ~65 is
the current example). Every one of those skills is still individually
classified in `registry.json` (name, description, cluster, etc.) — that
detail is what Step 1 actually uses to decide which skill to activate for a
request. But expanding all of it in the report just to say "yes, this is
classified" isn't useful to the user; what they need to know is only that
the bundle *is* already sorted into the right category. When a category's
role is effectively "this whole category is one bundled plugin," set
`category_meta.<cat>.bundle = {plugin_name, desc_ko}` in `registry.json` and
`render-report.ts` collapses that category's list to a single summary line
instead of enumerating every member. Do this when classifying a new
large-volume plugin that has the same shape (dozens+ of skills, all filed
into one category) — not for every category, and not for `pipelines` entries
even if they happen to come from the same plugin, since each pipeline is a
distinct end-to-end choice the user picks between, not internal detail to
hide.

If `report.txt` is missing or looks stale relative to `registry.json` (e.g.
you just classified something in Step 1 and haven't regenerated it yet), run
`bun <plugin root>/scripts/render-report.ts` first, then Read
and show it.

If the user asks about something that isn't in `registry.json` at all
(including Claude Code's own built-in skills, which aren't files under
`~/.claude/skills/` and were never part of this system), say so plainly
rather than guessing where it might belong — that's not something
`report.txt` will ever contain.
