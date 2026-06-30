import { describe, it, expect } from 'vitest';
import { fingerprint, makeFinding, dedupe } from '../src/core/findings';

describe('fingerprint', () => {
  it('is stable across whitespace/case noise', () => {
    expect(fingerprint(['Test', 'Hello  World'])).toBe(fingerprint(['test', 'hello world']));
  });
  it('differs for different content', () => {
    expect(fingerprint(['a'])).not.toBe(fingerprint(['b']));
  });
  it('ignores undefined parts', () => {
    expect(fingerprint(['a', undefined, 'b'])).toBe(fingerprint(['a', 'b']));
  });
});

describe('makeFinding', () => {
  it('derives a stable id from tier+title+file+extras (not from volatile detail)', () => {
    const a = makeFinding({ kind: 'blocking', tier: 'test', title: 'test failed', command: 'npm test', confidence: 'fact', detail: 'run #1 output', fpExtra: ['npm test'] });
    const b = makeFinding({ kind: 'blocking', tier: 'test', title: 'test failed', command: 'npm test', confidence: 'fact', detail: 'run #2 DIFFERENT output', fpExtra: ['npm test'] });
    expect(a.id).toBe(b.id);
  });
});

describe('dedupe', () => {
  it('collapses by id, keeping the most severe kind', () => {
    const q = makeFinding({ kind: 'question', tier: 'intent', title: 'x', confidence: 'medium', fpExtra: ['k'] });
    const b = makeFinding({ kind: 'blocking', tier: 'intent', title: 'x', confidence: 'high', fpExtra: ['k'] });
    const out = dedupe([q, b]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('blocking');
  });
});
