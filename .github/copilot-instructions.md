Azure AI Foundry Agent Service sample app — Entra ID auth, SSE streaming, Container Apps deployment.

## Architecture

| Layer | Tech | Port | Entry Point |
|-------|------|------|-------------|
| **Frontend** | React 19 + Vite | 5173 | `frontend/src/App.tsx` |
| **Backend** | ASP.NET Core 9 | 8080 | `backend/WebApp.Api/Program.cs` |
| **Auth** | MSAL.js → JWT Bearer | — | `frontend/src/config/authConfig.ts` |
| **AI SDK** | Azure.AI.Projects (GA) + Azure.AI.Extensions.OpenAI | — | `backend/.../AgentFrameworkService.cs` |
| **Deploy** | Azure Container Apps | — | `infra/main.bicep` |

**Key Flow**: React → MSAL token → POST /api/chat/stream → AI Foundry → SSE chunks → UI

## Design Decisions

- **Single container** — Backend serves API (`/api/*`) and React SPA from `wwwroot`, deployed as one Container App resource.
- **Credential strategy** — Production: `ManagedIdentityCredential` (user-assigned MI) or `OnBehalfOfCredential` (OBO) — mutually exclusive, controlled by `ENTRA_BACKEND_CLIENT_ID` env var. Development: `ChainedTokenCredential(AzureCliCredential, AzureDeveloperCliCredential)`.
- **OBO admin consent** — `AIProjectClient` scope `https://ai.azure.com/.default` resolves to **Azure Machine Learning Services** (appId `18a66f5f-...`). Admin consent must target this service principal.
- **OBO scope** — `OnBehalfOfCredential` authenticates Agent Service API calls. Agent tools (MCP, OpenAPI, Logic Apps) use the agent's own identity from Foundry portal.
- **User-assigned MI** — Created in the infrastructure module; used for ACR pull (`AcrPull` role) and reused for OBO FIC when enabled.
- **`.npmrc`** — Configures `--legacy-peer-deps` for React 19 peer-dep resolution. Run `npm install` from `frontend/` directory.
- **Observability** — Separate Application Insights resources for backend (OpenTelemetry via `Azure.Monitor.OpenTelemetry.AspNetCore`) and frontend (`@microsoft/applicationinsights-web`), sharing one Log Analytics workspace. Backend connection string is an env var; frontend connection string is injected at Docker build time via `VITE_APPLICATIONINSIGHTS_CONNECTION_STRING`.

## Deployment (Non-Obvious)

`azd up` phases: **preprovision** → **provision** (Bicep) → **postprovision** → **predeploy** → **deploy**

**What's intentionally CLI (not Bicep)**:
- **Entra redirect URI + identifierUri update** — Entra app is created by Bicep (`infra/entra-app.bicep`), but `identifierUri` (`api://{appId}`) can't reference the auto-generated `appId` in the same declaration, and redirect URIs need the Container App FQDN which isn't available until after provision. Both are set in `postprovision.ps1`.
- **Federated Identity Credential (FIC)** — FIC is a child of the backend app registration. Graph API eventual consistency causes the FIC to fail when created in the same Bicep deployment as its parent app. Created in `postprovision.ps1` after Graph has replicated.
- **AI Foundry discovery** — Discovers user's *existing* external AI Foundry resource via `az cognitiveservices account list`. This is a data-plane discovery operation, not resource deployment.
- **Cross-RG RBAC** — Done via CLI so `azd down` only deletes our resource group, not the external AI Foundry resources.
- **Entra app deletion** — Microsoft Graph resources are not tied to Azure resource groups; `azd down` (which deletes the RG) won't clean them up. `postdown.ps1` handles this.

**Health probes** are conditional: disabled when placeholder image is deployed (first provision), enabled when real image exists.

**Service Management Reference**: Some orgs (notably Microsoft) require this on Entra app registrations. Set via `azd env set ENTRA_SERVICE_MANAGEMENT_REFERENCE <guid>` before running `azd up`; Bicep passes it to the Microsoft Graph extension.

## Documentation Rules

- **Reference `*.csproj` or `package.json` for versions** — keep docs version-free
- **State current behavior** — not how we got here
- **State each fact once, cross-reference elsewhere**
- **Document only non-obvious behavior** that cannot be inferred from code

## Development

```powershell
# Ctrl+Shift+B → "Start Dev (VS Code Terminals)"
# Or: azd up
```

## Hooks

| Hook | Event | What It Does |
|------|-------|-------------|
| **Commit Gate** | `preToolUse` | Blocks direct `git commit`. Follow `committing-code` skill → commit via `-F COMMIT_MESSAGE.md`. |
| **Test Reminder** | `preToolUse` | Advisory: reminds to run tests if test files exist for staged changes. |
| **Doc Sync** | `postToolUse` | Reminds to update `ARCHITECTURE-FLOW.md` when architecture-sensitive files are edited. |
