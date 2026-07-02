#!/usr/bin/env node
// The Vouch MCP server: the interactive face of the same shared core the hooks
// use. The agent calls these tools to confirm intent, run verification on
// demand, dismiss false positives, record conventions, and set up the repo.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { loadConfig, saveConfig, defaultConfig, normalizeConfig } from './core/config';
import { recordIntent, loadActiveIntent, clearActiveIntent } from './core/intent';
import { runPipeline } from './core/pipeline';
import { addDismissal } from './core/dismissals';
import { detect } from './core/detect';
import { appendText, conventionsPath, readJSON, findingsLogPath, ensureVouchDir, offPath, exists } from './core/memory';
import { VouchConfig } from './core/types';
import { coverageLine } from './core/prioritize';
import { grantTrust, revokeTrust, trustSummary, isTrusted } from './core/trust';
import * as fs from 'fs';

function proj(): string {
  return process.env.CLAUDE_PROJECT_DIR || process.env.VOUCH_PROJECT_DIR || process.cwd();
}
function nowISO(): string {
  return new Date().toISOString();
}
function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] };
}

const server = new McpServer({ name: 'vouch', version: '0.5.0' });

const cmdSchema = z.object({ cmd: z.string(), enabled: z.boolean() });

// ---- intent ----
server.tool(
  'record_intent',
  'Save what the user actually wants for the current change as a lightweight intent record (summary + a few acceptance criteria). Call this after a short plain-language confirmation with the user — NOT a heavy spec. Becomes the basis for the independent verification review.',
  {
    summary: z.string().describe('One or two sentences: what the user wants, in plain language.'),
    acceptance_criteria: z
      .array(z.string())
      .describe('A few concrete, checkable statements that must be true when this is done.'),
    scope_globs: z.array(z.string()).optional().describe('Optional path globs this change should touch.'),
    non_goals: z.array(z.string()).optional().describe('Optional explicit non-goals (so they are not flagged as missing).'),
  },
  async (args) => {
    const rec = recordIntent(proj(), args, nowISO());
    return text(
      `Recorded intent ${rec.id}.\nSummary: ${rec.summary}\nAcceptance criteria:\n${rec.acceptance_criteria
        .map((c, i) => `  ${i + 1}. ${c}`)
        .join('\n')}\n\nVouch will verify future changes against this.`,
    );
  },
);

server.tool('get_active_intent', 'Return the currently active intent record for this repo, if any.', {}, async () => {
  const rec = loadActiveIntent(proj());
  return text(rec ? JSON.stringify(rec, null, 2) : 'No active intent. Use record_intent (or /vouch:intent) to set one.');
});

server.tool('clear_intent', 'Archive the active intent (e.g. when the current task is finished).', {}, async () => {
  clearActiveIntent(proj());
  return text('Active intent archived.');
});

// ---- verify ----
server.tool(
  'verify',
  'Run the full verification pipeline now (deterministic checks + independent intent review) and return prioritized findings. Use to check work on demand; verification also runs automatically when you stop.',
  { force: z.boolean().optional().describe('Run even if there is no diff to verify.') },
  async (args) => {
    const cfg = loadConfig(proj());
    if (!cfg) return text('Vouch is not set up for this repo yet. Run /vouch:setup (or call get_setup_suggestion then configure).');
    const result = await runPipeline({ proj: proj(), cfg, intent: loadActiveIntent(proj()), force: !!args.force });
    const out: string[] = [result.summary, `ran: ${result.ranTiers.join(', ') || '(none)'}`];
    const cov = coverageLine(result.coverage);
    if (cov) out.push(cov);
    if (result.skipped.length) out.push(`skipped: ${result.skipped.map((s) => `${s.tier} — ${s.reason}`).join('; ')}`);
    if (result.fixPrompt) out.push('\n' + result.fixPrompt);
    else {
      if (result.notices.length) {
        out.push('\nNon-blocking failures:');
        result.notices.forEach((n) => out.push(`- [${n.tier}] ${n.title}${n.command ? ` — ${n.command}` : ''} (id: ${n.id})`));
      }
      if (result.questions.length) {
        out.push('\nOpen questions (non-blocking):');
        result.questions.forEach((q) => out.push(`- [${q.tier}] ${q.title} (id: ${q.id})`));
      }
    }
    return text(out.join('\n'));
  },
);

