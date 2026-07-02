// The verification pipeline: fast-to-slow tiers, early-exit on compile-class
// failures, intent review only when the deterministic tiers are green, then
// dismissal-filter + dedupe + prioritize into one result. Deterministic tools
// produce blocking "facts"; the LLM review produces non-blocking "questions"
// (unless the user opts intent into blockOn). Dependencies are injectable so
// the decision logic is unit-testable without spawning anything.
import { Finding, IntentRecord, TierName, VouchConfig, VerifyResult, CoverageReport } from './types';
import { runTier as defaultRunTier, TierRun } from './runners';
import { reviewIntent as defaultReviewIntent, reviewerAvailable as defaultReviewerAvailable } from './reviewer';
import { workingDiff as defaultWorkingDiff, DiffResult } from './diff';
import { buildChunks, BuildChunksResult } from './review/chunk';
import { describeBackends } from './review/backends';
import { checkTestIntegrity } from './testIntegrity';
import { isTrusted } from './trust';
import { redactFinding } from './redact';
import { detectWorkspaces, affectedPackages } from './workspaces';
import { selectTests } from './tia';
import { dedupe } from './findings';
import { loadDismissals, filterDismissed } from './dismissals';
import { buildFixPrompt, summaryLine } from './prioritize';

export interface PipelineDeps {
  runTier: typeof defaultRunTier;
  reviewIntent: typeof defaultReviewIntent;
  reviewerAvailable: (cfg: VouchConfig) => boolean;
  workingDiff: (proj: string) => DiffResult;
  trusted: (proj: string, cfg: VouchConfig) => boolean;
}

const defaultDeps: PipelineDeps = {
  runTier: defaultRunTier,
  reviewIntent: defaultReviewIntent,
  reviewerAvailable: defaultReviewerAvailable,
  workingDiff: defaultWorkingDiff,
  trusted: isTrusted,
};

const TIER_ORDER: TierName[] = ['typecheck', 'lint', 'build', 'test'];

