// Finding construction, fingerprinting, and dedupe.
import { createHash } from 'crypto';
import { Finding, FindingKind, TierName, Confidence } from './types';

/** Stable short fingerprint. Deliberately excludes volatile content (line
 *  numbers, full output) so the *same* underlying issue maps to the *same* id
 *  across runs — which is what makes dismissal-suppression work. */
export function fingerprint(parts: (string | undefined)[]): string {
  const norm = parts
    .filter((p): p is string => !!p)
    .map((p) => p.trim().toLowerCase().replace(/\s+/g, ' '))
    .join('');
  return createHash('sha1').update(norm).digest('hex').slice(0, 12);
}

export function makeFinding(input: {
  kind: FindingKind;
  tier: TierName;
  title: string;
  detail?: string;
  file?: string;
  line?: number;
  command?: string;
  confidence: Confidence;
  /** Extra tokens to fold into the fingerprint beyond tier+title+file. */
  fpExtra?: string[];
}): Finding {
  const id = fingerprint([input.tier, input.title, input.file, ...(input.fpExtra ?? [])]);
  return {
    id,
    kind: input.kind,
    tier: input.tier,
    title: input.title,
    detail: input.detail,
    file: input.file,
    line: input.line,
    command: input.command,
    confidence: input.confidence,
  };
}

/** Dedupe by fingerprint, keeping the most severe instance (blocking > question
 *  > info). */
export function dedupe(findings: Finding[]): Finding[] {
  const rank: Record<FindingKind, number> = { blocking: 2, question: 1, info: 0 };
  const byId = new Map<string, Finding>();
  for (const f of findings) {
    const prev = byId.get(f.id);
    if (!prev || rank[f.kind] > rank[prev.kind]) byId.set(f.id, f);
  }
  return [...byId.values()];
}
