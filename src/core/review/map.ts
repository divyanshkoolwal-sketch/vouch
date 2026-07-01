// MAP stage: an independent, grounded, rubric-decomposed review of ONE chunk
// against the captured intent. Every finding must carry a verbatim `evidence`
// quote + line range so the deterministic gate can verify it. The rubric
// explicitly states correctness supersedes cleanliness (neutralizing the
// documented "clean-but-wrong beats messy-but-right" judge bias) and requires
// the critique before the verdict.
import { Finding, IntentRecord, VouchConfig } from '../types';
import { makeFinding } from '../findings';
import { runReviewer, extractJSON } from './backends';

export interface ReviewChunk {
  /** Human label, e.g. the file path or "file (part 2/3)". */
  label: string;
  /** The diff hunks for this chunk, with absolute line numbers + function context. */
  body: string;
}

const SYSTEM_PROMPT = [
  'You are an INDEPENDENT verification reviewer. You did NOT write this code and have no stake in it.',
  'Decide ONLY whether the change satisfies the stated INTENT and acceptance criteria, and surface concrete, grounded gaps.',
  '',
  'Hard rules (these keep you from crying wolf — violating them makes the tool useless):',
  '- CORRECTNESS SUPERSEDES cleanliness, minimality, and style. Never flag a correct change for being ugly, verbose, or unconventional.',
  '- Judge ONLY the shown change against the intent. Do NOT report pre-existing issues, style nits, missing tests, or speculative refactors.',
  '- Do NOT report anything that the project\'s own tests/types/build/lint already cover — that is handled separately.',
  '- If a requirement might be satisfied by code NOT shown, use your Read/Grep/Glob tools to check BEFORE reporting. If you still cannot prove a problem, ABSTAIN.',
  '- For EVERY finding you MUST copy a VERBATIM `evidence` snippet EXACTLY from the code shown (or a file you Read), with its file and line range. If you cannot quote exact offending code, DO NOT report it.',
  '- Prefer "question" severity. Use "blocking" only when you can name the exact unmet acceptance criterion AND quote the exact missing/contradicting code.',
  '',
  'Think first (a short `critique`), THEN emit findings. Output a SINGLE JSON object, no prose, no code fences:',
  '{"critique":"<1-3 sentences>","findings":[{"criterion":"<which acceptance criterion, or \\"general\\">","severity":"blocking"|"question","title":"<short>","detail":"<why, concretely>","file":"<path>","startLine":<int>,"endLine":<int>,"evidence":"<verbatim code copied exactly from what you were shown>","confidence":<0..1>}]}',
  'An empty findings array is the common, correct answer when the change matches the intent.',
].join('\n');

function buildUserPrompt(intent: IntentRecord, chunk: ReviewChunk): string {
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
    '## Non-goals (do NOT flag these as missing)',
    ng,
    '',
    `# CHANGE TO VERIFY — ${chunk.label}`,
    '(lines are shown with absolute line numbers; quote evidence exactly as shown)',
    '```diff',
    chunk.body || '(empty)',
    '```',
    '',
    'Return the JSON object now.',
  ].join('\n');
}

/** Map a chunk's raw JSON findings into Vouch findings. Exported for testing. */
export function mapChunkFindings(raw: any, cfg: VouchConfig): Finding[] {
  const arr = Array.isArray(raw?.findings) ? raw.findings : Array.isArray(raw) ? raw : [];
  const canBlock = cfg.enforcement.block && cfg.enforcement.blockOn.includes('intent');
  const out: Finding[] = [];
  for (const r of arr) {
    if (!r || typeof r.title !== 'string') continue;
    const severity = r.severity === 'blocking' ? 'blocking' : 'question';
    const kind = severity === 'blocking' && canBlock ? 'blocking' : 'question';
    const score = typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0.6;
    out.push(
      makeFinding({
        kind,
        tier: 'intent',
        title: String(r.title).slice(0, 200),
        detail: [r.criterion ? `Criterion: ${r.criterion}` : '', r.detail ?? ''].filter(Boolean).join('\n'),
        file: typeof r.file === 'string' ? r.file : undefined,
        line: typeof r.startLine === 'number' ? r.startLine : undefined,
        confidence: severity === 'blocking' ? 'high' : 'medium',
        // Fingerprint on tier+title+file only (NOT criterion): one issue reported
        // under two criteria must collapse to a single finding.
        fpExtra: [],
      }),
    );
    const f = out[out.length - 1];
    f.evidence = typeof r.evidence === 'string' ? r.evidence : undefined;
    f.startLine = typeof r.startLine === 'number' ? r.startLine : undefined;
    f.endLine = typeof r.endLine === 'number' ? r.endLine : undefined;
    f.criterion = typeof r.criterion === 'string' ? r.criterion : undefined;
    f.score = score;
  }
  return out;
}

export async function reviewChunk(opts: {
  proj: string;
  intent: IntentRecord;
  chunk: ReviewChunk;
  cfg: VouchConfig;
}): Promise<Finding[]> {
  const res = await runReviewer(
    {
      cwd: opts.proj,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(opts.intent, opts.chunk),
      model: opts.cfg.reviewer.model,
      timeoutSec: opts.cfg.reviewer.timeoutSec,
      maxTurns: 8,
    },
    opts.cfg,
  );
  if (!res || res.isError) return [];
  const parsed = extractJSON(res.text);
  if (!parsed) return [];
  return mapChunkFindings(parsed, opts.cfg);
}
