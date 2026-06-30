#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/core/memory.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
function vouchDir(proj) {
  return path.join(proj, ".vouch");
}
function runsDir(proj) {
  return path.join(vouchDir(proj), "runs");
}
function configPath(proj) {
  return path.join(vouchDir(proj), "config.json");
}
function intentDir(proj) {
  return path.join(vouchDir(proj), "intent");
}
function activeIntentPath(proj) {
  return path.join(intentDir(proj), "active.json");
}
function dismissalsPath(proj) {
  return path.join(vouchDir(proj), "dismissals.json");
}
function conventionsPath(proj) {
  return path.join(vouchDir(proj), "conventions.md");
}
function statePath(proj) {
  return path.join(runsDir(proj), "state.json");
}
function dirtyPath(proj) {
  return path.join(runsDir(proj), "dirty");
}
function offPath(proj) {
  return path.join(runsDir(proj), "off");
}
function findingsLogPath(proj) {
  return path.join(runsDir(proj), "last-findings.json");
}
function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
}
function readText(file, fallback = "") {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : fallback;
  } catch {
    return fallback;
  }
}
function exists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

// src/core/config.ts
function defaultConfig() {
  return {
    version: 1,
    commands: {},
    web: { enabled: false },
    tiers: {
      typecheck: true,
      lint: true,
      build: true,
      test: true,
      intent: true,
      smoke: false
    },
    enforcement: {
      block: true,
      // Only objective, deterministic failures block by default. Lint and the
      // LLM intent review are advisory unless the user opts them in — this is
      // the core false-positive guardrail.
      blockOn: ["typecheck", "build", "test"],
      maxIterations: 3
    },
    reviewer: {
      model: void 0,
      timeoutSec: 90
    },
    commandTimeoutSec: 90,
    budgetSec: 150
  };
}
function normalizeConfig(stored) {
  const d = defaultConfig();
  if (!stored) return d;
  return {
    version: stored.version ?? d.version,
    commands: { ...d.commands, ...stored.commands ?? {} },
    web: { ...d.web, ...stored.web ?? {} },
    tiers: { ...d.tiers, ...stored.tiers ?? {} },
    enforcement: { ...d.enforcement, ...stored.enforcement ?? {} },
    reviewer: { ...d.reviewer, ...stored.reviewer ?? {} },
    commandTimeoutSec: stored.commandTimeoutSec ?? d.commandTimeoutSec,
    budgetSec: stored.budgetSec ?? d.budgetSec
  };
}
function loadConfig(proj) {
  if (!exists(configPath(proj))) return null;
  const stored = readJSON(configPath(proj), null);
  return normalizeConfig(stored);
}

// src/core/intent.ts
function loadActiveIntent(proj) {
  if (!exists(activeIntentPath(proj))) return null;
  const r = readJSON(activeIntentPath(proj), null);
  if (!r || r.status !== "active") return null;
  return r;
}

// src/core/runners.ts
var import_child_process = require("child_process");

// src/core/findings.ts
var import_crypto = require("crypto");
function fingerprint(parts) {
  const norm = parts.filter((p) => !!p).map((p) => p.trim().toLowerCase().replace(/\s+/g, " ")).join("");
  return (0, import_crypto.createHash)("sha1").update(norm).digest("hex").slice(0, 12);
}
function makeFinding(input) {
  const id = fingerprint([input.tier, input.title, input.file, ...input.fpExtra ?? []]);
  return {
    id,
    kind: input.kind,
    tier: input.tier,
    title: input.title,
    detail: input.detail,
    file: input.file,
    line: input.line,
    command: input.command,
    confidence: input.confidence
  };
}
function dedupe(findings) {
  const rank = { blocking: 2, question: 1, info: 0 };
  const byId = /* @__PURE__ */ new Map();
  for (const f of findings) {
    const prev = byId.get(f.id);
    if (!prev || rank[f.kind] > rank[prev.kind]) byId.set(f.id, f);
  }
  return [...byId.values()];
}

