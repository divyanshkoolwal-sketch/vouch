# Vouch

**An automatic trust/verification layer for AI coding agents.** It plugs into the agent you already use (Claude Code) and turns *"the human is the inspector"* into *"the agent verifies its own work before handing it back."*

AI agents write code fast, but they rarely confirm they understood the request and almost never truly verify their own work — so you catch the "runs‑but‑behaves‑wrong" bugs at the end, after the time is already spent. Vouch closes that gap with three things:

1. **Intent confirmation** — a 30‑second, plain‑language check of what a change should accomplish (not a spec doc).
2. **Automatic, independent verification** — when the agent says it's done, Vouch runs your project's own checks *and* an independent review of the diff against the captured intent. Hard failures **block** the agent and feed it one prioritized fix‑prompt; it re‑verifies until clean.
3. **Repo‑resident memory** — captured intent, conventions, and dismissed non‑issues live as plain files in your repo, so it compounds over time and travels with the code.

Vouch is built to be **trusted**: deterministic tool failures are treated as *facts* that can block; uncertain LLM judgements are treated as *questions* that never block by default; and anything Vouch can't run is skipped, never reported as a defect. A noisy tool is a dead tool.

---

## Install

Vouch works with **Claude Code**, **OpenAI Codex**, and **Cursor** — no API key, no cloud (it ships prebuilt and the reviewer reuses the login you already have in your agent). Requirements: the agent itself, Node 18+, and `git`.

How enforcement differs by host (all get the full MCP tools + intent + automatic verification):

| Host | Automatic verify on finish | Reviewer backend |
|---|---|---|
| **Claude Code** | **hard block** → fix → re-verify loop | `claude -p` |
| **OpenAI Codex** | **hard block** → fix → re-verify loop | `codex exec` |
| **Cursor** | auto-submits the fix (soft loop); `--strict` adds a hard `git commit` gate | `cursor-agent` |

### Claude Code (~2 minutes)

No build step — the plugin ships prebuilt and reuses your Claude Code login.

#### Step 1 — Add the plugin
Open Claude Code and type these two commands (one at a time):

```
/plugin marketplace add divyanshkoolwal-sketch/vouch
/plugin install vouch@vouch
```

The first tells Claude Code where to find Vouch; the second installs it. If it asks for a scope, pick **user** (so it's available in all your projects).

#### Step 2 — Restart Claude Code
Quit and reopen it (or start a new session). Plugins only load at startup, so this step is required. To confirm it worked, type `/plugin` — you should see **vouch** listed as *enabled*.

#### Step 3 — Turn it on for a project
Open a project (any git repo) and run:

```
/vouch:setup
```

Vouch auto-detects how to run your tests/build and asks **one** question to confirm. Done — it's now watching this repo. (It stays asleep in repos where you haven't run setup, so it never gets in your way elsewhere.)

#### Step 4 (optional but recommended) — Tell it what you're building
Right before a non-trivial change, run:

```
/vouch:intent
```

…and describe, in plain words, what the change should do. Vouch checks the agent's work against that.

#### Then just work normally
When the coding agent finishes a change, Vouch automatically runs your project's checks **and** an independent review of the diff. If something's actually broken it stops the agent, hands it one clear fix, and re-checks until it's right. Uncertain stuff is shown as a *question*, never a hard block.

