#!/bin/bash
# SessionStart hook (Claude Code AND Codex). Prints a short context block (active
# intent + conventions, or a setup nudge). Tool-agnostic CLI/project resolution.
set +e
cat >/dev/null 2>&1   # drain stdin

[ -n "${VOUCH_DISABLE:-}" ] && exit 0

PROJ="${VOUCH_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-${CODEX_PROJECT_DIR:-$PWD}}}"
command -v node >/dev/null 2>&1 || exit 0

SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
CLI="$SELF_DIR/../dist/cli.js"
[ -f "$CLI" ] || CLI="${CLAUDE_PLUGIN_ROOT:-}/dist/cli.js"
[ -f "$CLI" ] || exit 0

VOUCH_PROJECT_DIR="$PROJ" node "$CLI" session-context 2>/dev/null || true
exit 0
