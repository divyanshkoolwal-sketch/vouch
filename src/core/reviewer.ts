// Tier 2: an INDEPENDENT intent-vs-diff review. We spawn a fresh, headless
// `claude -p` reviewer (a separate process with no stake in the original work —
// the whole point) and ask it, conservatively, whether the diff actually
// satisfies the captured intent. It returns strict JSON; we map that to
// findings. Anything that goes wrong (no `claude`, timeout, unparseable output)
// degrades to "no findings" — we never fabricate an issue.
import { spawn, execFileSync } from 'child_process';
import { Finding, IntentRecord, VouchConfig } from './types';
import { makeFinding } from './findings';

export function reviewerAvailable(): boolean {
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const SYSTEM_PROMPT = [
  'You are an independent verification reviewer for a code change. You did NOT write this code.',
  'Your only job: decide whether the diff plausibly satisfies the stated INTENT and acceptance criteria, and surface concrete gaps.',
  '',
  'Rules — these exist to keep you from crying wolf:',
  '- Default to raising NOTHING. Only report a finding when the diff gives you clear evidence.',
  '- Strongly PREFER "question" over "blocking". Use "blocking" only when you can name the exact acceptance criterion that is unmet AND point to the exact missing or contradicting code.',
  '- Judge ONLY the change in the diff against the intent. Do NOT report pre-existing issues, style/formatting nits, test coverage wishes, or speculative refactors.',
  '- Do NOT report things that the project\'s own tests/types/build would already catch — that is handled separately.',
  '- If the diff looks consistent with the intent, return an empty findings array. That is the expected, common answer.',
  '',
  'Output: a SINGLE JSON object and nothing else (no prose, no code fences):',
  '{"findings":[{"severity":"blocking"|"question","criterion":"<the acceptance criterion this relates to, or \\"general\\">","title":"<short>","detail":"<why, with concrete reference to the diff>","file":"<path or omitted>"}]}',
].join('\n');

function buildUserPrompt(intent: IntentRecord, patch: string, truncated: boolean): string {
  const ac = intent.acceptance_criteria.length
    ? intent.acceptance_criteria.map((c, i) => `  ${i + 1}. ${c}`).join('\n')
    : '  (none specified)';
  const ng = intent.non_goals?.length ? intent.non_goals.map((c) => `  - ${c}`).join('\n') : '  (none)';
  return [
    '# INTENT',
    intent.summary,
    '',
    '## Acceptance criteria',
    ac,
    '',
    '## Non-goals (do not flag these as missing)',
    ng,
    '',
    '# DIFF (the change to verify)',
    truncated ? '(note: diff was truncated; judge only what is shown)' : '',
    '```diff',
    patch || '(empty diff)',
    '```',
    '',
    'Return the JSON object now. Remember: empty findings is the common, correct answer when the change matches the intent.',
  ].join('\n');
}

function extractResult(stdout: string): { text: string; isError: boolean } | null {
  try {
    const env = JSON.parse(stdout);
    if (typeof env?.result === 'string') return { text: env.result, isError: !!env.is_error };
    return null;
  } catch {
    return null;
  }
}

export function parseFindingsJSON(text: string): any[] {
  // Strip code fences if the model added them despite instructions.
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  // Grab the outermost {...} if there's surrounding prose.
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  try {
    const obj = JSON.parse(t);
    if (Array.isArray(obj?.findings)) return obj.findings;
    if (Array.isArray(obj)) return obj;
    return [];
  } catch {
    return [];
  }
}

/** Map the reviewer's raw JSON findings into Vouch findings, applying the
 *  blockOn gate: an intent finding only becomes `blocking` if the user opted
 *  the `intent` tier into blockOn — otherwise it is a non-blocking `question`.
 *  Pure + exported so it is unit-testable without spawning the reviewer. */
export function mapReviewFindings(raw: any[], cfg: VouchConfig): Finding[] {
  const canBlock = cfg.enforcement.block && cfg.enforcement.blockOn.includes('intent');
  const findings: Finding[] = [];
  for (const r of raw) {
    if (!r || typeof r.title !== 'string') continue;
    const severity = r.severity === 'blocking' ? 'blocking' : 'question';
    const kind = severity === 'blocking' && canBlock ? 'blocking' : 'question';
    findings.push(
      makeFinding({
        kind,
        tier: 'intent',
        title: r.title.slice(0, 200),
        detail: [r.criterion ? `Criterion: ${r.criterion}` : '', r.detail ?? ''].filter(Boolean).join('\n'),
        file: typeof r.file === 'string' ? r.file : undefined,
        confidence: severity === 'blocking' ? 'high' : 'medium',
        fpExtra: [String(r.criterion ?? ''), String(r.file ?? '')],
      }),
    );
  }
  return findings;
}

export function reviewIntent(opts: {
  proj: string;
  intent: IntentRecord;
  patch: string;
  truncated: boolean;
  cfg: VouchConfig;
}): Promise<Finding[]> {
  const { proj, intent, patch, truncated, cfg } = opts;
  const userPrompt = buildUserPrompt(intent, patch, truncated);

  const args = [
    '-p',
    userPrompt,
    '--output-format',
    'json',
    '--allowedTools',
    'Read',
    'Grep',
    'Glob',
    '--append-system-prompt',
    SYSTEM_PROMPT,
    '--max-turns',
    '6',
  ];
  if (cfg.reviewer.model) args.push('--model', cfg.reviewer.model);

  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const done = (findings: Finding[]) => {
      if (settled) return;
      settled = true;
      resolve(findings);
    };

    let child;
    try {
      child = spawn('claude', args, {
        cwd: proj,
        // VOUCH_DISABLE=1 makes our OWN hooks no-op inside this child → no
        // recursion. We intentionally do NOT pass --bare, because --bare reads
        // auth only from ANTHROPIC_API_KEY and would break OAuth/subscription
        // users; a normal `claude -p` inherits the user's existing auth.
        env: { ...process.env, VOUCH_DISABLE: '1' },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      done([]);
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }, 2000);
      } catch {
        /* ignore */
      }
      done([]);
    }, cfg.reviewer.timeoutSec * 1000);

    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.on('error', () => {
      clearTimeout(timer);
      done([]);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const res = extractResult(stdout);
      if (!res || res.isError) return done([]);
      done(mapReviewFindings(parseFindingsJSON(res.text), cfg));
    });
  });
}
