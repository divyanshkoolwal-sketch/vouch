import { describe, it, expect } from 'vitest';
import { parseFindingsJSON, mapReviewFindings } from '../src/core/reviewer';
import { defaultConfig } from '../src/core/config';

describe('parseFindingsJSON', () => {
  it('parses a clean object', () => {
    expect(parseFindingsJSON('{"findings":[{"title":"x"}]}')).toEqual([{ title: 'x' }]);
  });
  it('strips code fences', () => {
    expect(parseFindingsJSON('```json\n{"findings":[{"title":"y"}]}\n```')).toEqual([{ title: 'y' }]);
  });
  it('tolerates surrounding prose', () => {
    expect(parseFindingsJSON('Here you go:\n{"findings":[{"title":"z"}]}\nThanks')).toEqual([{ title: 'z' }]);
  });
  it('returns [] on garbage (never throws)', () => {
    expect(parseFindingsJSON('not json at all')).toEqual([]);
    expect(parseFindingsJSON('')).toEqual([]);
  });
});

describe('mapReviewFindings blockOn gating', () => {
  const raw = [{ severity: 'blocking', title: 'criterion unmet', criterion: 'X', detail: 'because' }];

  it('downgrades blocking → question by default (intent not in blockOn)', () => {
    const out = mapReviewFindings(raw, defaultConfig());
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('question');
    expect(out[0].tier).toBe('intent');
  });

  it('keeps blocking when intent is opted into blockOn', () => {
    const cfg = defaultConfig();
    cfg.enforcement.blockOn = ['typecheck', 'build', 'test', 'intent'];
    expect(mapReviewFindings(raw, cfg)[0].kind).toBe('blocking');
  });

  it('a question severity is always a question', () => {
    const cfg = defaultConfig();
    cfg.enforcement.blockOn = ['intent'];
    const out = mapReviewFindings([{ severity: 'question', title: 'maybe?' }], cfg);
    expect(out[0].kind).toBe('question');
  });

  it('skips malformed entries', () => {
    expect(mapReviewFindings([null, {}, { title: 42 }, { title: 'ok' }] as any, defaultConfig())).toHaveLength(1);
  });
});
