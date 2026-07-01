// The deterministic evidence gate — the single load-bearing anti-hallucination
// guarantee. Research finding: LLMs cite unfaithfully ~50% of the time, so the
// ONLY hard guarantee is a non-ML outer check. Every grounded (behavioral)
// finding must quote the offending code verbatim; if that quote does not appear
// literally in the cited file (whitespace-normalized), the finding is a
// fabrication and is dropped. Deterministic facts (test/lint/build failures)
// carry no `evidence` and pass through untouched.
import { Finding } from '../types';

export function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface GroundResult {
  kept: Finding[];
  dropped: { finding: Finding; reason: string }[];
}

/** A finding is "grounded" (subject to the gate) if it came from the LLM
 *  reviewer — i.e. it's on the intent tier or it carries an evidence quote.
 *  Deterministic-tool findings are never gated. */
function isGrounded(f: Finding): boolean {
  return f.tier === 'intent' || f.evidence !== undefined;
}

export function groundFindings(findings: Finding[], readFile: (relPath: string) => string | null): GroundResult {
  const kept: Finding[] = [];
  const dropped: { finding: Finding; reason: string }[] = [];

  for (const f of findings) {
    if (!isGrounded(f)) {
      kept.push(f);
      continue;
    }
    if (!f.evidence || !f.evidence.trim()) {
      dropped.push({ finding: f, reason: 'no verbatim evidence quoted' });
      continue;
    }
    if (!f.file) {
      dropped.push({ finding: f, reason: 'no file cited' });
      continue;
    }
    const content = readFile(f.file);
    if (content == null) {
      dropped.push({ finding: f, reason: `cited file not readable: ${f.file}` });
      continue;
    }
    const needle = normalizeWs(f.evidence);
    if (needle.length < 3) {
      dropped.push({ finding: f, reason: 'evidence too short to verify' });
      continue;
    }
    if (!normalizeWs(content).includes(needle)) {
      dropped.push({ finding: f, reason: 'quoted evidence not found in cited file (fabricated)' });
      continue;
    }
    kept.push(f);
  }

  return { kept, dropped };
}
