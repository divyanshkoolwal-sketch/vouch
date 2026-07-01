// `vouch install|uninstall|status <tool>` — writes each host agent's native
// config to wire up Vouch (MCP server + hooks + intent skill/rule), with safe,
// namespaced, idempotent merges (own keys only), .bak backups, --dry-run, and a
// clean uninstall. Claude Code is NOT handled here — it stays on its plugin /
// marketplace install, untouched.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Package layout at runtime: dist/cli.js → root has dist/, scripts/, skills/.
const PKG_ROOT = path.resolve(__dirname, '..');
const DIST = path.join(PKG_ROOT, 'dist');
const SCRIPTS = path.join(PKG_ROOT, 'scripts');
const SKILL_SRC = path.join(PKG_ROOT, 'skills', 'understand-intent', 'SKILL.md');

export interface InstallOpts {
  global?: boolean;
  strict?: boolean; // Cursor: also install the hard commit-gate
  dryRun?: boolean;
  projectDir?: string;
}

type Action = { kind: 'write' | 'skip' | 'backup' | 'note'; target: string; detail?: string };

function q(s: string): string {
  return `"${s}"`;
}

function readFileOr(file: string, fallback = ''): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

function writeTarget(file: string, content: string, dry: boolean, actions: Action[]): void {
  const exists = fs.existsSync(file);
  if (exists && fs.readFileSync(file, 'utf8') === content) {
    actions.push({ kind: 'skip', target: file, detail: 'already up to date' });
    return;
  }
  if (dry) {
    actions.push({ kind: 'write', target: file, detail: exists ? 'would update' : 'would create' });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (exists) {
    fs.copyFileSync(file, file + '.bak');
    actions.push({ kind: 'backup', target: file + '.bak' });
  }
  fs.writeFileSync(file, content);
  actions.push({ kind: 'write', target: file, detail: exists ? 'updated' : 'created' });
}

// ---------- JSON config helpers (Cursor mcp/hooks, Codex hooks) ----------
function readJSONObj(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/** Replace this event's vouch-owned entries (tagged `_vouch:true`) with `entries`. */
function mergeHookEvent(hooksObj: any, event: string, entries: any[]): void {
  hooksObj.hooks = hooksObj.hooks ?? {};
  const existing: any[] = Array.isArray(hooksObj.hooks[event]) ? hooksObj.hooks[event] : [];
  const others = existing.filter((e) => !e || !e._vouch);
  hooksObj.hooks[event] = [...others, ...entries.map((e) => ({ ...e, _vouch: true }))];
}

function removeVouchHooks(hooksObj: any): void {
  if (!hooksObj?.hooks) return;
  for (const ev of Object.keys(hooksObj.hooks)) {
    if (Array.isArray(hooksObj.hooks[ev])) {
      hooksObj.hooks[ev] = hooksObj.hooks[ev].filter((e: any) => !e || !e._vouch);
      if (hooksObj.hooks[ev].length === 0) delete hooksObj.hooks[ev];
    }
  }
}

// ---------- TOML section helpers (Codex config.toml mcp block) ----------
const TOML_HEADER = '[mcp_servers.vouch]';

export function upsertTomlSection(content: string, body: string): string {
  const stripped = removeTomlSection(content);
  const sep = stripped && !stripped.endsWith('\n') ? '\n' : '';
  const lead = stripped.trim() ? '\n' : '';
  return `${stripped}${sep}${lead}${TOML_HEADER}\n${body}`.replace(/\n{3,}/g, '\n\n');
}

export function removeTomlSection(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line.trim() === TOML_HEADER) {
      skipping = true;
      continue;
    }
    if (skipping) {
      // A new top-level table header ends our section.
      if (/^\s*\[/.test(line)) skipping = false;
      else continue;
    }
    if (!skipping) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ---------- shared content ----------
function mcpServerJSON(host: string) {
  return { command: 'node', args: [path.join(DIST, 'mcp.js')], env: { VOUCH_HOST: host } };
}

// ============================ CODEX ============================
function codexDir(): string {
  return path.join(os.homedir(), '.codex');
}

function installCodex(opts: InstallOpts, actions: Action[]): void {
  const dir = codexDir();
  // 1) MCP server → config.toml (comment-preserving section upsert)
  const cfgToml = path.join(dir, 'config.toml');
  const body = ['command = "node"', `args = [${q(path.join(DIST, 'mcp.js'))}]`, 'env = { VOUCH_HOST = "codex" }', ''].join('\n');
  writeTarget(cfgToml, upsertTomlSection(readFileOr(cfgToml), body), !!opts.dryRun, actions);

  // 2) Hooks → hooks.json (Stop hard-block loop; PostToolUse dirty; SessionStart context)
  const hooksFile = path.join(dir, 'hooks.json');
  const hooksObj = readJSONObj(hooksFile);
  const cmd = (script: string) => `VOUCH_HOST=codex bash ${q(path.join(SCRIPTS, script))}`;
  mergeHookEvent(hooksObj, 'SessionStart', [{ hooks: [{ type: 'command', command: cmd('session-start.sh'), timeout: 10 }] }]);
  mergeHookEvent(hooksObj, 'PostToolUse', [{ hooks: [{ type: 'command', command: cmd('mark-dirty.sh'), timeout: 5 }] }]);
  mergeHookEvent(hooksObj, 'Stop', [{ hooks: [{ type: 'command', command: cmd('verify-stop.sh'), timeout: 240 }] }]);
  writeTarget(hooksFile, JSON.stringify(hooksObj, null, 2) + '\n', !!opts.dryRun, actions);

  // 3) Intent skill (cross-tool SKILL.md)
  writeTarget(path.join(dir, 'skills', 'understand-intent', 'SKILL.md'), readFileOr(SKILL_SRC), !!opts.dryRun, actions);

  actions.push({ kind: 'note', target: 'codex', detail: 'MCP tools + hard-block verify loop + intent skill installed (global ~/.codex).' });
  actions.push({
    kind: 'note',
    target: 'codex',
    detail: 'IMPORTANT: Codex trust-gates hooks — on your first `codex` session, approve trusting Vouch\'s hooks when prompted (one time). For automation, pass `--dangerously-bypass-hook-trust`.',
  });
}

function uninstallCodex(opts: InstallOpts, actions: Action[]): void {
  const dir = codexDir();
  const cfgToml = path.join(dir, 'config.toml');
  if (fs.existsSync(cfgToml)) writeTarget(cfgToml, removeTomlSection(readFileOr(cfgToml)).replace(/\n+$/, '\n'), !!opts.dryRun, actions);
  const hooksFile = path.join(dir, 'hooks.json');
  if (fs.existsSync(hooksFile)) {
    const obj = readJSONObj(hooksFile);
    removeVouchHooks(obj);
    writeTarget(hooksFile, JSON.stringify(obj, null, 2) + '\n', !!opts.dryRun, actions);
  }
  const skill = path.join(dir, 'skills', 'understand-intent', 'SKILL.md');
  if (fs.existsSync(skill) && !opts.dryRun) {
    fs.rmSync(skill, { force: true });
  }
  actions.push({ kind: 'note', target: 'codex', detail: 'Removed vouch MCP block, hooks, and skill.' });
}

// ============================ CURSOR ============================
function cursorRoot(opts: InstallOpts): string {
  return opts.global ? path.join(os.homedir(), '.cursor') : path.join(opts.projectDir ?? process.cwd(), '.cursor');
}

function installCursor(opts: InstallOpts, actions: Action[]): void {
  const root = cursorRoot(opts);

  // 1) MCP server → mcp.json
  const mcpFile = path.join(root, 'mcp.json');
  const mcpObj = readJSONObj(mcpFile);
  mcpObj.mcpServers = mcpObj.mcpServers ?? {};
  mcpObj.mcpServers.vouch = mcpServerJSON('cursor');
  writeTarget(mcpFile, JSON.stringify(mcpObj, null, 2) + '\n', !!opts.dryRun, actions);

  // 2) Hooks → hooks.json (stop = soft followup; afterFileEdit = dirty; opt-in commit gate)
  const hooksFile = path.join(root, 'hooks.json');
  const hooksObj = readJSONObj(hooksFile);
  hooksObj.version = hooksObj.version ?? 1;
  const nodeCmd = (subcmd: string) => `VOUCH_HOST=cursor node ${q(path.join(DIST, 'cli.js'))} ${subcmd}`;
  mergeHookEvent(hooksObj, 'afterFileEdit', [{ command: `VOUCH_HOST=cursor bash ${q(path.join(SCRIPTS, 'mark-dirty.sh'))}` }]);
  mergeHookEvent(hooksObj, 'stop', [{ command: nodeCmd('cursor-stop') }]);
  if (opts.strict) {
    mergeHookEvent(hooksObj, 'beforeShellExecution', [{ command: nodeCmd('cursor-guard'), failClosed: true }]);
  } else {
    // ensure a prior strict gate is removed when re-installing non-strict
    if (hooksObj.hooks?.beforeShellExecution) {
      hooksObj.hooks.beforeShellExecution = hooksObj.hooks.beforeShellExecution.filter((e: any) => !e?._vouch);
      if (hooksObj.hooks.beforeShellExecution.length === 0) delete hooksObj.hooks.beforeShellExecution;
    }
  }
  writeTarget(hooksFile, JSON.stringify(hooksObj, null, 2) + '\n', !!opts.dryRun, actions);

  // 3) Intent rule (.mdc guidance)
  const rule = [
    '---',
    'description: Confirm intent, then let Vouch verify changes before finishing',
    'alwaysApply: false',
    '---',
    '',
    '- For a non-trivial change, first call the `record_intent` tool (vouch MCP) with a short summary + a few acceptance criteria.',
    '- When you finish, Vouch verifies automatically; if it returns blocking issues, fix them and re-verify.',
    '- To check on demand, call the `verify` tool. Dismiss a genuine non-issue with `dismiss_finding`.',
    '',
  ].join('\n');
  writeTarget(path.join(root, 'rules', 'vouch.mdc'), rule, !!opts.dryRun, actions);

  actions.push({
    kind: 'note',
    target: 'cursor',
    detail: `MCP tools + soft verify loop${opts.strict ? ' + commit gate' : ''} + intent rule installed (${opts.global ? 'global ~/.cursor' : root}).`,
  });
}

function uninstallCursor(opts: InstallOpts, actions: Action[]): void {
  const root = cursorRoot(opts);
  const mcpFile = path.join(root, 'mcp.json');
  if (fs.existsSync(mcpFile)) {
    const obj = readJSONObj(mcpFile);
    if (obj.mcpServers) delete obj.mcpServers.vouch;
    writeTarget(mcpFile, JSON.stringify(obj, null, 2) + '\n', !!opts.dryRun, actions);
  }
  const hooksFile = path.join(root, 'hooks.json');
  if (fs.existsSync(hooksFile)) {
    const obj = readJSONObj(hooksFile);
    removeVouchHooks(obj);
    writeTarget(hooksFile, JSON.stringify(obj, null, 2) + '\n', !!opts.dryRun, actions);
  }
  const rule = path.join(root, 'rules', 'vouch.mdc');
  if (fs.existsSync(rule) && !opts.dryRun) fs.rmSync(rule, { force: true });
  actions.push({ kind: 'note', target: 'cursor', detail: 'Removed vouch MCP server, hooks, and rule.' });
}

// ============================ entry points ============================
export function runInstall(tool: string, opts: InstallOpts): Action[] {
  const actions: Action[] = [];
  if (tool === 'codex') installCodex(opts, actions);
  else if (tool === 'cursor') installCursor(opts, actions);
  else actions.push({ kind: 'note', target: tool, detail: `Unknown tool "${tool}". Use: codex | cursor. (Claude Code uses the plugin install — see README.)` });
  return actions;
}

export function runUninstall(tool: string, opts: InstallOpts): Action[] {
  const actions: Action[] = [];
  if (tool === 'codex') uninstallCodex(opts, actions);
  else if (tool === 'cursor') uninstallCursor(opts, actions);
  else actions.push({ kind: 'note', target: tool, detail: `Unknown tool "${tool}". Use: codex | cursor.` });
  return actions;
}

export function statusLines(opts: InstallOpts): string[] {
  const out: string[] = [];
  const codexToml = path.join(codexDir(), 'config.toml');
  out.push(`codex:  MCP ${readFileOr(codexToml).includes(TOML_HEADER) ? '✓' : '—'}  hooks ${readFileOr(path.join(codexDir(), 'hooks.json')).includes('_vouch') ? '✓' : '—'}  (~/.codex)`);
  const croot = cursorRoot(opts);
  out.push(`cursor: MCP ${readFileOr(path.join(croot, 'mcp.json')).includes('"vouch"') ? '✓' : '—'}  hooks ${readFileOr(path.join(croot, 'hooks.json')).includes('_vouch') ? '✓' : '—'}  (${opts.global ? '~/.cursor' : croot})`);
  return out;
}

export function formatActions(actions: Action[], dryRun: boolean): string {
  const lines = actions.map((a) => {
    if (a.kind === 'note') return `  • ${a.detail}`;
    if (a.kind === 'backup') return `  ↳ backup: ${a.target}`;
    if (a.kind === 'skip') return `  = ${a.target} (${a.detail})`;
    return `  ${dryRun ? '·' : '✓'} ${a.target}${a.detail ? ` (${a.detail})` : ''}`;
  });
  return lines.join('\n');
}
