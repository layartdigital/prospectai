# Runbook S1_C3 — rotação de credenciais e fechamento do incidente S0

**Estado:** revisado em 25/09/2026. As três decisões da §11 foram escolhidas pelo
dono do projeto entre opções apresentadas; a §11 registra o mecanismo, a data e
o que foi recusado, para que nenhuma delas dependa de eu ter "entendido" uma
preferência.

**Estado em 28/09/2026**, depois do `fix(cli)` e da decisão do dono do projeto
sobre o TTY:

```
LOCAL_AUTOMATED_TEST = PASS                            §8.3
REMOTE_CI            = PASS                            afb7e44…, run #52
TTY_COMPOSITION      = NOT_OBSERVED                    §8.4
TTY_MANUAL           = WAIVED_RISK_ACCEPTED_BY_OWNER   §8.4
GATE_S0              = OPEN
GATE_NET             = OPEN (HIGH)
```

O último run que exercitou **código** foi o #50 (`f3b383f`, §8.5). Os runs #51 e
#52 cobrem commits documentais: passaram, e é isso que provam — que o repositório
segue verde, não que algo novo foi verificado.

O passo 1 da §7.1 deixa de bloquear: não porque foi verificado, mas porque o
risco foi **aceito e registrado**. As duas coisas não são a mesma, e a §8.4
explica a diferença e o que ela custa.
**Nada aqui foi executado** — nenhuma senha girada, nenhum container recriado,
nenhum arquivo do servidor alterado.
**Escrito em:** 25/09/2026
**Ambiente alvo:** `108.174.144.216`, projeto Compose `prospectai-prod`
**Leitura prévia obrigatória:** `S0-FORENSICS-2026-08-11.md` (o que aconteceu),
`ATUALIZAR-AMBIENTE-ONLINE.md` (como este servidor é operado).

**O que este documento é:** o procedimento para (a) levar o HEAD ao ambiente
online, (b) girar as credenciais comprometidas, (c) provar que giraram.

**O que este documento não é:** ele não fecha o `GATE_S0`. A §9 lista as
evidências que permitem fechá-lo; enquanto elas não existirem,
`S0_REMEDIATION = PENDING` e `GATE_S0 = OPEN`.

---

## 0. Por que a ordem deste runbook não é preferência

Três dependências duras. Quebrar qualquer uma delas faz um passo falhar ou,
pior, ter sucesso sem efeito:

1. **A CLI de rotação não existe na imagem que está no ar.** O container atual
   foi construído em 22/09, a partir de **`2c901f2`** (medido no servidor em
   28/09; a primeira versão desta linha dizia `991f459` e ignorava o redeploy do
   dia seguinte). O `prisma/set-senha.ts` nasceu em `12095da`. Rodar
   `pnpm db:senha` antes do deploy devolve "script não encontrado" — e é o melhor
   caso; o pior seria alguém concluir que a rotação não é possível.
2. **A correção do seed precisa estar no ar antes de qualquer rotação.** Até
   `7d8db3b`, o `update` do upsert regravava `passwordHash`. Rotacionar a senha e
   depois rodar `pnpm db:seed` — por qualquer motivo, inclusive corrigir limite
   de plano — desfaria a rotação **em silêncio**. Com o HEAD no ar, o `update`
   carrega apenas `name`, e a rotação sobrevive ao seed.
3. **A troca da senha vem antes da troca do `JWT_ACCESS_SECRET`.** Na ordem
   inversa existe uma janela em que quem tem a senha publicada faz login de novo
   e recebe um token novo, já assinado com o segredo novo. Ver §5.2.

---

## 1. Pré-condições do `.env.production`

### 1.1 As duas senhas do seed

**Medido no servidor em 28/09/2026:** as duas variáveis **existem**, e é isso que
as torna piores do que se faltassem.

```
owner_len=11  sdr_len=11  iguais=sim
```

Onze caracteres, idênticas entre si — a mesma assinatura do `Demo@123456` que
estava no `.env.example` público. Isso ainda era **compatibilidade**, e não
igualdade. Por isso foi medido: comparação direta contra os valores publicados no
`.env.example` do próprio commit em que o servidor está (`2c901f2`), sem que
nenhum dos quatro valores vá à tela.

```bash
cd /opt/apps/prospectai && O=$(grep -m1 '^SEED_OWNER_PASSWORD=' .env.production | cut -d= -f2- | tr -d '\r'); S=$(grep -m1 '^SEED_SDR_PASSWORD=' .env.production | cut -d= -f2- | tr -d '\r'); PO=$(git show 2c901f2:.env.example | grep -m1 '^SEED_OWNER_PASSWORD=' | cut -d= -f2- | tr -d '\r'); PS=$(git show 2c901f2:.env.example | grep -m1 '^SEED_SDR_PASSWORD=' | cut -d= -f2- | tr -d '\r'); echo "publicado_owner_nao_vazio=$([ -n "$PO" ] && echo sim || echo nao) publicado_sdr_nao_vazio=$([ -n "$PS" ] && echo sim || echo nao)"; echo "owner_match_publicado=$([ "$O" = "$PO" ] && echo sim || echo nao) sdr_match_publicado=$([ "$S" = "$PS" ] && echo sim || echo nao)"; unset O S PO PS
```

Medido em 28/09/2026:

```
publicado_owner_nao_vazio=sim  publicado_sdr_nao_vazio=sim
owner_match_publicado=sim      sdr_match_publicado=sim
```

A primeira linha não é decoração. Sem ela o resultado seria ambíguo **na direção
perigosa**: se o `.env.example` daquele commit já estivesse com as variáveis
vazias, a comparação devolveria `nao`, e `nao` seria lido como *"não é a
credencial publicada"* — exatamente a conclusão errada. Com as duas linhas, o que
existe é **igualdade medida**, e não mais semelhança de assinatura.

Nenhum valor e nenhum hash foram impressos, e nenhuma string secreta entrou na
linha de comando — portanto nada disso ficou no histórico do shell do servidor.

> **Correção de 28/09.** A primeira versão desta seção dizia que as duas
> variáveis **não existiam**, com base em medição de 25/09. Estavam lá. A
> conclusão — *"`pnpm db:seed` naquele servidor falha"* — continua certa, e pelo
> motivo **errado**: não por ausência, mas porque `11 < 12` e porque são iguais,
> as duas guardas de `packages/types/src/seed-usuarios.ts`.

Isso muda o procedimento de **acrescentar** para **substituir**, e acrescenta um
fato ao registro do S0 — registrado no `S0-FORENSICS §1.1`: existe uma **terceira
cópia** da credencial publicada, agora no `.env.production`, e ela é uma cópia
**medida**, não inferida: `SEED_*` não é consultado na autenticação; porém os
valores encontrados coincidiam com uma credencial funcional.

