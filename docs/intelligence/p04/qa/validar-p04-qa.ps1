<#
  P04-QA-02 v1.1.0 — Portão de compilação e testes do Intelligence Explorer, para rodar no PC do desenvolvedor.
  (v1.0.0 era da P04-QA-01; esta versão corrige os defeitos apontados na revisão da P04-QA-02, item 3.)

  ROTA PREFERIDA: o CI do GitHub Actions (ver COMO-RODAR.md, Rota A). Este script é a rota B, alternativa local.
  A Executora NÃO executou este script (não alcança o seu PC); ele foi apenas revisado por leitura.

  O que faz: sobe um Postgres 16 e um Redis DESCARTÁVEIS, espelha os jobs "tipos", "builds" e "testes" do CI
  (.github/workflows/ci.yml), grava tudo em qa-logs\<execução>\ e, no fim, remove SOMENTE o que ele mesmo criou.

  Garantias (cada uma tem uma checagem abaixo, não só um comentário):
    1. Pré-voo antes de qualquer efeito: ferramentas, daemon do Docker, Node >= 24, portas 5439/6389 livres,
       nenhum contêiner/estado de execução anterior no caminho. Qualquer falha de pré-voo aborta SEM criar nada.
    2. Contêineres só são criados com nome único da execução + rótulo de propriedade. A remoção usa o ID devolvido
       pelo `docker run` e só ocorre se o rótulo do contêiner conferir. Nunca remove por nome nem em lote.
    3. Portas publicadas apenas em 127.0.0.1. Antes de conectar, o script PROVA que a porta do host chega no
       contêiner desta execução (marcador gravado dentro do Postgres e do Redis e lido pelo lado do host). Se
       houver outro PostgreSQL naquela porta, o marcador não confere e a execução aborta.
    4. Todas as variáveis de conexão são validadas (host localhost, porta 5439/6389) antes do primeiro comando.
    5. Cada comando nativo (docker, git, pnpm, prisma) tem o código de saída verificado. Falha em etapa crítica
       (instalação, build, typecheck, lint, migrations, seed) INTERROMPE a execução. As três etapas de teste
       (11–13) rodam todas mesmo se uma cair, para o relatório ter o quadro completo; o código de saída final
       do script é diferente de zero se qualquer etapa falhou.
    6. As variáveis de ambiente alteradas são restauradas no fim; a pasta temporária de migrations é removida
       só se foi criada por esta execução.

  O que NÃO faz: não toca no Bellvia (F:\drmind), não usa o banco de desenvolvimento (5434/6381), não faz push,
  deploy, nem toca em produção. Não executa `docker system/volume/network prune`.

  Uso (PowerShell, na raiz do repositório, com a branch checada e árvore limpa):
      .\docs\intelligence\p04\qa\validar-p04-qa.ps1
  Opções:
      -PermitirArvoreSuja            executa mesmo com alterações não commitadas (o log registra isso)
      -LimparRestosAnteriores        remove contêineres que carregam o rótulo desta rotina (e SÓ eles)
#>
[CmdletBinding()]
param(
  [switch]$PermitirArvoreSuja,
  [switch]$LimparRestosAnteriores
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$PORTA_PG    = 5439
$PORTA_REDIS = 6389
$ROTULO      = 'br.com.layart.propectai.qa'        # chave do rótulo de propriedade
$ROTULO_VAL  = 'p04-qa'                            # valor do rótulo (identifica esta rotina)
$IMG_PG      = 'postgres:16-alpine'
$IMG_REDIS   = 'redis:7-alpine'

$idExec   = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
$nomePg   = "propectai-qa-pg-$idExec"
$nomeRedis = "propectai-qa-redis-$idExec"
$marcador = "propectai-qa-$idExec"

$criadosIds = New-Object System.Collections.Generic.List[string]   # IDs de contêineres criados POR ESTA execução
$tmpMigr    = $null                                                 # pasta temporária criada por esta execução
$resumo     = New-Object System.Collections.Generic.List[object]
$falhou     = $false
$envOriginal = @{}
$logs       = $null

function Aviso([string]$m)  { Write-Host $m -ForegroundColor Yellow }
function Abortar([string]$m) { throw "ABORTADO: $m" }

# Executa um comando nativo e lança se o código de saída não for 0.
# (Windows PowerShell 5.1 transforma stderr de comando nativo em erro terminante quando $ErrorActionPreference é
#  'Stop' e há `2>&1`; docker/pnpm escrevem avisos em stderr. Por isso o 'Continue' local — a decisão é pelo exit code.)
function Nativo([string]$exe, [string[]]$argumentos) {
  $ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    $saida = & $exe @argumentos 2>&1
    $codigo = $LASTEXITCODE
  } finally { $ErrorActionPreference = $ea }
  if ($codigo -ne 0) { throw "Falha em: $exe $($argumentos -join ' ') (exit $codigo)`n$saida" }
  return $saida
}

