---
name: stock
description: "On-demand gate for Korean stock/company-analysis skills (company-decoder-korean, company-story-korean, price-decoder-korean). Open this gate yourself when the user asks for actual WORK that clearly belongs to this domain ("이 화면 다듬어줘", "애니메이션 개선해줘") — you no longer need them to type /stock first. Do NOT open it for questions, explanations, or chat that merely mention the topic; opening costs tokens, so it must be a task you're about to do."
allowed-tools: Read, Bash
---

# stock

Follow the **Activation protocol** in `../../SKILL.md` (the parent
`master-of` skill), reading this gate's pre-rendered index at
`~/.claude/masterof/gates/stock.txt` (NOT registry.json — that file is ~16k
tokens to Read; this one is a fraction of that and carries the same
name/description/path, plus this domain's related pipelines inline).
