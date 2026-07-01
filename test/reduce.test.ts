import { describe, it, expect } from 'vitest';
import { reduceFindings } from '../src/core/review/reduce';
import { makeFinding } from '../src/core/findings';
import { Finding } from '../src/core/types';

const mk = (kind: Finding['kind'], title: string, score: number): Finding => ({
  ...makeFinding({ kind, tier: 'intent', title, confidence: 'medium', fpExtra: [title] }),
  score,
});

describe('reduceFindings', () => {
  it('dedupes and ranks blocking above questions, then by score', () => {
    const dupA = mk('question', 'A', 0.6);
    const out = reduceFindings([mk('question', 'B', 0.3), mk('blocking', 'C', 0.1), dupA, dupA]);
    expect(out.map((f) => f.title)).toEqual(['C', 'A', 'B']); // blocking first, then score desc; dup collapsed
    expect(out).toHaveLength(3);
  });
});
