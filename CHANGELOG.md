# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versionamento segue [SemVer](https://semver.org/lang/pt-BR/).

---

## [Não lançado]

### Os papéis do banco, e o teste que passou a mentir menos · 27/08/2026

Migration `20260826230000_rls_papeis`. Passos 1 e 2 do `PLANO-RLS-v1.md`. **Nenhum teste novo, e é esse o ponto**: os 300 continuam 300, mas dois arquivos passaram a falar com o banco por um papel diferente do que exercitam.

#### Um papel que ignora RLS, outro que nunca poderá

`propectai_migrator` nasce com `BYPASSRLS`; `propectai_app` nasce sem atributo nenhum e **deliberadamente sem ser dono de tabela alguma**.

Os dois detalhes vêm de medição, não de gosto. O spike mostrou que **o dono da tabela ignora RLS por padrão** — `ENABLE ROW LEVEL SECURITY` sozinho, com a aplicação conectando como dono, não protege absolutamente nada. A correção é `FORCE`, e o `FORCE` cria o problema oposto: migration de dado e `db:seed` passam a afetar **zero linhas sem erro**, com a migration marcada como aplicada. Medido: `UPDATE 0` como dono, `UPDATE 50001` com `BYPASSRLS`.

Os dois modos de falha são silenciosos. A escolha é sobre **onde** o silêncio dói: sem `FORCE`, em produção; com `FORCE`, no desenvolvimento, onde um teste pega. Daí `FORCE` ligado e um papel próprio para migration.

O `propectai_app` não ser dono é cinto e suspensório — se alguém remover o `FORCE` um dia, ele continua sujeito à política, porque a isenção do dono não se aplica a quem não é dono.

#### Tudo idempotente, e não é preciosismo

`CREATE ROLE` cru quebraria toda migration futura do projeto.

O `prisma migrate dev` valida migrations replicando-as num **shadow database**. Papéis são objetos de **cluster**, não de banco: o `CREATE ROLE` rodaria uma segunda vez, falharia com *"role already exists"*, e a partir dali nenhuma migration nova entraria. Pelo mesmo motivo os `GRANT ... ON DATABASE` usam `current_database()` — no shadow o banco tem outro nome, e um literal apontaria para o lugar errado.

Isso foi verificado contra um Postgres 16 real com um shadow de nome diferente antes de chegar aqui, não deduzido do manual.

#### A migration diz que os comandos rodaram, não que o estado ficou certo

`docs/intelligence/gate0/verificacoes-rls-passo1.sql` — cinco consultas, cada uma respondendo a uma pergunta que "aplicada com sucesso" não responde. A mais importante é a primeira: **`rolbypassrls` verdadeiro no `propectai_app` seria o pior resultado possível do conjunto**, porque o passo 4 ligaria a política e ela não protegeria nada — sem erro, sem sintoma, com tudo verde.

Resultado: 5 de 5 como previsto, 43 de 43 tabelas alcançáveis pelo papel da aplicação, `TRUNCATE` e `CREATE` no schema negados a ele, privilégio padrão registrado para as tabelas que ainda não existem, e zero conexões usando os papéis novos — que é o que confirma que o passo 1 não mudou comportamento.

O privilégio padrão é o que evita a falha mais traiçoeira da lista: uma migration futura cria tabela, ninguém repara, e meses depois uma rota nova morre com *"permission denied"* sem ninguém ligar as duas coisas.

#### O maior custo do RLS não é o RLS. São as fixtures.

Todo teste com banco monta o cenário com Prisma cru, sem contexto de tenant. Sob `FORCE`, **cada uma dessas consultas passa a enxergar zero linhas** — não com erro: com vazio. Os testes falhariam em cascata com asserções sem sentido, e a causa não apareceria em nenhuma mensagem.

`criarPrismaAdmin()` (`apps/api/test/` e `apps/worker/test/`) devolve um client no `propectai_migrator`. No `audit-pipeline.spec.ts` a separação fica explícita:

```ts
const admin = criarPrismaAdmin();   // monta cenário e confere
const prisma = new PrismaClient();  // é o que o processAuditJob recebe
```

Quando o passo 4 apontar a `DATABASE_URL` para o `propectai_app`, o client do código sob teste vira o papel da aplicação **sem uma linha de teste mudar** — e só então os testes de isolamento provam a política do banco, em vez de provarem a chave composta e o `where`, que é tudo o que provam hoje.

Isso não é remendo: montar cenário é operação administrativa, e submetê-la à política que se quer testar sempre foi errado. O plano previa mexer em dez specs; foram **dois**, porque o canário do passo 4 são duas tabelas. Os outros entram no passo 6, junto com as tabelas deles.

#### Eu afirmei como fato uma coisa que escolhi não verificar

O comentário que escrevi na migration diz que *"o Postgres local do projeto autentica por confiança"*. É falso, e a primeira execução do passo 2 cobrou:

```
Authentication failed against database server at `localhost`,
the provided database credentials for `propectai_migrator` are not valid.
```

A `DATABASE_URL` do ambiente carrega senha. Eu nunca li o `.env` — de propósito, porque credencial de banco não precisa entrar numa sessão de trabalho, e essa parte continua certa. O erro foi outro: tendo escolhido não olhar, **deduzi em vez de perguntar**, e escrevi a dedução como se fosse observação, dentro de um arquivo que agora não pode ser corrigido.

Não pode porque a migration já está aplicada, e editar o arquivo muda o checksum: o Prisma passa a recusar toda migration seguinte com *"migration modified after being applied"*. Um comentário impreciso custa menos que um repositório que não migra. A correção ficou no `PLANO-RLS-v1.md`, com o `ALTER ROLE ... PASSWORD` por ambiente e o item de checklist que o passo 4 herda.

**O modo de falha, esse, foi o certo** — e vale registrar porque foi projetado. O helper avisa e cai para a `DATABASE_URL` quando a variável não existe, mas com a variável presente e a senha errada ele estoura alto, nomeando o papel, e o `audit-pipeline.spec.ts` **pulou seus 14 testes em vez de passar em silêncio**. Um fallback mudo teria deixado tudo verde hoje para quebrar no passo 4, com a causa três arquivos de distância.

---

### O provider real, e o número que o sistema agora informa sozinho · 26/08/2026

Migration `20260826225351_f3_auditoria_provider`. **300 testes**, 187 no worker e 71 na API.

E a auditoria rodou de ponta a ponta **contra a internet**, pela primeira vez: API → BullMQ → worker → provider nativo → DNS, socket e TLS reais → Postgres.

#### `pnpm audit:e2e`, e a limpeza no `finally`

O roteiro manual de ontem virou script — `apps/worker/scripts/auditoria-e2e.ts`. Registra um tenant descartável, cria o lead, pede pela API de verdade, acompanha até o estado terminal, imprime, e **apaga tudo num `finally`**.

O `finally` é a razão do arquivo existir. A versão manual mandava apagar o `.sql` e esquecia o **dado** — e o lead órfão quebrou o `business-invariants.spec.ts`. Terminar inclui terminar mal: sem isso, a primeira falha deixa o rastro que a execução seguinte herda.

Ele atravessa o que nenhum teste atravessa. O `audits-http.spec.ts` para na fronteira da fila; o `audit-pipeline.spec.ts` chama o pipeline direto, sem BullMQ no meio.

#### `MAX_SALTOS` era 3, e o `gov.br` encostou exatamente nele

```
REDIRECT_CHAIN  OK  {"saltos":3,"forcaHttps":true}  https://www.gov.br/pt-br
```

`http://gov.br` → https → `www.gov.br` → `/pt-br`. Três saltos, corpo lido na quarta requisição, **no limite**. Um redirect a mais — uma normalização de barra final depois do locale — sairia como `REDIRECT_DEMAIS`, e o relatório diria ao cliente que o site dele está inalcançável. **Falso negativo entregue como achado.**

O 3 foi escolhido no abstrato, na v1 da política. A cadeia `apex → https → www → locale` não é exótica: é o padrão de qualquer site com internacionalização. **O primeiro site brasileiro grande que medimos bateu no teto.**

Subiu para 5, e **subir não afrouxa a segurança**: cada salto continua revalidado pelo `guard` contra a tabela de faixas, e o tempo já tem teto próprio no orçamento de 30s. O que garante isso é um teste com nome próprio — `o guard revalida no ultimo salto, nao so nos primeiros` —, com uma cadeia de cinco onde o quarto aponta para `127.0.0.1` e morre em `LOOPBACK`. Subir o teto sem ele seria confiar que a revalidação por salto funciona, e "confiar que funciona" é o que estes dias existiram para desmontar.

#### A auditoria não dizia quem a mediu

Três vezes — duas em 24/08 e uma em 25/08 — auditorias do mock passaram por reais. Nas três, o que denunciou foi **alguém reparar num `durationMs` baixo demais**. Isso não é um mecanismo; é sorte.

`providerName` na `DigitalPresenceAudit`, gravado pelo worker ao finalizar, devolvido pela API e impresso pelo `audit:e2e`:

```
=== COMPLETED em 341ms · provider: native ===
```

O argumento é o do `auditVersion`, levado a sério: se a **versão** do verificador precisa ficar registrada para o relatório continuar explicável, a **implementação** também precisa. Um relatório entregue a um cliente sem registro de como foi produzido é exatamente o buraco que o `auditVersion` existe para não ter — e ele estava aberto do lado.

Dois testes: um afirma `mock`; o outro injeta um provider chamado `provider-de-teste` e afirma que **esse** nome aparece, para o campo não virar um literal escrito à mão.

E quando o provider é `mock`, o script grita em vez de deixar o leitor descobrir.

#### Uma lição sobre instrução, não sobre código

Escrevi *"acrescente `SITE_AUDIT_PROVIDER=native` ao `.env`"* três vezes. Nas três, a linha foi colada no PowerShell e virou erro de comando — porque **tudo o mais que eu passava era colável, e aquilo era uma descrição.**

O que funcionou foi um comando:

```powershell
[System.IO.File]::AppendAllText("$PWD\.env", "`r`nSITE_AUDIT_PROVIDER=native`r`n", [System.Text.UTF8Encoding]::new($false))
```

Com o encoding explícito de propósito: `>>` no PowerShell grava UTF-16 e corromperia o arquivo inteiro, e o `-Encoding utf8` do PS 5.1 pode enfiar BOM.

**Instrução repetida que falha três vezes é defeito da instrução.** Vale para runbook tanto quanto para API.

---

### A auditoria sai do laboratório · 25/08/2026

`apps/api/src/audits/` — `POST /audits`, `GET /audits/:id`, `GET /audits/quota`. Migration `20260825152320_f3_auditoria_idempotencia`. **296 testes**, 183 no worker e 71 na API.

E, pela primeira vez, uma mensagem atravessou a fila `audit` de ponta a ponta: API → BullMQ → worker → provider → banco, com `COMPLETED` e quatro checagens.

#### A URL não vem do cliente

O DTO aceita **só `leadId`**. O site auditado sai do `Lead.website`.

Deixar o cliente mandar a URL seria deixá-lo escolher o destino da conexão que o worker abre — e a política de egress inteira existe para que esse destino seja decidido por nós. É a diferença entre um verificador e um proxy aberto com credencial de quem pediu.

O `jobId` do BullMQ é o id da auditoria, explicitamente. É ele que o `decidirExecucao` compara para separar retry legítimo de mensagem forjada; deixar o BullMQ sortear faria o worker reivindicar um valor que a API não conhece, e a defesa passaria a comparar um número com ele mesmo.

Pedido cruzado devolve **404, não 403** — dizer "proibido" confirmaria que o id existe em algum lugar.

#### Rodar de verdade achou o que 290 testes não viram

**Clique duplo consumia dois créditos.** Cada `POST` criava auditoria com id novo, logo `jobId` novo, e o BullMQ não tinha como recusar. Num plano FREE de três auditorias por mês, dois cliques queimavam dois terços da cota medindo o mesmo site no mesmo minuto. Eu tinha afirmado o contrário na mensagem anterior — que o BullMQ recusaria o repetido — e estava errado, porque o id nunca se repete.

A correção tem duas camadas, e as duas são necessárias. A conferência de auditoria em andamento resolve o caso real: o usuário clica, nada parece acontecer, ele clica de novo. E `idempotencyKey` com `@@unique([tenantId, idempotencyKey])` fecha a corrida — **conferir antes de gravar não basta**, porque entre a leitura e a escrita cabe outro pedido, e o único árbitro confiável é o índice único. Mesma convenção do `ScrapeJob`, que já a tinha desde sempre.

A conferência vem **antes** do gate de saldo, e a ordem é deliberada: quem já tem auditoria rodando e está sem crédito não está pedindo uma nova, está perguntando pela que já pagou. Responder 403 seria negar acesso a trabalho comprado.

