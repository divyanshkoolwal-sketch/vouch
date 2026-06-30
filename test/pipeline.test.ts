import { describe, it, expect, afterEach } from 'vitest';
import { runPipeline, PipelineDeps } from '../src/core/pipeline';
import { defaultConfig } from '../src/core/config';
import { makeFinding } from '../src/core/findings';
import { addDismissal } from '../src/core/dismissals';
import { TierRun } from '../src/core/runners';
import { DiffResult } from '../src/core/diff';
import { VouchConfig, IntentRecord, TierName, Finding } from '../src/core/types';
import { tmpProj, rm } from './helpers';

function diffOf(patch = 'some diff', hash = 'h1'): DiffResult {
  return { patch, files: ['a.ts'], hash, truncated: false, isGit: true };
}

function passTier(tier: TierName, cmd = `run ${tier}`): TierRun {
  return { tier, command: cmd, result: { code: 0, output: 'ok', timedOut: false, spawnError: null, durationMs: 1 }, finding: null, skippedReason: null };
}

// Honors the `blocking` flag the pipeline passes, so we can assert wiring.
function makeRunTier(spec: Partial<Record<TierName, 'pass' | 'fail' | 'missing'>>): PipelineDeps['runTier'] {
  return async (tier, rc, _cwd, _timeout, blocking): Promise<TierRun> => {
    const s = spec[tier] ?? 'pass';
    if (s === 'pass') return passTier(tier, rc.cmd);
    if (s === 'missing') {
      return { tier, command: rc.cmd, result: { code: 127, output: 'not found', timedOut: false, spawnError: null, durationMs: 1 }, finding: null, skippedReason: `command could not be executed (\`${rc.cmd}\`)` };
    }
    return {
      tier,
      command: rc.cmd,
      result: { code: 1, output: 'boom', timedOut: false, spawnError: null, durationMs: 1 },
      finding: makeFinding({ kind: blocking ? 'blocking' : 'info', tier, title: `${tier} failed (exit 1)`, command: rc.cmd, confidence: 'fact', detail: 'boom', fpExtra: [rc.cmd] }),
      skippedReason: null,
    };
  };
}

function cfgWith(tiers: Partial<Record<TierName, string>>, over?: Partial<VouchConfig>): VouchConfig {
  const cfg = defaultConfig();
  for (const [t, cmd] of Object.entries(tiers)) {
    (cfg.commands as any)[t] = { cmd, enabled: true };
    (cfg.tiers as any)[t] = true;
  }
  return { ...cfg, ...(over ?? {}) } as VouchConfig;
}

const intent: IntentRecord = {
  id: 'i1',
  summary: 'do the thing',
  acceptance_criteria: ['it works'],
  created: new Date().toISOString(),
  status: 'active',
};

function deps(over: Partial<PipelineDeps>): Partial<PipelineDeps> {
  return {
    workingDiff: () => diffOf(),
    reviewerAvailable: () => false,
    reviewIntent: async () => [],
    runTier: makeRunTier({}),
    ...over,
  };
}

