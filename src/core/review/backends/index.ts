// Backend dispatcher. Picks a reviewer backend (explicit config, else auto:
// prefer the host agent's own CLI via VOUCH_HOST, then claude→codex→cursor, then
// an opt-in API key) and runs the request through it. The chosen backend is
// cached per (setting, host) so we detect once per process, not per call.
import { VouchConfig } from '../../types';
import { Backend, BackendName, ReviewerRequest, ReviewerResult } from './types';
import { claudeBackend } from './claude';
import { codexBackend } from './codex';
import { cursorBackend } from './cursor';
import { apiBackend } from './api';

export { extractJSON } from './json';
export type { ReviewerRequest, ReviewerResult, BackendName } from './types';

const BACKENDS: Record<BackendName, Backend> = {
  claude: claudeBackend,
  codex: codexBackend,
  cursor: cursorBackend,
  api: apiBackend,
};

const AUTO_ORDER: BackendName[] = ['claude', 'codex', 'cursor'];

// Allow tests to override; also lets us swap the whole set out.
export const backendsForTest = BACKENDS;

const resolveCache = new Map<string, Backend | null>();

function cacheKey(cfg: VouchConfig): string {
  return `${cfg.reviewer.backend ?? 'auto'}|${process.env.VOUCH_HOST ?? ''}|${cfg.reviewer.apiKeyEnv ?? ''}`;
}

/** Pick the backend to use, honoring explicit config then auto-detection.
 *  Exported (with cfg) for testing; result is cached per process. */
export function resolveBackend(cfg: VouchConfig, backends: Record<BackendName, Backend> = BACKENDS): Backend | null {
  const key = cacheKey(cfg);
  if (resolveCache.has(key)) return resolveCache.get(key)!;

  let chosen: Backend | null = null;
  const explicit = cfg.reviewer.backend;
  if (explicit && explicit !== 'auto') {
    const b = backends[explicit];
    chosen = b && b.available(cfg) ? b : null;
  } else {
    const order: BackendName[] = [];
    const host = process.env.VOUCH_HOST as BackendName | undefined;
    if (host && backends[host]) order.push(host);
    for (const n of AUTO_ORDER) if (!order.includes(n)) order.push(n);
    for (const n of order) {
      if (backends[n].available(cfg)) {
        chosen = backends[n];
        break;
      }
    }
    if (!chosen && backends.api.available(cfg)) chosen = backends.api;
  }
  resolveCache.set(key, chosen);
  return chosen;
}

/** Clear the per-process resolution cache (tests). */
export function _resetBackendCache(): void {
  resolveCache.clear();
}

export function backendAvailable(cfg: VouchConfig, backends?: Record<BackendName, Backend>): boolean {
  return resolveBackend(cfg, backends) != null;
}

export async function runReviewer(req: ReviewerRequest, cfg: VouchConfig): Promise<ReviewerResult> {
  const backend = resolveBackend(cfg);
  if (!backend) return null;
  return backend.run(req, cfg);
}
