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

// src/eval/run.ts
var fs6 = __toESM(require("fs"));
var os = __toESM(require("os"));
var path7 = __toESM(require("path"));
var import_child_process4 = require("child_process");

// src/eval/cases.ts
var CASES = [
  {
    name: "bad-missing-upper-clamp",
    bucket: "bad",
    expect: "flag",
    intent: { summary: "clamp(n) bounds its input to the inclusive range 0..100.", acceptance_criteria: ["returns 0 when n < 0", "returns 100 when n > 100", "returns n unchanged when 0<=n<=100"] },
    baseline: { "clamp.js": "function clamp(n){ return n; }\nmodule.exports={clamp};\n" },
    change: { "clamp.js": "function clamp(n){ if (n < 0) return 0; return n; }\nmodule.exports={clamp};\n" }
  },
  {
    name: "bad-no-negative-rejection",
    bucket: "bad",
    expect: "flag",
    intent: { summary: "parseAmount(s) parses a number and REJECTS negative amounts by returning null.", acceptance_criteria: ["returns the number for a valid non-negative amount", "returns null when the parsed amount is negative"] },
    baseline: { "amount.js": "function parseAmount(s){ return Number(s); }\nmodule.exports={parseAmount};\n" },
    change: { "amount.js": "function parseAmount(s){ const n = Number(s); if (Number.isNaN(n)) return null; return n; }\nmodule.exports={parseAmount};\n" }
  },
  {
    name: "good-full-clamp",
    bucket: "good",
    expect: "clean",
    intent: { summary: "clamp(n) bounds its input to the inclusive range 0..100.", acceptance_criteria: ["returns 0 when n < 0", "returns 100 when n > 100", "returns n unchanged when 0<=n<=100"] },
    baseline: { "clamp.js": "function clamp(n){ return n; }\nmodule.exports={clamp};\n" },
    change: { "clamp.js": "function clamp(n){ if (n < 0) return 0; if (n > 100) return 100; return n; }\nmodule.exports={clamp};\n" }
  },
  {
    name: "good-simple-sum",
    bucket: "good",
    expect: "clean",
    intent: { summary: "add(a,b) returns the sum of a and b.", acceptance_criteria: ["add(2,3) === 5", "handles negative numbers"] },
    baseline: { "add.js": "module.exports={};\n" },
    change: { "add.js": "function add(a,b){ return a + b; }\nmodule.exports={add};\n" }
  },
  {
    name: "hardneg-intentional-empty-catch",
    bucket: "hardneg",
    expect: "clean",
    intent: { summary: "readConfig() returns parsed JSON config, or {} if the file is missing or invalid.", acceptance_criteria: ["returns the parsed object when the file is valid JSON", "returns {} when the file is missing or invalid (never throws)"], non_goals: ["logging the error"] },
    baseline: { "config.js": 'const fs=require("fs");\nfunction readConfig(){ return JSON.parse(fs.readFileSync("c.json","utf8")); }\nmodule.exports={readConfig};\n' },
    change: { "config.js": 'const fs=require("fs");\nfunction readConfig(){\n  try { return JSON.parse(fs.readFileSync("c.json","utf8")); }\n  catch { return {}; } // missing/invalid \u2192 default, by design\n}\nmodule.exports={readConfig};\n' }
  },
  {
    name: "hardneg-order-unusual-but-correct",
    bucket: "hardneg",
    expect: "clean",
    intent: { summary: 'isValid(s) returns true only for a non-empty string containing "@".', acceptance_criteria: ['true for "a@b"', 'false for "" and for a string without @'], non_goals: ["full RFC email validation", "trimming whitespace", "null handling"] },
    baseline: { "valid.js": "module.exports={};\n" },
    change: { "valid.js": 'function isValid(s){ return s.length > 0 && s.includes("@"); }\nmodule.exports={isValid};\n' }
  }
];

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
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));

// src/core/review/backends/spawn.ts
var import_child_process2 = require("child_process");
function cliOnPath(bin) {
  try {
    (0, import_child_process2.execFileSync)(bin, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
function runCLI(bin, args, cwd, timeoutSec) {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    let timedOut = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    let child;
    try {
      child = (0, import_child_process2.spawn)(bin, args, {
        cwd,
        env: { ...process.env, VOUCH_DISABLE: "1" },
        stdio: ["ignore", "pipe", "ignore"]
      });
    } catch {
      done(null);
      return;
    }
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
    }, timeoutSec * 1e3);
    child.stdout?.on("data", (d) => stdout += d.toString());
    const debug = (code) => {
      if (!process.env.VOUCH_DEBUG) return;
      try {
        require("fs").appendFileSync(
          "/tmp/vouch-reviewer-debug.log",
          `
=== ${bin} ${args.slice(0, 2).join(" ")} | code=${code} timedOut=${timedOut} len=${stdout.length} ===
${stdout.slice(0, 3e3)}
`
        );
      } catch {
      }
    };
    child.on("error", () => {
      clearTimeout(timer);
      debug(null);
      done(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      debug(code);
      done({ stdout, code, timedOut });
    });
  });
}

// src/core/review/backends/claude.ts
var claudeBackend = {
  name: "claude",
  available: () => cliOnPath("claude"),
  async run(req) {
    const allowed = req.allowedTools ?? ["Read", "Grep", "Glob"];
    const args = [
      "-p",
      req.userPrompt,
      "--output-format",
      "json",
      "--allowedTools",
      ...allowed,
      "--append-system-prompt",
      req.systemPrompt,
      "--max-turns",
      String(req.maxTurns ?? 8)
    ];
    if (req.model) args.push("--model", req.model);
    const res = await runCLI("claude", args, req.cwd, req.timeoutSec);
    if (!res || res.timedOut) return null;
    try {
      const env = JSON.parse(res.stdout);
      if (typeof env?.result === "string") return { text: env.result, isError: !!env.is_error };
    } catch {
    }
    return null;
  }
};

