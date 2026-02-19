# AI Presentation Analyzer - One-click deployment script (Windows PowerShell)
# This script handles building Lambda layers and deploying the CDK stack
#
# Usage: .\deploy.ps1 [-CdkArgs @('--require-approval', 'never')]
# Example: .\deploy.ps1

param(
    [string[]]$CdkArgs = @('--require-approval', 'never')
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $ScriptDir "backend"
$AgentcoreDir = Join-Path $BackendDir "agentcore"
$LayerDir = Join-Path $AgentcoreDir "python\lib\python3.12\site-packages"

# Color output
function Write-Success {
    Write-Host $args -ForegroundColor Green
}

function Write-Warning {
    Write-Host $args -ForegroundColor Yellow
}

function Write-Error {
    Write-Host $args -ForegroundColor Red
}

Write-Host "================================" -ForegroundColor Green
Write-Host "AI Presentation Analyzer Deploy" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host ""

# Step 1: Build Lambda layer dependencies
Write-Warning "Step 1: Building Lambda layer dependencies..."
New-Item -ItemType Directory -Force -Path $LayerDir | Out-Null

Write-Host "Installing Python dependencies using AWS Lambda Docker image..."
docker run --rm `
  --platform linux/arm64 `
  --volume "$($AgentcoreDir)\requirements.txt:/tmp/requirements.txt:ro" `
  --volume "$($LayerDir):/tmp/site-packages" `
  public.ecr.aws/lambda/python:3.12 `
  pip install -r /tmp/requirements.txt -t /tmp/site-packages --quiet

if ($LASTEXITCODE -eq 0) {
    Write-Success "✓ Lambda layer dependencies built successfully"
} else {
    Write-Error "✗ Failed to build Lambda layer dependencies"
    exit 1
}
Write-Host ""

# Step 2: Build TypeScript CDK code
Write-Warning "Step 2: Building TypeScript CDK code..."
Push-Location $BackendDir

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing npm dependencies..."
    npm install --quiet
}

Write-Host "Compiling TypeScript..."
npm run build --quiet

if ($LASTEXITCODE -eq 0) {
    Write-Success "✓ CDK TypeScript compiled successfully"
} else {
    Write-Error "✗ Failed to compile CDK TypeScript"
    Pop-Location
    exit 1
}
Write-Host ""

# Step 3: Deploy CDK stack
Write-Warning "Step 3: Deploying AWS CDK stack..."
$FullCdkArgs = @('cdk', 'deploy') + $CdkArgs

npx $FullCdkArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "================================" -ForegroundColor Green
    Write-Success "✓ Deployment successful!"
    Write-Host "================================" -ForegroundColor Green
    Pop-Location
} else {
    Write-Host ""
    Write-Host "================================" -ForegroundColor Red
    Write-Error "✗ Deployment failed"
    Write-Host "================================" -ForegroundColor Red
    Pop-Location
    exit 1
}
