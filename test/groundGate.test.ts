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

describe('deterministic evidence gate (model-agnostic)', () => {
  it('passes deterministic facts through untouched', () => {
    const fact = makeFinding({ kind: 'blocking', tier: 'test', title: 'test failed', command: 'npm test', confidence: 'fact', fpExtra: ['x'] });
    expect(groundFindings([fact], reader).kept).toHaveLength(1);
  });

  it('drops a finding with no file, or an unreadable (fabricated) file', () => {
    expect(groundFindings([intentFinding({ file: undefined, evidence: 'x' })], reader).kept).toHaveLength(0);
    expect(groundFindings([intentFinding({ file: 'nope.ts', evidence: 'return n;' })], reader).kept).toHaveLength(0);
  });

  it('keeps a real-file finding and flags verbatim=true when the evidence quote matches', () => {
    const r = groundFindings([intentFinding({ evidence: 'if (n < 0)   return 0;' })], reader);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0].evidenceVerbatim).toBe(true);
  });

  it('keeps a real-file finding with prose/non-matching evidence but flags verbatim=false (relies on CoVe)', () => {
    const r = groundFindings([intentFinding({ evidence: 'the upper bound is not handled' })], reader);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0].evidenceVerbatim).toBe(false);
  });

  it('normalizeWs collapses whitespace + lowercases', () => {
    expect(normalizeWs('  Foo\n  Bar ')).toBe('foo bar');
  });
});
