// Claude Code backend: `claude -p --output-format json`. The default backend;
// behavior is identical to Vouch's original reviewer so nothing changes for
// existing Claude Code users.
import { Backend, ReviewerRequest, ReviewerResult } from './types';
import { runCLI, cliOnPath } from './spawn';

export const claudeBackend: Backend = {
  name: 'claude',
  available: () => cliOnPath('claude'),
  async run(req: ReviewerRequest): Promise<ReviewerResult> {
    const allowed = req.allowedTools ?? ['Read', 'Grep', 'Glob'];
    const args = [
      '-p',
      req.userPrompt,
      '--output-format',
      'json',
      '--allowedTools',
      ...allowed,
      '--append-system-prompt',
      req.systemPrompt,
      '--max-turns',
      String(req.maxTurns ?? 8),
    ];
    if (req.model) args.push('--model', req.model);

    const res = await runCLI('claude', args, req.cwd, req.timeoutSec);
    if (!res || res.timedOut) return null;
    try {
      const env = JSON.parse(res.stdout);
      if (typeof env?.result === 'string') return { text: env.result, isError: !!env.is_error };
    } catch {
      /* fall through */
    }
    return null;
  },
};
