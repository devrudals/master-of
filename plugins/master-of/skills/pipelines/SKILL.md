---
name: "pipelines"
description: "Gate for whole-pipeline skills that run an entire workflow end-to-end (examples from this author's setup: paint/genjutsu, impeccable, image-to-code, gsd-autonomous, gsd-quick…; classify your own via check-skills). Open it yourself only for end-to-end requests ('처음부터 끝까지', '전체 다 해줘'); a narrow task belongs in its domain gate. Single-select: the user picks exactly ONE pipeline."
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