# Uma etapa registrada: log próprio, código de saída verificado, resultado vai para o resumo.
# -Critica: se falhar, interrompe a execução (lança). Sem -Critica, registra e segue.
function Passo([string]$nome, [scriptblock]$bloco, [switch]$Critica) {
  $arq = Join-Path $logs (($nome -replace '[^A-Za-z0-9]+', '-') + '.log')
  Write-Host "==> $nome" -ForegroundColor Cyan
  $global:LASTEXITCODE = 0
  $ok = $true; $detalhe = ''
  $ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue'   # ver comentário em Nativo
  try {
    & $bloco *>&1 | Tee-Object -FilePath $arq | Out-Null
    if ($LASTEXITCODE -ne 0) { $ok = $false; $detalhe = "exit $LASTEXITCODE" }
  } catch {
    $ok = $false; $detalhe = $_.Exception.Message
    $detalhe | Out-File -Append -FilePath $arq
  } finally { $ErrorActionPreference = $ea }
  $resumo.Add([pscustomobject]@{ Passo = $nome; Resultado = $(if ($ok) { 'OK' } else { "FALHOU ($detalhe)" }); Log = $arq })
  Write-Host ("    " + $(if ($ok) { 'OK' } else { "FALHOU -> $arq" })) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
  if (-not $ok) {
    $script:falhou = $true
    if ($Critica) { throw "Etapa crítica falhou: $nome (veja $arq). Execução interrompida." }
  }
}

# Porta livre no loopback? (se alguém já escuta, abortamos: seria outro serviço)
function PortaEmUso([int]$porta) {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $r = $c.BeginConnect('127.0.0.1', $porta, $null, $null)
    $achou = $r.AsyncWaitHandle.WaitOne(800)
    if ($achou -and $c.Connected) { return $true }
    return $false
  } catch { return $false } finally { $c.Close() }
}

# Rótulo de propriedade de um contêiner (vazio se não tiver / não existir).
function RotuloDe([string]$ref) {
  $o = & docker inspect --format ('{{ index .Config.Labels "' + $ROTULO + '" }}') $ref 2>$null
  if ($LASTEXITCODE -ne 0) { return '' }
  return ($o | Out-String).Trim()
}

