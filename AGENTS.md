# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

Azure AI Foundry Agent Service sample app: a React SPA plus an ASP.NET Core Minimal API, with Entra ID auth and SSE streaming, deployed as a **single container** to Azure Container Apps through `azd`. Versions live in `*.csproj` / `frontend/package.json`. Keep docs version-free.

## Commands

Local dev needs the generated env files (`frontend/.env.local` and `backend/WebApp.Api/.env`). `azd up` creates them in `postprovision.ps1`. If either file is missing or auth variables are empty, the fix is always to run `azd up` from the repo root.

```powershell
# Start both dev servers (backend :8080 via dotnet watch, frontend :5173 via Vite with /api proxied to :8080)
.\deployment\scripts\start-local-dev.ps1      # or VS Code: Ctrl+Shift+B → "Start Dev (VS Code Terminals)"

# Frontend (run from frontend/; .npmrc sets legacy-peer-deps for React 19)
npm install
npm run lint
npm run build                                  # tsc -b && vite build
npm run test:run                               # vitest, all tests once
npx vitest run src/utils/__tests__/sseParser.test.ts   # single file
npx vitest run -t "test name substring"        # single test by name

# Backend (xUnit)
dotnet build backend/WebApp.sln
dotnet test backend/WebApp.Api.Tests
dotnet test backend/WebApp.Api.Tests --filter "FullyQualifiedName~ErrorResponseFactoryTests"

# Azure
azd up                                         # provision + deploy (first time)
azd deploy                                     # code-only redeploy
azd provision                                  # infra / RBAC changes
.\deployment\scripts\list-agents.ps1           # list agents in the configured Foundry project
.\deployment\scripts\validate-config.ps1       # check local .env files
```

When you add a package with peer deps, add those peer deps explicitly to `package.json` and run `npm ci` to confirm the Docker build will succeed.

## Architecture

**Request flow:** MSAL.js (PKCE) gets a token with the `Chat.ReadWrite` scope → `POST /api/chat/stream` with Bearer JWT → `AgentFrameworkService` calls Foundry through `Azure.AI.Projects` / `Azure.AI.Extensions.OpenAI` (Responses API bound to a conversation id) → SSE events → frontend `sseParser` → reducer actions → UI.

### Backend (`backend/WebApp.Api`)
- `Program.cs` holds all endpoints as Minimal API lambdas: `/api/chat/stream`, `/api/agent`, `/api/agent/info`, `/api/conversations*`, `/api/files/*`, and `/api/health`. It also serves the built SPA from `wwwroot` with `MapFallbackToFile("index.html")`. Endpoints require a valid JWT that carries the `Chat.ReadWrite` scope.
- In development, `Program.cs` loads `.env` into environment variables before configuration is built. In production, Container Apps injects them.
- `Services/AgentFrameworkService.cs` contains all Foundry logic:
  - **Agent caching:** the agent version is resolved lazily and cached in **static** fields (`s_cachedAgentVersion`, `s_cachedMetadata`), guarded by a `SemaphoreSlim`. The version is pinned with `AI_AGENT_VERSION`; without it, the latest version is used.
  - **Credentials:**
    - Development uses `ChainedTokenCredential(AzureCli, AzureDeveloperCli)`.
    - Production uses either a user-assigned Managed Identity or, when `ENTRA_BACKEND_CLIENT_ID` is set, OBO (`OnBehalfOfCredential`). OBO gets its client assertion from the MI through a Federated Identity Credential, and the incoming user JWT is required per request.
    - MI and OBO are mutually exclusive.
  - **Streaming:** maps SDK streaming updates to `StreamChunk` types: text deltas, annotations/citations, MCP approval requests (these pause the stream until the user decides), tool-use events, and usage.
- Errors are returned as RFC 7807 problem details through `ErrorResponseFactory`. Exception details are included only in Development.
- Image attachments are uploaded to Foundry Files and never expire, because the SDK has no `expires_after`. The `/api/files/uploaded` and `/api/files/cleanup` endpoints back the Settings → Uploaded files panel.

### Frontend (`frontend/src`)
- **State:** one global `useReducer` in `contexts/AppContext.tsx`, with discriminated-union actions in `types/appState.ts` and handlers in `reducers/appReducer.ts`. To add a new action: add the type, handle it in the reducer, dispatch it, and consume it through `useAppContext` (see ARCHITECTURE-FLOW.md Part 4).
- `services/chatService.ts` owns the streaming request, retry/recovery, and the mapping from SSE events to dispatched actions. Parsing lives in `utils/sseParser.ts` and `utils/citationParser.ts`.
- `AgentChat.tsx` → `ChatInterface.tsx` → `components/chat/*` is the main UI tree. It uses Fluent UI v9 components and CSS Modules (`*.module.css`). The `~` import alias maps to `src/`.
- `vite.config.ts` reads env from `.azure/<env>/.env` when that file exists, otherwise from `frontend/`. It remaps `ENTRA_SPA_CLIENT_ID` / `ENTRA_TENANT_ID` to `VITE_*`. `plugins/envcheck.ts` serves an error page when those variables are missing.

### Infra and deployment
- `deployment/docker/frontend.Dockerfile` (despite its name) builds the **whole app**: the Vite build is copied into the .NET publish output's `wwwroot`.
- `azd up` runs preprovision → Bicep (`infra/main.bicep`, which uses `main-infrastructure.bicep`, `main-app.bicep`, and `entra-app.bicep`) → postprovision → predeploy → deploy. The checked-in `*.json` files next to the Bicep files are compiled ARM output.
- These steps run in PowerShell hooks (`deployment/hooks/`) on purpose, not in Bicep:
  - Entra `identifierUri` and redirect URIs, which depend on the generated appId and the Container App FQDN.
  - FIC creation, which hits Graph eventual consistency if done in the same deployment as the app.
  - Discovery of the user's existing Foundry resource.
  - Cross-resource-group RBAC, which keeps `azd down` from touching the external Foundry resources.
  - Entra app deletion in `postdown.ps1`, because Graph objects aren't part of the resource group.
- The OBO admin consent scope `https://ai.azure.com/.default` resolves to the **Azure Machine Learning Services** service principal. Grant consent there.

## Repo conventions

- **`ARCHITECTURE-FLOW.md`** documents the state machines, SSE event → action mapping, and configuration keys. Update it when you change `Program.cs`, `AgentFrameworkService.cs`, `AppContext.tsx`, `appReducer.ts`, `chatService.ts`, `ChatInterface.tsx`, or `AgentChat.tsx`.
- **Docs:** describe current behavior only, state each fact once and cross-reference it elsewhere, and document only what can't be inferred from the code.
- **Commits** follow `.github/skills/committing-code/SKILL.md`:
  - Subject format is `type(scope): subject`, using feat, fix, refactor, chore, or docs.
  - The body has `## Summary`, `## New Components`, `## Enhanced Components`, and `## Files Changed` sections, and lists every changed file.
  - Write the message to `COMMIT_MESSAGE.md`, run `git commit -F COMMIT_MESSAGE.md`, then delete the file.
- **In-progress work:** read `docs/session-handoff/SESSION-HANDOFF.md` first. It covers the Kisan workflow versions, Foundry changes, decisions, pending items, and the no-PR / never-edit-existing-agent-versions rules.
- `simple-chat/` is a standalone, dependency-free Node chat app and batch runner for local and adversarial testing. It uses the developer's `az login` and is rate-limited to stay under the model deployment's TPM. See its README.
- `.github/skills/*/SKILL.md` holds deeper domain guides (streaming, auth troubleshooting, Bicep, testing, deployment validation). Read the relevant one before working in that area.