**E o mock mentia sobre a forma do dado.** Gravava `{"hostname": "https://layart.com.br"}` — a URL inteira num campo que promete um host. O nativo grava `layart.com.br`. Só apareceu com os dois rodando lado a lado numa auditoria de verdade. **Mock que diverge do real não é um dublê, é uma segunda implementação errada**, e qualquer tela construída sobre ele quebraria na troca. Três testes novos comparam as duas implementações chave a chave.

#### O teste da bomba precisava de 256 MB para provar que não usamos 256 MB

`gzipSync(Buffer.alloc(256 * 1024 * 1024))` falhou com `Array buffer allocation failed` — no **preparo**, antes de exercitar linha nenhuma do código sob teste. Máquina sob carga.

A resposta não era "rode de novo". Um teste cuja tese é *"não estouramos a memória"* que exige um quarto de giga contíguo para existir é frágil por construção, e o vermelho que ele produz não informa nada.

A bomba passou a ser montada escrevendo blocos de 1 MB no fluxo de compressão. Medido:

```
streaming : pico externo +~1 MB      bomba 0,2 MB
gzipSync  : pico externo +255,5 MB   bomba 0,2 MB
bombas idênticas: true
```

#### O engine nativo, e um erro meu de raciocínio

O `prisma generate` da migration falhou com `EPERM` ao renomear `query_engine-windows.dll.node` — o `pnpm dev` segurava o arquivo. Eu escrevi que estava resolvido *"porque o `typecheck:all` passou depois"*.

**Errado.** O typecheck lê os `.d.ts`; o que não foi substituído é o binário. Tipos novos com engine antigo passam no typecheck e quebram na execução — e quebraram, com `0xC0000005`, violação de acesso, o Jest morrendo em código nativo sem nenhum teste ter falhado.

É a mesma armadilha documentada seis vezes na entrada de ontem, e eu caí nela raciocinando sobre ela. **Passar num verificador não diz nada sobre o que aquele verificador não olha** — e o typecheck não olha binário.

#### Verificação manual que deixa rastro

O roteiro do teste de ponta a ponta mandou apagar o arquivo `.sql` e esqueceu de apagar o **dado**. O `business-invariants.spec.ts` pegou: um lead inserido por SQL cru, sem passar pelo pipeline de score, virou órfão e violou a regra 5.4.

O teste fez exatamente o que existe para fazer. Ele não testa um caminho — **afirma uma propriedade sobre o banco inteiro**, e por isso pegou uma violação criada por um caminho que nem existe no código. É a diferença entre "o código faz X" e "o estado do sistema é válido", e só a segunda pega o que entrou pela porta dos fundos.

A lição fica: **procedimento manual contra banco compartilhado com a suíte precisa terminar com limpeza.** O `audits-http.spec.ts` limpa tenant, usuário e até os jobs do Redis; o roteiro manual não limpava nada, porque foi escrito como sequência de comandos e não como procedimento com fim.

#### Spike de RLS — a decisão D2, agora com medição

`docs/intelligence/SPIKE-RLS-v1.md`, executado contra Postgres 16 real com a mesma configuração de propriedade do projeto: **a aplicação é dona das tabelas**, porque as migrations rodam com ela.

**Três modos de falha silenciosa**, cada um deixando o sistema parecendo protegido:

1. **`ENABLE` sem `FORCE` não protege nada.** O dono da tabela ignora RLS por padrão. Política criada, variável definida, e a consulta devolve os dois tenants — sem erro.
2. **A variável vaza pelo pool.** `SET` de sessão sobrevive à requisição. Só `set_config(..., true)` em transação resolve — e `SET` não aceita parâmetro, o que empurra para interpolar string e transformar o mecanismo de isolamento no vetor de injeção.
3. **Migration de dado não faz nada.** `UPDATE ... WHERE tenantId=...` → `UPDATE 0`, sem erro, migration marcada como aplicada. Precisa de papel separado com `BYPASSRLS`.

**O custo, medido:** planos de execução idênticos com e sem RLS — `current_setting` é `STABLE` e vira condição de índice como um literal. A objeção de performance não existe. O que existe é round trip: uma consulta vira quatro, e em consulta barata isso é +159% de latência.

Recomendação: adotar, com `FORCE`, `set_config` em transação, papel separado para migrations, **e um teste que prove que a leitura cruzada devolve zero**. Os três modos de falha são silenciosos — sem esse teste, RLS é pior que uma extensão do Prisma, porque *parece* mais seguro. E esse teste tem nome: S8 e S9, que estavam bloqueadas esperando esta decisão.

#### As seis decisões, num documento

`docs/intelligence/DECISOES-ABERTAS-v1.md`. A reformulação que ele faz é o ponto: "cinco decisões abertas" pesava mais do que a realidade. São seis, e **só uma tem relógio próprio** — a privacidade do link social, porque se precisar de parecer jurídico o prazo começa quando alguém pedir. Duas são ratificação de minutos, uma está genuinamente bloqueada por ausência de produção, e duas ficam mais baratas com evidência antes.

---

### Auditoria de presença digital — fundação e egress · 24/08/2026

Migration `20260824110516_f3_auditoria_presenca_digital`, e o núcleo da política de egress em código.

#### As tabelas, com os nomes que o escopo já tinha proposto

`DigitalPresenceAudit` e `DigitalPresenceCheck`, de `scope-v0.2.md` §5. **Não existe modelo `Evidence`** — a medição é a evidência, e criar um quarto conceito ao lado de `DigitalPresenceCheck`, `LeadScoreReason.evidence` e `LeadSourceRecord.payload` seria repetir o erro que a regra "estender, não paralelizar" existe para impedir.

Três decisões que o schema registra:

**`AuditStatus` tem `PARTIAL`, e o `ScrapeJobStatus` não.** Três de sete checagens concluírem é o caso comum da auditoria. Sem estado próprio, viraria `COMPLETED` — e o relatório afirmaria o que não mediu — ou `FAILED`, e o cliente perderia o que já foi verificado.

**`SiteCheck` não tem `INSTAGRAM_LINK` nem `FACEBOOK_LINK`.** A ausência é o bloqueio, em código e não em prosa: a `SECURITY-EGRESS-POLICY-v3.md` §8 exige reclassificar a privacidade do link social antes, porque para clínica, advogado e MEI o Instagram do site é o perfil pessoal. Enquanto o enum não os tiver, nenhum provider pode executá-los por engano.

**A auditoria não estende `ScrapeJob`.** Ele exige `searchId` e `keyword` `NOT NULL`, e auditoria é sob demanda por lead — não tem busca nem palavra-chave. Estender exigiria tornar duas colunas nuláveis em tabela com volume.

Cota: `PlanUsage.auditsCount`, `auditsPerMonth` no `PlanLimits` com os valores do §6 (3/30/150/600), e as capabilities `audit.run` e `audit.export`.

#### Limite ausente deixa de ser problema de quem lê

`Plan.limits` é JSON, e `as unknown as PlanLimits` afirma sem provar: um plano gravado antes de um limite existir simplesmente não tem a chave. A primeira versão espalhava `?? 0` em cada ponto de leitura — quinze defesas num serviço cujo propósito declarado é ser *"ponto único de verificação de plano"*.

A defesa foi para o `recarregar()`: um `normalizar()` que completa o que faltar com o mínimo **e loga quais campos faltaram**. O tipo volta a ser verdade, e o aviso impede a degradação silenciosa.

#### Egress: a tabela de faixas vira código, e a execução acha dois bugs

`apps/worker/src/egress/ip-ranges.ts`, 25 testes. Rodar antes de entregar encontrou duas falhas, **ambas de ordem de lista, e nenhuma visível em leitura**:

- `255.255.255.255` casava em `240.0.0.0/4` antes de chegar ao `/32` de broadcast. A decisão era a mesma; o **motivo** saía errado — e o motivo só sobrevive no log, porque a resposta ao usuário é uniforme por exigência da §2.8
- `::1` saía como `RESERVADO`. Ele satisfaz a forma IPv4-compatível `::0.0.0.1`, então a normalização o convertia em `0.0.0.1`, que casa em `0.0.0.0/8`. A correção foi decidir faixa **antes** de normalizar

As duas listas agora se ordenam por especificidade em vez de confiar na ordem em que alguém escreveu — o próximo acréscimo não pode reintroduzir a classe do primeiro bug.

**E uma sonda adversarial, depois de tudo passar, achou quatro faixas ausentes da política.** `fec0::/10` (site-local, obsoleto pela RFC 3879 e ainda roteado por sistemas antigos), mais os análogos IPv6 de documentação, benchmark e descarte — que a tabela IPv4 bloqueava desde a v1. Erratum E11.

A lição não é sobre as faixas: **teste que passa prova que os casos escritos estão certos, não que a lista está completa.** Os seis contornos da v1 vieram de revisão adversarial; estes quatro vieram de sondar formas que ninguém tinha listado.

Confirmado de passagem: formas alternativas de escrever loopback — `2130706433`, `0177.0.0.1`, `0x7f.0.0.1` — são recusadas como literal e caem no DNS, onde a validação pós-resolução pega o IP real. É a razão de a política validar depois de resolver, e não antes.

#### Validação de URL, e o teste S1 que passava pelo motivo errado

`guard.ts` decide o destino e devolve o **IP para conectar** — não conecta. É isso que fecha o DNS rebinding sem depender de cache: entre validar e conectar não há segunda resolução que possa devolver outra coisa. O hostname vai só em `Host` e SNI.

Todos os endereços resolvidos são avaliados, não o primeiro: uma resposta com um IP público e um privado é ataque, não acidente, e o Happy Eyeballs do Node tentaria o segundo.

**Erratum E12.** A política mandava testar S1 com `http://127.0.0.1:5434/`. Mas 5434 não está na allowlist de portas, e a validação de forma vem antes da de endereço — de propósito, para não gastar DNS com URL já morta. O teste seria recusado por porta e **a tabela de faixas nunca seria consultada**. Verde, sem provar nada sobre loopback.

Escrito por quem tinha acabado de documentar esse modo de falha duas vezes no mesmo arquivo. A regra que ficou: **teste que exercita uma camada precisa passar por todas as anteriores.**

De graça, do `URL` do Node: IDN vira punycode — o que fecha homógrafo — e o host é minusculizado. O ponto final de FQDN é preservado e vai para o DNS, que é onde a v1 errava ao tentar resolver com regra de string.

#### Limites de tamanho, e um hang que o teste funcional não via

`limites.ts` corta nos dois lados da descompressão. Os dois tetos medem coisas diferentes — o comprimido protege banda e tempo, o descomprimido protege memória — e a v1 achava que um substituía o outro.

Os 13 casos funcionais passaram de primeira, incluindo uma bomba de gzip **real** de 64 MB. Aí a memória foi medida com uma de 256 MB, e **o processo parou e não voltou.**

A causa: ao cortar, o fluxo é destruído; se havia uma escrita esperando por `drain`, a espera nunca terminava — stream destruído não emite `drain`. Com 64 MB o corte caía entre escritas. Com 256 MB a janela abriu.

**Hang é pior que o DoS que o limite existe para impedir.** O erro volta e vira log; o hang prende a vaga do worker em silêncio, sem timeout e sem sintoma. Corrigido soltando a espera também em `close` e `error`.

Depois da correção, os números que provam a defesa — e que nenhum código de retorno provaria:

```
bomba 256 MB (255 KB comprimidos, fator 1029x)
  resultado:    DESCOMPRIMIDO_GRANDE
  leu da rede:  0,1 MB de 0,2 MB disponíveis
  heap:         delta de 1,0 MB
```

Duas lições que valem além deste arquivo. **A bomba é construída de verdade, com `gzipSync`** — um teste que a simula prova que o `if` está escrito; um que a constrói prova que o corte acontece antes de a memória acabar, e era exatamente aí que o hang morava. E **código de retorno correto não é comportamento correto**: os 13 verdes diziam `DESCOMPRIMIDO_GRANDE` enquanto o caminho até lá estava quebrado.

#### Orquestração, e o `contentHash` que a política deixou ambíguo

`fetcher.ts` junta as três peças: redirect revalidado **a cada salto** contra o `guard`, máximo de 3, orçamento de 30s do job, e erro uniforme.

O caso que importa é o S4 — redirect de público para loopback. É o caminho mais curto entre o externo e o interno: o primeiro endereço passa, o `Location` aponta para `127.0.0.1`, e sem revalidação o segundo nunca seria olhado. Coberto, junto da variante sutil: redirect para um *nome* que resolve para IP privado.

**O transporte é injetado, e não por gosto de teste.** É o ponto onde o processo isolado do ADR-004 entra quando existir: hoje abre o socket no worker (`FETCHER_MODE=inline`, Parte 1), amanhã fala com outro processo, e nada acima de `buscar()` muda.

