#!/bin/bash
# PostToolUse(Edit|Write|MultiEdit): record — cheaply, with no Node spawn and no
# external deps — that code changed since the last verification. Never blocks.
# The actual diff is computed from git at Stop time; here we only set a flag.
set +e
cat >/dev/null 2>&1   # drain stdin so Claude Code's writer never hits a broken pipe

[ -n "${VOUCH_DISABLE:-}" ] && exit 0

PROJ="${CLAUDE_PROJECT_DIR:-$PWD}"
# Only track when Vouch is actually set up for this repo.
[ -f "$PROJ/.vouch/config.json" ] || exit 0

mkdir -p "$PROJ/.vouch/runs" 2>/dev/null
date +%s >> "$PROJ/.vouch/runs/dirty" 2>/dev/null
exit 0
