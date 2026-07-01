// Independent verification (Chain-of-Verification, adversarial variant). For
// each surviving grounded finding we spawn N *independent* skeptics, each asked
// to REFUTE the finding by examining the real code, defaulting to "not a real
// problem" unless it can be proven. A finding is kept only if a majority
// confirm it. Research: this removes far more false positives than true ones,
// and independence is essential (a verifier that just re-reads the draft
// re-confirms the hallucination).
import { Finding, IntentRecord, VouchConfig } from '../types';
import { runReviewer, extractJSON } from './backends';
import { mapLimit } from './concurrency';

const VERIFIER_SYSTEM = [
  'You are a strict, skeptical code verifier. An automated reviewer SUSPECTS a problem in a code change.',
  'Your job: independently determine whether the problem is REAL by examining the actual code (use Read/Grep/Glob to check surrounding code, definitions, and whether the concern is already handled elsewhere).',
  'Bias strongly toward "NOT a real problem": only confirm if you can concretely demonstrate it from the code. If the requirement is satisfied elsewhere, or you cannot prove the problem, mark it not real.',
  'Do not be swayed by the reviewer\'s confidence. Reason from the code itself.',
  'Output a SINGLE JSON object, no prose: {"real": true|false, "reason": "<short, cite code>", "confidence": <0..1>}',
].join('\n');

function buildVerifierPrompt(finding: Finding, intent: IntentRecord): string {
  return [
    `# INTENT\n${intent.summary}`,
    finding.criterion ? `\n# RELEVANT ACCEPTANCE CRITERION\n${finding.criterion}` : '',
    `\n# SUSPECTED PROBLEM (verify or refute)\n${finding.title}\n${finding.detail ?? ''}`,
    finding.file ? `\n# LOCATION\n${finding.file}${finding.startLine ? `:${finding.startLine}-${finding.endLine ?? finding.startLine}` : ''}` : '',
    finding.evidence ? `\n# CODE THE REVIEWER QUOTED\n\`\`\`\n${finding.evidence}\n\`\`\`` : '',
    '\nExamine the real code and decide. Return the JSON verdict now.',
  ]
    .filter(Boolean)
    .join('\n');
}

async function askOne(proj: string, finding: Finding, intent: IntentRecord, cfg: VouchConfig): Promise<boolean | null> {
  const res = await runReviewer(
    {
      cwd: proj,
      systemPrompt: VERIFIER_SYSTEM,
      userPrompt: buildVerifierPrompt(finding, intent),
      model: cfg.reviewer.model,
      timeoutSec: cfg.reviewer.timeoutSec,
      maxTurns: 6,
    },
    cfg,
  );
  if (!res || res.isError) return null;
  const parsed = extractJSON(res.text);
  if (!parsed || typeof parsed.real !== 'boolean') return null;
  return parsed.real;
}

export interface VerifyDeps {
  askOne: typeof askOne;
}

/** Verify findings via an N-vote independent quorum. Returns the findings that
 *  survived, with `verified` set and `score` updated to the agreement fraction.
 *  Null votes (failed calls) abstain — they neither confirm nor refute. */
export async function verifyFindings(
  findings: Finding[],
  opts: { proj: string; intent: IntentRecord; cfg: VouchConfig; deps?: Partial<VerifyDeps> },
): Promise<Finding[]> {
  const ask = opts.deps?.askOne ?? askOne;
  const n = Math.max(1, opts.cfg.review.quorumN);

  // Flatten (finding × vote) so the global concurrency cap applies across all calls.
  const tasks: { fi: number }[] = [];
  findings.forEach((_, fi) => {
    for (let v = 0; v < n; v++) tasks.push({ fi });
  });

  const votes = await mapLimit(tasks, opts.cfg.review.concurrency, (t) =>
    ask(opts.proj, findings[t.fi], opts.intent, opts.cfg),
  );

  const kept: Finding[] = [];
  findings.forEach((f, fi) => {
    const mine = votes.filter((_, i) => tasks[i].fi === fi);
    const real = mine.filter((v) => v === true).length;
    const refuted = mine.filter((v) => v === false).length;
    const decided = real + refuted;
    // Majority of DECIDED votes must confirm. If all votes abstained (failed
    // calls), fall back to keeping the finding as unverified (don't silently drop
    // due to our own tool failure).
    const confirmed = decided === 0 ? false : real > refuted;
    const agreement = decided === 0 ? f.score ?? 0.5 : real / decided;

    if (decided === 0) {
      // No CoVe signal (all calls abstained/failed): surface only if the model
      // already grounded it with a verbatim code quote; otherwise drop (no
      // grounding + no confirmation).
      if (f.evidenceVerbatim) kept.push({ ...f, verified: false, score: f.score ?? 0.5 });
    } else if (confirmed && agreement >= opts.cfg.review.minConfidence) {
      kept.push({ ...f, verified: true, score: agreement });
    }
    // else: refuted or below threshold → dropped
  });

  return kept;
}
