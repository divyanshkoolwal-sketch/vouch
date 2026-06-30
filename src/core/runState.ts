// Transient per-run state under .vouch/runs/ (gitignored): the dirty flag set by
// the PostToolUse hook, the diff hash of the last verified state, and the
// block→fix→re-verify iteration counter that caps the loop.
import * as fs from 'fs';
import { statePath, dirtyPath, readJSON, writeJSON, runsDir } from './memory';

export interface RunState {
  /** Hash of the diff we last verified clean (or last blocked on). */
  lastDiffHash: string | null;
  /** Consecutive block rounds in the current verify cycle. */
  iteration: number;
}

export function loadState(proj: string): RunState {
  return readJSON<RunState>(statePath(proj), { lastDiffHash: null, iteration: 0 });
}

export function saveState(proj: string, state: RunState): void {
  fs.mkdirSync(runsDir(proj), { recursive: true });
  writeJSON(statePath(proj), state);
}

/** Dirty == the PostToolUse hook recorded at least one edit since last verify. */
export function isDirty(proj: string): boolean {
  try {
    return fs.existsSync(dirtyPath(proj)) && fs.statSync(dirtyPath(proj)).size > 0;
  } catch {
    return false;
  }
}

export function clearDirty(proj: string): void {
  try {
    if (fs.existsSync(dirtyPath(proj))) fs.rmSync(dirtyPath(proj));
  } catch {
    /* ignore */
  }
}

export function markDirty(proj: string): void {
  fs.mkdirSync(runsDir(proj), { recursive: true });
  fs.appendFileSync(dirtyPath(proj), `${Date.now()}\n`);
}
