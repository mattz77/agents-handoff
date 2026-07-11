# sync-data.ps1 — Mirror LLM-Brain + DataLake to local data/ for Docker mount
# Run via Task Scheduler alongside llm-brain-sync.ps1 (every 60min)

$src_brain = "G:\Meu Drive\LLM-Brain"
$src_datalake = "G:\Meu Drive\Luma_DataLake"
$dst = "C:\Users\olive\Documents\handoff-daemon\data"

if (Test-Path $src_brain) {
    Copy-Item "$src_brain\*" "$dst\llm-brain\" -Force -ErrorAction SilentlyContinue
}

if (Test-Path $src_datalake) {
    Copy-Item "$src_datalake\*" "$dst\datalake\" -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "[$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')] Data sync OK"
