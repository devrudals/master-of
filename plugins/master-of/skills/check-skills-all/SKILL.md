---
name: "check-skills-all"
description: "Full inventory of the master-of skill-gate system — every gated skill by domain (all ~129), plus what is broken, preference modes, and token savings. Same scan/classify pass as check-skills, but shows the complete list instead of the brief summary. Invoke when the user asks for the whole list ('전체 보여줘', '다 보여줘', '전체 목록'); for a quick status or a single category, check-skills is cheaper."
allowed-tools: Read, Edit, Write, Bash
---

# check-skills-all (full)

Identical to `check-skills` (`../check-skills/SKILL.md`) in every respect —
Step 0 manual scan, Step 1 classification, the health section, the
never-auto-fix rule — with exactly one difference in Step 2:

**Read `~/.claude/masterof/report.txt` (the full report) instead of
`report-brief.txt`**, and paste it whole, top to bottom, as plain Markdown
(not in a code fence). Every category's numbered list, the 멀티 스킬
플러그인 section, always-on, preferences, and the token-savings footer.

Follow `../check-skills/SKILL.md` for everything else; this file exists only
so the full list is one command away (`/master-of:check-skills-all`) without
making it the default cost of every status question.
