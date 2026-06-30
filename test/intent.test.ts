import { describe, it, expect, afterEach } from 'vitest';
import { recordIntent, loadActiveIntent, clearActiveIntent } from '../src/core/intent';
import { tmpProj, rm } from './helpers';

describe('intent', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.forEach(rm));

  it('records, loads, and archives prior intent on supersede', () => {
    const proj = tmpProj();
    dirs.push(proj);
    expect(loadActiveIntent(proj)).toBeNull();

    const first = recordIntent(proj, { summary: 'first', acceptance_criteria: ['a', 'b'] }, new Date().toISOString());
    expect(loadActiveIntent(proj)?.id).toBe(first.id);
    expect(loadActiveIntent(proj)?.acceptance_criteria).toEqual(['a', 'b']);

    const second = recordIntent(proj, { summary: 'second', acceptance_criteria: ['c'] }, new Date().toISOString());
    const active = loadActiveIntent(proj);
    expect(active?.id).toBe(second.id);
    expect(active?.summary).toBe('second');
    expect(active?.id).not.toBe(first.id);
  });

  it('clears the active intent', () => {
    const proj = tmpProj();
    dirs.push(proj);
    recordIntent(proj, { summary: 's', acceptance_criteria: [] }, new Date().toISOString());
    clearActiveIntent(proj);
    expect(loadActiveIntent(proj)).toBeNull();
  });
});
