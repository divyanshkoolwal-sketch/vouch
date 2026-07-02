// Test-integrity tier: deterministic diff analysis that catches the classic
// agent reward-hack — making tests pass by weakening the tests. No LLM, no
// commands; pure inspection of the per-file patches we already have.
//
// Detector severity philosophy (false-positive guardrail):
//   - focus/skip added, matcher loosened  → blocking-eligible (near-zero legit
//     reasons for an *agent* to leave these in a change)
//   - net assertion loss, test deletion   → notice (often legitimate refactors)
//   - expected-value drift                → question (legit when intent changed)
// The "prod code changed in the same diff" condition gates the ambiguous
// detectors: refactoring tests alone is normal; weakening tests while changing
// the code they test is the smell.
import { Finding, VouchConfig } from './types';
import { makeFinding } from './findings';
import { FileDiff } from './diff';

export function isTestFile(f: string): boolean {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(f)) return true;
  if (/(^|\/)__tests__\//.test(f)) return true;
  if (/(^|\/)test_[^/]+\.py$/.test(f) || /_test\.(py|go)$/.test(f)) return true;
  if (/(^|\/)tests?\//.test(f) && /\.(py|go|rb|[cm]?[jt]sx?)$/.test(f)) return true;
  return false;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function changedLines(patch: string): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  for (let line of patch.split('\n')) {
    line = line.replace(/^\d+: /, ''); // tolerate the synthesized new-file format
    if (line.startsWith('+') && !line.startsWith('+++')) added.push(line.slice(1));
    else if (line.startsWith('-') && !line.startsWith('---')) removed.push(line.slice(1));
  }
  return { added, removed };
}

/** Cancel out moved/reindented lines (identical normalized content on both
 *  sides) so refactors don't read as additions/deletions. */
function cancelMoves(added: string[], removed: string[]): { netAdded: string[]; netRemoved: string[] } {
  const count = (lines: string[]) => {
    const m = new Map<string, number>();
    for (const l of lines) {
      const k = norm(l);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const a = count(added);
  const netRemoved = removed.filter((l) => {
    const k = norm(l);
    const c = a.get(k) ?? 0;
    if (c > 0) {
      a.set(k, c - 1);
      return false;
    }
    return true;
  });
  const r = count(removed);
  const netAdded = added.filter((l) => {
    const k = norm(l);
    const c = r.get(k) ?? 0;
    if (c > 0) {
      r.set(k, c - 1);
      return false;
    }
    return true;
  });
  return { netAdded, netRemoved };
}

const FOCUS_SKIP = /(\.(only|skip)\s*\()|(\bx(it|describe|test)\s*\()|(@pytest\.mark\.skip)|(\bunittest\.skip)|(\bt\.Skip\s*\()/;
const ASSERTION = /(\bexpect\s*\()|(\bassert\b)|(\.should\b)|(\bassert[A-Z]\w*\s*\()/;
const TEST_DECL = /(\b(it|test)\s*\(\s*['"`])|(\bdef\s+test_)/;
const STRICT_MATCHER = /\.(toBe|toEqual|toStrictEqual)\s*\(/;
const VACUOUS_MATCHER = /\.(toBeTruthy|toBeDefined|toBeFalsy)\s*\(|\.not\.toThrow\s*\(/;

function expectSubject(line: string): string | null {
  const m = line.match(/expect\s*\((.*?)\)\s*\./);
  return m ? norm(m[1]) : null;
}

function toBeArg(line: string): { subject: string; arg: string } | null {
  const m = line.match(/expect\s*\((.*?)\)\s*\.(?:toBe|toEqual|toStrictEqual)\s*\((.*?)\)/);
  return m ? { subject: norm(m[1]), arg: norm(m[2]) } : null;
}

const sample = (lines: string[], n = 3) => lines.slice(0, n).map((l) => `  ${l.trim()}`).join('\n');

export function checkTestIntegrity(perFile: FileDiff[], cfg: VouchConfig): Finding[] {
  const findings: Finding[] = [];
  const prodChanged = perFile.some((f) => !isTestFile(f.file));
  const canBlock = cfg.enforcement.block && cfg.enforcement.blockOn.includes('integrity');

  for (const fd of perFile) {
    if (!isTestFile(fd.file)) continue;
    const { added, removed } = changedLines(fd.patch);
    const { netAdded, netRemoved } = cancelMoves(added, removed);

    // 1. Focus/skip markers added (high signal → blocking-eligible).
    const skips = netAdded.filter((l) => FOCUS_SKIP.test(l));
    if (skips.length) {
      findings.push(
        makeFinding({
          kind: canBlock ? 'blocking' : 'info',
          tier: 'integrity',
          title: 'test focus/skip marker added',
          file: fd.file,
          confidence: 'fact',
          detail: `This change adds ${skips.length} focus/skip marker(s) — .only/.skip silently disables tests:\n${sample(skips)}\nRemove them (or dismiss if genuinely intended).`,
          fpExtra: ['focus-skip'],
        }),
      );
    }

    // 2. Strict matcher loosened to a vacuous one on the same expect subject
    //    (high signal → blocking-eligible).
    const strictSubjects = new Set(netRemoved.filter((l) => STRICT_MATCHER.test(l)).map(expectSubject).filter(Boolean) as string[]);
    const loosened = netAdded.filter((l) => {
      if (!VACUOUS_MATCHER.test(l)) return false;
      const s = expectSubject(l);
      return !!s && strictSubjects.has(s);
    });
    if (loosened.length) {
      findings.push(
        makeFinding({
          kind: canBlock ? 'blocking' : 'info',
          tier: 'integrity',
          title: 'test assertion loosened (strict matcher → vacuous)',
          file: fd.file,
          confidence: 'fact',
          detail: `A strict assertion was replaced with one that can barely fail:\n${sample(loosened)}\nRestore a strict assertion on the real expected value.`,
          fpExtra: ['loosened-matcher'],
        }),
      );
    }

    // 3. Net assertion loss while prod code changed (ambiguous → notice).
    const removedAsserts = netRemoved.filter((l) => ASSERTION.test(l)).length;
    const addedAsserts = netAdded.filter((l) => ASSERTION.test(l)).length;
    const netLoss = removedAsserts - addedAsserts;
    if (prodChanged && netLoss >= 2) {
      findings.push(
        makeFinding({
          kind: 'info',
          tier: 'integrity',
          title: 'assertions removed alongside production changes',
          file: fd.file,
          confidence: 'fact',
          detail: `${netLoss} more assertion(s) removed than added in this test file, in the same change that modifies production code. Make sure coverage wasn't weakened to get tests passing.`,
          fpExtra: ['assertion-loss'],
        }),
      );
    }

    // 4. Test cases deleted while prod code changed (ambiguous → notice).
    const deletedTests = netRemoved.filter((l) => TEST_DECL.test(l)).length;
    const addedTests = netAdded.filter((l) => TEST_DECL.test(l)).length;
    if (prodChanged && deletedTests > addedTests) {
      findings.push(
        makeFinding({
          kind: 'info',
          tier: 'integrity',
          title: 'test case(s) deleted alongside production changes',
          file: fd.file,
          confidence: 'fact',
          detail: `${deletedTests - addedTests} test case(s) removed in the same change that modifies production code. Confirm the deletion was requested, not a shortcut to green.`,
          fpExtra: ['test-deleted'],
        }),
      );
    }

    // 5. Expected-value drift while prod changed (often legit → question).
    if (prodChanged) {
      const before = new Map(netRemoved.map(toBeArg).filter(Boolean).map((x) => [x!.subject, x!.arg]));
      const drifted = netAdded
        .map(toBeArg)
        .filter((x): x is { subject: string; arg: string } => !!x)
        .filter((x) => before.has(x.subject) && before.get(x.subject) !== x.arg);
      if (drifted.length) {
        findings.push(
          makeFinding({
            kind: 'question',
            tier: 'integrity',
            title: 'expected test values changed to match new behavior',
            file: fd.file,
            confidence: 'fact',
            detail: `${drifted.length} assertion(s) had their expected value changed in the same diff that changes the code under test (e.g. ${drifted[0].subject}: ${before.get(drifted[0].subject)} → ${drifted[0].arg}). Confirm the NEW values are what the user actually wants — not the code's new (possibly wrong) output.`,
            fpExtra: ['expectation-drift'],
          }),
        );
      }
    }
  }

  return findings;
}
