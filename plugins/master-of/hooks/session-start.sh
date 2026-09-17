#!/bin/sh
# master-of SessionStart bootstrap (v2)
#
# Finds the mo CLI and delegates to `mo session-start`. Silent when nothing
# changed; emits additionalContext only when new skills or issues are detected.
#
# Resolution order:
#   1. $MASTER_OF_BIN  — set this if you keep bin/mo.ts in a custom location
#   2. ~/.master-of/mo — wrapper written by `claude-setup` (standard path)
#   3. Neither found   — tell the user to run /check-skills for setup help

MO="${MASTER_OF_BIN:-}"

if [ -z "$MO" ] && [ -x "${HOME}/.master-of/mo" ]; then
  MO="${HOME}/.master-of/mo"
fi

if [ -n "$MO" ]; then
  exec "$MO" session-start
fi

# Neither path found: guide the user through first-time setup.
printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"master-of: mo CLI를 찾을 수 없습니다 (초기 설정 필요). /check-skills 스킬을 실행하면 셋업 안내가 나옵니다. EN: master-of needs one-time setup. Run /check-skills for instructions."}}'
