// OpenAI Codex backend: `codex exec` in a read-only sandbox. Codex has no
// system-prompt flag, so we merge system+user into one prompt. Its final
// assistant message goes to stdout (progress to stderr, which we drop); we hand
// the raw stdout to extractJSON downstream, so extra chatter is harmless.
import { Backend, ReviewerRequest, ReviewerResult } from './types';
import { runCLI, cliOnPath } from './spawn';

export const codexBackend: Backend = {
  name: 'codex',
  available: () => cliOnPath('codex'),
  async run(req: ReviewerRequest): Promise<ReviewerResult> {
    const prompt = `${req.systemPrompt}\n\n${req.userPrompt}`;
    const args = ['exec', '--sandbox', 'read-only', '--ask-for-approval', 'never', '--skip-git-repo-check', prompt];
    const res = await runCLI('codex', args, req.cwd, req.timeoutSec);
    if (!res) return null;
    // stdout is the final assistant message; downstream extractJSON pulls the
    // JSON out even if the build prints extra framing.
    return { text: res.stdout, isError: res.code !== 0 };
  },
};
