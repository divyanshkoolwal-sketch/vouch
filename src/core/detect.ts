// Auto-detect how to run a project's checks so first-run setup is one
// confirmation, not an interrogation. Heuristic and conservative: we only
// suggest commands we have real evidence for, and the user confirms/edits them.
import * as fs from 'fs';
import * as path from 'path';
import { RunCommand } from './types';

export interface DetectedCommands {
  typecheck?: RunCommand;
  lint?: RunCommand;
  build?: RunCommand;
  test?: RunCommand;
  start?: RunCommand;
}

export interface DetectionResult {
  commands: DetectedCommands;
  notes: string[];
  ecosystem: ('node' | 'python' | 'make')[];
}

function readJSONSafe(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function detectPackageManager(proj: string): string {
  if (fs.existsSync(path.join(proj, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(proj, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(proj, 'bun.lockb')) || fs.existsSync(path.join(proj, 'bun.lock'))) return 'bun';
  return 'npm';
}

/** "npm run X" / "pnpm X" / "yarn X" / "bun run X" */
function runScript(pm: string, script: string): string {
  if (pm === 'npm') return `npm run ${script}`;
  if (pm === 'yarn') return `yarn ${script}`;
  if (pm === 'bun') return `bun run ${script}`;
  return `pnpm ${script}`;
}

export function detect(proj: string): DetectionResult {
  const commands: DetectedCommands = {};
  const notes: string[] = [];
  const ecosystem: ('node' | 'python' | 'make')[] = [];

  // ---- Node / JS / TS ----
  const pkgPath = path.join(proj, 'package.json');
  if (fs.existsSync(pkgPath)) {
    ecosystem.push('node');
    const pkg = readJSONSafe(pkgPath) ?? {};
    const scripts: Record<string, string> = pkg.scripts ?? {};
    const pm = detectPackageManager(proj);
    notes.push(`Detected Node project (package manager: ${pm}).`);

    const has = (name: string) => typeof scripts[name] === 'string';
    if (has('test')) commands.test = { cmd: pm === 'npm' ? 'npm test' : runScript(pm, 'test'), enabled: true };
    if (has('lint')) commands.lint = { cmd: runScript(pm, 'lint'), enabled: true };
    if (has('build')) commands.build = { cmd: runScript(pm, 'build'), enabled: true };

    // typecheck: explicit script wins; else infer from tsconfig.json
    if (has('typecheck')) {
      commands.typecheck = { cmd: runScript(pm, 'typecheck'), enabled: true };
    } else if (has('tsc')) {
      commands.typecheck = { cmd: runScript(pm, 'tsc'), enabled: true };
    } else if (fs.existsSync(path.join(proj, 'tsconfig.json'))) {
      const tscBin = pm === 'npm' ? 'npx tsc --noEmit' : pm === 'bun' ? 'bunx tsc --noEmit' : `${pm} exec tsc --noEmit`;
      commands.typecheck = { cmd: tscBin, enabled: true };
      notes.push('tsconfig.json present → suggested `tsc --noEmit` for type-checking.');
    }

    if (has('dev')) commands.start = { cmd: runScript(pm, 'dev'), enabled: false };
    else if (has('start')) commands.start = { cmd: runScript(pm, 'start'), enabled: false };
  }

  // ---- Python ----
  const pyMarkers = ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'tox.ini'];
  const isPython = pyMarkers.some((m) => fs.existsSync(path.join(proj, m)));
  const hasTestsDir = fs.existsSync(path.join(proj, 'tests')) || fs.existsSync(path.join(proj, 'test'));
  if (isPython || hasTestsDir) {
    ecosystem.push('python');
    const pyproject = fs.existsSync(path.join(proj, 'pyproject.toml'))
      ? fs.readFileSync(path.join(proj, 'pyproject.toml'), 'utf8')
      : '';
    const reqs = fs.existsSync(path.join(proj, 'requirements.txt'))
      ? fs.readFileSync(path.join(proj, 'requirements.txt'), 'utf8')
      : '';
    const blob = (pyproject + '\n' + reqs).toLowerCase();

    if (!commands.test && (blob.includes('pytest') || hasTestsDir)) {
      commands.test = { cmd: 'pytest -q', enabled: true };
      notes.push('Python tests detected → suggested `pytest -q`.');
    }
    if (!commands.lint && blob.includes('ruff')) commands.lint = { cmd: 'ruff check .', enabled: true };
    else if (!commands.lint && blob.includes('flake8')) commands.lint = { cmd: 'flake8', enabled: true };
    if (!commands.typecheck && blob.includes('mypy')) commands.typecheck = { cmd: 'mypy .', enabled: true };
  }

  // ---- Makefile (lowest priority; only fills gaps) ----
  const makefile = path.join(proj, 'Makefile');
  if (fs.existsSync(makefile)) {
    ecosystem.push('make');
    const mk = fs.readFileSync(makefile, 'utf8');
    const targets = new Set(
      mk
        .split('\n')
        .map((l) => l.match(/^([a-zA-Z0-9_-]+):/)?.[1])
        .filter(Boolean) as string[],
    );
    if (!commands.test && targets.has('test')) commands.test = { cmd: 'make test', enabled: true };
    if (!commands.lint && targets.has('lint')) commands.lint = { cmd: 'make lint', enabled: true };
    if (!commands.build && targets.has('build')) commands.build = { cmd: 'make build', enabled: true };
  }

  if (Object.keys(commands).length === 0) {
    notes.push('No check commands auto-detected. Set them with /vouch-setup or edit .vouch/config.json.');
  }
  return { commands, notes, ecosystem };
}
