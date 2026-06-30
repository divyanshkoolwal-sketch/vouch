import { describe, it, expect } from 'vitest';
import { buildFixPrompt, summaryLine } from '../src/core/prioritize';
import { makeFinding } from '../src/core/findings';

const blocking = makeFinding({ kind: 'blocking', tier: 'test', title: 'test failed (exit 1)', command: 'npm test', confidence: 'fact', detail: 'AssertionError: 2 !== 4', fpExtra: ['npm test'] });
const question = makeFinding({ kind: 'question', tier: 'intent', title: 'criterion "rejects >10MB" not handled', confidence: 'medium', detail: 'no size check found in upload handler', fpExtra: ['c'] });

describe('buildFixPrompt', () => {
  it('puts verified failures first, with command, evidence, and id', () => {
    const p = buildFixPrompt([blocking], [question], '(round 1/3)');
    expect(p).toMatch(/Must fix/);
    expect(p.indexOf('Must fix')).toBeLessThan(p.indexOf('Questions'));
    expect(p).toContain('npm test');
    expect(p).toContain('AssertionError');
    expect(p).toContain(blocking.id);
    expect(p).toContain('(round 1/3)');
  });
  it('mentions the dismissal path for false positives', () => {
    expect(buildFixPrompt([blocking], [])).toMatch(/dismiss_finding/);
  });
  it('lists non-blocking failures in their own section', () => {
    const notice = makeFinding({ kind: 'info', tier: 'lint', title: 'lint failed (exit 1)', command: 'npm run lint', confidence: 'fact', fpExtra: ['npm run lint'] });
    const p = buildFixPrompt([blocking], [], undefined, [notice]);
    expect(p).toMatch(/Also failing/);
    expect(p).toContain('npm run lint');
  });
});

describe('summaryLine', () => {
  it('reports counts', () => {
    expect(summaryLine([blocking], [question])).toBe('Vouch: 1 blocking, 1 question');
    expect(summaryLine([blocking, blocking], [])).toBe('Vouch: 2 blocking');
  });
  it('reports a clean pass', () => {
    expect(summaryLine([], [])).toMatch(/passed/);
  });
  it('counts non-blocking failures (notices)', () => {
    const notice = makeFinding({ kind: 'info', tier: 'lint', title: 'x', confidence: 'fact', fpExtra: ['k'] });
    expect(summaryLine([], [], [notice])).toMatch(/non-blocking failure/);
    expect(summaryLine([], [], [notice])).not.toMatch(/passed/);
  });
});