// src/core/runners.ts
var TAIL_CHARS = 4e3;
function runCommand(cmd, cwd, timeoutMs, env = process.env) {
  return new Promise((resolve) => {
    const start = Date.now();
    let out = "";
    let settled = false;
    let timedOut = false;
    let child;
    try {
      child = (0, import_child_process.spawn)("/bin/sh", ["-c", cmd], { cwd, env });
    } catch (e) {
      resolve({ code: null, output: "", timedOut: false, spawnError: String(e?.message ?? e), durationMs: 0 });
      return;
    }
    const cap = (s) => {
      out += s;
      if (out.length > TAIL_CHARS * 2) out = out.slice(-TAIL_CHARS * 2);
    };
    child.stdout?.on("data", (d) => cap(d.toString()));
    child.stderr?.on("data", (d) => cap(d.toString()));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
          }
        }, 2e3);
      } catch {
      }
    }, timeoutMs);
    const finish = (code, spawnError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const tail = out.length > TAIL_CHARS ? out.slice(-TAIL_CHARS) : out;
      resolve({ code, output: tail.trim(), timedOut, spawnError, durationMs: Date.now() - start });
    };
    child.on("error", (e) => finish(null, String(e?.message ?? e)));
    child.on("close", (code) => finish(code, null));
  });
}
function looksLikeMissingTool(r) {
  if (r.spawnError) return true;
  if (r.code === 127 || r.code === 126) return true;
  return /command not found|: not found|No such file or directory|is not recognized/i.test(r.output);
}
async function runTier(tier, rc, cwd, timeoutMs, blocking) {
  const result = await runCommand(rc.cmd, cwd, timeoutMs);
  if (result.code === 0) {
    return { tier, command: rc.cmd, result, finding: null, skippedReason: null };
  }
  if (looksLikeMissingTool(result)) {
    return {
      tier,
      command: rc.cmd,
      result,
      finding: null,
      skippedReason: `command could not be executed (\`${rc.cmd}\`) \u2014 skipped`
    };
  }
  const title = result.timedOut ? `${tier} timed out after ${Math.round(timeoutMs / 1e3)}s` : `${tier} failed (exit ${result.code})`;
  const finding = makeFinding({
    kind: blocking ? "blocking" : "info",
    tier,
    title,
    command: rc.cmd,
    confidence: "fact",
    detail: result.output || "(no output captured)",
    // Fingerprint on tier+command only, so the same failing check maps to a
    // stable id across runs (output/line noise excluded).
    fpExtra: [rc.cmd]
  });
  return { tier, command: rc.cmd, result, finding, skippedReason: null };
}

