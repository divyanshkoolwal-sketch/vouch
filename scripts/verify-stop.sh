#!/bin/bash
# Stop hook (Claude Code AND Codex — identical contract). Hands the hook payload
# to the Vouch brain, which decides whether to block (with a fix-prompt) or allow
# the stop. Tool-agnostic: resolves the CLI from its own location and the project
# dir from whichever env the host sets. ALWAYS exits 0; prints only the JSON the
# brain emits (nothing → "allow stop").
set +e
INPUT=$(cat 2>/dev/null)

# Kill switch / recursion guard (also set when the reviewer spawns a host CLI).
[ -n "${VOUCH_DISABLE:-}" ] && exit 0

PROJ="${VOUCH_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-${CODEX_PROJECT_DIR:-$PWD}}}"
[ -f "$PROJ/.vouch/config.json" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
CLI="$SELF_DIR/../dist/cli.js"
[ -f "$CLI" ] || CLI="${CLAUDE_PLUGIN_ROOT:-}/dist/cli.js"
[ -f "$CLI" ] || exit 0

printf '%s' "$INPUT" | VOUCH_PROJECT_DIR="$PROJ" node "$CLI" stop-hook 2>/dev/null || true
exit 0