**`contentHash` é do corpo decodificado, não dos bytes do fio.** A política diz "bytes crus", e a expressão serve para duas coisas — foi ambiguidade minha. Decodificado, porque o propósito é identidade de conteúdo para a dedup entre tenants (§5): a mesma página com gzip hoje e sem gzip amanhã é a mesma página, e hashear o fio faria a dedup falhar por mudança de configuração no servidor do cliente. "Cru" ali significa **antes da sanitização**, que é a distinção que a §3 precisa.

#### O transporte real, e o que o dublê estava escondendo

`transporte.ts`, 32 testes — e estes abrem socket de verdade contra um servidor que sobe em `127.0.0.1`. O resto do módulo é provado contra dublê, o que prova a lógica; este é o único arquivo que prova que a lógica sobrevive a uma conexão.

O núcleo é o `lookup` fixo: o socket vai para o IP que o `guard` aprovou, e o `Host` e o SNI levam o nome. **O teste central usa um hostname `.invalid`** — a RFC 6761 garante que não resolve. Ele conecta mesmo assim, e é isso que prova que não existe segunda resolução para envenenar entre validar e conectar.

**Executar contra socket derrubou duas coisas que estavam no código desde ontem.**

**`buscar()` podia rejeitar, e ela promete que não.** No ramo sem compressão o `lerCorpo` iterava o corpo fora de qualquer `try`, e o `fetcher` também não protegia a chamada. Gerador de teste não quebra no meio; socket quebra o tempo todo. O contrato de erro uniforme estava furado no caminho mais comum de falha real — e nenhum dos 81 testes anteriores podia vê-lo, porque nenhum tinha uma fonte capaz de morrer.

**Falha de rede saía rotulada como bomba de gzip.** No ramo com compressão o `catch` era único, então socket resetado virava `DESCOMPRIMIDO_GRANDE`. Isso é pior que um rótulo errado: a §2.8 exige que a resposta ao usuário seja uniforme, então **o log é o único lugar onde o motivo sobrevive** — e ele estaria registrando evento de segurança falso toda vez que um site caísse no meio da leitura. Agora `LEITURA_INTERROMPIDA`, com um `try` interno separando "a fonte morreu" de "o zlib reclamou".

E uma terceira, de recurso: redirect e corte por tamanho saem **sem consumir o corpo**, e com `agent: false` cada uma dessas saídas deixava um socket aberto até o prazo estourar. Daí o `descartar?.()` opcional no `RespostaBruta` — opcional porque o dublê não tem socket para soltar, que é precisamente por que a falta passou.

Duas decisões que valem registro. **O prazo é absoluto para a troca inteira**, não de ociosidade: ociosidade não pega o servidor que manda um byte a cada 9 segundos, porque o relógio reinicia a cada byte. É a mesma classe do hang que o `limites.ts` já custou, e tem teste próprio — corpo gotejando, cortado em 400ms. E **`rejectUnauthorized: true`**, com o erro do TLS traduzido para código próprio: `TLS_CERTIFICADO_EXPIRADO` é provavelmente o achado mais vendável que a checagem `HTTPS` vai produzir, e sem código próprio seria indistinguível de "site fora do ar".

O que continua sem prova, de propósito: **TLS real.** A tabela de tradução é exercitada com códigos sintéticos. Gerar certificado em teste significa chave no repositório, e chave em repositório é coisa que varredor de segredo acha e ninguém consegue explicar depois. O handshake fica no checklist do primeiro deploy, junto das outras provas que só a rede dá.

#### `SiteAuditProvider` — a quarta vez que a mesma convenção resolve

`packages/types/src/site-audit.ts` mais `apps/worker/src/providers/site-audit/`, 15 testes. Quarta aplicação do padrão de `LeadSourceProvider`, `PaymentProvider` e `AIProvider`: `name` legível, verbos do domínio, pasta `providers/`, fábrica por variável de ambiente, mock, fallback logado. `SITE_AUDIT_PROVIDER` nasce em `mock` pelo mesmo motivo que `LEAD_SOURCE_PROVIDER` — o padrão seguro é o que não sai para a internet.

Quatro checagens, e todas saem de **no máximo duas sondas**.

**A sonda começa sempre em `http://`, mesmo quando o cadastro diz `https://`.** O esquema gravado em `Lead.website` é afirmação de quem cadastrou; trocar afirmação por medição é o propósito do arquivo. Começar em http mede de graça a coisa mais vendável do conjunto — se o site força a subida — e o `forcaHttps` que sai daí é o substituto real do `raw.startsWith('https://')` que o `normalize.ts` calcula hoje. Site moderno paga uma requisição; site sem https paga duas, e a segunda é justamente a que produz o achado.

**`CheckOutcome.FAILED` e `AuditStatus.FAILED` são coisas diferentes, e confundi-las custa caro.** O primeiro é o site reprovando — é o produto: "seu domínio não resolve", "seu certificado expirou". O segundo é nós não conseguirmos medir. Sem a distinção, todo site quebrado viraria job com falha e o BullMQ o repetiria três vezes para chegar à mesma conclusão correta da primeira. Domínio que não resolve produz auditoria `COMPLETED`, e `PARTIAL` fica reservado para falta de tempo.

**A query string é cortada de toda URL observada**, com teste próprio. Site de captura põe `?email=` e `?cpf=` ali, e o §3 proíbe que isso entre no pipeline. Origem e caminho bastam para o achado; o resto é risco sem uso.

E o `fetcher` ganhou um `detalhe` opcional na falha. A §2.8 exige resposta uniforme **ao usuário** — ela não exige que joguemos fora o que sabemos. Sem esse campo, `TLS_CERTIFICADO_EXPIRADO` chegaria à auditoria indistinguível de "site fora do ar", e a primeira é um achado que se vende. Lido por *duck typing* em vez de importar `ErroTransporte`, porque o transporte já importa os tipos do `fetcher` e a volta fecharia um ciclo.

**Duas falhas que executar achou, e nenhuma leitura acharia.**

**Um `if` morto.** A detecção de destino bloqueado estava escrita como `motivo.startsWith('IP_')`. Os motivos da tabela de faixas são `LOOPBACK`, `PRIVADO`, `CGNAT` — sem prefixo nenhum. A condição nunca casaria, e a consequência não era cosmética: todo domínio apontando para a rede interna sairia classificado como simplesmente inalcançável. As duas coisas geram conversas opostas — "seu domínio não existe" é achado para o cliente, "seu domínio aponta para 10.0.0.5" é alerta para nós.

**E o primeiro teste passava pelo motivo errado — o mesmo erro do S1, pela terceira vez neste arquivo.** Com um servidor local só, http e https caíam no mesmo lugar: a cadeia de redirect voltava para si mesma e morria em `REDIRECT_DEMAIS`. As asserções de status e de contagem de checagens seguiam verdes sem provar nada sobre a subida para https. Agora são dois servidores roteados por `destino.https`, e o teste afirma `forcaHttps`, `saltos` e a URL de destino. Está escrito no topo do spec que o "https" ali é encenado — TLS de verdade é do spec do transporte, não deste.

Fora do recorte, e o motivo de cada um está no `SITE_CHECKS_V1`: `VIEWPORT_META` e `TITLE_META` exigiriam parsear HTML de terceiro — superfície nova dentro do módulo cujo propósito é conter terceiros — e `TTFB` esbarra no descasamento já registrado, porque o `fetcher` mede o primeiro salto. Num `301` de http para https, e esse é o caso comum, o número seria o do redirect e não o da página. **Medir errado é pior que não medir:** o número errado vai para o relatório do cliente com a mesma cara do certo.

#### O pipeline da auditoria, e a defesa que o schema já tinha nomeado

`audit-decisoes.ts` mais `process-audit-job.ts`, 30 testes — 18 sem banco, 12 contra o Postgres. Fila própria (`QUEUE_NAMES.audit`), e não um tipo de job na fila de coleta: os perfis são opostos, e compartilhar faria a auditoria esperar atrás de uma coleta de cinco minutos.

**A separação em dois arquivos não é gosto de arquitetura.** O que decide recusar mensagem forjada e replay é a parte com consequência de segurança, e ela precisa ser provável sem subir banco. Ficou em funções puras; o outro arquivo é ler, chamar e gravar. Foi a decisão certa por um motivo que só apareceu depois: os 12 testes com banco não puderam ser executados antes da entrega, e os 18 que importam mais puderam.

A defesa estava escrita no schema desde a migration da manhã: *"o retry carrega o mesmo id, a forjada não"*. Implementada como reivindicação — a primeira execução grava o `queueJobId`, e da segunda em diante ele tem de bater. **A ordem das recusas é desenho:** `JOB_ALHEIO` vem antes de `JA_FINALIZADA` porque é o único dos três que é evento de segurança. Auditoria concluída recebendo mensagem alheia precisa sair no log como tentativa de injeção, não como replay banal.

**E a guarda quase matou o retry — o mesmo defeito que reprovou a v4 da política.** Com `attempts: 3`, a segunda tentativa chega com a auditoria em `RUNNING`, porque a primeira a deixou lá. Tratar `RUNNING` como terminal transformaria a repetição, que existe porque a rede falha, em recusa silenciosa. Por isso `RUNNING` não é terminal, e por isso o job só grava `FAILED` na última tentativa: gravar antes faria a tentativa seguinte bater na guarda de replay. Tem teste com nome próprio.

Medições fechadas: **S12** (mensagem forjada), **S12b** (replay não duplica medição) e **S13** (o payload com o `tenantId` do vizinho não encontra a auditoria — a chave composta de F0 aplicada à leitura).

`retentionUntil` sai em 180 dias. **O número é provisório e precisa de decisão do produto**; o que não é provisório é a existência do prazo — sem ele a tabela cresce sem limite, que é o defeito que o `LeadSourceRecord.payload` já tem.

#### `Record<string, unknown>` era mentira, e o Prisma foi quem viu

O `createMany` recusou o `result` das checagens. O tipo prometia um objeto de valores quaisquer, e "qualquer coisa" não é provadamente serializável em JSON — a recusa estava certa.

O reparo **não foi um cast.** `as Prisma.InputJsonValue` teria compilado mantendo a mentira. Ficou `Readonly<Record<string, MedicaoValor>>`, com `MedicaoValor = string | number | boolean | null`: **plano, sem aninhamento.**

E isso deixou de ser correção de tipo para virar garantia. Nenhuma das quatro checagens precisa de estrutura — são contagens, booleanos e um hostname. **Objeto aninhado é a forma que um trecho de página teria se vazasse para lá, e agora ele não compila.** Quem precisar de aninhamento vai ter de mudar a linha de propósito, e é essa a hora de perguntar o que está entrando junto.

#### O smoke test contra a internet, e o defeito que ele achou em dez minutos

`pnpm audit:fumaca <site>`, em `apps/worker/scripts/`. É o único jeito de exercitar o que teste nenhum alcança: DNS de verdade, a tabela de faixas contra IP público de verdade, socket, handshake TLS e servidor que responde o que quiser. Ficou o dia inteiro adiado como "checklist de deploy"; custou dez minutos e não deveria ter esperado tanto.

A primeira execução:

```
HTTP_REACHABLE  OK   {"status":403,"porta80":true}
REDIRECT_CHAIN  OK   {"saltos":0,"forcaHttps":false}
```

**As quatro checagens não olhavam a classe do código de status.** Site respondendo **500 em todas as páginas** passava em tudo, e o relatório entregue ao prospect diria que a presença digital dele estava saudável. Buraco no conjunto, não num `if` — nenhuma outra checagem pegaria.

**E `forcaHttps: false` era o pior dos dois**, porque afirmava algo: que o site aceita tráfego em claro. Sobre uma sonda que nunca chegou ao site. **Achado inventado é pior que achado ausente** — vai para o relatório com a mesma cara de um medido.

A classificação nova, e a parte difícil foi o 4xx. Nosso `User-Agent` se identifica como bot, e WAF de site pequeno responde 403 a bot o tempo todo. Chamar isso de "site fora do ar" seria falso negativo — não medimos o site, medimos uma recusa a ser medido. **Quem decidiu foi a regra 4:** *"ausência de sinal é DESCONHECIDO, nunca AUSENTE"*.

| classe | desfecho | por quê |
|---|---|---|
| 2xx | `OK` | o site serviu |
| 5xx | `FAILED` | o erro é do próprio site, e vimos |
| 4xx | `SKIPPED` | inconclusivo; `SKIPPED` é o estado do enum que não pontua |

Duas decisões que acompanham. **O status vai para o `result` em todos os desfechos**, inclusive nos que não concluem: a classificação acima é um palpite sobre o mundo real, e quantos 403 são WAF só o dado dirá. Guardar o número é o que permite rever a regra com evidência. E **`forcaHttps: true` continua conclusivo mesmo com status final ruim** — se o salto foi observado, ele aconteceu.

**O teste que deveria ter pego chamava-se "reprovar em tudo".** Servia um 500 e afirmava só que a auditoria terminava `COMPLETED`. Não afirmava que uma única checagem reprovava — e ainda herdava o `responderSeguro` do teste anterior, passando por ordem. Ganhou as três asserções que faltavam, mais oito casos cobrindo cada classe.