// src/core/reviewer.ts
var import_child_process2 = require("child_process");
function reviewerAvailable() {
  try {
    (0, import_child_process2.execFileSync)("claude", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
var SYSTEM_PROMPT = [
  "You are an independent verification reviewer for a code change. You did NOT write this code.",
  "Your only job: decide whether the diff plausibly satisfies the stated INTENT and acceptance criteria, and surface concrete gaps.",
  "",
  "Rules \u2014 these exist to keep you from crying wolf:",
  "- Default to raising NOTHING. Only report a finding when the diff gives you clear evidence.",
  '- Strongly PREFER "question" over "blocking". Use "blocking" only when you can name the exact acceptance criterion that is unmet AND point to the exact missing or contradicting code.',
  "- Judge ONLY the change in the diff against the intent. Do NOT report pre-existing issues, style/formatting nits, test coverage wishes, or speculative refactors.",
  "- Do NOT report things that the project's own tests/types/build would already catch \u2014 that is handled separately.",
  "- If the diff looks consistent with the intent, return an empty findings array. That is the expected, common answer.",
  "",
  "Output: a SINGLE JSON object and nothing else (no prose, no code fences):",
  '{"findings":[{"severity":"blocking"|"question","criterion":"<the acceptance criterion this relates to, or \\"general\\">","title":"<short>","detail":"<why, with concrete reference to the diff>","file":"<path or omitted>"}]}'
].join("\n");
function buildUserPrompt(intent, patch, truncated) {
  const ac = intent.acceptance_criteria.length ? intent.acceptance_criteria.map((c, i) => `  ${i + 1}. ${c}`).join("\n") : "  (none specified)";
  const ng = intent.non_goals?.length ? intent.non_goals.map((c) => `  - ${c}`).join("\n") : "  (none)";
  return [
    "# INTENT",
    intent.summary,
    "",
    "## Acceptance criteria",
    ac,
    "",
    "## Non-goals (do not flag these as missing)",
    ng,
    "",
    "# DIFF (the change to verify)",
    truncated ? "(note: diff was truncated; judge only what is shown)" : "",
    "```diff",
    patch || "(empty diff)",
    "```",
    "",
    "Return the JSON object now. Remember: empty findings is the common, correct answer when the change matches the intent."
  ].join("\n");
}
function extractResult(stdout) {
  try {
    const env = JSON.parse(stdout);
    if (typeof env?.result === "string") return { text: env.result, isError: !!env.is_error };
    return null;
  } catch {
    return null;
  }
}
function parseFindingsJSON(text) {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  try {
    const obj = JSON.parse(t);
    if (Array.isArray(obj?.findings)) return obj.findings;
    if (Array.isArray(obj)) return obj;
    return [];
  } catch {
    return [];
  }
}
function mapReviewFindings(raw, cfg) {
  const canBlock = cfg.enforcement.block && cfg.enforcement.blockOn.includes("intent");
  const findings = [];
  for (const r of raw) {
    if (!r || typeof r.title !== "string") continue;
    const severity = r.severity === "blocking" ? "blocking" : "question";
    const kind = severity === "blocking" && canBlock ? "blocking" : "question";
    findings.push(
      makeFinding({
        kind,
        tier: "intent",
        title: r.title.slice(0, 200),
        detail: [r.criterion ? `Criterion: ${r.criterion}` : "", r.detail ?? ""].filter(Boolean).join("\n"),
        file: typeof r.file === "string" ? r.file : void 0,
        confidence: severity === "blocking" ? "high" : "medium",
        fpExtra: [String(r.criterion ?? ""), String(r.file ?? "")]
      })
    );
  }
  return findings;
}
function reviewIntent(opts) {
  const { proj, intent, patch, truncated, cfg } = opts;
  const userPrompt = buildUserPrompt(intent, patch, truncated);
  const args = [
    "-p",
    userPrompt,
    "--output-format",
    "json",
    "--allowedTools",
    "Read",
    "Grep",
    "Glob",
    "--append-system-prompt",
    SYSTEM_PROMPT,
    "--max-turns",
    "6"
  ];
  if (cfg.reviewer.model) args.push("--model", cfg.reviewer.model);
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const done = (findings) => {
      if (settled) return;
      settled = true;
      resolve(findings);
    };
    let child;
    try {
      child = (0, import_child_process2.spawn)("claude", args, {
        cwd: proj,
        // VOUCH_DISABLE=1 makes our OWN hooks no-op inside this child → no
        // recursion. We intentionally do NOT pass --bare, because --bare reads
        // auth only from ANTHROPIC_API_KEY and would break OAuth/subscription
        // users; a normal `claude -p` inherits the user's existing auth.
        env: { ...process.env, VOUCH_DISABLE: "1" },
        stdio: ["ignore", "pipe", "ignore"]
      });
    } catch {
      done([]);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
          }
        }, 2e3);
      } catch {
      }
      done([]);
    }, cfg.reviewer.timeoutSec * 1e3);
    child.stdout?.on("data", (d) => stdout += d.toString());
    child.on("error", () => {
      clearTimeout(timer);
      done([]);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const res = extractResult(stdout);
      if (!res || res.isError) return done([]);
      done(mapReviewFindings(parseFindingsJSON(res.text), cfg));
    });
  });
}

