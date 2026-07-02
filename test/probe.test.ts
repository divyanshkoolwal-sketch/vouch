import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { screenProbe, probeEligible, executeProbe, runProbes, rerunStoredProbes, PROBE_MARKER } from '../src/core/review/probe';
import { makeFinding } from '../src/core/findings';
import { defaultConfig } from '../src/core/config';
import { Finding, IntentRecord } from '../src/core/types';
import { tmpProj, rm, write } from './helpers';

const intent: IntentRecord = { id: 'i', summary: 'clamp bounds 0..100', acceptance_criteria: ['returns 100 when n>100'], created: '', status: 'active' };

const finding = (file = 'clamp.js'): Finding => ({
  ...makeFinding({ kind: 'question', tier: 'intent', title: 'upper bound missing', confidence: 'medium', fpExtra: [file] }),
  file,
  criterion: 'returns 100 when n>100',
  score: 0.8,
});

// A real probe that requires the module from CWD and checks the criterion.
const FAILING_PROBE = [
  "const path = require('path');",
  "const { clamp } = require(path.join(process.cwd(), 'clamp.js'));",
  'if (clamp(150) !== 100) {',
  `  console.log('${PROBE_MARKER}: clamp(150) returned ' + clamp(150));`,
  '  process.exit(1);',
  '}',
  "console.log('ok');",
].join('\n');

describe('screenProbe', () => {
  it('rejects forbidden APIs, oversize, and missing marker', () => {
    expect(screenProbe(`require('child_process').execSync('ls'); // ${PROBE_MARKER}`, 'node')).toMatch(/forbidden/);
    expect(screenProbe(`fs.writeFileSync('x','y'); // ${PROBE_MARKER}`, 'node')).toMatch(/forbidden/);
    expect(screenProbe(`fetch('http://x'); // ${PROBE_MARKER}`, 'node')).toMatch(/forbidden/);
    expect(screenProbe('console.log(1)', 'node')).toMatch(/marker/);
    expect(screenProbe(`// ${PROBE_MARKER}\n` + 'x'.repeat(5000), 'node')).toMatch(/too large/);
    expect(screenProbe(`import subprocess # ${PROBE_MARKER}`, 'python')).toMatch(/forbidden/);
  });
  it('accepts a clean probe', () => {
    expect(screenProbe(FAILING_PROBE, 'node')).toBeNull();
  });
});

describe('probeEligible', () => {
  it('only directly runnable targets qualify', () => {
    expect(probeEligible(finding('clamp.js'))).toBe('node');
    expect(probeEligible(finding('app/orders.py'))).toBe('python');
    expect(probeEligible(finding('src/clamp.ts'))).toBeNull();
    expect(probeEligible({ ...finding(), file: undefined })).toBeNull();
  });
});