**Handy commands:** `/vouch:verify` (check now) · `/vouch:status` (what's set up + latest findings) · `/vouch:off` (pause/resume).

**Troubleshooting**
- *Don't see the `/vouch:` commands?* Restart Claude Code, then check `/plugin` shows vouch enabled.
- *"Vouch is not set up" message?* Run `/vouch:setup` in that repo.
- *Want to remove it?* `/plugin uninstall vouch@vouch`.

### OpenAI Codex

One command (needs Node 18+), then restart Codex:

```
npx @divyanshkoolwal-sketch/vouch install codex
```

This registers Vouch's MCP tools + hooks under `~/.codex` (safe, namespaced merge — your existing config is preserved, with a `.bak` backup). You get the **same hard block → fix → re-verify loop** as Claude Code. Then, in a repo, ask Codex to "set up Vouch for this repo" (it uses the vouch tools to detect your test/build commands) or add a `.vouch/config.json`. Remove any time with `npx @divyanshkoolwal-sketch/vouch uninstall codex`.

### Cursor

One command, then restart Cursor:

```
npx @divyanshkoolwal-sketch/vouch install cursor            # this project (.cursor/)
npx @divyanshkoolwal-sketch/vouch install cursor --global   # all projects (~/.cursor)
npx @divyanshkoolwal-sketch/vouch install cursor --strict   # also hard-block `git commit` until clean
```

You get Vouch's MCP tools + automatic verification when the agent finishes. Note: Cursor's finish hook is observe-only, so instead of a hard block Vouch **auto-submits the fix as a follow-up** (a soft, bounded loop); add `--strict` to hard-deny `git commit`/`push` while blocking issues remain. Requires the [Cursor CLI](https://cursor.com/docs/cli) for the reviewer (`curl https://cursor.com/install -fsS | bash`). Remove with `npx @divyanshkoolwal-sketch/vouch uninstall cursor`.

Check what's wired up anytime: `npx @divyanshkoolwal-sketch/vouch status`. Add `--dry-run` to any install to preview the exact writes first.

<details><summary>Prefer to run it from source (for hacking on Vouch)?</summary>

```bash
git clone https://github.com/divyanshkoolwal-sketch/vouch && cd vouch
npm install && npm run build
node dist/cli.js install codex    # or: install cursor
# Claude Code (dev): claude --plugin-dir .   then /reload-plugins
```
</details>

## Set up a repo (one step)

In a project, run:
```
/vouch:setup
```
Vouch auto‑detects how to run your checks (test / lint / build / typecheck for Node/TS and Python) and asks you **one** question to confirm. Settings are written to `.vouch/config.json`. **Secrets are never stored** — reference environment variable names only.

## Use it

- `/vouch:intent` — confirm what the current change should accomplish (records intent for the reviewer to verify against). Or just let the `understand-intent` skill prompt you on non‑trivial work.
- Work normally. When you finish, Vouch verifies automatically. If a check fails, it blocks with one prioritized fix‑prompt and re‑verifies after you fix (up to 3 rounds, then it releases so you're never trapped).
- `/vouch:verify` — run verification on demand.
- `/vouch:status` — show config, active intent, and the latest findings.
- `/vouch:off` — pause/resume automatic verification (manual `/vouch:verify` still works while paused).

When a finding is a genuine non‑issue, dismiss it (by its `vouch id`) and Vouch will **never raise it again**.

---

## How it works

```
intent → agent writes code → [you stop] → Stop hook (only if the diff changed)
                                              │
   Scope:      merge-base diff + --function-context; monorepo → affected packages
   Tier 1:     typecheck → lint → build → test   (facts; TEST TIER narrowed by test-impact analysis)
   Tier 2:     grounded review of the diff vs intent →
                 MAP (parallel, per chunk, quote-first)  →  REDUCE (dedupe/rank)
                 →  EVIDENCE GATE (drop findings whose quote isn't literally in the code)
                 →  CoVe QUORUM (N independent skeptics refute-by-default; keep only confirmed)
                                              │
              blocking facts? ─► block + ONE grounded fix-prompt ─► agent fixes ─► re-verify (loop, capped)
              clean / only questions? ─► allow stop (+ surface questions + honest coverage)
```

- **Two deterministic gates carry the accuracy.** Research is clear that un-grounded self-critique *lowers* accuracy, and models mis-cite ~50% of the time — so the guarantees are non-LLM: (1) the **evidence gate** drops any behavioral finding whose quoted code isn't literally present; (2) the **CoVe quorum** keeps a finding only if a majority of *independent* skeptics (who can't see the original claim) confirm it against the real code. The LLM improves candidate quality; the gates guarantee low false positives.
- **Scales without truncation.** Big changes are chunked and reviewed in parallel (map-reduce) with absolute line numbers, never truncated. Monorepos are scoped to affected packages; the test tier runs only affected tests (with a safe fallback to the full suite on any root-file change). Everything Vouch couldn't fully cover is reported — never conflated with "clean."
- **The brain is one shared core.** Hooks can't call MCP, so all logic lives in `src/core/` and is reached two ways: the **MCP server** (`dist/mcp.js`) and a **CLI** (`dist/cli.js`, invoked by the hooks).
- **Independent + bounded.** The reviewer is a fresh read-only `claude -p` (no stake in the code, inherits your auth, `VOUCH_DISABLE=1` prevents hook recursion). The block→fix→re-verify loop is capped (default 3) via `stop_hook_active`, with `/vouch:off` as a kill switch.

### Facts vs. questions vs. notices
| Class | Source | Blocks? |
|------|--------|---------|
| **Fact** | a test/typecheck/build actually failed | yes, if its tier is in `blockOn` (default: typecheck, build, test) |
| **Notice** | a deterministic check failed but its tier isn't set to block (e.g. lint) | no — but always surfaced |
| **Question** | the independent intent review flagged a possible gap | no by default (opt `intent` into `blockOn` to change) |

---

## Configuration (`.vouch/config.json`)

```jsonc
{
  "version": 1,
  "commands": {                      // auto-detected by /vouch:setup; edit freely
    "typecheck": { "cmd": "npx tsc --noEmit", "enabled": true },
    "lint":      { "cmd": "npm run lint",     "enabled": true },
    "build":     { "cmd": "npm run build",    "enabled": true },
    "test":      { "cmd": "npm test",         "enabled": true }
  },
  "tiers":   { "typecheck": true, "lint": true, "build": true, "test": true, "intent": true, "smoke": false },
  "enforcement": {
    "block": true,
    "blockOn": ["typecheck", "build", "test"],   // only deterministic facts block by default
    "maxIterations": 3
  },
  "reviewer": { "model": null, "timeoutSec": 90 }, // model: null = inherit your default; set e.g. a faster model to cut cost
  "mode": "thorough",                // thorough (max accuracy, default) | bounded | fast
  "review": {
    "concurrency": 4,                // max parallel review calls
    "quorumN": 3,                    // independent CoVe verification votes per finding
    "chunkTokenBudget": 6000,        // per-chunk size before splitting
    "maxReviewFiles": 40,            // hard cap; excess reported as skipped
    "minConfidence": 0.5             // drop verified findings below this
  },
  "tia": { "enabled": true },        // run only tests affected by the change (safe fallback to full)
  "commandTimeoutSec": 90,
  "budgetSec": 240                   // pipeline degrades honestly if exceeded (never silently truncates)
}
```

`mode`: **thorough** (default) = full map-reduce + N-vote verification (max accuracy); **bounded** = single verification vote; **fast** = evidence gate only, no independent verification.

### Repo memory (`.vouch/`)
```
.vouch/
├── config.json        # checks + policy (commit this)
├── intent/active.json # current intent + acceptance criteria (commit this)
├── conventions.md     # learned/edited conventions, injected at session start (commit this)
├── dismissals.json    # suppressed false positives (commit this)
└── runs/              # transient state — gitignored automatically
```

---

## MCP tools (server `vouch`)
`record_intent`, `get_active_intent`, `clear_intent`, `verify`, `dismiss_finding`, `record_convention`, `get_setup_suggestion`, `get_config`, `configure`, `get_status`, `set_enabled`.

## Measuring accuracy
`npm run eval` runs the review pipeline over a golden set (`src/eval/cases.ts`: correct diffs, seeded defects, and correct-but-unusual "hard negatives") and prints a confusion matrix + false-positive rate, failing if effective-FP exceeds **10%** (Google's "developers will disable it" threshold) or recall drops below the floor. This is how "accuracy" is a measured number here, not a claim. Add your own cases to tune the reviewer for your repo.

## Limitations & roadmap
- **Targets Claude Code.** The memory format and core are tool-agnostic by design; a Codex adapter is future work.
- **Tier 2 needs git** (to scope a diff) and the `claude` CLI (independent reviewer). Both degrade gracefully when absent.
- **Test-impact analysis** covers jest & vitest today (safe-fallback to the full suite otherwise). Monorepo detection covers JS/TS workspaces (pnpm/yarn/npm/bun, Nx/Turbo/Lerna) + Cargo/Go for reporting.
- **Deferred (next wave):** a tree-sitter repo-map for orientation on very large repos (the agentic reviewer already gathers context via grep/read + function-context, so this is an enhancement, not a blocker); generating *executable* checks from intent (turning behavioral opinions into deterministic facts); fix-guided verification in a scratch worktree; an LSP precision layer; web/Playwright smoke.
- Auto-detection covers Node/TS + Python; other ecosystems work via manual config.

---

## Develop

```bash
npm install
npm run typecheck     # tsc --noEmit
npm run build         # esbuild bundles src/{mcp,cli,eval} → dist/ (CJS, dependency-free)
npm test              # vitest (73 unit/integration tests)
npm run eval          # precision/recall over the golden set (real reviewer; ~minutes)
```

Vouch dogfoods its own design: the pipeline's decision logic, detection, fingerprinting, dismissals, prioritization, and the real‑git diff are all covered by the test suite. Iterate on a loaded plugin with `/reload-plugins`.