// src/core/review/backends/codex.ts
var codexBackend = {
  name: "codex",
  available: () => cliOnPath("codex"),
  async run(req) {
    const prompt = `${req.systemPrompt}

${req.userPrompt}`;
    const args = ["exec", "--sandbox", "read-only", "--skip-git-repo-check", prompt];
    const res = await runCLI("codex", args, req.cwd, req.timeoutSec);
    if (!res || res.timedOut) return null;
    return { text: res.stdout, isError: res.code !== 0 };
  }
};

// src/core/review/backends/cursor.ts
var cursorBackend = {
  name: "cursor",
  available: () => cliOnPath("cursor-agent"),
  async run(req) {
    const prompt = `${req.systemPrompt}

${req.userPrompt}`;
    const args = ["-p", prompt, "--output-format", "json", "--trust"];
    const res = await runCLI("cursor-agent", args, req.cwd, req.timeoutSec);
    if (!res || res.timedOut) return null;
    try {
      const env = JSON.parse(res.stdout);
      if (typeof env?.result === "string") return { text: env.result, isError: !!env.is_error };
    } catch {
    }
    return null;
  }
};

// src/core/review/backends/api.ts
function provider(apiKeyEnv) {
  return /openai/i.test(apiKeyEnv) ? "openai" : "anthropic";
}
var apiBackend = {
  name: "api",
  available(cfg) {
    const env = cfg.reviewer.apiKeyEnv;
    return !!(env && process.env[env]);
  },
  async run(req, cfg) {
    const envName = cfg.reviewer.apiKeyEnv;
    if (!envName) return null;
    const key = process.env[envName];
    if (!key) return null;
    const kind = provider(envName);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutSec * 1e3);
    try {
      if (kind === "anthropic") {
        const r2 = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: req.model || "claude-haiku-4-5",
            max_tokens: 2048,
            system: req.systemPrompt,
            messages: [{ role: "user", content: req.userPrompt }]
          }),
          signal: controller.signal
        });
        if (!r2.ok) return null;
        const j2 = await r2.json();
        const text2 = j2?.content?.map((c) => c.text).filter(Boolean).join("\n") ?? "";
        return { text: text2, isError: false };
      }
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: req.model || "gpt-5",
          messages: [
            { role: "system", content: req.systemPrompt },
            { role: "user", content: req.userPrompt }
          ]
        }),
        signal: controller.signal
      });
      if (!r.ok) return null;
      const j = await r.json();
      const text = j?.choices?.[0]?.message?.content ?? "";
      return { text, isError: false };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
};

