// Precision/recall eval harness. Runs the real review pipeline over the golden
// set and reports a confusion matrix + false-positive rate. Gate: fails (exit 1)
// if the effective false-positive rate exceeds 10% (Google's "developers will
// disable it" threshold) or recall on real defects drops below the floor.
//
// Usage: node dist/eval.js            (mode from VOUCH_EVAL_MODE, default bounded)
//        VOUCH_EVAL_MODE=thorough node dist/eval.js
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { CASES, EvalCase } from './cases';
import { runPipeline } from '../core/pipeline';
import { defaultConfig, saveConfig } from '../core/config';
import { recordIntent } from '../core/intent';
import { VouchConfig } from '../core/types';

const FP_GATE = 0.1;
const RECALL_FLOOR = 0.5;

function sh(proj: string, args: string[]) {
  execFileSync('git', args, { cwd: proj, stdio: 'ignore' });
}

function setupCase(c: EvalCase): string {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'vouch-eval-'));
  sh(proj, ['init', '-q']);
  sh(proj, ['config', 'user.email', 'e@e.e']);
  sh(proj, ['config', 'user.name', 'e']);
  for (const [f, content] of Object.entries(c.baseline)) fs.writeFileSync(path.join(proj, f), content);
  sh(proj, ['add', '-A']);
  sh(proj, ['commit', '-qm', 'baseline']);
  for (const [f, content] of Object.entries(c.change)) fs.writeFileSync(path.join(proj, f), content);

  const cfg: VouchConfig = defaultConfig();
  cfg.tiers = { typecheck: false, lint: false, build: false, test: false, intent: true, smoke: false };
  const mode = (process.env.VOUCH_EVAL_MODE as VouchConfig['mode']) || 'bounded';
  cfg.mode = mode;
  if (mode === 'bounded') cfg.review.quorumN = 1;
  cfg.reviewer.timeoutSec = 90;
  saveConfig(proj, cfg);
  recordIntent(proj, c.intent, new Date().toISOString());
  return proj;
}

async function main() {
  const only = process.env.VOUCH_EVAL_ONLY;
  const cases = only ? CASES.filter((c) => c.name.includes(only)) : CASES;
  console.log(`Running ${cases.length} eval cases (mode=${process.env.VOUCH_EVAL_MODE || 'bounded'})…\n`);

  let tp = 0, fp = 0, tn = 0, fn = 0;
  const rows: string[] = [];

  for (const c of cases) {
    const proj = setupCase(c);
    let flagged = false;
    let detail = '';
    try {
      const cfg = defaultConfig();
      cfg.tiers = { typecheck: false, lint: false, build: false, test: false, intent: true, smoke: false };
      cfg.mode = (process.env.VOUCH_EVAL_MODE as VouchConfig['mode']) || 'bounded';
      if (cfg.mode === 'bounded') cfg.review.quorumN = 1;
      const intent = JSON.parse(fs.readFileSync(path.join(proj, '.vouch/intent/active.json'), 'utf8'));
      const res = await runPipeline({ proj, cfg, intent, force: true });
      const surfaced = [...res.blocking, ...res.questions];
      flagged = surfaced.length > 0;
      detail = surfaced.map((f) => f.title).join('; ').slice(0, 80);
    } catch (e: any) {
      detail = 'ERROR ' + (e?.message ?? e);
    } finally {
      fs.rmSync(proj, { recursive: true, force: true });
    }

    const correct = (c.expect === 'flag') === flagged;
    if (c.expect === 'flag') flagged ? tp++ : fn++;
    else flagged ? fp++ : tn++;
    rows.push(`  ${correct ? '✅' : '❌'} [${c.bucket}] ${c.name} → ${flagged ? 'FLAGGED' : 'clean'}${detail ? `  (${detail})` : ''}`);
  }

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const cleanTotal = fp + tn;
  const fpRate = cleanTotal === 0 ? 0 : fp / cleanTotal;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  console.log(rows.join('\n'));
  console.log('\n— Confusion matrix —');
  console.log(`  TP ${tp}  FP ${fp}  TN ${tn}  FN ${fn}`);
  console.log(`  precision ${(precision * 100).toFixed(0)}%  recall ${(recall * 100).toFixed(0)}%  F1 ${(f1 * 100).toFixed(0)}%`);
  console.log(`  effective false-positive rate ${(fpRate * 100).toFixed(0)}%  (gate: <${FP_GATE * 100}%)`);

  const pass = fpRate <= FP_GATE && recall >= RECALL_FLOOR;
  console.log(`\n${pass ? '✅ PASS' : '❌ FAIL'} — FP ${(fpRate * 100).toFixed(0)}% (≤${FP_GATE * 100}%), recall ${(recall * 100).toFixed(0)}% (≥${RECALL_FLOOR * 100}%)`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('eval harness error:', e);
  process.exit(2);
});
