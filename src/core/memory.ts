// Read/write the repo-resident memory under <project>/.vouch/.
// Everything here is plain files so it is git-friendly, reviewable, portable
// across tools, and compounds over time.
import * as fs from 'fs';
import * as path from 'path';

export function vouchDir(proj: string): string {
  return path.join(proj, '.vouch');
}
export function runsDir(proj: string): string {
  return path.join(vouchDir(proj), 'runs');
}
export function configPath(proj: string): string {
  return path.join(vouchDir(proj), 'config.json');
}
export function intentDir(proj: string): string {
  return path.join(vouchDir(proj), 'intent');
}
export function activeIntentPath(proj: string): string {
  return path.join(intentDir(proj), 'active.json');
}
export function dismissalsPath(proj: string): string {
  return path.join(vouchDir(proj), 'dismissals.json');
}
export function conventionsPath(proj: string): string {
  return path.join(vouchDir(proj), 'conventions.md');
}
export function statePath(proj: string): string {
  return path.join(runsDir(proj), 'state.json');
}
export function dirtyPath(proj: string): string {
  return path.join(runsDir(proj), 'dirty');
}
/** Presence of this marker pauses Vouch's automatic verification (kill switch). */
export function offPath(proj: string): string {
  return path.join(runsDir(proj), 'off');
}
export function findingsLogPath(proj: string): string {
  return path.join(runsDir(proj), 'last-findings.json');
}

/** Create .vouch/ (and runs/) and ensure runs/ is gitignored so transient state
 *  never gets committed, while the durable memory files do. */
export function ensureVouchDir(proj: string): void {
  fs.mkdirSync(runsDir(proj), { recursive: true });
  fs.mkdirSync(intentDir(proj), { recursive: true });
  // Always ensure runs/ is ignored — even if the user already has a custom
  // .vouch/.gitignore. Transient run state (last-findings, dirty markers) must
  // never be committed; a stale ignore file without this rule would leak it.
  const gi = path.join(vouchDir(proj), '.gitignore');
  let cur = '';
  try {
    cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  } catch {
    cur = '';
  }
  const hasRuns = cur.split('\n').some((l) => l.trim() === 'runs/' || l.trim() === '/runs/');
  if (!hasRuns) {
    const sep = cur && !cur.endsWith('\n') ? '\n' : '';
    try {
      fs.writeFileSync(gi, `${cur}${sep}runs/\n`);
    } catch {
      /* ignore */
    }
  }
}

export function readJSON<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(file: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

export function readText(file: string, fallback = ''): string {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fallback;
  } catch {
    return fallback;
  }
}

export function appendText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, text);
}

export function exists(file: string): boolean {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}