// src/core/review/backends/json.ts
function extractJSON(text) {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const firstObj = t.indexOf("{");
  const firstArr = t.indexOf("[");
  const start = firstArr >= 0 && (firstObj < 0 || firstArr < firstObj) ? firstArr : firstObj;
  if (start >= 0) {
    const lastObj = t.lastIndexOf("}");
    const lastArr = t.lastIndexOf("]");
    const end = Math.max(lastObj, lastArr);
    if (end > start) t = t.slice(start, end + 1);
  }
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

// src/core/review/backends/index.ts
var BACKENDS = {
  claude: claudeBackend,
  codex: codexBackend,
  cursor: cursorBackend,
  api: apiBackend
};
var AUTO_ORDER = ["claude", "codex", "cursor"];
var resolveCache = /* @__PURE__ */ new Map();
function cacheKey(cfg) {
  return `${cfg.reviewer.backend ?? "auto"}|${process.env.VOUCH_HOST ?? ""}|${cfg.reviewer.apiKeyEnv ?? ""}`;
}
function resolveBackend(cfg, backends = BACKENDS) {
  const key = cacheKey(cfg);
  if (resolveCache.has(key)) return resolveCache.get(key);
  let chosen = null;
  const explicit = cfg.reviewer.backend;
  if (explicit && explicit !== "auto") {
    const b = backends[explicit];
    chosen = b && b.available(cfg) ? b : null;
  } else {
    const order = [];
    const host = process.env.VOUCH_HOST;
    if (host && backends[host]) order.push(host);
    for (const n of AUTO_ORDER) if (!order.includes(n)) order.push(n);
    for (const n of order) {
      if (backends[n].available(cfg)) {
        chosen = backends[n];
        break;
      }
    }
    if (!chosen && backends.api.available(cfg)) chosen = backends.api;
  }
  resolveCache.set(key, chosen);
  return chosen;
}
function backendAvailable(cfg, backends) {
  return resolveBackend(cfg, backends) != null;
}
async function runReviewer(req, cfg) {
  const backend = resolveBackend(cfg);
  if (!backend) return null;
  return backend.run(req, cfg);
}

// src/core/review/map.ts
var SYSTEM_PROMPT = [
  "You are an INDEPENDENT verification reviewer. You did NOT write this code and have no stake in it.",
  "Decide ONLY whether the change satisfies the stated INTENT and acceptance criteria, and surface concrete, grounded gaps.",
  "",
  "Hard rules (these keep you from crying wolf \u2014 violating them makes the tool useless):",
  "- CORRECTNESS SUPERSEDES cleanliness, minimality, and style. Never flag a correct change for being ugly, verbose, or unconventional.",
  "- Judge ONLY the shown change against the intent. Do NOT report pre-existing issues, style nits, missing tests, or speculative refactors.",
  "- Do NOT report anything that the project's own tests/types/build/lint already cover \u2014 that is handled separately.",
  "- If a requirement might be satisfied by code NOT shown, use your Read/Grep/Glob tools to check BEFORE reporting. If you still cannot prove a problem, ABSTAIN.",
  "- For EVERY finding you MUST copy a VERBATIM `evidence` snippet EXACTLY from the code shown (or a file you Read), with its file and line range. If you cannot quote exact offending code, DO NOT report it.",
  '- Prefer "question" severity. Use "blocking" only when you can name the exact unmet acceptance criterion AND quote the exact missing/contradicting code.',
  "",
  "Think first (a short `critique`), THEN emit findings. Output a SINGLE JSON object, no prose, no code fences:",
  '{"critique":"<1-3 sentences>","findings":[{"criterion":"<which acceptance criterion, or \\"general\\">","severity":"blocking"|"question","title":"<short>","detail":"<why, concretely>","file":"<path>","startLine":<int>,"endLine":<int>,"evidence":"<verbatim code copied exactly from what you were shown>","confidence":<0..1>}]}',
  "An empty findings array is the common, correct answer when the change matches the intent."
].join("\n");
function buildUserPrompt(intent, chunk) {
  const ac = intent.acceptance_criteria.length ? intent.acceptance_criteria.map((c, i) => `  ${i + 1}. ${c}`).join("\n") : "  (none specified)";
  const ng = intent.non_goals?.length ? intent.non_goals.map((c) => `  - ${c}`).join("\n") : "  (none)";
  return [
    "# INTENT",
    intent.summary,
    "",
    "## Acceptance criteria",
    ac,
    "",
    "## Non-goals (do NOT flag these as missing)",
    ng,
    "",
    `# CHANGE TO VERIFY \u2014 ${chunk.label}`,
    "(lines are shown with absolute line numbers; quote evidence exactly as shown)",
    "```diff",
    chunk.body || "(empty)",
    "```",
    "",
    "Return the JSON object now."
  ].join("\n");
}
function mapChunkFindings(raw, cfg) {
  const arr = Array.isArray(raw?.findings) ? raw.findings : Array.isArray(raw) ? raw : [];
  const canBlock = cfg.enforcement.block && cfg.enforcement.blockOn.includes("intent");
  const out = [];
  for (const r of arr) {
    if (!r || typeof r.title !== "string") continue;
    const severity = r.severity === "blocking" ? "blocking" : "question";
    const kind = severity === "blocking" && canBlock ? "blocking" : "question";
    const score = typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : 0.6;
    out.push(
      makeFinding({
        kind,
        tier: "intent",
        title: String(r.title).slice(0, 200),
        detail: [r.criterion ? `Criterion: ${r.criterion}` : "", r.detail ?? ""].filter(Boolean).join("\n"),
        file: typeof r.file === "string" ? r.file : void 0,
        line: typeof r.startLine === "number" ? r.startLine : void 0,
        confidence: severity === "blocking" ? "high" : "medium",
        // Fingerprint on tier+title+file only (NOT criterion): one issue reported
        // under two criteria must collapse to a single finding.
        fpExtra: []
      })
    );
    const f = out[out.length - 1];
    f.evidence = typeof r.evidence === "string" ? r.evidence : void 0;
    f.startLine = typeof r.startLine === "number" ? r.startLine : void 0;
    f.endLine = typeof r.endLine === "number" ? r.endLine : void 0;
    f.criterion = typeof r.criterion === "string" ? r.criterion : void 0;
    f.score = score;
  }
  return out;
}
async function reviewChunk(opts) {
  const res = await runReviewer(
    {
      cwd: opts.proj,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(opts.intent, opts.chunk),
      model: opts.cfg.reviewer.model,
      timeoutSec: opts.cfg.reviewer.timeoutSec,
      maxTurns: 8
    },
    opts.cfg
  );
  if (!res || res.isError) return [];
  const parsed = extractJSON(res.text);
  if (!parsed) return [];
  return mapChunkFindings(parsed, opts.cfg);
}

// src/core/review/reduce.ts
var KIND_RANK = { blocking: 2, question: 1, info: 0 };
function reduceFindings(findings) {
  return dedupe(findings).sort((a, b) => {
    if (KIND_RANK[a.kind] !== KIND_RANK[b.kind]) return KIND_RANK[b.kind] - KIND_RANK[a.kind];
    return (b.score ?? 0) - (a.score ?? 0);
  });
}

// src/core/review/groundGate.ts
function normalizeWs(s) {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}
function isGrounded(f) {
  return f.tier === "intent" || f.evidence !== void 0;
}
function groundFindings(findings, readFile) {
  const kept = [];
  const dropped = [];
  for (const f of findings) {
    if (!isGrounded(f)) {
      kept.push(f);
      continue;
    }
    if (!f.file) {
      dropped.push({ finding: f, reason: "no file cited" });
      continue;
    }
    const content = readFile(f.file);
    if (content == null) {
      dropped.push({ finding: f, reason: `cited file not readable (fabricated): ${f.file}` });
      continue;
    }
    const needle = f.evidence ? normalizeWs(f.evidence) : "";
    const verbatim = needle.length >= 3 && normalizeWs(content).includes(needle);
    kept.push({ ...f, evidenceVerbatim: verbatim });
  }
  return { kept, dropped };
}

// src/core/review/concurrency.ts
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit, items.length || 1));
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

