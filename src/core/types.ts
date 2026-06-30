// Shared data model for the Vouch "brain". Kept dependency-free so it can be
// imported by both entry points (the MCP server and the hook CLI).

/** How confident we are. `fact` = produced by a deterministic tool (a test/build
 *  actually failed). Everything else is a judgement from the LLM reviewer. */
export type Confidence = 'fact' | 'high' | 'medium' | 'low';

/** What we do with a finding. `blocking` can stop the agent; `question` is
 *  surfaced but never blocks; `info` is purely advisory. */
export type FindingKind = 'blocking' | 'question' | 'info';

export type TierName = 'typecheck' | 'lint' | 'build' | 'test' | 'intent' | 'smoke';

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
    /** Loop cap: max consecutive block→fix→re-verify rounds before releasing. */
    maxIterations: number;
  };
  reviewer: {
    /** Optional model id override for the headless reviewer (omit = inherit). */
    model?: string;
    timeoutSec: number;
    /** Per-tier command timeout. */
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
}
