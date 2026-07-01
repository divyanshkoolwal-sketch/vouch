// Shared child-process runner for CLI-based reviewer backends. Read-only stdin,
// captures stdout, hard timeout (SIGTERM→SIGKILL), and always sets
// VOUCH_DISABLE=1 so a reviewer that spawns the host agent's own CLI can never
// recursively trigger Vouch's hooks. Returns null on spawn error/timeout.
import { spawn, execFileSync } from 'child_process';

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
        require('fs').appendFileSync(
          '/tmp/vouch-reviewer-debug.log',
          `\n=== ${bin} ${args.slice(0, 2).join(' ')} | code=${code} timedOut=${timedOut} len=${stdout.length} ===\n${stdout.slice(0, 3000)}\n`,
        );
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
