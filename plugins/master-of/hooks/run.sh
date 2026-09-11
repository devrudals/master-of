#!/bin/sh
# Runtime shim for every script in this plugin. Everything is TypeScript
# without a build step, so it needs a runtime that strips types: bun, or
# node >= 22.6 (--experimental-strip-types; 23.6+ does it by default).
#
# The point of this file is the last branch. A hook whose command isn't
# found fails SILENTLY as far as the model is concerned -- no scan, no
# gating, no error anyone reads. If there's no usable runtime, this emits
# the failure as SessionStart context instead, so the model tells the user
# once and the plugin isn't just a dead install.
#
# Usage: run.sh <path relative to plugin root> [args...]
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/$1"
shift

if command -v bun >/dev/null 2>&1; then
  exec bun "$SCRIPT" "$@"
fi

if command -v node >/dev/null 2>&1; then
  V="$(node -p 'process.versions.node' 2>/dev/null)"
  MAJOR="${V%%.*}"; REST="${V#*.}"; MINOR="${REST%%.*}"
  if [ "$MAJOR" -ge 23 ] 2>/dev/null || { [ "$MAJOR" -eq 22 ] && [ "$MINOR" -ge 6 ]; } 2>/dev/null; then
    exec node --experimental-strip-types --no-warnings "$SCRIPT" "$@"
  fi
fi

printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"master-of: no JavaScript runtime found (this plugin needs bun, or node >= 22.6). Nothing is being scanned or gated until one is installed. Tell the user once, in one line: install bun (https://bun.sh) or Node 22.6+, then restart Claude Code."}}'
