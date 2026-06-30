import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

export function tmpProj(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vouch-test-'));
}

export function write(proj: string, rel: string, content: string): void {
  const full = path.join(proj, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

export function rm(proj: string): void {
  try {
    fs.rmSync(proj, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export function gitInit(proj: string): void {
  const opts = { cwd: proj, stdio: 'ignore' as const };
  execFileSync('git', ['init', '-q'], opts);
  execFileSync('git', ['config', 'user.email', 't@t.t'], opts);
  execFileSync('git', ['config', 'user.name', 'test'], opts);
}

export function gitCommitAll(proj: string, msg = 'c'): void {
  const opts = { cwd: proj, stdio: 'ignore' as const };
  execFileSync('git', ['add', '-A'], opts);
  execFileSync('git', ['commit', '-qm', msg], opts);
}
