// REDUCE stage: merge findings from all chunks. Deliberately deterministic
// (dedupe + rank) rather than another LLM pass — a summarizing LLM call would
// re-introduce a hallucination surface we just spent two gates removing.
import { Finding, FindingKind } from '../types';
import { dedupe } from '../findings';

const KIND_RANK: Record<FindingKind, number> = { blocking: 2, question: 1, info: 0 };

export function reduceFindings(findings: Finding[]): Finding[] {
  return dedupe(findings).sort((a, b) => {
    if (KIND_RANK[a.kind] !== KIND_RANK[b.kind]) return KIND_RANK[b.kind] - KIND_RANK[a.kind];
    return (b.score ?? 0) - (a.score ?? 0);
  });
}
