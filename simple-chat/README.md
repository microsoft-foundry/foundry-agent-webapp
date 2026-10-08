# Simple local chat

A lightweight chat UI for the Foundry agent or workflow configured in the azd environment (`AI_AGENT_ENDPOINT`, `AI_AGENT_ID`). It runs on your machine with your own `az login`. It needs no Entra app registration, no role assignments, and no Azure deployment, unlike the main app (`azd up`).

Requires Node.js 18+ and the Azure CLI, signed in to an account with access to the Foundry project. It has no npm dependencies.

```powershell
cd simple-chat
node server.mjs            # then open http://localhost:3000
```

The server listens on `127.0.0.1` only. It has no login and calls Foundry with your credentials, so don't expose it.

## Rate limiting

All chats and batch runs share one queue:

- **One run at a time.**
- **Rolling 60-second token budget.** Before each run, the server reserves an estimated cost: the largest of the last 5 runs, or `INITIAL_TOKEN_ESTIMATE` before any run has finished. It waits until the last 60 seconds of usage plus that estimate fits under `TPM_BUDGET`, then records the real usage once the run finishes.
- **Runs-per-minute cap.**
- **Cooldown after a throttled run.** If a run comes back with no output from any agent and 0 tokens, the deployment throttled it anyway, so the server blocks the next 60 seconds. Workflows also report 0 tokens when an agent refuses a request. Those runs are charged at the estimate and don't trigger the cooldown.

| Env var | Default | Meaning |
|---|---|---|
| `TPM_BUDGET` | 400000 | Keep below the model deployment's tokens-per-minute limit |
| `RUNS_PER_MINUTE` | 30 | Each workflow run makes about 3–4 model calls; keep `RUNS_PER_MINUTE × 4` below the deployment's requests-per-minute limit |
| `INITIAL_TOKEN_ESTIMATE` | 30000 | Assumed cost of the first run |
| `AI_AGENT_VERSION` | latest | Pin a specific agent/workflow version |
| `PORT` | 3000 | |

The defaults assume the gpt-4.1 deployment at 500,000 TPM / 500 RPM. If you change its capacity, set `TPM_BUDGET` to about 80% of the new limit, for example `$env:TPM_BUDGET=40000; node server.mjs` for 50,000 TPM.

## Logs and batch runs

Every exchange is appended to `logs/chat-<date>.jsonl`. Each entry records the input, the final answer, every inner agent's raw output, the workflow steps, token usage, and any error.

For adversarial test sets, start the server and then run:

```powershell
node run-batch.mjs prompts.txt
```

`prompts.txt` has one test per line:
- **Plain text:** a single-turn test in a new conversation.
- **JSON** such as `{"tag":"...","prompt":"...","followups":["..."]}`: a multi-turn test, with the follow-ups sent in the same conversation.

Results are written to `logs/batch-<timestamp>.csv` and `.jsonl`.