E o próprio script tropeçou na lição dele. A primeira versão usava `await` de nível superior; o worker compila para CJS e o `tsx` recusou. **Escrita e testada num harness ESM: código certo para o ambiente errado** — exatamente a classe de erro que o script existe para pegar.

#### TLS provado contra handshake real, e mais três dados falsos

`badssl.com` mantém subdomínios públicos com certificado quebrado de propósito. Os três acertaram de primeira:

| alvo | `errorCode` |
|---|---|
| `expired.badssl.com` | `TLS_CERTIFICADO_EXPIRADO` |
| `self-signed.badssl.com` | `TLS_AUTOASSINADO` |
| `wrong.host.badssl.com` | `TLS_NOME_NAO_CONFERE` |

A tabela de tradução saiu de "exercitada com códigos sintéticos" para provada contra handshake real. **"Certificado expirado" deixou de ser uma afirmação nossa e virou um achado que o produto pode vender.**

E a mesma saída trazia três afirmações falsas na linha do alcance:

```
HTTP_REACHABLE  FAILED   TLS_CERTIFICADO_EXPIRADO   {"porta80":false}
```

**`porta80: false` era mentira.** A porta 80 atendeu — respondeu com redirect para https, e foi o segundo salto que reprovou. O campo estava calculado como "a cadeia inteira deu certo" em vez de "a porta 80 respondeu". Mesma família do `forcaHttps: false` corrigido horas antes, e a regra que ficou vale para os dois: **afirmar o contrário do que se observou é pior que não afirmar nada.**

**`saltos: 0`** apagava a única coisa que a sonda chegou a medir. O salto foi observado; a falha posterior não o desfaz.

**E o mesmo `errorCode` em duas checagens** faria o relatório contar a mesma causa duas vezes com rótulos diferentes. A história verdadeira tem duas partes — a porta 80 funciona e manda para https, o https é que está quebrado — e agora cada checagem conta a sua: `REDIRECT_PARA_DESTINO_QUEBRADO` no alcance, `TLS_CERTIFICADO_EXPIRADO` no TLS.

Quatro testes novos, incluindo o contraste que impede a correção de virar um `true` fixo: site que morre no primeiro salto continua dizendo `porta80: false`.

**O saldo do `audit:fumaca` no dia: três defeitos, nenhum deles visto por 277 testes.** Os três são da mesma classe — o código grava uma afirmação sobre o mundo que o mundo não confirma. Dublê não pega isso, porque o dublê responde o que o autor imaginou. **O script entra no checklist de release, não só no de deploy.**

E a verificação com verdade conhecida, que era o que faltava o dia inteiro: `layart.com.br` saiu `saltos: 1`, `forcaHttps: true`, 200 em https, com **uma sonda só** — a segunda não disparou porque a cadeia já terminou em https. É a primeira vez que `forcaHttps` sai verdadeiro medindo um site real, e era a afirmação central e não verificada de tudo que foi construído hoje.

#### O vão do typecheck fecha no terceiro pacote

`apps/worker/tsconfig.json` também excluía `test/`. Novo `tsconfig.tests.json` e mais um elo no `typecheck:tests` — o mesmo buraco já fechado em `types` e `api`.

E um verde que mentia dentro do próprio módulo: `egress-guard.spec.ts` anunciava **"1 test"** para 28 asserções. O gerador as tinha colapsado num único `it()` — a primeira falha abortaria as 27 seguintes, e o relatório diria "1 falhou" para um estrago de tamanho desconhecido. Regenerado com um `it()` por caso.

#### Estado ao fim do dia

`pnpm typecheck:all` verde. **281 testes**, 180 deles no worker, em 9 arquivos. Quatro planos com `auditsPerMonth` gravado.

O log da suíte confirma os níveis: `JOB_ALHEIO` sai em `WARN` com o id recebido e o gravado lado a lado — a diferença entre os dois é a prova —, e `JA_FINALIZADA` em `DEBUG`, porque replay é operação normal.

Das 23 medições da `SECURITY-EGRESS-POLICY-v3.md`: as de faixa, resolução, redirect, tamanho e erro uniforme saíram no módulo de rede; **S12, S12b e S13 fecharam com o pipeline**, contra Postgres.

**Faltam S8 e S9** — isolamento na leitura —, e elas dependem da decisão E1: a forma do teste muda conforme a resposta saia como RLS no Postgres ou como extensão do Prisma.

**S14 e S15, do sanitizador, não fecham e não vão fechar como estão escritas** — e isso é achado, não pendência. No caminho da auditoria não existe sanitizador porque **não existe corpo para sanitizar**: o provider nunca devolve bytes de página, e o tipo `MedicaoValor` impede que voltem. A intenção da medição está satisfeita por construção em vez de por componente. Marcar as duas como fechadas seria dizer que um componente inexistente passou no teste.

Do que faltava provar sem rede, socket e prazo saíram hoje. Continua fora: **TLS real**, pelo motivo registrado acima, e a busca ponta a ponta — o `buscar()` segue testado com dublê, porque o servidor de teste vive em `127.0.0.1` e o `guard` o bloqueia, corretamente. Provar a pilha inteira exige um alvo público, e isso é checklist de deploy, não de unidade.

#### Uma nota sobre o que "verde" significou hoje

Quatro vezes neste dia um verde escondeu coisa: o `prisma generate` que falhou e deixou cinco pacotes checando contra tipos velhos, o `egress-guard.spec.ts` que anunciava 1 teste para 28 asserções, os 81 testes do módulo de egress que passavam sobre duas falhas de contrato que só um socket real expõe, e o teste de auditoria que afirmava `COMPLETED` sobre uma cadeia de redirect que tinha morrido em `REDIRECT_DEMAIS`.

O padrão é o mesmo nas quatro: **o verde prova o que foi escrito, não o que era preciso.** A defesa que funcionou também foi a mesma — executar contra a coisa real em vez de contra a representação dela, e desconfiar do teste que passa de primeira num caminho que tem mais de um jeito de dar certo.

E a variante mais cara é a terceira: **teste que exercita uma camada precisa passar por todas as anteriores.** Ela apareceu hoje três vezes — no S1 escrito com porta fora da allowlist, no spec colapsado em um `it()`, e na auditoria com um servidor só. Nas três, a asserção olhava para o fim e não reparava que o meio não tinha acontecido.

A quinta veio no fim do dia e é de outra natureza: **a suíte passou 168 testes com o `typecheck` vermelho.** O vitest transpila sem checar tipos, então tudo ficou verde sobre um arquivo que não compilava. Teste e typecheck medem coisas diferentes, e passar num não diz nada sobre o outro.

**Consequência prática, para o CI:** `typecheck:all` roda **antes** de `test`, não ao lado. Falhar cedo custa menos que um verde que engana — e é a mesma lição do `prisma generate` que falhou de manhã e deixou cinco pacotes checando contra tipos velhos.

A sexta fecha o dia e é a mais barata de todas: **a suíte inteira não sabia que as checagens ignoravam o código de status, nem que `porta80` mentia, nem que `saltos` apagava o que tinha medido.** Quem soube foi um script de vinte linhas apontado para a internet, três vezes seguidas.

Teste prova o que foi imaginado; o mundo real oferece o que não foi. As duas coisas não se substituem — e o dia inteiro foi gasto aprendendo que a segunda custa dez minutos.

`F:\drmind` não foi modificado.

---

### Plano vira dado — passos 4 e 5 · 23/08/2026

Migration `20260823141003_f0_remove_enum_plancode`, duas linhas: `DROP TYPE "PlanCode"`.

O tipo `PlanCode` não existe mais em lugar nenhum — nem como união de literais em `@propectai/types`, nem como enum do Postgres. `Plan.code` é texto, e a lista de planos é uma consulta.

**Dezoito arquivos**, contra os dez que o mapa do §11.1 previa. Os oito a mais estão explicados abaixo.

#### O que deixou de ser lista compilada

| Onde | Era | Virou |
|---|---|---|
| `admin.service.ts` | `const PLANOS: PlanCode[]` para a estatística | `prisma.plan.findMany()`, ordenado por `sortOrder` |
| `admin.controller.ts` | `@IsIn(['FREE','START','PRO','AGENCY'])` | `@IsString()`; a existência já era conferida no service, contra o banco |
| `tenants-table.tsx` | `const PLANOS` no componente | `Object.keys(data.summary.byPlan)` — o servidor já devolve a lista |
| `set-plan.ts` | `const VALID: PlanCode[]` | consulta; sem argumento, imprime os códigos cadastrados |

O `@IsIn` era o mais perigoso dos quatro: ele responderia **400 a um plano criado pela tela do Master** — e a tela existe justamente para criar planos. Falharia sem dizer por quê.

#### Duas lições, e as duas são sobre listas

**O mapa do §11.1 estava desatualizado, e eu confiei nele.** Ele nomeava dez arquivos, escrito em 13/08. `outreach/outreach.service.ts` ganhou a referência depois e não estava lá. Montei o inventário pela tabela em vez de varrer o repositório, e quem encontrou o arquivo faltante foi o compilador.

É o defeito que o `tenant.guard.ts` já descreve sobre listas de rotas: *"lista envelhece em silêncio: alguém cria um endpoint novo, esquece de incluir, e a regra fica diferente do que se decidiu sem ninguém notar."* **Inventário de varredura mecânica se faz por `grep`.** O documento explica o porquê de cada mudança; não enumera.

**O cast do `tenant.guard.ts` quase escapou da conferência** — ele era `as ActiveTenant['planCode']`, sem a string `PlanCode`, então um `grep` por `PlanCode` não o encontrava. Era o marcador declarado do passo 4, e o que o achou foi ler o arquivo.

#### `AGENCY` fica, e o §11.1 é que estava velho

O §11.1 dizia *"`AGENCY` morre aqui, `SCALE` no lugar"*, pelo argumento de que a varredura já tocaria todos os pontos. Valia enquanto o enum existia.

Com o passo 5 concluído, renomear o `code` deixou de ser mudança de tipo e virou `UPDATE` em dado vivo — com o `AuditLog` guardando `AGENCY` nas trocas de plano passadas e o Stripe possivelmente referenciando o código em `metadata`.

E a decisão que prevalece é a do próprio schema, escrita depois: *"**É chave, não rótulo.** O `code` aparece em log, auditoria e integração, e mudá-lo quebra histórico. **Renomear plano não toca aqui.**"* A correção já tinha sido feita no campo certo — o plano se chama **"Escala"** na vitrine desde 13/08.

#### Falta o passo 6

O CRUD de planos no Master, que é a tela que os cinco passos anteriores existiram para tornar possível. Enquanto ela não existir, nada do que foi removido acima faz falta — e é exatamente por isso que a dívida durou.

#### E o risco de migration declarado em 13/08 fecha aqui

A entrada de 13/08 pediu: *"o `ALTER TABLE` rodou contra tabela vazia, então **o cast não foi exercitado contra dado real**. Vale confirmar numa cópia da base antes de produção."*

**O cast não existe mais para ser exercitado.** O `USING "code"::text` pertencia ao passo 1, que converteu a coluna de enum para texto — e ela já é texto desde então. O que restava do `enum PlanCode` era um tipo órfão do Postgres, sem coluna alguma o usando, e o `DROP TYPE` de hoje rodou com a tabela `plans` populada.

Conferido depois das duas migrations: quatro planos, `limits` como objeto JSON válido em todos.

```text
  code  |   name   | limits_ok
--------+----------+-----------
 AGENCY | Escala   | object
 FREE   | Explorar | object
 PRO    | Impulso  | object
 START  | Base     | object
```

Verificado: `pnpm typecheck:all` verde, `pnpm test` com 111 testes passando, e as consultas de divergência de tenant em zero.

---

### Integridade de tenant no banco · 23/08/2026

Migration `20260823131105_f0_integridade_tenant`. Cinco tabelas tinham `tenantId` como coluna solta — sem chave estrangeira para coisa nenhuma. O isolamento entre tenants dependia inteiramente de disciplina da aplicação: nada no banco impedia gravar a presença digital de um lead do Tenant A com o `tenantId` do Tenant B.

Agora `(tenantId, leadId)` referencia `leads(tenantId, id)`. A divergência deixou de ser representável.

| Tabela | Antes | Agora |
|---|---|---|
| `lead_source_records` | `leadId → leads(id)` | `(tenantId, leadId) → leads(tenantId, id)` |
| `lead_digital_presences` | idem | idem |
| `lead_scores` | idem | idem |
| `lead_score_reasons` | `scoreId → lead_scores(id)` | `(tenantId, scoreId) → lead_scores(tenantId, id)` |
| `pipeline_transitions` | `cardId → pipeline_cards(id)` | `(tenantId, cardId) → pipeline_cards(tenantId, id)` |
| `lead_tags` | **sem `tenantId`** | coluna nova, e as duas FKs partilham ela |

