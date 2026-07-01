import { describe, it, expect } from 'vitest';
import { groundFindings, normalizeWs } from '../src/core/review/groundGate';
import { makeFinding } from '../src/core/findings';
import { Finding } from '../src/core/types';

const file = 'src/clamp.ts';
const content = 'export function clamp(n: number) {\n  if (n < 0) return 0;\n  return n;\n}\n';
const reader = (rel: string) => (rel === file ? content : null);

function intentFinding(over: Partial<Finding> = {}): Finding {
  return { ...makeFinding({ kind: 'question', tier: 'intent', title: 't', confidence: 'medium', fpExtra: [Math.random().toString()] }), file, ...over };
}

describe('deterministic evidence gate', () => {
  it('passes deterministic facts through untouched (no evidence required)', () => {
    const fact = makeFinding({ kind: 'blocking', tier: 'test', title: 'test failed', command: 'npm test', confidence: 'fact', fpExtra: ['x'] });
    expect(groundFindings([fact], reader).kept).toHaveLength(1);
  });

  it('drops a grounded finding with no evidence quote', () => {
    const r = groundFindings([intentFinding({ evidence: undefined })], reader);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/no verbatim evidence/);
  });

  it('drops a grounded finding whose evidence is NOT in the file (fabricated)', () => {
    const r = groundFindings([intentFinding({ evidence: 'if (n > 100) return 100;' })], reader);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/not found in cited file/);
  });

  it('keeps a grounded finding whose evidence IS in the file (whitespace-normalized)', () => {
    const r = groundFindings([intentFinding({ evidence: 'if (n < 0)   return 0;' })], reader);
    expect(r.kept).toHaveLength(1);
  });

  it('drops when the cited file is unreadable', () => {
    const r = groundFindings([intentFinding({ file: 'nope.ts', evidence: 'return n;' })], reader);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/not readable/);
  });

  it('normalizeWs collapses whitespace + lowercases', () => {
    expect(normalizeWs('  Foo\n  Bar ')).toBe('foo bar');
  });
});
