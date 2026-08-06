# PropectAI - Auditoria de ambiente (Fase 0)
# Uso: powershell -ExecutionPolicy Bypass -File F:\prospectai\infra\scripts\audit-ambiente.ps1
# Somente leitura. Nenhum comando altera, para ou remove qualquer recurso.

$saida = "F:\prospectai\docs\technical\audit-resultado.txt"
Start-Transcript -Path $saida -Force | Out-Null

Write-Host "`n=== 1. CONTAINERS DOCKER ===" -ForegroundColor Cyan
docker ps -a --format "table {{.Names}}`t{{.Image}}`t{{.Status}}`t{{.Ports}}"

Write-Host "`n=== 2. REDES DOCKER ===" -ForegroundColor Cyan
docker network ls

Write-Host "`n=== 3. VOLUMES DOCKER ===" -ForegroundColor Cyan
docker volume ls

Write-Host "`n=== 4. PORTAS PRETENDIDAS ===" -ForegroundColor Cyan
$portas = @(3100, 3101, 5434, 6381, 8081, 5556)
foreach ($p in $portas) {
    $uso = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($uso) {
        $proc = (Get-Process -Id $uso[0].OwningProcess -ErrorAction SilentlyContinue).ProcessName
        Write-Host ("  {0,-6} OCUPADA  (processo: {1})" -f $p, $proc) -ForegroundColor Red
    } else {
        Write-Host ("  {0,-6} livre" -f $p) -ForegroundColor Green
    }
}

Write-Host "`n=== 5. BELLVIA (F:\drmind) - somente leitura ===" -ForegroundColor Cyan
if (Test-Path "F:\drmind") {
    Write-Host "  Pasta existe. Conteudo de primeiro nivel:"
    Get-ChildItem "F:\drmind" -Force | Select-Object Mode, LastWriteTime, Name | Format-Table -AutoSize
} else {
    Write-Host "  F:\drmind nao encontrada." -ForegroundColor Yellow
}

Write-Host "`n=== 6. ESPACO EM DISCO ===" -ForegroundColor Cyan
Get-PSDrive -PSProvider FileSystem |
    Where-Object { $_.Name -in @('C','F') } |
    Select-Object Name,
        @{n='UsadoGB';e={[math]::Round($_.Used/1GB,1)}},
        @{n='LivreGB';e={[math]::Round($_.Free/1GB,1)}} |
    Format-Table -AutoSize

Write-Host "`n=== 7. FERRAMENTAS ===" -ForegroundColor Cyan
foreach ($cmd in @('node','pnpm','docker','git')) {
    $v = & $cmd --version 2>$null
    if ($v) { Write-Host ("  {0,-8} {1}" -f $cmd, $v) }
    else    { Write-Host ("  {0,-8} NAO ENCONTRADO" -f $cmd) -ForegroundColor Red }
}

Stop-Transcript | Out-Null
Write-Host "`nResultado salvo em: $saida`n" -ForegroundColor Green