`lead_tags` é a única junção real do schema: dois pais, cada um com o seu tenant. Sem coluna própria, nada impedia ligar um `Lead` do Tenant A a uma `Tag` do Tenant B — o nome da tag de um concorrente na tela do outro. As duas FKs partilhando `tenantId` é o que força os dois lados ao mesmo tenant.

#### O que ficou de fora, e não por escolha

`lead_source_records.scrapeJobId`, `pipeline_transitions.fromStageId` e `.toStageId` continuam simples. **Não é escopo, é impedimento:** os três são `ON DELETE SET NULL`, e uma FK composta que partilhe `tenantId` não pode ser `SET NULL` — o Postgres anularia todas as colunas da chave, inclusive `tenantId`, que é `NOT NULL`. Apagar uma etapa do funil quebraria a linha. Fechar esse lado exige trigger, ou o `SET NULL (coluna)` do Postgres 15, que o Prisma não modela.

Também ficou aberto `Proposal.leadId`: FK simples, e nada obriga `proposal.tenantId = lead.tenantId`. Encontrado durante a revisão deste trabalho, e medido em zero hoje.

#### Medir antes, e a medição salvou a migration

Sete consultas contra a base antes de gerar qualquer coisa, em `gate0/verificacoes-f0.sql` e `verificacoes-f0b.sql`. Todas deram zero divergentes, o que permitiu criar as constraints sem corrigir dado antes.

**A primeira versão do plano media quatro tabelas e incluía cinco na migration.** `pipeline_transitions` entrou sem nunca ter sido olhada — e uma única linha divergente abortaria o arquivo inteiro.

**E o backfill do `lead_tags` estava logicamente errado.** O plano dizia preencher `tenantId` a partir do lead. Mas as duas FKs partilham a coluna: se lead e tag divergirem, **nenhum valor satisfaz as duas** — escolher lado só decide qual estoura. A pergunta certa não era `count(*)`, era divergência. Deu zero linhas, e a tabela está vazia de qualquer forma.

#### `pnpm typecheck` não via os testes nem os scripts de banco

O aviso de 13/08 — *"verde na suíte não substitui `pnpm typecheck`"* — estava pela metade. `packages/types/tsconfig.json` exclui `src/**/*.test.ts` e `apps/api/tsconfig.json` exclui `test/`, e nenhum `tsconfig` cobre `prisma/*.ts`. Os dois erros de tipo declarados naquela entrada caíam no vão entre `ts-jest`, que transpila sem checar, e o `typecheck`, que não olhava para lá.

Três arquivos novos fecham o vão: `packages/types/tsconfig.tests.json`, `apps/api/tsconfig.tests.json`, `tsconfig.scripts.json`, com os scripts `typecheck:tests`, `typecheck:scripts` e `typecheck:all`. **É `typecheck:all` que vai para o CI**, não `typecheck`.

Rodando os três: verde. Os dois erros de 13/08 já não existem — foram corrigidos sem entrar no registro.

#### Duas lições desta rodada

**Cache do Turbo é confiável; o escopo dele é que não era.** Cinco `cache hit` significam que os arquivos não mudaram desde um run que passou — o Turbo não cacheia tarefa que falha. O verde era real. O que ele cobria é que estava errado.

**`prisma generate` falhando não interrompe o `typecheck`.** Um `EPERM` no `query_engine-windows.dll.node`, com processo `node` segurando o arquivo, deixa o client antigo no lugar — e os cinco pacotes compilam verde contra tipos que não mudaram. É o mesmo modo de falha do healthcheck do scraper, documentado no `docker-compose.yml`: o teste passa pelo motivo errado. Encerrar o `pnpm dev` antes de gerar.

---

### Plano vira dado — passos 1, 2 e 3 · 13/08/2026

Migration `20260813192737_plano_vira_dado`. Primeiros dois dos seis passos de `docs/strategic/lacunas-estruturais.md` §11.1.

#### Passo 1 — `Plan.code` deixa de ser enum

Texto único no lugar de `enum PlanCode`. "Incluir plano" não era uma tela que faltava: era uma tela **impossível de escrever** sobre o schema antigo, porque cada plano novo seria migration mais deploy.

`enum PlanCode` continua declarado, órfão, com a nota do passo que o remove. Enum órfão sem essa nota vira permanente.

#### Passo 2 — os limites vêm do banco

`EntitlementsService` carrega `Plan.limits` num cache e recarrega a cada minuto. É o passo que decide se a mudança serviu: enquanto o gate lesse `PLAN_LIMITS` compilado, editar um limite na tela do Master não mudaria o comportamento do produto — e tela que mente é pior que tela ausente.

Cache e não consulta por chamada porque `limits()` roda dentro de laços: mascarar telefone é chamado uma vez por lead da listagem. Um minuto de defasagem num limite não machuca ninguém; uma query por lead, sim.

**O fallback é o mais restritivo, não o do FREE.** Plano ausente do cache zera tudo. FREE é decisão comercial que muda; isto é rede de segurança, e errar para o lado generoso entrega recurso pago de graça sem dar sinal.

#### Passo 3 — `PLAN_LIMITS` vira semente

Nenhum código de produto lê mais a constante. Ela sobrou em `prisma/seed.ts`, para ter o que gravar num banco vazio, com um bloco no próprio arquivo dizendo que é proibido lê-la em outro lugar — constante exportada de pacote compartilhado é um convite.

Os três usos pediram coisas diferentes:

| Onde | O que era | O que virou |
|---|---|---|
| `account.service` | `plan.limits ?? PLAN_LIMITS[code]` | só o banco |
| `admin.service` | `PLAN_LIMITS[code]` | `EntitlementsService` |
| `auth.service` | `planLimits()` | apagado |

O `??` do `account.service` era a mentira em miniatura: `limits` é coluna obrigatória, e plano com limite vazio está mal cadastrado — a tela precisa mostrar isso, não disfarçar com um valor que ninguém configurou.

O `planLimits()` do `auth.service` não tinha chamador. Método público sem uso é passivo: alguém o encontra depois, assume que é o jeito certo de ler limite, e reintroduz a constante por conta própria.

#### Duas lições caras desta rodada

**Migration aplicada não se edita, se substitui.** Editei o arquivo de uma migration que já tinha falhado ao aplicar; o Prisma detectou o checksum diferente e a única saída que ele conhece é recriar o schema. Custou os dados de demonstração e um `db:seed`. Em produção teria custado a base. O certo era apagar a pasta e gerar outra.

**A migration que o Prisma gerou era destrutiva e só falhou por sorte.** `DROP COLUMN "code"` seguido de `ADD COLUMN "code" TEXT NOT NULL` quebra em tabela populada — mas passaria limpo em tabela vazia, apagando o `code` de todos os planos e desligando cada assinatura da sua linha. O cast `USING "code"::text` foi escrito à mão.

Efeito colateral do reset: o `ALTER TABLE` rodou contra tabela vazia, então **o cast não foi exercitado contra dado real**. Vale confirmar numa cópia da base antes de produção.

#### Também

`ts-jest` transpila sem checar tipos: os 59 testes passaram com dois erros de tipo no repositório. Verde na suíte não substitui `pnpm typecheck`.

---

### Suspensão em leitura, e planos mensais · 13/08/2026

Sem migration. Fecha a lacuna entre a §10.4 e o código: a decisão dizia que suspenso mantém leitura, e o `TenantGuard` bloqueava tudo.

#### A regra é o método HTTP, não uma lista de rotas

Suspenso lê e não escreve. Lista de rotas permitidas envelheceria em silêncio — alguém cria um endpoint, esquece de incluir, e a suspensão fica mais dura do que se decidiu sem ninguém notar. O método já separa ler de escrever em todo o produto, de graça.

O furo do outro lado são **as leituras que gastam**: abrir um segmento em idioma novo dispara geração por IA, e é um `GET`. Sem tratamento, workspace inadimplente queimaria orçamento de Gemini só navegando. Daí `@ConsomeRecurso()`, hoje em `GET /segments/:id`.

`GET /leads/export` fica liberado de propósito. É a rota que materializa a portabilidade, e bloqueá-la seria "pague para levar seus dados".

#### Um teste antigo falhou, e estava certo em falhar

`admin-panel.spec.ts` afirmava que suspender bloqueia `GET /leads`. Verdade até ontem. Reescrito para afirmar a regra nova — e ficou mais forte: prova leitura preservada e escrita cortada na mesma execução, em vez de um lado só.

A reescrita está anotada no próprio teste. Sem isso, quem ler o histórico daqui a seis meses vê um teste de bloqueio virar teste de permissão e não tem como saber se foi decisão ou se alguém afrouxou a regra para a suíte passar.

#### Planos: mensais, renomeados, mesmos códigos

| Código | Nome | Preço | Leads | Buscas | IA |
|---|---|---:|---:|---:|---:|
| `FREE` | Explorar | R$ 0 | 5 | 3 | 0 |
| `START` | Base | R$ 27 | 250 | 50 | 150 |
| `PRO` | Impulso | R$ 47 | 600 | 120 | 400 |
| `AGENCY` | Escala | R$ 97 | 1.500 | 250 | 1.000 |

"Vitalício" saiu dos nomes: vitalício e cobrança recorrente são modelos incompatíveis, e o nome aparece na tela onde a pessoa decide pagar.

**O nome mudou e o `code` não.** Código é chave técnica — enum do Postgres, `PLAN_LIMITS`, gates, testes; nome é texto de vitrine. Separar os dois fez a mudança inteira caber em quatro linhas do seed, e o front-end não precisou de uma edição porque não tinha nome de plano em lugar nenhum (regra 7: zero mock no front).

Os limites do **Impulso** foram interpolados, não decididos comercialmente. Está dito em comentário no código para ninguém tratá-los como número acordado.

#### Dívida registrada

`AGENCY` ficou factualmente errado quando o produto passou a atender todos os segmentos. Renomear custa migration mais varredura dos gates; **o momento barato é agora**, com zero clientes pagantes — depois do primeiro checkout, mexer em `PlanCode` envolve assinaturas vivas no provedor.

Também: `stripePriceId` saiu do `update` do seed. Ele é configurado uma vez por ambiente e o seed roda muitas — sobrescrever com nulo desligaria a cobrança a cada `pnpm db:seed`.

---

### Cobrança — provedor, webhooks e suspensão · 13/08/2026

Migration `20260813172113_cobranca_stripe`. Item 5 da sequência, decisões em `docs/strategic/lacunas-estruturais.md` §10.

#### Adicionado

- `PaymentProvider` em `@propectai/types` — terceiro contrato de provedor, ao lado de `LeadSourceProvider` e `AIProvider`
- `StripePaymentProvider` e `MockPaymentProvider`, escolhidos por `PAYMENT_PROVIDER`
- `POST /billing/checkout`, `POST /billing/portal`, `POST /billing/webhook`
- `BillingEvent` — envelope de webhook, com chave única por evento
- Suspensão e reativação automáticas por estado da assinatura
- Sete testes em `billing-rules.spec.ts`

#### A aplicação diz qual preço, nunca quanto

`Plan.stripePriceId` vai ao checkout; `pricesByCurrency` é cache sincronizado por webhook. As duas alternativas puras falham em pontos opostos — só o banco mente quando alguém mexe no painel, só o Stripe derruba a tela de planos quando o Stripe cai.

O que torna o cache seguro é a assimetria: cache velho vira **constrangimento visual**, enquanto enviar um valor calculado por nós viraria **cobrança errada**. Não são erros da mesma categoria.

#### Suspensão segue o provedor, não um contador nosso

| Estado | Efeito |
|---|---|
| `PAST_DUE` | Nada. É o provedor ainda tentando, e a causa mais comum é cartão vencido |
| `UNPAID` / `CANCELED` | Suspende, com `billing:inadimplencia` em `suspendedReason` |

O marcador existe para que **pagar não desfaça suspensão manual**. Sem ele, tenant suspenso por abuso voltaria sozinho na primeira fatura paga, e quem o suspendeu não saberia.

Suspenso perde busca e IA; mantém leitura, pipeline e exportação. Os leads foram coletados com cota já paga, e reter dado como alavanca de cobrança colide com portabilidade (LGPD art. 18, GDPR art. 20).

#### Reler em vez de confiar no payload

Webhook de assinatura relê o estado atual no provedor. A entrega não é ordenada, e um `updated` antigo chegando depois de um `deleted` reativaria quem cancelou. Reler custa uma chamada e **elimina a classe inteira de bug de ordenação**: não há estado anterior a comparar, só o atual.

#### Idempotência antes de processamento

O evento é gravado antes de ser processado. Se o processamento falhar, ele fica com `error` preenchido e `processedAt` nulo — visível e reprocessável. Processar primeiro perderia exatamente os eventos que deram errado, que são os únicos que interessam.

