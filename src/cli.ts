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
import { readText, conventionsPath, findingsLogPath, writeJSON, exists, offPath } from './core/memory';
import * as path from 'path';
import { VerifyResult } from './core/types';

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

async function stopHook(): Promise<void> {
  const input = await readStdin();
  let hook: any = {};
  try {
    hook = JSON.parse(input);
  } catch {
    /* tolerate empty/garbage */
  }
  const proj = resolveProj(hook);
  const cfg = loadConfig(proj);
  if (!cfg) return; // not set up → allow stop silently
  if (exists(offPath(proj))) return; // paused via /vouch:off → allow stop silently

  const state = loadState(proj);
  const diff = workingDiff(proj);
  const dirty = isDirty(proj);

  // Nothing to verify at all → allow stop, record clean baseline.
  if (!diff.patch) {
    clearDirty(proj);
    saveState(proj, { lastDiffHash: diff.hash || null, iteration: 0 });
    return;
  }

  // Nothing NEW since the last verification → allow stop silently.
  if (!dirty && diff.hash === state.lastDiffHash) return;

  const stopActive = !!hook.stop_hook_active;

  // Loop cap: we've already blocked maxIterations times this cycle → release so
  // the user is never trapped. Run a final (non-blocking) pass for the summary.
  if (cfg.enforcement.block && stopActive && state.iteration >= cfg.enforcement.maxIterations) {
    const result = await runPipeline({ proj, cfg, intent: loadActiveIntent(proj) });
    writeFindingsLog(proj, result);
    clearDirty(proj);
    saveState(proj, { lastDiffHash: diff.hash || null, iteration: 0 });
    printHookJSON({
      systemMessage: `Vouch: released after ${cfg.enforcement.maxIterations} fix rounds — ${result.blocking.length} issue(s) still unresolved. Run /vouch:status for details.`,
    });
    return;
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
    // Block — do NOT clear dirty and do NOT advance the verified baseline, so a
    // subsequent no-op Stop cannot escape the block; only a real fix (which
    // changes the diff) can clear it on a later clean pass.
    saveState(proj, { lastDiffHash: state.lastDiffHash, iteration: round });
    printHookJSON({
      decision: 'block',
      reason: result.fixPrompt,
      systemMessage: `${result.summary} — blocking (round ${round}/${cfg.enforcement.maxIterations})`,
    });
    return;
  }

  // Clean, or only non-blocking questions → allow stop, advance baseline.
  clearDirty(proj);
  saveState(proj, { lastDiffHash: diff.hash || null, iteration: 0 });
  printHookJSON({ systemMessage: result.summary });
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

async function main(): Promise<void> {
  const sub = process.argv[2];
  try {
    if (sub === 'stop-hook') await stopHook();
    else if (sub === 'session-context') sessionContext();
    else if (sub === 'verify') await verifyManual();
    else if (sub === 'mark-dirty') markDirty(resolveProj());
    else process.stdout.write(`vouch cli: unknown subcommand "${sub ?? ''}"\n`);
  } catch {
    // Never let a hook fail loudly. Allow stop / print nothing on any error.
  }
  process.exit(0);
}

main();