describe('executeProbe + runProbes (real node execution)', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.forEach(rm));
  const brokenProj = () => {
    const p = tmpProj();
    dirs.push(p);
    write(p, 'clamp.js', 'function clamp(n){ if (n<0) return 0; return n; }\nmodule.exports={clamp};\n');
    return p;
  };
  const fixedProj = () => {
    const p = tmpProj();
    dirs.push(p);
    write(p, 'clamp.js', 'function clamp(n){ if (n<0) return 0; if (n>100) return 100; return n; }\nmodule.exports={clamp};\n');
    return p;
  };

  it('a failing probe upgrades the finding to a blocking FACT with a repro command', async () => {
    const proj = brokenProj();
    const cfg = defaultConfig();
    const out = await runProbes([finding()], {
      proj,
      intent,
      cfg,
      deps: { generate: async () => ({ language: 'node', code: FAILING_PROBE }) },
    });
    expect(out[0].provenBy).toBe('probe');
    expect(out[0].kind).toBe('blocking'); // blockWhenProven default
    expect(out[0].confidence).toBe('fact');
    expect(out[0].command).toMatch(/node ".vouch\/runs\/probes/);
    expect(fs.existsSync(path.join(proj, out[0].probe!.path))).toBe(true);
  });

  it('a passing probe DOWNGRADES the finding (could not reproduce)', async () => {
    const proj = fixedProj();
    const out = await runProbes([finding()], {
      proj,
      intent,
      cfg: defaultConfig(),
      deps: { generate: async () => ({ language: 'node', code: FAILING_PROBE }) },
    });
    expect(out[0].provenBy).toBeUndefined();
    expect(out[0].kind).toBe('question');
    expect(out[0].score).toBeCloseTo(0.4); // 0.8 × 0.5
    expect(out[0].detail).toMatch(/could NOT reproduce/);
  });

  it('a crashing probe is INCONCLUSIVE — classification unchanged', async () => {
    const proj = brokenProj();
    const out = await runProbes([finding()], {
      proj,
      intent,
      cfg: defaultConfig(),
      deps: { generate: async () => ({ language: 'node', code: `throw new Error('boom'); // ${PROBE_MARKER}` }) },
    });
    expect(out[0].provenBy).toBeUndefined();
    expect(out[0].kind).toBe('question');
    expect(out[0].probe?.outcome).toBe('inconclusive');
  });

  it('screened-out probes and model declines leave the finding unchanged', async () => {
    const proj = brokenProj();
    const notes: string[] = [];
    const out = await runProbes([finding()], {
      proj,
      intent,
      cfg: defaultConfig(),
      onNote: (s) => notes.push(s),
      deps: { generate: async () => ({ language: 'node', code: `require('child_process'); // ${PROBE_MARKER}` }) },
    });
    expect(out[0].probe).toBeUndefined();
    expect(notes.join(' ')).toMatch(/not executed/);
  });

  it('respects maxPerRun and skips ineligible (TS) targets with a note', async () => {
    const proj = brokenProj();
    const cfg = defaultConfig();
    cfg.probe.maxPerRun = 1;
    let calls = 0;
    const notes: string[] = [];
    await runProbes([finding(), finding('other.js'), finding('x.ts')], {
      proj,
      intent,
      cfg,
      onNote: (s) => notes.push(s),
      deps: { generate: async () => { calls++; return { language: 'node', code: FAILING_PROBE }; } },
    });
    expect(calls).toBe(1); // capped
    expect(notes.join(' ')).toMatch(/not directly runnable/);
  });
});

describe('rerunStoredProbes (deterministic quick-path)', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.forEach(rm));

  it('re-blocks while the probe still fails, clears when it passes', async () => {
    const proj = tmpProj();
    dirs.push(proj);
    write(proj, 'clamp.js', 'function clamp(n){ if (n<0) return 0; return n; }\nmodule.exports={clamp};\n');
    write(proj, '.vouch/runs/probes/abc123.cjs', FAILING_PROBE);
    const stored = [{ id: 'abc123', title: 'upper bound missing', file: 'clamp.js', criterion: 'returns 100 when n>100', command: 'node ".vouch/runs/probes/abc123.cjs"' }];

    const r1 = await rerunStoredProbes(stored, proj, 20);
    expect(r1.stillFailing).toHaveLength(1);
    expect(r1.stillFailing[0].id).toBe('abc123'); // same fingerprint → dismissals still work
    expect(r1.stillFailing[0].kind).toBe('blocking');

    // fix the code → probe passes → cleared
    write(proj, 'clamp.js', 'function clamp(n){ if (n<0) return 0; if (n>100) return 100; return n; }\nmodule.exports={clamp};\n');
    const r2 = await rerunStoredProbes(stored, proj, 20);
    expect(r2.stillFailing).toHaveLength(0);
    expect(r2.clearedIds).toEqual(['abc123']);
  });

  it('a missing probe file clears instead of failing', async () => {
    const proj = tmpProj();
    dirs.push(proj);
    const r = await rerunStoredProbes([{ id: 'x', title: 't', command: 'node ".vouch/runs/probes/gone.cjs"' }], proj, 10);
    expect(r.stillFailing).toHaveLength(0);
    expect(r.clearedIds).toEqual(['x']);
  });
});
