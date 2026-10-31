<#
  P04-QA-01 — Portão de compilação e testes do Intelligence Explorer, para rodar no PC do desenvolvedor.

  O que faz: sobe um Postgres 16 e um Redis DESCARTÁVEIS (nomes propectai-qa-*, portas 5439 e 6389, para não colidir
  com o ambiente de desenvolvimento nas portas 5434/6381), espelha o job "testes" do CI (.github/workflows/ci.yml),
  roda typecheck, lint, build e testes, e grava tudo em qa-logs\ . No fim remove os dois contêineres.

  O que NÃO faz: não toca no Bellvia (F:\drmind), não usa o banco de desenvolvimento, não faz push, não faz deploy,
  não toca em produção. Só mexe em contêineres com o prefixo propectai-qa-.

  Pré-requisitos: Node 24, pnpm 10.30.1 (corepack enable), Docker Desktop em execução, esta branch checada.
  Uso (PowerShell, na raiz do repositório):  .\docs\intelligence\p04\qa\validar-p04-qa.ps1

  Este script NÃO foi executado pela Executora (ela não alcança o seu PC). Se algum passo falhar por causa do script
  e não do código, cole a saída: o log mostra qual comando quebrou.
#>
$ErrorActionPreference = 'Continue'
Set-StrictMode -Version Latest
$raiz = (git rev-parse --show-toplevel).Trim()
Set-Location $raiz
$logs = Join-Path $raiz 'qa-logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$resumo = @()

function Passo([string]$nome, [scriptblock]$bloco) {
  $arq = Join-Path $logs (($nome -replace '[^A-Za-z0-9]+', '-') + '.log')
  Write-Host "==> $nome" -ForegroundColor Cyan
  & $bloco *>&1 | Tee-Object -FilePath $arq | Out-Null
  $ok = ($LASTEXITCODE -eq 0)
  $script:resumo += [pscustomobject]@{ Passo = $nome; Resultado = $(if ($ok) { 'OK' } else { "FALHOU (exit $LASTEXITCODE)" }); Log = $arq }
  Write-Host ("    " + $(if ($ok) { 'OK' } else { "FALHOU -> $arq" })) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
  return $ok
}

# --- identificação (vai para o relatório) -------------------------------------------------------------------------
git rev-parse HEAD | Out-File (Join-Path $logs '00-commit.txt')
git status --short | Out-File (Join-Path $logs '00-status.txt')
node -v | Out-File (Join-Path $logs '00-node.txt'); pnpm -v | Out-File -Append (Join-Path $logs '00-node.txt')

