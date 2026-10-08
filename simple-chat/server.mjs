// Minimal local chat server for a Foundry agent or workflow.
// - Auth: your own `az login` (no Entra app registration, no Azure deployment)
// - Rate limiting: one run at a time + a rolling 60s token budget, so the model
//   deployment's tokens-per-minute (TPM) limit is never exceeded
// - Logging: every exchange (incl. inner workflow agents' raw output) to logs/*.jsonl
//
// Run: node server.mjs    then open http://localhost:3000

import http from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

// ---------- Config ----------
// Defaults come from the azd environment (.azure/<env>/.env); env vars override.
function loadAzdEnv() {
  try {
    const azureDir = join(ROOT, '..', '.azure');
    const { defaultEnvironment } = JSON.parse(readFileSync(join(azureDir, 'config.json'), 'utf8'));
    const vars = {};
    for (const line of readFileSync(join(azureDir, defaultEnvironment, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
      if (m) vars[m[1]] = m[2];
    }
    return vars;
  } catch {
    return {};
  }
}
const azd = loadAzdEnv();
const env = (name, fallback) => process.env[name] ?? azd[name] ?? fallback;

const CONFIG = {
  port: Number(env('PORT', 3000)),
  endpoint: env('AI_AGENT_ENDPOINT'),
  agent: env('AI_AGENT_ID'),
  agentVersion: env('AI_AGENT_VERSION', ''), // empty = latest
  // Keep below the deployment's TPM (gpt-4.1 here: 500,000) to leave headroom.
  tpmBudget: Number(env('TPM_BUDGET', 400000)),
  // Workflow runs per minute. Each run makes ~3-5 model calls; deployment RPM is 500.
  runsPerMinute: Number(env('RUNS_PER_MINUTE', 30)),
  // Assumed cost of a run before its real usage is known. A diagnosed apple question is ~25k.
  initialEstimate: Number(env('INITIAL_TOKEN_ESTIMATE', 30000)),
};

if (!CONFIG.endpoint || !CONFIG.agent) {
  console.error('AI_AGENT_ENDPOINT and AI_AGENT_ID must be set (or present in the azd environment).');
  process.exit(1);
}

// ---------- Azure token (from az CLI) ----------
let cachedToken = null; // { token, expiresAt }
function getToken() {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 5 * 60_000) return Promise.resolve(cachedToken.token);
  return new Promise((resolve, reject) => {
    execFile('az', ['account', 'get-access-token', '--resource', 'https://ai.azure.com', '-o', 'json'],
      { shell: true, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`az CLI token failed (run 'az login'): ${stderr || err.message}`));
        const t = JSON.parse(stdout);
        const expiresAt = t.expires_on ? Number(t.expires_on) * 1000 : Date.now() + 30 * 60_000;
        cachedToken = { token: t.accessToken, expiresAt };
        resolve(t.accessToken);
      });
  });
}

async function foundry(path, body) {
  const res = await fetch(`${CONFIG.endpoint}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Foundry ${res.status}: ${await res.text()}`);
  return res;
}

// ---------- Rate limiter ----------
// Ledger of token spend in the last 60s. A run reserves its estimated cost when it starts;
// the reservation is replaced by actual usage when it finishes.
const ledger = []; // { at, tokens, run? }
const recentRunCosts = [];
let chain = Promise.resolve();
let queued = 0;

const WINDOW_MS = 60_000;
function prune() {
  const cutoff = Date.now() - WINDOW_MS;
  while (ledger.length && ledger[0].at < cutoff) ledger.shift();
}
function tokensInWindow() { prune(); return ledger.reduce((s, e) => s + e.tokens, 0); }
function runsInWindow() { prune(); return ledger.filter(e => e.run).length; }
function estimate() {
  return recentRunCosts.length ? Math.max(...recentRunCosts.slice(-5)) : CONFIG.initialEstimate;
}
export function limiterStatus() {
  return {
    tokensUsedLastMinute: tokensInWindow(),
    tpmBudget: CONFIG.tpmBudget,
    runsLastMinute: runsInWindow(),
    runsPerMinute: CONFIG.runsPerMinute,
    nextRunEstimate: estimate(),
    queued,
  };
}

/** Waits for a free slot and token budget, then runs fn. onWait(seconds, reason) reports progress. */
function withRateLimit(fn, onWait) {
  queued++;
  const run = chain.then(async () => {
    for (;;) {
      const cost = Math.min(estimate(), CONFIG.tpmBudget);
      const overTokens = tokensInWindow() + cost > CONFIG.tpmBudget;
      const overRuns = runsInWindow() >= CONFIG.runsPerMinute;
      if (!overTokens && !overRuns) break;
      const waitMs = ledger.length ? Math.max(1000, ledger[0].at + WINDOW_MS - Date.now()) : 1000;
      onWait(Math.ceil(waitMs / 1000), overTokens ? 'token budget' : 'runs per minute');
      await new Promise(r => setTimeout(r, Math.min(waitMs, 2000)));
    }
    queued--;
    const reservation = { at: Date.now(), tokens: estimate(), run: true };
    ledger.push(reservation);
    try {
      const result = await fn();
      // Throttled anyway: block the next minute. Unknown usage (reported as 0): keep the estimate.
      const actual = result.usage?.total_tokens ?? 0;
      if (result.rateLimited) reservation.tokens = CONFIG.tpmBudget;
      else if (actual > 0) { reservation.tokens = actual; recentRunCosts.push(actual); }
      reservation.at = Date.now();
      return result;
    } catch (e) {
      reservation.at = Date.now();
      throw e;
    }
  });
  chain = run.catch(() => {});
  return run;
}

