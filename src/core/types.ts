// Shared data model for the Vouch "brain". Kept dependency-free so it can be
// imported by both entry points (the MCP server and the hook CLI).

/** How confident we are. `fact` = produced by a deterministic tool (a test/build
 *  actually failed). Everything else is a judgement from the LLM reviewer. */
export type Confidence = 'fact' | 'high' | 'medium' | 'low';

/** What we do with a finding. `blocking` can stop the agent; `question` is
 *  surfaced but never blocks; `info` is purely advisory. */
export type FindingKind = 'blocking' | 'question' | 'info';

export type TierName = 'typecheck' | 'lint' | 'build' | 'test' | 'integrity' | 'intent' | 'smoke';

/** Result of executing a finding-guided probe (a tiny script that demonstrates a
 *  violated acceptance criterion by exiting non-zero with a marker). */
export interface ProbeInfo {
  /** Probe script path, relative to the project root (under .vouch/runs/probes/). */
  path: string;
  /** Exact command to reproduce, e.g. `node ".vouch/runs/probes/<id>.cjs"`. */
  command: string;
  language: 'node' | 'python';
  outcome: 'proven' | 'not-reproduced' | 'inconclusive';
  outputTail?: string;
}

/** Minimal probe record persisted across fix-loop rounds so a proven failure can
 *  be re-checked deterministically (no LLM) on the next stop. */
export interface StoredProbe {
  id: string; // the finding's fingerprint (hex) — becomes the probe filename
  title: string;
  file?: string;
  criterion?: string;
  language: 'node' | 'python';
}

export interface Finding {
  /** Stable fingerprint — used for dedupe and dismissal suppression. */
  id: string;
  kind: FindingKind;
  tier: TierName;
  /** One-line summary. */
  title: string;
  /** Evidence: command output excerpt, or the cited intent clause + reasoning. */
  detail?: string;
  file?: string;
  line?: number;
  /** The exact command that produced a fact (for reproduction in the fix-prompt). */
  command?: string;
  confidence: Confidence;
  // --- v0.2 grounding fields (behavioral/intent findings) ---
  /** Verbatim snippet of the offending code the model quoted. The deterministic
   *  evidence gate REQUIRES this to appear literally in the code, or the finding
   *  is dropped — this is the load-bearing anti-hallucination guarantee. */
  evidence?: string;
  startLine?: number;
  endLine?: number;
  /** The acceptance criterion this finding relates to. */
  criterion?: string;
  /** True once an independent (Chain-of-Verification) pass confirmed it. */
  verified?: boolean;
  /** True if the model's `evidence` quote matched the code verbatim (a strong
   *  grounding signal). Prose-only evidence (e.g. from some models) is false and
   *  must instead be confirmed by the independent CoVe quorum to be surfaced. */
  evidenceVerbatim?: boolean;
  /** Set when an executed probe demonstrated the violation — the finding is then
   *  a deterministic FACT (runnable repro), not an opinion. */
  provenBy?: 'probe';
  probe?: ProbeInfo;
  /** Numeric confidence 0..1 (from quorum agreement + the model's own score). */
  score?: number;
}

/** Honest accounting of what verification actually covered — never conflate
 *  "clean" with "skipped" or "truncated". */
export interface CoverageReport {
  filesChanged: number;
  filesReviewed: number;
  filesSkippedTooLarge: string[];
  chunksReviewed: number;
  packagesScoped: string[];
  testsSelected: number | null; // null = ran full suite / TIA not applicable
  budgetHit: boolean;
  notes: string[];
}

export interface IntentRecord {
  id: string;
  summary: string;
  acceptance_criteria: string[];
  scope_globs?: string[];
  non_goals?: string[];
  created: string; // ISO timestamp
  status: 'active' | 'archived';
}

export interface RunCommand {
  cmd: string; // shell command, e.g. "npm test"
  enabled: boolean;
}

export interface WebConfig {
  enabled: boolean;
  url?: string; // e.g. http://localhost:3000
  readyPath?: string; // path to poll for readiness, e.g. "/"
  routes?: string[]; // routes to smoke-check
}

