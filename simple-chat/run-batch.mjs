// Sends a list of prompts through the local chat server (so its rate limits apply)
// and writes the results to logs/batch-<timestamp>.jsonl and .csv.
//
// Usage: node run-batch.mjs prompts.txt [--server http://localhost:3000]
//
// Input format, one test per line (blank lines and lines starting with # are skipped):
//   plain text                         -> single-turn test in a new conversation
//   {"tag":"jailbreak-1","prompt":"...","followups":["...","..."]}
//                                      -> multi-turn test; followups go in the same conversation

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const serverIdx = args.indexOf('--server');
const server = serverIdx >= 0 ? args[serverIdx + 1] : 'http://localhost:3000';

if (!file) {
  console.error('Usage: node run-batch.mjs prompts.txt [--server http://localhost:3000]');
  process.exit(1);
}

const tests = (await readFile(file, 'utf8'))
  .split(/\r?\n/)
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#'))
  .map((l, i) => {
    if (l.startsWith('{')) {
      const t = JSON.parse(l);
      return { tag: t.tag ?? `test-${i + 1}`, turns: [t.prompt, ...(t.followups ?? [])] };
    }
    return { tag: `test-${i + 1}`, turns: [l] };
  });

async function send(conversationId, message, tag) {
  const res = await fetch(`${server}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, message, tag }),
  });
  if (!res.ok) throw new Error(`Server ${res.status}: ${await res.text()}`);

  const out = { conversationId, answer: '', inner: [], errors: [], usage: null, durationMs: null, waitedFor: null };
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const line = buffer.slice(0, idx); buffer = buffer.slice(idx + 2);
      if (!line.startsWith('data:')) continue;
      const ev = JSON.parse(line.slice(5));
      if (ev.type === 'conversation') out.conversationId = ev.conversationId;
      else if (ev.type === 'delta') out.answer += ev.text;
      else if (ev.type === 'inner') out.inner.push({ agent: ev.agent, text: ev.text });
      else if (ev.type === 'error') out.errors.push(ev.message);
      else if (ev.type === 'wait') out.waitedFor = ev.reason;
      else if (ev.type === 'done') { out.usage = ev.usage; out.durationMs = ev.durationMs; }
    }
  }
  return out;
}

const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await mkdir(join(ROOT, 'logs'), { recursive: true });
const jsonlPath = join(ROOT, 'logs', `batch-${stamp}.jsonl`);
const csvPath = join(ROOT, 'logs', `batch-${stamp}.csv`);

const rows = [];
const csv = [['tag', 'turn', 'prompt', 'answer', 'routed_to', 'tokens', 'seconds', 'errors'].join(',')];
console.log(`Running ${tests.length} test(s) against ${server}…`);

for (const test of tests) {
  let conversationId = null;
  for (const [turn, prompt] of test.turns.entries()) {
    process.stdout.write(`[${test.tag} turn ${turn + 1}] ${prompt.slice(0, 60)}… `);
    let r;
    try {
      r = await send(conversationId, prompt, test.tag);
    } catch (e) {
      r = { conversationId, answer: '', inner: [], errors: [e.message], usage: null, durationMs: null };
    }
    conversationId = r.conversationId;
    const routedTo = r.inner.map(i => i.agent).join(' > ');
    console.log(r.errors.length ? `ERROR: ${r.errors.join('; ')}` : `${r.usage?.total_tokens ?? 0} tokens, ${((r.durationMs ?? 0) / 1000).toFixed(1)}s`);
    rows.push({ tag: test.tag, turn: turn + 1, prompt, ...r });
    csv.push([test.tag, turn + 1, prompt, r.answer, routedTo, r.usage?.total_tokens ?? '', ((r.durationMs ?? 0) / 1000).toFixed(1), r.errors.join('; ')].map(csvCell).join(','));
    await writeFile(jsonlPath, rows.map(x => JSON.stringify(x)).join('\n') + '\n');
    await writeFile(csvPath, '﻿' + csv.join('\r\n') + '\r\n');
  }
}

console.log(`\nDone. Results:\n  ${csvPath}\n  ${jsonlPath}`);
