---
name: planning
description: "Gate for project-management/planning skills (this author's registry files GSD's gsd-* skills here — planning, execution, review, milestones; classify your own planning tools here via check-skills). Open it yourself for clear WORK requests in this domain, not for questions or passing mentions — opening costs tokens."
allowed-tools: Read, Bash
---

# planning

Follow the **Activation protocol** in `../../SKILL.md` (the parent
`master-of` skill), reading this gate's pre-rendered index at
`~/.claude/masterof/gates/planning.txt` (NOT registry.json — that file is
~16k tokens to Read). The index is already grouped by cluster. Each entry
carries a `cluster` tag
(`core_loop`, `audit_review`, `milestone`, `research_ideate`,
`workspace_state`, `docs`, `ui`, `ai_eval`, `ns_meta`, `utility` — GSD's own
taxonomy) — when the fallback full-list step triggers, group by `cluster`
instead of printing 71 flat lines, and accept a cluster name as a valid
"activate all of these" selection alongside numbers/names/전체.

**gsd-surface note**: GSD ships its own gating tool (`gsd-surface`,
core/standard/full profiles). It's superseded here — `gsd-surface` is just
entry `gsd-surface` in the `planning` list, reachable like anything else if
specifically wanted. Don't resurrect the old profile system.

**GSD updater note**: a future `gsd-update` may recreate `gsd-*` folders
under `~/.claude/skills/` directly. That's self-healing — the
`master-of` SessionStart hook will flag them as "new" next session, and
the fix is just moving them back into
`~/.claude/skills-library/planning/` and reconfirming their registry entries.
