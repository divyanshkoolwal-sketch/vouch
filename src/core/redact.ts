// Secret redaction for finding text. Defense-in-depth against a prompt-injected
// reviewer (or a tier command's output) surfacing secrets into the findings log
// or the fix-prompt that the host agent then sees. Applied to every finding's
// user-visible strings before they are written to disk or shown.
import { Finding } from './types';

const PATTERNS: RegExp[] = [
  /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bASIA[0-9A-Z]{16}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g, // OpenAI/Anthropic-style
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\bghp_[A-Za-z0-9]{30,}\b/g, // GitHub PAT
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\bAIza[0-9A-Za-z_-]{30,}\b/g, // Google API key
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /\b[A-Fa-f0-9]{64,}\b/g, // long hex secrets/hashes
];

export function redactSecrets(s: string | undefined): string | undefined {
  if (!s) return s;
  let out = s;
  for (const re of PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}

export function redactFinding(f: Finding): Finding {
  return {
    ...f,
    title: redactSecrets(f.title) ?? f.title,
    detail: redactSecrets(f.detail),
    evidence: redactSecrets(f.evidence),
  };
}
