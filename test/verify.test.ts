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
const f = (title: string, verbatim = true): Finding => ({
  ...makeFinding({ kind: 'question', tier: 'intent', title, confidence: 'medium', fpExtra: [title] }),
  evidence: 'x',
  file: 'a.ts',
  evidenceVerbatim: verbatim,
});

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

  it('on all-abstain: keeps a VERBATIM-grounded finding (unverified) but DROPS a prose-only one', async () => {
    const keptVerbatim = await verifyFindings([f('abstain', true)], { proj: '/x', intent, cfg: cfg(), deps: { askOne: async () => null } });
    expect(keptVerbatim).toHaveLength(1);
    expect(keptVerbatim[0].verified).toBe(false);
    const keptProse = await verifyFindings([f('abstain', false)], { proj: '/x', intent, cfg: cfg(), deps: { askOne: async () => null } });
    expect(keptProse).toHaveLength(0);
  });

  it('runs quorumN votes per finding', async () => {
    let calls = 0;
    await verifyFindings([f('a'), f('b')], { proj: '/x', intent, cfg: cfg(), deps: { askOne: async () => { calls++; return true; } } });
    expect(calls).toBe(2 * 3); // 2 findings × quorumN(3)
  });
});
