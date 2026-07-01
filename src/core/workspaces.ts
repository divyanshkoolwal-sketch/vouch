// Monorepo detection + affected-package scoping. Detects JS/TS workspaces
// (npm/yarn/bun/pnpm, plus Nx/Turbo/Lerna markers) and Cargo/Go workspaces for
// reporting. Maps a set of changed files to the packages they belong to
// (longest-matching path prefix) so verification can be scoped to what actually
// changed on a huge repo.
import * as fs from 'fs';
import * as path from 'path';

export interface Pkg {
  name: string;
  dir: string; // relative to repo root, "" for root
}
export interface WorkspaceInfo {
  isMonorepo: boolean;
  tool: string; // pnpm | yarn | npm | bun | nx | turbo | lerna | cargo | go | none
  packageManager: string; // pnpm | yarn | npm | bun
  packages: Pkg[];
}

function readJSON(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function detectPackageManager(proj: string): string {
  if (fs.existsSync(path.join(proj, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(proj, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(proj, 'bun.lockb')) || fs.existsSync(path.join(proj, 'bun.lock'))) return 'bun';
  return 'npm';
}

/** Expand a simple workspace glob ("packages/*", "apps/*", exact paths) to
 *  directories that contain a package.json. Best-effort (no ** support). */
function expandGlob(proj: string, pattern: string): string[] {
  const clean = pattern.replace(/\/\*\*$/, '/*');
  if (clean.endsWith('/*')) {
    const base = clean.slice(0, -2);
    const baseDir = path.join(proj, base);
    try {
      return fs
        .readdirSync(baseDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(baseDir, d.name, 'package.json')))
        .map((d) => path.join(base, d.name));
    } catch {
      return [];
    }
  }
  return fs.existsSync(path.join(proj, clean, 'package.json')) ? [clean] : [];
}

function pkgFromDir(proj: string, dir: string): Pkg {
  const pj = readJSON(path.join(proj, dir, 'package.json'));
  return { name: pj?.name || path.basename(dir) || 'root', dir };
}

export function detectWorkspaces(proj: string): WorkspaceInfo {
  const pm = detectPackageManager(proj);
  const rootPkg = readJSON(path.join(proj, 'package.json'));
  let patterns: string[] = [];
  let tool = 'none';

  // pnpm-workspace.yaml (minimal parse: lines under `packages:` starting with `- `)
  const pnpmWs = path.join(proj, 'pnpm-workspace.yaml');
  if (fs.existsSync(pnpmWs)) {
    tool = 'pnpm';
    const txt = fs.readFileSync(pnpmWs, 'utf8');
    let inPkgs = false;
    for (const line of txt.split('\n')) {
      if (/^packages:/.test(line)) { inPkgs = true; continue; }
      if (inPkgs) {
        const m = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/);
        if (m) patterns.push(m[1]);
        else if (/^\S/.test(line)) break; // dedent → end of list
      }
    }
  }
  // package.json "workspaces" (npm/yarn/bun)
  if (!patterns.length && rootPkg?.workspaces) {
    const ws = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : rootPkg.workspaces.packages;
    if (Array.isArray(ws)) {
      patterns = ws;
      tool = pm;
    }
  }
  // Tool markers refine the label
  if (fs.existsSync(path.join(proj, 'nx.json'))) tool = 'nx';
  else if (fs.existsSync(path.join(proj, 'turbo.json'))) tool = 'turbo';
  else if (fs.existsSync(path.join(proj, 'lerna.json')) && tool === 'none') tool = 'lerna';

  const dirs = new Set<string>();
  for (const p of patterns) for (const d of expandGlob(proj, p)) dirs.add(d);

  // Non-JS workspaces (report only)
  if (!dirs.size) {
    const cargo = readCargoWorkspace(proj);
    if (cargo.length) return { isMonorepo: true, tool: 'cargo', packageManager: pm, packages: cargo };
    if (fs.existsSync(path.join(proj, 'go.work'))) return { isMonorepo: true, tool: 'go', packageManager: pm, packages: [] };
  }

  const packages = [...dirs].sort().map((d) => pkgFromDir(proj, d));
  return { isMonorepo: packages.length > 0, tool: packages.length ? tool : 'none', packageManager: pm, packages };
}

function readCargoWorkspace(proj: string): Pkg[] {
  const cargo = path.join(proj, 'Cargo.toml');
  if (!fs.existsSync(cargo)) return [];
  const txt = fs.readFileSync(cargo, 'utf8');
  if (!/\[workspace\]/.test(txt)) return [];
  const m = txt.match(/members\s*=\s*\[([^\]]*)\]/);
  if (!m) return [];
  const members = [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
  const dirs = new Set<string>();
  for (const p of members) for (const d of expandGlob(proj, p)) dirs.add(d);
  return [...dirs].map((d) => ({ name: path.basename(d), dir: d }));
}

/** Map changed files to the packages they belong to (longest path-prefix match). */
export function affectedPackages(changedFiles: string[], packages: Pkg[]): Pkg[] {
  const byDirLen = [...packages].sort((a, b) => b.dir.length - a.dir.length);
  const hit = new Map<string, Pkg>();
  for (const f of changedFiles) {
    for (const p of byDirLen) {
      if (p.dir === '' || f === p.dir || f.startsWith(p.dir + '/')) {
        hit.set(p.dir, p);
        break;
      }
    }
  }
  return [...hit.values()];
}
