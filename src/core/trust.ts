// Trust boundary. Vouch runs commands and injects context from a repo's
// `.vouch/` — but a cloned repo is UNTRUSTED until the user explicitly approves
// it (like VS Code Workspace Trust / Codex hook trust). Without this gate, a
// malicious `.vouch/config.json` is zero-click RCE the moment the agent stops.
//
// Trust is recorded per-repo, OUTSIDE the repo (~/.vouch/trust.json), keyed to a
// hash of the security-relevant config (the parts that cause execution or
// egress). If any of those change, trust is invalidated and must be re-granted.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { VouchConfig } from './types';

interface TrustRecord {
  hash: string;
  grantedAt: string;
}
type TrustStore = Record<string, TrustRecord>;

function storePath(): string {
  return path.join(os.homedir(), '.vouch', 'trust.json');
}

function readStore(): TrustStore {
  try {
    return JSON.parse(fs.readFileSync(storePath(), 'utf8')) as TrustStore;
  } catch {
    return {};
  }
}

function writeStore(store: TrustStore): void {
  const dir = path.dirname(storePath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
}

function keyFor(proj: string): string {
  try {
    return fs.realpathSync(proj);
  } catch {
    return path.resolve(proj);
  }
}

/** Hash only the config fields that can cause command execution or data egress.
 *  Editing a comment or a non-executable field won't force re-trust; changing a
 *  command, backend, model, key env, or which tiers run WILL. */
export function policyHash(cfg: VouchConfig): string {
  const policy = {
    commands: Object.fromEntries(
      Object.entries(cfg.commands).map(([k, v]) => [k, v ? { cmd: v.cmd, enabled: v.enabled } : null]),
    ),
    tiers: cfg.tiers,
    enforcement: { block: cfg.enforcement.block, blockOn: cfg.enforcement.blockOn },
    reviewer: {
      backend: cfg.reviewer.backend ?? 'auto',
      verifierBackend: cfg.reviewer.verifierBackend ?? 'auto',
      model: cfg.reviewer.model ?? null,
      apiKeyEnv: cfg.reviewer.apiKeyEnv ?? null,
    },
    probe: cfg.probe,
    web: cfg.web,
  };
  return createHash('sha256').update(JSON.stringify(policy)).digest('hex').slice(0, 32);
}

export function isTrusted(proj: string, cfg: VouchConfig): boolean {
  const rec = readStore()[keyFor(proj)];
  return !!rec && rec.hash === policyHash(cfg);
}

export function grantTrust(proj: string, cfg: VouchConfig, nowISO: string): void {
  const store = readStore();
  store[keyFor(proj)] = { hash: policyHash(cfg), grantedAt: nowISO };
  writeStore(store);
}

export function revokeTrust(proj: string): void {
  const store = readStore();
  delete store[keyFor(proj)];
  writeStore(store);
}

/** Human-readable summary of exactly what trusting this repo authorizes to run. */
export function trustSummary(cfg: VouchConfig): string[] {
  const lines: string[] = [];
  for (const [tier, rc] of Object.entries(cfg.commands)) {
    if (rc && rc.enabled && cfg.tiers[tier as keyof typeof cfg.tiers]) lines.push(`run (${tier}): ${rc.cmd}`);
  }
  if (cfg.tiers.intent) {
    lines.push(`review the diff with an LLM backend: ${cfg.reviewer.backend ?? 'auto'}`);
    if (cfg.probe.enabled) lines.push('generate + execute sandboxed probe scripts');
  }
  if (cfg.reviewer.apiKeyEnv) lines.push(`send the diff to an API using $${cfg.reviewer.apiKeyEnv}`);
  return lines;
}