try {
  # ======================================================================================================
  # PRÉ-VOO — nada é criado, alterado ou removido até aqui
  # ======================================================================================================
  foreach ($f in 'git', 'docker', 'node', 'pnpm') {
    if (-not (Get-Command $f -ErrorAction SilentlyContinue)) { Abortar "'$f' não encontrado no PATH." }
  }
  $raiz = (Nativo 'git' @('rev-parse', '--show-toplevel') | Select-Object -First 1).ToString().Trim()
  Set-Location $raiz
  if (-not (Test-Path (Join-Path $raiz '.github\workflows\ci.yml'))) { Abortar "Não parece a raiz do PropectAI (falta .github\workflows\ci.yml): $raiz" }
  if ($raiz -match 'drmind') { Abortar "O caminho do repositório menciona 'drmind' (Bellvia). Este script não roda lá: $raiz" }

  $nodeMajor = [int]((Nativo 'node' @('-p', 'process.versions.node.split(".")[0]')) | Select-Object -First 1)
  if ($nodeMajor -lt 24) { Abortar "Node $nodeMajor detectado; o projeto exige Node >= 24 (package.json engines)." }

  # daemon do Docker acessível?
  $null = Nativo 'docker' @('info', '--format', '{{.ServerVersion}}')

  $suja = (Nativo 'git' @('status', '--porcelain')) -join "`n"
  if ($suja.Trim() -and -not $PermitirArvoreSuja) { Abortar "Árvore com alterações não commitadas. Faça commit/stash ou use -PermitirArvoreSuja.`n$suja" }

  # restos de execução anterior: só contêineres COM o rótulo desta rotina
  $restos = @(& docker ps -a --filter "label=$ROTULO=$ROTULO_VAL" --format '{{.ID}} {{.Names}}' 2>$null)
  if ($restos.Count -gt 0) {
    if ($LimparRestosAnteriores) {
      foreach ($linha in $restos) {
        $id = ($linha -split ' ')[0]
        if ((RotuloDe $id) -eq $ROTULO_VAL) { Aviso "Removendo resto de execução anterior (rótulo conferido): $linha"; $null = Nativo 'docker' @('rm', '-f', $id) }
      }
    } else {
      Abortar "Há contêineres de execução anterior desta rotina:`n$($restos -join "`n")`nRemova-os com: docker rm -f <ID>  ou rode com -LimparRestosAnteriores."
    }
  }

  # portas: livres no loopback, e nenhum contêiner (de ninguém) publicando nelas
  foreach ($p in $PORTA_PG, $PORTA_REDIS) {
    if (PortaEmUso $p) { Abortar "A porta $p já está em uso por outro processo. Não vou conectar nem sobrepor. Libere-a ou ajuste a rotina." }
    $pub = @(& docker ps --format '{{.Names}} {{.Ports}}' 2>$null | Where-Object { $_ -match (':' + $p + '->') })
    if ($pub.Count -gt 0) { Abortar "Um contêiner já publica a porta $p`: $($pub -join '; ')" }
  }

  # pastas de log desta execução
  $logs = Join-Path (Join-Path $raiz 'qa-logs') $idExec
  New-Item -ItemType Directory -Force -Path $logs | Out-Null
  (Nativo 'git' @('rev-parse', 'HEAD')) | Out-File (Join-Path $logs '00-commit.txt')
  (Nativo 'git' @('rev-parse', '--abbrev-ref', 'HEAD')) | Out-File -Append (Join-Path $logs '00-commit.txt')
  $suja | Out-File (Join-Path $logs '00-status.txt')
  "node $(node -v)  pnpm $(pnpm -v)  execucao $idExec" | Out-File (Join-Path $logs '00-ferramentas.txt')

  # ======================================================================================================
  # ENVIRONMENT — definido e VALIDADO antes de subir qualquer coisa; restaurado no fim
  # ======================================================================================================
  $chaves = 'NODE_ENV','APP_VERSION','DATABASE_URL','DATABASE_URL_MIGRATOR','DATABASE_URL_APP','DATABASE_URL_SISTEMA','REDIS_URL',
            'JWT_ACCESS_SECRET','JWT_ACCESS_TTL','JWT_REFRESH_TTL','COOKIE_DOMAIN','COOKIE_SECURE','SEED_OWNER_PASSWORD',
            'SEED_SDR_PASSWORD','LEAD_SOURCE_PROVIDER','SITE_AUDIT_PROVIDER','AI_PROVIDER'
  foreach ($k in $chaves) { $envOriginal[$k] = [Environment]::GetEnvironmentVariable($k) }

  $env:NODE_ENV = 'test'; $env:APP_VERSION = 'qa'
  $env:DATABASE_URL          = "postgresql://propectai:propectai_ci_only@localhost:$PORTA_PG/propectai?schema=public"
  $env:DATABASE_URL_MIGRATOR = "postgresql://propectai_migrator:migrator_ci_only@localhost:$PORTA_PG/propectai?schema=public"
  $env:DATABASE_URL_APP      = "postgresql://propectai_app:app_ci_only@localhost:$PORTA_PG/propectai?schema=public"
  $env:DATABASE_URL_SISTEMA  = "postgresql://propectai_sistema:sistema_ci_only@localhost:$PORTA_PG/propectai?schema=public"
  $env:REDIS_URL = "redis://localhost:$PORTA_REDIS"
  $env:JWT_ACCESS_SECRET = 'qa-access-nao-e-segredo-descartavel'; $env:JWT_ACCESS_TTL = '15m'; $env:JWT_REFRESH_TTL = '7d'
  $env:COOKIE_DOMAIN = 'localhost'; $env:COOKIE_SECURE = 'false'
  $env:SEED_OWNER_PASSWORD = 'qa-owner-descartavel-nao-e-segredo'; $env:SEED_SDR_PASSWORD = 'qa-sdr-descartavel-e-diferente-do-outro'
  $env:LEAD_SOURCE_PROVIDER = 'mock'; $env:SITE_AUDIT_PROVIDER = 'mock'; $env:AI_PROVIDER = 'mock'

  foreach ($k in 'DATABASE_URL','DATABASE_URL_MIGRATOR','DATABASE_URL_APP','DATABASE_URL_SISTEMA') {
    $v = [Environment]::GetEnvironmentVariable($k)
    if ($v -notmatch "^postgresql://[^@]+@localhost:$PORTA_PG/propectai\?schema=public$") { Abortar "$k não aponta para localhost:$PORTA_PG/propectai." }
  }
  if ($env:REDIS_URL -ne "redis://localhost:$PORTA_REDIS") { Abortar 'REDIS_URL inesperada.' }

  # ======================================================================================================
  # INFRAESTRUTURA DESCARTÁVEL — rótulo de propriedade + loopback + ID registrado
  # ======================================================================================================
  $idPg = ((Nativo 'docker' @('run', '-d', '--name', $nomePg, '--label', "$ROTULO=$ROTULO_VAL", '--label', "$ROTULO.exec=$idExec",
      '-p', "127.0.0.1:${PORTA_PG}:5432",
      '-e', 'POSTGRES_USER=propectai', '-e', 'POSTGRES_PASSWORD=propectai_ci_only', '-e', 'POSTGRES_DB=propectai', $IMG_PG)) | Select-Object -Last 1).ToString().Trim()
  if ($idPg -notmatch '^[0-9a-f]{64}$') { Abortar "docker run (postgres) não devolveu um ID de contêiner válido: $idPg" }
  $criadosIds.Add($idPg)

  $idRedis = ((Nativo 'docker' @('run', '-d', '--name', $nomeRedis, '--label', "$ROTULO=$ROTULO_VAL", '--label', "$ROTULO.exec=$idExec",
      '-p', "127.0.0.1:${PORTA_REDIS}:6379", $IMG_REDIS)) | Select-Object -Last 1).ToString().Trim()
  if ($idRedis -notmatch '^[0-9a-f]{64}$') { Abortar "docker run (redis) não devolveu um ID de contêiner válido: $idRedis" }
  $criadosIds.Add($idRedis)

  # espera o Postgres de VERDADE ficar pronto (e aborta se não ficar — o v1.0.0 seguia adiante)
  $pronto = $false
  for ($i = 0; $i -lt 40; $i++) {
    & docker exec $idPg pg_isready -U propectai -d propectai *>$null
    if ($LASTEXITCODE -eq 0) { $pronto = $true; break }
    Start-Sleep 2
  }
  if (-not $pronto) { Abortar 'O Postgres descartável não ficou pronto em 80 s.' }
  $redisPronto = $false
  for ($i = 0; $i -lt 20; $i++) {
    $pong = (& docker exec $idRedis redis-cli ping 2>$null | Out-String).Trim()
    if ($pong -eq 'PONG') { $redisPronto = $true; break }
    Start-Sleep 1
  }
  if (-not $redisPronto) { Abortar 'O Redis descartável não respondeu PONG.' }

  # ---- IDENTIDADE: a porta do host chega MESMO no contêiner desta execução? -------------------------------
  # marcador gravado por dentro...
  $null = Nativo 'docker' @('exec', $idPg, 'psql', '-U', 'propectai', '-d', 'propectai', '-v', 'ON_ERROR_STOP=1', '-c', "COMMENT ON DATABASE propectai IS '$marcador'")
  $null = Nativo 'docker' @('exec', $idRedis, 'redis-cli', 'set', 'propectai-qa-id', $marcador)
  # (a leitura pelo lado do host acontece logo após o `prisma generate`, quando o prisma CLI já está instalado)
  # ======================================================================================================
  # ETAPAS — espelham os jobs tipos / builds / testes do CI
  # ======================================================================================================
  Passo '01 pnpm install'          { pnpm install --frozen-lockfile } -Critica
  Passo '02 build packages-types'  { pnpm --filter '@propectai/types' build } -Critica
  Passo '03 prisma generate'       { pnpm db:generate } -Critica

  # ---- IDENTIDADE (leitura pelo lado do host): só agora o prisma CLI existe. Se outro serviço ocupar a porta,
  #      o marcador não confere e a execução termina aqui — antes de qualquer migration, seed ou teste.
  $sqlId = "DO `$`$ BEGIN IF coalesce(shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database'), '') <> '$marcador' THEN RAISE EXCEPTION 'IDENTIDADE DO POSTGRES NAO CONFERE'; END IF; END `$`$;"
  Passo '00 identidade do PostgreSQL pela porta do host' {
    $sqlId | pnpm exec prisma db execute --stdin --schema prisma/schema.prisma
  } -Critica
  Passo '00b identidade do Redis pela porta do host' {
    $js = "const n=require('net');const s=n.connect($PORTA_REDIS,'127.0.0.1');let b='';s.on('data',d=>{b+=d;if(b.includes('$marcador')){console.log('ok');s.end();process.exit(0)}});s.on('error',()=>process.exit(2));s.write('GET propectai-qa-id\r\n');setTimeout(()=>process.exit(3),4000)"
    node -e $js
  } -Critica
  Passo '04 typecheck:all'         { pnpm typecheck:all } -Critica
  Passo '05 lint'                  { pnpm lint } -Critica
  # NODE_ENV=test atrapalha `next build`: os builds rodam com NODE_ENV limpo (como o job "builds" do CI)
  Passo '06 build api e web' {
    $antes = $env:NODE_ENV; Remove-Item Env:\NODE_ENV -ErrorAction SilentlyContinue
    try { pnpm exec turbo run build --filter=@propectai/api --filter=@propectai/web } finally { $env:NODE_ENV = $antes }
  } -Critica

  # migrations em dois estágios, como o CI (a última migration de superusuário é o ponto de corte)
  $ultima = '20261030190000_dono_sem_superusuario'
  $tmpMigr = Join-Path ([IO.Path]::GetTempPath()) "propectai-qa-migrations-$idExec"
  if (Test-Path $tmpMigr) { Abortar "A pasta temporária já existe: $tmpMigr" }
  New-Item -ItemType Directory -Force -Path (Join-Path $tmpMigr 'migrations') | Out-Null
  Copy-Item 'prisma\schema.prisma' $tmpMigr
  Copy-Item 'prisma\migrations\migration_lock.toml' (Join-Path $tmpMigr 'migrations')
  $achouUltima = $false
  foreach ($d in (Get-ChildItem 'prisma\migrations' -Directory | Sort-Object Name)) {
    Copy-Item $d.FullName (Join-Path $tmpMigr "migrations\$($d.Name)") -Recurse
    if ($d.Name -eq $ultima) { $achouUltima = $true; break }
  }
  if (-not $achouUltima) { Abortar "Migration de corte $ultima não encontrada em prisma\migrations." }

  Passo '07 migrations ate DB-REM-06' { pnpm exec prisma migrate deploy --schema (Join-Path $tmpMigr 'schema.prisma') } -Critica
  Passo '08 senhas dos papeis' {
    @"
ALTER ROLE propectai_migrator PASSWORD 'migrator_ci_only';
ALTER ROLE propectai_app       PASSWORD 'app_ci_only';
ALTER ROLE propectai_sistema   PASSWORD 'sistema_ci_only';
ALTER ROLE propectai_dono      PASSWORD 'dono_ci_only';
"@ | docker exec -i $idPg psql -U propectai -d propectai -v ON_ERROR_STOP=1
  } -Critica

  $urlDono = $env:DATABASE_URL
  $env:DATABASE_URL = "postgresql://propectai_dono:dono_ci_only@localhost:$PORTA_PG/propectai?schema=public"
  try { Passo '09 migrations seguintes' { pnpm db:deploy } -Critica } finally { $env:DATABASE_URL = $urlDono }
  Passo '10 seed do catalogo'      { pnpm db:seed } -Critica

  # testes: todos rodam; o código de saída final reflete qualquer falha
  Passo '11 jest Intelligence Explorer (HTTP real)' { pnpm --filter '@propectai/api' exec jest test/intelligence-tenant.spec.ts --runInBand }
  Passo '12 suite completa (pnpm test)'             { pnpm test }
  Passo '13 portao de RLS' { Get-Content 'docs\intelligence\gate0\gate-rls.sql' -Raw | docker exec -i $idPg psql -U propectai -d propectai -v ON_ERROR_STOP=1 }
}
catch {
  $falhou = $true
  Write-Host $_.Exception.Message -ForegroundColor Red
  if ($logs) { $_.Exception.Message | Out-File -Append (Join-Path $logs '98-abortado.txt') }
}
finally {
  # ---- limpeza: SOMENTE o que esta execução criou, conferido por rótulo --------------------------------------
  foreach ($id in $criadosIds) {
    if ((RotuloDe $id) -eq $ROTULO_VAL) { & docker rm -f $id *>$null }
    else { Aviso "Contêiner $id NÃO removido: rótulo de propriedade não confere." }
  }
  if ($tmpMigr -and (Test-Path $tmpMigr) -and ($tmpMigr -like "*propectai-qa-migrations-$idExec")) { Remove-Item -Recurse -Force $tmpMigr }
  foreach ($k in $envOriginal.Keys) { [Environment]::SetEnvironmentVariable($k, $envOriginal[$k]) }

  if ($logs) {
    $resumo | Format-Table -AutoSize | Out-String | Tee-Object -FilePath (Join-Path $logs '99-resumo.txt')
    Write-Host "Logs em: $logs  (cole 99-resumo.txt e, se algo falhou, o log do passo)" -ForegroundColor Yellow
  }
}
if ($falhou) { exit 1 } else { exit 0 }
