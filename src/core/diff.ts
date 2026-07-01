// Compute the change set to verify. v0.2: diff against the MERGE-BASE with the
// base branch (so a whole feature branch is reviewed, not just uncommitted
// edits), expand hunks to their enclosing function (`--function-context`) for
// grounding, and expose a PER-FILE structure so the reviewer can map-reduce
// instead of truncating. Vouch's own .vouch/ dir is always excluded.
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const EXCLUDE_VOUCH = ':(exclude).vouch';
const MAX_UNTRACKED_FILE_LINES = 800;

function git(proj: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: proj,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

export function isGitRepo(proj: string): boolean {
  return git(proj, ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
}

export function hasCommits(proj: string): boolean {
  try {
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: proj, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function verifyRef(proj: string, ref: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: proj, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Determine the base to diff against: the merge-base with the repo's base
 *  branch, so a feature branch's full change is reviewed. Falls back to HEAD
 *  (working-tree-vs-HEAD) when there's no distinct base branch. */
export function resolveBase(proj: string, override?: string): string {
  if (!hasCommits(proj)) return '';
  const head = git(proj, ['rev-parse', 'HEAD']).trim();
  const candidates = override
    ? [override]
    : ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master', 'develop'];
  for (const c of candidates) {
    if (!verifyRef(proj, c)) continue;
    const mb = git(proj, ['merge-base', 'HEAD', c]).trim();
    if (mb && mb !== head) return mb;
  }
  return 'HEAD';
}

export interface FileDiff {
  file: string;
  /** Function-context-expanded unified diff for this file. */
  patch: string;
  /** Rough size for ranking/chunking. */
  addedLines: number;
}

export interface DiffResult {
  patch: string; // combined (plain) — kept for hashing + back-compat
  files: string[];
  perFile: FileDiff[];
  hash: string;
  isGit: boolean;
  base: string;
}

function splitByFile(fcPatch: string): { file: string; patch: string }[] {
  if (!fcPatch.trim()) return [];
  const out: { file: string; patch: string }[] = [];
  const parts = fcPatch.split(/^diff --git .*$/m);
  const headers = fcPatch.match(/^diff --git .*$/gm) ?? [];
  // parts[0] is preamble before the first header; align headers with the chunks after them.
  for (let i = 0; i < headers.length; i++) {
    const body = parts[i + 1] ?? '';
    const m = body.match(/^\+\+\+ b\/(.+)$/m) || headers[i].match(/ b\/(.+)$/);
    const file = (m ? m[1] : `file${i}`).trim();
    out.push({ file, patch: headers[i] + '\n' + body.replace(/^\n/, '') });
  }
  return out;
}

function countAdded(patch: string): number {
  return (patch.match(/^\+(?!\+\+)/gm) ?? []).length;
}

export function workingDiff(proj: string, baseOverride?: string): DiffResult {
  if (!isGitRepo(proj)) {
    return { patch: '', files: [], perFile: [], hash: '', isGit: false, base: '' };
  }
  const base = resolveBase(proj, baseOverride);
  const baseArgs = base ? [base] : [];

  // Plain diff (for hash + file list). Working tree vs base.
  const plain = git(proj, ['diff', ...baseArgs, '--', '.', EXCLUDE_VOUCH]);
  // Function-context diff (for review bodies).
  const fc = git(proj, ['diff', '--function-context', ...baseArgs, '--', '.', EXCLUDE_VOUCH]);

  const perFile: FileDiff[] = splitByFile(fc)
    .filter((f) => f.file && !f.file.startsWith('.vouch/'))
    .map((f) => ({ file: f.file, patch: f.patch, addedLines: countAdded(f.patch) }));

  const fileSet = new Set<string>(perFile.map((f) => f.file));

  // Untracked files: synthesize a new-file block so the reviewer sees them.
  const untracked = git(proj, ['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => f !== '.vouch' && !f.startsWith('.vouch/'));

  for (const f of untracked) {
    fileSet.add(f);
    try {
      const full = path.join(proj, f);
      const st = fs.statSync(full);
      if (st.isDirectory() || st.size > 512 * 1024) continue;
      const lines = fs.readFileSync(full, 'utf8').split('\n').slice(0, MAX_UNTRACKED_FILE_LINES);
      const body = lines.map((l, i) => `${i + 1}: +${l}`).join('\n');
      perFile.push({ file: f, patch: `=== new file: ${f} ===\n${body}`, addedLines: lines.length });
    } catch {
      /* skip unreadable/binary */
    }
  }

  const patch = plain + (untracked.length ? `\n(untracked: ${untracked.join(', ')})` : '');
  const hash = patch ? createHash('sha1').update(patch).digest('hex').slice(0, 16) : '';
  return { patch, files: [...fileSet], perFile, hash, isGit: true, base };
}
