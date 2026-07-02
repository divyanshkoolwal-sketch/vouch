// Security regression tests. Each asserts a specific hardening holds, so a
// future refactor that reopens the hole fails CI. Grouped by the vulnerability
// class it defends against.
import { describe, it, expect, afterEach } from 'vitest';
import { selectTests } from '../src/core/tia';
import { checkTestIntegrity } from '../src/core/testIntegrity';
import { redactSecrets } from '../src/core/redact';
import { normalizeConfig } from '../src/core/config';
import { screenProbe, buildProbeExec, executeProbe, PROBE_MARKER } from '../src/core/review/probe';
import { defaultConfig } from '../src/core/config';
import { FileDiff } from '../src/core/diff';
import { tmpProj, rm, write } from './helpers';

describe('TIA shell-injection (filenames reach /bin/sh -c)', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.forEach(rm));

  it('single-quotes a malicious filename so no command substitution can run', () => {
    const p = tmpProj();
    dirs.push(p);
    write(p, 'package.json', JSON.stringify({ scripts: { test: 'jest' } }));
    const evil = 'a$(touch PWNED).js';
    write(p, evil, 'module.exports = {};');
    const r = selectTests({ proj: p, testCmd: 'npm test', changedFiles: [evil], enabled: true });
    expect(r.narrowed).toBe(true);
    // The dangerous token must appear ONLY inside single quotes (inert to sh).
    expect(r.command).toContain("'a$(touch PWNED).js'");
    // It must NOT appear double-quoted or bare (either would let sh run $(...)).
    expect(r.command).not.toContain('"a$(touch PWNED).js"');
    expect(r.command).not.toMatch(/[^']a\$\(touch/);
  });

  it("escapes an embedded single quote with the close-reopen idiom", () => {
    const p = tmpProj();
    dirs.push(p);
    write(p, 'package.json', JSON.stringify({ scripts: { test: 'jest' } }));
    const evil = "a'b.js";
    write(p, evil, 'module.exports = {};');
    const r = selectTests({ proj: p, testCmd: 'npm test', changedFiles: [evil], enabled: true });
    expect(r.command).toContain("'a'\\''b.js'");
  });
});

describe('testIntegrity ReDoS resistance', () => {
  it('handles a pathological multi-KB line without hanging', () => {
    // Thousands of "(" with no closing structure — the classic backtracking bait.
    const nasty = '+' + 'expect(' + '('.repeat(200000);
    const perFile: FileDiff[] = [{ file: 'a.test.js', patch: nasty, addedLines: 1 }];
    const start = Date.now();
    const out = checkTestIntegrity(perFile, defaultConfig());
    const ms = Date.now() - start;
    expect(ms).toBeLessThan(500); // bounded work, not catastrophic backtracking
    expect(Array.isArray(out)).toBe(true);
  });
});

describe('redactSecrets', () => {
  it('masks common secret shapes and leaves ordinary text intact', () => {
    expect(redactSecrets('key sk-ABCDEFGHIJKLMNOPQRSTUVWX123456')).toContain('[REDACTED]');
    expect(redactSecrets('ghp_' + 'a'.repeat(36))).toBe('[REDACTED]');
    expect(redactSecrets('AKIA' + 'ABCDEFGHIJKLMNOP')).toBe('[REDACTED]');
    expect(redactSecrets('-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----')).toBe('[REDACTED]');
    expect(redactSecrets('nothing secret here')).toBe('nothing secret here');
  });
});

describe('config clamping (a hostile config cannot request abusive resources)', () => {
  it('clamps out-of-range numeric fields and drops flag-smuggling model/apiKeyEnv', () => {
    const merged = normalizeConfig({
      reviewer: { timeoutSec: 99999, model: 'foo --dangerously-run', apiKeyEnv: 'PATH' } as any,
      review: { concurrency: 9999, quorumN: 9999, maxReviewFiles: 999999 } as any,
      probe: { timeoutSec: 99999, maxPerRun: 9999 } as any,
      enforcement: { maxIterations: 9999 } as any,
      commandTimeoutSec: 99999,
      budgetSec: 99999,
    });
    expect(merged.reviewer.timeoutSec).toBeLessThanOrEqual(300);
    expect(merged.reviewer.model).toBeUndefined(); // contained a space/flag → dropped
    expect(merged.reviewer.apiKeyEnv).toBeUndefined(); // not on the allowlist → dropped
    expect(merged.review.concurrency).toBeLessThanOrEqual(8);
    expect(merged.review.quorumN).toBeLessThanOrEqual(7);
    expect(merged.review.maxReviewFiles).toBeLessThanOrEqual(200);
    expect(merged.probe.timeoutSec).toBeLessThanOrEqual(60);
    expect(merged.probe.maxPerRun).toBeLessThanOrEqual(20);
    expect(merged.enforcement.maxIterations).toBeLessThanOrEqual(10);
    expect(merged.commandTimeoutSec).toBeLessThanOrEqual(300);
    expect(merged.budgetSec).toBeLessThanOrEqual(600);
  });

  it('keeps an allowlisted apiKeyEnv and a clean model', () => {
    const merged = normalizeConfig({ reviewer: { apiKeyEnv: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-5' } as any });
    expect(merged.reviewer.apiKeyEnv).toBe('ANTHROPIC_API_KEY');
    expect(merged.reviewer.model).toBe('claude-sonnet-5');
  });
});

describe('probe sandbox + path safety', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.forEach(rm));

  it('screens out forbidden APIs and network/fs escapes', () => {
    expect(screenProbe(`require('child_process'); // ${PROBE_MARKER}`, 'node')).toMatch(/forbidden/);
    expect(screenProbe(`require('net'); // ${PROBE_MARKER}`, 'node')).toMatch(/forbidden/);
    expect(screenProbe(`import('x'); // ${PROBE_MARKER}`, 'node')).toMatch(/forbidden/);
    expect(screenProbe(`fs.writeFileSync('a','b'); // ${PROBE_MARKER}`, 'node')).toMatch(/forbidden/);
  });

  it('refuses a probe id that is not a hex fingerprint (no path traversal)', async () => {
    const p = tmpProj();
    dirs.push(p);
    // '../../etc/x' is not [a-f0-9]{6,} → probeAbsPath returns null → not executed.
    const info = await executeProbe(p, '../../../etc/passwd', 'node', `console.log('${PROBE_MARKER}');`, defaultConfig());
    expect(info.outcome).toBe('inconclusive');
    expect(info.path).toBe('');
  });

  it('a Node probe that tries to read outside the repo is denied by the OS sandbox', async () => {
    const p = tmpProj();
    dirs.push(p);
    // Reads /etc/hosts (outside repo). Under --permission --allow-fs-read=<repo>
    // this throws ERR_ACCESS_DENIED → non-zero exit, no marker → inconclusive.
    const code = [
      "const fs = require('fs');",
      "try { fs.readFileSync('/etc/hosts'); } catch (e) { console.log('denied'); process.exit(2); }",
      `console.log('${PROBE_MARKER}: read succeeded');`,
      'process.exit(1);',
    ].join('\n');
    const info = await executeProbe(p, 'aa11bb22', 'node', code, defaultConfig());
    expect(info.outcome).not.toBe('proven'); // must NOT have read the outside file
  });

  it('does not run Python probes unless explicitly allowed', () => {
    const cfg = defaultConfig();
    expect(cfg.probe.allowPython).toBe(false);
    const exec = buildProbeExec('/repo', '/repo/.vouch/runs/probes/aa11bb.py', 'python', cfg);
    expect(exec).toBeNull(); // python off by default
  });
});