export async function runPipeline(opts: {
  proj: string;
  cfg: VouchConfig;
  intent: IntentRecord | null;
  force?: boolean; // run even when the diff is empty (manual /vouch-verify)
  roundInfo?: string;
  deps?: Partial<PipelineDeps>;
}): Promise<VerifyResult> {
  const deps: PipelineDeps = { ...defaultDeps, ...(opts.deps ?? {}) };
  const { proj, cfg, intent } = opts;
  const startedAt = Date.now();
  const overBudget = () => (Date.now() - startedAt) / 1000 > cfg.budgetSec;

  const ranTiers: TierName[] = [];
  const skipped: { tier: TierName; reason: string }[] = [];
  let findings: Finding[] = [];
  let budgetHit = false;
  let built: BuildChunksResult | null = null;

  const diff = deps.workingDiff(proj);
  const diffEmpty = !diff.patch;

  if (diffEmpty && !opts.force) {
    return {
      diffEmpty: true,
      ranTiers,
      skipped,
      findings: [],
      blocking: [],
      questions: [],
      notices: [],
      fixPrompt: '',
      summary: 'Vouch: no changes to verify',
    };
  }

  // ---- TRUST GATE (the linchpin) ----
  // A repo's `.vouch/config.json` chooses which commands run, which reviewer/API
  // backend is used, and whether probes execute. On an UNTRUSTED repo (freshly
  // cloned, never approved for its current config) we run NOTHING that a
  // malicious config could weaponize: no tier commands, no reviewer, no probes,
  // no context injection. This turns "clone → agent stops → zero-click RCE" into
  // an inert no-op until the user reviews the config and runs /vouch:trust.
  if (!deps.trusted(proj, cfg)) {
    return {
      diffEmpty,
      ranTiers: [],
      skipped: [{ tier: 'intent', reason: 'repo not trusted — no commands, reviewer, or probes were run' }],
      findings: [],
      blocking: [],
      questions: [],
      notices: [],
      fixPrompt: '',
      summary:
        "Vouch: this repo's config is not trusted yet — review .vouch/config.json, then run /vouch:trust (or the trust_repo tool) to enable verification",
      coverage: {
        filesChanged: diff.perFile.length,
        filesReviewed: 0,
        filesSkippedTooLarge: [],
        chunksReviewed: 0,
        packagesScoped: [],
        testsSelected: null,
        budgetHit: false,
        notes: ['UNTRUSTED repo: nothing was executed. This protects you from a malicious .vouch config on a cloned repo.'],
      },
    };
  }

  // Monorepo + change scoping (for coverage reporting and test-impact analysis).
  const changedFiles = diff.files;
  const ws = detectWorkspaces(proj);
  const scopedPkgs = ws.isMonorepo ? affectedPackages(changedFiles, ws.packages) : [];
  let testsSelected: number | null = null;
  const coverageNotes: string[] = [];
  if (ws.isMonorepo) coverageNotes.push(`monorepo (${ws.tool}); ${scopedPkgs.length} package(s) affected`);

  // ---- Test-integrity tier: deterministic diff analysis (free; catches tests
  // weakened to force a green run). Runs before Tier 1 — independent of builds.
  if (cfg.tiers.integrity) {
    ranTiers.push('integrity');
    findings.push(...checkTestIntegrity(diff.perFile, cfg));
  }

  // ---- Tier 1: deterministic checks (facts) ----
  let compileBroken = false;
  for (const tier of TIER_ORDER) {
    let rc = cfg.commands[tier as keyof typeof cfg.commands];
    if (!cfg.tiers[tier]) continue;
    if (!rc || !rc.enabled || !rc.cmd) continue;

    if (compileBroken) {
      skipped.push({ tier, reason: 'skipped — a compile-class check (typecheck/build) already failed' });
      continue;
    }
    if (overBudget()) {
      budgetHit = true;
      skipped.push({ tier, reason: `time budget (${cfg.budgetSec}s) reached` });
      continue;
    }

    // Test-impact analysis: narrow the test tier to affected tests (safe fallback
    // to the full suite when uncertain — never risk skipping an affected test).
    if (tier === 'test' && cfg.tia.enabled && diff.isGit) {
      const tia = selectTests({ proj, testCmd: rc.cmd, changedFiles, enabled: true });
      if (tia.narrowed) {
        rc = { ...rc, cmd: tia.command };
        testsSelected = tia.selectedCount;
        coverageNotes.push(`tests: ${tia.reason}`);
      } else {
        coverageNotes.push(`tests: ${tia.reason}`);
      }
    }

    const blocking = cfg.enforcement.block && cfg.enforcement.blockOn.includes(tier);
    const run: TierRun = await deps.runTier(tier, rc, proj, cfg.commandTimeoutSec * 1000, blocking);
    ranTiers.push(tier);

    if (run.skippedReason) {
      skipped.push({ tier, reason: run.skippedReason });
      continue;
    }
    if (run.finding) {
      findings.push(run.finding);
      if (tier === 'typecheck' || tier === 'build') compileBroken = true;
    }
  }

  // Any blocking facts so far? If so, defer the (slower, paid) intent review —
  // fix the hard failures first; the next round runs the review once green.
  const hasBlockingFact = findings.some((f) => f.kind === 'blocking');

  // ---- Tier 2: independent intent-vs-diff review (questions) ----
  if (!cfg.tiers.intent) {
    skipped.push({ tier: 'intent', reason: 'intent tier disabled' });
  } else if (compileBroken || hasBlockingFact) {
    skipped.push({ tier: 'intent', reason: 'deferred — fix the verified failures first' });
  } else if (!intent) {
    skipped.push({ tier: 'intent', reason: 'no active intent captured (run /vouch:intent)' });
  } else if (!diff.isGit) {
    skipped.push({ tier: 'intent', reason: 'not a git repo — cannot scope a diff to review' });
  } else if (!deps.reviewerAvailable(cfg)) {
    skipped.push({ tier: 'intent', reason: 'no reviewer backend available (claude/codex/cursor CLI or API key)' });
  } else if (overBudget()) {
    // Don't start the slow reviewer if we'd risk blowing the Stop-hook timeout.
    budgetHit = true;
    skipped.push({ tier: 'intent', reason: `time budget (${cfg.budgetSec}s) reached before intent review` });
  } else {
    ranTiers.push('intent');
    built = buildChunks(diff.perFile, cfg);
    if (built.skippedFiles.length) {
      skipped.push({ tier: 'intent', reason: `${built.skippedFiles.length} file(s) beyond maxReviewFiles not reviewed` });
    }
    const bk = describeBackends(cfg);
    if (bk.map) {
      const cross = bk.verify && bk.verify !== bk.map;
      coverageNotes.push(`reviewer: map=${bk.map}, verify=${bk.verify ?? bk.map}${cross ? ' (cross-model)' : ''}`);
    }
    const reviewFindings = await deps.reviewIntent({
      proj,
      intent,
      cfg,
      chunks: built.chunks,
      deadlineMs: startedAt + cfg.budgetSec * 1000,
      onNote: (s) => coverageNotes.push(s),
    });
    findings.push(...reviewFindings);
  }

  // Tier 3 (web smoke) is experimental and not yet wired. If a user opts in,
  // say so explicitly rather than silently doing nothing.
  if (cfg.tiers.smoke) {
    skipped.push({ tier: 'smoke', reason: 'web smoke tier is experimental and not yet available in this build' });
  }

  // ---- Filter dismissed + dedupe + redact secrets ----
  findings = dedupe(filterDismissed(findings, loadDismissals(proj))).map(redactFinding);

  const blocking = findings.filter((f) => f.kind === 'blocking');
  const questions = findings.filter((f) => f.kind === 'question');
  const notices = findings.filter((f) => f.kind === 'info');

  const fixPrompt = blocking.length ? buildFixPrompt(blocking, questions, opts.roundInfo, notices) : '';

  const coverage: CoverageReport = {
    filesChanged: diff.perFile.length,
    filesReviewed: built ? built.includedFiles.length : 0,
    filesSkippedTooLarge: built ? [...built.skippedFiles, ...built.clippedFiles] : [],
    chunksReviewed: built ? built.chunks.length : 0,
    packagesScoped: scopedPkgs.map((p) => p.name),
    testsSelected,
    budgetHit,
    notes: coverageNotes,
  };

  return {
    diffEmpty,
    ranTiers,
    skipped,
    findings,
    blocking,
    questions,
    notices,
    fixPrompt,
    summary: summaryLine(blocking, questions, notices),
    coverage,
  };
}
