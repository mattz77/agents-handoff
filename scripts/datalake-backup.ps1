<#
.SYNOPSIS
Backup automatizado do banco de dados e do Redis para o DataLake (Google Drive).

.DESCRIPTION
Gera os dumps do banco relacional (PostgreSQL) e chave-valor (Redis) e os transfere para o Luma_DataLake de 5TB.

.EXAMPLE
.\datalake-backup.ps1
#>

$DataLakePath = "G:\Meu Drive\Luma_DataLake\Backups\Databases"
$DateStr = Get-Date -Format "yyyy-MM-dd"
$DestPath = "$DataLakePath\$DateStr"

if (-Not (Test-Path -Path $DestPath)) {
    Write-Host "Criando diretório de backup: $DestPath"
    New-Item -ItemType Directory -Path $DestPath | Out-Null
}

Write-Host "Iniciando processo de backup para o DataLake..."

# 1. Backup do Redis
Write-Host "[Redis] Gerando BGSAVE..."
# O Redis master do handoff exige senha, passada via secrets
$RedisSecret = Get-Content -Path "secrets\redis_secret.txt" -Raw
$RedisSecret = $RedisSecret.Trim()

docker exec handoff-redis-master redis-cli -a $RedisSecret BGSAVE

Write-Host "[Redis] Aguardando BGSAVE..."
Start-Sleep -Seconds 5

Write-Host "[Redis] Copiando dump.rdb..."
docker cp handoff-redis-master:/data/dump.rdb "$DestPath\redis-dump.rdb"
Write-Host "[Redis] Backup concluído em $DestPath\redis-dump.rdb"

# 2. Backup do Postgres (Shared com n8n)
# Como o Postgres é compartilhado com o n8n, normalmente o container se chama cordenaain8n-postgres-1 ou similar.
# Usaremos uma variável de ambiente ou nome padrão para acessar o container.
$PostgresContainer = $env:POSTGRES_CONTAINER_NAME
if ([string]::IsNullOrWhiteSpace($PostgresContainer)) {
    $PostgresContainer = "cordenaain8n-postgres-1" # fallback guess
}

Write-Host "[Postgres] Verificando existência do container de banco de dados ($PostgresContainer)..."
$PgExists = docker ps -q -f name=$PostgresContainer
if ($PgExists) {
    Write-Host "[Postgres] Gerando dump.sql..."
    # Usa sh -c dentro do container para executar o pg_dumpall e gzip, depois copia via docker cp para evitar corrupção de encoding no PowerShell
    docker exec $PostgresContainer sh -c 'pg_dumpall -U postgres | gzip > /tmp/postgres-dump.sql.gz'
    docker cp "$($PostgresContainer):/tmp/postgres-dump.sql.gz" "$DestPath\postgres-dump.sql.gz"
    docker exec $PostgresContainer rm /tmp/postgres-dump.sql.gz
    Write-Host "[Postgres] Backup concluído em $DestPath\postgres-dump.sql.gz"
} else {
    Write-Host "[Postgres] AVISO: Container '$PostgresContainer' não encontrado. Defina a env POSTGRES_CONTAINER_NAME se o nome for diferente." -ForegroundColor Yellow
}

Write-Host "Realizando limpeza de backups antigos (Retenção: 30 dias)..."
$RetentionDays = 30
$CutoffDate = (Get-Date).AddDays(-$RetentionDays)

# Lista todas as pastas de data dentro de Databases que são mais antigas que 30 dias
$OldBackups = Get-ChildItem -Path $DataLakePath -Directory | Where-Object { $_.CreationTime -lt $CutoffDate -and $_.Name -match "^\d{4}-\d{2}-\d{2}$" }

foreach ($old in $OldBackups) {
    Write-Host "Removendo backup expirado: $($old.FullName)" -ForegroundColor Yellow
    Remove-Item -Path $old.FullName -Recurse -Force
}

Write-Host "Processo de backup para o DataLake finalizado!"
