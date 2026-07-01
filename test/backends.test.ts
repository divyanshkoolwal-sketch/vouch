import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveBackend, _resetBackendCache, extractJSON } from '../src/core/review/backends';
import { Backend, BackendName } from '../src/core/review/backends/types';
import { defaultConfig } from '../src/core/config';
import { VouchConfig } from '../src/core/types';

function fakeSet(avail: Partial<Record<BackendName, boolean>>): Record<BackendName, Backend> {
  const mk = (name: BackendName): Backend => ({
    name,
    available: (cfg: VouchConfig) => (name === 'api' ? !!(cfg.reviewer.apiKeyEnv && avail.api) : !!avail[name]),
    run: async () => ({ text: `ran:${name}`, isError: false }),
  });
  return { claude: mk('claude'), codex: mk('codex'), cursor: mk('cursor'), api: mk('api') };
}

describe('backend resolution', () => {
  const origHost = process.env.VOUCH_HOST;
  beforeEach(() => {
    _resetBackendCache();
    delete process.env.VOUCH_HOST;
  });
  afterEach(() => {
    if (origHost === undefined) delete process.env.VOUCH_HOST;
    else process.env.VOUCH_HOST = origHost;
    _resetBackendCache();
  });

  it('auto prefers claude when all CLIs are present', () => {
    const cfg = defaultConfig();
    expect(resolveBackend(cfg, fakeSet({ claude: true, codex: true, cursor: true }))?.name).toBe('claude');
  });

  it('auto falls back claude→codex→cursor', () => {
    const cfg = defaultConfig();
    expect(resolveBackend(cfg, fakeSet({ codex: true, cursor: true }))?.name).toBe('codex');
    _resetBackendCache();
    expect(resolveBackend(cfg, fakeSet({ cursor: true }))?.name).toBe('cursor');
  });

  it('auto prefers the host agent (VOUCH_HOST) even if claude is also present', () => {
    process.env.VOUCH_HOST = 'codex';
    const cfg = defaultConfig();
    expect(resolveBackend(cfg, fakeSet({ claude: true, codex: true }))?.name).toBe('codex');
  });

  it('explicit backend is honored, or null if unavailable', () => {
    const cfg = defaultConfig();
    cfg.reviewer.backend = 'cursor';
    expect(resolveBackend(cfg, fakeSet({ cursor: true, claude: true }))?.name).toBe('cursor');
    _resetBackendCache();
    expect(resolveBackend(cfg, fakeSet({ claude: true }))).toBeNull();
  });

  it('uses the api backend only when a key env is configured AND set', () => {
    const cfg = defaultConfig();
    // no CLIs, no key → nothing
    expect(resolveBackend(cfg, fakeSet({}))).toBeNull();
    _resetBackendCache();
    cfg.reviewer.apiKeyEnv = 'MY_KEY';
    expect(resolveBackend(cfg, fakeSet({ api: true }))?.name).toBe('api');
  });
});

describe('extractJSON (shared)', () => {
  it('pulls JSON out of fenced/prose output', () => {
    expect(extractJSON('sure:\n```json\n{"findings":[]}\n```')).toEqual({ findings: [] });
    expect(extractJSON('garbage')).toBeNull();
  });
});