describe('pipeline decision logic', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.forEach(rm));
  const proj = () => {
    const p = tmpProj();
    dirs.push(p);
    return p;
  };

  it('does nothing when the diff is empty (and not forced)', async () => {
    const r = await runPipeline({ proj: proj(), cfg: cfgWith({ test: 'npm test' }), intent: null, deps: deps({ workingDiff: () => diffOf('', '') }) });
    expect(r.diffEmpty).toBe(true);
    expect(r.findings).toHaveLength(0);
    expect(r.fixPrompt).toBe('');
  });

  it('turns a failing test into ONE blocking fact and defers intent review', async () => {
    const r = await runPipeline({
      proj: proj(),
      cfg: cfgWith({ test: 'npm test', intent: 'x' }),
      intent,
      deps: deps({ runTier: makeRunTier({ test: 'fail' }), reviewerAvailable: () => true, reviewIntent: async () => [makeFinding({ kind: 'question', tier: 'intent', title: 'q', confidence: 'medium', fpExtra: ['c'] })] }),
    });
    expect(r.blocking).toHaveLength(1);
    expect(r.blocking[0].tier).toBe('test');
    // intent review must be deferred while a hard failure exists
    expect(r.skipped.find((s) => s.tier === 'intent')?.reason).toMatch(/fix the verified failures first/);
    expect(r.fixPrompt).toMatch(/Must fix/);
  });

  it('passes deterministic tiers then surfaces an intent gap as a NON-blocking question', async () => {
    const r = await runPipeline({
      proj: proj(),
      cfg: cfgWith({ test: 'npm test' }),
      intent,
      deps: deps({
        reviewerAvailable: () => true,
        reviewIntent: async () => [makeFinding({ kind: 'question', tier: 'intent', title: 'criterion "it works" not clearly implemented', confidence: 'medium', fpExtra: ['it works'] })],
      }),
    });
    expect(r.blocking).toHaveLength(0);
    expect(r.questions).toHaveLength(1);
    expect(r.fixPrompt).toBe(''); // questions never produce a blocking fix-prompt
  });

  it('suppresses a dismissed finding', async () => {
    const p = proj();
    const dismissed = makeFinding({ kind: 'blocking', tier: 'test', title: 'test failed (exit 1)', command: 'npm test', confidence: 'fact', fpExtra: ['npm test'] });
    addDismissal(p, dismissed.id, 'flaky, ignore', new Date().toISOString());
    const r = await runPipeline({ proj: p, cfg: cfgWith({ test: 'npm test' }), intent: null, deps: deps({ runTier: makeRunTier({ test: 'fail' }) }) });
    expect(r.findings).toHaveLength(0);
    expect(r.blocking).toHaveLength(0);
  });

  it('early-exits downstream tiers after a compile-class (typecheck) failure', async () => {
    const r = await runPipeline({
      proj: proj(),
      cfg: cfgWith({ typecheck: 'tsc', build: 'build', test: 'test' }),
      intent: null,
      deps: deps({ runTier: makeRunTier({ typecheck: 'fail' }) }),
    });
    expect(r.ranTiers).toEqual(['typecheck']); // build + test skipped
    expect(r.skipped.some((s) => s.tier === 'build')).toBe(true);
    expect(r.skipped.some((s) => s.tier === 'test')).toBe(true);
  });

  it('treats lint as non-blocking by default (not in blockOn)', async () => {
    const r = await runPipeline({
      proj: proj(),
      cfg: cfgWith({ lint: 'eslint', test: 'test' }),
      intent: null,
      deps: deps({ runTier: makeRunTier({ lint: 'fail' }) }),
    });
    // lint failed but must not block; test passed
    expect(r.blocking).toHaveLength(0);
    expect(r.findings.some((f) => f.tier === 'lint' && f.kind === 'info')).toBe(true);
    // ...and it must still be SURFACED, not silently swallowed
    expect(r.notices).toHaveLength(1);
    expect(r.summary).toMatch(/non-blocking failure/);
  });

  it('advisory mode: a failing test surfaces as a non-blocking notice, never reported as "passed"', async () => {
    const r = await runPipeline({
      proj: proj(),
      cfg: cfgWith({ test: 'npm test' }, { enforcement: { block: false, blockOn: ['test'], maxIterations: 3 } }),
      intent: null,
      deps: deps({ runTier: makeRunTier({ test: 'fail' }) }),
    });
    expect(r.blocking).toHaveLength(0);
    expect(r.notices).toHaveLength(1);
    expect(r.summary).not.toMatch(/passed/);
    expect(r.summary).toMatch(/non-blocking failure/);
  });

  it('never treats a missing command as a defect (degrades to skip)', async () => {
    const r = await runPipeline({
      proj: proj(),
      cfg: cfgWith({ test: 'npm test' }),
      intent: null,
      deps: deps({ runTier: makeRunTier({ test: 'missing' }) }),
    });
    expect(r.findings).toHaveLength(0);
    expect(r.skipped.some((s) => s.tier === 'test' && /could not be executed/.test(s.reason))).toBe(true);
  });

  it('promotes an intent finding to blocking only when the user opts intent into blockOn', async () => {
    const blockingReviewFinding: Finding[] = [makeFinding({ kind: 'blocking', tier: 'intent', title: 'criterion unmet', confidence: 'high', fpExtra: ['c'] })];
    const r = await runPipeline({
      proj: proj(),
      cfg: cfgWith({ test: 'test' }, { enforcement: { block: true, blockOn: ['typecheck', 'build', 'test', 'intent'], maxIterations: 3 } }),
      intent,
      deps: deps({ reviewerAvailable: () => true, reviewIntent: async () => blockingReviewFinding }),
    });
    expect(r.blocking).toHaveLength(1);
    expect(r.blocking[0].tier).toBe('intent');
  });
});
