#!/bin/bash
# Stop hook: hand the hook payload to the Vouch "brain" (dist/cli.js stop-hook),
# which decides whether to block (with a fix-prompt) or allow the stop.
# This wrapper is intentionally dumb: all logic lives in the shared core.
# It ALWAYS exits 0 and only ever emits the JSON the brain prints — on any
# failure it prints nothing (which Claude Code reads as "allow stop").
set +e
INPUT=$(cat 2>/dev/null)

# Kill switch / recursion guard: when set we never run (e.g. inside the headless
# reviewer child, or when the user ran /vouch-off).
[ -n "${VOUCH_DISABLE:-}" ] && exit 0

PROJ="${CLAUDE_PROJECT_DIR:-$PWD}"
[ -f "$PROJ/.vouch/config.json" ] || exit 0

command -v node >/dev/null 2>&1 || exit 0
[ -f "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" ] || exit 0

printf '%s' "$INPUT" | VOUCH_PROJECT_DIR="$PROJ" node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" stop-hook 2>/dev/null || true
exit 0
