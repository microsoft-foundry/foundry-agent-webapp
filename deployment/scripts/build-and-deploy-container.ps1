#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Shared module for building and deploying container images

.DESCRIPTION
    This module contains the core logic for:
    1. Building Docker images (local or ACR cloud build)
    2. Pushing to Azure Container Registry
    3. Updating Azure Container Apps
    
    Used by both postprovision.ps1 (azd up) and deploy.ps1 (standalone deployment)

.PARAMETER ClientId
    Entra SPA Client ID to embed in the frontend build

.PARAMETER TenantId
    Entra Tenant ID to embed in the frontend build

.PARAMETER ResourceGroup
    Azure Resource Group containing the Container App

.PARAMETER ContainerApp
    Azure Container App name

.PARAMETER AcrName
    Azure Container Registry name

.EXAMPLE
    .\build-and-deploy-container.ps1 -ClientId "xxx" -TenantId "yyy" -ResourceGroup "rg-name" -ContainerApp "ca-name" -AcrName "acr-name"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$ClientId,
    
    [Parameter(Mandatory=$true)]
    [string]$TenantId,
    
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroup,
    
    [Parameter(Mandatory=$true)]
    [string]$ContainerApp,
    
    [Parameter(Mandatory=$true)]
    [string]$AcrName
)

$ErrorActionPreference = "Stop"

# Generate unique image tag
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$imageTag = "azd-deploy-$timestamp"
$imageName = "$AcrName.azurecr.io/ai-foundry-agent/web-dev:$imageTag"

Write-Host "Image: $imageName" -ForegroundColor White

# Check if Docker is available and running
$dockerAvailable = $false
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue

if ($dockerCommand) {
    # Docker command exists, verify daemon is running
    $dockerVersion = docker version --format '{{.Server.Version}}' 2>$null
    if ($LASTEXITCODE -eq 0 -and $dockerVersion) {
        $dockerAvailable = $true
        Write-Host "[OK] Docker daemon is running (version: $dockerVersion)" -ForegroundColor Gray
    } else {
        Write-Host "[!] Docker is installed but not running. Using ACR cloud build instead..." -ForegroundColor Yellow
    }
} else {
    Write-Host "[!] Docker not installed, using ACR cloud build..." -ForegroundColor Gray
}
Write-Host ""

# Get project root (script is in deployment/scripts)
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

if ($dockerAvailable) {
    # Local Docker build
    Write-Host "Building Docker image locally..." -ForegroundColor Cyan
    
    Push-Location $projectRoot
    try {
        $dockerfilePath = Join-Path "deployment" "docker" "frontend.Dockerfile"
        docker build `
            --platform linux/amd64 `
            --build-arg ENTRA_SPA_CLIENT_ID=$ClientId `
            --build-arg ENTRA_TENANT_ID=$TenantId `
            -f $dockerfilePath `
            -t $imageName `
            . 2>&1 | Out-Host

        if ($LASTEXITCODE -ne 0) {
            throw "Docker build failed"
        }

        Write-Host "[OK] Docker image built successfully" -ForegroundColor Green
        Write-Host ""

        # Push to ACR
        Write-Host "Pushing image to Azure Container Registry..." -ForegroundColor Cyan

        az acr login --name $AcrName | Out-Null

        docker push $imageName 2>&1 | Out-Host

        if ($LASTEXITCODE -ne 0) {
            throw "Docker push failed"
        }

        Write-Host "[OK] Image pushed to ACR" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
} else {
    # ACR cloud build
    Write-Host "Using Azure Container Registry cloud build..." -ForegroundColor Cyan
    Write-Host "(This may take 3-5 minutes - showing live logs)" -ForegroundColor Gray
    Write-Host ""
    
    Push-Location $projectRoot
    try {
        # Use ACR build without streaming logs to avoid Windows encoding issues
        Write-Host "Starting ACR build (build ID will be shown)..." -ForegroundColor Gray
        Write-Host ""
        
        # Capture the build output to get the run ID
        $buildOutput = az acr build `
            --registry $AcrName `
            --image "ai-foundry-agent/web-dev:$imageTag" `
            --platform linux/amd64 `
            --build-arg ENTRA_SPA_CLIENT_ID=$ClientId `
            --build-arg ENTRA_TENANT_ID=$TenantId `
            --file .\deployment\docker\frontend.Dockerfile `
            --no-logs `
            . 2>&1
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host $buildOutput -ForegroundColor Red
            throw "ACR build failed with exit code $LASTEXITCODE"
        }

        # Extract run ID from output
        $runId = ($buildOutput | Select-String -Pattern "Queued a build with ID: (\w+)" | ForEach-Object { $_.Matches.Groups[1].Value })
        
        if ($runId) {
            Write-Host "ACR Build ID: $runId" -ForegroundColor Cyan
            Write-Host "Logs: az acr task logs -r $AcrName --run-id $runId" -ForegroundColor Gray
        }

        Write-Host ""
        Write-Host "[OK] Image built and pushed to ACR" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
}
Write-Host ""

# Update Container App
Write-Host "Updating Container App with new image..." -ForegroundColor Cyan

az containerapp update `
    --name $ContainerApp `
    --resource-group $ResourceGroup `
    --image $imageName `
    --output none

if ($LASTEXITCODE -ne 0) {
    throw "Container app update failed"
}

Write-Host "[OK] Container App updated" -ForegroundColor Green
Write-Host ""

# Wait for deployment to stabilize
Write-Host "Waiting for deployment to stabilize..." -ForegroundColor Cyan
Start-Sleep -Seconds 15

Write-Host "[OK] Deployment complete" -ForegroundColor Green
Write-Host ""

# Return the Container App URL for the caller
$containerAppUrl = az containerapp show `
    --name $ContainerApp `
    --resource-group $ResourceGroup `
    --query "properties.configuration.ingress.fqdn" `
    -o tsv

if ($containerAppUrl) {
    $fullUrl = "https://$containerAppUrl"
    Write-Output $fullUrl
}
