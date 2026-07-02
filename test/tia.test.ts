import { describe, it, expect, afterEach } from 'vitest';
import { selectTests } from '../src/core/tia';
import { tmpProj, rm, write } from './helpers';

describe('selectTests (test impact analysis with safe fallback)', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.forEach(rm));
  const proj = () => {
    const p = tmpProj();
    dirs.push(p);
    return p;
  };

  it('falls back to full suite when disabled', () => {
    const r = selectTests({ proj: proj(), testCmd: 'jest', changedFiles: ['a.ts'], enabled: false });
    expect(r.narrowed).toBe(false);
    expect(r.selectedCount).toBeNull();
  });

  it('falls back to full suite when a root/config file changed', () => {
    const p = proj();
    write(p, 'package.json', JSON.stringify({ scripts: { test: 'jest' } }));
    write(p, 'src/a.ts', 'export const a = 1;');
    const r = selectTests({ proj: p, testCmd: 'npm test', changedFiles: ['package.json', 'src/a.ts'], enabled: true });
    expect(r.narrowed).toBe(false);
    expect(r.reason).toMatch(/root\/config/);
  });

  it('narrows jest via an npm script using -- --findRelatedTests', () => {
    const p = proj();
    write(p, 'package.json', JSON.stringify({ scripts: { test: 'jest' } }));
    write(p, 'src/a.ts', 'export const a = 1;');
    const r = selectTests({ proj: p, testCmd: 'npm test', changedFiles: ['src/a.ts'], enabled: true });
    expect(r.narrowed).toBe(true);
    expect(r.selectedCount).toBe(1);
    expect(r.command).toContain('-- --findRelatedTests');
    expect(r.command).toContain("'src/a.ts'"); // shell-quoted (single quotes), not raw
    expect(r.command).toContain('--passWithNoTests');
  });

  it('narrows a direct vitest invocation via `vitest related`', () => {
    const p = proj();
    write(p, 'src/a.ts', 'export const a = 1;');
    const r = selectTests({ proj: p, testCmd: 'vitest run', changedFiles: ['src/a.ts'], enabled: true });
    expect(r.narrowed).toBe(true);
    expect(r.command).toMatch(/^vitest related /);
    expect(r.command).toContain('--run');
  });

  it('falls back to full suite for an unrecognized runner', () => {
    const p = proj();
    write(p, 'src/a.ts', 'x');
    const r = selectTests({ proj: p, testCmd: 'make test', changedFiles: ['src/a.ts'], enabled: true });
    expect(r.narrowed).toBe(false);
    expect(r.reason).toMatch(/unrecognized/);
  });

  it('falls back to full suite when no changed source files exist', () => {
    const p = proj();
    write(p, 'package.json', JSON.stringify({ scripts: { test: 'jest' } }));
    const r = selectTests({ proj: p, testCmd: 'npm test', changedFiles: ['docs/readme.md'], enabled: true });
    expect(r.narrowed).toBe(false);
  });
});
