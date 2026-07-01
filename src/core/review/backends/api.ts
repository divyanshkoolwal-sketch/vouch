// Direct-API backend (last resort, opt-in only). Used solely when the user
// explicitly sets `reviewer.apiKeyEnv` to an env var holding a key — Vouch never
// auto-bills. No repo tools here: the diff is already inline in the prompt.
// Uses global fetch (Node 18+), so it adds no dependency.
import { Backend, ReviewerRequest, ReviewerResult } from './types';
import { VouchConfig } from '../../types';

function provider(apiKeyEnv: string): 'openai' | 'anthropic' {
  return /openai/i.test(apiKeyEnv) ? 'openai' : 'anthropic';
}

export const apiBackend: Backend = {
  name: 'api',
  available(cfg: VouchConfig): boolean {
    const env = cfg.reviewer.apiKeyEnv;
    return !!(env && process.env[env]);
  },
  async run(req: ReviewerRequest, cfg: VouchConfig): Promise<ReviewerResult> {
    const envName = cfg.reviewer.apiKeyEnv;
    if (!envName) return null;
    const key = process.env[envName];
    if (!key) return null;
    const kind = provider(envName);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutSec * 1000);
    try {
      if (kind === 'anthropic') {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: req.model || 'claude-haiku-4-5',
            max_tokens: 2048,
            system: req.systemPrompt,
            messages: [{ role: 'user', content: req.userPrompt }],
          }),
          signal: controller.signal,
        });
        if (!r.ok) return null;
        const j: any = await r.json();
        const text = j?.content?.map((c: any) => c.text).filter(Boolean).join('\n') ?? '';
        return { text, isError: false };
      }
      // openai
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: req.model || 'gpt-5',
          messages: [
            { role: 'system', content: req.systemPrompt },
            { role: 'user', content: req.userPrompt },
          ],
        }),
        signal: controller.signal,
      });
      if (!r.ok) return null;
      const j: any = await r.json();
      const text = j?.choices?.[0]?.message?.content ?? '';
      return { text, isError: false };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  },
};
