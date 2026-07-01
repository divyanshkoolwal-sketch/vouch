import { describe, it, expect } from 'vitest';
import { extractJSON } from '../src/core/review/claude';
import { mapChunkFindings } from '../src/core/review/map';
import { defaultConfig } from '../src/core/config';

describe('extractJSON', () => {
  it('parses a clean object', () => {
    expect(extractJSON('{"findings":[{"title":"x"}]}')).toEqual({ findings: [{ title: 'x' }] });
  });
  it('strips code fences', () => {
    expect(extractJSON('```json\n{"findings":[{"title":"y"}]}\n```')).toEqual({ findings: [{ title: 'y' }] });
  });
  it('tolerates surrounding prose', () => {
    expect(extractJSON('Here you go:\n{"findings":[]}\nThanks')).toEqual({ findings: [] });
  });
  it('returns null on garbage (never throws)', () => {
    expect(extractJSON('not json at all')).toBeNull();
    expect(extractJSON('')).toBeNull();
  });
});

describe('mapChunkFindings blockOn gating + grounding fields', () => {
  const raw = {
    findings: [
      { severity: 'blocking', title: 'criterion unmet', criterion: 'X', detail: 'because', file: 'a.ts', startLine: 10, endLine: 12, evidence: 'return n;', confidence: 0.9 },
    ],
  };

  it('downgrades blocking → question by default (intent not in blockOn)', () => {
    const out = mapChunkFindings(raw, defaultConfig());
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('question');
    expect(out[0].tier).toBe('intent');
    expect(out[0].evidence).toBe('return n;');
    expect(out[0].startLine).toBe(10);
    expect(out[0].criterion).toBe('X');
    expect(out[0].score).toBeCloseTo(0.9);
  });

  it('keeps blocking when intent is opted into blockOn', () => {
    const cfg = defaultConfig();
    cfg.enforcement.blockOn = ['typecheck', 'build', 'test', 'intent'];
    expect(mapChunkFindings(raw, cfg)[0].kind).toBe('blocking');
  });

  it('a question severity is always a question', () => {
    const cfg = defaultConfig();
    cfg.enforcement.blockOn = ['intent'];
    expect(mapChunkFindings({ findings: [{ severity: 'question', title: 'maybe?' }] }, cfg)[0].kind).toBe('question');
  });

  it('skips malformed entries', () => {
    expect(mapChunkFindings({ findings: [null, {}, { title: 42 }, { title: 'ok' }] } as any, defaultConfig())).toHaveLength(1);
  });
});