A falha propaga de propósito: o provedor reentrega, e a chave única torna a reentrega inofensiva.

#### Dois campos que o Stripe mudou de lugar

`current_period_start/end` saiu da assinatura para o item da assinatura, e `invoice.subscription` virou `invoice.parent.subscription_details.subscription`. Ler só o campo antigo devolveria `null` em silêncio — e `currentPeriodEnd` é a data que decide quando o acesso termina.

`currency_options` só vem com `expand`. Sem isso o cache nasceria com uma moeda só, sem erro e sem log, até um cliente europeu ver preço em real.

#### O mock recusa, não simula

Toda operação que moveria dinheiro lança com mensagem dizendo qual variável falta. Um mock que devolvesse "assinatura ativa" faria a tela de planos parecer funcionar sem Stripe, e o defeito apareceria no primeiro cliente real.

#### Ainda sem interface

Nenhuma tela chama estes endpoints. Está registrado aqui em vez de ficar implícito: é código sem caminho de uso, exatamente o que este projeto trata como defeito. A tela de assinatura é o passo seguinte.

---

### Gemini e termos por locale · 13/08/2026

Migration `20260813161045_validacao_de_termos`. Item 4b da sequência de `docs/strategic/lacunas-estruturais.md`.

#### Adicionado

- `GeminiAIProvider`, implementando o mesmo contrato `AIProvider` do mock
- `AIProviderFactory` — escolha por `AI_PROVIDER`, com o padrão em `mock`
- Geração de termos de busca por locale, sob demanda, ao abrir um segmento sem tradução
- Termos do segmento sugeridos na Nova Busca, com a procedência à vista
- `ProspectingSearch.segmentLocaleId` e o veredito no worker

#### A queda para o mock avisa

`AI_PROVIDER=gemini` sem `GEMINI_API_KEY` cai no mock **e registra em log**. Ambiente que deveria gerar e não gera produz mensagens plausíveis porém genéricas — que passam despercebidas até alguém comparar a saída com o que esperava. Erro de configuração que degrada em silêncio é o pior tipo.

#### Geração sob demanda, não em lote

500 segmentos vezes idiomas seriam milhares de chamadas, e a maioria nunca usada: ninguém prospecta todos os setores de todos os países. Gerar quando o primeiro tenant de um país abre o segmento custa uma chamada e resolve para todos os seguintes.

Lista vazia também é persistida — o modelo foi instruído a devolver vazio quando não souber, e gravar isso evita repetir a chamada para descobrir a mesma coisa.

#### Validação sem custo extra

O problema real dos termos gerados: **o modelo pode produzir uma expressão plausível que ninguém usa**, e busca vazia faz o cliente concluir que o produto não funciona no país dele — não que faltou validar um campo. Pedir ao modelo que admita ignorância ajuda, mas confiar nisso é confiar na peça mais fraca.

Validar com scraper dedicado custaria um job por termo, minutos por segmento, consumindo capacidade que o cliente paga. A saída foi **aproveitar a primeira busca real**: ela já ia rodar, e a contagem de resultados responde de graça.

| Decisão | Motivo |
|---|---|
| Conta resultado bruto, não lead novo | Duplicado prova que o termo encontra empresas. Contar só os novos reprovaria um termo bom numa base já coletada |
| Zero resultado registra a contagem, não apaga o termo | Pode ser cidade sem esse tipo de negócio. Termo que falha em várias cidades vira padrão visível no banco |
| `CURADO` não é rebaixado | Veio de pessoa; resultado ruim numa cidade pequena não invalida. Só o `GERADO` está em julgamento |
| Digitar por cima zera o crédito | Validação que credita busca que ninguém fez com aquele termo é pior que validação nenhuma |

Cinco testes novos em `scrape-pipeline.spec.ts`, rodando o pipeline de verdade. O que exige mais do que parece é o de **validar com todos os resultados duplicados**: contar leads novos em vez de resultados brutos passaria em todos os outros e falharia só nele.

O bloco existe porque o custo de errar aqui não é local — o status de um `SegmentLocale` vale para o país inteiro, não para um tenant. Promover termo ruim faz todo cliente novo daquele país começar com busca vazia; rebaixar termo bom apaga curadoria humana. Nos dois casos o sintoma aparece semanas depois da causa.

#### A procedência é dita, não escondida

Termo gerado aparece como **"sugerido, não verificado"**; validado, como "já trouxeram resultados"; o `pt-BR` importado, como "revisado". O usuário decide sabendo de onde veio.

#### Corrigido durante o trabalho

Escrevi um canal `OTHER` que não existe em `OutreachChannel`. O `Record<OutreachChannel, string>` recusou — e é para isso que ele está lá em vez de um objeto solto: canal novo no tipo quebra a compilação aqui, em vez de cair num limite genérico silencioso.

---

### Taxonomia de segmentos · 06/08/2026

Migration `taxonomia_de_segmentos`. Item 4a da sequência de `docs/strategic/lacunas-estruturais.md` — a parte de dados. O 4b (Gemini e termos por locale) vem depois.

**O produto deixa de ser ferramenta de agência digital.** `SERVICE_OPTIONS` tinha cinco valores compilados — Sites, Tráfego pago, Social media, Design, Consultoria — e a lista de nichos tinha quinze. Quem não fosse agência preenchia tudo à mão, contra sugestões que não faziam sentido para ele.

#### Adicionado

- `Segment` e `SegmentLocale`, com 500 segmentos em 50 macro-segmentos importados da base B2B
- `Tenant.segmentId`, opcional
- `GET /api/v1/segments` — busca por texto e por macro, teto de 40 resultados
- `GET /api/v1/segments/:id` — detalhe com serviços, setores e termos no locale do tenant
- `PATCH /api/v1/settings/segment` — escolhe o segmento e, se pedido, aplica os padrões
- Seletor em Configurações, acima das preferências
- `pnpm db:segments <arquivo>` — importação idempotente por `externalId`
- `ActiveTenant` ganhou `country` e `currency`

#### Duas taxonomias, não uma

A base tornou explícita uma distinção que o produto não tinha:

| Taxonomia | Descreve | Origem |
|---|---|---|
| Segmento | Quem **usa** o produto e o que vende | Base de 500 |
| Categoria do lead | Quem é **prospectado** | Vocabulário do Google Places |

A ponte entre elas é `SegmentLocale.searchTerms` — o texto que vai literalmente ao scraper. Confundi-las produziria filtro que não devolve nada.

#### `SegmentLocale` existe por um motivo específico

Os termos de busca **são funcionais, não textuais**. `agência de marketing digital em Milano` não devolve nada no Google Maps; o termo correto é `agenzia di marketing digitale`. Tradução errada não deixa a tela feia — deixa a busca vazia, e o cliente conclui que o produto não funciona no país dele.

Daí o `status`: `GERADO` por modelo, `VALIDADO` depois de devolver resultado real no scraper, `CURADO` quando revisado por pessoa. O `pt-BR` importado nasce `CURADO`, porque veio de pessoa.

E daí também a regra do endpoint: **locale sem tradução devolve termos vazios, nunca os em português.** Vazio é honesto; termo errado é sabotagem silenciosa.

#### Decisões de produto

**A base é padrão editável, não verdade curada.** Não precisa ser perfeita — precisa ser melhor que campo em branco. O tenant escolhe, recebe preenchido e ajusta. Erro numa linha vira edição de um cliente, não defeito de produto. Curar 500 entradas antes de existir cliente seria trabalho sem retorno conhecido.

**Aplicar os padrões é decisão separada da escolha**, com prévia do que será aplicado. E **soma em vez de substituir**: trocar de segmento não pode apagar em silêncio uma lista ajustada à mão durante meses.

**Segmento é opcional.** Quem não se reconhece em nenhum dos 500 preenche à mão. Taxonomia é atalho, não pedágio.

#### Corrigido durante o trabalho

**O importador lia a coluna errada.** Confundi os números de linha exibidos pelo editor com uma coluna do arquivo, e o `slice(1)` deslocava tudo: o macro-segmento virava `externalId`, e os 500 registros colapsavam em 25, sobrescritos vinte vezes cada. O sintoma foi *"25 criados, 475 atualizados"* numa tabela vazia — import que atualiza o que não existe está lendo a coluna errada.

Corrigido, e com guarda: o script agora recusa rodar se a primeira coluna não tiver o formato `B2B-0000`. Import desalinhado grava taxonomia silenciosamente errada, que é pior que não importar.

**Duas construções da mesma view.** `preferences()` e o fim de `updatePreferences()` montavam `PreferencesView` separadamente, e ao acrescentar `segment` só a primeira foi atualizada. O typecheck pegou porque o campo é obrigatório — com campo opcional teria compilado, e salvar preferências faria o segmento sumir da tela até recarregar. Agora há uma construção só.

---

### Painel do provedor · 06/08/2026

Migration `20260811212430_painel_do_provedor`. Item 3 da sequência de `docs/strategic/lacunas-estruturais.md`.

**Até aqui não existia caminho para atender um cliente real.** Para saber quais tenants existiam, a resposta era consultar o banco. Para trocar o plano de alguém, `pnpm db:plan` — um script que, por desenho, **só age em tenant com `isDemo: true`**. Não havia nem a via manual.

#### Adicionado

- `GET /api/v1/admin/tenants` — todos os workspaces com plano, consumo do período, membros, última atividade e estado
- `PATCH /api/v1/admin/tenants/:id/plan` — troca de plano com motivo obrigatório
- `POST /api/v1/admin/tenants/:id/suspend` e `/reactivate`
- `/admin` no front, com layout próprio
- `pnpm db:admin add|remove|list` — promoção de operador

#### Decisões de arquitetura

**`PlatformAdmin` é tabela separada, não um papel a mais.** Papel de membership é escopado a um tenant; operador de plataforma enxerga todos por definição. Modelar como `Role` colocaria acesso irrestrito dentro da mesma estrutura que o `TenantGuard` percorre a cada requisição, e bastaria um erro de comparação para vazar dado entre clientes. A separação é física: tabela, guarda e prefixo de rota próprios.

**O `AdminController` não usa `TenantGuard`, e a ausência é o ponto.** É o único controller que consulta sem `tenantId` — em qualquer outro lugar, defeito grave.

**Promover operador é script, não tela.** Uma interface que promove seria o alvo mais valioso do sistema: comprometer uma senha de dono e clicar num botão daria acesso a todos os tenants. Exigir acesso ao servidor eleva o custo do ataque de "roubar uma senha" para "entrar na infraestrutura". O script também recusa remover o último operador.

**O layout do painel é visivelmente diferente** — faixa escura, sem sidebar do produto, rótulo "todos os clientes". Confundir os dois planos é como se apaga o dado do cliente errado achando que se está no próprio workspace.

#### Suspensão que bloqueia

`Tenant.suspendedAt` e `suspendedReason`, com o bloqueio efetivo no `TenantGuard` e revogação imediata dos refresh tokens. **Suspensão que só grava data é anotação no painel, com o inadimplente usando o produto normalmente.**

O teste refaz o login depois de suspender, de propósito: como suspender revoga os tokens, verificar com o cookie antigo provaria apenas que revogação funciona, não que a suspensão bloqueia.

#### Motivo obrigatório

Trocar plano e suspender exigem justificativa, gravada em `AuditLog`. Registro sem motivo é quase igual a não ter registro — daqui a seis meses, "por que este cliente está em AGENCY" precisa ter resposta.

Nove testes cobrem a fronteira. Os dois principais: dono de workspace recebe 403 no painel, e operador da plataforma **não** lê lead de tenant onde não tem membership. A separação vale nos dois sentidos.

---

### Gestão de equipe · 06/08/2026

Migration `20260811204408_convites_de_equipe`. Item 2 da sequência de `docs/strategic/lacunas-estruturais.md`.

**Fecha uma promessa comercial que o produto não cumpria.** PRO e AGENCY vendiam 5 e 25 usuários e entregavam 1 — não havia convite, endpoint nem tela. O `register` criava tenant e dono, e acabava ali. Junto disso, os cinco papéis do RBAC estavam implementados, guardados por `MinRole` e **inalcançáveis**: com um usuário por tenant, nenhum era exercitado.

#### Adicionado

- Modelo `Invitation`, com token guardado em hash — mesma política do `RefreshToken`
- `GET /api/v1/team` — membros, convites pendentes e assentos
- `POST /api/v1/team/invitations` — convida e devolve o link de aceite
- `DELETE /api/v1/team/invitations/:id` — revoga
- `PATCH /api/v1/team/members/:id/role` e `DELETE /api/v1/team/members/:id`
- `GET /api/v1/invitations/:token` e `POST /api/v1/invitations/accept` — públicas
- Configurações → **Gerenciar equipe**, e `/invite/[token]` para o aceite
- `SessionCookieService`, extraído do `AuthController`: o aceite também abre sessão, e política de cookie duplicada em dois lugares é política que diverge