> **Por que esta frase foi trocada.** A versão anterior dizia *"ela não concede
> acesso sozinha"*, o que sugere que faltava um ingrediente para o acesso
> funcionar. Não falta nada: o valor **é** a credencial que abre as duas contas.
> O que é verdade é mais estreito — o arquivo não participa da autenticação.

```bash
cd /opt/apps/prospectai
C="docker compose --env-file .env.production -f compose.prod.yml"
B=${B:?defina B como na §6.1 antes de copiar o .env.production}

cp -p .env.production "$B/env.production-antes-seed.bak"
S_OWNER=$(openssl rand -hex 24); S_SDR=$(openssl rand -hex 24)
sed -i '/^SEED_OWNER_PASSWORD=/d; /^SEED_SDR_PASSWORD=/d' .env.production
printf 'SEED_OWNER_PASSWORD=%s\nSEED_SDR_PASSWORD=%s\n' "$S_OWNER" "$S_SDR" >> .env.production
unset S_OWNER S_SDR
grep -c '^SEED_OWNER_PASSWORD=' .env.production; grep -c '^SEED_SDR_PASSWORD=' .env.production
```

Os dois `grep -c` têm de dizer `1`. **Contagem, não conteúdo** — o valor nunca
vai à tela. O `sed` que apaga antes de acrescentar já era o que tornava o passo
repetível (lição do `APP_VERSION` duplicado); agora ele é também o que faz a
**substituição** funcionar, sem que o procedimento precise mudar.

Depois, confirmar que a substituição pegou, com a mesma medição que expôs o
problema — comprimento e igualdade, nenhum valor:

```bash
O=$(grep -m1 '^SEED_OWNER_PASSWORD=' .env.production | cut -d= -f2-); S=$(grep -m1 '^SEED_SDR_PASSWORD=' .env.production | cut -d= -f2-); echo "owner_len=${#O} sdr_len=${#S} iguais=$([ "$O" = "$S" ] && echo sim || echo nao)"; unset O S
```

Esperado: `owner_len=48 sdr_len=48 iguais=nao`. Antes da correção, em 28/09, isto
devolvia `owner_len=11 sdr_len=11 iguais=sim`.

Comprimento e desigualdade entre si **não bastam**: duas senhas de 48 caracteres
diferentes uma da outra ainda poderiam, em teoria, ter sido copiadas de qualquer
lugar. O que fecha o passo é **repetir o comando de comparação do começo desta
seção**, sem alterar uma letra, agora esperando o resultado **oposto**:

```
owner_match_publicado=nao  sdr_match_publicado=nao
```

O comando continua funcionando **depois** do deploy, quando o servidor já não
estiver em `2c901f2`: o `git checkout -f -B main origin/main` da §6.2 não
reescreve história — força-push é proibido —, então `2c901f2` segue alcançável
como ancestral e `git show 2c901f2:.env.example` continua devolvendo a versão
que vazou. É por isso que a referência é o commit, e não a string: comparar
contra a senha literal exigiria escrevê-la na linha de comando.

As quatro medições juntas — presença, `48/48`, `iguais=nao` e `match=nao/nao` —
são o que a `E2` exige. Nenhuma delas sozinha é suficiente, e é por isso que a
`E2` deixou de aceitar presença.

### 1.2 Estas duas variáveis **não** são a senha do OWNER

Vale dizer com todas as letras, porque a leitura natural é a errada:

- `SEED_*_PASSWORD` só é usada no **`create`** do upsert. Os dois usuários já
  existem no banco. Rodar o seed depois disto **não muda a senha de ninguém**.
- A senha real do OWNER passa a ser a que for digitada no `pnpm db:senha` (§3),
  e ela **não mora em arquivo nenhum do servidor** — mora no gerenciador de
  senhas do dono do projeto.

Por isso os valores acima são aleatórios e descartáveis: eles existem para que o
seed volte a rodar, não para que alguém entre com eles.

### 1.3 Achado de 25/09 — o `.env.example` público ainda traz `Demo@123456`

**Medido na árvore de trabalho local**, `.env.example`, linhas 184 e 186:

```
SEED_OWNER_PASSWORD=Demo@123456
SEED_SDR_PASSWORD=Demo@123456
```

O `README.md` (linha 54), alterado no mesmo commit `7d8db3b`, afirma o
contrário: que as duas senhas *"nascem vazias e o seed exige"*. **Uma das duas
afirmações é falsa, e é a do README.**

Três consequências, em ordem de gravidade:

1. **A credencial da §1.1 do `S0-FORENSICS` continua publicada.** O repositório é
   público. O achado que originou o `GATE S0` não foi removido da sua origem —
   foi removido do código que a consome, o que é outra coisa.
2. **O exemplo quebra o seed duas vezes:** `Demo@123456` tem 11 caracteres
   (mínimo 12) e as duas variáveis são idênticas (proibido desde `7d8db3b`).
   Quem clonar o repositório hoje e seguir o `.env.example` recebe um erro.
3. **README e `.env.example` se contradizem**, e o README descreve o estado
   pretendido, não o real.

**Hipótese:** o commit `7d8db3b` alterou `README.md`, `prisma/seed.ts`,
`packages/types/` e `ci.yml`, e **não** alterou `.env.example`.

**Falsificação executada em 25/09/2026**, com `git show HEAD:.env.example` e
`git diff --stat`: o `HEAD` traz `Demo@123456` nas duas variáveis e não há
alteração local. **Hipótese confirmada.** O defeito está no commit, não na
árvore de trabalho.

### 1.4 O que a correção do `.env.example` **não** faz

Esvaziar as duas variáveis no `HEAD` **não despublica a senha**. Ela continua
legível no histórico do repositório público, por `git show 7d8db3b^:.env.example`
e por qualquer cópia já clonada. Removê-la do histórico exigiria reescrever
commits publicados e `force-push`, que está proibido — e, ainda assim, não
alcançaria os clones existentes.

Portanto: **a correção do `.env.example` evita exposição futura e destrava o
seed; ela não é a remediação.** A remediação é a rotação da §3, e é por isso que
o gate não fecha sem a evidência **E8** — a senha publicada deixar de funcionar.
Tratar a edição do arquivo como se fosse o conserto seria o mesmo erro de
trocar o e-mail do OWNER e chamar aquilo de rotação de credencial.

**Correção aplicada no commit `db3c77e`** — as duas variáveis passam a nascer
vazias, com o registro do que aconteceu e a instrução de geração ao lado. É a
razão de o C3 não ter sido um commit apenas documental: ele corrigiu a
pré-condição que ele próprio documenta. Decisão **D1** da §11.

---

