// Compute the change set to verify. Findings are scoped to this diff so Vouch
// never flags code the user didn't touch. We look at the working tree relative
// to HEAD (the agent's pending, usually-uncommitted work) plus untracked files.
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';

const MAX_PATCH_LINES = 1600; // bound prompt size / cost
const MAX_UNTRACKED_FILE_LINES = 400;

function git(proj: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: proj,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
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

export interface DiffResult {
  patch: string;
  files: string[];
  hash: string;
  truncated: boolean;
  isGit: boolean;
}

export function workingDiff(proj: string): DiffResult {
  if (!isGitRepo(proj)) {
    return { patch: '', files: [], hash: '', truncated: false, isGit: false };
  }

  // Exclude Vouch's own memory dir — its transient runs/ files change every run
  // and its durable files are not part of the change being verified. Without
  // this, the diff is never empty and the change-gate never goes quiet.
  const EXCLUDE_VOUCH = ':(exclude).vouch';

  // Tracked changes vs HEAD (falls back to index diff in a repo with no commits).
  let tracked = hasCommits(proj)
    ? git(proj, ['diff', 'HEAD', '--', '.', EXCLUDE_VOUCH])
    : git(proj, ['diff', '--cached', '--', '.', EXCLUDE_VOUCH]);
  if (!tracked && !hasCommits(proj)) tracked = git(proj, ['diff', '--', '.', EXCLUDE_VOUCH]);

  // Untracked files: synthesize a readable block so the reviewer sees new files
  // (a new file is a common way an agent "implements" something).
  const untrackedList = git(proj, ['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => f !== '.vouch' && !f.startsWith('.vouch/'));

  const fileSet = new Set<string>();
  for (const line of tracked.split('\n')) {
    const m = line.match(/^\+\+\+ b\/(.+)$/);
    if (m) fileSet.add(m[1]);
  }

  let untrackedBlock = '';
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  for (const f of untrackedList) {
    fileSet.add(f);
    try {
      const full = path.join(proj, f);
      const stat = fs.statSync(full);
      if (stat.isDirectory() || stat.size > 256 * 1024) continue;
      const content = fs.readFileSync(full, 'utf8').split('\n').slice(0, MAX_UNTRACKED_FILE_LINES);
      untrackedBlock += `\n=== new file: ${f} ===\n${content.join('\n')}\n`;
    } catch {
      /* ignore unreadable/binary */
    }
  }

  let patch = tracked + (untrackedBlock ? `\n--- untracked files ---${untrackedBlock}` : '');
  let truncated = false;
  const lines = patch.split('\n');
  if (lines.length > MAX_PATCH_LINES) {
    patch = lines.slice(0, MAX_PATCH_LINES).join('\n') + `\n... [diff truncated at ${MAX_PATCH_LINES} lines] ...`;
    truncated = true;
  }

  const hash = patch ? createHash('sha1').update(patch).digest('hex').slice(0, 16) : '';
  return { patch, files: [...fileSet], hash, truncated, isGit: true };
}
