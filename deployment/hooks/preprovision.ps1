#!/usr/bin/env pwsh

# Set environment variable to fix Azure CLI Unicode encoding issues
$env:PYTHONIOENCODING = "utf-8"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Pre-Provision: Entra ID App Registration" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Validate prerequisites
Write-Host "Validating prerequisites..." -ForegroundColor Cyan

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Error "Azure CLI not found. Install from https://aka.ms/azure-cli"
    exit 1
}

$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Error "Not logged in to Azure. Run 'azd auth login' or 'az login'"
    exit 1
}

Write-Host "[OK] Azure CLI authenticated as: $($account.user.name)" -ForegroundColor Green

# Get environment variables from azd
$envName = (azd env get-value AZURE_ENV_NAME 2>&1) | Where-Object { $_ -notmatch 'ERROR' } | Select-Object -First 1
$envName = if ($envName) { $envName.ToString().Trim() } else { $null }

if ([string]::IsNullOrWhiteSpace($envName)) {
    # Fallback to environment variable for backward compatibility
    $envName = $env:AZURE_ENV_NAME
}

if ([string]::IsNullOrWhiteSpace($envName)) {
    Write-Error "AZURE_ENV_NAME not set. Run 'azd init' first."
    exit 1
}

$tenantId = (azd env get-value ENTRA_TENANT_ID 2>&1) | Where-Object { $_ -notmatch 'ERROR' } | Select-Object -First 1
$tenantId = if ($tenantId) { $tenantId.ToString().Trim() } else { $null }

if ([string]::IsNullOrWhiteSpace($tenantId)) {
    # Auto-detect from current Azure CLI session
    Write-Host "Auto-detecting tenant ID from Azure CLI..." -ForegroundColor Cyan
    $tenantId = $account.tenantId
    if ($tenantId) {
        # Save to azd environment for future use
        azd env set ENTRA_TENANT_ID $tenantId
        Write-Host "[OK] Detected and saved tenant ID: $tenantId" -ForegroundColor Green
    } else {
        Write-Error "Could not detect tenant ID. Run 'azd env set ENTRA_TENANT_ID <tenant-id>'"
        exit 1
    }
} else {
    Write-Host "[OK] Using configured tenant ID: $tenantId" -ForegroundColor Green
}

Write-Host "[OK] Environment: $envName" -ForegroundColor Green

# Create or update app registration (localhost only at this stage)
$appName = "ai-foundry-agent-$envName"

Write-Host ""
Write-Host "Creating app registration with localhost redirect URIs..." -ForegroundColor Cyan
Write-Host "(Production URL will be added after infrastructure deployment)" -ForegroundColor Gray

function Select-Index {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Items,
        [Parameter(Mandatory = $true)]
        [string]$Title,
        [Parameter(Mandatory = $true)]
        [scriptblock]$GetLabel
    )

    # Prefer PromptForChoice because it works in more hosts (including VS Code)
    # than relying on stdin being a true console/TTY.
    try {
        if ($Host -and $Host.UI -and $Host.UI.PromptForChoice) {
            $choices = @()
            for ($i = 0; $i -lt $Items.Count; $i++) {
                $label = & $GetLabel $Items[$i] $i
                # Use numeric accelerators when possible.
                $hotKey = if ($i -lt 9) { "&$($i + 1)" } else { "&$($i + 1)" }
                $choices += New-Object System.Management.Automation.Host.ChoiceDescription("$hotKey $label")
            }

            $caption = $Title
            $message = "Select an option:" 
            $defaultChoice = 0
            $selected = $Host.UI.PromptForChoice($caption, $message, $choices, $defaultChoice)
            if ($selected -ge 0 -and $selected -lt $Items.Count) {
                return $selected
            }
        }
    } catch {
        # fall back to Read-Host below
    }

    # Fall back to Read-Host if available.
    try {
        Write-Host "" 
        for ($i = 0; $i -lt $Items.Count; $i++) {
            $label = & $GetLabel $Items[$i] $i
            Write-Host "  [$($i+1)] $label" -ForegroundColor White
        }
        Write-Host "" 

        $selection = Read-Host "Please select (1-$($Items.Count))"
        $selectionNum = 0
        if ([int]::TryParse($selection, [ref]$selectionNum) -and $selectionNum -ge 1 -and $selectionNum -le $Items.Count) {
            return ($selectionNum - 1)
        }
    } catch {
        # ignore
    }

    return -1
}

