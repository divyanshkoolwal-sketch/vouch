// Shared child-process runner for CLI-based reviewer backends. Read-only stdin,
// captures stdout, hard timeout (SIGTERM→SIGKILL), and always sets
// VOUCH_DISABLE=1 so a reviewer that spawns the host agent's own CLI can never
// recursively trigger Vouch's hooks. Returns null on spawn error/timeout.
import { spawn, execFileSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// Opt-in reviewer debug log. Written to the per-user ~/.vouch dir (0700) as a
// 0600 file — NOT a predictable /tmp path a co-tenant could pre-create as a
// symlink (redirecting our append) or read (reviewer output can contain code).
function debugLogPath(): string {
  const dir = path.join(os.homedir(), '.vouch');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, 'reviewer-debug.log');
}

export function cliOnPath(bin: string): boolean {
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function runCLI(
  bin: string,
  args: string[],
  cwd: string,
  timeoutSec: number,
): Promise<{ stdout: string; code: number | null; timedOut: boolean } | null> {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    let timedOut = false;
    const done = (v: { stdout: string; code: number | null; timedOut: boolean } | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    let child;
    try {
      child = spawn(bin, args, {
        cwd,
        env: { ...process.env, VOUCH_DISABLE: '1' },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      done(null);
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }, 2000);
      } catch {
        /* ignore */
      }
    }, timeoutSec * 1000);

    child.stdout?.on('data', (d) => (stdout += d.toString()));
    const debug = (code: number | null) => {
      if (!process.env.VOUCH_DEBUG) return;
      try {
        const fd = fs.openSync(debugLogPath(), 'a', 0o600);
        try {
          fs.writeSync(
            fd,
            `\n=== ${bin} ${args.slice(0, 2).join(' ')} | code=${code} timedOut=${timedOut} len=${stdout.length} ===\n${stdout.slice(0, 3000)}\n`,
          );
        } finally {
          fs.closeSync(fd);
        }
      } catch {
        /* ignore */
      }
    };
    child.on('error', () => {
      clearTimeout(timer);
      debug(null);
      done(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      debug(code);
      done({ stdout, code, timedOut });
    });
  });
}