// ---------- Streaming a workflow run ----------
async function* sseEvents(res) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
      if (data && data !== '[DONE]') {
        try { yield JSON.parse(data); } catch { /* ignore partial/non-JSON */ }
      }
    }
  }
}

/**
 * Sends one message. Only text from the configured agent itself is shown as the answer;
 * inner workflow agents' messages are collected separately (shown in the debug panel + logs).
 */
async function runChat({ conversationId, message }, send) {
  const agentRef = { type: 'agent_reference', name: CONFIG.agent };
  if (CONFIG.agentVersion) agentRef.version = CONFIG.agentVersion;

  const res = await foundry('/openai/v1/responses', {
    agent_reference: agentRef, conversation: conversationId, input: message, stream: true,
  });

  const hidden = new Set();
  const inner = [];
  const steps = [];
  let answer = '';
  let usage = null;
  let failure = null;

  for await (const ev of sseEvents(res)) {
    const item = ev.item;
    switch (ev.type) {
      case 'response.output_item.added':
        if (item?.type === 'message' && item.agent_reference?.name && item.agent_reference.name !== CONFIG.agent) {
          hidden.add(item.id);
          send({ type: 'status', text: `${item.agent_reference.name} is responding…` });
        } else if (item?.type === 'workflow_action') {
          steps.push(item.action_id);
        } else if (item?.type === 'file_search_call') {
          send({ type: 'status', text: `${item.agent_reference?.name ?? 'Agent'} is searching documents…` });
        }
        break;
      case 'response.output_text.delta':
        if (!hidden.has(ev.item_id)) {
          answer += ev.delta;
          send({ type: 'delta', text: ev.delta });
        }
        break;
      case 'response.output_item.done':
        if (item?.type === 'message' && hidden.has(item.id)) {
          const text = (item.content ?? []).map(c => c.text ?? '').join('');
          inner.push({ agent: item.agent_reference.name, text });
          send({ type: 'inner', agent: item.agent_reference.name, text });
        }
        break;
      case 'response.completed':
        usage = ev.response?.usage ?? null;
        break;
      case 'response.failed':
      case 'error':
        failure = ev.response?.error?.message ?? ev.message ?? 'Workflow failed';
        break;
    }
  }

  // A throttled run has no inner agent output at all. Zero usage alone is not enough:
  // workflows also report 0 tokens when an agent refuses (e.g. a blocked jailbreak attempt).
  const rateLimited = !failure && (usage?.total_tokens ?? 0) === 0 && inner.length === 0;
  return { answer, inner, steps, usage, failure, rateLimited };
}

// ---------- HTTP ----------
await mkdir(join(ROOT, 'logs'), { recursive: true });
const logFile = () => join(ROOT, 'logs', `chat-${new Date().toISOString().slice(0, 10)}.jsonl`);

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || '{}');
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(await readFile(join(ROOT, 'public', 'index.html')));
    }
    if (req.method === 'GET' && req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ agent: CONFIG.agent, agentVersion: CONFIG.agentVersion || 'latest', ...limiterStatus() }));
    }
    if (req.method === 'POST' && req.url === '/api/chat') {
      const { conversationId: existing, message, tag } = await readJson(req);
      if (!message?.trim()) { res.writeHead(400); return res.end('message required'); }

      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      const started = Date.now();
      let conversationId = existing;
      let result = null;
      let error = null;

      try {
        if (!conversationId) {
          conversationId = (await (await foundry('/openai/v1/conversations', {})).json()).id;
        }
        send({ type: 'conversation', conversationId });
        if (queued > 0) send({ type: 'status', text: `Queued behind ${queued} other message(s)…` });

        result = await withRateLimit(
          () => { send({ type: 'status', text: 'Running workflow…' }); return runChat({ conversationId, message }, send); },
          (secs, reason) => send({ type: 'wait', seconds: secs, reason }));

        if (result.failure) send({ type: 'error', message: result.failure });
        if (result.rateLimited) send({ type: 'error', message: 'The model deployment rate limit was hit; the next message will wait ~60s.' });
        send({ type: 'done', usage: result.usage, durationMs: Date.now() - started });
      } catch (e) {
        error = e.message;
        send({ type: 'error', message: e.message });
      }
      res.end();

      await appendFile(logFile(), JSON.stringify({
        ts: new Date().toISOString(), tag, agent: CONFIG.agent, agentVersion: CONFIG.agentVersion || 'latest',
        conversationId, input: message, output: result?.answer ?? null, inner: result?.inner ?? [],
        steps: result?.steps ?? [], usage: result?.usage ?? null, durationMs: Date.now() - started,
        rateLimited: result?.rateLimited ?? false, error: error ?? result?.failure ?? null,
      }) + '\n');
      return;
    }
    res.writeHead(404); res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

// Bound to localhost only: there is no login, and it uses your Azure credentials.
server.listen(CONFIG.port, '127.0.0.1', () => {
  console.log(`Chat for ${CONFIG.agent} (version: ${CONFIG.agentVersion || 'latest'}) at http://localhost:${CONFIG.port}`);
  console.log(`Limits: ${CONFIG.tpmBudget} tokens/min, ${CONFIG.runsPerMinute} runs/min, one run at a time`);
  console.log(`Logs: ${join(ROOT, 'logs')}`);
});
