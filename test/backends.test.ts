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

describe('backend resolution (map role)', () => {
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
    expect(resolveBackend(cfg, 'map', fakeSet({ claude: true, codex: true, cursor: true }))?.name).toBe('claude');
  });

  it('auto falls back claude→codex→cursor', () => {
    const cfg = defaultConfig();
    expect(resolveBackend(cfg, 'map', fakeSet({ codex: true, cursor: true }))?.name).toBe('codex');
    _resetBackendCache();
    expect(resolveBackend(cfg, 'map', fakeSet({ cursor: true }))?.name).toBe('cursor');
  });

  it('auto prefers the host agent (VOUCH_HOST) even if claude is also present', () => {
    process.env.VOUCH_HOST = 'codex';
    const cfg = defaultConfig();
    expect(resolveBackend(cfg, 'map', fakeSet({ claude: true, codex: true }))?.name).toBe('codex');
  });

  it('explicit backend is honored, or null if unavailable', () => {
    const cfg = defaultConfig();
    cfg.reviewer.backend = 'cursor';
    expect(resolveBackend(cfg, 'map', fakeSet({ cursor: true, claude: true }))?.name).toBe('cursor');
    _resetBackendCache();
    expect(resolveBackend(cfg, 'map', fakeSet({ claude: true }))).toBeNull();
  });

  it('uses the api backend only when a key env is configured AND set', () => {
    const cfg = defaultConfig();
    expect(resolveBackend(cfg, 'map', fakeSet({}))).toBeNull();
    _resetBackendCache();
    cfg.reviewer.apiKeyEnv = 'MY_KEY';
    expect(resolveBackend(cfg, 'map', fakeSet({ api: true }))?.name).toBe('api');
  });
});

describe('backend resolution (verify role — cross-model)', () => {
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

  it('auto picks a DIFFERENT backend than map (map=claude → verify=codex)', () => {
    const set = fakeSet({ claude: true, codex: true, cursor: true });
    const cfg = defaultConfig();
    expect(resolveBackend(cfg, 'map', set)?.name).toBe('claude');
    expect(resolveBackend(cfg, 'verify', set)?.name).toBe('codex');
  });

  it('respects the host: map=codex (VOUCH_HOST) → verify=claude', () => {
    process.env.VOUCH_HOST = 'codex';
    const set = fakeSet({ claude: true, codex: true });
    const cfg = defaultConfig();
    expect(resolveBackend(cfg, 'map', set)?.name).toBe('codex');
    expect(resolveBackend(cfg, 'verify', set)?.name).toBe('claude');
  });

  it('degrades to the SAME backend when it is the only one available', () => {
    const set = fakeSet({ claude: true });
    const cfg = defaultConfig();
    expect(resolveBackend(cfg, 'verify', set)?.name).toBe('claude');
  });

  it('explicit verifierBackend wins', () => {
    const set = fakeSet({ claude: true, codex: true, cursor: true });
    const cfg = defaultConfig();
    cfg.reviewer.verifierBackend = 'cursor';
    expect(resolveBackend(cfg, 'verify', set)?.name).toBe('cursor');
  });

  it('roles are cached independently', () => {
    const set = fakeSet({ claude: true, codex: true });
    const cfg = defaultConfig();
    const map1 = resolveBackend(cfg, 'map', set);
    const ver1 = resolveBackend(cfg, 'verify', set);
    expect(map1?.name).toBe('claude');
    expect(ver1?.name).toBe('codex');
    // repeated calls hit the cache and stay stable
    expect(resolveBackend(cfg, 'map', set)?.name).toBe('claude');
    expect(resolveBackend(cfg, 'verify', set)?.name).toBe('codex');
  });
});

describe('extractJSON (shared)', () => {
  it('pulls JSON out of fenced/prose output', () => {
    expect(extractJSON('sure:\n```json\n{"findings":[]}\n```')).toEqual({ findings: [] });
    expect(extractJSON('garbage')).toBeNull();
  });
});