#### Regras que o produto passa a garantir

| Regra | Por que existe |
|---|---|
| Ninguém concede papel acima do próprio | Sem ela, um ADMIN cria um OWNER e escala privilégio em duas requisições |
| Ninguém altera quem está acima de si | A mesma escalada, pelo avesso |
| O último dono não é removido nem rebaixado | Workspace sem dono não tem quem convide, remova ou mude plano. Estado terminal, sem caminho de volta pela interface |
| Convite pendente ocupa assento | Sem isso, mil convites furam o limite do plano sem ninguém ter entrado |
| Remover membro revoga os refresh tokens | Sem isso, quem saiu continua trabalhando até o access token expirar |
| Vínculo é soft delete | Contatos e notas apontam para o autor; apagar deixaria histórico órfão |
| Aceite em conta existente exige a senha atual | Impede que alguém de posse do link anexe um workspace à conta alheia |

Onze testes cobrem essas regras, incluindo o caminho completo de escalada: convida um ADMIN de verdade, aceita o convite, pega a sessão dele e tenta a promoção a OWNER.

#### Decisão: sem envio de e-mail

Não há provedor de e-mail no produto, e **fingir que um e-mail saiu seria pior que admitir que ele não existe**. O link de aceite é devolvido uma única vez, na criação, para quem convidou copiar e enviar pelo canal que preferir. A tela diz isso — sem o aviso, alguém fecharia a janela e perderia o convite sem entender por quê.

Como o token vive em hash, não há como reconstruir o link depois. Na listagem, `acceptUrl` vem `null`.

---

### Alcance internacional — schema · 06/08/2026

Migration `20260811201507_alcance_internacional`.

Primeiro item da sequência de `docs/strategic/lacunas-estruturais.md`, e o único cujo custo crescia todo dia: sem `country`, não haveria como descobrir retroativamente de que país era cada lead.

#### Adicionado

| Modelo | Campo | Papel |
|---|---|---|
| `Lead` | `country` | ISO 3166-1 alpha-2, default `BR` |
| `ProspectingSearch` | `country` | Desambigua a busca — existe São Paulo no Brasil e San Paolo na Itália |
| `Tenant` | `country` | País da empresa cliente |
| `Tenant` | `currency` | ISO 4217, default `BRL`. Abre caminho para preço por região |
| `Tenant` | `taxId` | VAT, CNPJ ou equivalente. Habilita *reverse charge* na venda B2B |
| `Tenant` | `customerType` | `PF` \| `PJ`. Tira a decisão comercial do caminho crítico técnico |

O default `BR` não mente: todo lead coletado até esta data veio do Brasil.

#### Corrigido

**Lead estrangeiro perdia dado em silêncio**

`toStateUf` devolvia `null` para qualquer região fora da tabela de UF brasileira, e `toE164BR` para qualquer telefone não brasileiro. Uma busca em Milão produziria leads sem região, sem telefone normalizado e sem sinal de WhatsApp — **sem erro, sem log, sem ninguém perceber.** É a pior forma de falhar num produto de dados.

- `toRegion(valor, country)` — no Brasil converte para sigla; fora dele guarda o nome como veio. Dado imperfeito com procedência é utilizável; ausência não é
- `toE164(telefone, country)` — **não adivinha código de país.** Fora do Brasil, aceita apenas número que já vem com `+`. Inferir prefixo a partir de número local produz telefone plausível e errado, e telefone errado é pior que ausente: alguém liga
- `whatsappStatusFromPhone` — devolve `UNKNOWN` fora do Brasil, sempre. Cada país tem sua regra de numeração móvel, e chutar violaria a regra 5.2 do escopo

Sete testes novos cobrem o caminho internacional, incluindo dois que afirmam **ausência de invenção**: número local italiano não vira E.164, e prefixo móvel italiano legítimo ainda assim devolve `UNKNOWN`.

#### Adiado de propósito

**O rename de `addressStateUf` para `addressRegion` não foi feito.** São 106 ocorrências em 30 arquivos, e renomear nunca fica ambíguo — custa o mesmo daqui a um ano. `country` não tinha essa propriedade, e por isso entrou sozinho. Misturar os dois numa migration só tornaria impossível saber qual quebrou o quê. O motivo está registrado no comentário do campo, para não parecer esquecimento.

Quando houver mercado internacional de verdade, `libphonenumber` substitui a heurística de telefone.

---

### Exportação CSV · 06/08/2026

#### Adicionado

- `GET /api/v1/leads/export` — CSV da listagem **com os filtros ativos**, não da base inteira. Paginação ignorada de propósito: exportar só a página visível seria surpresa desagradável. Teto de 5.000 linhas como trava, não como limite de plano — o maior plano inclui 3.000 leads
- `export-leads-button.tsx` em Meus Leads. **O botão aparece em todos os planos** e o bloqueio acontece na tentativa. Esconder de quem não tem direito impede a pessoa de descobrir que o recurso existe, e o upgrade nunca é considerado
- Capacidade `export.csv` do `EntitlementsService`, que existia desde a v0.1.1 sem nenhum consumidor, finalmente ligada
- Registro em `AuditLog` e contagem em `PlanUsage.exportsCount`

**Separador `;` e BOM UTF-8.** O Excel em português assume ponto e vírgula e, sem o BOM, quebra os acentos. São dois detalhes que decidem se o arquivo é útil ou se a pessoa desiste na primeira tentativa — e o público deste produto abre planilha no Excel, não no pandas.

#### Corrigido

**`Content-Disposition` não chegava ao navegador**

O nome do arquivo definido pelo servidor era ignorado, e todo download saía como `leads.csv`, sem data. `Content-Disposition` não é cabeçalho *safelisted*: em requisição cross-origin, o JavaScript não o lê sem `Access-Control-Expose-Headers`. Com web em 3100 e API em 3101, isso valia para o usuário real, não só para o teste.

Resolvido com `exposedHeaders` no `enableCors`. Em produção, com API e web no mesmo domínio, o defeito nem existiria — apareceu porque o ambiente de desenvolvimento separa as portas.

#### Nota de método

A lacuna foi encontrada ao escrever o teste do critério 19, e o primeiro teste que escrevi para ela **verificava a exportação "se o botão existir"**. Passou verde num produto que não exportava nada.

Teste condicional que passa na ausência da funcionalidade é pior que teste ausente: aparece como cobertura no relatório. Foi removido, a funcionalidade construída, e o teste voltou sem `if`.

---

### Migração de volume por falha de hardware · 06/08/2026

#### Contexto

Durante a sessão de 31/07 a escrita em disco começou a falhar de forma intermitente: `EPERM` no `prisma generate`, escritas recusadas em pastas distintas, e o Node reportando `UNKNOWN: unknown error, read` ao carregar arquivos de `node_modules` que lera minutos antes.

As três primeiras hipóteses estavam erradas — disco cheio, conexão da sessão, arquivo travado. O Visualizador de Eventos do Windows deu o diagnóstico real, com carimbo do dia:

| Evento | Conteúdo |
|---|---|
| **154** | Falha de I/O em bloco lógico do Disco 2 **por erro de hardware** |
| **51** | Erro durante operação de paginação, dezenas de ocorrências |
| **50** | *"O Windows não pôde salvar todos os dados para o arquivo F:\prospectai. **Os dados foram perdidos.**"* |
| **55** | **Corrupção detectada em estrutura de índice NTFS do volume F:** |

O Disco 2 é um `Samsung M3 Portable` — HD externo USB — que hospedava o PropectAI e o Bellvia. O `robocopy` confirmou com `ERROR_DEVICE_HARDWARE_ERROR` (483), e em certo momento o dispositivo respondeu "inexistente" (433). O `HealthStatus: Healthy` do Windows era ruído: ponte USB raramente repassa SMART.

Trocar cabo e porta USB estabilizou o volume — o que aponta para a ponte, o cabo ou a alimentação do gabinete, não necessariamente para as plataformas.

#### Alterado

- **Raiz do projeto: `F:\prospectai` → `C:\ResgateProjetos\prospectai`.** Independente de o disco sobreviver, HD externo USB hospedando bind mount de Docker e `node_modules` com centenas de milhares de arquivos é o lugar errado para desenvolver
- **`.npmrc`** — removido `store-dir=F:\.pnpm-store`. A diretiva estava correta enquanto a raiz vivia no F: (store no mesmo volume permite hardlink); depois da migração passou a apontar para outro volume, e um defeituoso
- `CLAUDE.md`, `README.md` e `scope-v0.1.1.md` atualizados com a raiz nova

Documentos anteriores a 06/08 que citam `F:\prospectai` **ficam como estão**. São registro histórico do que se sabia à época; reescrevê-los falsificaria o rastro.

#### Preservado

- **Primeiro commit do repositório**, com 192 arquivos e 35.915 linhas, e push para o remoto. Até 06/08/2026 o projeto inteiro existia em cópia única, sem histórico — sobreviveu ao incidente por sorte, não por processo. Era a maior fragilidade do projeto e não tinha relação com o disco
- **Bellvia** (`F:\drmind`) copiado para `C:\backup-drmind`: 5.146 arquivos, zero falhas
- **Volumes Docker intactos.** `propectai-postgres-data` e `propectai-redis-data` são gerenciados pelo Docker e nunca estiveram no F: — o seed, as contas de demonstração e o histórico de buscas sobreviveram sem intervenção

#### Validação

Executado em 06/08/2026, após a migração:

| Verificação | Resultado |
|---|---|
| `docker volume ls` | `propectai-postgres-data` e `propectai-redis-data` presentes — banco, seed e contas intactos |
| `docker compose up -d` | Três containers no ar; `gmaps-scraper` como `Up` puro, sem o `unhealthy` do healthcheck inválido |
| `@propectai/types` | 35 testes |
| `@propectai/worker` | 5 testes — regras comerciais 5.3, 5.4 e 5.5 |
| `@propectai/api` | 26 testes — isolamento de tenant em banco e HTTP, invariantes, provider de IA |
| **Total** | **66 testes, zero falhas** |

**Nenhum arquivo veio corrompido.** A verificação estrutural feita antes da instalação já indicava isso, mas compilar e exercitar o banco é o que prova.

`F:\drmind` não foi modificado. Os containers do Bellvia seguiram no ar, saudáveis, durante toda a migração.

#### Corrigido

**Seletor de KPI acoplado a classe de estilo**

O E2E localizava o card por `div.pa-card` e o número por `p.text-kpi`, e as duas asserções quebraram com `element(s) not found` depois da reinstalação.

Classe de Tailwind é contrato acidental: o `KpiCard` monta `className` via `cn()`, que passa por `tailwind-merge` — e `text-kpi` (tamanho customizado) pode ser descartado por conflito de grupo com `text-navy-900` (cor customizada). O seletor deixa de existir sem ninguém tocar no componente, e a mensagem de erro fala de elemento ausente, não de estilo.

`KpiCard` ganhou `data-testid="kpi-card"`, `data-kpi-label={label}` e `data-testid="kpi-value"`. O `data-kpi-label` resolve de quebra a armadilha do rótulo, que aparece em maiúsculas por CSS mas vive em minúsculas no DOM.

**A verificar visualmente:** se `text-kpi` estiver mesmo sendo descartado, os números do dashboard renderizam menores que o design pede. É defeito visual que o E2E encontrou de lado, procurando outra coisa.

#### Pendente

- `chkdsk F: /scan` (somente leitura) para dimensionar a corrupção de índice registrada no evento 55. **Não rodar `/f` nem `/r`** antes de backup íntegro: em dispositivo instável, reescrever metadados transforma perda parcial em total
- Confirmar no navegador se `text-kpi` sobrevive ao `tailwind-merge`
- Os 10 critérios que continuam em `G` na conferência


### Ficha do lead, regras comerciais e Swagger · 31/07/2026

#### Adicionado

**Camada de escrita da ficha do lead**

- `PATCH /api/v1/leads/:id/follow-ups/:followUpId` — **endpoint que faltava**. Havia como criar follow-up, não como concluir, cancelar ou reagendar; `FOLLOWUP_COMPLETED` existia no enum de atividades sem nunca ser gravado. Um endpoint para as três operações, porque mudam os mesmos campos e competem entre si — separadas, exigiriam ordem definida entre chamadas
- `lead-contact-form.tsx` — registro de contato com canal, direção e resultado
- `lead-follow-ups.tsx` — agendar, concluir, cancelar e reagendar, com ação por item
- `recalculate-score-button.tsx` — recalcular o score de um lead sem reprocessar a base

**Reagendar reabre.** Data nova sem status devolve o follow-up a `PENDING` (ou `OVERDUE`, se já passou) e limpa as marcas de conclusão e cancelamento. Sem isso, remarcar um cancelado deixaria item com data futura e status `CANCELLED` — visível na lista, ausente dos avisos, e ninguém entenderia o motivo.

