# AI Agent Web App

AI-powered web application with Entra ID authentication and Foundry Agent Service integration. Deploy to Azure Container Apps with a single command.

> **⚠️ Coming from the AI Foundry portal?** The portal's "View sample app code" gives you AI resource variables, but this app also needs an **Entra ID app registration** for authentication — which is created by `azd up`. Even if your AI Foundry resources already exist, you must run `azd up` before the app will work. See the [Foundry portal setup](#coming-from-the-ai-foundry-portal) section below.

## Quick Start

### Using this Template

```powershell
# Clone or initialize from GitHub template
azd init -t microsoft-foundry/foundry-agent-webapp

# Deploy everything
azd up  # Full deployment: ~10-12 minutes
```

**Alternative**: Use GitHub's "Use this template" button or clone directly:
```powershell
git clone https://github.com/microsoft-foundry/foundry-agent-webapp.git
cd foundry-agent-webapp
azd up
```

The `azd up` command:
1. Discovers AI Foundry resources in your subscription
2. Creates Microsoft Entra ID app registration (via Bicep) and Azure infrastructure (ACR, Container Apps)
3. Builds and deploys your application
4. Opens browser to your deployed app

**Local Development**: http://localhost:5173 (frontend), http://localhost:8080 (backend)  
**Production**: https://<your-app>.azurecontainerapps.io

### GitHub Codespaces

This repo includes a devcontainer configuration for Codespaces. The `azd` CLI, .NET 10 SDK, Node.js, and PowerShell are pre-installed. Open in Codespaces, then run `azd up` from the terminal to provision the Entra app and generate `.env` files.

> **Corporate tenants**: Codespaces VMs are not managed by Intune, so organizations with device-compliance Conditional Access policies may block `az login` or token acquisition. The `az login --use-device-code` flow authenticates on your compliant browser, but some policies evaluate the device at token-use time — not just at login. If you hit authentication errors in Codespaces, use local development instead.

## Prerequisites

### Windows
- **PowerShell 7+** - `winget install Microsoft.PowerShell`
- **Azure Developer CLI (azd)** - `winget install microsoft.azd`
- **Azure CLI** - `winget install Microsoft.AzureCLI`
- **Docker Desktop** (optional) - https://docs.docker.com/desktop/install/windows-install/
- **.NET 10 SDK** - https://dot.net
- **Node.js 18+** - https://nodejs.org

