import { describe, it, expect } from 'vitest';
import { checkTestIntegrity, isTestFile } from '../src/core/testIntegrity';
import { defaultConfig } from '../src/core/config';
import { FileDiff } from '../src/core/diff';

const cfg = () => defaultConfig(); // blockOn includes 'integrity' by default

const fd = (file: string, lines: string[]): FileDiff => ({
  file,
  patch: `diff --git a/${file} b/${file}\n@@ -1,5 +1,5 @@\n` + lines.join('\n'),
  addedLines: lines.filter((l) => l.startsWith('+')).length,
});

const prod = fd('src/calc.js', ['+function add(a,b){return a-b;}', '-function add(a,b){return a+b;}']);

describe('isTestFile', () => {
  it('recognizes common conventions', () => {
    expect(isTestFile('src/a.test.ts')).toBe(true);
    expect(isTestFile('src/a.spec.js')).toBe(true);
    expect(isTestFile('src/__tests__/a.js')).toBe(true);
    expect(isTestFile('app/test_orders.py')).toBe(true);
    expect(isTestFile('pkg/foo_test.go')).toBe(true);
    expect(isTestFile('src/calc.js')).toBe(false);
  });
});

describe('checkTestIntegrity detectors', () => {
  it('flags an added .only/.skip as blocking (default blockOn)', () => {
    const out = checkTestIntegrity([prod, fd('src/calc.test.js', ["+  it.only('adds', () => {", '   expect(add(2,3)).toBe(5);'])], cfg());
    const f = out.find((x) => x.title.includes('focus/skip'));
    expect(f).toBeTruthy();
    expect(f!.kind).toBe('blocking');
    expect(f!.confidence).toBe('fact');
    expect(f!.tier).toBe('integrity');
  });

  it('does NOT flag a moved/reindented skip line (cancel-moves)', () => {
    const out = checkTestIntegrity([fd('a.test.js', ["-it.skip('x', f)", "+  it.skip('x', f)"])], cfg());
    expect(out).toHaveLength(0);
  });

  it('flags strict→vacuous matcher loosening on the same subject as blocking', () => {
    const out = checkTestIntegrity(
      [prod, fd('src/calc.test.js', ['-  expect(add(2,3)).toBe(5);', '+  expect(add(2,3)).toBeDefined();'])],
      cfg(),
    );
    const f = out.find((x) => x.title.includes('loosened'));
    expect(f).toBeTruthy();
    expect(f!.kind).toBe('blocking');
  });

  it('vacuous matcher on a DIFFERENT subject is not loosening', () => {
    const out = checkTestIntegrity(
      [prod, fd('src/calc.test.js', ['-  expect(add(2,3)).toBe(5);', '+  expect(add(2,3)).toBe(6);', '+  expect(other()).toBeDefined();'])],
      cfg(),
    );
    expect(out.find((x) => x.title.includes('loosened'))).toBeFalsy();
  });

  it('reports net assertion loss alongside prod changes as a NOTICE', () => {
    const out = checkTestIntegrity(
      [prod, fd('src/calc.test.js', ['-  expect(a).toBe(1);', '-  expect(b).toBe(2);', '-  expect(c).toBe(3);', '+  expect(a).toBe(1);'])],
      cfg(),
    );
    const f = out.find((x) => x.title.includes('assertions removed'));
    expect(f).toBeTruthy();
    expect(f!.kind).toBe('info');
  });

  it('assertion loss WITHOUT prod changes is silent (test-only refactor)', () => {
    const out = checkTestIntegrity(
      [fd('src/calc.test.js', ['-  expect(a).toBe(1);', '-  expect(b).toBe(2);', '-  expect(c).toBe(3);'])],
      cfg(),
    );
    expect(out).toHaveLength(0);
  });

  it('reports deleted test cases alongside prod changes as a NOTICE', () => {
    const out = checkTestIntegrity([prod, fd('src/calc.test.js', ["-it('adds', () => {", '-  expect(add(2,3)).toBe(5);', '-});'])], cfg());
    expect(out.find((x) => x.title.includes('deleted'))).toBeTruthy();
  });

  it('reports expected-value drift with prod changes as a QUESTION', () => {
    const out = checkTestIntegrity(
      [prod, fd('src/calc.test.js', ['-  expect(add(2,3)).toBe(5);', '+  expect(add(2,3)).toBe(-1);'])],
      cfg(),
    );
    const f = out.find((x) => x.title.includes('expected test values'));
    expect(f).toBeTruthy();
    expect(f!.kind).toBe('question');
  });

  it('adding NEW tests is never flagged', () => {
    const out = checkTestIntegrity(
      [prod, fd('src/calc.test.js', ["+it('new case', () => {", '+  expect(add(1,1)).toBe(2);', '+});'])],
      cfg(),
    );
    expect(out).toHaveLength(0);
  });

  it('ignores non-test files entirely', () => {
    const out = checkTestIntegrity([fd('src/calc.js', ["+const x = it.only('nope');"])], cfg());
    expect(out).toHaveLength(0);
  });

  it('blocking detectors degrade to notices when integrity is not in blockOn', () => {
    const c = cfg();
    c.enforcement.blockOn = ['test'];
    const out = checkTestIntegrity([prod, fd('a.test.js', ["+it.only('x', f)"])], c);
    expect(out[0].kind).toBe('info');
  });
});
