---
name: master-of
description: "Cross-domain entry point for the master-of skill-gate system: use this when a request needs dormant skills from SEVERAL domains at once (e.g. scrape a competitor AND critique its design, review a UI AND its copy) and you'd otherwise have to invoke /design, /research, /dev, /stock, /planning, /pipelines one at a time. Also the entry point for any category that has no gate of its own (one added later via check-skills). Matches across every category and activates the 1-4 skills that fit, from however many domains. For a request that clearly sits in one of the six built-in domains, invoke that single gate instead; for management/status (scanning, classifying, reporting), invoke 'check-skills'."
allowed-tools: Read
---

# master-of — overview

This plugin bundles:
- **Domain gates**: `design` / `dev` / `research` /
  `stock` / `planning` — on-demand activation for a dormant
  skill in that domain. Each is a thin pointer to the Activation Protocol
  below.
- **`check-skills`** — the system's own manager. It scans for
  new/removed skills and plugins (automatically via the `SessionStart` hook,
  or on demand), classifies new finds into the right gate (or a new one),
  and reports the current full breakdown read-only. See
  `./skills/check-skills/SKILL.md` for everything about how that works —
  this file doesn't duplicate it.

## Activation protocol (shared by every domain gate)

Every domain gate (`design`/`dev`/`research`/`stock`/`planning`) delegates its
actual behavior here instead of repeating it — each gate's own SKILL.md is
just a pointer to this section plus its category key and any
category-specific notes.

**When to open a gate at all.** Two ways in, both fine: the user invokes it
(`/design …`), or you open it yourself because the user asked for actual
*work* that clearly belongs to that domain ("이 화면 다듬어줘", "경쟁사
스크래핑해줘"). Don't open one for a question, an explanation, or chat that
merely mentions the topic — opening costs tokens (100-2,800 per gate), so it
has to be a task you're about to do. When in doubt, ask in one line rather
than opening. Once a gate is open:

1. Read `~/.claude/masterof/gates/<category>.txt` — the pre-rendered index for
   that one gate (`name | 설명 | Read할 경로`, one line per entry).
   **Never `Read` `~/.claude/masterof/registry.json` to activate a gate.**
   `Read` pulls the whole file, and registry.json is ~60KB / ~16k tokens —
   more than 2.5x the entire per-session saving this system buys, spent on a
   single activation. The gate files carry the same name/description/path the
   protocol needs, at 100-2,500 tokens each. registry.json is the source of
   truth for *classification* (`check-skills` writes it); the `gates/`
   files are the read path for *activation*, regenerated from it by
   `scripts/render-report.ts` on every change.
2. **Also glance at scale — the related pipelines are already in the file.**
   Judge whether the request is a narrow, specific task (→ stay with the
   domain entries) or something project-/workflow-scale ("전체 다 해줘",
   "처음부터 끝까지", a whole new design direction, a whole phase cycle) that a
   complete pipeline would handle better. Each gate file ends with a
   `## 관련 파이프라인` section listing exactly the pipelines whose `domain`
   is this category, so this costs no extra read. Don't treat `design` and
   `pipelines` as separate lanes the user has to know to pick between; a
   design-shaped request should surface a fitting pipeline (e.g. `paint`) as
   naturally as it surfaces a supporting skill (e.g. `better-ui`), when the
   scale calls for it. If both a narrow skill and a pipeline plausibly fit,
   say so and let the user choose which scale they want, rather than guessing.
3. **Try to match first — don't show anything yet.** Compare what the user
   actually asked for (the message that triggered this skill, or the task at
   hand) against each entry's `description`.
   - One confident match → say so directly ("이 작업엔 `<name>`을 쓸게요") and
     `Read` its `path`. No list, no round-trip.
   - A small confident cluster (2-4 entries that clearly belong together for
     this one task) → name them directly the same way and proceed.
   - **Genuinely ambiguous** (several entries plausibly fit and none clearly
     wins) → check `~/.claude/masterof/preferences.json` for this category
     before asking:
     - `{"mode": "always_ask"}` → print the full list (grouped by `cluster`
       for `planning`, flat for the others) and ask, offering
       `전체`/`all`, numbers, names, or (for `planning`) a cluster name.
     - `{"mode": "fixed_default", "default": "<name>"}` → use that entry
       without asking, but say which one and that it's the saved default (so
       the user can override in the moment if it's wrong for this task).
     - `{"mode": "conditional", "rules": [{"when": "<condition, in plain
       language>", "use": "<name>"}, ...], "fallback": "always_ask" |
       "<name>"}` → check each rule's `when` against the task in order (plain
       judgment, not string matching); use the first match's `use`; if none
       match, fall back to `fallback` (either ask, or another fixed default).
     - `{"mode": "smart"}` → judge from context yourself and ask only when
       truly tied.
   - If the user explicitly asks something like "뭐 있어" / "다 보여줘" / "전체
     목록", always show the full list regardless of preference mode — that's
     an explicit request to see everything, not an ambiguous match.
