// Dismissal memory: once the user (or agent, on the user's behalf) marks a
// finding as a non-issue, we never raise it again. This is the primary
// learning loop that keeps a noisy tool from becoming a dead tool.
import { Finding } from './types';
import { dismissalsPath, readJSON, writeJSON, ensureVouchDir } from './memory';

export interface Dismissal {
  fingerprint: string;
  reason: string;
  ts: string;
}

export function loadDismissals(proj: string): Dismissal[] {
  return readJSON<Dismissal[]>(dismissalsPath(proj), []);
}

export function isDismissed(proj: string, fingerprint: string): boolean {
  return loadDismissals(proj).some((d) => d.fingerprint === fingerprint);
}

export function addDismissal(proj: string, fingerprint: string, reason: string, nowISO: string): Dismissal[] {
  ensureVouchDir(proj);
  const list = loadDismissals(proj);
  if (!list.some((d) => d.fingerprint === fingerprint)) {
    list.push({ fingerprint, reason: reason || '(no reason given)', ts: nowISO });
    writeJSON(dismissalsPath(proj), list);
  }
  return list;
}

export function filterDismissed(findings: Finding[], dismissals: Dismissal[]): Finding[] {
  const set = new Set(dismissals.map((d) => d.fingerprint));
  return findings.filter((f) => !set.has(f.id));
}
