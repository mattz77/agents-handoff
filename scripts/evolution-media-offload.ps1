<#
.SYNOPSIS
Offloading de mídias da EvolutionAPI para o DataLake.

.DESCRIPTION
Move arquivos antigos (vídeos, áudios, documentos grandes) da pasta local da Evolution API para o DataLake a fim de economizar espaço em disco (SSD).

.EXAMPLE
.\evolution-media-offload.ps1 -SourcePath "C:\Luma-EvolutionAPI\instances" -DaysOld 7
#>

param (
    [string]$SourcePath = "C:\evolution-api\instances",
    [int]$DaysOld = 7,
    [string]$DataLakePath = "G:\Meu Drive\Luma_DataLake\EvolutionAPI\Media"
)

if (-Not (Test-Path -Path $SourcePath)) {
    Write-Host "Caminho de origem não encontrado: $SourcePath" -ForegroundColor Red
    exit 1
}

if (-Not (Test-Path -Path $DataLakePath)) {
    Write-Host "Criando pasta de destino no DataLake: $DataLakePath"
    New-Item -ItemType Directory -Path $DataLakePath -Force | Out-Null
}

$CutoffDate = (Get-Date).AddDays(-$DaysOld)

Write-Host "Iniciando offloading de mídias (mais antigas que $DaysOld dias) para $DataLakePath ..."

# Extensões pesadas comuns recebidas via WhatsApp
$MediaExtensions = @("*.mp4", "*.mp3", "*.ogg", "*.pdf", "*.zip", "*.jpg", "*.jpeg", "*.png")

$FilesMoved = 0
$TotalSizeMB = 0

foreach ($ext in $MediaExtensions) {
    # Busca recursiva na pasta de instâncias
    $Files = Get-ChildItem -Path $SourcePath -Filter $ext -Recurse | Where-Object { $_.LastWriteTime -lt $CutoffDate -and -not $_.PSIsContainer }

    foreach ($file in $Files) {
        # Mantém a estrutura de diretórios relativa à origem para não misturar instâncias diferentes
        $RelativePath = $file.FullName.Substring($SourcePath.Length).TrimStart('\')
        $DestFile = Join-Path -Path $DataLakePath -ChildPath $RelativePath
        $DestDir = Split-Path -Path $DestFile -Parent

        if (-Not (Test-Path -Path $DestDir)) {
            New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
        }

        try {
            $TotalSizeMB += ($file.Length / 1MB)
            Move-Item -Path $file.FullName -Destination $DestFile -Force
            $FilesMoved++
            Write-Host "Movido: $($file.Name)"
        }
        catch {
            Write-Host "Erro ao mover arquivo $($file.FullName): $_" -ForegroundColor Red
        }
    }
}

Write-Host "Offloading concluído! Total de arquivos movidos: $FilesMoved ($([math]::Round($TotalSizeMB, 2)) MB liberados do SSD local)." -ForegroundColor Green
