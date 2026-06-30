# Vouch

**An automatic trust/verification layer for AI coding agents.** It plugs into the agent you already use (Claude Code) and turns *"the human is the inspector"* into *"the agent verifies its own work before handing it back."*

AI agents write code fast, but they rarely confirm they understood the request and almost never truly verify their own work — so you catch the "runs‑but‑behaves‑wrong" bugs at the end, after the time is already spent. Vouch closes that gap with three things:

1. **Intent confirmation** — a 30‑second, plain‑language check of what a change should accomplish (not a spec doc).
2. **Automatic, independent verification** — when the agent says it's done, Vouch runs your project's own checks *and* an independent review of the diff against the captured intent. Hard failures **block** the agent and feed it one prioritized fix‑prompt; it re‑verifies until clean.
3. **Repo‑resident memory** — captured intent, conventions, and dismissed non‑issues live as plain files in your repo, so it compounds over time and travels with the code.

Vouch is built to be **trusted**: deterministic tool failures are treated as *facts* that can block; uncertain LLM judgements are treated as *questions* that never block by default; and anything Vouch can't run is skipped, never reported as a defect. A noisy tool is a dead tool.

---

## Install

**Local / development (no marketplace):**
```bash
claude --plugin-dir /path/to/vouch
```

**Via marketplace:**
```bash
# in Claude Code
/plugin marketplace add /path/to/vouch
/plugin install vouch@vouch
```

The plugin ships a pre‑built `dist/` — no `npm install` is needed to run it.

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
intent → agent writes code → [you stop] → Stop hook fires (only if code changed)
                                              │
                                   ┌──────────┴───────────┐
                                   │  verification pipeline │
                                   ├────────────────────────┤
   Tier 1 (facts, fast→slow): typecheck → lint → build → test   (deterministic; can block)
   Tier 2 (questions): independent `claude -p` review of the diff vs the intent  (never blocks by default)
   Tier 3 (experimental, opt‑in): web smoke                       (non‑blocking; not yet enabled)
                                   └────────────┬───────────┘
                          blocking facts?  ──► block + ONE fix‑prompt ──► agent fixes ──► re‑verify
                          clean / only questions? ──► allow stop (+ surface questions)
```

- **The brain is one shared core.** Hooks are separate processes that can't call MCP, so all logic lives in `src/core/` and is reached two ways: the **MCP server** (`dist/mcp.js`, the interactive tools) and a **CLI** (`dist/cli.js`, invoked by the hooks).
- **Change‑gated.** `PostToolUse` only sets a cheap dirty flag. The real work runs on **Stop**, and only when the git diff actually changed — so verification doesn't fire on unrelated stops. Vouch never diffs or reviews its own `.vouch/` memory.
- **Independent reviewer.** Tier 2 spawns a fresh, read‑only `claude -p` with no stake in the original code (a self‑reviewing agent rationalizes its own work). It inherits your existing auth and runs with `VOUCH_DISABLE=1` so it can't recursively trigger Vouch's own hooks.
- **Bounded loop.** The block→fix→re‑verify loop is capped (default 3) via the Stop hook's `stop_hook_active` signal, with `/vouch:off` as a kill switch.

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
  "commandTimeoutSec": 90,
  "budgetSec": 150
}
```

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

## Limitations & roadmap
- **v1 targets Claude Code.** The memory format and core are tool‑agnostic by design; a Codex adapter is future work.
- **Tier 2 needs git** (to scope a diff) and the `claude` CLI (for the independent reviewer). Both degrade gracefully when absent.
- **Web smoke (Tier 3)** — boot the app and load changed routes headlessly, failing only on crashes/5xx/console errors — is designed and reserved but not yet enabled. Full intent‑driven Playwright E2E is intentionally out of v1 (it's the largest false‑positive risk).
- Auto‑detection covers Node/TS + Python today; other ecosystems work via manual config.

---

## Develop

```bash
npm install
npm run typecheck     # tsc --noEmit
npm run build         # esbuild bundles src/{mcp,cli}.ts → dist/ (CJS, dependency-free)
npm test              # vitest
```

Vouch dogfoods its own design: the pipeline's decision logic, detection, fingerprinting, dismissals, prioritization, and the real‑git diff are all covered by the test suite. Iterate on a loaded plugin with `/reload-plugins`.
