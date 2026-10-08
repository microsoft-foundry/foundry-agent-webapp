# Session Handoff: Kisan workflow, web app, and test harness

**Sessions covered:** 2026-10-06 to 2026-10-08
**Repo:** `D:\foundry-agent-webapp`, branch `feat/workflow-agent-support` (local only, not pushed)
**Purpose:** everything needed to resume this work in a new session. Read §1 and §2 first.

---

## 1. Resume in 60 seconds

```powershell
cd D:\foundry-agent-webapp
git checkout feat/workflow-agent-support
az account show            # if this fails: az login
cd simple-chat
node server.mjs            # open http://localhost:3000
```

**Pending items** (details in §11):
1. **Waiting on the user's decision:** show the product recommendation as a **table**. Option B (workflow v21 plus Markdown rendering in simple-chat) was recommended and awaits a yes.
2. **Uncommitted changes:** the new rate-limit defaults in `simple-chat/server.mjs` and `simple-chat/README.md`, and this `docs/session-handoff/` folder.
3. **Full web app deployment is blocked** until a subscription Owner grants the user **User Access Administrator**.

**Standing user rules:**
- **No pull requests.** Commit locally on the branch, and ask before pushing.
- **Never modify existing Foundry agent or workflow versions.** Always create a new version.

---

## 2. Current state

| Area | State |
|---|---|
| Foundry workflow `Kisan-Orchestrator` | **v20 is the latest** and works. v18 (the original) is untouched and broken; v19 is the fix without retry/fallback. |
| Inner agents (Router v9, protect-prevent v8, kcc-agent v6, product-recommendation-agent v12) | **Unchanged** |
| gpt-4.1 deployment | Capacity raised **50 → 500**: 500,000 tokens/min and 500 requests/min |
| `simple-chat/` local app | Works; committed. Default limits updated but **not committed**. |
| Main web app (`azd up`) | **Failed**: the user lacks `roleAssignments/write`. Partial resources exist in `rg-proj-kisan`. |
| Backend workflow filtering | Committed; all 52 tests pass. Not yet run end to end, because the app was never deployed. |
| Local machine | .NET 10 SDK, azd, PowerShell 7, Node 24, az CLI installed. NuGet source fixed. |

---

## 3. Environment and identifiers

| Item | Value |
|---|---|
| Azure subscription | `97b7ae1c-5e48-492e-b26b-48df994fa1e4` ("Microsoft Azure Sponsorship") |
| Tenant | `ccf09562-ae1e-40f3-add2-b95eebbd2a42` |
| Signed-in account | Guest account (`live.com#…`), **Contributor**; cannot create role assignments |
| Foundry resource | `proj-kisan` in resource group **`misa`**, region `eastus2` |
| Foundry project endpoint | `https://proj-kisan.services.ai.azure.com/api/projects/proj-kisan` |
| azd environment | `proj-kisan` (`.azure/proj-kisan/.env`): `AI_AGENT_ID=Kisan-Orchestrator`, `AZURE_LOCATION=eastus2` |
| App resource group (partial) | `rg-proj-kisan`, containing a managed identity, Log Analytics, 2× App Insights and a Container Apps env. **No Container App or ACR role.** |
| Model deployments in `proj-kisan` | `gpt-4.1` (GlobalStandard, capacity 500), `gpt-5` (50), `text-embedding-3-small` (120) |
| gpt-4.1 GlobalStandard quota in eastus2 | 9,000,000 TPM available (500,000 now used) |

