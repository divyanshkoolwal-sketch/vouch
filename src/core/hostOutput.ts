// Pure mappers from a host-neutral stop decision → each host's hook JSON.
// Isolated here so the mapping is unit-testable without stdin/pipeline/spawn.
import { Finding } from './types';
import { buildFixPrompt } from './prioritize';

export type StopDecision =
  | { kind: 'allow-silent' }
  | { kind: 'allow'; systemMessage: string }
  | { kind: 'block'; fixPrompt: string; systemMessage: string };

/** Claude Code / Codex Stop hook output (hard block + continuation reason). */
export function claudeStopOutput(d: StopDecision): Record<string, unknown> | null {
  if (d.kind === 'allow-silent') return null;
  if (d.kind === 'block') return { decision: 'block', reason: d.fixPrompt, systemMessage: d.systemMessage };
  return { systemMessage: d.systemMessage };
}

/** Cursor `stop` hook output — observe-only, so we auto-submit the fix-prompt
 *  as a followup (soft loop). Clean/release → null (stay silent, let it finish). */
export function cursorStopOutput(d: StopDecision): Record<string, unknown> | null {
  return d.kind === 'block' ? { followup_message: d.fixPrompt } : null;
}

export function isGitCommitOrPush(cmd: string): boolean {
  return /\bgit\b[^\n]*\b(commit|push)\b/.test(cmd);
}

/** Cursor `beforeShellExecution` gate: deny a commit/push while blocking findings
 *  remain unresolved (opt-in strict mode). */
export function cursorGuardOutput(
  cmd: string,
  blocking: Finding[],
  questions: Finding[] = [],
  notices: Finding[] = [],
): Record<string, unknown> | null {
  if (!isGitCommitOrPush(cmd) || blocking.length === 0) return null;
  const fixPrompt = buildFixPrompt(blocking, questions, undefined, notices);
  return {
    permission: 'deny',
    agent_message: `Vouch: ${blocking.length} unresolved blocking issue(s) — fix and re-verify before committing.\n\n${fixPrompt}`,
  };
}