## 2. `JWT_REFRESH_SECRET` sai de vez

**Medido:** ausente do `.env.example` e do `ci.yml` (saiu em `12095da`);
**presente** no `.env.production` do servidor.

O refresh token não é JWT: são 48 bytes aleatórios guardados como hash, para
serem revogáveis. Nunca houve o que assinar, e nenhum código jamais leu a
variável. Variável de segredo que ninguém lê é pior que variável ausente —
sugere um controle que não existe, e alguém um dia vai "rotacioná-la" e achar
que fez algo.

```bash
cp -p .env.production /opt/backups/env.production-$(date +%Y%m%d-%H%M).bak
sed -i '/^JWT_REFRESH_SECRET=/d' .env.production
grep -c '^JWT_REFRESH_SECRET=' .env.production   # tem de dizer 0
```

Nenhum serviço precisa ser reiniciado por causa disto. A API só releria a
variável se a lesse, e não lê. A recriação do container acontece na §4, por
outro motivo.

---

## 3. `pnpm db:senha` — procedimento operacional

### 3.1 O que a CLI faz, em uma frase por escrita

Uma transação, três escritas: grava o `passwordHash` novo, revoga **todas** as
sessões ainda válidas do usuário, e registra `SECURITY.PASSWORD_ROTATED` em
`audit_logs` com `tenantId` nulo. Falha em qualquer uma desfaz as outras. O
Argon2 é calculado **fora** da transação.

A senha entra por `stdin`, nunca por argumento — argumento aparece no histórico
do shell, no `ps` de qualquer processo da máquina e no log de auditoria do
sistema operacional. Nada de senha e nada de hash sai em log, em `stdout` ou na
trilha.

### 3.2 Antes de rodar

```bash
$C run --rm api ls prisma/set-senha.ts
$C run --rm api pnpm db:senha
$C run --rm api sh -c 'printenv DATABASE_URL_MIGRATOR' | sed -E 's#:[^@]*@#:***@#'
```

1. O primeiro comando prova que a imagem em uso já é a do HEAD. Se der
   "No such file", o deploy da §6 não aconteceu — **parar aqui**.
2. O segundo roda a CLI sem argumentos: tem de imprimir o texto de uso e sair
   com código 1. Prova que ela carrega, conecta o `dotenv` e lê o `argv`, sem
   tocar em nada.
3. O terceiro tem de devolver uma URL com `propectai_migrator` e `:***@`. Se vier
   vazio, a CLI cairia no `DATABASE_URL` (o dono, superusuário) e a escrita ainda
   funcionaria — **pelo motivo errado**. A linha de auditoria global exige
   `BYPASSRLS`, e é o `migrator` que o tem por desenho.

`$C run --rm` cria um container efêmero a partir da mesma imagem e do mesmo
`env_file`. **Não toca no container da API que está servindo.** Os `depends_on`
já estão no ar; nada sobe nem desce.

### 3.3 A rotação

```bash
$C run --rm api pnpm db:senha owner@demo.propectai.local "rotacao S0 - credencial publicada em .env.example"
```

O terminal pede `Senha nova:` e depois `Repita a senha:`. **Nada aparece na
tela enquanto se digita** — nem caracteres, nem asteriscos. Esse comportamento
tem de ter sido conferido antes, em conta descartável (§8).

- A senha vem do gerenciador de senhas, com 12 caracteres ou mais. **Não** a
  gere no servidor, **não** a digite em nenhum outro lugar desta sessão SSH.
- Se o prompt **não** aparecer e o terminal ficar parado, o `run` não alocou TTY:
  `Ctrl+C` e repetir. Nunca contornar com `echo senha | ...` — isso põe o segredo
  no histórico do shell.
- Se as duas digitações divergirem, a CLI diz `As duas digitacoes nao conferem.
  Nada foi alterado.` e sai com 1. Nada foi escrito; repetir.

Saída esperada, exatamente três linhas úteis:

```
  Senha trocada: owner@demo.propectai.local
  Refresh tokens validos revogados: N
  Trilha: SECURITY.PASSWORD_ROTATED (evento global, tenantId nulo)
```

Anotar `N`. Ele é conferido contra o banco na §9 (E4), e a medição do banco tem
de ser feita **antes** e **depois** — só o par prova alguma coisa.

> **O rótulo não é detalhe.** `N` conta **refresh tokens que ainda valiam** no
> instante da rotação, e não sessões: uma cadeia de rotação produz várias linhas
> para o mesmo navegador. Linha expirada não entra na conta e não recebe
> `revokedAt` — se recebesse, deixaria de ser distinguível de uma revogada de
> verdade, e a próxima apuração perderia essa diferença. É a mesma confusão entre
> *registro de refresh* e *sessão* que o `S0-FORENSICS` teve de corrigir.

---

## 4. Troca do `JWT_ACCESS_SECRET`

**Medido:** a variável é lida em dois pontos, os dois em `apps/api` —
`auth.service.ts:232` (assinatura) e `common/jwt-auth.guard.ts:39` (verificação),
ambos com `getOrThrow`, sem valor padrão. `apps/web` **não** verifica assinatura
(`middleware.ts` confere presença de cookie, e diz isso de si mesmo).
`apps/worker` não a lê. **Só o container `api` precisa ser recriado.**

```bash
cp -p .env.production /opt/backups/env.production-$(date +%Y%m%d-%H%M).bak
S=$(openssl rand -hex 48)
sed -i '/^JWT_ACCESS_SECRET=/d' .env.production
printf 'JWT_ACCESS_SECRET=%s\n' "$S" >> .env.production
unset S
grep -c '^JWT_ACCESS_SECRET=' .env.production      # tem de dizer 1
$C up -d --force-recreate api
docker inspect -f '{{.State.StartedAt}}' prospectai-prod-api-1
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3102/api/v1/health
```

`--force-recreate` e não `restart`: o `ConfigService` do Nest lê o ambiente do
**processo**, e o ambiente do processo nasce com o container. `restart` reinicia
o processo dentro do mesmo container, com o mesmo ambiente — e a troca não teria
efeito nenhum, sem erro nenhum.

Serviço nomeado. **Sem `down`, sem `--remove-orphans`.**

---

## 5. Efeito sobre sessões e access tokens

É a parte que se erra por analogia com outros sistemas. São **três** efeitos
distintos, e nenhum deles faz o trabalho dos outros dois.

### 5.1 Os três efeitos

| Ação | O que morre na hora | O que sobrevive |
|---|---|---|
| `db:senha <usuário>` | a senha antiga; **todos os refresh tokens ainda válidos** daquele usuário (`revokedAt` preenchido) | os **access tokens já emitidos** daquele usuário, por até 15 minutos; e as linhas já expiradas, que continuam apenas expiradas |
| Troca do `JWT_ACCESS_SECRET` + recriar `api` | **todos** os access tokens de **todos** os usuários, imediatamente | os refresh tokens não revogados — quem tiver um recebe access token novo |
| As duas, nesta ordem | tudo do usuário rotacionado | nada dele |

