---
name: "pipelines"
description: "On-demand gate for whole-pipeline skills — each one runs an entire multi-step workflow end-to-end rather than supporting a task (examples from this author's own setup: paint/genjutsu, impeccable, image-to-code, gsd-autonomous, gsd-quick, gsd-fast, gsd-mvp-phase, gsd-ultraplan-phase, gsd-audit-fix — classify your own via check-skills). Open this gate yourself only when the user asks for a whole end-to-end workflow ("처음부터 끝까지", "전체 다 해줘") in one of those domains — a narrow task belongs in its domain gate instead. Unlike the domain gates this is single-select: the user picks exactly ONE pipeline to run, not several to combine."
allowed-tools: Read, Bash
---

# pipelines

Reads `~/.claude/masterof/gates/pipelines.txt` (the pre-rendered index for
this gate — NOT registry.json, which is ~16k tokens to Read). Uses
the same lookup mechanics as the Activation Protocol in `../../SKILL.md`
(read registry, try to match the request first), with one structural
difference:

## Single-select, not multi-select

Every entry here is a complete, self-contained workflow (a full design
pipeline, a full GSD phase-execution mode, an image-to-code conversion) — the
kind of thing where running two at once doesn't compose, it conflicts. So:

1. Read the `"pipelines"` array.
2. Try to match the user's request to exactly one entry first — if confident,
   say so directly ("이 작업엔 `<name>` 파이프라인을 쓸게요") and `Read` its
   `path`. No list.
3. If more than one pipeline plausibly fits (e.g. both `gsd-quick` and
   `gsd-mvp-phase` could handle a small feature), or the user asks what's
   available: print the list and ask the user to pick **one**. Never
   activate two pipelines for the same request — if the task genuinely needs
   more than one, that's a sign it should be broken into separate requests,
   not run as two pipelines at once.
4. `Read` only the chosen entry's `path`, confirm, then proceed.

Scope: one-shot, in-context only, same as every other gate.

## Adding to the roster

`check-skills` routes new pipeline-shaped skills here — see its Step 1
for the "does this run one complete pipeline end-to-end, or does it support a
task" test used to decide `pipelines` vs a domain category. Append
`{name, description, path}` to `"pipelines"` in `registry.json`.
