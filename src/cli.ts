#!/usr/bin/env node
// Hook entry point for Vouch. Invoked by the thin shell wrappers in scripts/.
// Owns the Stop-hook decision logic (block vs allow), the change-gating, and the
// bounded block→fix→re-verify loop. ALWAYS exits 0 and prints either a single
// hook-JSON object or nothing (which Claude Code reads as "allow stop").
import { loadConfig } from './core/config';
import { loadActiveIntent } from './core/intent';
import { runPipeline } from './core/pipeline';
import { isDirty, clearDirty, markDirty, loadState, saveState } from './core/runState';
import { workingDiff } from './core/diff';
import { readText, conventionsPath, findingsLogPath, writeJSON, readJSON, exists, offPath } from './core/memory';
import * as path from 'path';
import { VerifyResult } from './core/types';
import { coverageLine } from './core/prioritize';
import { StopDecision, claudeStopOutput, cursorStopOutput, cursorGuardOutput } from './core/hostOutput';
import { runInstall, runUninstall, statusLines, formatActions, InstallOpts } from './install';

function parseStdin(input: string): any {
  try {
    return JSON.parse(input);
  } catch {
    return {};
  }
}

function resolveProj(stdinObj?: any): string {
  return (
    process.env.VOUCH_PROJECT_DIR ||
    process.env.CLAUDE_PROJECT_DIR ||
    (stdinObj && typeof stdinObj.cwd === 'string' ? stdinObj.cwd : '') ||
    process.cwd()
  );
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
    // Safety: don't hang forever waiting on stdin.
    setTimeout(() => resolve(data), 2000);
  });
}

function printHookJSON(obj: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(obj));
}

function writeFindingsLog(proj: string, result: VerifyResult): void {
  try {
    writeJSON(findingsLogPath(proj), {
      ts: new Date().toISOString(),
      summary: result.summary,
      blocking: result.blocking,
      questions: result.questions,
      notices: result.notices,
      skipped: result.skipped,
      ranTiers: result.ranTiers,
    });
  } catch {
    /* ignore */
  }
}

function looksLikeProject(proj: string): boolean {
  return (
    exists(path.join(proj, '.git')) ||
    exists(path.join(proj, 'package.json')) ||
    exists(path.join(proj, 'pyproject.toml')) ||
    exists(path.join(proj, 'requirements.txt')) ||
    exists(path.join(proj, 'Makefile'))
  );
}

/** Shared "agent finished" logic used by every host. Owns change-gating, the
 *  bounded loop, state, and the findings log. Returns a host-neutral decision;
 *  each host's entry point formats it into that host's hook JSON. */
async function computeStopDecision(hook: any): Promise<StopDecision> {
  const proj = resolveProj(hook);
  const cfg = loadConfig(proj);
  if (!cfg) return { kind: 'allow-silent' }; // not set up
  if (exists(offPath(proj))) return { kind: 'allow-silent' }; // paused via /vouch:off

  const state = loadState(proj);
  const diff = workingDiff(proj);
  const dirty = isDirty(proj);

  // Nothing to verify → allow, record clean baseline.
  if (!diff.patch) {
    clearDirty(proj);
    saveState(proj, { lastDiffHash: diff.hash || null, iteration: 0 });
    return { kind: 'allow-silent' };
  }
  // Nothing NEW since last verification → allow silently.
  if (!dirty && diff.hash === state.lastDiffHash) return { kind: 'allow-silent' };

  const stopActive = !!hook.stop_hook_active;

  // Loop cap: release so the user (or agent) is never trapped.
  if (cfg.enforcement.block && stopActive && state.iteration >= cfg.enforcement.maxIterations) {
    const result = await runPipeline({ proj, cfg, intent: loadActiveIntent(proj) });
    writeFindingsLog(proj, result);
    clearDirty(proj);
    saveState(proj, { lastDiffHash: diff.hash || null, iteration: 0 });
    return {
      kind: 'allow',
      systemMessage: `Vouch: released after ${cfg.enforcement.maxIterations} fix rounds — ${result.blocking.length} issue(s) still unresolved. Run /vouch:status for details.`,
    };
  }

  const round = state.iteration + 1;
  const result = await runPipeline({
    proj,
    cfg,
    intent: loadActiveIntent(proj),
    roundInfo: `(verification round ${round}/${cfg.enforcement.maxIterations})`,
  });
  writeFindingsLog(proj, result);

  if (cfg.enforcement.block && result.blocking.length) {
    // Do NOT clear dirty / advance baseline on block — only a real fix clears it.
    saveState(proj, { lastDiffHash: state.lastDiffHash, iteration: round });
    return {
      kind: 'block',
      fixPrompt: result.fixPrompt,
      systemMessage: `${result.summary} — blocking (round ${round}/${cfg.enforcement.maxIterations})`,
    };
  }

  clearDirty(proj);
  saveState(proj, { lastDiffHash: diff.hash || null, iteration: 0 });
  return { kind: 'allow', systemMessage: result.summary };
}

/** Claude Code + Codex Stop hook — identical contract (hard block + reason). */
async function stopHook(): Promise<void> {
  const out = claudeStopOutput(await computeStopDecision(parseStdin(await readStdin())));
  if (out) printHookJSON(out);
}

/** Cursor `stop` hook — observe-only (cannot hard-block). We auto-submit the
 *  fix-prompt via followup_message (soft loop, also bounded by hooks.json
 *  loop_limit). Clean/release → stay silent so the agent finishes. */
async function cursorStop(): Promise<void> {
  const out = cursorStopOutput(await computeStopDecision(parseStdin(await readStdin())));
  if (out) printHookJSON(out);
}

