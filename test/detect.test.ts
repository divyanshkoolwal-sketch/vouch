import { describe, it, expect, afterEach } from 'vitest';
import { detect } from '../src/core/detect';
import { tmpProj, rm, write } from './helpers';

describe('detect', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.forEach(rm));

  it('reads npm scripts and infers tsc from tsconfig', () => {
    const proj = tmpProj();
    dirs.push(proj);
    write(proj, 'package.json', JSON.stringify({ scripts: { test: 'jest', lint: 'eslint .', build: 'tsc -b' } }));
    write(proj, 'tsconfig.json', '{}');
    const d = detect(proj);
    expect(d.ecosystem).toContain('node');
    expect(d.commands.test?.cmd).toBe('npm test');
    expect(d.commands.lint?.cmd).toBe('npm run lint');
    expect(d.commands.build?.cmd).toBe('npm run build');
    // no explicit typecheck script, but tsconfig present → suggest tsc --noEmit
    expect(d.commands.typecheck?.cmd).toMatch(/tsc --noEmit/);
  });

  it('prefers pnpm when a pnpm lockfile exists', () => {
    const proj = tmpProj();
    dirs.push(proj);
    write(proj, 'package.json', JSON.stringify({ scripts: { test: 'vitest' } }));
    write(proj, 'pnpm-lock.yaml', '');
    expect(detect(proj).commands.test?.cmd).toBe('pnpm test');
  });

  it('detects python pytest + ruff + mypy from pyproject', () => {
    const proj = tmpProj();
    dirs.push(proj);
    write(proj, 'pyproject.toml', '[tool.pytest.ini_options]\n[tool.ruff]\n[tool.mypy]\n');
    const d = detect(proj);
    expect(d.ecosystem).toContain('python');
    expect(d.commands.test?.cmd).toBe('pytest -q');
    expect(d.commands.lint?.cmd).toBe('ruff check .');
    expect(d.commands.typecheck?.cmd).toBe('mypy .');
  });

  it('returns a helpful note when nothing is detected', () => {
    const proj = tmpProj();
    dirs.push(proj);
    const d = detect(proj);
    expect(Object.keys(d.commands)).toHaveLength(0);
    expect(d.notes.join(' ')).toMatch(/No check commands/i);
  });
});