**Por que o access token sobrevive à revogação:** o `JwtAuthGuard` não consulta
o banco — por desenho, decidido no S1_C2. Ele valida assinatura e expiração e
mais nada. Revogar sessão no banco não alcança um token que já está no
navegador. O prazo é o `JWT_ACCESS_TTL`, hoje `15m`.

**Por que a troca do segredo não encerra sessão:** `/auth/refresh` autentica pelo
cookie `pa_rt`, que é opaco e conferido no banco — não pelo access token. Trocar
o segredo obriga uma ida ao `/auth/refresh`, e quem tem refresh válido passa por
ela sem perceber.

### 5.2 A ordem

**`db:senha` primeiro, troca do segredo depois.**

- Nesta ordem: a senha publicada para de funcionar, os refresh tokens caem, e a
  troca do segredo mata a janela de ≤15 minutos dos access tokens que restavam.
  Ao fim, nada da credencial antiga sobrevive.
- Na ordem inversa: entre um passo e outro, quem tem a senha publicada faz login
  e recebe um par novo de tokens — já com o segredo novo. A rotação seguinte não
  o alcança, porque ele não é antigo.

### 5.3 O laço de redirecionamento — medido, não previsto

`apps/web/src/middleware.ts` confere **presença** do cookie `pa_at`, não
assinatura ("validar JWT no edge exigiria o segredo fora da API", linha 26). Com
o segredo trocado, um navegador que ainda tenha o cookie antigo entra nisto:

```
/dashboard -> middleware ve pa_at presente -> libera
           -> API responde 401 (assinatura invalida)
           -> layout redireciona para /login
           -> middleware ve pa_at presente e /login e publica -> redireciona para /dashboard
           -> ...
```

O próprio comentário do middleware descreve esse laço para o caso do token
expirado. **Ele se resolve sozinho em até 15 minutos**, quando o navegador apaga
o cookie pelo `maxAge`. Antes disso, o sintoma é `ERR_TOO_MANY_REDIRECTS`.

**Consequência operacional:** logo após a §4, limpar os cookies do ambiente no
navegador antes de tentar entrar. Não é defeito introduzido pela rotação — é uma
lacuna que a rotação torna visível, e entra na dívida técnica: *o middleware não
distingue cookie presente de cookie válido.*

### 5.4 Política

- **Este incidente:** troca do `JWT_ACCESS_SECRET` **é** executada, porque o
  objetivo é anular tokens possivelmente emitidos para terceiro, e a janela de
  15 minutos é justamente o que não se quer deixar aberta.
- **Rotações de rotina** (troca de senha a pedido do usuário, higiene
  periódica): a janela de ≤15 minutos é **aceita**, e o segredo global não é
  trocado. Trocá-lo derruba todo mundo para resolver o problema de um.

---

## 6. Deploy, rollback e validação

### 6.1 Pré-voo

```bash
cd /opt/apps/prospectai
git log -1 --format='%h %s'
```

Tem de dizer **`2c901f2`** — medido em 28/09/2026. Se disser outra coisa, o
restante desta seção parte de uma premissa falsa: parar e remedir.

> **Correção de 28/09.** Esta linha exigia `991f459`, que é onde o servidor ficou
> em 21/09. No dia seguinte o `2c901f2` foi deployado, e eu escrevi a seção sem
> contar esse redeploy. O pré-voo de 28/09 pegou a divergência **antes** de a
> §6.2 usar a base errada, que é exatamente para isso que ele existe.

Antes de escrever o primeiro byte, três medições de postura — read-only, feitas
em 28/09/2026 e reproduzíveis:

```bash
umask; stat -c '%a %U:%G %n' /opt/backups .env.production
git status --short --untracked-files=all; git diff --stat; git diff --cached --stat
```

Medido:

```
0002
775 root:root /opt/backups
600 root:root .env.production
```

e as três consultas ao git **vazias** — árvore limpa, nada staged, nada tracked
modificado. Só com as três vazias o `git checkout -f` da §6.2 é seguro: com `-f`,
qualquer edição feita direto no servidor some sem aviso.

> **O que essas duas primeiras linhas obrigam.** `umask 0002` cria arquivo novo
> com modo `664` — legível por **qualquer** usuário local. `/opt/backups` é `775`,
> ou seja, atravessável e listável por todos. Um `pg_dump` gravado ali nasceria
> world-readable, e este servidor hospeda 17 vhosts de terceiros. O dump contém
> e-mails, `passwordHash` e a base de leads inteira.
>
> O `.env.production` **está correto**: `600 root:root`. Ele só continua correto
> na cópia porque `cp -p` preserva o modo — sem o `-p`, a cópia nasceria `664`.
>
> Nada disso é alterado: mudar o modo de `/opt/backups`, diretório compartilhado
> do host, afetaria outras stacks. A saída é não depender dele.

Por isso o backup vai para um **diretório exclusivo desta execução**, criado já
privado e com `umask 077` valendo dentro do subshell:

```bash
cd /opt/apps/prospectai
C="docker compose --env-file .env.production -f compose.prod.yml"
B="/opt/backups/prospectai-s0-$(date +%Y%m%d-%H%M)"
install -d -m 700 "$B"
( umask 077
  docker exec prospectai-prod-postgres-1 pg_dump -U propectai propectai \
    | gzip > "$B/propectai.sql.gz"
  tar czf "$B/prospectai-arvore.tgz" \
    --exclude=node_modules --exclude=services/google-maps-scraper -C /opt/apps prospectai
  $C images > "$B/imagens.txt"
)
stat -c '%a %U:%G %s %n' "$B" "$B"/*
```

O `C` é definido **aqui**, e não só na §1.1: na ordem da §7.1 esta seção roda
primeiro, e com `C` indefinido o `$C images` viraria um `images: command not
found` **dentro do subshell**, sem interromper o resto — o backup terminaria sem
o `imagens.txt` e o operador só notaria contando arquivos.

`install -d -m 700` define o modo **explicitamente**, sem depender do `umask` —
um `mkdir` simples, sob `0002`, nasceria `775`. O `umask 077` vale dentro dos
parênteses porque é ali que as redireções acontecem; fora do subshell o ambiente
volta ao que era, sem efeito colateral em nada mais da sessão.

A última linha é a verificação, e ela é obrigatória. Três coisas de uma vez:

- **`700`** no diretório e **`600`** em cada arquivo;
- **três arquivos**, nomeados — `propectai.sql.gz`, `prospectai-arvore.tgz`,
  `imagens.txt`;