export interface VouchConfig {
  version: number;
  commands: {
    typecheck?: RunCommand;
    lint?: RunCommand;
    build?: RunCommand;
    test?: RunCommand;
    start?: RunCommand;
  };
  web: WebConfig;
  tiers: Record<TierName, boolean>;
  enforcement: {
    /** Master switch. When false, Vouch verifies but never blocks (advisory). */
    block: boolean;
    /** Which tiers are allowed to *block* the agent. Tiers not listed here only
     *  ever produce non-blocking findings. */
    blockOn: TierName[];
    /** A probe-proven behavioral finding (runnable repro) blocks regardless of
     *  whether the intent tier is in blockOn — it's a fact now. Default true. */
    blockWhenProven: boolean;
    /** Loop cap: max consecutive block→fix→re-verify rounds before releasing. */
    maxIterations: number;
  };
  reviewer: {
    /** Optional model id override for the headless reviewer (omit = inherit). */
    model?: string;
    timeoutSec: number;
    /** Which headless backend runs the review. 'auto' prefers the host agent's
     *  own CLI (claude/codex/cursor-agent), then falls back. */
    backend?: 'auto' | 'claude' | 'codex' | 'cursor' | 'api';
    /** Backend for independent (CoVe) verification votes. 'auto' picks the best
     *  available backend DIFFERENT from the map backend — cross-model checking
     *  breaks same-model self-leniency; falls back to the map backend if it's
     *  the only one available. */
    verifierBackend?: 'auto' | 'claude' | 'codex' | 'cursor' | 'api';
    /** Env var name holding an API key for the 'api' backend (opt-in; never auto-billed). */
    apiKeyEnv?: string;
  };
  probe: {
    /** Generate + execute a runnable probe for each verified behavioral finding
     *  ("no repro, no block"). A failing probe upgrades the finding to a fact. */
    enabled: boolean;
    timeoutSec: number;
    maxPerRun: number;
    /** Execute Python probes. OFF by default: unlike Node probes (run under the
     *  OS permission sandbox), Python has no equivalent sandbox here, so LLM-
     *  generated Python is only run if the user explicitly opts in. */
    allowPython: boolean;
  };
  /** Verification intensity. thorough = full map-reduce + N-vote verification
   *  (max accuracy, default); bounded = cap chunks + single refutation;
   *  fast = one grounded pass + evidence gate only. */
  mode: 'thorough' | 'bounded' | 'fast';
  review: {
    /** Max concurrent headless review calls. */
    concurrency: number;
    /** Chain-of-Verification quorum size (independent refutation votes). */
    quorumN: number;
    /** Token budget per review chunk (rough estimate, chars/4). */
    chunkTokenBudget: number;
    /** Hard cap on files reviewed by the LLM in one run (rest reported as skipped). */
    maxReviewFiles: number;
    /** Drop verified findings below this numeric confidence. */
    minConfidence: number;
  };
  tia: {
    /** Run only tests affected by the change (with safe fallbacks). */
    enabled: boolean;
    /** Base branch/ref to diff against for merge-base scoping (auto-detected if unset). */
    baseRef?: string;
  };
  /** Per-deterministic-command timeout (seconds). */
  commandTimeoutSec: number;
  /** Global pipeline time budget (seconds). */
  budgetSec: number;
}

export interface VerifyResult {
  diffEmpty: boolean;
  ranTiers: TierName[];
  skipped: { tier: TierName; reason: string }[];
  findings: Finding[];
  blocking: Finding[];
  questions: Finding[];
  /** Deterministic failures that are configured NOT to block (e.g. lint by
   *  default, or anything when enforcement is advisory). Real, but non-blocking
   *  — and they MUST still be surfaced, never silently swallowed. */
  notices: Finding[];
  /** One consolidated prompt addressed to the agent, or "" if nothing to fix. */
  fixPrompt: string;
  /** One-line human summary. */
  summary: string;
  /** What verification actually covered (v0.2). */
  coverage?: CoverageReport;
}
