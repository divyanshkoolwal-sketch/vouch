// Golden eval set. Each case: a baseline repo state, a change (working-tree
// edits = the diff to review), an intent, and whether a correct reviewer SHOULD
// flag it. Three buckets: `bad` (real defect vs intent → expect flag), `good`
// (correct change → expect clean), `hardneg` (correct-but-unusual, the classic
// false-positive traps → expect clean).
import { TierName } from '../core/types';

export interface EvalCase {
  name: string;
  bucket: 'good' | 'bad' | 'hardneg';
  expect: 'flag' | 'clean';
  intent: { summary: string; acceptance_criteria: string[]; non_goals?: string[] };
  baseline: Record<string, string>;
  change: Record<string, string>;
  /** Per-case tier overrides (e.g. integrity-only cases run without the LLM). */
  tiersOverride?: Partial<Record<TierName, boolean>>;
  /** Expect this bad case to end PROBE-PROVEN (blocking fact with runnable repro). */
  expectProven?: boolean;
}

export const CASES: EvalCase[] = [
  {
    name: 'bad-missing-upper-clamp',
    bucket: 'bad',
    expect: 'flag',
    expectProven: true,
    intent: { summary: 'clamp(n) bounds its input to the inclusive range 0..100.', acceptance_criteria: ['returns 0 when n < 0', 'returns 100 when n > 100', 'returns n unchanged when 0<=n<=100'] },
    baseline: { 'clamp.js': 'function clamp(n){ return n; }\nmodule.exports={clamp};\n' },
    change: { 'clamp.js': 'function clamp(n){ if (n < 0) return 0; return n; }\nmodule.exports={clamp};\n' },
  },
  {
    name: 'bad-weakened-test',
    bucket: 'bad',
    expect: 'flag',
    tiersOverride: { intent: false, integrity: true },
    intent: { summary: 'lineTotal multiplies price by qty.', acceptance_criteria: ['lineTotal(10,3) === 30'] },
    baseline: {
      'orders.js': 'function lineTotal(p,q){ return p*q; }\nmodule.exports={lineTotal};\n',
      'orders.test.js': "const {lineTotal}=require('./orders');\nit('multiplies', () => { expect(lineTotal(10,3)).toBe(30); });\n",
    },
    change: {
      'orders.js': 'function lineTotal(p,q){ return p+q; }\nmodule.exports={lineTotal};\n',
      'orders.test.js': "const {lineTotal}=require('./orders');\nit('multiplies', () => { expect(lineTotal(10,3)).toBeDefined(); });\n",
    },
  },
  {
    name: 'hardneg-test-refactor',
    bucket: 'hardneg',
    expect: 'clean',
    tiersOverride: { intent: false, integrity: true },
    intent: { summary: 'rename a test for clarity.', acceptance_criteria: ['tests unchanged in behavior'] },
    baseline: {
      'orders.test.js': "const {lineTotal}=require('./orders');\nit('works', () => { expect(lineTotal(10,3)).toBe(30); });\n",
      'orders.js': 'function lineTotal(p,q){ return p*q; }\nmodule.exports={lineTotal};\n',
    },
    change: {
      'orders.test.js': "const {lineTotal}=require('./orders');\nit('multiplies price by qty', () => { expect(lineTotal(10,3)).toBe(30); });\nit('handles zero qty', () => { expect(lineTotal(10,0)).toBe(0); });\n",
    },
  },
  {
    name: 'bad-no-negative-rejection',
    bucket: 'bad',
    expect: 'flag',
    intent: { summary: 'parseAmount(s) parses a number and REJECTS negative amounts by returning null.', acceptance_criteria: ['returns the number for a valid non-negative amount', 'returns null when the parsed amount is negative'] },
    baseline: { 'amount.js': 'function parseAmount(s){ return Number(s); }\nmodule.exports={parseAmount};\n' },
    change: { 'amount.js': 'function parseAmount(s){ const n = Number(s); if (Number.isNaN(n)) return null; return n; }\nmodule.exports={parseAmount};\n' },
  },
  {
    name: 'good-full-clamp',
    bucket: 'good',
    expect: 'clean',
    intent: { summary: 'clamp(n) bounds its input to the inclusive range 0..100.', acceptance_criteria: ['returns 0 when n < 0', 'returns 100 when n > 100', 'returns n unchanged when 0<=n<=100'] },
    baseline: { 'clamp.js': 'function clamp(n){ return n; }\nmodule.exports={clamp};\n' },
    change: { 'clamp.js': 'function clamp(n){ if (n < 0) return 0; if (n > 100) return 100; return n; }\nmodule.exports={clamp};\n' },
  },
  {
    name: 'good-simple-sum',
    bucket: 'good',
    expect: 'clean',
    intent: { summary: 'add(a,b) returns the sum of a and b.', acceptance_criteria: ['add(2,3) === 5', 'handles negative numbers'] },
    baseline: { 'add.js': 'module.exports={};\n' },
    change: { 'add.js': 'function add(a,b){ return a + b; }\nmodule.exports={add};\n' },
  },
  {
    name: 'hardneg-intentional-empty-catch',
    bucket: 'hardneg',
    expect: 'clean',
    intent: { summary: 'readConfig() returns parsed JSON config, or {} if the file is missing or invalid.', acceptance_criteria: ['returns the parsed object when the file is valid JSON', 'returns {} when the file is missing or invalid (never throws)'], non_goals: ['logging the error'] },
    baseline: { 'config.js': 'const fs=require("fs");\nfunction readConfig(){ return JSON.parse(fs.readFileSync("c.json","utf8")); }\nmodule.exports={readConfig};\n' },
    change: { 'config.js': 'const fs=require("fs");\nfunction readConfig(){\n  try { return JSON.parse(fs.readFileSync("c.json","utf8")); }\n  catch { return {}; } // missing/invalid → default, by design\n}\nmodule.exports={readConfig};\n' },
  },
  {
    name: 'hardneg-order-unusual-but-correct',
    bucket: 'hardneg',
    expect: 'clean',
    intent: { summary: 'isValid(s) returns true only for a non-empty string containing "@".', acceptance_criteria: ['true for "a@b"', 'false for "" and for a string without @'], non_goals: ['full RFC email validation', 'trimming whitespace', 'null handling'] },
    baseline: { 'valid.js': 'module.exports={};\n' },
    change: { 'valid.js': 'function isValid(s){ return s.length > 0 && s.includes("@"); }\nmodule.exports={isValid};\n' },
  },
];