- **tamanho plausível** em cada um. O `%s` está no formato porque não há `set -e`
  aqui: se o `pg_dump` falhar, o `gzip` ainda cria o arquivo, e um `.sql.gz` de
  poucas dezenas de bytes é um backup vazio com cara de backup.

Qualquer divergência — parar, não seguir para a §6.2, e não deixar o dump onde
está.

O `imagens.txt` é o caminho de volta: sem os IDs das imagens atuais anotados, o
rollback vira reconstrução às cegas. O `$B` desta execução é o mesmo usado pela
§1.1 para copiar o `.env.production` antes de editá-lo — por isso aquela seção
recusa rodar com `B` indefinido em vez de escrever num caminho público.

### 6.2 Sequência

```bash
git fetch origin main
git checkout -f -B main origin/main
git log -1 --format='%H %s'
git diff --name-only 2c901f2..HEAD -- prisma/migrations | wc -l
```

O SHA tem de ser o mesmo que o CI aprovou. A última linha decide o passo
seguinte:

- **`0`** — não há migration nova. Não é preciso parar api e worker; o
  `--force-recreate` do passo abaixo já troca o código.
- **maior que `0`** — parar `api` e `worker` (`$C stop api worker`), rodar
  `$C run --rm api pnpm db:deploy`, e só então seguir. Código antigo lendo
  schema novo responde errado em silêncio, que é pior que ficar fora do ar.

Então as pré-condições de ambiente (**§1 e §2**, que precisam estar no arquivo
antes de o container nascer), e depois:

```bash
$C build api worker web
$C up -d --force-recreate api worker web
$C ps
```

O `infra/nginx/default.conf` não mudou neste intervalo; o `gateway` não é
tocado. Se um dia mudar, vale o passo 6 do `ATUALIZAR-AMBIENTE-ONLINE.md`:
`nginx -t` em container descartável **antes** de `restart gateway`.

### 6.3 Rollback

**De código, sim:**

```bash
git checkout -f -B main 2c901f2
$C build api worker web
$C up -d --force-recreate api worker web
```

**De credencial, não.** O `.env.production` guardado em `/opt/backups/` existe
para recuperar um erro de digitação **na mesma sessão, antes de a rotação ser
dada por concluída**. Restaurá-lo depois da §3 e da §4 reinstala o
`JWT_ACCESS_SECRET` comprometido e desfaz a remediação sem desfazer o incidente.
Rollback de código e rollback de segredo são operações diferentes e não andam
juntas.

### 6.4 Validação pós-deploy

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3102/api/v1/health
$C exec -T api printenv DATABASE_URL_APP | sed -E 's#:[0-9a-f]{48}@#:***@#'
docker logs prospectai-prod-worker-1 2>&1 | grep "Provider de auditoria"
docker logs prospectai-prod-api-1 2>&1 | grep -c 'redis://:\*\*\*@'
docker logs prospectai-prod-api-1 2>&1 | grep -c 'redis://:[^*]'
docker exec -i prospectai-prod-postgres-1 psql -U propectai -d propectai \
  -v ON_ERROR_STOP=1 < docs/intelligence/gate0/gate-rls.sql
```

Esperado, em ordem: `200`; uma URL com `propectai_app` e
`&connection_limit=15`; `nativo (DNS e socket reais)`; **`1` ou mais**;
**exatamente `0`**; portão RLS 6/6 com saída `0`.

As duas contagens de log são o par que prova a correção `urlSemSenha`
(`2c901f2`): a primeira mostra que a linha mascarada existe, a segunda que
nenhuma linha traz senha em claro. **Uma sem a outra não prova nada** — ausência
de `redis://` no log significaria apenas que o serviço ainda não conectou.

---

## 7. Fechamento do incidente

### 7.1 A sequência completa

**Esta tabela é a fonte canônica da ordem.** Resumo em prosa — meu, de e-mail, de
mensagem — não substitui nem reordena o que está aqui. Em 28/09/2026 um resumo
meu omitiu o passo 7 e colocou a rotação antes da validação pós-deploy; o dono do
projeto recusou. Divergiu do quadro, o quadro vence.

| # | Passo | Seção |
|---|---|---|
| 1 | ~~Verificação manual de não-eco em TTY~~ — **dispensado** por `D4`, com mitigação operacional obrigatória | §8.4 |
| 2 | Pré-voo, backup do banco, da árvore e dos IDs de imagem | §6.1 |
| 3 | Checkout do HEAD, decisão sobre migrations | §6.2 |
| 4 | `SEED_OWNER_PASSWORD` e `SEED_SDR_PASSWORD` no `.env.production` | §1.1 |
| 5 | `JWT_REFRESH_SECRET` removido do `.env.production` | §2 |
| 6 | Build e `--force-recreate` de api, worker e web | §6.2 |
| 7 | Validação pós-deploy | §6.4 |
| 8 | `db:senha` no OWNER | §3.3 |
| 9 | `db:senha` na conta SDR, com senha **diferente** da do OWNER | §7.2 |
| 10 | Troca do `JWT_ACCESS_SECRET` e recriação da `api` | §4 |
| 11 | Limpar cookies do navegador; entrar com a senha nova | §5.3 |
| 12 | Coletar as evidências E1–E9 | §9 |
| 13 | Commit separado movendo `GATE_S0` para `PASS` | §9 |

Os passos 8 e 10 nesta ordem, pelo motivo da §5.2. O passo 13 é **outro commit**:
fechar gate é decisão, e decisão não anda junto com procedimento.

### 7.2 A conta SDR — decidido em 25/09/2026

`sdr@demo.propectai.local` tem hoje **o mesmo `passwordHash` do OWNER**
(impressão `md5` idêntica, medido no S0 §1.1) e essa senha está publicada.

**Decisão D2 da §11: rotacionar agora**, com senha própria, mantendo a conta
ativa para demonstrar o papel SDR.

```bash
$C run --rm api pnpm db:senha sdr@demo.propectai.local "rotacao S0 - hash compartilhado com o OWNER"
```

A senha **tem de ser diferente** da do OWNER. Não é exigência do código — a CLI
não compara contas entre si —, é o defeito inteiro que o S0 apurou: duas contas,
uma credencial. Repetir a senha aqui reproduziria a falha com um valor novo, e a
evidência **E5** deixaria de significar o que significa.

Descartadas, e por quê:

- **Desativar** (`isActive = false`) — desde `12095da` isso tem efeito real
  (conta inativa não emite nem renova sessão, e continua revogável). Fica
  disponível para quando o ambiente deixar de ser demonstração; hoje custaria a
  única forma de exercitar o papel SDR.
