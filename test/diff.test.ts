import { describe, it, expect, afterEach } from 'vitest';
import { workingDiff, isGitRepo } from '../src/core/diff';
import { tmpProj, rm, write, gitInit, gitCommitAll } from './helpers';

describe('workingDiff (real git)', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.forEach(rm));

  it('reports non-git directories cleanly', () => {
    const proj = tmpProj();
    dirs.push(proj);
    expect(isGitRepo(proj)).toBe(false);
    const d = workingDiff(proj);
    expect(d.isGit).toBe(false);
    expect(d.patch).toBe('');
  });

  it('captures a working-tree change vs HEAD', () => {
    const proj = tmpProj();
    dirs.push(proj);
    gitInit(proj);
    write(proj, 'a.txt', 'one\n');
    gitCommitAll(proj);
    write(proj, 'a.txt', 'two\n');
    const d = workingDiff(proj);
    expect(d.isGit).toBe(true);
    expect(d.patch).toMatch(/a\.txt/);
    expect(d.patch).toMatch(/\+two/);
    expect(d.files).toContain('a.txt');
    expect(d.hash).not.toBe('');
  });

  it('includes untracked new files but EXCLUDES the .vouch memory dir', () => {
    const proj = tmpProj();
    dirs.push(proj);
    gitInit(proj);
    write(proj, 'init.txt', 'x\n');
    gitCommitAll(proj);
    write(proj, 'newfile.ts', 'export const x = 1;\n');
    write(proj, '.vouch/config.json', '{"version":1}');
    write(proj, '.vouch/runs/state.json', '{"iteration":2}');
    const d = workingDiff(proj);
    expect(d.patch).toMatch(/newfile\.ts/);
    expect(d.patch).not.toMatch(/\.vouch/); // our own memory must never appear in the diff
  });

  it('is empty when the working tree matches HEAD (ignoring .vouch churn)', () => {
    const proj = tmpProj();
    dirs.push(proj);
    gitInit(proj);
    write(proj, 'a.txt', 'one\n');
    gitCommitAll(proj);
    // Only .vouch changes since commit → should read as no change to verify.
    write(proj, '.vouch/runs/dirty', '123\n');
    expect(workingDiff(proj).patch).toBe('');
  });
});
