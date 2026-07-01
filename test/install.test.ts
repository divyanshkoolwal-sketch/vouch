import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runInstall, runUninstall, upsertTomlSection, removeTomlSection } from '../src/install';
import { tmpProj, rm } from './helpers';

describe('TOML section upsert/remove (comment-preserving)', () => {
  const base = '# my config\nmodel = "gpt-5"\n\n[mcp_servers.other]\ncommand = "foo"\n';
  const body = 'command = "node"\nargs = ["/x/mcp.js"]\n';

  it('appends the vouch section, preserving everything else', () => {
    const out = upsertTomlSection(base, body);
    expect(out).toContain('# my config');
    expect(out).toContain('[mcp_servers.other]');
    expect(out).toContain('[mcp_servers.vouch]');
  });
  it('is idempotent (upserting twice yields the same content)', () => {
    const once = upsertTomlSection(base, body);
    expect(upsertTomlSection(once, body)).toBe(once);
  });
  it('removeTomlSection restores the original (minus trailing blank noise)', () => {
    const out = upsertTomlSection(base, body);
    expect(removeTomlSection(out)).not.toContain('[mcp_servers.vouch]');
    expect(removeTomlSection(out)).toContain('[mcp_servers.other]');
  });
});

describe('runInstall / runUninstall (cursor, project scope)', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.forEach(rm));

  it('adds vouch to mcp.json + hooks + rule, preserving existing servers, then cleanly uninstalls', () => {
    const proj = tmpProj();
    dirs.push(proj);
    fs.mkdirSync(path.join(proj, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.cursor/mcp.json'), JSON.stringify({ mcpServers: { pw: { command: 'npx' } } }));

    runInstall('cursor', { projectDir: proj });
    const mcp = JSON.parse(fs.readFileSync(path.join(proj, '.cursor/mcp.json'), 'utf8'));
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(['pw', 'vouch']);
    const hooks = JSON.parse(fs.readFileSync(path.join(proj, '.cursor/hooks.json'), 'utf8'));
    expect(Object.keys(hooks.hooks)).toContain('stop');
    expect(hooks.hooks.stop[0]._vouch).toBe(true);
    expect(fs.existsSync(path.join(proj, '.cursor/rules/vouch.mdc'))).toBe(true);

    runUninstall('cursor', { projectDir: proj });
    const mcp2 = JSON.parse(fs.readFileSync(path.join(proj, '.cursor/mcp.json'), 'utf8'));
    expect(Object.keys(mcp2.mcpServers)).toEqual(['pw']);
    expect(fs.existsSync(path.join(proj, '.cursor/rules/vouch.mdc'))).toBe(false);
  });

  it('--strict adds the commit gate; default does not', () => {
    const proj = tmpProj();
    dirs.push(proj);
    runInstall('cursor', { projectDir: proj });
    let hooks = JSON.parse(fs.readFileSync(path.join(proj, '.cursor/hooks.json'), 'utf8'));
    expect(hooks.hooks.beforeShellExecution).toBeUndefined();
    runInstall('cursor', { projectDir: proj, strict: true });
    hooks = JSON.parse(fs.readFileSync(path.join(proj, '.cursor/hooks.json'), 'utf8'));
    expect(hooks.hooks.beforeShellExecution[0].command).toContain('cursor-guard');
    expect(hooks.hooks.beforeShellExecution[0].failClosed).toBe(true);
  });
});

describe('runInstall / runUninstall (codex, global via HOME)', () => {
  const origHome = process.env.HOME;
  const dirs: string[] = [];
  afterEach(() => {
    process.env.HOME = origHome;
    dirs.forEach(rm);
  });

  it('writes the MCP section + hooks + skill under ~/.codex, then removes them', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vouch-home-'));
    dirs.push(home);
    process.env.HOME = home;

    runInstall('codex', {});
    const toml = fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8');
    expect(toml).toContain('[mcp_servers.vouch]');
    const hooks = JSON.parse(fs.readFileSync(path.join(home, '.codex/hooks.json'), 'utf8'));
    expect(Object.keys(hooks.hooks).sort()).toEqual(['PostToolUse', 'SessionStart', 'Stop']);
    expect(fs.existsSync(path.join(home, '.codex/skills/understand-intent/SKILL.md'))).toBe(true);

    runUninstall('codex', {});
    expect(fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8')).not.toContain('[mcp_servers.vouch]');
  });
});
