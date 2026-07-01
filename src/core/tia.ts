// Test Impact Analysis: run only the tests affected by the change, to stay fast
// on huge repos. Safe-fallback contract (a skipped-but-broken test is the
// dangerous failure): we ONLY narrow when we can confidently build the command
// (jest/vitest with a recognizable invocation) and no "root" file changed;
// anything uncertain falls back to the full suite unchanged.
import * as fs from 'fs';
import * as path from 'path';

export interface TiaResult {
  command: string;
  narrowed: boolean;
  selectedCount: number | null; // null = full suite
  reason: string;
}

// A change to any of these invalidates targeted selection → run everything.
const ROOT_PATTERNS: RegExp[] = [
  /(^|\/)package\.json$/,
  /(^|\/)[^/]*lock[^/]*$/i,
  /(^|\/)tsconfig[^/]*\.json$/,
  /(^|\/)(jest|vitest|vite|babel|tsup|rollup|webpack)\.config\.[cm]?[jt]s$/,
  /(^|\/)\.?eslintrc/,
  /(^|\/)(jest|vitest)\.setup\.[cm]?[jt]s$/,
];

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function detectRunner(cmd: string): 'jest' | 'vitest' | null {
  if (/\bvitest\b/.test(cmd)) return 'vitest';
  if (/\bjest\b/.test(cmd)) return 'jest';
  return null;
}

/** Is the command invoked through a package-manager script (needs `--` to pass args)? */
function viaScript(cmd: string): boolean {
  return /^(npm|pnpm|yarn|bun)\b/.test(cmd.trim());
}

export function selectTests(opts: {
  proj: string;
  testCmd: string;
  changedFiles: string[];
  enabled: boolean;
}): TiaResult {
  const { proj, testCmd, changedFiles, enabled } = opts;
  const full = (reason: string): TiaResult => ({ command: testCmd, narrowed: false, selectedCount: null, reason });

  if (!enabled) return full('TIA disabled');

  const runner = detectRunner(testCmd);
  // If the command runs via a package script, peek at the underlying script to
  // detect the real runner (e.g. "npm test" → "jest").
  let effectiveRunner = runner;
  if (!effectiveRunner && viaScript(testCmd)) {
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(proj, 'package.json'), 'utf8'));
      effectiveRunner = detectRunner(String(pj?.scripts?.test ?? ''));
    } catch {
      /* ignore */
    }
  }
  if (!effectiveRunner) return full('unrecognized test runner → full suite');

  if (changedFiles.some((f) => ROOT_PATTERNS.some((re) => re.test(f)))) {
    return full('a root/config file changed → full suite');
  }

  // Candidate source files that exist on disk (skip deletions / non-code).
  const sources = changedFiles.filter((f) => CODE_RE.test(f) && fs.existsSync(path.join(proj, f)));
  if (sources.length === 0) return full('no changed source files to target → full suite');

  const fileArgs = sources.map((f) => JSON.stringify(f)).join(' ');
  const pass = viaScript(testCmd) ? ' --' : '';

  if (effectiveRunner === 'jest') {
    return {
      command: `${testCmd}${pass} --findRelatedTests ${fileArgs} --passWithNoTests`,
      narrowed: true,
      selectedCount: sources.length,
      reason: `jest --findRelatedTests on ${sources.length} changed file(s)`,
    };
  }
  // vitest: `related` is a subcommand — only safe when invoked directly (a
  // package script like "npm test" can't take a subcommand). Preserve however
  // vitest is invoked (e.g. `npx vitest`, `./node_modules/.bin/vitest`).
  if (effectiveRunner === 'vitest') {
    if (viaScript(testCmd)) return full('vitest via package script cannot take the `related` subcommand → full suite');
    const withRelated = testCmd.replace(/\bvitest\b(\s+run)?/, `vitest related ${fileArgs}`);
    const command = /(^|\s)--run(\s|$)/.test(withRelated) ? withRelated : `${withRelated} --run`;
    return { command, narrowed: true, selectedCount: sources.length, reason: `vitest related on ${sources.length} changed file(s)` };
  }
  return full('cannot safely narrow this runner invocation → full suite');
}
