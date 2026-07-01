// Reviewer backend abstraction. The whole review pipeline (map + verify) makes
// its LLM calls through one function; a "backend" is one way to run a headless,
// read-only, one-shot LLM review call. Backends: the host agent's own CLI
// (claude / codex / cursor-agent) or a direct API call. All degrade to `null`
// on any failure — a failed reviewer call is never surfaced as a code finding.
import { VouchConfig } from '../../types';

export type BackendName = 'claude' | 'codex' | 'cursor' | 'api';

export interface ReviewerRequest {
  cwd: string;
  systemPrompt: string;
  userPrompt: string;
  /** Read-only tool whitelist (claude only; other backends enforce read-only their own way). */
  allowedTools?: string[];
  model?: string;
  timeoutSec: number;
  maxTurns?: number;
}

export type ReviewerResult = { text: string; isError: boolean } | null;

export interface Backend {
  name: BackendName;
  /** Cheap check that this backend could run (CLI on PATH, or API key present). */
  available(cfg: VouchConfig): boolean;
  run(req: ReviewerRequest, cfg: VouchConfig): Promise<ReviewerResult>;
}