- **Deixar como está** — é a mesma credencial publicada, numa conta que ninguém
  acompanha.

### 7.3 O que **não** fecha com este incidente

Fechar `GATE_S0` significa "a credencial comprometida foi girada e há prova
disso" — e nada além. Continuam abertos, e é preciso que fiquem visíveis:

- **`GATE_NET`, severidade HIGH** — a porta 3102 publicada em `0.0.0.0`, em
  paralelo ao nginx do host, num servidor que hospeda negócios de terceiros, e o
  `/auth/register` público nessa mesma superfície (lacunas `S0-NET-01` e 5).

  > **Decisão D3 da §11:** o `S0-NET-01` deixa de bloquear o `GATE_S0` e
  > passa a ser gate próprio, atrelado ao gate de domínio. A razão é de escopo,
  > não de gravidade — a exposição é anterior ao incidente, independente dele, e
  > só se resolve por uma decisão de domínio ainda não tomada. **A severidade
  > não é rebaixada por ter mudado de gate**, e a tabela de gates fica registrada
  > na §4 do `S0-FORENSICS-2026-08-11.md`.

- **Lacunas 1, 2 e 3 do S0** — IP real não registrado, `login`/`logout`/`refresh`
  sem trilha, leituras não auditadas. Dívida de produto, de nenhum gate: enquanto
  valerem, a próxima apuração terá exatamente os limites que esta teve.
- **`trust proxy`** — suspenso até medir o `remote_addr` que chega ao gateway em
  cada cadeia.
- **A senha publicada continua no histórico do repositório** (§1.4). Isso não
  reabre o gate, porque a credencial terá sido girada; mas quem ler o histórico
  em 2027 vai encontrá-la, e precisa encontrar junto o registro de que ela morreu.

---

## 8. Não-eco em TTY — execução de 26 a 28/09/2026

**Estado no fecho desta seção:**

```
LOCAL_AUTOMATED_TEST = PASS                            27 casos, na máquina
REMOTE_CI            = PASS                            §8.5
TTY_COMPOSITION      = NOT_OBSERVED                    §8.4
TTY_MANUAL           = WAIVED_RISK_ACCEPTED_BY_OWNER   §8.4
```

`LOCAL_AUTOMATED_TEST` **não é CI**, e a distinção vale a linha: enquanto não
houver commit, push e Actions verde no SHA correspondente, o que existe é teste
que passou numa máquina. O run remoto veio em `f3b383f` e está na §8.5.

### 8.1 O que a execução encontrou

A validação era para confirmar um comportamento. Encontrou **seis defeitos**, e
os seis estavam no caminho do terminal — o caminho que nenhum teste exercitava,
porque o teste da CLI usa `stdin` de cano.

| # | Defeito | Consequência | Como apareceu |
|---|---|---|---|
| 1 | silêncio do eco era um flag no `process.stdout`, ligado **depois** de `rl.question()` | a **confirmação de senha podia não acontecer**, sem aviso: o prompt `Repita a senha` era engolido e a segunda leitura consumia a linha já no buffer | duas linhas em branco na saída, onde deveria haver uma |
| 2 | `Ctrl+C` sem ouvinte de `SIGINT` no `readline` | o processo **não morria**: o sinal apenas pausava a entrada, e o terminal ficava em modo cru | processo parado no prompt |
| 3 | rótulo escrito por fora do `readline` (1ª tentativa de conserto) | `readline` calculava coluna a partir de um prompt vazio → **linhas sobrescritas** | pedaço do prompt do shell escrito sobre a linha de erro |
| 4 | descarte do resto do pedaço após o Enter | colagem em **dois** pedaços deixaria a 2ª linha no buffer do console, e o PowerShell a executaria como comando — **senha no histórico do shell** | identificado como risco antes de executar, a partir de uma pergunta do dono do projeto |
| 5 | `\r\n` contado como **duas** quebras | colar duas linhas punha uma linha vazia entre elas; a confirmação recebia o vazio | invisível digitando (Enter manda só `\r`); apareceu ao investigar por que `Ctrl+V` não colava |
| 6 | sequência ANSI contaminando o texto | `ESC` era filtrado, mas `[D` de uma seta e `[200~` de colagem **entravam na senha** — e havia comentário afirmando o contrário | mesma investigação |

Os defeitos 5 e 6 eram **invisíveis à digitação e visíveis só à colagem**, que é
o caminho que a rotação real vai usar: a senha nova vem de gerenciador de senhas.

### 8.2 Passos observados

Conta descartável `sdr@demo.propectai.local`, banco local, senhas descartáveis.

| # | Ação | Resultado exigido | Observado |
|---|---|---|---|
| 1 | rodar `pnpm db:senha <conta> "<motivo>"` | `Senha nova: ` na mesma linha | **OK**, 5 execuções |
| 2 | digitar 12+ caracteres | nada na tela | **OK** |
| 3a | Enter | `Repita a senha: ` aparece | **OK**, 5 execuções |
| 3b | colar duas linhas de uma vez | 2ª pergunta aparece, é respondida pela fila, nada escapa para o shell | **OK** — com **clique direito**; `Ctrl+V` não cola em modo cru |
| 4 | duas entradas diferentes | `As duas digitacoes nao conferem. Nada foi alterado.`, saída 1 | **OK** |
| 5 | duas entradas iguais | três linhas, nenhuma com a senha | **OK** |
| 6 | rolar a tela | nenhum fragmento, nenhuma linha sobrescrita | **PARCIAL** — nada no visível; varredura completa não reportada |
| 7 | `Get-History` | comandos sem senha, nenhuma entrada espúria | **OK** — 14 entradas, todas legítimas |
| 8 | `Ctrl+C` no prompt, depois digitar | mensagem, saída ≠ 0, e **o eco de volta** | **NÃO EXECUTADO** — ver §8.4 |

**O passo 8 não foi executado em nenhuma das oito tentativas até 28/09/2026.**
Todas terminaram com as duas digitações concluídas e rotação bem-sucedida, o que
exige duas linhas completas de entrada — ou seja, o `Ctrl+C` não chegou ao
processo em nenhuma delas. Não há observação da CLI interrompida.

### 8.3 O que mudou no código, e o que isso tira do manual

A interpretação das teclas saiu de `prisma/set-senha.ts` e virou função **pura**
em `prisma/lib/teclas-de-segredo.ts`, testada em
`apps/api/test/teclas-de-segredo.spec.ts` — mesmo arranjo de `rotacionar-senha.ts`,
e o import de `prisma/lib` existe **só no teste**.

Os casos: `Ctrl+C` e `Ctrl+D`, `\r\n` como uma quebra, cinco sequências ANSI,
backspace **por ponto de código** (apagar um emoji não pode deixar meia unidade
UTF-16 no texto), sequência cortada entre dois pedaços de `data`, linha vazia
legítima, acento e emoji.

