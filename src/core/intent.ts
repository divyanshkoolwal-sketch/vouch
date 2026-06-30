// Captured intent: a lightweight, plain-language record of what the user
// actually wants — summary + a few acceptance criteria — NOT a heavy spec doc.
// One active intent at a time; superseded intents are archived (not deleted) so
// the history stays in the repo.
import * as fs from 'fs';
import * as path from 'path';
import { IntentRecord } from './types';
import { activeIntentPath, intentDir, readJSON, writeJSON, ensureVouchDir, exists } from './memory';

export function loadActiveIntent(proj: string): IntentRecord | null {
  if (!exists(activeIntentPath(proj))) return null;
  const r = readJSON<IntentRecord | null>(activeIntentPath(proj), null);
  if (!r || r.status !== 'active') return null;
  return r;
}

function newId(nowISO: string): string {
  // Compact, sortable-ish id derived from the timestamp + a short random tail.
  const t = Date.parse(nowISO) || Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return `i_${t.toString(36)}_${rand}`;
}

export function recordIntent(
  proj: string,
  input: {
    summary: string;
    acceptance_criteria: string[];
    scope_globs?: string[];
    non_goals?: string[];
  },
  nowISO: string,
): IntentRecord {
  ensureVouchDir(proj);
  // Archive any existing active intent.
  const prev = loadActiveIntent(proj);
  if (prev) {
    prev.status = 'archived';
    writeJSON(path.join(intentDir(proj), `${prev.id}.json`), prev);
  }
  const record: IntentRecord = {
    id: newId(nowISO),
    summary: input.summary.trim(),
    acceptance_criteria: (input.acceptance_criteria ?? []).map((s) => s.trim()).filter(Boolean),
    scope_globs: input.scope_globs?.map((s) => s.trim()).filter(Boolean),
    non_goals: input.non_goals?.map((s) => s.trim()).filter(Boolean),
    created: nowISO,
    status: 'active',
  };
  writeJSON(activeIntentPath(proj), record);
  return record;
}

export function clearActiveIntent(proj: string): void {
  const cur = loadActiveIntent(proj);
  if (!cur) return;
  cur.status = 'archived';
  writeJSON(path.join(intentDir(proj), `${cur.id}.json`), cur);
  try {
    fs.rmSync(activeIntentPath(proj));
  } catch {
    /* ignore */
  }
}