// ---- dismissals ----
server.tool(
  'dismiss_finding',
  'Permanently suppress a finding the user has confirmed is a non-issue, by its vouch id. Vouch will never raise the same finding again. This is how Vouch learns to stay quiet.',
  {
    id: z.string().describe('The vouch id shown next to the finding.'),
    reason: z.string().optional().describe('Why it is a non-issue (kept for the record).'),
  },
  async (args) => {
    addDismissal(proj(), args.id, args.reason ?? '', nowISO());
    return text(`Dismissed ${args.id}. Vouch will not raise this finding again.`);
  },
);

// ---- conventions (memory) ----
server.tool(
  'record_convention',
  'Append a durable project convention to Vouch memory (.vouch/conventions.md). Injected into context at the start of future sessions so the agent and the reviewer respect it.',
  { text: z.string().describe('The convention, one line or a short paragraph.') },
  async (args) => {
    ensureVouchDir(proj());
    appendText(conventionsPath(proj()), `- ${args.text.trim()}\n`);
    return text('Convention recorded.');
  },
);

// ---- setup / config ----
server.tool(
  'get_setup_suggestion',
  'Auto-detect how to run this project\'s checks (test/lint/build/typecheck). Returns suggested commands to confirm with the user before saving via configure.',
  {},
  async () => {
    const d = detect(proj());
    return text(
      `Detected ecosystem: ${d.ecosystem.join(', ') || 'unknown'}\nNotes:\n${d.notes.map((n) => '- ' + n).join('\n')}\n\nSuggested commands:\n${JSON.stringify(d.commands, null, 2)}\n\nConfirm/edit these with the user, then call configure with the final commands and tiers.`,
    );
  },
);

server.tool('get_config', 'Return the current Vouch configuration for this repo (or note that it is unset).', {}, async () => {
  const cfg = loadConfig(proj());
  return text(cfg ? JSON.stringify(cfg, null, 2) : 'Vouch is not set up. Call get_setup_suggestion then configure.');
});

server.tool(
  'configure',
  'Create or update the Vouch configuration for this repo. Merges over existing config. Use after get_setup_suggestion and a one-line confirmation with the user. Never put secrets here — reference env var names only.',
  {
    commands: z
      .object({
        typecheck: cmdSchema.optional(),
        lint: cmdSchema.optional(),
        build: cmdSchema.optional(),
        test: cmdSchema.optional(),
        start: cmdSchema.optional(),
      })
      .optional(),
    tiers: z
      .object({
        typecheck: z.boolean().optional(),
        lint: z.boolean().optional(),
        build: z.boolean().optional(),
        test: z.boolean().optional(),
        integrity: z.boolean().optional(),
        intent: z.boolean().optional(),
        smoke: z.boolean().optional(),
      })
      .optional(),
    enforcement: z
      .object({
        block: z.boolean().optional(),
        blockOn: z.array(z.enum(['typecheck', 'lint', 'build', 'test', 'integrity', 'intent', 'smoke'])).optional(),
        blockWhenProven: z.boolean().optional(),
        maxIterations: z.number().int().min(1).max(10).optional(),
      })
      .optional(),
    web: z
      .object({
        enabled: z.boolean().optional(),
        url: z.string().optional(),
        readyPath: z.string().optional(),
        routes: z.array(z.string()).optional(),
      })
      .optional(),
    reviewerModel: z.string().optional().describe('Optional model id for the independent reviewer (omit to inherit default).'),
  },
  async (args) => {
    const existing = loadConfig(proj()) ?? defaultConfig();
    const merged: VouchConfig = normalizeConfig({
      ...existing,
      commands: { ...existing.commands, ...(args.commands ?? {}) },
      tiers: { ...existing.tiers, ...(args.tiers ?? {}) },
      enforcement: { ...existing.enforcement, ...(args.enforcement ?? {}) } as VouchConfig['enforcement'],
      web: { ...existing.web, ...(args.web ?? {}) },
      reviewer: { ...existing.reviewer, ...(args.reviewerModel ? { model: args.reviewerModel } : {}) },
    });
    saveConfig(proj(), merged);
    // The user just authored/approved this config in-session → trust it, so the
    // author's own setup doesn't hit the trust gate. (A config that merely
    // arrived inside a cloned repo is NOT trusted until /vouch:trust.)
    grantTrust(proj(), merged, nowISO());
    return text(`Vouch configured (and trusted for this repo).\n${JSON.stringify(merged, null, 2)}`);
  },
);

