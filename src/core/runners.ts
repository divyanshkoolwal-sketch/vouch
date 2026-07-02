// Run a project's own checks (typecheck/lint/build/test) as child processes
// with a hard timeout, and turn failures into deterministic "fact" findings.
// A command we cannot run (missing binary, etc.) is NEVER reported as a code
// defect — it degrades to a skip. That distinction is core to trust.
import { spawn } from 'child_process';
import { Finding, RunCommand, TierName } from './types';
import { makeFinding } from './findings';

export interface CommandResult {
  code: number | null;
  output: string; // combined stdout+stderr, tail-capped
  timedOut: boolean;
  spawnError: string | null;
  durationMs: number;
}

const TAIL_CHARS = 4000;

export function runCommand(cmd: string, cwd: string, timeoutMs: number, env = process.env): Promise<CommandResult> {
  return runChild('/bin/sh', ['-c', cmd], cwd, timeoutMs, env);
}

/** Run a binary with an explicit argv array — NO shell, so no metacharacter
 *  interpretation. Use for anything where the command/args are (even partly)
 *  derived from repo content (e.g. probe execution). */
export function runFile(bin: string, args: string[], cwd: string, timeoutMs: number, env = process.env): Promise<CommandResult> {
  return runChild(bin, args, cwd, timeoutMs, env);
}

function runChild(bin: string, argv: string[], cwd: string, timeoutMs: number, env: NodeJS.ProcessEnv): Promise<CommandResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let out = '';
    let settled = false;
    let timedOut = false;

    let child;
    try {
      child = spawn(bin, argv, { cwd, env });
    } catch (e: any) {
      resolve({ code: null, output: '', timedOut: false, spawnError: String(e?.message ?? e), durationMs: 0 });
      return;
    }

    const cap = (s: string) => {
      out += s;
      if (out.length > TAIL_CHARS * 2) out = out.slice(-TAIL_CHARS * 2);
    };
    child.stdout?.on('data', (d) => cap(d.toString()));
    child.stderr?.on('data', (d) => cap(d.toString()));

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
    }, timeoutMs);

    const finish = (code: number | null, spawnError: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const tail = out.length > TAIL_CHARS ? out.slice(-TAIL_CHARS) : out;
      resolve({ code, output: tail.trim(), timedOut, spawnError, durationMs: Date.now() - start });
    };

    child.on('error', (e) => finish(null, String(e?.message ?? e)));
    child.on('close', (code) => finish(code, null));
  });
}

/** Heuristic: did this look like "couldn't even start the command" rather than
 *  "the command ran and reported failures"? We only treat the latter as a fact. */
function looksLikeMissingTool(r: CommandResult): boolean {
  if (r.spawnError) return true;
  // 127 = command not found; 126 = not executable
  if (r.code === 127 || r.code === 126) return true;
  return /command not found|: not found|No such file or directory|is not recognized/i.test(r.output);
}

export interface TierRun {
  tier: TierName;
  command: string;
  result: CommandResult;
  finding: Finding | null; // null = passed or skipped-as-missing
  skippedReason: string | null;
}

/** Run one tier's command and classify the outcome. */
export async function runTier(
  tier: TierName,
  rc: RunCommand,
  cwd: string,
  timeoutMs: number,
  blocking: boolean,
): Promise<TierRun> {
  const result = await runCommand(rc.cmd, cwd, timeoutMs);

  if (result.code === 0) {
    return { tier, command: rc.cmd, result, finding: null, skippedReason: null };
  }

  if (looksLikeMissingTool(result)) {
    // Our inability to run the tool is not a code defect — skip quietly.
    return {
      tier,
      command: rc.cmd,
      result,
      finding: null,
      skippedReason: `command could not be executed (\`${rc.cmd}\`) — skipped`,
    };
  }

  const title = result.timedOut
    ? `${tier} timed out after ${Math.round(timeoutMs / 1000)}s`
    : `${tier} failed (exit ${result.code})`;

  const finding = makeFinding({
    kind: blocking ? 'blocking' : 'info',
    tier,
    title,
    command: rc.cmd,
    confidence: 'fact',
    detail: result.output || '(no output captured)',
    // Fingerprint on tier+command only, so the same failing check maps to a
    // stable id across runs (output/line noise excluded).
    fpExtra: [rc.cmd],
  });

  return { tier, command: rc.cmd, result, finding, skippedReason: null };
}