try {
    # Optional: Service Management Reference for organizations with custom app registration policies
    # Can be set via environment variable if your organization requires it
    $serviceManagementRef = $env:ENTRA_SERVICE_MANAGEMENT_REFERENCE
    
    if (-not [string]::IsNullOrWhiteSpace($serviceManagementRef)) {
        Write-Host "Using Service Management Reference from environment variable" -ForegroundColor Gray
    }
    
    # Call app registration script with optional Service Management Reference
    $params = @{
        AppName = $appName
        TenantId = $tenantId
    }
    
    if (-not [string]::IsNullOrWhiteSpace($serviceManagementRef)) {
        $params.ServiceManagementReference = $serviceManagementRef
    }
    
    $clientId = & "$PSScriptRoot/modules/New-EntraAppRegistration.ps1" @params

    if (-not $clientId) {
        Write-Error "Failed to create/retrieve app registration"
        exit 1
    }

    # Store client ID in azd environment
    Write-Host "Saving client ID to azd environment..." -ForegroundColor Cyan
    azd env set ENTRA_SPA_CLIENT_ID $clientId

    Write-Host "[OK] Client ID saved: $clientId" -ForegroundColor Green

    # Discover AI Foundry Resource
    Write-Host ""
    Write-Host "Discovering Azure AI Foundry resources..." -ForegroundColor Cyan
    
    # Check if already configured
    $existingEndpoint = (azd env get-value AI_AGENT_ENDPOINT 2>&1) | Where-Object { $_ -notmatch 'ERROR' } | Select-Object -First 1
    $existingResourceGroup = (azd env get-value AI_FOUNDRY_RESOURCE_GROUP 2>&1) | Where-Object { $_ -notmatch 'ERROR' } | Select-Object -First 1
    $existingResourceName = (azd env get-value AI_FOUNDRY_RESOURCE_NAME 2>&1) | Where-Object { $_ -notmatch 'ERROR' } | Select-Object -First 1
    $existingAgentId = (azd env get-value AI_AGENT_ID 2>&1) | Where-Object { $_ -notmatch 'ERROR' } | Select-Object -First 1
    
    if (-not [string]::IsNullOrWhiteSpace($existingEndpoint) -and 
        -not [string]::IsNullOrWhiteSpace($existingResourceGroup) -and 
        -not [string]::IsNullOrWhiteSpace($existingResourceName)) {
        Write-Host "[OK] Using pre-configured AI Foundry resource:" -ForegroundColor Green
        Write-Host "  Resource: $existingResourceName" -ForegroundColor Gray
        Write-Host "  Resource Group: $existingResourceGroup" -ForegroundColor Gray
        Write-Host "  Endpoint: $existingEndpoint" -ForegroundColor Gray
        
        # Validate user has permissions on the resource group for RBAC assignment
        Write-Host ""
        Write-Host "Validating permissions for RBAC assignment..." -ForegroundColor Cyan
        $hasPermission = az role assignment list --scope "/subscriptions/$($account.id)/resourceGroups/$existingResourceGroup" `
            --assignee $account.user.name `
            --query "[?roleDefinitionName=='Owner' || roleDefinitionName=='User Access Administrator' || roleDefinitionName=='Contributor'].roleDefinitionName" `
            --output tsv 2>$null
        
        if ($hasPermission) {
            Write-Host "[OK] Verified permissions for RBAC assignment" -ForegroundColor Green
        } else {
            Write-Host "[!]  Warning: You may not have permissions to assign RBAC roles" -ForegroundColor Yellow
            Write-Host "   The deployment will configure the Container App's managed identity to access the AI Foundry resource." -ForegroundColor Gray
            Write-Host "   If RBAC assignment fails, ask your subscription admin to grant 'User Access Administrator' role." -ForegroundColor Gray
        }
        
        if (-not [string]::IsNullOrWhiteSpace($existingAgentId)) {
            Write-Host "  Agent: $existingAgentId" -ForegroundColor Gray
        } else {
            # Try to discover agent even with pre-configured endpoint
            try {
                $allAgents = & "$PSScriptRoot/modules/Get-AIFoundryAgents.ps1" -ProjectEndpoint $existingEndpoint
                
                if ($allAgents -and $allAgents.Count -gt 0) {
                    if ($allAgents.Count -eq 1) {
                        Write-Host "  Agent: $($allAgents[0].name)" -ForegroundColor Gray
                        azd env set AI_AGENT_ID $allAgents[0].name
                    } else {
                        Write-Host "  Found $($allAgents.Count) agents, using first: $($allAgents[0].name)" -ForegroundColor Gray
                        azd env set AI_AGENT_ID $allAgents[0].name
                    }
                }
            } catch {
                # Silently continue if discovery fails for pre-configured resources
            }
        }
    } else {
        Write-Host "Searching for AI Foundry resources (kind=AIServices) in subscription..." -ForegroundColor Cyan
        
        $aiFoundryResources = az cognitiveservices account list --query "[?kind=='AIServices']" | ConvertFrom-Json
        
        if (-not $aiFoundryResources -or $aiFoundryResources.Count -eq 0) {
            Write-Host ""
            Write-Error @"
No Azure AI Foundry resources found in subscription.

To use this application, you need an Azure AI Foundry resource with a project and agent.

Option 1 - Create a new AI Foundry resource:
  1. Visit https://ai.azure.com
  2. Create a new AI Foundry resource and project
  3. Create an agent in the project
  4. Run 'azd up' again

Option 2 - Manually configure (if resource is in different subscription):
  azd env set AI_FOUNDRY_RESOURCE_GROUP <resource-group>
  azd env set AI_FOUNDRY_RESOURCE_NAME <resource-name>
  azd env set AI_AGENT_ENDPOINT <endpoint>
  azd env set AI_AGENT_ID <agent-name>

For more information, visit: https://learn.microsoft.com/azure/ai-foundry
"@
            exit 1
        }
        
        if ($aiFoundryResources.Count -eq 1) {
            $selectedResource = $aiFoundryResources[0]
            Write-Host "[OK] Found 1 AI Foundry resource: $($selectedResource.name)" -ForegroundColor Green
        } else {
            # Multiple resources found - try configured selection first, otherwise prompt (interactive) or fail (non-interactive).
            $selectedResource = $null

            $configuredResourceName = if ($existingResourceName) { $existingResourceName.ToString().Trim() } else { $null }
            $configuredResourceGroup = if ($existingResourceGroup) { $existingResourceGroup.ToString().Trim() } else { $null }

            if (-not [string]::IsNullOrWhiteSpace($configuredResourceName)) {
                $matched = @($aiFoundryResources | Where-Object { $_.name -eq $configuredResourceName })
                if ($matched.Count -ge 1) {
                    $selectedResource = $matched[0]
                    Write-Host "[OK] Using configured AI Foundry resource name: $($selectedResource.name)" -ForegroundColor Green
                } else {
                    Write-Host "[!]  Configured AI_FOUNDRY_RESOURCE_NAME '$configuredResourceName' not found in current subscription." -ForegroundColor Yellow
                }
            }

            if (-not $selectedResource -and -not [string]::IsNullOrWhiteSpace($configuredResourceGroup)) {
                $matched = @($aiFoundryResources | Where-Object { $_.resourceGroup -eq $configuredResourceGroup })
                if ($matched.Count -eq 1) {
                    $selectedResource = $matched[0]
                    Write-Host "[OK] Using configured AI Foundry resource group: $($selectedResource.resourceGroup)" -ForegroundColor Green
                } elseif ($matched.Count -gt 1) {
                    Write-Host "[!]  Multiple AI Foundry resources exist in resource group '$configuredResourceGroup'." -ForegroundColor Yellow
                } else {
                    Write-Host "[!]  Configured AI_FOUNDRY_RESOURCE_GROUP '$configuredResourceGroup' not found in current subscription." -ForegroundColor Yellow
                }
            }

            if (-not $selectedResource) {
                Write-Host "Found $($aiFoundryResources.Count) AI Foundry resources." -ForegroundColor Cyan

                $selectedIndex = Select-Index -Items $aiFoundryResources -Title "Azure AI Foundry resource selection" -GetLabel { param($res, $i) "$($res.name)  (RG: $($res.resourceGroup), Location: $($res.location))" }

                if ($selectedIndex -lt 0) {
                    # Truly non-interactive host: fall back to deterministic selection to avoid failing `azd up`.
                    Write-Host "" 
                    Write-Host "[!]  Unable to prompt for selection (non-interactive host)." -ForegroundColor Yellow
                    Write-Host "   Falling back to the first resource. To override, set:" -ForegroundColor Gray
                    Write-Host "     azd env set AI_FOUNDRY_RESOURCE_NAME <resource-name>" -ForegroundColor Gray
                    Write-Host "     # (optional) azd env set AI_FOUNDRY_RESOURCE_GROUP <resource-group>" -ForegroundColor Gray
                    $selectedResource = $aiFoundryResources[0]
                } else {
                    $selectedResource = $aiFoundryResources[$selectedIndex]
                }

                Write-Host "[OK] Selected: $($selectedResource.name)" -ForegroundColor Green
            }
        }
        
        # Get projects for the selected resource
        Write-Host "Discovering projects in $($selectedResource.name)..." -ForegroundColor Cyan
        $resourceId = $selectedResource.id
        $projectsUrl = "https://management.azure.com$resourceId/projects?api-version=2025-04-01-preview"
        $projects = az rest --method get --url $projectsUrl --query "value" 2>$null | ConvertFrom-Json
        
        if (-not $projects -or $projects.Count -eq 0) {
            Write-Host ""
            Write-Error @"
No projects found in AI Foundry resource '$($selectedResource.name)'.

To use this application, you need to create a project and agent:
  1. Visit https://ai.azure.com
  2. Open resource: $($selectedResource.name)
  3. Create a new project
  4. Create an agent in the project
  5. Run 'azd up' again

For more information, visit: https://learn.microsoft.com/azure/ai-foundry/quickstarts/get-started-code
"@
            exit 1
        }
        
        $selectedProject = $projects[0]
        $projectName = $selectedProject.name.Split('/')[-1]
        
        if ($projects.Count -eq 1) {
            Write-Host "[OK] Found 1 project: $projectName" -ForegroundColor Green
        } else {
            Write-Host "Found $($projects.Count) projects, using first: $projectName" -ForegroundColor Yellow
        }
        
        # Construct endpoint URL
        $aiEndpoint = "https://$($selectedResource.name).services.ai.azure.com/api/projects/$projectName"
        
        # Save configuration
        azd env set AI_FOUNDRY_RESOURCE_GROUP $selectedResource.resourceGroup
        azd env set AI_FOUNDRY_RESOURCE_NAME $selectedResource.name
        azd env set AI_AGENT_ENDPOINT $aiEndpoint
        
        Write-Host "[OK] Configured AI Foundry resource:" -ForegroundColor Green
        Write-Host "  Resource: $($selectedResource.name)" -ForegroundColor Gray
        Write-Host "  Resource Group: $($selectedResource.resourceGroup)" -ForegroundColor Gray
        Write-Host "  Project: $projectName" -ForegroundColor Gray
        Write-Host "  Endpoint: $aiEndpoint" -ForegroundColor Gray
        
        # Validate user has permissions on the resource group for RBAC assignment
        Write-Host ""
        Write-Host "Validating permissions for RBAC assignment..." -ForegroundColor Cyan
        $hasPermission = az role assignment list --scope "/subscriptions/$($account.id)/resourceGroups/$($selectedResource.resourceGroup)" `
            --assignee $account.user.name `
            --query "[?roleDefinitionName=='Owner' || roleDefinitionName=='User Access Administrator' || roleDefinitionName=='Contributor'].roleDefinitionName" `
            --output tsv 2>$null
        
        if ($hasPermission) {
            Write-Host "[OK] Verified permissions for RBAC assignment" -ForegroundColor Green
        } else {
            Write-Host "[!]  Warning: You may not have permissions to assign RBAC roles" -ForegroundColor Yellow
            Write-Host "   The deployment will configure the Container App's managed identity to access the AI Foundry resource." -ForegroundColor Gray
            Write-Host "   If RBAC assignment fails, ask your subscription admin to grant 'User Access Administrator' role." -ForegroundColor Gray
        }
        
        # Discover or verify agent
        $aiAgentId = (azd env get-value AI_AGENT_ID 2>&1) | Where-Object { $_ -notmatch 'ERROR' } | Select-Object -First 1
        
        if ([string]::IsNullOrWhiteSpace($aiAgentId)) {
            try {
                $allAgents = & "$PSScriptRoot/modules/Get-AIFoundryAgents.ps1" -ProjectEndpoint $aiEndpoint
                
                if ($allAgents -and $allAgents.Count -gt 0) {
                    if ($allAgents.Count -eq 1) {
                        $selectedAgent = $allAgents[0]
                        Write-Host "[OK] Found 1 agent: $($selectedAgent.name)" -ForegroundColor Green
                        $aiAgentId = $selectedAgent.name
                        azd env set AI_AGENT_ID $aiAgentId
                    } else {
                        Write-Host "Found $($allAgents.Count) agents:" -ForegroundColor Yellow
                        for ($i = 0; $i -lt [Math]::Min($allAgents.Count, 5); $i++) {
                            $agent = $allAgents[$i]
                            Write-Host "  [$($i+1)] $($agent.name)" -ForegroundColor Gray
                        }
                        if ($allAgents.Count -gt 5) {
                            Write-Host "  ... and $($allAgents.Count - 5) more" -ForegroundColor Gray
                        }
                        Write-Host ""
                        Write-Host "Using first agent: $($allAgents[0].name)" -ForegroundColor Yellow
                        Write-Host "To use a different agent, run: azd env set AI_AGENT_ID <agent-name>" -ForegroundColor Gray
                        $aiAgentId = $allAgents[0].name
                        azd env set AI_AGENT_ID $aiAgentId
                    }
                }
            } catch {
                Write-Host "[!]  Could not list agents (API error)" -ForegroundColor Yellow
            }
        }
        
        # Final check for agent
        if ([string]::IsNullOrWhiteSpace($aiAgentId)) {
            Write-Host ""
            Write-Host "[!]  Agent not configured" -ForegroundColor Yellow
            Write-Host "You need to specify an agent name to use with this application." -ForegroundColor Yellow
            Write-Host ""
            Write-Host "To set your agent name:" -ForegroundColor Cyan
            Write-Host "  1. Visit https://ai.azure.com" -ForegroundColor Gray
            Write-Host "  2. Open project: $projectName" -ForegroundColor Gray
            Write-Host "  3. Go to 'Agents' and create or select an agent" -ForegroundColor Gray
            Write-Host "  4. Copy the Agent Name from the agent's details" -ForegroundColor Gray
            Write-Host "  5. Run: azd env set AI_AGENT_ID <agent-name>" -ForegroundColor Gray
            Write-Host "  6. Run: azd up" -ForegroundColor Gray
            Write-Host ""
            Write-Error "AI_AGENT_ID is required. Please configure it and run 'azd up' again."
            exit 1
        } else {
            Write-Host "  Agent: $aiAgentId" -ForegroundColor Gray
        }
    }

    # Create .env file for local development (azd's standard location)
    Write-Host ""
    Write-Host "Creating .env file for local development..." -ForegroundColor Cyan
    
    $dotAzurePath = ".azure/$envName"
    $envFilePath = "$dotAzurePath/.env"
    
    # Get current values
    $aiEndpoint = (azd env get-value AI_AGENT_ENDPOINT 2>&1) | Where-Object { $_ -notmatch 'ERROR' } | Select-Object -First 1
    $aiAgentId = (azd env get-value AI_AGENT_ID 2>&1) | Where-Object { $_ -notmatch 'ERROR' } | Select-Object -First 1
    $aiResourceGroup = (azd env get-value AI_FOUNDRY_RESOURCE_GROUP 2>&1) | Where-Object { $_ -notmatch 'ERROR' } | Select-Object -First 1
    $aiResourceName = (azd env get-value AI_FOUNDRY_RESOURCE_NAME 2>&1) | Where-Object { $_ -notmatch 'ERROR' } | Select-Object -First 1
    
    # Load existing azd environment variables
    $existingVars = @{}
    if (Test-Path $envFilePath) {
        foreach ($line in Get-Content $envFilePath) {
            if ($line -match '^([^=]+)=(.*)$') {
                $existingVars[$matches[1]] = $matches[2]
            }
        }
    }
    
    # Update or add our variables
    $existingVars['ENTRA_SPA_CLIENT_ID'] = $clientId
    $existingVars['ENTRA_TENANT_ID'] = $tenantId
    
    if (-not [string]::IsNullOrWhiteSpace($aiEndpoint)) {
        $existingVars['AI_AGENT_ENDPOINT'] = $aiEndpoint
    }
    if (-not [string]::IsNullOrWhiteSpace($aiAgentId)) {
        $existingVars['AI_AGENT_ID'] = $aiAgentId
    }
    if (-not [string]::IsNullOrWhiteSpace($aiResourceGroup)) {
        $existingVars['AI_FOUNDRY_RESOURCE_GROUP'] = $aiResourceGroup
    }
    if (-not [string]::IsNullOrWhiteSpace($aiResourceName)) {
        $existingVars['AI_FOUNDRY_RESOURCE_NAME'] = $aiResourceName
    }
    
    # Write back to file
    $envContent = "# Auto-generated - Do not commit`n# Local development environment variables`n`n"
    foreach ($key in $existingVars.Keys | Sort-Object) {
        $value = $existingVars[$key]
        $envContent += "$key=$value`n"
    }
    
    $envContent | Out-File -FilePath $envFilePath -Encoding utf8 -Force
    Write-Host "[OK] Updated $envFilePath" -ForegroundColor Green
    
    # Create frontend/.env.local for Vite local development
    Write-Host "Creating frontend/.env.local for local development..." -ForegroundColor Cyan
    $frontendEnvPath = "frontend/.env.local"
    $frontendEnvContent = @"
# Auto-generated by azd preprovision hook
# Used by Vite dev server for local development
VITE_ENTRA_SPA_CLIENT_ID=$clientId
VITE_ENTRA_TENANT_ID=$tenantId
"@
    $frontendEnvContent | Out-File -FilePath $frontendEnvPath -Encoding utf8 -Force
    Write-Host "[OK] Created $frontendEnvPath" -ForegroundColor Green
    
    # Create backend .env file for environment variables (simpler than JSON layering)
    Write-Host "Creating backend .env file for local development..." -ForegroundColor Cyan
    $backendEnvPath = "backend/WebApp.Api/.env"
    
    # Get AI Agent configuration from azd environment
    $aiAgentEndpoint = (azd env get-value AI_AGENT_ENDPOINT 2>&1) | Where-Object { $_ -notmatch 'ERROR' } | Select-Object -First 1
    $aiAgentId = (azd env get-value AI_AGENT_ID 2>&1) | Where-Object { $_ -notmatch 'ERROR' } | Select-Object -First 1
    
    $backendEnvContent = @"
# Auto-generated by azd preprovision hook
# Used by ASP.NET Core for local development
# .NET automatically loads .env files in Development environment
AzureAd__Instance=https://login.microsoftonline.com/
AzureAd__TenantId=$tenantId
AzureAd__ClientId=$clientId
AzureAd__Audience=api://$clientId

# Azure AI Agent Service Configuration
AI_AGENT_ENDPOINT=$aiAgentEndpoint
AI_AGENT_ID=$aiAgentId
"@
    $backendEnvContent | Out-File -FilePath $backendEnvPath -Encoding utf8 -Force
    Write-Host "[OK] Created $backendEnvPath" -ForegroundColor Green
    
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Local Development Ready" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Configuration files created for local development:" -ForegroundColor Green
    Write-Host "  • frontend/.env.local (Vite dev server)" -ForegroundColor Gray
    Write-Host "  • backend/WebApp.Api/.env (ASP.NET Core)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "You can start local development anytime with:" -ForegroundColor Yellow
    Write-Host "  .\scripts\start-local-dev.ps1" -ForegroundColor White
    Write-Host ""
    Write-Host "  Backend:  http://localhost:8080" -ForegroundColor Gray
    Write-Host "  Frontend: http://localhost:5173" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Proceeding with Azure infrastructure deployment..." -ForegroundColor Cyan

} catch {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Red
    Write-Host "Pre-Provision Failed" -ForegroundColor Red
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Red
    Write-Host ""

    # The module script already displayed detailed error information
    # Just provide a brief summary and link to docs
    if ($_.Exception.Message -match "App registration creation failed") {
        Write-Host "App registration failed. See error details above." -ForegroundColor Yellow
    } else {
        Write-Error "Unexpected error: $_"
    }

    Write-Host ""
    Write-Host "For troubleshooting steps, see: deployment/hooks/README.md" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "Pre-Provision Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
