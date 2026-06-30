---
description: Set up Vouch for this repo — auto-detect how to run its checks (tests/lint/build/typecheck) and confirm in one step.
---

Set up Vouch for the current repository. Keep this to a single confirmation — do not interrogate the user.

1. Call the `get_setup_suggestion` tool from the `vouch` MCP server to auto-detect the project's check commands.
2. Show the user the detected commands in a short, readable form (test / lint / build / typecheck). If something is missing or wrong, propose a sensible value.
3. Ask the user ONE concise question: "Use these commands for verification? (edit any you want to change)". Accept their edits.
4. Call the `configure` tool with the final `commands` and, if relevant, `tiers`. Defaults are good: deterministic checks block; lint and the intent review are advisory. Do not enable the `web`/`smoke` tier unless the user asks.
5. Confirm setup succeeded and remind the user that verification now runs automatically when you finish a change, and that `/vouch:intent` captures what a change should accomplish.

Never store secrets in the config — reference environment variable names only; values stay in the environment.
