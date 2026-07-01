// Shared headless `claude -p` runner used by every LLM stage (map review,
// reduce, CoVe verification). Read-only by default, inherits the user's auth,
// runs with VOUCH_DISABLE=1 so it can never recursively trigger Vouch's own
// hooks, and is hard-timeout-bounded. Returns null on any failure (callers
// degrade gracefully — a failed reviewer call is never a code finding).
import { spawn, execFileSync } from 'child_process';

export function claudeAvailable(): boolean {
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export interface ClaudeOpts {
  cwd: string;
  systemPrompt: string;
  userPrompt: string;
  /** Read-only tool whitelist. Non-whitelisted tools are auto-denied in headless mode. */
  allowedTools?: string[];
  model?: string;
  timeoutSec: number;
  maxTurns?: number;
}

export function runClaude(opts: ClaudeOpts): Promise<{ text: string; isError: boolean } | null> {
  const allowed = opts.allowedTools ?? ['Read', 'Grep', 'Glob'];
  const args = [
    '-p',
    opts.userPrompt,
    '--output-format',
    'json',
    '--allowedTools',
    ...allowed,
    '--append-system-prompt',
    opts.systemPrompt,
    '--max-turns',
    String(opts.maxTurns ?? 8),
  ];
  if (opts.model) args.push('--model', opts.model);

  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const done = (v: { text: string; isError: boolean } | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    let child;
    try {
      child = spawn('claude', args, {
        cwd: opts.cwd,
        env: { ...process.env, VOUCH_DISABLE: '1' },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      done(null);
      return;
    }

    const timer = setTimeout(() => {
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
      done(null);
    }, opts.timeoutSec * 1000);

    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.on('error', () => {
      clearTimeout(timer);
      done(null);
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const env = JSON.parse(stdout);
        if (typeof env?.result === 'string') return done({ text: env.result, isError: !!env.is_error });
      } catch {
        /* fall through */
      }
      done(null);
    });
  });
}

/** Extract a JSON object/array from model output that may be fenced or prose-wrapped. */
export function extractJSON(text: string): any {
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const firstObj = t.indexOf('{');
  const firstArr = t.indexOf('[');
  const start = firstArr >= 0 && (firstObj < 0 || firstArr < firstObj) ? firstArr : firstObj;
  if (start >= 0) {
    const lastObj = t.lastIndexOf('}');
    const lastArr = t.lastIndexOf(']');
    const end = Math.max(lastObj, lastArr);
    if (end > start) t = t.slice(start, end + 1);
  }
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}
