param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$ArgsList
)

$ErrorActionPreference = "Continue"

# Use a temporary file for JSON output
$ErrJsonPath = [System.IO.Path]::GetTempFileName()

# Run claude-code with the given arguments and error format set to json
try {
    # We pipe stderr to the JSON file
    & claude-code --error-format=json $ArgsList 2> $ErrJsonPath
    $ExitCode = $LASTEXITCODE
} catch {
    $ExitCode = $LASTEXITCODE
}

$NeedsFallback = $false
$Http = ""
$Type = ""

if (Test-Path $ErrJsonPath) {
    try {
        $ErrorContent = Get-Content $ErrJsonPath -Raw
        if (![string]::IsNullOrWhiteSpace($ErrorContent)) {
            $ErrorObj = $ErrorContent | ConvertFrom-Json
            
            if ($ErrorObj.error) {
                $Http = $ErrorObj.error.status
                $Type = $ErrorObj.error.type

                if ($Http -in @(429, 529)) {
                    $NeedsFallback = $true
                }
                
                if ($Type -in @('rate_limit_error', 'overloaded_error', 'quota_exceeded')) {
                    $NeedsFallback = $true
                }
            }
        }
    } catch {
        # Ignore JSON parse errors
    }
}

# Exit codes 75 or 78 might be specific wrapper signals
if ($ExitCode -in @(75, 78)) {
    $NeedsFallback = $true
}

if ($NeedsFallback) {
    Write-Host "🚨 [FALLBACK] Cota/limite Claude atingido (http=$Http type=$Type code=$ExitCode). Acionando Gemini." -ForegroundColor Red
    
    # Run the fallback compilation script
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $BrainDir = "G:\Meu Drive\LLM-Brain"
    if (!(Test-Path $BrainDir)) { New-Item -ItemType Directory -Force -Path $BrainDir | Out-Null }
    $FallbackCtxPath = [System.IO.Path]::Combine($BrainDir, "fallback-ctx.json")
    
    node "$ScriptDir\compile-fallback-context.js" --origin="claude" --reason="$Type" --http="$Http" --out="$FallbackCtxPath"
    node "$ScriptDir\publish-fallback.js" --ctx="$FallbackCtxPath" --status="FALLBACK_TRIGGERED"
    
    Write-Host "🔄 Iniciando fallback para o Antigravity (Gemini)..." -ForegroundColor Yellow
    # Chamada síncrona para o outro assistente
    & "$ScriptDir\antigravity-smart-wrap.ps1" --resume-from="$FallbackCtxPath"
    
    if (Test-Path $ErrJsonPath) { Remove-Item $ErrJsonPath -Force }
    if (Test-Path $FallbackCtxPath) { Remove-Item $FallbackCtxPath -Force }
    
    exit 0
}

if (Test-Path $ErrJsonPath) { Remove-Item $ErrJsonPath -Force }
exit $ExitCode
