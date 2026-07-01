import { describe, it, expect } from 'vitest';
import { verifyFindings } from '../src/core/review/verify';
import { makeFinding } from '../src/core/findings';
import { defaultConfig } from '../src/core/config';
import { Finding, IntentRecord } from '../src/core/types';

const intent: IntentRecord = { id: 'i', summary: 's', acceptance_criteria: [], created: '', status: 'active' };
const cfg = () => {
  const c = defaultConfig();
  c.review.quorumN = 3;
  c.review.concurrency = 4;
  c.review.minConfidence = 0.5;
  return c;
};
const f = (title: string): Finding => ({ ...makeFinding({ kind: 'question', tier: 'intent', title, confidence: 'medium', fpExtra: [title] }), evidence: 'x', file: 'a.ts' });

describe('CoVe quorum verification', () => {
  it('keeps a finding the majority CONFIRM, marks it verified with agreement score', async () => {
    const votes: Record<string, boolean[]> = { real: [true, true, false] };
    let i = 0;
    const kept = await verifyFindings([f('real')], {
      proj: '/x', intent, cfg: cfg(),
      deps: { askOne: async () => votes.real[i++] },
    });
    expect(kept).toHaveLength(1);
    expect(kept[0].verified).toBe(true);
    expect(kept[0].score).toBeCloseTo(2 / 3);
  });

  it('drops a finding the majority REFUTE', async () => {
    const seq = [false, false, true];
    let i = 0;
    const kept = await verifyFindings([f('bogus')], { proj: '/x', intent, cfg: cfg(), deps: { askOne: async () => seq[i++] } });
    expect(kept).toHaveLength(0);
  });

  it('keeps as UNVERIFIED when all votes abstain (tool failure never silently drops)', async () => {
    const kept = await verifyFindings([f('abstain')], { proj: '/x', intent, cfg: cfg(), deps: { askOne: async () => null } });
    expect(kept).toHaveLength(1);
    expect(kept[0].verified).toBe(false);
  });

  it('runs quorumN votes per finding', async () => {
    let calls = 0;
    await verifyFindings([f('a'), f('b')], { proj: '/x', intent, cfg: cfg(), deps: { askOne: async () => { calls++; return true; } } });
    expect(calls).toBe(2 * 3); // 2 findings × quorumN(3)
  });
});