4. `Read` only what got selected — never the whole category "just in case."
   Bulk-reading every entry in a category on every invocation is exactly the
   always-on cost this system exists to avoid; a gate that does that is a bug,
   not a feature.
   **Carry the base directory with it.** A gated skill is activated by
   `Read`ing its `SKILL.md` directly, which — unlike a real `Skill` invocation
   — supplies no "Base directory for this skill" line. Many of these skills
   ship companion files and refer to them relatively (`RECIPES.md`,
   `STANDARDS.md`, `reference/`, `scripts/…`); with no anchor those references
   are dead ends. So treat the directory containing the `SKILL.md` you just
   read (the path in the gate index, minus the filename) as that skill's base
   directory, and resolve every relative path in its body against it. State it
   once when you activate ("base: `…/skills-library/design/animate/`") so it's
   explicit rather than re-derived each time you follow a reference.
   **Reading a skill is not the same as invoking it — three things the
   `Skill` tool would have done for you that you now do yourself:**
   - `$ARGUMENTS` is not substituted. Many skills (every GSD skill, for
     one) say things like "Phase number: $ARGUMENTS". Treat whatever the
     user gave after the skill's name — or the specific thing they asked for
     — as that value, and if the skill needs an argument the user didn't
     supply, ask for it the way the skill itself says to (most say what to
     do when it's omitted).
   - `allowed-tools` in the frontmatter doesn't pre-approve anything. The
     skill will work; you may just get permission prompts it wouldn't
     normally trigger. Don't read that as the skill being broken.
   - `disable-model-invocation: true` in the frontmatter means the author
     wants it run only when the user explicitly asks for it BY NAME — never
     on your own judgment. Opening a gate yourself (the auto-open rule) does
     not lift that: if the best match carries this flag and the user didn't
     name it, mention it as an option and let them choose; don't activate it.
   **Honor `[의존: …]` notes.** An index line can carry
   `[의존: <plugin> <component> — 현재 꺼짐, 없으면 동작 불가]`. That means the
   skill's plugin is disabled, so the MCP server / agents it needs don't
   exist this session. If it says 없으면 동작 불가, don't activate it — tell
   the user it can't work right now and what would fix it (`claude plugin
   enable <plugin>`, effective next session), and offer the closest working
   alternative instead. Without that suffix (a partial), activate but say
   which parts won't run. The status is as of the last render; the session-
   start hook is the fresh source and will already have said so if it's off.
5. **A match is a candidate, not an obligation.** The index answers "what
   exists in this domain", which is not the same question as "does this task
   actually need it". If the best match is only topically adjacent — it shares
   the subject but not the job (a "how to build X" guide when the task is
   "decide whether to build X"; a reviewer skill when the task is to gather
   facts) — say so and skip the Read instead of activating it for form's sake.
   Reading a 2-3k token skill that doesn't change what you do costs more than
   the gate ever saved.
6. Briefly confirm what's active, then proceed with the actual task.

Scope: one-shot, in-context only. Nothing persists, nothing is written to
settings. Re-invoke the gate for the next unrelated task in that domain.

### Multi-activation — several skills, and several domains, at once

Activation is **not** limited to one skill. A real request often needs two or
three things working together ("이 화면 리뷰하고 접근성까지 봐줘", "경쟁사
스크래핑해서 그 디자인 분석해줘"), and forcing the user to invoke gates one at a
time, serially, is the single most annoying way this system can behave.

**Within one domain** — step 3 already covers it: a confident cluster of 2-4
entries is named and read together, not one at a time.

**Across domains** — same idea, one level up:

- If you can name the domains from the request (usually you can — "스크래핑"
  → `research`, "디자인 분석" → `design`), read just those gate files. Two
  gate files is typically 1-2k tokens total, far cheaper than the combined
  index.
- Only when the domain set is genuinely unclear, read
  `~/.claude/masterof/gates/_all.txt` — every category in one file (~6k
  tokens). It's the cross-domain fallback, not the default.
- Then match within the combined set and activate what fits, naming each one
  and which domain it came from ("`firecrawl-scrape`(research) + `better-ui`
  (design) 두 개 붙일게요"). Read only those.
- **Cap it at ~4 skills.** Beyond that the activations start crowding out the
  actual task, and it's a sign the request should be split — or that a single
  `pipelines` entry is the right answer instead of five supporting skills.
- The `pipelines` single-select rule still holds across domains: at most ONE
  pipeline, and a pipeline generally shouldn't be combined with supporting
  skills from other domains — it already runs its own end-to-end workflow.

Invoking the root `master-of` skill directly (`/master-of <요청>`) is the
explicit cross-domain entry point: it runs exactly this step — match across
every category first, then activate the 1-4 skills that fit, from however
many domains they happen to live in.

### Staying activated across a continued task

Don't re-run the full matching step from scratch on every single message.
When a new user request comes in while something is already active from this
domain:
- **Same or clearly continuing task** → keep using what's already active, no
  re-invocation needed. Do a quick silent check whether a different entry in
  the category would now fit better (the task may have shifted); if so,
  mention it as a one-line suggestion rather than silently switching.
- **A new, different task in the same domain** → re-run the matching step
  fresh (steps 1-4 above); it may land on the same skill or a different one.
- **Unrelated to this domain entirely** → treat the previous activation as
  no longer relevant. Don't carry design-gate guidance into an unrelated
  research question just because it was active earlier in the session.

There's no counter or timeout enforcing this — it's a judgment call made
fresh each turn, the same way you'd judge whether any other piece of earlier
context is still relevant. A hard "N turns unused → off" rule isn't something
a hook can enforce anyway: once a skill's content is in the transcript, no
script can make the model stop referencing it. Task-continuity judgment is
the only lever that actually works.

### Per-category ambiguity preference (`~/.claude/masterof/preferences.json`)

Implemented — see step 3 above for how each mode is consulted. All six
categories default to `{"mode": "always_ask"}` (unchanged behavior) until the
user asks to change one. To change a preference: edit that category's entry
in `preferences.json` directly (no schema migration needed, it's just a flat
per-category object) and confirm the change back to the user in plain terms.

For everything about scanning, classifying new skills, permanent exemptions,
or generating the status report, see `check-skills`
(`./skills/check-skills/SKILL.md`) — that skill owns all of it now. For
whole-pipeline skills where the user must pick exactly one workflow rather
than combine several, see `pipelines`
(`./skills/pipelines/SKILL.md`) — its Activation Protocol variant is
single-select, not multi-select.
