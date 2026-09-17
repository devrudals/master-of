---
name: "check-skills-all"
description: "Full inventory of the master-of skill-gate system — every gated component by domain, plus what is broken and token savings. Invoke when the user asks for the whole list ('전체 보여줘', '다 보여줘', '전체 목록'); for a quick status use check-skills."
allowed-tools: Read, Bash
---

# check-skills-all

The engine is the `mo` CLI at `~/.master-of/mo`.

1. Refresh the index:
   ```bash
   ~/.master-of/mo sync && ~/.master-of/mo claude-sync
   ```
   (Silent — this just refreshes gate files on disk. Do not print its output.)

2. Show the full inventory, broken down by gate:
   ```bash
   ~/.master-of/mo full
   ```
   Show its output as-is. It lists every gated component grouped by gate,
   plus always-on items and the token savings estimate.

If the user asks about one specific gate only, use:
```bash
~/.master-of/mo gate <name>   # e.g. mo gate design
```
That's cheaper than `mo full` and exactly what they need.
