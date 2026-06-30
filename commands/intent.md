---
description: Capture/confirm what the current change should accomplish (a short plain-language intent), so Vouch can verify against it.
argument-hint: "[optional: what you're about to build]"
---

Confirm intent for the work the user is about to do (or just described): $ARGUMENTS

Use the `understand-intent` skill's approach: a SHORT plain-language exchange, not a spec document.

1. In 1–3 sentences, state back what you understand the user wants.
2. List 2–5 concrete acceptance criteria (checkable statements that must be true when it's done). Note any explicit non-goals.
3. Ask the user to confirm or correct — one round, briefly.
4. Once confirmed, call the `record_intent` tool from the `vouch` MCP server with the `summary`, `acceptance_criteria`, and any `non_goals`.

Keep it lightweight. If the user's request is already crystal clear and small, propose the intent in one pass and just confirm.
