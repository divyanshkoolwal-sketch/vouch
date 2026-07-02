// Finding-guided probes: "no repro, no block". For each verified behavioral
// finding, ask the (verify-role, i.e. cross-model when available) reviewer for a
// tiny standalone script that exits non-zero — printing a marker — iff the
// violated criterion is violated by the CURRENT code. We statically screen it,
// execute it sandbox-ish (timeout, no writes by contract + screening), and let
// the exit code decide:
//   probe fails with marker → the finding is now a deterministic FACT with a
//                             runnable repro (blocks by default);
//   probe passes            → the claim couldn't be reproduced (downgrade);
//   probe crashes/screened  → inconclusive, finding unchanged (our tooling
//                             failing is never evidence about the code).
// Probe files persist under .vouch/runs/probes/ so the next fix-loop round can
// re-check them deterministically with zero LLM calls.
import * as fs from 'fs';
import * as path from 'path';
import { Finding, IntentRecord, VouchConfig, ProbeInfo, StoredProbe } from '../types';
import { runReviewer, extractJSON } from './backends';
import { runCommand } from '../runners';
import { runsDir } from '../memory';
import { mapLimit } from './concurrency';

export const PROBE_MARKER = 'VOUCH_PROBE_VIOLATION';
// The marker must be PRINTED by the probe (line-start, colon-delimited). A crash
// that merely echoes the probe's source in a stack trace must NOT count as
// proven — so we match printed lines, not substrings.
const MARKER_LINE = new RegExp(`^${PROBE_MARKER}:`, 'm');

