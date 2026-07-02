---
description: Review and trust this repo's Vouch config so verification can run (or revoke trust).
---

Vouch treats a repository's `.vouch/` config as **untrusted** until you approve it — because it can run shell commands (your test/build), an LLM reviewer, and sandboxed probe scripts. A cloned or unfamiliar repo's config does nothing until trusted.

1. Call `get_config` (from the `vouch` MCP server) and show the user, in plain terms, exactly what trusting this repo will authorize — especially the **commands** under `commands` and whether `reviewer.apiKeyEnv` is set.
2. If anything looks unexpected or hostile (e.g. a `test`/`build` command that curls a URL and pipes to a shell, or an `apiKeyEnv` naming a secret), STOP and warn the user; do not trust it.
3. Only if the user confirms it's safe, call `trust_repo` with `grant: true`.

To turn Vouch back off for this repo, call `trust_repo` with `grant: false`.

Note: if you set Vouch up yourself via `/vouch:setup`, the repo is trusted automatically — you don't need this. Use `/vouch:trust` for repos whose `.vouch` config you didn't author.
