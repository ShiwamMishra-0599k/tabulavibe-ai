<#
.SYNOPSIS
  Build and deploy TabulaVibe AI to AWS (Lambda Function URL + S3/CloudFront), then smoke-test it.

.DESCRIPTION
  Requires: AWS CLI v2, AWS SAM CLI, Docker Desktop (running), Node.js, and AWS credentials
  configured for the target account (aws configure / aws sso login).
  Read docs/DEPLOYMENT.md first: it lists every resource, its cost and the free-tier conditions.

.EXAMPLE
  .\infra\deploy.ps1 -AlertEmail you@example.com
  .\infra\deploy.ps1 -AlertEmail you@example.com -Region ap-south-1 -StackName tabulavibe
#>
param(
  [string]$StackName = 'tabulavibe',
  [string]$Region = 'ap-south-1',
  [Parameter(Mandatory = $true)][string]$AlertEmail,
  [int]$MonthlyBudgetUsd = 1
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Check($ok, $text) { if (-not $ok) { throw "Deployment check failed: $text" } }

Step 'Checking tools and identity (read-only)'
foreach ($tool in 'aws', 'sam', 'docker', 'npm') {
  Check ([bool](Get-Command $tool -ErrorAction SilentlyContinue)) "$tool is not installed"
}
$account = aws sts get-caller-identity --query Account --output text
Check ($LASTEXITCODE -eq 0) 'AWS credentials are not configured'
Write-Host "Deploying to account $account in $Region as stack '$StackName'"

Step 'Running backend tests'
& backend\.venv\Scripts\python.exe -m pytest -q backend\tests
Check ($LASTEXITCODE -eq 0) 'backend tests failed'

Step 'Staging and building the Lambda package (arm64, inside the official SAM build image)'
& backend\.venv\Scripts\python.exe infra\stage_backend.py
Push-Location infra
try {
  sam build --use-container --template-file template.yaml
  Check ($LASTEXITCODE -eq 0) 'sam build failed'

  Step 'Deploying the CloudFormation stack'
  sam deploy --stack-name $StackName --region $Region --resolve-s3 --capabilities CAPABILITY_IAM `
    --no-fail-on-empty-changeset --parameter-overrides "AlertEmail=$AlertEmail" "MonthlyBudgetUsd=$MonthlyBudgetUsd"
  Check ($LASTEXITCODE -eq 0) 'sam deploy failed'
}
finally { Pop-Location }

$outputs = aws cloudformation describe-stacks --stack-name $StackName --region $Region --query 'Stacks[0].Outputs' --output json | ConvertFrom-Json
$out = @{}; foreach ($o in $outputs) { $out[$o.OutputKey] = $o.OutputValue }
$apiUrl = $out['ApiUrl'].TrimEnd('/')
$siteUrl = $out['FrontendUrl']

Step 'Building the frontend against the deployed API'
Push-Location frontend
try {
  $env:VITE_API_BASE_URL = $apiUrl
  npm ci
  npm run build
  Check ($LASTEXITCODE -eq 0) 'frontend build failed'
  Remove-Item Env:\VITE_API_BASE_URL
}
finally { Pop-Location }

Step 'Uploading the frontend'
aws s3 sync frontend\dist "s3://$($out['FrontendBucketName'])" --delete --region $Region --cache-control 'public,max-age=31536000,immutable' --exclude index.html
aws s3 cp frontend\dist\index.html "s3://$($out['FrontendBucketName'])/index.html" --region $Region --cache-control 'no-cache'
aws cloudfront create-invalidation --distribution-id $out['DistributionId'] --paths '/index.html' | Out-Null

Step 'Smoke-testing the deployed endpoints'
$health = Invoke-RestMethod "$apiUrl/api/health"
Check ($health.status -eq 'ok') 'API health check failed'
$config = Invoke-RestMethod "$apiUrl/api/config"
Check ($config.ai.enabled -eq $false -or $config.ai.enabled -eq $true) 'API config endpoint failed'
$samples = Invoke-RestMethod "$apiUrl/api/samples"
Check ($samples.Count -ge 2) 'sample list is empty'
$page = Invoke-WebRequest -UseBasicParsing $siteUrl
Check ($page.StatusCode -eq 200 -and $page.Content -match 'TabulaVibe AI') 'frontend did not load'

Write-Host "`nDeployed and smoke-tested." -ForegroundColor Green
Write-Host "Frontend: $siteUrl"
Write-Host "API:      $apiUrl"
Write-Host 'Confirm the AWS Budgets subscription email, then run the browser journey in docs/DEPLOYMENT.md.'