server.tool(
  'trust_repo',
  "Grant or revoke trust for THIS repo's Vouch config. Vouch runs commands, an LLM reviewer, and sandboxed probes using settings from .vouch/config.json — but a cloned/untrusted repo's config is inert until trusted. Call with grant:true only after the user has reviewed what it will run (show them the summary first). Trust is re-required if the security-relevant config changes.",
  {
    grant: z.boolean().describe('true = trust this repo and enable verification; false = revoke trust.'),
  },
  async (args) => {
    const cfg = loadConfig(proj());
    if (!cfg) return text('Vouch is not set up for this repo (no .vouch/config.json).');
    if (!args.grant) {
      revokeTrust(proj());
      return text('Trust revoked. Vouch verification is now inert in this repo.');
    }
    const summary = trustSummary(cfg);
    grantTrust(proj(), cfg, nowISO());
    return text(
      `Repo trusted. Verification is now enabled here.\n\nThis authorizes Vouch to:\n${summary.map((l) => '  - ' + l).join('\n')}\n\nTrust is re-required if these settings change. Revoke anytime with trust_repo(grant:false).`,
    );
  },
);

server.tool(
  'get_status',
  'Show Vouch status for this repo: config presence, active intent, and the most recent verification findings.',
  {},
  async () => {
    const cfg = loadConfig(proj());
    const intent = loadActiveIntent(proj());
    const last = readJSON<any>(findingsLogPath(proj()), null);
    const lines = [
      `Configured: ${cfg ? 'yes' : 'no'}`,
      `Active intent: ${intent ? intent.summary : 'none'}`,
    ];
    if (cfg) {
      lines.push(`Trusted: ${isTrusted(proj(), cfg) ? 'yes' : 'NO — verification is inert until /vouch:trust'}`);
      lines.push(`Tiers: ${Object.entries(cfg.tiers).filter(([, v]) => v).map(([k]) => k).join(', ')}`);
      lines.push(`Blocking on: ${cfg.enforcement.block ? cfg.enforcement.blockOn.join(', ') : '(disabled)'}`);
    }
    if (last) {
      lines.push(`\nLast verification (${last.ts}): ${last.summary}`);
      for (const f of last.blocking ?? []) lines.push(`  [blocking] ${f.title} (id: ${f.id})`);
      for (const f of last.notices ?? []) lines.push(`  [non-blocking] ${f.title} (id: ${f.id})`);
      for (const f of last.questions ?? []) lines.push(`  [question] ${f.title} (id: ${f.id})`);
    }
    return text(lines.join('\n'));
  },
);

server.tool(
  'set_enabled',
  'Pause or resume Vouch\'s automatic verification for this repo (the kill switch behind /vouch:off). When paused, the Stop hook does nothing until resumed.',
  { enabled: z.boolean().describe('false = pause automatic verification; true = resume.') },
  async (args) => {
    ensureVouchDir(proj());
    const marker = offPath(proj());
    if (args.enabled) {
      try {
        if (exists(marker)) fs.rmSync(marker);
      } catch {
        /* ignore */
      }
      return text('Vouch automatic verification RESUMED.');
    }
    fs.writeFileSync(marker, `paused ${nowISO()}\n`);
    return text('Vouch automatic verification PAUSED. Resume with /vouch:off (toggle) or set_enabled(true).');
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch((e) => {
  process.stderr.write(`vouch mcp server failed: ${e?.message ?? e}\n`);
  process.exit(1);
});
