---
name: understand-intent
description: Confirm what a coding change should actually accomplish via a short plain-language exchange (not a spec doc), then record it so Vouch can verify against it. Use at the start of a non-trivial feature/fix, when the user's request is ambiguous, or when they ask to capture intent.
---

# Understand intent (lightweight)

Goal: make sure you and the user agree on what success looks like *before* writing code, and record it so Vouch's independent reviewer can later check the change against it. This is the cheap insurance against "the agent confidently built the wrong thing."

Keep it short. This is a 30-second confirmation, not a requirements document.

## When to use
- The user is starting a non-trivial feature or fix.
- The request is ambiguous or could be interpreted multiple ways.
- The user explicitly runs `/vouch:intent` or asks to capture intent.

Skip it for trivial, unambiguous edits (typo, rename, one-liner) — forcing intent there is just noise.

## How to do it
1. **Restate** in 1–3 plain sentences what you believe the user wants. Lead with the outcome, not the implementation.
2. **Propose acceptance criteria** — 2–5 concrete, checkable statements that must be true when it's done. Good criteria are observable ("uploading a >10MB file shows an error toast and is rejected"), not vague ("handle big files well").
3. **Name non-goals** if there's an obvious scope boundary worth stating (so they aren't later flagged as missing).
4. **Confirm in one round.** Ask the user to correct anything. Don't loop more than necessary.
5. **Record it:** call the `record_intent` tool (from the `vouch` MCP server) with `summary`, `acceptance_criteria`, and optional `non_goals` / `scope_globs`.

## What happens next
When you later finish the change, Vouch automatically runs the project's own checks and an independent review of your diff against these acceptance criteria. Unmet criteria surface as questions (or, if the user opted in, blocking items). Capturing crisp criteria here is what makes that review accurate instead of noisy.
