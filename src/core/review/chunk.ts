// Turn per-file diffs into review chunks that fit a token budget, with absolute
// (new-side) line numbers so findings anchor to real lines. Big changes are
// packed/split across chunks (map-reduce) instead of truncated; anything we
// cannot fully review is recorded so coverage stays honest.
import { FileDiff } from '../diff';
import { VouchConfig } from '../types';
import { ReviewChunk } from './map';

export interface BuildChunksResult {
  chunks: ReviewChunk[];
  includedFiles: string[];
  skippedFiles: string[]; // beyond maxReviewFiles — not reviewed at all
  clippedFiles: string[]; // reviewed but a hunk was too large and got clipped
}

const estTokens = (s: string) => Math.ceil(s.length / 4);

/** Prefix each diff line with its absolute new-side line number so the model can
 *  cite exact startLine/endLine. Context/added lines get numbers; removed lines
 *  are marked `-`. Untracked synthetic bodies (already numbered) pass through. */
export function numberPatch(patch: string): string {
  if (patch.startsWith('=== new file:')) return patch;
  const out: string[] = [];
  let newLine = 0;
  for (const line of patch.split('\n')) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = parseInt(hunk[1], 10);
      out.push(line);
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      out.push(`${newLine}: ${line}`);
      newLine++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      out.push(`   -${line.slice(1)}`);
    } else if (line.startsWith(' ')) {
      out.push(`${newLine}: ${line}`);
      newLine++;
    } else {
      out.push(line); // headers (diff --git, index, +++/---)
    }
  }
  return out.join('\n');
}

/** Rank: biggest additions first (most likely to carry new behavior). */
function rankFiles(files: FileDiff[]): FileDiff[] {
  return [...files].sort((a, b) => b.addedLines - a.addedLines);
}

function splitHunks(patch: string): string[] {
  // Keep the file header with the first hunk; split subsequent hunks apart.
  const idx = patch.search(/^@@/m);
  if (idx < 0) return [patch];
  const header = patch.slice(0, idx);
  const rest = patch.slice(idx);
  const hunks = rest.split(/(?=^@@ )/m).filter(Boolean);
  return hunks.map((h, i) => (i === 0 ? header + h : h));
}

export function buildChunks(perFile: FileDiff[], cfg: VouchConfig): BuildChunksResult {
  const budgetChars = cfg.review.chunkTokenBudget * 4;
  const ranked = rankFiles(perFile);
  const included = ranked.slice(0, cfg.review.maxReviewFiles);
  const skippedFiles = ranked.slice(cfg.review.maxReviewFiles).map((f) => f.file);
  const clippedFiles: string[] = [];
  const chunks: ReviewChunk[] = [];

  for (const f of included) {
    const numbered = numberPatch(f.patch);
    if (numbered.length <= budgetChars) {
      chunks.push({ label: f.file, body: numbered });
      continue;
    }
    // Too big: split by hunks and pack.
    const hunks = splitHunks(f.patch).map(numberPatch);
    let buf = '';
    let part = 1;
    const flush = () => {
      if (buf) {
        chunks.push({ label: `${f.file} (part ${part})`, body: buf });
        part++;
        buf = '';
      }
    };
    for (let h of hunks) {
      if (h.length > budgetChars) {
        // A single hunk exceeds the budget — clip it (honestly recorded).
        h = h.slice(0, budgetChars) + '\n… [hunk clipped: too large to review in full] …';
        clippedFiles.push(f.file);
      }
      if (buf.length + h.length > budgetChars) flush();
      buf += (buf ? '\n' : '') + h;
    }
    flush();
  }

  return {
    chunks,
    includedFiles: included.map((f) => f.file),
    skippedFiles,
    clippedFiles: [...new Set(clippedFiles)],
  };
}
