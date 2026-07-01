import { describe, it, expect } from 'vitest';
import { numberPatch, buildChunks } from '../src/core/review/chunk';
import { defaultConfig } from '../src/core/config';
import { FileDiff } from '../src/core/diff';

describe('numberPatch', () => {
  it('adds absolute new-side line numbers to added + context lines, marks removals', () => {
    const patch = ['@@ -1,2 +1,3 @@', ' const a = 1;', '-const b = 2;', '+const b = 3;', '+const c = 4;'].join('\n');
    const out = numberPatch(patch);
    expect(out).toMatch(/^1:  const a = 1;/m);
    expect(out).toMatch(/^2: \+const b = 3;/m);
    expect(out).toMatch(/^3: \+const c = 4;/m);
    expect(out).toMatch(/-const b = 2;/); // removed line marked, not numbered on new side
  });
});

describe('buildChunks', () => {
  const mk = (file: string, added: number): FileDiff => ({ file, addedLines: added, patch: `diff --git a/${file} b/${file}\n@@ -1 +1,${added} @@\n` + Array.from({ length: added }, (_, i) => `+line${i}`).join('\n') });

  it('ranks bigger changes first and one chunk per small file', () => {
    const cfg = defaultConfig();
    const res = buildChunks([mk('small.ts', 2), mk('big.ts', 20)], cfg);
    expect(res.chunks[0].label).toBe('big.ts');
    expect(res.includedFiles).toEqual(['big.ts', 'small.ts']);
    expect(res.skippedFiles).toEqual([]);
  });

  it('caps at maxReviewFiles and records the rest as skipped (honest coverage)', () => {
    const cfg = defaultConfig();
    cfg.review.maxReviewFiles = 1;
    const res = buildChunks([mk('a.ts', 10), mk('b.ts', 5)], cfg);
    expect(res.includedFiles).toEqual(['a.ts']);
    expect(res.skippedFiles).toEqual(['b.ts']);
  });

  it('splits an oversized file across multiple chunks instead of truncating', () => {
    const cfg = defaultConfig();
    cfg.review.chunkTokenBudget = 30; // ~120 chars → force splitting
    const big: FileDiff = {
      file: 'huge.ts',
      addedLines: 6,
      patch: 'diff --git a/huge.ts b/huge.ts\n' + [1, 2, 3].map((h) => `@@ -${h} +${h},2 @@\n+aaaaaaaaaaaaaaaaaaaa${h}\n+bbbbbbbbbbbbbbbbbbbb${h}`).join('\n'),
    };
    const res = buildChunks([big], cfg);
    expect(res.chunks.length).toBeGreaterThan(1);
    expect(res.chunks.every((c) => c.label.startsWith('huge.ts'))).toBe(true);
  });
});
