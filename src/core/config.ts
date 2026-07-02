// Load/save .vouch/config.json with forgiving defaults so older/partial configs
// keep working. Secrets are NEVER stored here — commands may reference env var
// names, but values live only in the environment.
import { VouchConfig } from './types';
import { configPath, readJSON, writeJSON, ensureVouchDir, exists } from './memory';

export function defaultConfig(): VouchConfig {
  return {
    version: 1,
    commands: {},
    web: { enabled: false },
    tiers: {
      typecheck: true,
      lint: true,
      build: true,
      test: true,
      integrity: true,
      intent: true,
      smoke: false,
    },
    enforcement: {
      block: true,
      // Only objective, deterministic failures block by default. Lint and the
      // LLM intent review are advisory unless the user opts them in — this is
      // the core false-positive guardrail. 'integrity' is deterministic diff
      // analysis (test-weakening detection); only its high-signal detectors
      // emit blocking-class findings.
      blockOn: ['typecheck', 'build', 'test', 'integrity'],
      blockWhenProven: true,
      maxIterations: 3,
    },
    reviewer: {
      model: undefined,
      timeoutSec: 90,
      backend: 'auto',
      verifierBackend: 'auto',
    },
    probe: {
      enabled: true,
      timeoutSec: 20,
      maxPerRun: 5,
      allowPython: false,
    },
    // Default to max accuracy (per product decision): full map-reduce + N-vote
    // independent verification. Budget-bounded so a huge repo degrades honestly
    // rather than blowing the Stop-hook timeout.
    mode: 'thorough',
    review: {
      concurrency: 4,
      quorumN: 3,
      chunkTokenBudget: 6000,
      maxReviewFiles: 40,
      minConfidence: 0.5,
    },
    tia: {
      enabled: true,
    },
    commandTimeoutSec: 90,
    budgetSec: 240,
  };
}

const clamp = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
};

// Only these env var names may ever be used for the API reviewer backend — a
// hostile repo config must not be able to name (and exfiltrate) an arbitrary
// secret env var like AWS_SECRET_ACCESS_KEY.
const API_KEY_ENV_OK = /^(ANTHROPIC_API_KEY|OPENAI_API_KEY|VOUCH_[A-Z0-9_]+)$/;
// Model names: must start with an alphanumeric (so the value can never look
// like a CLI flag) and contain no spaces (so it stays a single token). Covers
// real names like claude-sonnet-5, gpt-4o, anthropic/claude-3.
const MODEL_OK = /^[A-Za-z0-9][A-Za-z0-9._:@/\-]{0,99}$/;

/** Deep-merge a stored (possibly partial) config over the defaults, CLAMPING all
 *  numeric fields and VALIDATING free-form strings — a repo-supplied config is
 *  untrusted input and must not be able to cause DoS, flag-smuggling, or secret
 *  exfiltration even before the trust gate is consulted. */
export function normalizeConfig(stored: Partial<VouchConfig> | null): VouchConfig {
  const d = defaultConfig();
  if (!stored) return d;
  const reviewer = { ...d.reviewer, ...(stored.reviewer ?? {}) };
  // Reject a model string that could smuggle CLI flags; drop a disallowed apiKeyEnv.
  if (reviewer.model && !MODEL_OK.test(reviewer.model)) reviewer.model = undefined;
  if (reviewer.apiKeyEnv && !API_KEY_ENV_OK.test(reviewer.apiKeyEnv)) reviewer.apiKeyEnv = undefined;
  reviewer.timeoutSec = clamp(reviewer.timeoutSec, 5, 300, d.reviewer.timeoutSec);

  const review = { ...d.review, ...(stored.review ?? {}) };
  review.concurrency = clamp(review.concurrency, 1, 8, d.review.concurrency);
  review.quorumN = clamp(review.quorumN, 1, 7, d.review.quorumN);
  review.chunkTokenBudget = clamp(review.chunkTokenBudget, 500, 100000, d.review.chunkTokenBudget);
  review.maxReviewFiles = clamp(review.maxReviewFiles, 1, 200, d.review.maxReviewFiles);
  review.minConfidence = Math.max(0, Math.min(1, typeof review.minConfidence === 'number' ? review.minConfidence : d.review.minConfidence));

  const enforcement = { ...d.enforcement, ...(stored.enforcement ?? {}) };
  enforcement.maxIterations = clamp(enforcement.maxIterations, 1, 10, d.enforcement.maxIterations);

  const probe = { ...d.probe, ...(stored.probe ?? {}) };
  probe.timeoutSec = clamp(probe.timeoutSec, 1, 60, d.probe.timeoutSec);
  probe.maxPerRun = clamp(probe.maxPerRun, 0, 20, d.probe.maxPerRun);

  return {
    version: stored.version ?? d.version,
    commands: { ...d.commands, ...(stored.commands ?? {}) },
    web: { ...d.web, ...(stored.web ?? {}) },
    tiers: { ...d.tiers, ...(stored.tiers ?? {}) },
    enforcement,
    reviewer,
    probe,
    mode: stored.mode === 'thorough' || stored.mode === 'bounded' || stored.mode === 'fast' ? stored.mode : d.mode,
    review,
    tia: { ...d.tia, ...(stored.tia ?? {}) },
    commandTimeoutSec: clamp(stored.commandTimeoutSec, 5, 300, d.commandTimeoutSec),
    budgetSec: clamp(stored.budgetSec, 10, 600, d.budgetSec),
  };
}

/** Returns null when Vouch has not been set up for this repo. */
export function loadConfig(proj: string): VouchConfig | null {
  if (!exists(configPath(proj))) return null;
  const stored = readJSON<Partial<VouchConfig> | null>(configPath(proj), null);
  return normalizeConfig(stored);
}

export function saveConfig(proj: string, cfg: VouchConfig): void {
  ensureVouchDir(proj);
  writeJSON(configPath(proj), cfg);
}

export function isConfigured(proj: string): boolean {
  return exists(configPath(proj));
}
