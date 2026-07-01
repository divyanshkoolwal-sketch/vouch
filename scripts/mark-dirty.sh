#!/bin/bash
# PostToolUse / afterFileEdit hook (all hosts): record — cheaply, no Node spawn,
# no deps — that code changed since the last verification. Never blocks.
set +e
cat >/dev/null 2>&1   # drain stdin so the host's writer never hits a broken pipe

[ -n "${VOUCH_DISABLE:-}" ] && exit 0

PROJ="${VOUCH_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-${CODEX_PROJECT_DIR:-$PWD}}}"
[ -f "$PROJ/.vouch/config.json" ] || exit 0

mkdir -p "$PROJ/.vouch/runs" 2>/dev/null
date +%s >> "$PROJ/.vouch/runs/dirty" 2>/dev/null
exit 0