**Testes das regras comerciais 5.3, 5.4 e 5.5**

- `apps/worker/test/scrape-pipeline.spec.ts` — prova de **comportamento**, com Vitest novo no worker. Roda o pipeline real com `MockLeadSourceProvider` contra o banco: primeira busca liquida a reserva e cobra só os leads novos; a segunda devolve zero novos e não cobra; job falho devolve a reserva por inteiro, sem consumir **nem gerar** crédito; todo lead criado tem score com motivos; e o payload em `LeadSourceRecord` não contém `user_reviews` nem `owner`

  Achado do teste: o mock gera `place_id` novo a cada job, então a deduplicação da segunda busca acontece **pelo fingerprint**. É o caminho mais importante dos dois — o que protege quando a fonte não devolve identificador estável — e ficou coberto justamente porque o mock não colabora.

- `apps/api/test/business-invariants.spec.ts` — prova de **estado**. Varre o banco inteiro sem depender de quem gravou a linha: score sem motivo, lead sem score, valor fora de 0–100, saldo de cota negativo, reserva pendurada com fila parada, liquidação acima da contagem real de leads. A limitação está declarada no arquivo: invariante passa trivialmente em banco vazio, então é rede permanente, não prova de que o pipeline funciona

**Swagger organizado** — dez `addTag` em `main.ts`, um por módulo, ordenados pelo percurso do produto em vez da ordem de registro dos controllers. Antes, só `system` estava declarado e o resto caía em `default`.

Verificado em 31/07/2026: `pnpm typecheck` verde nos 5 pacotes, `next lint` sem avisos, 66 testes em 7 arquivos passando.

---

### Isolamento na camada HTTP · 31/07/2026

#### Adicionado

- `apps/api/test/tenant-isolation-http.spec.ts` — 6 asserções sobre o `TenantGuard` em requisição real, atravessando guard, controller e service. Sobe o `AppModule` em porta efêmera com a mesma configuração do `main.ts` e usa `fetch` nativo com cookies montados à mão; nenhuma dependência nova

  Complementa `tenant-isolation.spec.ts`, que prova o isolamento no banco. A lacuna entre os dois era real: índice composto correto com query sem `where` de tenant continua vazando, e guard correto com índice ausente também.

  Cobre: conta nova vê `total: 0`; o dono vê o próprio lead; **conhecer o id devolve 404, não 403** — confirmar existência já seria informação; KPIs e funil do dashboard em zero, porque agregação é onde o escopo de tenant mais some; 401 sem sessão; e `x-tenant-id` de outro workspace recusado mesmo com cookie válido.

  Automatiza a verificação visual que estava prevista como passo manual.

#### Corrigido

**A API não liberava a conexão Redis no encerramento**

`ProspectingService` criava a conexão `ioredis` e a fila BullMQ no construtor, sem `OnModuleDestroy`. E o BullMQ não é dono de conexão recebida pronta: `queue.close()` sozinho não bastaria.

Em teste isso aparecia como `Jest did not exit one second after the test run`. **Em produção é `SIGTERM` ignorado** — o container só encerra no kill forçado do orquestrador, com job em voo perdido no meio.

Descoberto pelo teste HTTP acima: foi a primeira vez que o ciclo de vida da aplicação inteira foi exercitado. A suíte anterior falava direto com o Prisma e nunca subiu o `AppModule`.

Verificado em 31/07/2026: 3 suítes, 20 testes, Jest encerrando sozinho.

---

### Cadastro e onboarding · 31/07/2026

#### Adicionado

- `/register` — tela de cadastro. A rota já constava em `PUBLIC_ROUTES` no middleware desde a Fase 2, **sem página**: visitante não autenticado recebia 404 em vez do formulário. Espelha o `RegisterDto` (senha mínima de 10 caracteres com contador), trata 409 com mensagem específica — quem já tem conta precisa saber que o caminho é entrar — e leva ao onboarding, não ao dashboard
- `/onboarding` — wizard de 5 etapas (serviços, nichos, regiões, canal, meta). Persiste a cada avanço, não só no fim: quem fecha a aba na etapa 3 volta na etapa 3. Todas as etapas são opcionais, e as duas que alimentam o score declaram o efeito na tela (nicho +15, região +5) em vez de exigir preenchimento. Termina em `/search`
- `POST /api/v1/settings/onboarding/complete` — idempotente, preserva a data da primeira conclusão
- `POST /api/v1/settings/onboarding/restart` — exige MANAGER. Limpa apenas a data de conclusão
- Botão Refazer/Continuar onboarding em Configurações
- Links cruzados entre `/login` e `/register`

#### Corrigido

**O onboarding não podia ser concluído**

`completedAt` só era escrito no ramo `create` do upsert em `AccountService.updatePreferences`. Como `preferences()` já cria a linha vazia no primeiro GET, todo PATCH caía no ramo `update`, onde o campo nunca era tocado — a conclusão era inalcançável por qualquer caminho.

A conclusão virou transição explícita, e não efeito colateral de salvar preferência: ajustar nichos em Configurações não significa "terminei de me apresentar ao produto".

Reiniciar **não apaga preferências**. Quem refaz quer rever as perguntas, não perder as respostas — e zerar as listas derrubaria dois pesos do score por um clique que a pessoa entende como "quero olhar de novo".

Verificado em 31/07/2026: `pnpm typecheck` verde nos 5 pacotes, `next lint` sem avisos. **Percurso no navegador ainda pendente** — o critério 6 segue em G na conferência.

---

### Correções · 31/07/2026

#### Corrigido

**Healthcheck do motor de coleta**

O container `propectai-gmaps-scraper` ficava permanentemente `unhealthy` com o serviço perfeitamente no ar. O teste `wget -q --spider http://127.0.0.1:8080/api/v1/health` estava errado por dois motivos independentes:

1. A imagem é um binário Go em base mínima — não há shell nem `wget`, então `CMD-SHELL` falhava na largada.
2. `/api/v1/health` não existe no scraper. O servidor tem rota catch-all que devolve a UI HTML com 200 para qualquer caminho desconhecido. **Se o `wget` existisse, o teste teria passado sem nunca verificar nada** — falso positivo é pior que o falso negativo que estávamos vendo.

Correções aplicadas:

- `docker-compose.yml` — healthcheck removido do serviço `gmaps-scraper`, com os dois motivos registrados no arquivo para impedir que alguém "conserte" o `wget` e reintroduza um teste que aprova sem verificar. O worker já dependia com `condition: service_started`, então nada na subida foi afetado
- `apps/worker/src/providers/google-maps.provider.ts` — guarda de `content-type` em `request<T>`: resposta 200 sem JSON agora falha nomeando a causa, em vez do `Unexpected token '<' is not valid JSON`, que é sintoma e não causa. Adicionado `probe()`, que exige JSON em `/api/v1/jobs` e não lança
- `apps/api/src/system/scraper-health.service.ts` — novo. Verificação de alcance real do scraper com timeout de 2s, porque o rodapé consome `/health` a cada render. Duplica ~30 linhas do `probe()` do worker de propósito: a API não depende do worker como workspace, e criar essa dependência só para um healthcheck acoplaria dois processos hoje independentes
- `packages/types/src/system.ts` — `HealthResponse.checks` ganhou `scraper`
- `apps/api/src/system/system.controller.ts` — `/api/v1/health` passa a reportar o scraper. **Scraper fora leva o status a `degraded`, nunca a `down`:** sem ele o usuário ainda lê leads, move pipeline e registra contato — só não dispara coleta nova. `down` continua reservado à perda de PostgreSQL e Redis

Verificado em 31/07/2026: `pnpm typecheck` verde nos 5 pacotes; `docker ps` sem `unhealthy`; `GET /api/v1/health` devolvendo `{"status":"ok","checks":{"database":"ok","redis":"ok","scraper":"ok"}}`.

`F:\drmind` não foi modificado. Nenhum recurso Docker do Bellvia foi parado, removido ou reconfigurado.

---

### Fase 1 — Fundação · 27/07/2026

#### Adicionado

**Monorepo**
- pnpm workspaces + Turborepo com scripts de raiz
- `packages/config` — tsconfig base, node e Next.js
- `packages/types` — contratos compartilhados entre api, web e worker
- `.npmrc` com store em `F:\.pnpm-store`, no mesmo volume do projeto

**Infraestrutura**
- `docker-compose.yml` com `propectai-postgres` (5434), `propectai-redis` (6381) e `propectai-gmaps-scraper` (8081)
- Healthchecks nos três serviços e dependências por condição de saúde
- Rede `propectai-network` e volumes com prefixo `propectai-`
- Serviços de aplicação sob o profile `full`, para produção
- `.env.example` documentado

**Banco de dados**
- `prisma/schema.prisma` completo: 30 modelos e 20 enums
- `tenantId` em toda entidade de negócio desde a primeira migration
- Índices únicos compostos `(tenantId, fingerprint)` e `(tenantId, placeId)`
- Tabelas sem interface na v0.1.1 já modeladas: `Proposal`, `Contract`, `Tag`, `ExportJob`

**API**
- NestJS com prefixo global `/api/v1` e Swagger em `/api/docs`
- `GET /api/v1/health` — verifica PostgreSQL e Redis
- `GET /api/v1/system/version`
- Helmet, CORS restrito, cookie-parser
- `ValidationPipe` global com `whitelist` e `forbidNonWhitelisted` contra mass assignment

**Front-end**
- Next.js App Router com fonte Inter
- Design system em tokens CSS e tema Tailwind
- App Shell: sidebar de 176px, topbar de 60px, rodapé com versão e status da API
- Dashboard esqueleto com KPIs em estado vazio
- Placeholders honestos em `/search`, `/leads`, `/pipeline` e `/history`, indicando a fase de entrega

**Worker**
- Esqueleto BullMQ conectado ao Redis
- Logger Pino com redação de segredos e dados pessoais

**Documentação**
- `README.md` com fluxo de instalação em dez passos
- `CLAUDE.md` com as regras permanentes do projeto
- `docs/technical/environment-audit.md` — auditoria da Fase 0
- `docs/strategic/scope-v0.1.1.md` — escopo aprovado
- `docs/technical/data-model.md` e `docs/technical/scoring.md`
- `infra/scripts/audit-ambiente.ps1`

#### Corrigido durante a validação

- **API escutava só em IPv4.** `app.listen(port, '0.0.0.0')` liga o socket apenas em IPv4, mas o `fetch` do Node 18+ resolve `localhost` preferindo `::1` no Windows. O rodapé reportava "API inacessível" com a API no ar. Removido o host explícito (dual-stack) e adicionado `API_INTERNAL_URL` com IPv4 explícito para os Server Components.
- **`deleteOutDir` do Nest CLI em watch mode.** A limpeza da pasta `dist` corria em paralelo com o `tsc` e às vezes chegava depois da emissão: compilava com "0 errors" e o node falhava com `Cannot find module dist/main`. Desligado. Compilação incremental também desligada na API, porque o `.tsbuildinfo` vive dentro de `dist` e uma remoção externa faz o `tsc` concluir que está tudo atualizado.
- **Scripts de postinstall bloqueados pelo pnpm 10.** Prisma, esbuild, sharp, msgpackr-extract e unrs-resolver declarados em `onlyBuiltDependencies`. Sem isso os engines do Prisma não são baixados e o `db:generate` falha.
- **Bind mount do scraper falhava no Docker Desktop.** `mkdir /run/desktop/mnt/host/f: file exists` — mount stale do backend WSL2, resolvido com `wsl --shutdown` e reinício do Docker Desktop.

#### Decisões registradas

- **Site precário vale +22 no score.** Domínio de construtor gratuito é oportunidade comercial, não "já tem site". Regra ausente do documento mestre.
- **Ausência de sinal é `DESCONHECIDO`.** Instagram, Facebook e WhatsApp não vêm do scraper; marcá-los como ausentes seria falso negativo em massa.
- **Lead duplicado não consome cota.** Reserva no início do job, liquidação no fim com o número real de leads novos. Job falho devolve a reserva.
- **`data/gmapsdata` em vez de `data/gmaps`.** A pasta já contém histórico real de coleta.
- **Disco do Docker permanece em C:.** A Fase 1 consome cerca de 300 MB; mover arrastaria os volumes do Bellvia junto.
- **Propostas, Contratos, Precificador e Avisos ficam fora da sidebar.** Modelados no schema, sem rota. Menu que só abre paywall é o defeito que este produto existe para evitar.

#### Isolamento

`F:\drmind` não foi modificado. Nenhum container, rede, volume, porta ou arquivo do Bellvia foi tocado.

---

## [0.1.0] — Fase 0 · 27/07/2026

### Adicionado
- Auditoria de ambiente com inventário do motor de coleta
- Confirmação do plano de portas sem colisão com o Bellvia
- Escopo recortado da v0.1.1: seis telas de núcleo, profundas
