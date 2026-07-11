param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$ArgsList
)

$ErrorActionPreference = "Continue"

# Use a temporary file for JSON output
$ErrJsonPath = [System.IO.Path]::GetTempFileName()

# Run the Antigravity/Gemini CLI with the given arguments
# TODO: Adjust the command "gemini" to the actual CLI command you use for Antigravity locally.
# We pipe stderr to the JSON file, assuming it can output JSON errors.
try {
    & gemini --error-format=json $ArgsList 2> $ErrJsonPath
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

                # Typical Antigravity / Gemini rate limit codes
                if ($Http -in @(429, 529, 503)) {
                    $NeedsFallback = $true
                }
                
                if ($Type -in @('rate_limit_error', 'quota_exceeded', 'service_unavailable')) {
                    $NeedsFallback = $true
                }
            }
        }
    } catch {
        # Ignore JSON parse errors
    }
}

if ($ExitCode -in @(75, 78)) {
    $NeedsFallback = $true
}

if ($NeedsFallback) {
    Write-Host "🚨 [FALLBACK] Limite do Antigravity (Gemini) atingido (http=$Http type=$Type code=$ExitCode). Acionando Claude." -ForegroundColor Magenta
    
    # Run the fallback compilation script
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $BrainDir = "G:\Meu Drive\LLM-Brain"
    if (!(Test-Path $BrainDir)) { New-Item -ItemType Directory -Force -Path $BrainDir | Out-Null }
    $FallbackCtxPath = [System.IO.Path]::Combine($BrainDir, "fallback-ctx.json")
    
    node "$ScriptDir\compile-fallback-context.js" --origin="antigravity" --reason="$Type" --http="$Http" --out="$FallbackCtxPath"
    node "$ScriptDir\publish-fallback.js" --ctx="$FallbackCtxPath" --status="FALLBACK_TRIGGERED"
    
    Write-Host "🔄 Iniciando fallback de volta para o Claude..." -ForegroundColor Yellow
    # Automaticaly launches Claude to resume the task
    & "$ScriptDir\claude-smart-wrap.ps1" --resume-from="$FallbackCtxPath"
    
    if (Test-Path $ErrJsonPath) { Remove-Item $ErrJsonPath -Force }
    if (Test-Path $FallbackCtxPath) { Remove-Item $FallbackCtxPath -Force }
    
    exit 0
}

if (Test-Path $ErrJsonPath) { Remove-Item $ErrJsonPath -Force }
exit $ExitCode
