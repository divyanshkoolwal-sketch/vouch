// Tier 2 orchestrator: the INDEPENDENT, grounded, verified intent review.
// Flow: chunks → map (parallel grounded review) → reduce (dedupe/rank) →
// deterministic evidence gate (drop fabrications) → independent CoVe quorum
// verification (drop refuted). Every stage degrades gracefully; a failed LLM
// call is never surfaced as a code finding.
import * as fs from 'fs';
import * as path from 'path';
import { Finding, IntentRecord, VouchConfig } from './types';
import { backendAvailable } from './review/backends';
import { ReviewChunk, reviewChunk } from './review/map';
import { reduceFindings } from './review/reduce';
import { groundFindings } from './review/groundGate';
import { verifyFindings } from './review/verify';
import { mapLimit } from './review/concurrency';

export function reviewerAvailable(cfg: VouchConfig): boolean {
  return backendAvailable(cfg);
}

function fileReader(proj: string): (rel: string) => string | null {
  return (rel: string) => {
    try {
      return fs.readFileSync(path.join(proj, rel), 'utf8');
    } catch {
      return null;
    }
  };
}

export interface ReviewDeps {
  reviewChunk: typeof reviewChunk;
  verifyFindings: typeof verifyFindings;
}

/** Run the full grounded review over pre-built chunks. Returns verified,
 *  evidence-grounded findings only. */
export async function reviewIntent(opts: {
  proj: string;
  intent: IntentRecord;
  cfg: VouchConfig;
  chunks: ReviewChunk[];
  deps?: Partial<ReviewDeps>;
}): Promise<Finding[]> {
  const { proj, intent, cfg, chunks } = opts;
  if (!chunks.length) return [];
  const rc = opts.deps?.reviewChunk ?? reviewChunk;
  const vf = opts.deps?.verifyFindings ?? verifyFindings;

  // MAP — parallel grounded review of each chunk.
  const mapped = (await mapLimit(chunks, cfg.review.concurrency, (chunk) => rc({ proj, intent, chunk, cfg }))).flat();

  // REDUCE — dedupe + rank.
  const reduced = reduceFindings(mapped);

  // GATE — drop any finding whose quoted evidence isn't literally in the code.
  const grounded = groundFindings(reduced, fileReader(proj)).kept;

  // VERIFY — independent CoVe quorum. Fast mode has no verification, so only
  // verbatim-grounded findings (the strong deterministic signal) are surfaced.
  if (grounded.length === 0) return grounded;
  if (cfg.mode === 'fast') return grounded.filter((f) => f.evidenceVerbatim);
  return vf(grounded, { proj, intent, cfg });
}
