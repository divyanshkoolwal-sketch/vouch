import { describe, it, expect, afterEach } from 'vitest';
import { defaultConfig, normalizeConfig, loadConfig, saveConfig, isConfigured } from '../src/core/config';
import { tmpProj, rm, write } from './helpers';

describe('config', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.forEach(rm));

  it('default blocks only on deterministic tiers', () => {
    const d = defaultConfig();
    expect(d.enforcement.blockOn).toEqual(['typecheck', 'build', 'test']);
    expect(d.enforcement.blockOn).not.toContain('intent');
    expect(d.enforcement.blockOn).not.toContain('lint');
    expect(d.enforcement.maxIterations).toBe(3);
  });

  it('normalizes a partial config over defaults', () => {
    const merged = normalizeConfig({ enforcement: { block: false } as any });
    expect(merged.enforcement.block).toBe(false);
    // unspecified fields fall back to defaults
    expect(merged.enforcement.maxIterations).toBe(3);
    expect(merged.tiers.test).toBe(true);
  });

  it('round-trips through disk and reports configured state', () => {
    const proj = tmpProj();
    dirs.push(proj);
    expect(isConfigured(proj)).toBe(false);
    expect(loadConfig(proj)).toBeNull();
    const cfg = defaultConfig();
    cfg.commands.test = { cmd: 'npm test', enabled: true };
    saveConfig(proj, cfg);
    expect(isConfigured(proj)).toBe(true);
    expect(loadConfig(proj)?.commands.test?.cmd).toBe('npm test');
  });

  it('tolerates a corrupt config file (falls back to defaults)', () => {
    const proj = tmpProj();
    dirs.push(proj);
    write(proj, '.vouch/config.json', '{ this is not json');
    const cfg = loadConfig(proj);
    expect(cfg).not.toBeNull();
    expect(cfg!.enforcement.maxIterations).toBe(3);
  });
});