// src/core/diff.ts
var import_child_process3 = require("child_process");
var import_crypto2 = require("crypto");
var MAX_PATCH_LINES = 1600;
var MAX_UNTRACKED_FILE_LINES = 400;
function git(proj, args) {
  try {
    return (0, import_child_process3.execFileSync)("git", args, {
      cwd: proj,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return "";
  }
}
function isGitRepo(proj) {
  return git(proj, ["rev-parse", "--is-inside-work-tree"]).trim() === "true";
}
function hasCommits(proj) {
  try {
    (0, import_child_process3.execFileSync)("git", ["rev-parse", "HEAD"], { cwd: proj, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
function workingDiff(proj) {
  if (!isGitRepo(proj)) {
    return { patch: "", files: [], hash: "", truncated: false, isGit: false };
  }
  const EXCLUDE_VOUCH = ":(exclude).vouch";
  let tracked = hasCommits(proj) ? git(proj, ["diff", "HEAD", "--", ".", EXCLUDE_VOUCH]) : git(proj, ["diff", "--cached", "--", ".", EXCLUDE_VOUCH]);
  if (!tracked && !hasCommits(proj)) tracked = git(proj, ["diff", "--", ".", EXCLUDE_VOUCH]);
  const untrackedList = git(proj, ["ls-files", "--others", "--exclude-standard"]).split("\n").map((s) => s.trim()).filter(Boolean).filter((f) => f !== ".vouch" && !f.startsWith(".vouch/"));
  const fileSet = /* @__PURE__ */ new Set();
  for (const line of tracked.split("\n")) {
    const m = line.match(/^\+\+\+ b\/(.+)$/);
    if (m) fileSet.add(m[1]);
  }
  let untrackedBlock = "";
  const fs3 = require("fs");
  const path3 = require("path");
  for (const f of untrackedList) {
    fileSet.add(f);
    try {
      const full = path3.join(proj, f);
      const stat = fs3.statSync(full);
      if (stat.isDirectory() || stat.size > 256 * 1024) continue;
      const content = fs3.readFileSync(full, "utf8").split("\n").slice(0, MAX_UNTRACKED_FILE_LINES);
      untrackedBlock += `
=== new file: ${f} ===
${content.join("\n")}
`;
    } catch {
    }
  }
  let patch = tracked + (untrackedBlock ? `
--- untracked files ---${untrackedBlock}` : "");
  let truncated = false;
  const lines = patch.split("\n");
  if (lines.length > MAX_PATCH_LINES) {
    patch = lines.slice(0, MAX_PATCH_LINES).join("\n") + `
... [diff truncated at ${MAX_PATCH_LINES} lines] ...`;
    truncated = true;
  }
  const hash = patch ? (0, import_crypto2.createHash)("sha1").update(patch).digest("hex").slice(0, 16) : "";
  return { patch, files: [...fileSet], hash, truncated, isGit: true };
}

// src/core/dismissals.ts
function loadDismissals(proj) {
  return readJSON(dismissalsPath(proj), []);
}
function filterDismissed(findings, dismissals) {
  const set = new Set(dismissals.map((d) => d.fingerprint));
  return findings.filter((f) => !set.has(f.id));
}

// src/core/prioritize.ts
function clip(s, n) {
  if (!s) return "";
  const t = s.trim();
  return t.length > n ? t.slice(-n) : t;
}
function buildFixPrompt(blocking, questions, roundInfo, notices = []) {
  const parts = [];
  parts.push(
    "Vouch (automatic verification) checked your change and it is not done yet." + (roundInfo ? ` ${roundInfo}` : "")
  );
  if (blocking.length) {
    parts.push("\n## Must fix \u2014 verified failures");
    blocking.forEach((f, i) => {
      const lines = [`${i + 1}. ${f.title}` + (f.command ? ` \u2014 \`${f.command}\`` : "")];
      if (f.file) lines.push(`   file: ${f.file}${f.line ? `:${f.line}` : ""}`);
      const evidence = clip(f.detail, 1400);
      if (evidence) lines.push("   ```\n" + evidence.split("\n").map((l) => "   " + l).join("\n") + "\n   ```");
      lines.push(`   (vouch id: ${f.id})`);
      parts.push(lines.join("\n"));
    });
  }
  if (notices.length) {
    parts.push("\n## Also failing \u2014 not blocking, but worth fixing");
    notices.forEach((f) => {
      parts.push(`- ${f.title}${f.command ? ` \u2014 \`${f.command}\`` : ""} (vouch id: ${f.id})`);
    });
  }
  if (questions.length) {
    parts.push("\n## Questions \u2014 uncertain, please confirm (do NOT assume these are bugs)");
    questions.forEach((f) => {
      const d = clip(f.detail, 500);
      parts.push(`- [${f.tier}] ${f.title}${d ? `
  ${d.replace(/\n/g, "\n  ")}` : ""}
  (vouch id: ${f.id})`);
    });
  }
  parts.push(
    '\nFix the "Must fix" items, then finish. For any item that is actually a non-issue, call the `dismiss_finding` tool (from the `vouch` MCP server) with its vouch id and a one-line reason \u2014 Vouch will then never raise it again.'
  );
  return parts.join("\n");
}
function summaryLine(blocking, questions, notices = []) {
  if (!blocking.length && !questions.length && !notices.length) return "Vouch: \u2713 verification passed";
  const bits = [];
  if (blocking.length) bits.push(`${blocking.length} blocking`);
  if (notices.length) bits.push(`${notices.length} non-blocking failure${notices.length === 1 ? "" : "s"}`);
  if (questions.length) bits.push(`${questions.length} question${questions.length === 1 ? "" : "s"}`);
  return `Vouch: ${bits.join(", ")}`;
}

// src/core/pipeline.ts
var defaultDeps = {
  runTier,
  reviewIntent,
  reviewerAvailable,
  workingDiff
};
var TIER_ORDER = ["typecheck", "lint", "build", "test"];
async function runPipeline(opts) {
  const deps = { ...defaultDeps, ...opts.deps ?? {} };
  const { proj, cfg, intent } = opts;
  const startedAt = Date.now();
  const overBudget = () => (Date.now() - startedAt) / 1e3 > cfg.budgetSec;
  const ranTiers = [];
  const skipped = [];
  let findings = [];
  const diff = deps.workingDiff(proj);
  const diffEmpty = !diff.patch;
  if (diffEmpty && !opts.force) {
    return {
      diffEmpty: true,
      ranTiers,
      skipped,
      findings: [],
      blocking: [],
      questions: [],
      notices: [],
      fixPrompt: "",
      summary: "Vouch: no changes to verify"
    };
  }
  let compileBroken = false;
  for (const tier of TIER_ORDER) {
    const rc = cfg.commands[tier];
    if (!cfg.tiers[tier]) continue;
    if (!rc || !rc.enabled || !rc.cmd) continue;
    if (compileBroken) {
      skipped.push({ tier, reason: "skipped \u2014 a compile-class check (typecheck/build) already failed" });
      continue;
    }
    if (overBudget()) {
      skipped.push({ tier, reason: `time budget (${cfg.budgetSec}s) reached` });
      continue;
    }
    const blocking2 = cfg.enforcement.block && cfg.enforcement.blockOn.includes(tier);
    const run = await deps.runTier(tier, rc, proj, cfg.commandTimeoutSec * 1e3, blocking2);
    ranTiers.push(tier);
    if (run.skippedReason) {
      skipped.push({ tier, reason: run.skippedReason });
      continue;
    }
    if (run.finding) {
      findings.push(run.finding);
      if (tier === "typecheck" || tier === "build") compileBroken = true;
    }
  }
  const hasBlockingFact = findings.some((f) => f.kind === "blocking");
  if (!cfg.tiers.intent) {
    skipped.push({ tier: "intent", reason: "intent tier disabled" });
  } else if (compileBroken || hasBlockingFact) {
    skipped.push({ tier: "intent", reason: "deferred \u2014 fix the verified failures first" });
  } else if (!intent) {
    skipped.push({ tier: "intent", reason: "no active intent captured (run /vouch:intent)" });
  } else if (!diff.isGit) {
    skipped.push({ tier: "intent", reason: "not a git repo \u2014 cannot scope a diff to review" });
  } else if (!deps.reviewerAvailable()) {
    skipped.push({ tier: "intent", reason: "`claude` CLI not available for the independent reviewer" });
  } else if (overBudget()) {
    skipped.push({ tier: "intent", reason: `time budget (${cfg.budgetSec}s) reached before intent review` });
  } else {
    ranTiers.push("intent");
    const reviewFindings = await deps.reviewIntent({ proj, intent, patch: diff.patch, truncated: diff.truncated, cfg });
    findings.push(...reviewFindings);
  }
  if (cfg.tiers.smoke) {
    skipped.push({ tier: "smoke", reason: "web smoke tier is experimental and not yet available in this build" });
  }
  findings = dedupe(filterDismissed(findings, loadDismissals(proj)));
  const blocking = findings.filter((f) => f.kind === "blocking");
  const questions = findings.filter((f) => f.kind === "question");
  const notices = findings.filter((f) => f.kind === "info");
  const fixPrompt = blocking.length ? buildFixPrompt(blocking, questions, opts.roundInfo, notices) : "";
  return {
    diffEmpty,
    ranTiers,
    skipped,
    findings,
    blocking,
    questions,
    notices,
    fixPrompt,
    summary: summaryLine(blocking, questions, notices)
  };
}

// src/core/runState.ts
var fs2 = __toESM(require("fs"));
function loadState(proj) {
  return readJSON(statePath(proj), { lastDiffHash: null, iteration: 0 });
}
function saveState(proj, state) {
  fs2.mkdirSync(runsDir(proj), { recursive: true });
  writeJSON(statePath(proj), state);
}
function isDirty(proj) {
  try {
    return fs2.existsSync(dirtyPath(proj)) && fs2.statSync(dirtyPath(proj)).size > 0;
  } catch {
    return false;
  }
}
function clearDirty(proj) {
  try {
    if (fs2.existsSync(dirtyPath(proj))) fs2.rmSync(dirtyPath(proj));
  } catch {
  }
}
function markDirty(proj) {
  fs2.mkdirSync(runsDir(proj), { recursive: true });
  fs2.appendFileSync(dirtyPath(proj), `${Date.now()}
`);
}

// src/cli.ts
var path2 = __toESM(require("path"));
function resolveProj(stdinObj) {
  return process.env.VOUCH_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || (stdinObj && typeof stdinObj.cwd === "string" ? stdinObj.cwd : "") || process.cwd();
}
function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => data += c);
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
    setTimeout(() => resolve(data), 2e3);
  });
}
function printHookJSON(obj) {
  process.stdout.write(JSON.stringify(obj));
}
function writeFindingsLog(proj, result) {
  try {
    writeJSON(findingsLogPath(proj), {
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      summary: result.summary,
      blocking: result.blocking,
      questions: result.questions,
      notices: result.notices,
      skipped: result.skipped,
      ranTiers: result.ranTiers
    });
  } catch {
  }
}
function looksLikeProject(proj) {
  return exists(path2.join(proj, ".git")) || exists(path2.join(proj, "package.json")) || exists(path2.join(proj, "pyproject.toml")) || exists(path2.join(proj, "requirements.txt")) || exists(path2.join(proj, "Makefile"));
}
async function stopHook() {
  const input = await readStdin();
  let hook = {};
  try {
    hook = JSON.parse(input);
  } catch {
  }
  const proj = resolveProj(hook);
  const cfg = loadConfig(proj);
  if (!cfg) return;
  if (exists(offPath(proj))) return;
  const state = loadState(proj);
  const diff = workingDiff(proj);
  const dirty = isDirty(proj);
  if (!diff.patch) {
    clearDirty(proj);
    saveState(proj, { lastDiffHash: diff.hash || null, iteration: 0 });
    return;
  }
  if (!dirty && diff.hash === state.lastDiffHash) return;
  const stopActive = !!hook.stop_hook_active;
  if (cfg.enforcement.block && stopActive && state.iteration >= cfg.enforcement.maxIterations) {
    const result2 = await runPipeline({ proj, cfg, intent: loadActiveIntent(proj) });
    writeFindingsLog(proj, result2);
    clearDirty(proj);
    saveState(proj, { lastDiffHash: diff.hash || null, iteration: 0 });
    printHookJSON({
      systemMessage: `Vouch: released after ${cfg.enforcement.maxIterations} fix rounds \u2014 ${result2.blocking.length} issue(s) still unresolved. Run /vouch:status for details.`
    });
    return;
  }
  const round = state.iteration + 1;
  const result = await runPipeline({
    proj,
    cfg,
    intent: loadActiveIntent(proj),
    roundInfo: `(verification round ${round}/${cfg.enforcement.maxIterations})`
  });
  writeFindingsLog(proj, result);
  if (cfg.enforcement.block && result.blocking.length) {
    saveState(proj, { lastDiffHash: state.lastDiffHash, iteration: round });
    printHookJSON({
      decision: "block",
      reason: result.fixPrompt,
      systemMessage: `${result.summary} \u2014 blocking (round ${round}/${cfg.enforcement.maxIterations})`
    });
    return;
  }
  clearDirty(proj);
  saveState(proj, { lastDiffHash: diff.hash || null, iteration: 0 });
  printHookJSON({ systemMessage: result.summary });
}
function sessionContext() {
  const proj = resolveProj();
  const cfg = loadConfig(proj);
  if (!cfg) {
    if (looksLikeProject(proj)) {
      process.stdout.write(
        "[Vouch] installed but not set up for this repo. Run /vouch:setup to auto-detect how to run your checks and enable automatic verification (takes ~10s)."
      );
    }
    return;
  }
  const lines = [
    "[Vouch] active here: when you finish a change, Vouch automatically runs the project checks and an independent intent review, and will ask you to fix verified failures before stopping."
  ];
  const intent = loadActiveIntent(proj);
  if (intent) {
    lines.push(`
Active intent: ${intent.summary}`);
    if (intent.acceptance_criteria.length) {
      lines.push("Acceptance criteria:");
      intent.acceptance_criteria.forEach((c, i) => lines.push(`  ${i + 1}. ${c}`));
    }
  }
  const conv = readText(conventionsPath(proj)).trim();
  if (conv) lines.push(`
Project conventions (from Vouch memory):
${conv.slice(0, 2e3)}`);
  process.stdout.write(lines.join("\n"));
}
async function verifyManual() {
  const proj = resolveProj();
  const cfg = loadConfig(proj);
  if (!cfg) {
    process.stdout.write("Vouch is not set up for this repo. Run /vouch:setup first.\n");
    return;
  }
  const result = await runPipeline({ proj, cfg, intent: loadActiveIntent(proj), force: true });
  writeFindingsLog(proj, result);
  const out = [result.summary];
  out.push(`ran: ${result.ranTiers.join(", ") || "(none)"}`);
  if (result.skipped.length) out.push(`skipped: ${result.skipped.map((s) => `${s.tier} (${s.reason})`).join("; ")}`);
  if (result.fixPrompt) {
    out.push("\n" + result.fixPrompt);
  } else {
    if (result.notices.length) {
      out.push("\nNon-blocking failures:");
      result.notices.forEach((n) => out.push(`- [${n.tier}] ${n.title}${n.command ? ` \u2014 ${n.command}` : ""} (id: ${n.id})`));
    }
    if (result.questions.length) {
      out.push("\nOpen questions:");
      result.questions.forEach((q) => out.push(`- [${q.tier}] ${q.title} (id: ${q.id})`));
    }
  }
  process.stdout.write(out.join("\n") + "\n");
}
async function main() {
  const sub = process.argv[2];
  try {
    if (sub === "stop-hook") await stopHook();
    else if (sub === "session-context") sessionContext();
    else if (sub === "verify") await verifyManual();
    else if (sub === "mark-dirty") markDirty(resolveProj());
    else process.stdout.write(`vouch cli: unknown subcommand "${sub ?? ""}"
`);
  } catch {
  }
  process.exit(0);
}
main();