const NODE_FORBIDDEN: RegExp[] = [
  /child_process/,
  /\bexec(Sync)?\s*\(/,
  /\bspawn(Sync)?\s*\(/,
  /fs\.(write|append|rm|unlink|mkdir|rename|cp|chmod|truncate|createWriteStream)/,
  /require\(\s*['"](http|https|net|tls|dgram|dns|worker_threads)['"]\s*\)/,
  /\bfetch\s*\(/,
  /XMLHttpRequest|WebSocket/,
];
const PY_FORBIDDEN: RegExp[] = [
  /\bsubprocess\b/,
  /os\.(system|popen|remove|rmdir|unlink|rename)/,
  /shutil\./,
  /\bopen\s*\([^)]*['"][wax]/,
  /\brequests\b/,
  /urllib/,
  /\bsocket\b/,
];

/** Static screen before execution. Returns a rejection reason or null (= safe
 *  to run). Deliberately conservative — a rejected probe is skipped, never
 *  surfaced as a finding. */
export function screenProbe(code: string, language: 'node' | 'python'): string | null {
  if (!code || !code.trim()) return 'empty probe';
  if (code.length > 4000) return 'probe too large';
  if (!code.includes(PROBE_MARKER)) return 'probe missing the violation marker';
  const rules = language === 'node' ? NODE_FORBIDDEN : PY_FORBIDDEN;
  for (const re of rules) {
    if (re.test(code)) return `probe uses a forbidden API (${re.source.slice(0, 40)})`;
  }
  return null;
}

/** Probes must import the real module directly — only runnable-as-is targets
 *  qualify in v1 (TS would need a loader; honest skip instead). */
export function probeEligible(f: Finding): 'node' | 'python' | null {
  const file = f.file ?? '';
  if (/\.[cm]?js$/.test(file)) return 'node';
  if (/\.py$/.test(file)) return 'python';
  return null;
}

const GEN_SYSTEM = [
  'You write a PROBE: a tiny standalone script that checks ONE suspected problem in a repo.',
  'Contract (strict):',
  '- The probe will run with CWD = the repo root.',
  "- Node probes are CommonJS. Load the target module with: const m = require(require('path').join(process.cwd(), '<relative path from repo root>'));",
  "- Python probes: import sys, os; sys.path.insert(0, os.getcwd()); then import the module.",
  `- Check ONLY the stated criterion. If it is VIOLATED by the current code: print "${PROBE_MARKER}: <one-line reason>" and exit with code 1. If it is satisfied: print "ok" and exit 0.`,
  '- Standard library only. No file writes, no network, no subprocesses, no external packages.',
  '- Keep it under 40 lines.',
  'Output a SINGLE JSON object and nothing else: {"language":"node"|"python","code":"<full script>"}',
  'If a reliable probe is not possible (e.g. the target cannot be imported directly), output {"language":"none"}.',
].join('\n');

function genPrompt(f: Finding, intent: IntentRecord): string {
  return [
    `# INTENT\n${intent.summary}`,
    f.criterion ? `\n# CRITERION TO PROBE\n${f.criterion}` : '\n# CRITERION TO PROBE\n(general intent above)',
    `\n# SUSPECTED PROBLEM\n${f.title}\n${f.detail ?? ''}`,
    `\n# TARGET MODULE\n${f.file ?? '(unknown)'}`,
    f.evidence ? `\n# CODE THE REVIEWER QUOTED\n\`\`\`\n${f.evidence}\n\`\`\`` : '',
    '\nWrite the probe now. Return the JSON object only.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function probesDirFor(proj: string): string {
  return path.join(runsDir(proj), 'probes');
}

export async function executeProbe(
  proj: string,
  id: string,
  language: 'node' | 'python',
  code: string,
  timeoutSec: number,
): Promise<ProbeInfo> {
  const dir = probesDirFor(proj);
  fs.mkdirSync(dir, { recursive: true });
  const ext = language === 'python' ? 'py' : 'cjs';
  const abs = path.join(dir, `${id}.${ext}`);
  fs.writeFileSync(abs, code);
  const rel = path.relative(proj, abs);
  const command = language === 'python' ? `python3 "${rel}"` : `node "${rel}"`;
  const r = await runCommand(command, proj, timeoutSec * 1000);
  const violated = r.code !== null && r.code !== 0 && MARKER_LINE.test(r.output);
  const outcome: ProbeInfo['outcome'] = violated ? 'proven' : r.code === 0 ? 'not-reproduced' : 'inconclusive';
  return { path: rel, command, language, outcome, outputTail: r.output.slice(-400) };
}

export interface ProbeDeps {
  generate: (f: Finding, intent: IntentRecord, cfg: VouchConfig, proj: string) => Promise<any>;
}

async function defaultGenerate(f: Finding, intent: IntentRecord, cfg: VouchConfig, proj: string): Promise<any> {
  const res = await runReviewer(
    {
      cwd: proj,
      systemPrompt: GEN_SYSTEM,
      userPrompt: genPrompt(f, intent),
      model: cfg.reviewer.model,
      timeoutSec: cfg.reviewer.timeoutSec,
      maxTurns: 6,
    },
    cfg,
    'verify',
  );
  if (!res || res.isError) return null;
  return extractJSON(res.text);
}

/** Run probes over verified findings; returns the findings with probe outcomes
 *  applied (proven → fact/blocking; not-reproduced → downgraded; else unchanged). */
export async function runProbes(
  findings: Finding[],
  opts: {
    proj: string;
    intent: IntentRecord;
    cfg: VouchConfig;
    deadlineMs?: number;
    onNote?: (s: string) => void;
    deps?: Partial<ProbeDeps>;
  },
): Promise<Finding[]> {
  const { proj, intent, cfg } = opts;
  const gen = opts.deps?.generate ?? defaultGenerate;
  const out = [...findings];

  const candidates = findings
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.tier === 'intent' && probeEligible(f));
  const ineligible = findings.filter((f) => f.tier === 'intent' && !probeEligible(f)).length;
  if (ineligible) opts.onNote?.(`probes: ${ineligible} finding(s) skipped (module not directly runnable, e.g. TypeScript)`);
  const capped = candidates.slice(0, cfg.probe.maxPerRun);
  if (candidates.length > capped.length) opts.onNote?.(`probes: capped at ${cfg.probe.maxPerRun} (of ${candidates.length})`);

  await mapLimit(capped, cfg.review.concurrency, async ({ f, i }) => {
    if (opts.deadlineMs && Date.now() + cfg.probe.timeoutSec * 1000 > opts.deadlineMs) {
      opts.onNote?.('probes: skipped (time budget reached)');
      return;
    }
    const g = await gen(f, intent, cfg, proj);
    const language = g?.language === 'node' || g?.language === 'python' ? (g.language as 'node' | 'python') : null;
    if (!language || typeof g?.code !== 'string') return; // model declined → finding unchanged
    if (probeEligible(f) !== language) return; // language must match the target
    const reason = screenProbe(g.code, language);
    if (reason) {
      opts.onNote?.(`probe for "${f.title}" not executed: ${reason}`);
      return;
    }
    const info = await executeProbe(proj, f.id, language, g.code, cfg.probe.timeoutSec);
    if (info.outcome === 'proven') {
      const block = cfg.enforcement.block && cfg.enforcement.blockWhenProven;
      out[i] = {
        ...f,
        kind: block ? 'blocking' : f.kind,
        confidence: 'fact',
        verified: true,
        provenBy: 'probe',
        command: info.command,
        probe: info,
        detail: [f.detail ?? '', `Probe demonstrated the violation — reproduce with: ${info.command}\n${(info.outputTail ?? '').trim()}`]
          .filter(Boolean)
          .join('\n'),
      };
    } else if (info.outcome === 'not-reproduced') {
      out[i] = {
        ...f,
        score: (f.score ?? 0.5) * 0.5,
        probe: info,
        detail: [f.detail ?? '', 'Note: an automated probe could NOT reproduce this — verify before treating it as a bug.']
          .filter(Boolean)
          .join('\n'),
      };
    } else {
      out[i] = { ...f, probe: info }; // inconclusive — unchanged classification
    }
  });

  return out;
}

/** Deterministically re-run probes persisted from the last blocking round.
 *  Still-failing probes reconstruct their findings (same fingerprint, so
 *  dismissals keep working) without any LLM call. */
export async function rerunStoredProbes(
  stored: StoredProbe[],
  proj: string,
  timeoutSec: number,
): Promise<{ stillFailing: Finding[]; clearedIds: string[] }> {
  const stillFailing: Finding[] = [];
  const clearedIds: string[] = [];
  for (const rec of stored) {
    const m = rec.command.match(/"([^"]+)"/);
    const rel = m ? m[1] : null;
    if (!rel || !fs.existsSync(path.join(proj, rel))) {
      clearedIds.push(rec.id);
      continue;
    }
    const r = await runCommand(rec.command, proj, timeoutSec * 1000);
    if (r.code !== null && r.code !== 0 && MARKER_LINE.test(r.output)) {
      stillFailing.push({
        id: rec.id,
        kind: 'blocking',
        tier: 'intent',
        title: rec.title,
        detail: `Probe still failing — reproduce with: ${rec.command}\n${r.output.slice(-400).trim()}`,
        file: rec.file,
        command: rec.command,
        confidence: 'fact',
        criterion: rec.criterion,
        verified: true,
        provenBy: 'probe',
      });
    } else {
      clearedIds.push(rec.id);
    }
  }
  return { stillFailing, clearedIds };
}
