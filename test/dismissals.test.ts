import { describe, it, expect, afterEach } from 'vitest';
import { addDismissal, isDismissed, loadDismissals, filterDismissed } from '../src/core/dismissals';
import { makeFinding } from '../src/core/findings';
import { tmpProj, rm } from './helpers';

describe('dismissals', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.forEach(rm));

  it('persists and suppresses a dismissed fingerprint', () => {
    const proj = tmpProj();
    dirs.push(proj);
    const f = makeFinding({ kind: 'question', tier: 'intent', title: 'maybe wrong', confidence: 'medium', fpExtra: ['c1'] });
    expect(isDismissed(proj, f.id)).toBe(false);
    addDismissal(proj, f.id, 'intentional', new Date().toISOString());
    expect(isDismissed(proj, f.id)).toBe(true);
    expect(filterDismissed([f], loadDismissals(proj))).toHaveLength(0);
  });

  it('is idempotent (no duplicate entries)', () => {
    const proj = tmpProj();
    dirs.push(proj);
    addDismissal(proj, 'abc', 'r', new Date().toISOString());
    addDismissal(proj, 'abc', 'r again', new Date().toISOString());
    expect(loadDismissals(proj).filter((d) => d.fingerprint === 'abc')).toHaveLength(1);
  });
});