A razão é de método, não de estética: **quando um passo depende de um gesto
humano irrepetível, ele não verifica nada.** O que pode virar asserção, virou. A
contagem das tentativas fica na §8.4, que é onde ela serve de evidência.

Sobrou **um** item manual, e ele não cabe em runner nenhum:

> Depois de um `Ctrl+C` no prompt, o terminal volta a ecoar?

`desligarTerminal()` chama `setRawMode(eraCru)` — efeito no dispositivo, não
valor devolvido. Nenhuma asserção alcança isso.

### 8.4 `TTY_MANUAL` — o que está medido e o que não está

Depois da sétima tentativa frustrada, a pergunta foi decomposta em elos que se
medem separadamente. Isso muda o valor do `PENDING`: ele deixa de ser "não
sabemos nada" e passa a nomear **um** elo.

| Elo | Estado | Como foi estabelecido |
|---|---|---|
| o terminal entrega `Ctrl+C` ao processo em modo cru | **PASS** | `node -e` mínimo, fora da CLI: imprimiu `byte 3` |
| o parser transforma `0x03` em `interrompido` | **PASS** | 2 casos em `teclas-de-segredo.spec.ts` |
| `setRawMode(false)` devolve o terminal | **PASS** | o mesmo `node -e` restaurou e o prompt voltou usável |
| **a composição dos três dentro da CLI** | **PENDENTE** | nunca executada |

O elo que falta não é hipotético nem improvável — as três pontas estão provadas,
e o caminho entre elas é `interromper() → desligarTerminal()`, seis linhas.
**Mas não foi observado, e por isso não está verificado.**

Falta, então:

1. Uma execução com `Ctrl+C` no primeiro prompt, **sem digitar senha**, com:
   `Interrompido no prompt. Nada foi alterado.`, `$LASTEXITCODE` ≠ 0, e os
   caracteres do comando seguinte aparecendo na tela.
2. A varredura completa do scroll, fechando o passo 6.

Se o eco **não** voltar, o gate falha e a correção vem antes de qualquer
produção. `stty sane` — ou fechar a janela, no PowerShell — recupera o terminal
no momento, e não conta como conserto.

### Decisão do dono do projeto, 28/09/2026

```
TTY_COMPOSITION = NOT_OBSERVED
TTY_MANUAL      = WAIVED_RISK_ACCEPTED_BY_OWNER
```

Depois de **oito tentativas até 28/09/2026**, nenhuma delas exercitando o
`Ctrl+C` dentro da CLI, o dono do projeto decidiu **não repetir o teste manual** e
aceitar o risco. O passo 1 da §7.1 deixa de bloquear.

**`WAIVED` não é `PASS`, e este documento não vai escrever `PASS`.** O elo
continua não observado; o que mudou foi a disposição de conviver com ele.

**Raio de dano, que é o que sustenta a decisão.** Se `interromper() →
desligarTerminal()` falhar em restaurar o eco, a consequência é **um terminal em
modo cru** — irritante, recuperável. A rotação não é afetada: o caminho de
interrupção **recusa antes de qualquer escrita**, porque `interromper()` rejeita
a Promise, `main()` cai no `catch` e `rotacionarSenha` nunca chega a ser chamada.
Não há estado parcial no banco, senha meio trocada ou sessão meio revogada.

**Mitigação operacional, obrigatória na rotação de produção:**

- rodar `pnpm db:senha` numa **sessão SSH dedicada**, sem nada mais em andamento
  nela;
- se for preciso abortar, ou se o terminal se comportar de forma inesperada,
  **encerrar a sessão** em vez de depender do `Ctrl+C`;
- não emendar outro comando nessa sessão sem confirmar que o eco voltou.

### 8.5 `REMOTE_CI` — run remoto do código desta seção

```
SHA        f3b383f51b77484d3acf62a8f03cf51831631b7e
Run        GitHub Actions #50, ci.yml, on: push, branch main
Duração    2m51s
Status     Success
```

Verificados diretamente pelo dono do projeto como `success`:

| Job / step | |
|---|---|
| `Tipos` / `pnpm typecheck:all` | ✅ |
| `Semear o catalogo` | ✅ |
| `Suite completa` | ✅ |
| `Portao de RLS` | ✅ |
| `Relatorio de RLS` | ✅ |

```
REMOTE_CI = PASS
```

---

## 9. Evidências para mover `GATE_S0` de `OPEN` para `PASS`

Nenhuma delas imprime senha ou hash. `E5` imprime a impressão `md5` **do hash**,
que é o mesmo indicador já usado na apuração do S0.

| id | Evidência | Como | Esperado |
|---|---|---|---|
| **E1** | O que está no ar é o que o CI aprovou | `git log -1 --format='%H'` no servidor | igual ao SHA verde no GitHub Actions |
| **E2** | Pré-condições de ambiente | `grep -o '^[A-Z_]*=' .env.production \| sort` **e** as **duas** medições da §1.1: comprimento/igualdade **e** comparação contra `2c901f2` | `JWT_REFRESH_SECRET` **ausente**; `owner_len=48 sdr_len=48 iguais=nao`; `owner_match_publicado=nao sdr_match_publicado=nao`. Presença não serve; comprimento sem a comparação também não |
| **E3** | A rotação deixou trilha | consulta 1, abaixo | uma linha por conta rotacionada, `tenantId` nulo, `after` com `motivo`, `origem` e `tokensValidosRevogados`, **sem** hash |
| **E4** | Os refresh tokens válidos caíram, e exatamente eles | consulta 2 **imediatamente antes** da rotação e **imediatamente depois**, com a saída da CLI no meio | `validos_antes = X`; `CLI revogou = X`; `validos_depois = 0` — os três números, para a conta rotacionada |
| **E5** | As contas deixaram de compartilhar credencial | consulta 3 | as duas impressões **diferentes** |
| **E6** | O segredo global girou | `docker inspect -f '{{.State.StartedAt}}' prospectai-prod-api-1` + DevTools do navegador com a sessão antiga | `StartedAt` posterior ao backup do `.env.production`; requisição com o cookie antigo devolve **401** |
| **E7** | A senha do Redis saiu dos logs | os dois `grep -c` da §6.4 | `≥1` e **`0`** |
| **E8** | A credencial publicada morreu | tentar login com `Demo@123456` na interface | **falha** |
| **E9** | O exemplo deixou de publicar credencial **nova** | `.env.example` no `HEAD` público | `SEED_*_PASSWORD` vazias |

