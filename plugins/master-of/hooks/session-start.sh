#!/bin/sh
# master-of SessionStart bootstrap (v2 - Self-contained Plug-and-Play)
#
# Finds the mo engine and delegates to \`mo session-start\`. Silent when nothing
# changed; emits additionalContext only when new skills or issues are detected.
#
# Resolution order:
#   1. $MASTER_OF_BIN  — custom override
#   2. ${CLAUDE_PLUGIN_ROOT}/bin/mo.mjs — bundled standalone engine (runs on Node.js)
#   3. ~/.master-of/mo — standard wrapper
#   4. Global \`mo\` on PATH

if [ -n "${MASTER_OF_BIN:-}" ]; then
  exec "$MASTER_OF_BIN" session-start
fi

if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "${CLAUDE_PLUGIN_ROOT}/bin/mo.mjs" ]; then
  exec node "${CLAUDE_PLUGIN_ROOT}/bin/mo.mjs" session-start
fi

if [ -x "${HOME}/.master-of/mo" ]; then
  exec "${HOME}/.master-of/mo" session-start
fi

if command -v mo >/dev/null 2>&1; then
  exec mo session-start
fi

# Fallback: inform user Node.js is required
printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"master-of: mo CLI를 실행할 수 없습니다 (Node.js 환경 확인 필요)."}}'

