// Backend dispatcher with ROLES. The `map` role runs the grounded review; the
// `verify` role casts the independent CoVe votes (and generates probes). By
// default `verify` auto-picks a backend DIFFERENT from the map backend —
// cross-model verification breaks same-model self-leniency (a Claude judge on a
// Claude diff runs measurably lenient) and vote correlation. Falls back to the
// map backend when it's the only one available (honest degrade).
import { VouchConfig } from '../../types';
import { Backend, BackendName, ReviewerRequest, ReviewerResult } from './types';
import { claudeBackend } from './claude';
import { codexBackend } from './codex';
import { cursorBackend } from './cursor';
import { apiBackend } from './api';

export { extractJSON } from './json';
export type { ReviewerRequest, ReviewerResult, BackendName } from './types';

export type BackendRole = 'map' | 'verify';

const BACKENDS: Record<BackendName, Backend> = {
  claude: claudeBackend,
  codex: codexBackend,
  cursor: cursorBackend,
  api: apiBackend,
};

const AUTO_ORDER: BackendName[] = ['claude', 'codex', 'cursor'];

const resolveCache = new Map<string, Backend | null>();

function cacheKey(cfg: VouchConfig, role: BackendRole): string {
  return `${role}|${cfg.reviewer.backend ?? 'auto'}|${cfg.reviewer.verifierBackend ?? 'auto'}|${process.env.VOUCH_HOST ?? ''}|${cfg.reviewer.apiKeyEnv ?? ''}`;
}

function resolveMap(cfg: VouchConfig, backends: Record<BackendName, Backend>): Backend | null {
  const explicit = cfg.reviewer.backend;
  if (explicit && explicit !== 'auto') {
    const b = backends[explicit];
    return b && b.available(cfg) ? b : null;
  }
  const order: BackendName[] = [];
  const host = process.env.VOUCH_HOST as BackendName | undefined;
  if (host && backends[host]) order.push(host);
  for (const n of AUTO_ORDER) if (!order.includes(n)) order.push(n);
  for (const n of order) if (backends[n].available(cfg)) return backends[n];
  if (backends.api.available(cfg)) return backends.api;
  return null;
}

function resolveVerify(cfg: VouchConfig, backends: Record<BackendName, Backend>): Backend | null {
  const explicit = cfg.reviewer.verifierBackend;
  if (explicit && explicit !== 'auto') {
    const b = backends[explicit];
    return b && b.available(cfg) ? b : null;
  }
  const mapB = resolveMap(cfg, backends);
  // Prefer a DIFFERENT model than the one that produced the findings.
  for (const n of AUTO_ORDER) {
    if (mapB && n === mapB.name) continue;
    if (backends[n].available(cfg)) return backends[n];
  }
  if (mapB?.name !== 'api' && backends.api.available(cfg)) return backends.api;
  return mapB; // degrade: same-model verification is still better than none
}

/** Pick the backend for a role, honoring explicit config then auto-detection.
 *  Cached per process; exported (with injectable set) for tests. */
export function resolveBackend(
  cfg: VouchConfig,
  role: BackendRole = 'map',
  backends: Record<BackendName, Backend> = BACKENDS,
): Backend | null {
  const key = cacheKey(cfg, role);
  if (resolveCache.has(key)) return resolveCache.get(key)!;
  const chosen = role === 'map' ? resolveMap(cfg, backends) : resolveVerify(cfg, backends);
  resolveCache.set(key, chosen);
  return chosen;
}

/** Clear the per-process resolution cache (tests). */
export function _resetBackendCache(): void {
  resolveCache.clear();
}

export function backendAvailable(cfg: VouchConfig, backends?: Record<BackendName, Backend>): boolean {
  return resolveBackend(cfg, 'map', backends) != null;
}

/** Which backend serves each role — for honest coverage reporting. */
export function describeBackends(cfg: VouchConfig): { map: string | null; verify: string | null } {
  return {
    map: resolveBackend(cfg, 'map')?.name ?? null,
    verify: resolveBackend(cfg, 'verify')?.name ?? null,
  };
}

export async function runReviewer(req: ReviewerRequest, cfg: VouchConfig, role: BackendRole = 'map'): Promise<ReviewerResult> {
  const backend = resolveBackend(cfg, role);
  if (!backend) return null;
  return backend.run(req, cfg);
}