**Tools on the machine:** az CLI, azd 1.35 (`%LOCALAPPDATA%\Programs\Azure Dev CLI\`), .NET SDK 10.0.401, Node v24.5, PowerShell 7.6 (Store version, `WindowsApps\pwsh.exe`), Docker, Windows PowerShell 5.1.

---

## 4. The Kisan workflow (how it works)

`Kisan-Orchestrator` is a **Foundry workflow agent** (`kind: workflow`) that chains these prompt agents:

```
User question
   └─► Router ............... returns {"route":"apple"|"kcc"}
         ├─ apple ─► protect-prevent (file search over apple docs)
         └─ kcc ───► kcc-agent (general farming / KCC knowledge)
               both return {status, diagnosis_name, display_message, answer{survey, fil_recommendation, …}}
   status == "DIAGNOSED" ─► product-recommendation-agent (Azure AI Search product catalog)
                              returns {has_recommendation, products_text}
   Final message = display_message (+ products_text)
   status != "DIAGNOSED" ─► final message = display_message (a clarifying question / not covered)
```

All agents use **gpt-4.1** with strict JSON-schema output. A diagnosed apple question costs about **25,000 tokens**, mostly protect-prevent's retrieved document text. A clarification costs about 4,500 and an off-topic question about 3,000.

### Versions

| Version | Status | What changed |
|---|---|---|
| **v18** | Original; untouched | Fails with `Runtime type mismatch` at `product_agent`, and every agent step uses `autoSend: true`, which streams raw JSON to the user |
| **v19** | Fix | Separate `Local.AppleResponse` / `Local.KccResponse`, copied into scalar variables (`Local.Status`, `DiagnosisName`, `FilRecommendation`, `DisplayMessage`); `autoSend: false` on all agent steps; a `SendActivity` node sends `Local.FinalMessage` before each `EndConversation`; the product-agent input is simplified to `UserMessage(DiagnosisName & " " & FilRecommendation)` |
| **v20** | **Latest** | v19 plus: if the specialist returns an empty `display_message`, **retry it once**; if it's still empty, send *"Sorry, I could not get an answer this time. Please try asking your question again."* |

The YAML for each version is in [`foundry/`](foundry/), and the backup of v18's full definition and metadata is in `foundry/orchestrator-v18-full.json`.

---

## 5. Files and folders created or changed

```
D:\foundry-agent-webapp\
├── CLAUDE.md                          [new, committed]   Guidance for Claude Code: commands, architecture, conventions
├── AGENTS.md                          [untracked, user-created]  Codex copy of CLAUDE.md, not touched by Claude
├── ARCHITECTURE-FLOW.md               [changed, committed] §1.6 "Workflow Agents" added
├── .gitignore                         [changed, committed] ignores simple-chat/logs/
├── backend\
│   ├── WebApp.Api\Services\AgentFrameworkService.cs   [changed, committed] workflow message filtering
│   └── WebApp.Api.Tests\WorkflowMessageFilterTests.cs [new, committed]   4 tests from real workflow payloads
├── simple-chat\                       [new, committed; 2 files have uncommitted edits]
│   ├── server.mjs                     Local chat server: az-login auth, rate limiter, inner-agent filtering, JSONL logging
│   ├── public\index.html              Chat UI: budget meter, queue/wait notices, "Inner agent steps" toggle
│   ├── run-batch.mjs                  Batch runner for adversarial prompt sets → CSV + JSONL
│   ├── sample-prompts.txt             Example tests (single- and multi-turn)
│   ├── README.md                      Usage, env vars, rate-limit design
│   └── logs\                          [git-ignored] chat-<date>.jsonl, batch-<timestamp>.csv/.jsonl
└── docs\session-handoff\              [new, uncommitted]
    ├── SESSION-HANDOFF.md             This document
    ├── .gitignore                     Ignores test-script output
    ├── foundry\
    │   ├── orchestrator-v18.yaml      Original workflow YAML (backup)
    │   ├── orchestrator-v18-full.json Full v18 API response, incl. metadata reused when creating new versions
    │   ├── orchestrator-v19.yaml      Fixed workflow
    │   ├── orchestrator-v20.yaml      Current workflow (retry + fallback)
    │   └── gpt-4.1-deployment-500.json  Body used to raise deployment capacity
    └── scripts\
        ├── test-workflow.ps1          Send one question to the workflow (streaming) and print each step plus the streamed text
        ├── test-two-turn.ps1          Two-turn conversation test against a pinned version
        └── test-v20.ps1               Run several questions; report retry/fallback, tokens, final message
```

Also outside the repo:
- `%APPDATA%\NuGet\NuGet.Config`: added the `nuget.org` source. It was empty, so NuGet couldn't download packages.
- `C:\Users\ADMIN\.claude\projects\d--foundry-agent-webapp\memory\no-pull-requests.md`: the no-PR rule, saved to Claude's memory.
- The untracked `.claude/` folders (repo root, `simple-chat/`, `backend/WebApp.Api/Services/`) are Claude Code usage files. **Don't commit them.**

### Commits on `feat/workflow-agent-support`

| Commit | Message |
|---|---|
| `9aa1669` | docs: add CLAUDE.md with commands and architecture overview |
| `838b58c` | feat(workflows): show only the workflow's own replies for workflow agents |
| `118ce22` | feat(simple-chat): add local rate-limited chat app for agent testing |

The base is `f6cb362` on `main`. The commit-message format follows `.github/skills/committing-code/SKILL.md`: write `COMMIT_MESSAGE.md`, run `git commit -F COMMIT_MESSAGE.md`, then delete the file.

### What the backend change does (`AgentFrameworkService.cs`)

These rules apply only when the configured agent is a workflow (`WorkflowAgentDefinition`); prompt agents behave as before.
- **Streaming:** on `output_item.added`, a message whose `agent_reference.name` isn't the workflow's own name is recorded as hidden. Its text deltas and annotations are dropped. `toolUse` events still pass through.
- **History:** stored items carry `created_by.agent.name`. The backend keeps the workflow's own replies and only the **first user message of each turn**, because the workflow stores its inner "user" prompts too.
- **Helpers:**
  - `GetProducingAgentName(object)` reads the raw JSON via `ModelReaderWriter`, because the SDK models don't expose these fields.
  - `FilterWorkflowHistory(...)` does the history filtering.
  - `IsWorkflow(...)` wraps the check for the preview type, suppressing analyzer warning `AAIP001`.

### How simple-chat works (`server.mjs`)

- **Config:**
  - Read from environment variables first, then `.azure/<defaultEnvironment>/.env`, then the defaults below.
  - Variables: `AI_AGENT_ENDPOINT`, `AI_AGENT_ID`, `AI_AGENT_VERSION` (blank = latest), `TPM_BUDGET` (400000), `RUNS_PER_MINUTE` (30), `INITIAL_TOKEN_ESTIMATE` (30000), `PORT` (3000).
- **Auth:** `az account get-access-token --resource https://ai.azure.com`, cached until 5 minutes before expiry.
- **Calls:**
  - `POST {endpoint}/openai/v1/conversations` with body `{}`.
  - `POST {endpoint}/openai/v1/responses` with `{agent_reference:{type,name,version?}, conversation, input, stream:true}`.
- **Rate limiter:**
  - All chats and batch runs go through one queue and run one at a time.
  - It keeps a 60-second record of tokens spent. Each run first reserves its estimate (the largest of the last 5 runs, or 30,000 before any run finishes), and the reservation is replaced by actual usage when the run ends.
  - Runs are also capped per minute.
  - A run counts as **throttled** only if it reports 0 tokens **and** no inner agent produced output; that triggers a 60-second cooldown. Zero tokens alone isn't enough, because refusals also report 0.
- **Output:**
  - The browser receives SSE events: `conversation`, `status`, `wait`, `delta`, `inner`, `error`, `done`.
  - Each exchange is appended as one line of JSON to `logs/chat-<date>.jsonl`.
- Listens on **127.0.0.1 only**: there's no login, and it uses your Azure credentials.

---

## 6. Decisions log

| # | Decision | Why |
|---|---|---|
| D1 | Point the app at the workflow (`Kisan-Orchestrator`), not a single agent | The user wants the orchestrated multi-agent behavior. In Foundry, a workflow is called by name like any agent. |
| D2 | **Never modify existing versions; create new ones** (v19, v20) | User requirement. Agents are called by name without a version, so changing an agent would also change how old workflow versions behave. |
| D3 | Fix v18's type mismatch in the **workflow only**, not by aligning the agents' schemas | Changing the agents would alter v18's behavior (see D2). Separate variables per branch plus shared scalar variables avoid the type conflict. |
| D4 | Add a `SendActivity` final message and set `autoSend: false` | v18 never sent `Local.FinalMessage`, and `autoSend: true` showed raw JSON from every agent. |
| D5 | Also filter inner-agent messages **in the backend** | Testing showed Foundry streams inner agents' text even with `autoSend: false`. Only the app can hide it. |
| D6 | Identify the producing agent by reading raw JSON | The `agent_reference` / `created_by` fields aren't exposed by the SDK models. |
| D7 | Build `simple-chat/` instead of the full app for now | `azd up` is blocked by permissions (the user can't create role assignments). The local app needs no Entra registration, role assignments or deployment, and suits adversarial testing because it logs inner outputs and runs batches. |
| D8 | simple-chat: plain Node, **no npm dependencies**, bound to localhost | Simple to run, with nothing to install. Binding to localhost matters because it uses the user's credentials with no login. |
| D9 | Client-side rate limiter with a rolling token budget at about 80% of TPM | The user asked that chat limits never be exceeded during adversarial testing. |
| D10 | Throttled = 0 tokens **and** no inner output | A refused jailbreak also reports 0 tokens; the first version of the rule misread that as throttling. |
| D11 | v20: retry the specialist once, then send a fallback message | Empty replies happened. The root cause turned out to be rate limiting (D12); the fallback still prevents blank answers. |
| D12 | Raise gpt-4.1 capacity 50 → 500 via the ARM REST API (PUT with the full body) | At 50,000 TPM only about 2 heavy questions fit per minute, and every agent shared that limit. Quota was available (9M), and GlobalStandard is billed per token, so there's no fixed cost. A full-body PUT keeps the RAI policy and upgrade option unchanged. User approved. |
| D13 | Work on branch `feat/workflow-agent-support`; **no pull requests** | Repo guidance is to branch off `main`; the user said no PRs (saved to memory). |
| D14 | Copy the workflow YAMLs and test scripts into `docs/session-handoff/` | The original copies were in a temporary scratch folder that a new session may lose. |
| D15 *(pending)* | Product recommendation as a table: **Option B recommended** (workflow v21 asks the product agent for a Markdown table, plus Markdown rendering and sanitization in simple-chat) | It keeps D2: no agent change. Option A (product-agent v13) is more reliable but would change all orchestrator versions. |

---

## 7. Findings and gotchas

1. **Workflow calls need a conversation.** Calling `/responses` without `conversation` gives `400 … "conversation": Not defined`.
2. **Use `agent_reference`, not `agent`, in the request body.** The `agent` property is deprecated.
3. **Creating workflow versions needs the preview header** `Foundry-Features: WorkflowAgents=V1Preview`; without it you get `403 preview_feature_required`.
4. **`autoSend: false` doesn't stop streaming.** Inner agents' text still streams; only the producing-agent tag tells them apart.
5. **Workflow conversations store everything:** inner agents' JSON plus copies of the user message fed to each agent. A single question becomes about 4 "user" items.
6. **v18's `Runtime type mismatch`:** two agents with different JSON schemas (protect-prevent has `clarifying_questions` and a `GENERAL` status; kcc-agent doesn't) both wrote to `Local.SpecialistResponse`.
7. **Empty replies come from rate limiting.** At 50,000 TPM, four runs within a minute caused the next runs to return 0 tokens with no agent output.
8. **Refusals become the fallback message.** On jailbreak attempts the agents reply "I'm sorry, but I cannot assist with that request." That isn't the expected JSON, so the workflow treats it as empty and sends the fallback. The real refusal is visible only in the inner-steps panel and the logs.
9. **Transient Foundry errors happen.** One run failed with `upstream connect error … connection termination` inside kcc-agent. That's a Foundry-side error; retry the request.
10. **`azd up` failure details:**
    - Fatal: `Authorization failed … Microsoft.Authorization/roleAssignments/write` (container registry AcrPull role).
    - Non-fatal: `Microsoft.AlertsManagement` isn't registered on the subscription.
11. **NuGet had no sources.** `dotnet restore` failed with `NU1100` until nuget.org was added.
12. **After a winget install, restart VS Code completely.** Otherwise new tools give "term not recognized", because terminals inherit the old PATH.
13. **Scripts blocked?** Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
14. **The README is wrong about switching agents.** It says switching agents needs no provision, but the Container App's `AI_AGENT_ID` and the local `.env` files only update after `azd provision`.

### Test results (v20, after the capacity increase)

| Test | Result |
|---|---|
| Aphids and mites in apple orchards | ✅ Full answer plus FIL products (Filprid, FILTO-RAD, Majestic Plus, FIL-Obrez), about 25,000 tokens |
| Apple spots, then follow-up details | ✅ Clarifying question, then a diagnosis in the same conversation |
| Banned pesticides (endosulfan, monocrotophos) | ✅ Gave no doses; pointed to the approved products |
| Cricket poem | ✅ Declined as off-topic |
| Prompt injection (print the system prompt) | ⚠️ Refused, but shown as the generic fallback (finding 8); one run hit a transient error (finding 9) |
| Batch of 5 tests | 73 seconds with no waiting (384 seconds at the old 50,000 TPM) |

---

## 8. Run instructions

### simple-chat (primary)
```powershell
cd D:\foundry-agent-webapp\simple-chat
node server.mjs                                   # http://localhost:3000
# optional overrides (current terminal only):
$env:AI_AGENT_VERSION = "20"                      # pin the workflow version for a test campaign
$env:TPM_BUDGET = "40000"                         # only if capacity goes back to 50,000 TPM
$env:PORT = "3001"
```
Stop it with Ctrl+C. If you see `az CLI token failed`, run `az login`.

### Batch adversarial testing (server must be running)
```powershell
cd D:\foundry-agent-webapp\simple-chat
node run-batch.mjs sample-prompts.txt             # or your own file
node run-batch.mjs prompts.txt --server http://localhost:3001
```
Prompt file format, one test per line (lines starting with `#` are skipped):
```
How to control aphids and mites in apple orchards?
{"tag":"clarify","prompt":"My apple leaves have spots","followups":["Brown spots with a purple border"]}
```
Output goes to `simple-chat\logs\batch-<timestamp>.csv` and `.jsonl`. All chats are also logged to `logs\chat-<date>.jsonl`.

### Workflow test scripts (direct to Foundry, no rate limiter; mind the token budget)
```powershell
$s = "D:\foundry-agent-webapp\docs\session-handoff\scripts"
& "$s\test-workflow.ps1" -Question "How to control aphids and mites in apple orchards?"          # latest version
& "$s\test-workflow.ps1" -Question "..." -Version 19
& "$s\test-two-turn.ps1" -Version 20 -First "My apple leaves have spots" -Second "Brown spots, purple border" -Tag t1
& "$s\test-v20.ps1" -Questions @("Q1","Q2") -Version 20
```

### Backend tests
```powershell
cd D:\foundry-agent-webapp
dotnet test backend/WebApp.Api.Tests                                                # 52 tests
dotnet test backend/WebApp.Api.Tests --filter "FullyQualifiedName~WorkflowMessageFilterTests"
```

### Utilities
```powershell
.\deployment\scripts\list-agents.ps1              # list agents in the project
azd env get-values                                # azd environment
az cognitiveservices account deployment list -g misa -n proj-kisan -o table
```

### Full web app (once permissions are granted)
```powershell
# 1. A subscription Owner grants the user "User Access Administrator" (or Owner) on the subscription,
#    or at least on rg-proj-kisan and misa
# 2. Register the provider whose absence caused the non-fatal error
az provider register -n Microsoft.AlertsManagement
# 3. Deploy (reuses existing rg-proj-kisan resources)
azd auth login
azd up
# Local dev afterwards (needs the .env files that azd generates):
.\deployment\scripts\start-local-dev.ps1          # frontend :5173, backend :8080
```

---

## 9. Foundry REST reference (as used)

```powershell
$token = az account get-access-token --resource https://ai.azure.com --query accessToken -o tsv
$ep    = "https://proj-kisan.services.ai.azure.com/api/projects/proj-kisan"
$h     = @{ Authorization = "Bearer $token" }

# Read an agent/workflow (latest version + definition)
Invoke-RestMethod -Uri "$ep/agents/Kisan-Orchestrator?api-version=v1" -Headers $h

# Create a conversation, then run the workflow in it (add stream=$true for SSE)
$conv = Invoke-RestMethod -Method Post -Uri "$ep/openai/v1/conversations" -Headers $h -ContentType "application/json" -Body "{}"
$body = @{ agent_reference = @{ type="agent_reference"; name="Kisan-Orchestrator"; version="20" }; conversation=$conv.id; input="..." } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri "$ep/openai/v1/responses" -Headers $h -ContentType "application/json" -Body $body

# List stored conversation items
Invoke-RestMethod -Uri "$ep/openai/v1/conversations/$($conv.id)/items?limit=50&order=asc" -Headers $h

# Create a NEW workflow version (never edit existing ones). Needs the preview header.
$old  = (Get-Content docs\session-handoff\foundry\orchestrator-v18-full.json -Raw | ConvertFrom-Json).versions.latest
$meta = @{}; $old.metadata.PSObject.Properties | % { $meta[$_.Name] = $_.Value }
$meta['modified_at'] = [string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$yaml = [IO.File]::ReadAllText("docs\session-handoff\foundry\orchestrator-v21.yaml")
$body = @{ definition=@{ kind="workflow"; workflow=$yaml }; description=""; metadata=$meta } | ConvertTo-Json -Depth 6
Invoke-WebRequest -Method Post -Uri "$ep/agents/Kisan-Orchestrator/versions?api-version=v1" `
  -Headers @{ Authorization="Bearer $token"; "Foundry-Features"="WorkflowAgents=V1Preview" } `
  -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($body)) -UseBasicParsing
```

Streaming event types seen from workflows: `response.created`, `response.in_progress`, `response.output_item.added` / `.done` (item types `workflow_action`, `message`, `file_search_call`), `response.output_text.delta`, `response.content_part.*`, `response.file_search_call.*`, `response.completed`, `response.failed`. Message items carry `agent_reference.name`; text deltas carry `item_id`.

---

## 10. Command log (by phase)

### Setup and diagnosis
```powershell
winget install Microsoft.PowerShell
winget install microsoft.azd
winget install Microsoft.DotNet.SDK.10
# refresh PATH in an existing terminal:
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
azd auth login
azd up                                            # failed at role assignment (see §7.10)
dotnet --info; az account show
dotnet nuget add source https://api.nuget.org/v3/index.json -n nuget.org
dotnet restore backend/WebApp.sln
```

### Investigating the failed provision
```powershell
az group list --query "[?contains(name,'kisan')]" -o table
az resource list -g rg-proj-kisan -o table
az deployment sub list --query "[?contains(name,'kisan')]" -o table
az deployment operation sub list -n <deployment-name> --query "[?properties.provisioningState=='Failed']"
az deployment operation group list -g rg-proj-kisan -n infrastructure --query "[?properties.provisioningState=='Failed']"
```

### Model capacity
```powershell
az cognitiveservices account deployment list -g misa -n proj-kisan -o table
az cognitiveservices usage list -l eastus2 --query "[?name.value=='OpenAI.GlobalStandard.gpt4.1']" -o table
# raise capacity (full-body PUT preserves the RAI policy and upgrade option):
az rest --method put `
  --url "https://management.azure.com/subscriptions/97b7ae1c-5e48-492e-b26b-48df994fa1e4/resourceGroups/misa/providers/Microsoft.CognitiveServices/accounts/proj-kisan/deployments/gpt-4.1?api-version=2024-10-01" `
  --body "@docs/session-handoff/foundry/gpt-4.1-deployment-500.json"
```

### Workflow work
The Foundry REST calls in §9 were used to read v18, create v19 and v20, and run the tests. The test scripts are in `scripts/`. Debugging used streaming via `curl.exe -N` to capture SSE into a file, then parsed it in PowerShell.

### Backend
```powershell
dotnet test backend/WebApp.Api.Tests
```

### simple-chat
```powershell
cd simple-chat; node server.mjs
node run-batch.mjs sample-prompts.txt
node --check server.mjs; node --check run-batch.mjs
# stop a server on port 3000:
Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000 -State Listen).OwningProcess -Force
```

### Git
```bash
git checkout -b feat/workflow-agent-support
git add <files>; git commit -F COMMIT_MESSAGE.md; rm COMMIT_MESSAGE.md   # ×3 commits
```

---

## 11. Open items and next steps

| # | Item | Status / how to do it |
|---|---|---|
| 1 | **Product recommendation as a table** | **Awaiting the user's go-ahead on Option B.** Plan: (a) `orchestrator-v21.yaml` = v20 with the product-agent input changed to something like `UserMessage(Local.DiagnosisName & " " & Local.FilRecommendation & Char(10) & "Format products_text as a Markdown table with columns: Product, Used for, Dosage, Price (only include data present in the catalog). Put any product image links below the table.")`, created as a new version via §9; (b) simple-chat renders Markdown with `marked` and sanitizes it with `DOMPurify` (model output is untrusted during adversarial tests). The main React app already renders GFM tables. |
| 2 | Commit the pending changes | `simple-chat/server.mjs` and `README.md` (new defaults 400,000 / 30), plus `docs/session-handoff/`. Don't commit the `.claude/` folders or `AGENTS.md` (the user's file). |
| 3 | Refusals shown as the generic fallback | Optional v21/v22 change: detect refusals and pass them through, or show a specific "can't help with that" message |
| 4 | Pin the workflow version during test campaigns | `$env:AI_AGENT_VERSION="20"` before `node server.mjs` |
| 5 | Full deployment | Needs an Owner-granted role (§8, full web app). Then `azd up`, then verify the backend workflow filtering end to end in the React UI. |
| 6 | protect-prevent sometimes stops after its file search | Seen before the capacity increase, so probably rate limiting; watch the logs for runs with inner output from Router but none from protect-prevent |
| 7 | Push the branch | Only if the user asks. **No PRs.** |
