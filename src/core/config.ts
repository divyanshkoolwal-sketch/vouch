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

/** Deep-merge a stored (possibly partial) config over the defaults. */
export function normalizeConfig(stored: Partial<VouchConfig> | null): VouchConfig {
  const d = defaultConfig();
  if (!stored) return d;
  return {
    version: stored.version ?? d.version,
    commands: { ...d.commands, ...(stored.commands ?? {}) },
    web: { ...d.web, ...(stored.web ?? {}) },
    tiers: { ...d.tiers, ...(stored.tiers ?? {}) },
    enforcement: { ...d.enforcement, ...(stored.enforcement ?? {}) },
    reviewer: { ...d.reviewer, ...(stored.reviewer ?? {}) },
    probe: { ...d.probe, ...(stored.probe ?? {}) },
    mode: stored.mode ?? d.mode,
    review: { ...d.review, ...(stored.review ?? {}) },
    tia: { ...d.tia, ...(stored.tia ?? {}) },
    commandTimeoutSec: stored.commandTimeoutSec ?? d.commandTimeoutSec,
    budgetSec: stored.budgetSec ?? d.budgetSec,
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
