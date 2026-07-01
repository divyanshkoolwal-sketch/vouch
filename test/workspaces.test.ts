import { describe, it, expect, afterEach } from 'vitest';
import { detectWorkspaces, affectedPackages } from '../src/core/workspaces';
import { tmpProj, rm, write } from './helpers';

describe('detectWorkspaces', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.forEach(rm));

  it('detects pnpm workspaces from pnpm-workspace.yaml', () => {
    const p = tmpProj();
    dirs.push(p);
    write(p, 'pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
    write(p, 'pnpm-lock.yaml', '');
    write(p, 'packages/api/package.json', '{"name":"@x/api"}');
    write(p, 'packages/web/package.json', '{"name":"@x/web"}');
    const ws = detectWorkspaces(p);
    expect(ws.isMonorepo).toBe(true);
    expect(ws.tool).toBe('pnpm');
    expect(ws.packages.map((x) => x.name).sort()).toEqual(['@x/api', '@x/web']);
  });

  it('detects npm workspaces from package.json', () => {
    const p = tmpProj();
    dirs.push(p);
    write(p, 'package.json', JSON.stringify({ workspaces: ['apps/*'] }));
    write(p, 'apps/admin/package.json', '{"name":"admin"}');
    const ws = detectWorkspaces(p);
    expect(ws.isMonorepo).toBe(true);
    expect(ws.packages.map((x) => x.name)).toEqual(['admin']);
  });

  it('reports a single-package repo as not a monorepo', () => {
    const p = tmpProj();
    dirs.push(p);
    write(p, 'package.json', JSON.stringify({ name: 'solo' }));
    expect(detectWorkspaces(p).isMonorepo).toBe(false);
  });
});

describe('affectedPackages', () => {
  const pkgs = [
    { name: 'api', dir: 'packages/api' },
    { name: 'web', dir: 'packages/web' },
    { name: 'shared', dir: 'packages/shared' },
  ];
  it('maps changed files to owning packages by longest prefix', () => {
    const hit = affectedPackages(['packages/api/src/x.ts', 'packages/web/index.ts'], pkgs);
    expect(hit.map((p) => p.name).sort()).toEqual(['api', 'web']);
  });
  it('returns nothing for files outside any package', () => {
    expect(affectedPackages(['README.md'], pkgs)).toEqual([]);
  });
});