/** Cursor `beforeShellExecution` hook (opt-in strict mode): hard-deny a
 *  git commit/push while the last verification has unresolved blocking findings.
 *  Deterministic + cheap (reads the last findings log; no LLM call). */
async function cursorGuard(): Promise<void> {
  const hook = parseStdin(await readStdin());
  const proj = resolveProj(hook);
  const cfg = loadConfig(proj);
  if (!cfg || exists(offPath(proj))) return; // allow
  const last = readJSON<any>(findingsLogPath(proj), null);
  const out = cursorGuardOutput(String(hook.command ?? ''), last?.blocking ?? [], last?.questions ?? [], last?.notices ?? []);
  if (out) printHookJSON(out);
}

function sessionContext(): void {
  const proj = resolveProj();
  const cfg = loadConfig(proj);
  if (!cfg) {
    if (looksLikeProject(proj)) {
      process.stdout.write(
        '[Vouch] installed but not set up for this repo. Run /vouch:setup to auto-detect how to run your checks and enable automatic verification (takes ~10s).',
      );
    }
    return;
  }
  const lines: string[] = [
    '[Vouch] active here: when you finish a change, Vouch automatically runs the project checks and an independent intent review, and will ask you to fix verified failures before stopping.',
  ];
  const intent = loadActiveIntent(proj);
  if (intent) {
    lines.push(`\nActive intent: ${intent.summary}`);
    if (intent.acceptance_criteria.length) {
      lines.push('Acceptance criteria:');
      intent.acceptance_criteria.forEach((c, i) => lines.push(`  ${i + 1}. ${c}`));
    }
  }
  const conv = readText(conventionsPath(proj)).trim();
  if (conv) lines.push(`\nProject conventions (from Vouch memory):\n${conv.slice(0, 2000)}`);
  process.stdout.write(lines.join('\n'));
}

async function verifyManual(): Promise<void> {
  const proj = resolveProj();
  const cfg = loadConfig(proj);
  if (!cfg) {
    process.stdout.write('Vouch is not set up for this repo. Run /vouch:setup first.\n');
    return;
  }
  const result = await runPipeline({ proj, cfg, intent: loadActiveIntent(proj), force: true });
  writeFindingsLog(proj, result);
  const out: string[] = [result.summary];
  out.push(`ran: ${result.ranTiers.join(', ') || '(none)'}`);
  const cov = coverageLine(result.coverage);
  if (cov) out.push(cov);
  if (result.skipped.length) out.push(`skipped: ${result.skipped.map((s) => `${s.tier} (${s.reason})`).join('; ')}`);
  if (result.fixPrompt) {
    out.push('\n' + result.fixPrompt);
  } else {
    if (result.notices.length) {
      out.push('\nNon-blocking failures:');
      result.notices.forEach((n) => out.push(`- [${n.tier}] ${n.title}${n.command ? ` — ${n.command}` : ''} (id: ${n.id})`));
    }
    if (result.questions.length) {
      out.push('\nOpen questions:');
      result.questions.forEach((q) => out.push(`- [${q.tier}] ${q.title} (id: ${q.id})`));
    }
  }
  process.stdout.write(out.join('\n') + '\n');
}

const HOOK_SUBS = new Set(['stop-hook', 'cursor-stop', 'cursor-guard', 'session-context', 'mark-dirty']);

function parseInstallOpts(args: string[]): { tool: string; opts: InstallOpts } {
  const tool = args.find((a) => !a.startsWith('-')) ?? '';
  return {
    tool,
    opts: { global: args.includes('--global'), strict: args.includes('--strict'), dryRun: args.includes('--dry-run') },
  };
}

const HELP = `vouch — automatic verification for AI coding agents

Install into a host agent (Claude Code uses its plugin — see README):
  vouch install codex               wire up OpenAI Codex (global ~/.codex)
  vouch install cursor [--global]   wire up Cursor (project .cursor/ by default)
  vouch install cursor --strict     also add the hard commit-gate
  vouch uninstall <codex|cursor>    remove Vouch's config (keeps your other settings)
  vouch status                      show what's wired up
  add --dry-run to preview writes without changing anything

Other:
  vouch verify                      run verification now in the current repo
`;

async function main(): Promise<void> {
  const sub = process.argv[2];
  // Central recursion guard: when the reviewer spawns a host's own CLI (which may
  // re-fire its hooks), those hooks run with VOUCH_DISABLE=1 → hook entry points no-op.
  if (process.env.VOUCH_DISABLE && sub && HOOK_SUBS.has(sub)) process.exit(0);
  try {
    if (sub === 'stop-hook') await stopHook();
    else if (sub === 'cursor-stop') await cursorStop();
    else if (sub === 'cursor-guard') await cursorGuard();
    else if (sub === 'session-context') sessionContext();
    else if (sub === 'verify') await verifyManual();
    else if (sub === 'mark-dirty') markDirty(resolveProj());
    else if (sub === 'install' || sub === 'uninstall') {
      const { tool, opts } = parseInstallOpts(process.argv.slice(3));
      const actions = sub === 'install' ? runInstall(tool, opts) : runUninstall(tool, opts);
      process.stdout.write(`vouch ${sub} ${tool}${opts.dryRun ? ' (dry-run)' : ''}:\n${formatActions(actions, !!opts.dryRun)}\n`);
    } else if (sub === 'status') {
      const { opts } = parseInstallOpts(process.argv.slice(3));
      process.stdout.write('Vouch host integrations:\n' + statusLines(opts).map((l) => '  ' + l).join('\n') + '\n');
    } else if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
      process.stdout.write(HELP);
    } else process.stdout.write(`vouch: unknown command "${sub}"\n\n${HELP}`);
  } catch {
    // Never let a hook fail loudly. Allow stop / print nothing on any error.
  }
  process.exit(0);
}

main();
