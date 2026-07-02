// Claude Code backend: `claude -p --output-format json`. The default backend;
// behavior is identical to Vouch's original reviewer so nothing changes for
// existing Claude Code users.
import { Backend, ReviewerRequest, ReviewerResult } from './types';
import { runCLI, cliOnPath } from './spawn';

export const claudeBackend: Backend = {
  name: 'claude',
  available: () => cliOnPath('claude'),
  async run(req: ReviewerRequest): Promise<ReviewerResult> {
    // INLINE-ONLY: the reviewer gets no filesystem/exec/network tools, so an
    // injected instruction in the (attacker-controlled) diff cannot make it read
    // ~/.ssh, .env, credentials, etc. It judges only the context we hand it.
    const args = [
      '-p',
      req.userPrompt,
      '--output-format',
      'json',
      '--disallowedTools',
      'Read',
      'Grep',
      'Glob',
      'Bash',
      'Edit',
      'Write',
      'NotebookEdit',
      'WebFetch',
      'WebSearch',
      'Task',
      '--append-system-prompt',
      req.systemPrompt,
      '--max-turns',
      String(req.maxTurns ?? 2),
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
