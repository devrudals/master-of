# master-of Session Start & Skill Gatekeeper Rule

When starting a conversation turn or when asked about skills, token usage, or status:
1. If unparked raw skills exist (causing heavy Always-on token consumption, e.g. 176 skills consuming 30,000+ tokens) or if unclassified components exist:
   - Proactively inform the user about the wasted tokens.
   - Propose to batch-park them into their recommended domain gates using `mo park --all` to save 85%+ tokens immediately.
   - In Antigravity, use `ask_question` tool to ask the user.
   - When approved by the user, execute `~/.master-of/mo park --all` and update the gate status.
