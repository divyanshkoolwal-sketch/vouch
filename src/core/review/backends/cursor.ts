// Cursor backend: `cursor-agent -p --output-format json`. Omitting --force
// keeps it read-only (edits are only proposed, never applied). Its JSON envelope
// is nearly identical to Claude's ({ result, is_error }). --trust avoids an
// interactive trust prompt in headless use.
import { Backend, ReviewerRequest, ReviewerResult } from './types';
import { runCLI, cliOnPath } from './spawn';

export const cursorBackend: Backend = {
  name: 'cursor',
  available: () => cliOnPath('cursor-agent'),
  async run(req: ReviewerRequest): Promise<ReviewerResult> {
    const prompt = `${req.systemPrompt}\n\n${req.userPrompt}`;
    const args = ['-p', prompt, '--output-format', 'json', '--trust'];
    const res = await runCLI('cursor-agent', args, req.cwd, req.timeoutSec);
    if (!res) return null;
    try {
      const env = JSON.parse(res.stdout);
      if (typeof env?.result === 'string') return { text: env.result, isError: !!env.is_error };
    } catch {
      /* fall through */
    }
    return null;
  },
};