### macOS
- **PowerShell 7+** - `brew install powershell` or [download](https://github.com/PowerShell/PowerShell/releases)
- **Azure Developer CLI (azd)** - `brew tap azure/azd && brew install azd` or `curl -fsSL https://aka.ms/install-azd.sh | bash`
- **Azure CLI** - `brew install azure-cli` or `curl -L https://aka.ms/InstallAzureCli | bash`
- **Docker Desktop** (optional) - `brew install --cask docker` or [download](https://www.docker.com/products/docker-desktop/)
- **.NET 10 SDK** - https://dot.net
- **Node.js 18+** - `brew install node` or https://nodejs.org

> **Homebrew not installed?** Commands work without Homebrew using direct installers. The deployment script (`azd up`) checks for Homebrew and provides appropriate installation instructions.

### Linux
- **PowerShell 7+** - https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-linux
- **Azure Developer CLI (azd)** - `curl -fsSL https://aka.ms/install-azd.sh | bash`
- **Azure CLI** - https://learn.microsoft.com/cli/azure/install-azure-cli-linux
- **Docker Engine** (optional) - https://docs.docker.com/engine/install/
- **.NET 10 SDK** - https://dot.net
- **Node.js 18+** - https://nodejs.org

### Azure Requirements
- **Azure Subscription** with Contributor role
- **Bicep CLI** - Installed automatically with `azd`, or manually: `az bicep install`
- **Microsoft Foundry Resource** with a project and at least one v2 agent — create via [ai.azure.com](https://ai.azure.com) or deploy infrastructure with [microsoft-foundry/foundry-samples](https://github.com/microsoft-foundry/foundry-samples/tree/main/infrastructure/infrastructure-setup-bicep) Bicep templates

> **Note**: Docker is optional. If not installed, `azd` automatically uses Azure Container Registry cloud build for deployment.

### Custom npm Registries

If your organization uses a custom npm registry, add `.npmrc` to `frontend/` directory:

```ini
registry=https://your-registry.example.com/
//your-registry.example.com/:_authToken=${NPM_TOKEN}
```

**Note**: `.npmrc` is automatically copied during Docker builds. Don't commit authentication tokens.

### Organization-Specific Requirements

If your organization requires a Service Management Reference for Entra ID app registrations:

```powershell
azd env set ENTRA_SERVICE_MANAGEMENT_REFERENCE "<guid-from-admin>"
```

See [deployment/hooks/README.md](deployment/hooks/README.md#app-registration-policies) for more organization-specific configuration options.

## VS Code Configuration

The workspace includes optimized VS Code configuration for AI-assisted development:

### Tasks (`.vscode/tasks.json`)

| Task | Description | Port |
|------|-------------|------|
| `Backend: ASP.NET Core API` | `dotnet watch run` with hot reload | 8080 |
| `Frontend: React Vite` | `npm run dev` with HMR (auto-installs deps) | 5173 |
| `Start Dev (VS Code Terminals)` | Starts both in parallel (default build task) | - |
| `Validate Configuration` | Checks `.env` files for required variables | - |
| `Install Frontend Dependencies` | `npm install --legacy-peer-deps` (runs automatically) | - |

**Hot Reload Workflow**:
- **Backend**: Edit C# → Save → .NET auto-recompiles → Check terminal for errors
- **Frontend**: Edit TypeScript/React → Save → Browser updates instantly (HMR)
- **No restarts needed** - just edit, save, and test

**AI Agent Benefits**: Server logs are visible in VS Code terminals, allowing AI agents to:
- See compilation errors and warnings
- Monitor request handling
- Debug issues without screenshots

### Debugging (`.vscode/launch.json`)

| Configuration | Description |
|---------------|-------------|
| `.NET: Launch Backend` | Debug ASP.NET Core API with C# Dev Kit |
| `.NET: Attach to Backend` | Attach to running dotnet watch process |
| `Chrome: Frontend` | Debug React app in Chrome with source maps |
| `Edge: Frontend` | Debug React app in Edge |
| `Full Stack Debug` | Launch backend + Chrome together |

### Settings (`.vscode/settings.json`)
- **GitHub Copilot** - Code generation uses instruction files (`github.copilot.chat.codeGeneration.useInstructionFiles: true`)
- **Agent Customization** - Agent customization skill enabled (`chat.agentCustomizationSkill.enabled: true`)
- **Skills** - On-demand loading from `.github/skills/` for efficient context
- **Terminal Scrollback** - Limited to 500 lines to prevent overwhelming AI context
- **Markdown Linting** - Disabled to prevent noise from instruction files

## Configuration

### Microsoft Foundry

`azd up` automatically discovers your Foundry resource, project, and agent:

- **1 resource found**: Auto-selects and configures RBAC
- **Multiple resources found**: Prompts you to select which one to use
- **RBAC**: Automatically grants the Container App's managed identity `Cognitive Services OpenAI Contributor` + `Azure AI Developer` roles

### Coming from the AI Foundry Portal

The portal's "View sample app code" dialog provides AI resource variables (`AI_AGENT_ENDPOINT`, `AI_AGENT_ID`, etc.), which tell the app *which agent to talk to*. However, this app also requires an **Entra ID app registration** for user authentication — which the portal does not create. Running `azd up` creates it, along with the `.env` files that wire everything together.

**What the portal gives you**: AI Foundry project endpoint and agent ID — these identify your agent.
**What `azd up` adds**: Entra app registration, JWT auth config, redirect URIs, RBAC grants, Azure infrastructure.

Without `azd up`, the frontend shows `undefined` in the login URL because `VITE_ENTRA_SPA_CLIENT_ID` and `VITE_ENTRA_TENANT_ID` don't exist yet.

If you clicked "View sample app code" in the portal, you can either paste the portal variables into a root `.env` file or set them via `azd env set`, then run `azd up`:

```powershell
# Option 1: Paste portal variables into a root .env file
#   Create a .env file in the repo root with the portal values, then:
azd up

# Option 2: Set via azd environment
azd env set AZURE_EXISTING_AGENT_ID "your-agent:2"
azd env set AZURE_EXISTING_AIPROJECT_ENDPOINT "https://your-resource.services.ai.azure.com/api/projects/your-project"
azd env set AZURE_EXISTING_RESOURCE_ID "/subscriptions/.../accounts/your-resource"
azd up
```
The preprovision hook detects these portal variables (from either location) and maps them automatically.

**Change AI Foundry resource**:
```powershell
# Option 1: Let azd discover and prompt for selection
azd provision  # Re-runs discovery, updates RBAC

# Option 2: Manually configure then provision
azd env set AI_FOUNDRY_RESOURCE_GROUP <resource-group>
azd env set AI_FOUNDRY_RESOURCE_NAME <resource-name>
azd provision  # Updates RBAC for new resource
```

**List and switch agents** (requires prior `azd up`):
```powershell
# List all agents in configured project
.\deployment\scripts\list-agents.ps1

# Switch to different agent (in same resource)
azd env set AI_AGENT_ID <agent-name>
# No provision needed - RBAC already grants access to all agents in the resource
```

> 💡 `azd provision` (or `azd up`) automatically regenerates `.env` files and updates RBAC assignments when configuration changes.

## Features

- **AI Chat** — Real-time streaming chat with Azure AI Foundry agents
- **Message Actions** — Copy, regenerate, edit, and rate responses
- **Rich Input** — Voice dictation, drag-and-drop files, keyboard shortcuts
- **Conversation Management** — History sidebar, search, export as Markdown
- **Resilience** — Auto-retry with recovery, message queueing during streaming
- **Tool Visualization** — See when the agent searches files, runs code, or calls tools

See [`frontend/README.md`](frontend/README.md) for the full feature list.

## Known Limitations

- **Uploaded image files accumulate.** Image attachments are uploaded to Azure
  Foundry's Files endpoint (purpose `assistants`) and referenced by file id
  from the Responses API. The GA `Azure.AI.Extensions.OpenAI` and `OpenAI`
  SDKs do not expose an `expires_after` parameter on file upload, so files
  persist until deleted. The in-app **Settings → Uploaded files** panel lists
  the count/size of files previously uploaded by this app and offers a
  one-click cleanup; operators can also purge via the Foundry portal.

## Development Workflow

### Option 1: VS Code Tasks (Recommended for AI-assisted development)
```powershell
# Run the compound task via Command Palette (Ctrl+Shift+P):
# "Tasks: Run Task" → "Start Dev (VS Code Terminals)"
# Or press Ctrl+Shift+B (default build task)

# Servers run in VS Code terminal panel with visible logs
# AI agents can read logs via get_terminal_output
```

### Option 2: PowerShell Script
```powershell
# Start local development (spawns separate terminal windows)
.\deployment\scripts\start-local-dev.ps1
```

### Hot Reload
- **React**: Hot Module Replacement (HMR) - instant browser updates
- **C#**: Watch mode - auto-recompiles on save, check terminal for errors
- **Test at**: http://localhost:5173

### Deploy
```powershell
# Deploy code changes to Azure
azd deploy  # 3-5 minutes
```

### Setup Detection

Multiple layers catch incomplete setup before cryptic errors appear:

| Layer | What It Checks | When It Runs |
|-------|---------------|--------------|
| **Vite env check plugin** | `VITE_ENTRA_SPA_CLIENT_ID`, `VITE_ENTRA_TENANT_ID` | Dev server startup (`npm run dev`) — serves a styled error page instead of the app |
| **preToolUse hook** | Context-aware: frontend commands check frontend env, backend commands check backend env (including `AI_AGENT_ENDPOINT`, `AI_AGENT_ID`) | AI agents running dev commands — advisory message, non-blocking |
| **Validate Configuration task** | Both `.env` files with auth variables | On-demand via VS Code (`Tasks: Run Task` → `Validate Configuration`) |
| **`validating-local-setup` skill** | Full diagnostic checklist with error patterns and step-by-step fixes | Loaded by AI agents when setup issues are detected |

All layers point to the same fix: run `azd up` from the repo root.

## Architecture

**Frontend**: React 19 + TypeScript + Vite  
**Backend**: ASP.NET Core 9 Minimal APIs  
**Authentication**: Microsoft Entra ID (PKCE flow)  
**AI Integration**: Foundry Agent Service v2 Agents API (`Azure.AI.Projects` SDK)  
**Deployment**: Single container, Azure Container Apps  
**Local Dev**: Native (no Docker required)

### Known Limitations

- **Office Documents**: DOCX, PPTX, and XLSX files are not supported for upload. Use PDF, images, or plain text files instead.
- **GA Azure SDK**: This application uses GA `Azure.AI.Projects` and `Azure.AI.Extensions.OpenAI` packages. Check `backend/WebApp.Api/WebApp.Api.csproj` for current versions.
- **npm Peer Dependencies**: React 19 has peer dependency conflicts with some packages. If adding packages that have peer dependencies (like `yjs` for `@lexical/yjs`), you must add them explicitly to `package.json`. Run `npm ci` locally to verify before committing.


## Commands

**See `.github/copilot-instructions.md` for complete command reference and development workflow.**

| Command | Purpose | Duration |
|---------|---------|----------|
| `azd up` | Initial deployment (infra + code) | 10-12 min |
| `azd deploy` | Deploy code changes only | 3-5 min |
| `.\deployment\scripts\start-local-dev.ps1` | Start local development | Instant |
| `.\deployment\scripts\list-agents.ps1` | List agents in your project | Instant |
| `azd provision` | Re-deploy infrastructure / update RBAC | 2-3 min |
| `azd down --force --purge` | Delete all Azure resources | 2-3 min |

## Documentation

### For Developers
- `ARCHITECTURE-FLOW.md` - State machines, data flow diagrams, and SSE event mapping
- `backend/README.md` - ASP.NET Core API setup and configuration
- `frontend/README.md` - React frontend development
- `infra/README.md` - Azure infrastructure overview
- `deployment/README.md` - Deployment scripts and hooks

### For AI Assistants (GitHub Copilot)
This repository uses VS Code's Agent Skills feature for on-demand context loading:

- `.github/copilot-instructions.md` - Architecture overview (always loaded)
- `.github/skills/` - Domain-specific guidance loaded when relevant:
  - `understanding-architecture` - State machines, SSE events, data flow
  - `deploying-to-azure` - Deployment commands and troubleshooting
  - `writing-csharp-code` - C#/ASP.NET Core patterns
  - `writing-typescript-code` - TypeScript/React patterns
  - `writing-bicep-templates` - Bicep infrastructure patterns
  - `implementing-chat-streaming` - SSE streaming patterns
  - `troubleshooting-authentication` - MSAL/JWT debugging
  - `researching-azure-ai-sdk` - SDK research workflow
  - `testing-with-playwright` - Browser testing workflow
  - `syncing-mcp-servers` - MCP server config synchronization
  - `testing-cli-compatibility` - CLI compatibility validation
  - `writing-unit-tests-csharp` - C#/MSTest unit test patterns
  - `writing-unit-tests-typescript` - TypeScript/Vitest unit test patterns
  - `validating-ui-features` - UI feature validation procedures
  - `committing-code` - Commit message format and conventional commit workflow
  - `validating-local-setup` - Setup diagnostics: missing env vars, `azd up` guidance
  - `reviewing-documentation` - Documentation audit checklists and quality standards
  - `triaging-issues` - Issue triage workflow, priority definitions, and report format
  - `planning-features` - Structured plan template for feature implementation
- `.github/hooks/` — Agent hook system (commit gate, setup detection) for enforcing workflows

## Azure Resources Provisioned

This template deploys the following Azure resources:

- **Azure Container Apps** - Serverless container hosting (0.5 vCPU, 1GB RAM, scale-to-zero enabled)
- **Azure Container Registry** - Private container image storage (Basic tier)
- **Log Analytics Workspace** - Centralized logging (30-day retention)
- **Application Insights (Backend)** - OpenTelemetry traces, metrics, and distributed tracing (`APPLICATIONINSIGHTS_CONNECTION_STRING` env var)
- **Application Insights (Frontend)** - Browser telemetry via `@microsoft/applicationinsights-web` (separate resource to isolate browser metrics from server metrics)
- **User-Assigned Managed Identity** - `isolationScope: Regional` — used for ACR pull, AI Foundry RBAC, and OBO FIC. No admin credentials or secrets.

All resources deploy to the same region (`AZURE_LOCATION`). The managed identity's regional isolation ensures it can only be assigned to compute resources in the deployment region.

> **Region tip**: For best resilience, deploy to the **same region** as your AI Foundry resource. The `preprovision` hook warns if regions don't match. To align: `azd env set AZURE_LOCATION <your-ai-foundry-region>`

## Authentication & Identity

### Default: Managed Identity (Zero-Touch)

By default, `azd up` configures everything automatically:

| Component | Identity | How |
|-----------|----------|-----|
| Frontend → Backend | User's Entra ID token (MSAL.js PKCE) | SPA app registration created by Bicep |
| Backend → Agent Service | Container App's managed identity | User-assigned MI + RBAC (see [Azure Resources](#azure-resources-provisioned)) |

The managed identity has `Cognitive Services OpenAI Contributor` + `Azure AI Developer` roles on the AI Foundry resource. All agent tool calls (MCP, OpenAPI, Logic Apps) use the **agent's own identity** configured in the Foundry portal — NOT the web app's identity and NOT the user's identity.

**Scope requested by `AIProjectClient`**: `https://ai.azure.com/.default`

### Advanced: On-Behalf-Of (OBO) — Opt-In

OBO replaces the managed identity with the **user's own identity** for Agent Service API calls. This gives you per-user audit trails and rate limiting but adds enterprise friction.

> **⚠️ Important**: OBO does NOT pass the user's identity to agent tools. Tool authentication (MCP servers, OpenAPI endpoints, Logic Apps) is controlled by the [Agent Identity](https://learn.microsoft.com/azure/ai-foundry/agents/concepts/agent-identity) configured in the Foundry portal. OBO only affects who the Agent Service API sees as the caller.

#### How OBO Works (Secretless via Federated Identity Credential)

```text
┌──────────┐  JWT (user)  ┌──────────────┐  OBO token (user)  ┌──────────────┐
│ Frontend │ ────────────►│ Backend API  │ ──────────────────►│ Agent Service│
│ (MSAL.js)│              │ (ASP.NET)    │                     │ (Foundry)    │
└──────────┘              └──────────────┘                     └──────────────┘
                                │
                                │ 1. ManagedIdentityClientAssertion
                                │    → gets MI token (audience: api://AzureADTokenExchange)
                                │
                                │ 2. OnBehalfOfCredential(tenantId, backendClientId,
                                │      miAssertionCallback, userJWT)
                                │    → exchanges user JWT for OBO token
                                │    → scope: https://ai.azure.com/.default
                                │
                                │ No secrets! MI token replaces client secret.
```

**References**:
- [OBO flow protocol](https://learn.microsoft.com/entra/identity-platform/v2-oauth2-on-behalf-of-flow)
- [Federated Identity Credentials (FIC) with managed identities](https://learn.microsoft.com/entra/workload-id/workload-identity-federation-config-app-trust-managed-identity)
- [ManagedIdentityClientAssertion](https://learn.microsoft.com/entra/msal/dotnet/acquiring-tokens/web-apps-apis/workload-identity-federation)
- [Agent Identity in Foundry](https://learn.microsoft.com/azure/ai-foundry/agents/concepts/agent-identity)

#### Enable OBO

```powershell
azd env set ENABLE_OBO true
azd up
```

This creates a backend API app registration with FIC, sets `api://{backendClientId}` identifier URI, and attempts admin consent. If consent fails, follow the printed instructions.

#### RBAC & Consent Requirements

| Requirement | Who | What | Why |
|-------------|-----|------|-----|
| **FIC creation** | Deployer | `Application Administrator` role in Entra ID | To create the federated identity credential on the backend app |
| **Admin consent** | Entra admin | Grant **Azure Machine Learning Services / `user_impersonation`** delegated permission | The OBO token exchange requests `https://ai.azure.com/.default` which resolves to Azure Machine Learning Services (appId: `18a66f5f-dbdf-4c17-9dd7-1634712a9cbe`). Without admin consent, token acquisition fails with `AADSTS65001`. |
| **User RBAC** | Each user | `Azure AI User` role on the Foundry resource | OBO tokens carry the user's identity; the user needs data-plane permissions ([docs](https://learn.microsoft.com/azure/ai-foundry/concepts/rbac-foundry)) |
| **Known client** | Deployer (optional) | Add SPA client ID to backend app's `knownClientApplications` | Enables combined consent prompt so users consent to both SPA + backend in one step ([docs](https://learn.microsoft.com/entra/identity-platform/v2-oauth2-on-behalf-of-flow#default-and-combined-consent)) |

> **⚠️ Common mistake: consenting to the wrong service.** The Azure portal shows "Microsoft Cognitive Services" (`https://cognitiveservices.azure.com`, appId: `7d312290-...`) which looks like the right choice — but `AIProjectClient` actually requests tokens for `https://ai.azure.com/.default` which maps to **Azure Machine Learning Services** (appId: `18a66f5f-dbdf-4c17-9dd7-1634712a9cbe`). These are **different first-party service principals**. You must consent to the correct one:
>
> ```bash
> # Add the CORRECT permission (Azure Machine Learning Services, not Cognitive Services)
> az ad app permission add \
>   --id <your-backend-app-id> \
>   --api 18a66f5f-dbdf-4c17-9dd7-1634712a9cbe \
>   --api-permissions 1a7925b5-f871-417a-9b8b-303f9f29fa10=Scope
>
> # Then grant admin consent
> az ad app permission admin-consent --id <your-backend-app-id>
> ```
>
> Or in the portal: API permissions → Add → "APIs my organization uses" → search **"Azure Machine Learning"** → `user_impersonation` (Delegated).

#### OBO Gotchas

| Gotcha | Detail |
|--------|--------|
| **Wrong consent target** | Portal shows "Microsoft Cognitive Services" (`cognitiveservices.azure.com`, appId `7d312290-...`) — this is NOT correct. `AIProjectClient` uses `ai.azure.com/.default` → **Azure Machine Learning Services** (appId `18a66f5f-...`). Consenting to wrong one gives green checkmark but runtime `AADSTS65001`. |
| **Tool identity is separate** | OBO only affects the Agent Service API caller. Agent tools (MCP, OpenAPI, Logic Apps) use the agent's identity from Foundry portal. Configure [Agent Identity](https://learn.microsoft.com/azure/ai-foundry/agents/concepts/agent-identity) separately for per-user tool access. |
| **Conversations not user-scoped in MI mode** | MI uses a shared identity — all users see all conversations. OBO provides per-user isolation. |
| **Local dev uses CLI credentials** | OBO requires a managed identity for FIC. Locally, the app uses `az login` credentials regardless of `ENTRA_BACKEND_CLIENT_ID`. |

## Project Structure

```text
├── backend/WebApp.Api/          # ASP.NET Core API + serves frontend
├── frontend/                     # React + TypeScript + Vite
├── infra/                        # Bicep infrastructure templates
├── deployment/
│   ├── hooks/                    # azd lifecycle automation
│   ├── scripts/                  # User commands
│   └── docker/                   # Multi-stage Dockerfile
└── .github/
    ├── copilot-instructions.md   # Architecture overview (always loaded)
    ├── hooks/                    # Agent hooks (commit gate, custom policies)
    └── skills/                   # 18 on-demand AI assistant skills
```

## License

MIT — see [LICENSE](LICENSE). This template is published by Microsoft under the
same MIT terms as the official Microsoft sample
[`Azure-Samples/get-started-with-ai-agents`](https://github.com/Azure-Samples/get-started-with-ai-agents),
which is the React/Fluent UI Copilot reference this app's chat interface was
built on top of (same `@fluentui-copilot/*` component libraries, same
streaming-chat patterns). You may use, modify, and redistribute this code —
including in commercial and white-label products — subject to the MIT license.

> **Third-party packages.** The MIT grant covers this template's source code
> only. Each runtime dependency (npm and NuGet) is governed by its own
> license — review and accept them independently before redistribution. In
> particular, verify the current `@fluentui-copilot/*` package terms on npm:
> Microsoft's reuse of these packages in `Azure-Samples/get-started-with-ai-agents`
> indicates the component model is intended for sample/template reuse, but it
> does not by itself license those packages to you.