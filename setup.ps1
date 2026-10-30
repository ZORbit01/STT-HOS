#Requires -RunAsAdministrator
<#
.SYNOPSIS
    One-click setup for OR Tracking System on Windows Server with Docker.
.DESCRIPTION
    1. Checks Docker is installed and running
    2. Creates backend/.env from .env.example if it doesn't exist
    3. Builds and starts all containers
    4. Opens the app in the default browser
#>

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  OR Tracking System — Setup" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Check Docker ───────────────────────────────────────────────────────────
Write-Host "[1/4] Checking Docker..." -ForegroundColor Yellow

if (-not (Get-Command "docker" -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Docker is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Download Docker Desktop from https://www.docker.com/products/docker-desktop"
    exit 1
}

$dockerInfo = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Docker is installed but not running. Please start Docker Desktop and try again." -ForegroundColor Red
    exit 1
}

Write-Host "  Docker is running." -ForegroundColor Green

# ── 2. Create .env if missing ─────────────────────────────────────────────────
Write-Host "[2/4] Checking environment config..." -ForegroundColor Yellow

$envFile     = Join-Path $ProjectRoot "backend\.env"
$envExample  = Join-Path $ProjectRoot "backend\.env.example"

if (-not (Test-Path $envFile)) {
    if (-not (Test-Path $envExample)) {
        Write-Host "ERROR: backend\.env.example not found." -ForegroundColor Red
        exit 1
    }
    Copy-Item $envExample $envFile
    Write-Host "  Created backend\.env from .env.example." -ForegroundColor Green
    Write-Host ""
    Write-Host "  IMPORTANT: Open backend\.env and change SECRET_KEY and ADMIN_PASSWORD" -ForegroundColor Yellow
    Write-Host "  before using this system in production." -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host "  backend\.env already exists, skipping." -ForegroundColor Green
}

# ── 3. Build and start containers ────────────────────────────────────────────
Write-Host "[3/4] Building and starting containers (this may take a few minutes on first run)..." -ForegroundColor Yellow

Set-Location $ProjectRoot
docker compose up --build -d

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: docker compose failed. Check the output above." -ForegroundColor Red
    exit 1
}

Write-Host "  All containers started." -ForegroundColor Green

# ── 4. Wait for healthy and open browser ─────────────────────────────────────
Write-Host "[4/4] Waiting for the app to be ready..." -ForegroundColor Yellow

$maxWait = 60
$waited  = 0
$ready   = $false

while ($waited -lt $maxWait) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost/health" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch {}
    Start-Sleep -Seconds 3
    $waited += 3
    Write-Host "  Still waiting... ($waited s)" -ForegroundColor Gray
}

if ($ready) {
    Write-Host ""
    Write-Host "======================================" -ForegroundColor Green
    Write-Host "  App is ready at http://localhost" -ForegroundColor Green
    Write-Host "======================================" -ForegroundColor Green
    Write-Host ""
    Start-Process "http://localhost"
} else {
    Write-Host ""
    Write-Host "App did not respond within $maxWait seconds." -ForegroundColor Yellow
    Write-Host "Check container logs with: docker compose logs" -ForegroundColor Yellow
}