```sql
-- consulta 1
SELECT "createdAt", "tenantId", action, "entityType", after
FROM audit_logs WHERE action = 'SECURITY.PASSWORD_ROTATED'
ORDER BY "createdAt" DESC;

-- consulta 2
SELECT u.email,
       count(*) FILTER (WHERE rt."revokedAt" IS NULL AND rt."expiresAt" > now()) AS validos
FROM users u LEFT JOIN refresh_tokens rt ON rt."userId" = u.id
GROUP BY u.email ORDER BY validos DESC, u.email;

-- consulta 3
SELECT email, left(md5("passwordHash"), 12) AS impressao FROM users
WHERE email IN ('owner@demo.propectai.local', 'sdr@demo.propectai.local');
```

**A E4 só existe como trio.** Medir depois e ver zero não prova nada: zero é
também o que se vê quando não havia nada para revogar. A medição de antes é o
que dá significado à de depois, e a saída da CLI é o que liga as duas. Se
`validos_antes` e o número da CLI divergirem, **pare** — alguém abriu sessão
entre a leitura e a rotação, e a janela precisa ser explicada antes de o gate
fechar. Por isso as duas consultas e a rotação vão na mesma sessão SSH, em
sequência, sem nada no meio.

Colar as três medições assim, no fecho deste documento:

```
validos_antes  = X
CLI revogou    = X
validos_depois = 0
```

**E9 é a mais fraca da lista, de propósito.** Ela não prova que a senha deixou de
estar publicada — o histórico do repositório é público e imutável (§1.4). Quem
carrega esse peso é a **E8**. Se `E8` falhar e `E9` passar, o gate continua
`OPEN`, e a leitura correta é "o exemplo foi limpo e a credencial continua viva".

Com **E1 a E9 coletadas e coladas neste documento**: `S0_REMEDIATION = PASS`,
`GATE_S0 = PASS`. Faltando qualquer uma, o gate continua `OPEN` — inclusive se
todas as ações tiverem sido executadas. **Ação executada não é evidência; o que
prova é a medição depois dela.**

---

## 10. Riscos remanescentes deste procedimento

1. **A janela entre o deploy e a rotação.** Entre a §6 e a §3.3, a senha
   publicada continua funcionando. Dura o que durar a validação pós-deploy —
   minutos. Aceito: reduzir exigiria rotacionar antes do deploy, e a CLI não
   existe na imagem antiga (§0.1).
2. **Quem estiver logado cai.** É ambiente de demonstração com um usuário
   legítimo, então o custo é o próprio operador limpar os cookies (§5.3).
3. **`--force-recreate` recria o container.** Se o processo não subir por causa
   de uma variável mal escrita, a API fica fora do ar até o arquivo ser
   corrigido. Mitigação: o `grep -c` de cada edição e o backup da mesma sessão.
4. **A senha nova depende do gerenciador de senhas do dono do projeto.** Se ela
   se perder, a recuperação é rodar `db:senha` de novo — não há "esqueci minha
   senha" no produto, e é a lacuna que este runbook existe para contornar, não
   para resolver.
5. **A composição da interrupção não foi observada** (§8.4). Risco aceito pelo
   dono do projeto, com a mitigação operacional descrita lá.
6. **O host cria arquivo legível por todos, por padrão.** `umask 0002` e
   `/opt/backups` em `775` estão medidos na §6.1. O procedimento contorna com
   diretório exclusivo `700` e `umask 077`, mas o **padrão do host continua o
   mesmo** depois desta execução: o próximo que gravar ali sem cuidado repete a
   exposição. Não vira gate — mudar o modo de um diretório compartilhado por
   outras stacks é decisão de infraestrutura, e não foi tomada.

**Débito de infraestrutura, registrado e não tratado agora.** As anotações do run
#50 avisam que o rótulo `ubuntu-latest` migra para **Ubuntu 26 em 19/10/2026**: o
runner muda de imagem sem que nada no repositório mude. Não vira gate — abrir
outra frente com o `GATE_S0` ainda em fechamento custaria mais do que rende —,
mas a data entra na lista de coisas que mudam sozinhas.

---

## 11. Registro de decisões

Regra de governança, adotada em 25/09/2026: **"decisão do dono" não se atribui
por inferência.** Um item só sai de `PROPOSTA` quando há registro de quem
decidiu, quando, e entre quais alternativas. Sem esse registro, o estado correto
é `PENDING_OWNER_DECISION`, mesmo que a recomendação pareça óbvia — inclusive, e
principalmente, quando parece óbvia.

| id | Decisão | Mecanismo e data | Alternativas recusadas |
|---|---|---|---|
| **D1** | A correção do `.env.example` entra no Commit 3 | escolhida pelo dono do projeto em 25/09/2026, entre três opções apresentadas | commit isolado antes do C3; adiar para depois da remediação |
| **D2** | A conta SDR é **rotacionada**, com senha própria, e permanece ativa | idem, entre três opções | desativar (`isActive = false`); deixar como está |
| **D3** | `S0-NET-01` vira `GATE_NET`, gate próprio atrelado ao gate de domínio, e deixa de bloquear o `GATE_S0` | idem, entre duas opções | manter o `GATE_S0` aberto até a 3102 sair de `0.0.0.0` |
| **D4** | Não repetir o teste manual de `Ctrl+C`; `TTY_MANUAL` vira `WAIVED_RISK_ACCEPTED_BY_OWNER` | decisão do dono do projeto em 28/09/2026, por escrito, depois de 8 tentativas e da apresentação do raio de dano (§8.4) | manter o bloqueio duro até a CLI ser interrompida de verdade |

`D1` a `D3` foram escolhidas entre opções que eu apresentei, e em cada uma a opção
escolhida era a que eu recomendava. **Isso é motivo para o registro existir, não
para dispensá-lo:** recomendação aceita continua sendo decisão de quem aceitou,
e quem ler este documento em 2027 precisa poder ver a diferença entre "o dono
decidiu" e "o Claude concluiu".

> **Confirmação explícita do dono do projeto, 28/09/2026.** `D1`, `D2` e `D3`
> foram reconhecidas e confirmadas por escrito. Nenhuma delas está mais em
> `PENDING_OWNER_DECISION`.

Se alguma tivesse sido negada, o item voltaria a `PENDING_OWNER_DECISION` e o
passo correspondente da §7.1 ficaria bloqueado até nova palavra.

**Continua `PENDING_OWNER_DECISION`**, e não tem registro nenhum porque ninguém
decidiu: o `trust proxy` (§1.6 do `S0-FORENSICS`), o destino da porta 3102 e o
nome/domínio do produto. **Nenhuma das três foi inferida a partir do `D4` nem de
qualquer outra decisão desta rodada** — aceitar um risco de terminal não diz nada
sobre em quantos saltos de proxy confiar, sobre fechar a porta 3102, ou sobre o
nome do produto.