// src/core/review/verify.ts
var VERIFIER_SYSTEM = [
  "You are a strict, skeptical code verifier. An automated reviewer SUSPECTS a problem in a code change.",
  "Your job: independently determine whether the problem is REAL by examining the actual code (use Read/Grep/Glob to check surrounding code, definitions, and whether the concern is already handled elsewhere).",
  'Bias strongly toward "NOT a real problem": only confirm if you can concretely demonstrate it from the code. If the requirement is satisfied elsewhere, or you cannot prove the problem, mark it not real.',
  "Do not be swayed by the reviewer's confidence. Reason from the code itself.",
  'Output a SINGLE JSON object, no prose: {"real": true|false, "reason": "<short, cite code>", "confidence": <0..1>}'
].join("\n");
function buildVerifierPrompt(finding, intent) {
  return [
    `# INTENT
${intent.summary}`,
    finding.criterion ? `
# RELEVANT ACCEPTANCE CRITERION
${finding.criterion}` : "",
    `
# SUSPECTED PROBLEM (verify or refute)
${finding.title}
${finding.detail ?? ""}`,
    finding.file ? `
# LOCATION
${finding.file}${finding.startLine ? `:${finding.startLine}-${finding.endLine ?? finding.startLine}` : ""}` : "",
    finding.evidence ? `
# CODE THE REVIEWER QUOTED
\`\`\`
${finding.evidence}
\`\`\`` : "",
    "\nExamine the real code and decide. Return the JSON verdict now."
  ].filter(Boolean).join("\n");
}
async function askOne(proj, finding, intent, cfg) {
  const res = await runReviewer(
    {
      cwd: proj,
      systemPrompt: VERIFIER_SYSTEM,
      userPrompt: buildVerifierPrompt(finding, intent),
      model: cfg.reviewer.model,
      timeoutSec: cfg.reviewer.timeoutSec,
      maxTurns: 6
    },
    cfg
  );
  if (!res || res.isError) return null;
  const parsed = extractJSON(res.text);
  if (!parsed || typeof parsed.real !== "boolean") return null;
  return parsed.real;
}
async function verifyFindings(findings, opts) {
  const ask = opts.deps?.askOne ?? askOne;
  const n = Math.max(1, opts.cfg.review.quorumN);
  const tasks = [];
  findings.forEach((_, fi) => {
    for (let v = 0; v < n; v++) tasks.push({ fi });
  });
  const votes = await mapLimit(
    tasks,
    opts.cfg.review.concurrency,
    (t) => ask(opts.proj, findings[t.fi], opts.intent, opts.cfg)
  );
  const kept = [];
  findings.forEach((f, fi) => {
    const mine = votes.filter((_, i) => tasks[i].fi === fi);
    const real = mine.filter((v) => v === true).length;
    const refuted = mine.filter((v) => v === false).length;
    const decided = real + refuted;
    const confirmed = decided === 0 ? false : real > refuted;
    const agreement = decided === 0 ? f.score ?? 0.5 : real / decided;
    if (decided === 0) {
      if (f.evidenceVerbatim) kept.push({ ...f, verified: false, score: f.score ?? 0.5 });
    } else if (confirmed && agreement >= opts.cfg.review.minConfidence) {
      kept.push({ ...f, verified: true, score: agreement });
    }
  });
  return kept;
}

// src/core/reviewer.ts
function reviewerAvailable(cfg) {
  return backendAvailable(cfg);
}
function fileReader(proj) {
  return (rel) => {
    try {
      return fs.readFileSync(path.join(proj, rel), "utf8");
    } catch {
      return null;
    }
  };
}
async function reviewIntent(opts) {
  const { proj, intent, cfg, chunks } = opts;
  if (!chunks.length) return [];
  const rc = opts.deps?.reviewChunk ?? reviewChunk;
  const vf = opts.deps?.verifyFindings ?? verifyFindings;
  const mapped = (await mapLimit(chunks, cfg.review.concurrency, (chunk) => rc({ proj, intent, chunk, cfg }))).flat();
  const reduced = reduceFindings(mapped);
  const grounded = groundFindings(reduced, fileReader(proj)).kept;
  if (grounded.length === 0) return grounded;
  if (cfg.mode === "fast") return grounded.filter((f) => f.evidenceVerbatim);
  return vf(grounded, { proj, intent, cfg });
}

