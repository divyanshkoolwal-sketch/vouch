---
description: Pause or resume Vouch's automatic verification for this repo (kill switch).
---

Toggle Vouch's automatic verification.

1. Call `get_status` (from the `vouch` MCP server) to see whether it is currently active or paused.
2. If it is active, call `set_enabled` with `enabled: false` to PAUSE it (the Stop hook will do nothing until resumed).
3. If it is already paused, call `set_enabled` with `enabled: true` to RESUME it.
4. Tell the user the new state plainly.

Use this when verification is getting in the way (e.g. intentional work-in-progress commits). Manual `/vouch:verify` still works while paused.
