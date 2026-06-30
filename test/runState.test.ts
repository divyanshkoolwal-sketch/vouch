import { describe, it, expect, afterEach } from 'vitest';
import { loadState, saveState, isDirty, clearDirty, markDirty } from '../src/core/runState';
import { tmpProj, rm } from './helpers';

describe('runState', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.forEach(rm));

  it('defaults to a clean, zero-iteration state', () => {
    const proj = tmpProj();
    dirs.push(proj);
    expect(loadState(proj)).toEqual({ lastDiffHash: null, iteration: 0 });
  });

  it('round-trips state', () => {
    const proj = tmpProj();
    dirs.push(proj);
    saveState(proj, { lastDiffHash: 'abc', iteration: 2 });
    expect(loadState(proj)).toEqual({ lastDiffHash: 'abc', iteration: 2 });
  });

  it('tracks the dirty flag', () => {
    const proj = tmpProj();
    dirs.push(proj);
    expect(isDirty(proj)).toBe(false);
    markDirty(proj);
    expect(isDirty(proj)).toBe(true);
    clearDirty(proj);
    expect(isDirty(proj)).toBe(false);
  });
});
