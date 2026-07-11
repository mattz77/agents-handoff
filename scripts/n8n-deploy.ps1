$ErrorActionPreference = "Stop"

$apiUrl = "https://luma-n8n.nicebyte.ia.br/api/v1/workflows"
$apiKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1YTlmYmZlZS1mNTQ5LTQ4YmUtOGE5NC0yYjUzZmU4MDcwZjYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiMTM5NjJmNjQtZmFkMi00NTZmLThmNzktYmJiYmQ4NjE0N2NlIiwiaWF0IjoxNzgxNDEzMTgzfQ.HMJ4h_UIqu7tvUiW_YKFKiaz7SaymD7jN02Sm3rLrDM"
$workflowFile = "c:\Users\olive\Documents\handoff-daemon\workflows\handoff-api-orchestrator.json"

Write-Host "Carregando arquivo de workflow..."
$workflowJson = Get-Content -Path $workflowFile -Raw

$headers = @{
    "X-N8N-API-KEY" = $apiKey
    "Content-Type"  = "application/json"
}

Write-Host "Realizando POST para a API do n8n em $apiUrl..."
try {
    $response = Invoke-RestMethod -Uri $apiUrl -Method Post -Headers $headers -Body $workflowJson
    Write-Host "✅ Deploy realizado com sucesso!" -ForegroundColor Green
    Write-Host "ID do Workflow Criado: $($response.id)"
    Write-Host "Nome do Workflow: $($response.name)"
} catch {
    Write-Host "❌ Falha no deploy: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails) {
        Write-Host "Detalhes: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
}
