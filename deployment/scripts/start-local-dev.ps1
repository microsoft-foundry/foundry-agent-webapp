#!/usr/bin/env pwsh
# Starts local dev servers (backend + frontend with hot reload)
# Prerequisites: .NET 10 SDK, Node.js 18+, frontend/.env.local (from azd up)

param(
    [switch]$SkipBrowser
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

# Check prerequisites
foreach ($cmd in @('dotnet', 'node', 'npm')) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "[ERROR] $cmd not found" -ForegroundColor Red
        exit 1
    }
}
Write-Host "[OK] Prerequisites: dotnet $(dotnet --version), node $(node -v)" -ForegroundColor Green

# Install frontend deps if missing
$frontendPath = Join-Path $projectRoot "frontend"
$nodeModules = Join-Path $frontendPath "node_modules"
if (-not (Test-Path (Join-Path $nodeModules "@azure/msal-react"))) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
    Push-Location $frontendPath
    npm install
    if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }
    Pop-Location
}
Write-Host "[OK] Frontend dependencies" -ForegroundColor Green

# Validate config
$envLocal = Join-Path $frontendPath ".env.local"
if (-not (Test-Path $envLocal)) {
    Write-Host "[ERROR] frontend/.env.local not found. Run 'azd up' first." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Configuration validated" -ForegroundColor Green

# Kill existing processes on our ports
foreach ($port in @(8080, 5173)) {
    if ($IsWindows) {
        $processIds = netstat -ano | Select-String ":$port\s.*LISTENING" | ForEach-Object {
            if ($_ -match '\s(\d+)\s*$') { [int]$Matches[1] }
        }
    } else {
        $processIds = lsof -i ":$port" -sTCP:LISTEN -t 2>$null | Where-Object { $_ -match '^\d+$' }
    }
    foreach ($processId in $processIds) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        Write-Host "Stopped process $processId on port $port" -ForegroundColor Yellow
    }
}
Start-Sleep -Seconds 1

# Start servers
$backendPath = Join-Path $projectRoot "backend/WebApp.Api"
if ($IsWindows) {
    Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd '$backendPath'; dotnet watch run --no-hot-reload"
    Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd '$frontendPath'; npm run dev"
} else {
    Start-Job { param($p) Set-Location $p; dotnet watch run --no-hot-reload 2>&1 } -Arg $backendPath | Out-Null
    Start-Job { param($p) Set-Location $p; npm run dev 2>&1 } -Arg $frontendPath | Out-Null
    Write-Host "Use 'Get-Job' to view background jobs, 'Stop-Job *' to stop" -ForegroundColor Gray
}

Start-Sleep -Seconds 3
if (-not $SkipBrowser) {
    if ($IsWindows) { Start-Process "http://localhost:5173" }
    elseif ($IsMacOS) { open "http://localhost:5173" }
    elseif (Get-Command xdg-open -EA SilentlyContinue) { xdg-open "http://localhost:5173" }
}

Write-Host "`n[OK] Dev servers started" -ForegroundColor Green
Write-Host "  Frontend: http://localhost:5173" -ForegroundColor Cyan
Write-Host "  Backend:  http://localhost:8080" -ForegroundColor Cyan
