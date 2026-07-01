# Contributing to Vouch

Thanks for helping make AI-generated code more trustworthy.

## Dev setup
```bash
git clone https://github.com/divyanshkoolwal-sketch/vouch
cd vouch
npm install
npm run typecheck   # tsc --noEmit
npm run build       # esbuild → dist/ (committed; installers need no build)
npm test            # vitest
npm run eval        # precision/recall over the golden set (needs the `claude` CLI)
```

Iterate on the loaded plugin with `claude --plugin-dir .` then `/reload-plugins`.

## Architecture (where things live)
- `src/core/` — the shared "brain" (pure logic, unit-tested), reached two ways:
  - `src/mcp.ts` → `dist/mcp.js` — the MCP server (interactive tools).
  - `src/cli.ts` → `dist/cli.js` — invoked by the hook scripts in `scripts/`.
- `src/core/review/` — the grounded review pipeline: `map` (per-chunk review) →
  `reduce` (dedupe/rank) → `groundGate` (drop findings whose quote isn't in the
  code) → `verify` (independent CoVe quorum). `chunk`, `context`, `claude`,
  `concurrency` support it.
- `src/core/{diff,runners,tia,workspaces,pipeline,...}.ts` — scope, deterministic
  tiers, test-impact analysis, monorepo detection, orchestration.
- `src/eval/` — the precision/recall harness + golden cases.

## Ground rules (the philosophy that keeps it trusted)
1. **Deterministic gates carry the guarantees, not prompts.** Any new LLM step
   must be backed by an external anchor (a verifiable citation, an independent
   recomputation, or a real test result). Never a bare "criticize yourself" loop.
2. **Facts block; opinions ask.** Deterministic tool failures can block; LLM
   judgments are non-blocking questions by default.
3. **Never let our own inability become a finding.** A missing tool / failed call
   degrades to a skip, reported honestly — never a fabricated defect.
4. **Measure it.** New reviewer behavior should be covered by `test/` and, where
   it affects accuracy, by a case in `src/eval/cases.ts`. Keep the effective
   false-positive rate under 10% (`npm run eval`).

## Pull requests
- Keep `npm run typecheck && npm run build && npm test` green (CI enforces this).
- Rebuild `dist/` and commit it (installers run the committed bundle).
- If you touch the reviewer, add/adjust an eval case and paste the before/after
  confusion matrix in the PR.
