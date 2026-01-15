# Azure Developer CLI Hooks

**AI Assistance**: See `.github/skills/deploying-to-azure/SKILL.md` for deployment patterns.

## Hook Execution Order

| Phase | Command | Hooks Executed | Duration |
|-------|---------|----------------|----------|
| **Deploy** | `azd up` | preprovision → provision → postprovision → predeploy | 10-12 min |
| **Code Only** | `azd deploy` | predeploy | 3-5 min |
| **Teardown** | `azd down` | (resources deleted) → postdown | 2-3 min |
| **Reprovision** | `azd provision` | preprovision → provision → postprovision | 2-3 min |

## Logging

All hooks now start a PowerShell transcript automatically and write logs to `.azure/<env>/logs/` with timestamped filenames (one per hook run). The transcript captures the same console output shown during `azd` execution for post-run troubleshooting.

## Hook Details

| Hook | Purpose | Key Actions | Outputs |
|------|---------|-------------|---------|
| **preprovision.ps1** | Create Entra app + discover AI Foundry + generate config | • Discovers AI Foundry resources<br>• Creates Entra SPA app<br>• Generates `.env` files | `.env` and `.env.local` files |
| **postprovision.ps1** | Configure Entra + RBAC | • Updates redirect URIs with production URL<br>• Assigns Cognitive Services User role to AI Foundry | Configured Entra app + RBAC |
| **predeploy.ps1** | Build container image | • Detects Docker availability<br>• Local Docker build + push OR ACR cloud build<br>• Updates Container App if it exists | Container image in ACR |
| **postdown.ps1** | Cleanup (optional) | • Removes RBAC assignment<br>• Deletes Entra app<br>• Optionally removes Docker images | Clean slate |

## Module Scripts

### modules/New-EntraAppRegistration.ps1

Reusable module for creating Entra ID app registrations with PKCE flow.

**Usage**:
```powershell
$clientId = & ".\modules\New-EntraAppRegistration.ps1" `
    -AppName "my-app" `
    -TenantId $tenantId `
    -RedirectUris @("http://localhost:5173")
```

### modules/Get-AIFoundryAgents.ps1

Discovers agents in an Azure AI Foundry project via REST API (`/agents?api-version=2025-11-15-preview`).

**Usage**:
```powershell
# Basic usage
$agents = & "$PSScriptRoot/modules/Get-AIFoundryAgents.ps1" `
    -ProjectEndpoint $endpoint

# Quiet mode (suppress console output)
$agents = & "$PSScriptRoot/modules/Get-AIFoundryAgents.ps1" `
    -ProjectEndpoint $endpoint -Quiet

# Custom token
$agents = & "$PSScriptRoot/modules/Get-AIFoundryAgents.ps1" `
    -ProjectEndpoint $endpoint -AccessToken $token
```

**Returns**: Array of agent objects (`name`, `id`, `versions`). Handles pagination automatically.

## Testing

```powershell
# Test individual hooks
.\hooks\preprovision.ps1
.\hooks\postprovision.ps1  # Requires provisioned infrastructure
.\hooks\postdown.ps1

# Test full flow
azd up
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| App registration fails with policy error | Run `azd env set ENTRA_SERVICE_MANAGEMENT_REFERENCE 'guid'` (see note below) |
| Preprovision fails | Verify Azure CLI auth: `az account show` |
| Predeploy Docker build fails | Check Docker running: `docker version` (falls back to ACR cloud build) |
| AI Foundry not found | Create resource at https://ai.azure.com |
| Multiple AI Foundry resources | Set `AI_FOUNDRY_RESOURCE_NAME` or select when prompted |
| RBAC assignment fails | Verify you have User Access Administrator role on AI Foundry resource |

### App Registration Policies

Some organizations require [`serviceManagementReference`](https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.applications/invoke-mginstantiateapplicationtemplate) for app registrations.

**Quick fix**:
```powershell
azd env set ENTRA_SERVICE_MANAGEMENT_REFERENCE 'your-guid-here'
azd up
```

**Persistent fix** (environment variable):
```powershell
[System.Environment]::SetEnvironmentVariable('ENTRA_SERVICE_MANAGEMENT_REFERENCE', 'your-guid-here', 'User')
# Restart terminal
```

Contact your Entra ID admin for the required GUID.

### Multiple AI Foundry Resources

If you have multiple AI Foundry resources in your subscription, the preprovision hook will prompt you to select one. 

**To skip the prompt**, pre-configure your preferred resource:
```bash
azd env set AI_FOUNDRY_RESOURCE_NAME "your-ai-foundry-resource-name"
```

## Customization

### Change Default Behavior

| Change | File | Modification |
|--------|------|-------------|
| Always clean Docker images | `postdown.ps1` | Set `$cleanDockerImages = $true` |
| Change ports | `start-local-dev.ps1` + Entra app URIs | Update port references |
| Skip auto-opening browser | `postprovision.ps1` | Comment out `Start-Process` line |
