---
description: Run Vouch verification now (deterministic checks + independent intent review) and report prioritized findings.
---

Run verification on the current change immediately.

Call the `verify` tool from the `vouch` MCP server (pass `force: true` if there is no pending diff but the user still wants a run). Then:

- Present the result concisely: what passed, any blocking failures (with how to reproduce), and any non-blocking questions.
- If there are blocking failures, fix them, then verify again.
- If a finding is genuinely a non-issue, call `dismiss_finding` with its vouch id and a one-line reason so Vouch stops raising it.

Do not re-run the project's checks manually first — the `verify` tool already runs them.
