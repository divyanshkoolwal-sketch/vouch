#!/bin/bash
# SessionStart: print a short context block (active intent + conventions, or a
# one-line setup nudge if Vouch isn't configured yet). stdout text from a
# SessionStart hook is injected into the agent's context.
set +e
cat >/dev/null 2>&1   # drain stdin

[ -n "${VOUCH_DISABLE:-}" ] && exit 0

PROJ="${CLAUDE_PROJECT_DIR:-$PWD}"
command -v node >/dev/null 2>&1 || exit 0
[ -f "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" ] || exit 0

VOUCH_PROJECT_DIR="$PROJ" node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" session-context 2>/dev/null || true
exit 0