// src/core/diff.ts
var import_child_process3 = require("child_process");
var import_crypto2 = require("crypto");
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
var EXCLUDE_VOUCH = ":(exclude).vouch";
var MAX_UNTRACKED_FILE_LINES = 800;
function git(proj, args) {
  try {
    return (0, import_child_process3.execFileSync)("git", args, {
      cwd: proj,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
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
function verifyRef(proj, ref) {
  try {
    (0, import_child_process3.execFileSync)("git", ["rev-parse", "--verify", "--quiet", ref], { cwd: proj, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
function resolveBase(proj, override) {
  if (!hasCommits(proj)) return "";
  const head = git(proj, ["rev-parse", "HEAD"]).trim();
  const candidates = override ? [override] : ["origin/HEAD", "origin/main", "origin/master", "main", "master", "develop"];
  for (const c of candidates) {
    if (!verifyRef(proj, c)) continue;
    const mb = git(proj, ["merge-base", "HEAD", c]).trim();
    if (mb && mb !== head) return mb;
  }
  return "HEAD";
}
function splitByFile(fcPatch) {
  if (!fcPatch.trim()) return [];
  const out = [];
  const parts = fcPatch.split(/^diff --git .*$/m);
  const headers = fcPatch.match(/^diff --git .*$/gm) ?? [];
  for (let i = 0; i < headers.length; i++) {
    const body = parts[i + 1] ?? "";
    const m = body.match(/^\+\+\+ b\/(.+)$/m) || headers[i].match(/ b\/(.+)$/);
    const file = (m ? m[1] : `file${i}`).trim();
    out.push({ file, patch: headers[i] + "\n" + body.replace(/^\n/, "") });
  }
  return out;
}
function countAdded(patch) {
  return (patch.match(/^\+(?!\+\+)/gm) ?? []).length;
}
function workingDiff(proj, baseOverride) {
  if (!isGitRepo(proj)) {
    return { patch: "", files: [], perFile: [], hash: "", isGit: false, base: "" };
  }
  const base = resolveBase(proj, baseOverride);
  const baseArgs = base ? [base] : [];
  const plain = git(proj, ["diff", ...baseArgs, "--", ".", EXCLUDE_VOUCH]);
  const fc = git(proj, ["diff", "--function-context", ...baseArgs, "--", ".", EXCLUDE_VOUCH]);
  const perFile = splitByFile(fc).filter((f) => f.file && !f.file.startsWith(".vouch/")).map((f) => ({ file: f.file, patch: f.patch, addedLines: countAdded(f.patch) }));
  const fileSet = new Set(perFile.map((f) => f.file));
  const untracked = git(proj, ["ls-files", "--others", "--exclude-standard"]).split("\n").map((s) => s.trim()).filter(Boolean).filter((f) => f !== ".vouch" && !f.startsWith(".vouch/"));
  for (const f of untracked) {
    fileSet.add(f);
    try {
      const full = path2.join(proj, f);
      const st = fs2.statSync(full);
      if (st.isDirectory() || st.size > 512 * 1024) continue;
      const lines = fs2.readFileSync(full, "utf8").split("\n").slice(0, MAX_UNTRACKED_FILE_LINES);
      const body = lines.map((l, i) => `${i + 1}: +${l}`).join("\n");
      perFile.push({ file: f, patch: `=== new file: ${f} ===
${body}`, addedLines: lines.length });
    } catch {
    }
  }
  const patch = plain + (untracked.length ? `
(untracked: ${untracked.join(", ")})` : "");
  const hash = patch ? (0, import_crypto2.createHash)("sha1").update(patch).digest("hex").slice(0, 16) : "";
  return { patch, files: [...fileSet], perFile, hash, isGit: true, base };
}

// src/core/review/chunk.ts
function numberPatch(patch) {
  if (patch.startsWith("=== new file:")) return patch;
  const out = [];
  let newLine = 0;
  for (const line of patch.split("\n")) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = parseInt(hunk[1], 10);
      out.push(line);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      out.push(`${newLine}: ${line}`);
      newLine++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      out.push(`   -${line.slice(1)}`);
    } else if (line.startsWith(" ")) {
      out.push(`${newLine}: ${line}`);
      newLine++;
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}
function rankFiles(files) {
  return [...files].sort((a, b) => b.addedLines - a.addedLines);
}
function splitHunks(patch) {
  const idx = patch.search(/^@@/m);
  if (idx < 0) return [patch];
  const header = patch.slice(0, idx);
  const rest = patch.slice(idx);
  const hunks = rest.split(/(?=^@@ )/m).filter(Boolean);
  return hunks.map((h, i) => i === 0 ? header + h : h);
}
function buildChunks(perFile, cfg) {
  const budgetChars = cfg.review.chunkTokenBudget * 4;
  const ranked = rankFiles(perFile);
  const included = ranked.slice(0, cfg.review.maxReviewFiles);
  const skippedFiles = ranked.slice(cfg.review.maxReviewFiles).map((f) => f.file);
  const clippedFiles = [];
  const chunks = [];
  for (const f of included) {
    const numbered = numberPatch(f.patch);
    if (numbered.length <= budgetChars) {
      chunks.push({ label: f.file, body: numbered });
      continue;
    }
    const hunks = splitHunks(f.patch).map(numberPatch);
    let buf = "";
    let part = 1;
    const flush = () => {
      if (buf) {
        chunks.push({ label: `${f.file} (part ${part})`, body: buf });
        part++;
        buf = "";
      }
    };
    for (let h of hunks) {
      if (h.length > budgetChars) {
        h = h.slice(0, budgetChars) + "\n\u2026 [hunk clipped: too large to review in full] \u2026";
        clippedFiles.push(f.file);
      }
      if (buf.length + h.length > budgetChars) flush();
      buf += (buf ? "\n" : "") + h;
    }
    flush();
  }
  return {
    chunks,
    includedFiles: included.map((f) => f.file),
    skippedFiles,
    clippedFiles: [...new Set(clippedFiles)]
  };
}

// src/core/workspaces.ts
var fs3 = __toESM(require("fs"));
var path3 = __toESM(require("path"));
function readJSON(file) {
  try {
    return JSON.parse(fs3.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function detectPackageManager(proj) {
  if (fs3.existsSync(path3.join(proj, "pnpm-lock.yaml"))) return "pnpm";
  if (fs3.existsSync(path3.join(proj, "yarn.lock"))) return "yarn";
  if (fs3.existsSync(path3.join(proj, "bun.lockb")) || fs3.existsSync(path3.join(proj, "bun.lock"))) return "bun";
  return "npm";
}
function expandGlob(proj, pattern) {
  const clean = pattern.replace(/\/\*\*$/, "/*");
  if (clean.endsWith("/*")) {
    const base = clean.slice(0, -2);
    const baseDir = path3.join(proj, base);
    try {
      return fs3.readdirSync(baseDir, { withFileTypes: true }).filter((d) => d.isDirectory() && fs3.existsSync(path3.join(baseDir, d.name, "package.json"))).map((d) => path3.join(base, d.name));
    } catch {
      return [];
    }
  }
  return fs3.existsSync(path3.join(proj, clean, "package.json")) ? [clean] : [];
}
function pkgFromDir(proj, dir) {
  const pj = readJSON(path3.join(proj, dir, "package.json"));
  return { name: pj?.name || path3.basename(dir) || "root", dir };
}
function detectWorkspaces(proj) {
  const pm = detectPackageManager(proj);
  const rootPkg = readJSON(path3.join(proj, "package.json"));
  let patterns = [];
  let tool = "none";
  const pnpmWs = path3.join(proj, "pnpm-workspace.yaml");
  if (fs3.existsSync(pnpmWs)) {
    tool = "pnpm";
    const txt = fs3.readFileSync(pnpmWs, "utf8");
    let inPkgs = false;
    for (const line of txt.split("\n")) {
      if (/^packages:/.test(line)) {
        inPkgs = true;
        continue;
      }
      if (inPkgs) {
        const m = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/);
        if (m) patterns.push(m[1]);
        else if (/^\S/.test(line)) break;
      }
    }
  }
  if (!patterns.length && rootPkg?.workspaces) {
    const ws = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : rootPkg.workspaces.packages;
    if (Array.isArray(ws)) {
      patterns = ws;
      tool = pm;
    }
  }
  if (fs3.existsSync(path3.join(proj, "nx.json"))) tool = "nx";
  else if (fs3.existsSync(path3.join(proj, "turbo.json"))) tool = "turbo";
  else if (fs3.existsSync(path3.join(proj, "lerna.json")) && tool === "none") tool = "lerna";
  const dirs = /* @__PURE__ */ new Set();
  for (const p of patterns) for (const d of expandGlob(proj, p)) dirs.add(d);
  if (!dirs.size) {
    const cargo = readCargoWorkspace(proj);
    if (cargo.length) return { isMonorepo: true, tool: "cargo", packageManager: pm, packages: cargo };
    if (fs3.existsSync(path3.join(proj, "go.work"))) return { isMonorepo: true, tool: "go", packageManager: pm, packages: [] };
  }
  const packages = [...dirs].sort().map((d) => pkgFromDir(proj, d));
  return { isMonorepo: packages.length > 0, tool: packages.length ? tool : "none", packageManager: pm, packages };
}
function readCargoWorkspace(proj) {
  const cargo = path3.join(proj, "Cargo.toml");
  if (!fs3.existsSync(cargo)) return [];
  const txt = fs3.readFileSync(cargo, "utf8");
  if (!/\[workspace\]/.test(txt)) return [];
  const m = txt.match(/members\s*=\s*\[([^\]]*)\]/);
  if (!m) return [];
  const members = [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
  const dirs = /* @__PURE__ */ new Set();
  for (const p of members) for (const d of expandGlob(proj, p)) dirs.add(d);
  return [...dirs].map((d) => ({ name: path3.basename(d), dir: d }));
}
function affectedPackages(changedFiles, packages) {
  const byDirLen = [...packages].sort((a, b) => b.dir.length - a.dir.length);
  const hit = /* @__PURE__ */ new Map();
  for (const f of changedFiles) {
    for (const p of byDirLen) {
      if (p.dir === "" || f === p.dir || f.startsWith(p.dir + "/")) {
        hit.set(p.dir, p);
        break;
      }
    }
  }
  return [...hit.values()];
}

// src/core/tia.ts
var fs4 = __toESM(require("fs"));
var path4 = __toESM(require("path"));
var ROOT_PATTERNS = [
  /(^|\/)package\.json$/,
  /(^|\/)[^/]*lock[^/]*$/i,
  /(^|\/)tsconfig[^/]*\.json$/,
  /(^|\/)(jest|vitest|vite|babel|tsup|rollup|webpack)\.config\.[cm]?[jt]s$/,
  /(^|\/)\.?eslintrc/,
  /(^|\/)(jest|vitest)\.setup\.[cm]?[jt]s$/
];
var CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
function detectRunner(cmd) {
  if (/\bvitest\b/.test(cmd)) return "vitest";
  if (/\bjest\b/.test(cmd)) return "jest";
  return null;
}
function viaScript(cmd) {
  return /^(npm|pnpm|yarn|bun)\b/.test(cmd.trim());
}
function selectTests(opts) {
  const { proj, testCmd, changedFiles, enabled } = opts;
  const full = (reason) => ({ command: testCmd, narrowed: false, selectedCount: null, reason });
  if (!enabled) return full("TIA disabled");
  const runner = detectRunner(testCmd);
  let effectiveRunner = runner;
  if (!effectiveRunner && viaScript(testCmd)) {
    try {
      const pj = JSON.parse(fs4.readFileSync(path4.join(proj, "package.json"), "utf8"));
      effectiveRunner = detectRunner(String(pj?.scripts?.test ?? ""));
    } catch {
    }
  }
  if (!effectiveRunner) return full("unrecognized test runner \u2192 full suite");
  if (changedFiles.some((f) => ROOT_PATTERNS.some((re) => re.test(f)))) {
    return full("a root/config file changed \u2192 full suite");
  }
  const sources = changedFiles.filter((f) => CODE_RE.test(f) && fs4.existsSync(path4.join(proj, f)));
  if (sources.length === 0) return full("no changed source files to target \u2192 full suite");
  const fileArgs = sources.map((f) => JSON.stringify(f)).join(" ");
  const pass = viaScript(testCmd) ? " --" : "";
  if (effectiveRunner === "jest") {
    return {
      command: `${testCmd}${pass} --findRelatedTests ${fileArgs} --passWithNoTests`,
      narrowed: true,
      selectedCount: sources.length,
      reason: `jest --findRelatedTests on ${sources.length} changed file(s)`
    };
  }
  if (effectiveRunner === "vitest") {
    if (viaScript(testCmd)) return full("vitest via package script cannot take the `related` subcommand \u2192 full suite");
    const withRelated = testCmd.replace(/\bvitest\b(\s+run)?/, `vitest related ${fileArgs}`);
    const command = /(^|\s)--run(\s|$)/.test(withRelated) ? withRelated : `${withRelated} --run`;
    return { command, narrowed: true, selectedCount: sources.length, reason: `vitest related on ${sources.length} changed file(s)` };
  }
  return full("cannot safely narrow this runner invocation \u2192 full suite");
}

// src/core/memory.ts
var fs5 = __toESM(require("fs"));
var path5 = __toESM(require("path"));
function vouchDir(proj) {
  return path5.join(proj, ".vouch");
}
function runsDir(proj) {
  return path5.join(vouchDir(proj), "runs");
}
function configPath(proj) {
  return path5.join(vouchDir(proj), "config.json");
}
function intentDir(proj) {
  return path5.join(vouchDir(proj), "intent");
}
function activeIntentPath(proj) {
  return path5.join(intentDir(proj), "active.json");
}
function dismissalsPath(proj) {
  return path5.join(vouchDir(proj), "dismissals.json");
}
function ensureVouchDir(proj) {
  fs5.mkdirSync(runsDir(proj), { recursive: true });
  fs5.mkdirSync(intentDir(proj), { recursive: true });
  const gi = path5.join(vouchDir(proj), ".gitignore");
  if (!fs5.existsSync(gi)) {
    fs5.writeFileSync(gi, "runs/\n");
  }
}
function readJSON2(file, fallback) {
  try {
    if (!fs5.existsSync(file)) return fallback;
    const raw = fs5.readFileSync(file, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function writeJSON(file, obj) {
  fs5.mkdirSync(path5.dirname(file), { recursive: true });
  fs5.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
}
function exists(file) {
  try {
    return fs5.existsSync(file);
  } catch {
    return false;
  }
}

// src/core/dismissals.ts
function loadDismissals(proj) {
  return readJSON2(dismissalsPath(proj), []);
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
  let budgetHit = false;
  let built = null;
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
  const changedFiles = diff.files;
  const ws = detectWorkspaces(proj);
  const scopedPkgs = ws.isMonorepo ? affectedPackages(changedFiles, ws.packages) : [];
  let testsSelected = null;
  const coverageNotes = [];
  if (ws.isMonorepo) coverageNotes.push(`monorepo (${ws.tool}); ${scopedPkgs.length} package(s) affected`);
  let compileBroken = false;
  for (const tier of TIER_ORDER) {
    let rc = cfg.commands[tier];
    if (!cfg.tiers[tier]) continue;
    if (!rc || !rc.enabled || !rc.cmd) continue;
    if (compileBroken) {
      skipped.push({ tier, reason: "skipped \u2014 a compile-class check (typecheck/build) already failed" });
      continue;
    }
    if (overBudget()) {
      budgetHit = true;
      skipped.push({ tier, reason: `time budget (${cfg.budgetSec}s) reached` });
      continue;
    }
    if (tier === "test" && cfg.tia.enabled && diff.isGit) {
      const tia = selectTests({ proj, testCmd: rc.cmd, changedFiles, enabled: true });
      if (tia.narrowed) {
        rc = { ...rc, cmd: tia.command };
        testsSelected = tia.selectedCount;
        coverageNotes.push(`tests: ${tia.reason}`);
      } else {
        coverageNotes.push(`tests: ${tia.reason}`);
      }
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
  } else if (!deps.reviewerAvailable(cfg)) {
    skipped.push({ tier: "intent", reason: "no reviewer backend available (claude/codex/cursor CLI or API key)" });
  } else if (overBudget()) {
    budgetHit = true;
    skipped.push({ tier: "intent", reason: `time budget (${cfg.budgetSec}s) reached before intent review` });
  } else {
    ranTiers.push("intent");
    built = buildChunks(diff.perFile, cfg);
    if (built.skippedFiles.length) {
      skipped.push({ tier: "intent", reason: `${built.skippedFiles.length} file(s) beyond maxReviewFiles not reviewed` });
    }
    const reviewFindings = await deps.reviewIntent({ proj, intent, cfg, chunks: built.chunks });
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
  const coverage = {
    filesChanged: diff.perFile.length,
    filesReviewed: built ? built.includedFiles.length : 0,
    filesSkippedTooLarge: built ? [...built.skippedFiles, ...built.clippedFiles] : [],
    chunksReviewed: built ? built.chunks.length : 0,
    packagesScoped: scopedPkgs.map((p) => p.name),
    testsSelected,
    budgetHit,
    notes: coverageNotes
  };
  return {
    diffEmpty,
    ranTiers,
    skipped,
    findings,
    blocking,
    questions,
    notices,
    fixPrompt,
    summary: summaryLine(blocking, questions, notices),
    coverage
  };
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
      timeoutSec: 90,
      backend: "auto"
    },
    // Default to max accuracy (per product decision): full map-reduce + N-vote
    // independent verification. Budget-bounded so a huge repo degrades honestly
    // rather than blowing the Stop-hook timeout.
    mode: "thorough",
    review: {
      concurrency: 4,
      quorumN: 3,
      chunkTokenBudget: 6e3,
      maxReviewFiles: 40,
      minConfidence: 0.5
    },
    tia: {
      enabled: true
    },
    commandTimeoutSec: 90,
    budgetSec: 240
  };
}
function saveConfig(proj, cfg) {
  ensureVouchDir(proj);
  writeJSON(configPath(proj), cfg);
}

// src/core/intent.ts
var path6 = __toESM(require("path"));
function loadActiveIntent(proj) {
  if (!exists(activeIntentPath(proj))) return null;
  const r = readJSON2(activeIntentPath(proj), null);
  if (!r || r.status !== "active") return null;
  return r;
}
function newId(nowISO) {
  const t = Date.parse(nowISO) || Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return `i_${t.toString(36)}_${rand}`;
}
function recordIntent(proj, input, nowISO) {
  ensureVouchDir(proj);
  const prev = loadActiveIntent(proj);
  if (prev) {
    prev.status = "archived";
    writeJSON(path6.join(intentDir(proj), `${prev.id}.json`), prev);
  }
  const record = {
    id: newId(nowISO),
    summary: input.summary.trim(),
    acceptance_criteria: (input.acceptance_criteria ?? []).map((s) => s.trim()).filter(Boolean),
    scope_globs: input.scope_globs?.map((s) => s.trim()).filter(Boolean),
    non_goals: input.non_goals?.map((s) => s.trim()).filter(Boolean),
    created: nowISO,
    status: "active"
  };
  writeJSON(activeIntentPath(proj), record);
  return record;
}

// src/eval/run.ts
var FP_GATE = 0.1;
var RECALL_FLOOR = 0.5;
function sh(proj, args) {
  (0, import_child_process4.execFileSync)("git", args, { cwd: proj, stdio: "ignore" });
}
function setupCase(c) {
  const proj = fs6.mkdtempSync(path7.join(os.tmpdir(), "vouch-eval-"));
  sh(proj, ["init", "-q"]);
  sh(proj, ["config", "user.email", "e@e.e"]);
  sh(proj, ["config", "user.name", "e"]);
  for (const [f, content] of Object.entries(c.baseline)) fs6.writeFileSync(path7.join(proj, f), content);
  sh(proj, ["add", "-A"]);
  sh(proj, ["commit", "-qm", "baseline"]);
  for (const [f, content] of Object.entries(c.change)) fs6.writeFileSync(path7.join(proj, f), content);
  const cfg = defaultConfig();
  cfg.tiers = { typecheck: false, lint: false, build: false, test: false, intent: true, smoke: false };
  const mode = process.env.VOUCH_EVAL_MODE || "bounded";
  cfg.mode = mode;
  if (mode === "bounded") cfg.review.quorumN = 1;
  cfg.reviewer.timeoutSec = 90;
  saveConfig(proj, cfg);
  recordIntent(proj, c.intent, (/* @__PURE__ */ new Date()).toISOString());
  return proj;
}
async function main() {
  const only = process.env.VOUCH_EVAL_ONLY;
  const cases = only ? CASES.filter((c) => c.name.includes(only)) : CASES;
  console.log(`Running ${cases.length} eval cases (mode=${process.env.VOUCH_EVAL_MODE || "bounded"})\u2026
`);
  let tp = 0, fp = 0, tn = 0, fn = 0;
  const rows = [];
  for (const c of cases) {
    const proj = setupCase(c);
    let flagged = false;
    let detail = "";
    try {
      const cfg = defaultConfig();
      cfg.tiers = { typecheck: false, lint: false, build: false, test: false, intent: true, smoke: false };
      cfg.mode = process.env.VOUCH_EVAL_MODE || "bounded";
      if (cfg.mode === "bounded") cfg.review.quorumN = 1;
      const intent = JSON.parse(fs6.readFileSync(path7.join(proj, ".vouch/intent/active.json"), "utf8"));
      const res = await runPipeline({ proj, cfg, intent, force: true });
      const surfaced = [...res.blocking, ...res.questions];
      flagged = surfaced.length > 0;
      detail = surfaced.map((f) => f.title).join("; ").slice(0, 80);
    } catch (e) {
      detail = "ERROR " + (e?.message ?? e);
    } finally {
      fs6.rmSync(proj, { recursive: true, force: true });
    }
    const correct = c.expect === "flag" === flagged;
    if (c.expect === "flag") flagged ? tp++ : fn++;
    else flagged ? fp++ : tn++;
    rows.push(`  ${correct ? "\u2705" : "\u274C"} [${c.bucket}] ${c.name} \u2192 ${flagged ? "FLAGGED" : "clean"}${detail ? `  (${detail})` : ""}`);
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const cleanTotal = fp + tn;
  const fpRate = cleanTotal === 0 ? 0 : fp / cleanTotal;
  const f1 = precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall);
  console.log(rows.join("\n"));
  console.log("\n\u2014 Confusion matrix \u2014");
  console.log(`  TP ${tp}  FP ${fp}  TN ${tn}  FN ${fn}`);
  console.log(`  precision ${(precision * 100).toFixed(0)}%  recall ${(recall * 100).toFixed(0)}%  F1 ${(f1 * 100).toFixed(0)}%`);
  console.log(`  effective false-positive rate ${(fpRate * 100).toFixed(0)}%  (gate: <${FP_GATE * 100}%)`);
  const pass = fpRate <= FP_GATE && recall >= RECALL_FLOOR;
  console.log(`
${pass ? "\u2705 PASS" : "\u274C FAIL"} \u2014 FP ${(fpRate * 100).toFixed(0)}% (\u2264${FP_GATE * 100}%), recall ${(recall * 100).toFixed(0)}% (\u2265${RECALL_FLOOR * 100}%)`);
  process.exit(pass ? 0 : 1);
}
main().catch((e) => {
  console.error("eval harness error:", e);
  process.exit(2);
});
