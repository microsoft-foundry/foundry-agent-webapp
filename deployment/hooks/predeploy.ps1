#!/usr/bin/env pwsh
# Pre-deploy: Build container (local Docker if available, ACR cloud build as fallback)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot/modules/HookLogging.ps1"
Start-HookLog -HookName "predeploy" -EnvironmentName $env:AZURE_ENV_NAME

Write-Host "Pre-Deploy: Building Container Image" -ForegroundColor Cyan

# Get required values — azd injects env vars into hooks, but `azd env get-value` may fail
# if the subprocess can't locate azure.yaml. Fall back to $env: vars.
function Get-AzdValue($name) {
    $val = (azd env get-value $name 2>&1) | Where-Object { $_ -notmatch 'ERROR|WARNING' } | Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace($val)) { $val = [Environment]::GetEnvironmentVariable($name) }
    return $val
}

$clientId = Get-AzdValue 'ENTRA_SPA_CLIENT_ID'
$tenantId = Get-AzdValue 'ENTRA_TENANT_ID'
$backendClientId = Get-AzdValue 'ENTRA_BACKEND_CLIENT_ID'
$appInsightsConnStr = Get-AzdValue 'APPLICATIONINSIGHTS_FRONTEND_CONNECTION_STRING'
# Escape semicolons for ACR cloud builds — unescaped semicolons are interpreted as shell command separators
if ($appInsightsConnStr) { $appInsightsConnStrEscaped = $appInsightsConnStr -replace ';', '\;' } else { $appInsightsConnStrEscaped = '' }
$acrName = Get-AzdValue 'AZURE_CONTAINER_REGISTRY_NAME'
$resourceGroup = Get-AzdValue 'AZURE_RESOURCE_GROUP_NAME'
$containerApp = Get-AzdValue 'AZURE_CONTAINER_APP_NAME'

if (-not $clientId -or -not $tenantId) {
    Write-Host "[ERROR] ENTRA_SPA_CLIENT_ID or ENTRA_TENANT_ID not set" -ForegroundColor Red
    exit 1
}
if (-not $acrName) {
    Write-Host "[ERROR] AZURE_CONTAINER_REGISTRY_NAME not set" -ForegroundColor Red
    exit 1
}

$imageTag = "deploy-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
$imageName = "$acrName.azurecr.io/web:$imageTag"

# Check Docker availability
$dockerAvailable = $false
if (Get-Command docker -EA SilentlyContinue) {
    $dockerVersion = docker version --format '{{.Server.Version}}' 2>$null
    if ($LASTEXITCODE -eq 0 -and $dockerVersion) {
        $dockerAvailable = $true
        Write-Host "[OK] Docker v$dockerVersion" -ForegroundColor Green
    }
}

$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Push-Location $projectRoot

try {
    if ($dockerAvailable) {
        Write-Host "Building with local Docker..." -ForegroundColor Cyan
        $buildArgs = @(
            "--platform", "linux/amd64",
            "--build-arg", "ENTRA_SPA_CLIENT_ID=$clientId",
            "--build-arg", "ENTRA_TENANT_ID=$tenantId"
        )
        if ($backendClientId) { $buildArgs += @("--build-arg", "ENTRA_BACKEND_CLIENT_ID=$backendClientId") }
        if ($appInsightsConnStr) { $buildArgs += @("--build-arg", "APPLICATIONINSIGHTS_FRONTEND_CONNECTION_STRING=$appInsightsConnStr") }
        $buildArgs += @("-f", "deployment/docker/frontend.Dockerfile", "-t", $imageName, ".")
        docker build @buildArgs 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "Docker build failed" }
        
        Write-Host "Pushing to ACR..." -ForegroundColor Cyan
        az acr login --name $acrName | Out-Null
        docker push $imageName 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "Docker push failed" }
    } else {
        Write-Host "Using ACR cloud build (3-5 min)..." -ForegroundColor Yellow
        $acrBuildArgs = @("--build-arg", "ENTRA_SPA_CLIENT_ID=$clientId", "--build-arg", "ENTRA_TENANT_ID=$tenantId")
        if ($backendClientId) { $acrBuildArgs += @("--build-arg", "ENTRA_BACKEND_CLIENT_ID=$backendClientId") }
        if ($appInsightsConnStrEscaped) { $acrBuildArgs += @("--build-arg", "APPLICATIONINSIGHTS_FRONTEND_CONNECTION_STRING=$appInsightsConnStrEscaped") }
        $buildOutput = az acr build --registry $acrName --resource-group $env:AZURE_RESOURCE_GROUP_NAME --image "web:$imageTag" `
            @acrBuildArgs `
            --file deployment/docker/frontend.Dockerfile . `
            --no-logs --only-show-errors 2>&1

        if ($LASTEXITCODE -ne 0) {
            Write-Host "Build output: $buildOutput" -ForegroundColor Red
            throw "ACR build failed"
        }
        Write-Host "[OK] ACR build completed" -ForegroundColor Green
    }
    Write-Host "[OK] Image built: $imageName" -ForegroundColor Green
    
    # Update Container App (skip if doesn't exist yet - first azd up uses placeholder)
    if ($containerApp -and $resourceGroup) {
        $exists = az containerapp show --name $containerApp --resource-group $resourceGroup --query name -o tsv 2>$null
        if ($exists) {
            Write-Host "Updating Container App..." -ForegroundColor Cyan
            az containerapp update --name $containerApp --resource-group $resourceGroup `
                --image $imageName --output none
            if ($LASTEXITCODE -ne 0) { throw "Container App update failed" }
            Write-Host "[OK] Container App updated" -ForegroundColor Green
        } else {
            Write-Host "[SKIP] Container App not yet provisioned (first run)" -ForegroundColor Yellow
        }
    }
    
    azd env set SERVICE_WEB_IMAGE_NAME $imageName 2>$null
} finally {
    Pop-Location
}

if ($script:HookLogFile) {
    Write-Host "[LOG] Log file: $script:HookLogFile" -ForegroundColor DarkGray
}
Stop-HookLog
