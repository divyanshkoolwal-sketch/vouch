import { describe, it, expect } from 'vitest';
import { claudeStopOutput, cursorStopOutput, cursorGuardOutput, isGitCommitOrPush } from '../src/core/hostOutput';
import { makeFinding } from '../src/core/findings';

const blockDecision = { kind: 'block', fixPrompt: 'FIX ME', systemMessage: 'Vouch: 1 blocking' } as const;
const allowDecision = { kind: 'allow', systemMessage: 'Vouch: ✓ verification passed' } as const;
const silent = { kind: 'allow-silent' } as const;
const blk = makeFinding({ kind: 'blocking', tier: 'test', title: 'test failed', command: 'npm test', confidence: 'fact', fpExtra: ['x'] });

describe('claudeStopOutput (Claude + Codex, hard block)', () => {
  it('maps block → decision:block + reason', () => {
    expect(claudeStopOutput(blockDecision)).toEqual({ decision: 'block', reason: 'FIX ME', systemMessage: 'Vouch: 1 blocking' });
  });
  it('maps allow → systemMessage only; silent → null', () => {
    expect(claudeStopOutput(allowDecision)).toEqual({ systemMessage: 'Vouch: ✓ verification passed' });
    expect(claudeStopOutput(silent)).toBeNull();
  });
});

describe('cursorStopOutput (observe-only → soft followup)', () => {
  it('maps block → followup_message (auto-submit fix); never a hard block', () => {
    expect(cursorStopOutput(blockDecision)).toEqual({ followup_message: 'FIX ME' });
  });
  it('allow / silent → null (let the agent finish)', () => {
    expect(cursorStopOutput(allowDecision)).toBeNull();
    expect(cursorStopOutput(silent)).toBeNull();
  });
});

describe('isGitCommitOrPush', () => {
  it('matches commit/push, not other git or lookalikes', () => {
    expect(isGitCommitOrPush('git commit -m wip')).toBe(true);
    expect(isGitCommitOrPush('git push origin main')).toBe(true);
    expect(isGitCommitOrPush('git status')).toBe(false);
    expect(isGitCommitOrPush('ls -la')).toBe(false);
    expect(isGitCommitOrPush('gitlab-ci commit-thing')).toBe(false);
  });
});

describe('cursorGuardOutput (opt-in commit gate)', () => {
  it('denies a commit while blocking findings remain', () => {
    const out = cursorGuardOutput('git commit -m wip', [blk]);
    expect(out?.permission).toBe('deny');
    expect(String(out?.agent_message)).toMatch(/unresolved blocking/);
  });
  it('allows (null) when no blocking findings, or a non-git command', () => {
    expect(cursorGuardOutput('git commit -m wip', [])).toBeNull();
    expect(cursorGuardOutput('ls', [blk])).toBeNull();
  });
});
