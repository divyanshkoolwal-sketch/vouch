// Collapse all findings into ONE prioritized, actionable message for the agent:
// verified failures first (with repro + evidence), then uncertain questions.
import { Finding, CoverageReport } from './types';

/** One-line honest coverage summary — never conflate "clean" with "skipped". */
export function coverageLine(cov?: CoverageReport): string {
  if (!cov) return '';
  const bits: string[] = [];
  if (cov.filesChanged) bits.push(`${cov.filesReviewed}/${cov.filesChanged} changed files reviewed`);
  if (cov.filesSkippedTooLarge.length) bits.push(`${cov.filesSkippedTooLarge.length} too large to fully review`);
  if (cov.packagesScoped.length) bits.push(`packages: ${cov.packagesScoped.join(', ')}`);
  if (cov.testsSelected != null) bits.push(`${cov.testsSelected} changed file(s) targeted for tests`);
  if (cov.budgetHit) bits.push('time budget reached — coverage partial');
  return bits.length ? `coverage: ${bits.join('; ')}` : '';
}

function clip(s: string | undefined, n: number): string {
  if (!s) return '';
  const t = s.trim();
  return t.length > n ? t.slice(-n) : t;
}

export function buildFixPrompt(
  blocking: Finding[],
  questions: Finding[],
  roundInfo?: string,
  notices: Finding[] = [],
): string {
  const parts: string[] = [];
  parts.push(
    'Vouch (automatic verification) checked your change and it is not done yet.' +
      (roundInfo ? ` ${roundInfo}` : ''),
  );

  if (blocking.length) {
    parts.push('\n## Must fix — verified failures');
    blocking.forEach((f, i) => {
      const lines = [`${i + 1}. ${f.title}` + (f.command ? ` — \`${f.command}\`` : '')];
      if (f.file) lines.push(`   file: ${f.file}${f.line ? `:${f.line}` : ''}`);
      const evidence = clip(f.detail, 1400);
      if (evidence) lines.push('   ```\n' + evidence.split('\n').map((l) => '   ' + l).join('\n') + '\n   ```');
      lines.push(`   (vouch id: ${f.id})`);
      parts.push(lines.join('\n'));
    });
  }

  if (notices.length) {
    parts.push('\n## Also failing — not blocking, but worth fixing');
    notices.forEach((f) => {
      parts.push(`- ${f.title}${f.command ? ` — \`${f.command}\`` : ''} (vouch id: ${f.id})`);
    });
  }

  if (questions.length) {
    parts.push('\n## Questions — uncertain, please confirm (do NOT assume these are bugs)');
    questions.forEach((f) => {
      const d = clip(f.detail, 500);
      parts.push(`- [${f.tier}] ${f.title}${d ? `\n  ${d.replace(/\n/g, '\n  ')}` : ''}\n  (vouch id: ${f.id})`);
    });
  }

  parts.push(
    '\nFix the "Must fix" items, then finish. ' +
      'For any item that is actually a non-issue, call the `dismiss_finding` tool (from the `vouch` MCP server) with its vouch id and a one-line reason — Vouch will then never raise it again.',
  );
  return parts.join('\n');
}

export function summaryLine(blocking: Finding[], questions: Finding[], notices: Finding[] = []): string {
  if (!blocking.length && !questions.length && !notices.length) return 'Vouch: ✓ verification passed';
  const bits: string[] = [];
  if (blocking.length) bits.push(`${blocking.length} blocking`);
  if (notices.length) bits.push(`${notices.length} non-blocking failure${notices.length === 1 ? '' : 's'}`);
  if (questions.length) bits.push(`${questions.length} question${questions.length === 1 ? '' : 's'}`);
  return `Vouch: ${bits.join(', ')}`;
}