# --- infraestrutura descartável -----------------------------------------------------------------------------------
docker rm -f propectai-qa-pg propectai-qa-redis 2>$null | Out-Null
docker run -d --name propectai-qa-pg -p 5439:5432 `
  -e POSTGRES_USER=propectai -e POSTGRES_PASSWORD=propectai_ci_only -e POSTGRES_DB=propectai postgres:16-alpine | Out-Null
docker run -d --name propectai-qa-redis -p 6389:6379 redis:7-alpine | Out-Null
for ($i = 0; $i -lt 30; $i++) { docker exec propectai-qa-pg pg_isready -U propectai -d propectai *>$null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 2 }

# --- ambiente espelhando o CI (portas deslocadas) -----------------------------------------------------------------
$env:NODE_ENV = 'test'; $env:APP_VERSION = 'qa'
$env:DATABASE_URL          = 'postgresql://propectai:propectai_ci_only@localhost:5439/propectai?schema=public'
$env:DATABASE_URL_MIGRATOR = 'postgresql://propectai_migrator:migrator_ci_only@localhost:5439/propectai?schema=public'
$env:DATABASE_URL_APP      = 'postgresql://propectai_app:app_ci_only@localhost:5439/propectai?schema=public'
$env:DATABASE_URL_SISTEMA  = 'postgresql://propectai_sistema:sistema_ci_only@localhost:5439/propectai?schema=public'
$env:REDIS_URL = 'redis://localhost:6389'
$env:JWT_ACCESS_SECRET = 'qa-access-nao-e-segredo-descartavel'; $env:JWT_ACCESS_TTL = '15m'; $env:JWT_REFRESH_TTL = '7d'
$env:COOKIE_DOMAIN = 'localhost'; $env:COOKIE_SECURE = 'false'
$env:SEED_OWNER_PASSWORD = 'qa-owner-descartavel-nao-e-segredo'; $env:SEED_SDR_PASSWORD = 'qa-sdr-descartavel-e-diferente-do-outro'
$env:LEAD_SOURCE_PROVIDER = 'mock'; $env:SITE_AUDIT_PROVIDER = 'mock'; $env:AI_PROVIDER = 'mock'

try {
  Passo '01 pnpm install'            { pnpm install --frozen-lockfile } | Out-Null
  Passo '02 build packages-types'    { pnpm --filter '@propectai/types' build } | Out-Null
  Passo '03 prisma generate'         { pnpm db:generate } | Out-Null
  Passo '04 typecheck:all'           { pnpm typecheck:all } | Out-Null
  Passo '05 lint'                    { pnpm lint } | Out-Null
  Passo '06 build (api e web)'       { pnpm build } | Out-Null

  # migrations em dois estágios, como o CI (a última migration de superusuário é o ponto de corte)
  $ultima = '20261030190000_dono_sem_superusuario'
  $tmp = Join-Path $env:TEMP 'propectai-qa-migrations'
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path (Join-Path $tmp 'migrations') | Out-Null
  Copy-Item 'prisma\schema.prisma' $tmp
  Copy-Item 'prisma\migrations\migration_lock.toml' (Join-Path $tmp 'migrations')
  foreach ($d in (Get-ChildItem 'prisma\migrations' -Directory | Sort-Object Name)) {
    Copy-Item $d.FullName (Join-Path $tmp "migrations\$($d.Name)") -Recurse
    if ($d.Name -eq $ultima) { break }
  }
  Passo '07 migrations ate DB-REM-06' { pnpm exec prisma migrate deploy --schema (Join-Path $tmp 'schema.prisma') } | Out-Null
  Passo '08 senhas dos papeis' {
    @"
ALTER ROLE propectai_migrator PASSWORD 'migrator_ci_only';
ALTER ROLE propectai_app       PASSWORD 'app_ci_only';
ALTER ROLE propectai_sistema   PASSWORD 'sistema_ci_only';
ALTER ROLE propectai_dono      PASSWORD 'dono_ci_only';
"@ | docker exec -i propectai-qa-pg psql -U propectai -d propectai -v ON_ERROR_STOP=1
  } | Out-Null
  $dono = $env:DATABASE_URL
  $env:DATABASE_URL = 'postgresql://propectai_dono:dono_ci_only@localhost:5439/propectai?schema=public'
  Passo '09 migrations seguintes'    { pnpm db:deploy } | Out-Null
  $env:DATABASE_URL = $dono
  Passo '10 seed do catalogo'        { pnpm db:seed } | Out-Null

  # o que a ordem pede, separado: o spec do Explorer primeiro, depois a suíte inteira (regressão)
  Passo '11 jest Intelligence Explorer (HTTP real)' { pnpm --filter '@propectai/api' exec jest test/intelligence-tenant.spec.ts --runInBand } | Out-Null
  Passo '12 suite completa (pnpm test)' { pnpm test } | Out-Null
  Passo '13 portao de RLS' { Get-Content 'docs\intelligence\gate0\gate-rls.sql' -Raw | docker exec -i propectai-qa-pg psql -U propectai -d propectai -v ON_ERROR_STOP=1 } | Out-Null
}
finally {
  docker rm -f propectai-qa-pg propectai-qa-redis 2>$null | Out-Null
  $resumo | Format-Table -AutoSize | Out-String | Tee-Object -FilePath (Join-Path $logs '99-resumo.txt')
  Write-Host "Logs em: $logs  (cole 99-resumo.txt e, se algo falhou, o log do passo)" -ForegroundColor Yellow
}
