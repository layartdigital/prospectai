# ADR-004 — Processo de fetch isolado

**Status:** **Accepted em duas partes** — a de agora é decidível; a de produção fica registrada e adiada · 22/08/2026
**Origem:** `SECURITY-EGRESS-POLICY-v2.md` §2.5 · `PROVIDER-CONTRACT-v5.md` §10
**Bloqueia:** nada. **Bloqueava F0 até 22/08**, e a seção "Produção não existe" explica por que deixou de bloquear

**Declaração obrigatória (`CLAUDE.md`, Qualidade):** `F:\drmind` não foi modificado. Nenhum recurso Docker foi tocado. Nenhuma alteração fora de `docs/`.

---

## Por que este ADR existe

O `00-REGRAS-COMUNS.md` §2 fixa o teto de **4 serviços em execução contínua** e diz como estourá-lo: *"ADR com justificativa de custo/hora"*.

Serviços hoje: `apps/web`, `apps/api`, `apps/worker` e o container `gosom/google-maps-scraper`. **São quatro — o teto.** Um processo de fetch separado é o quinto.

> O ADR não quebra a regra. É o mecanismo previsto por ela.

---

## Contexto

A Fase 1 da auditoria busca a URL de `Lead.website` — campo preenchido com **o que a empresa cadastrou no Google Maps**, ou seja, string controlada por terceiro.

**É SSRF por desenho, não por descuido.** O ataque: cadastrar um lead com

```text
website = http://[fd00:ec2::254]/latest/meta-data/iam/security-credentials/
```

clicar em *Auditar presença digital*, e o worker busca o endpoint **de dentro da rede**.

O `scope-v0.2.md` §8 trata o risco com User-Agent identificável, timeout e `robots.txt`. Os três são boa cidadania de crawler e **nenhum protege a infraestrutura**.

---

## Correção de fato: a egress policy v2 nomeia as portas erradas

`CURRENT / CONFIRMED` — `docker-compose.yml:29,56,121-123`.

A `SECURITY-EGRESS-POLICY-v2.md` §2.5, **já entregue e commitada**, diz que o fetcher não pode ter rota para **5434 e 6381**. Essas são as portas **do host**, e só existem porque 5432 e 6379 pertencem ao Bellvia:

```yaml
ports: ["127.0.0.1:${POSTGRES_PORT:-5434}:5432"]
ports: ["127.0.0.1:${REDIS_PORT:-6381}:6379"]
```

**Dentro da rede Docker, o worker fala com `postgres:5432`, `redis:6379` e `gmaps-scraper:8080`** (`docker-compose.yml:121-123`). Um teste que verifique só 5434 e 6381 **passa verde enquanto o fetcher alcança o banco pelo nome do serviço**.

É o mesmo modo de falha que este repositório já documentou uma vez, no comentário do scraper:

> *"Se o wget existisse, o teste passaria pelo motivo errado — o pior dos dois mundos, porque aprovaria sem nunca ter verificado nada. Healthcheck que grita falso ensina o time a ignorar o sinal."*

**Erratum E4 para a egress policy:** o alvo do isolamento são os nomes de serviço na `propectai-network`, não as portas do host. As portas do host importam apenas no modo de desenvolvimento — ver a seção seguinte, que é pior.

---

## O achado que muda o desenho: em desenvolvimento não há isolamento nenhum

`CURRENT / CONFIRMED` — `docker-compose.yml:9-11,113,136,158`.

O compose declara, no cabeçalho:

> *"Modo híbrido de desenvolvimento: este compose sobe apenas Postgres, Redis e o scraper. Web, API e worker rodam local com `pnpm dev` para ter hot reload. Os serviços de aplicação existem sob o profile `full` para produção."*

E confirma em cada um: `api`, `worker` e `web` têm `profiles: ["full"]`.

**Consequência:** no dia a dia o worker é um processo no Windows, com acesso irrestrito a `127.0.0.1:5434` e `127.0.0.1:6381`. Um fetcher que rode junto dele, em `pnpm dev`, **não tem isolamento algum** — não há rede para separar, porque não há container.

Isso não invalida o ADR. Reposiciona o que ele entrega:

| Ambiente | O que protege |
|---|---|
| **Produção** (`--profile full`) | Isolamento de rede **e** validação em código. Duas camadas |
| **Desenvolvimento** (`pnpm dev`) | **Só validação em código.** A camada estrutural não existe |

**E é em desenvolvimento que a Fase 1 vai ser escrita e testada.** Um teste de isolamento que rode em `pnpm dev` passa por ausência de rede, não por presença de controle — exatamente o healthcheck que grita falso.

**Portanto o teste S10 só é válido sob `--profile full`**, e precisa **falhar explicitamente** se rodar fora dele, em vez de passar. Isso vai para o critério de pronto de F0.

---

## Produção não existe — e é por isso que este ADR não bloqueia F0

`CURRENT / CONFIRMED` — verificado em 22/08/2026.

O `docker-compose.yml` põe `api`, `worker` e `web` sob `profiles: ["full"]`, e cada um aponta para um Dockerfile:

```yaml
build:
  context: .
  dockerfile: infra/docker/api.Dockerfile
```

**A pasta `infra/docker/` não existe.** O conteúdo inteiro de `infra/` é:

```text
infra/
└── scripts/
    └── audit-ambiente.ps1
```

`docker compose --profile full up` falha na largada, em qualquer um dos três. E `docker compose ps` confirma o que roda de fato: `propectai-postgres`, `propectai-redis` e `propectai-gmaps-scraper` — três containers, com a aplicação em `pnpm dev` no host.

**Consequências, e são grandes:**

1. **As perguntas 3 e 4 do §2 não têm resposta hoje.** R$/mês e horas/mês de um quinto serviço em produção não podem ser medidos nem estimados quando não há produção, não há decisão de hospedagem, e não há sequer imagem para subir. Preencher com número inventado seria exatamente o defeito que o `PROMPT-01-EXECUTION-REPORT.md` §7 identificou como raiz de tudo neste programa
2. **O teto de 4 serviços não está sob pressão.** Ele conta *"serviços em execução contínua em produção"*. Em produção não há nenhum
3. **Bloquear F0 nestes números seria bloquear em algo inexistente.** Foi o que a versão anterior deste ADR fez

### O que continua sendo decisão de agora

A escolha entre fetcher isolado e validação em código **não é só de deploy: é de forma do código.** Se a busca da URL nascer dentro do worker, sem fronteira de processo, transformá-la depois é refatoração no caminho crítico. Se nascer atrás de um contrato, virar processo separado é um bloco no compose.

**A decisão barata é construir a costura agora e adiar o serviço.** É o que a pergunta 6 do §2 pede — *"adiar é aceitável"* — com a condição que a torna verdadeira.

---

## As seis perguntas do §2

### 1. Qual problema real, já observado, ela resolve?

`CURRENT / CONFIRMED` — em dois níveis:

**(a) A entrada existe e é de terceiro.** `RawLead.website` é `string | null` sem validação de destino (`packages/types/src/lead-source.ts:68`), e alimenta `Lead.website`.

**(b) Acertar a tabela de faixas na primeira tentativa não é realista, e há medida disso.** A `SECURITY-EGRESS-POLICY.md` v1 foi escrita com cuidado, e um único reviewer em contexto limpo encontrou **seis contornos**: IPv6 ULA `fc00::/7` (que contém o IMDS da AWS), IPv4-mapped, NAT64, 6to4, FQDN com ponto final, e bomba de gzip.

E este ADR acabou de encontrar um sétimo na v2 — as portas erradas. **Sete erros em duas revisões de uma tabela é a evidência de que a tabela não é o controle; é a primeira camada.**

O processo isolado é o que continua valendo **depois** de um erro nela. Código valida; rede impede.

### 2. Por que a stack atual não resolve?

Porque o worker precisa das duas coisas ao mesmo tempo, e elas são incompatíveis:

| Precisa de | Para |
|---|---|
| Rota para `postgres:5432` e `redis:6379` | Ler a fila BullMQ e gravar resultado |
| Egress para a internet | Buscar a URL do lead |

A v1 da egress policy dizia *"o worker de coleta roda sem rota para a rede interna"*. **Irrealizável:** um worker BullMQ sem rota não lê a fila nem grava. Foi requisito escrito sem verificar se podia existir.

E há um segundo motivo, específico deste compose: **só existe uma rede.**

```yaml
networks:
  propectai-network:
    name: propectai-network
    driver: bridge
```

Todos os cinco serviços a habitam. Não há hoje nenhuma fronteira de rede dentro do produto — o isolamento precisa ser **criado**, não configurado.

### 3. Qual o custo em R$/mês?

**Da parte de agora: R$ 0,00.** A costura no código não sobe serviço nenhum. `FETCHER_MODE=inline` é o padrão, e o worker continua sendo o único processo.

**Da parte de produção: `UNKNOWN`, e é a resposta correta.** Não existe produção, hospedagem escolhida, nem imagem construída. O que dá para dizer sobre a *forma* do custo, para quando a pergunta for respondível:

- A **opção D** reutiliza a imagem do worker. Sem build novo, registry novo ou pipeline novo — um bloco no compose com outro `command`
- O processo é I/O-bound e fica ocioso entre auditorias. Não é CPU nem memória relevantes
- Em VPS com recursos já pagos, o custo marginal tende a zero; com cobrança por container, é o menor plano disponível

**Quando responder:** junto da decisão de hospedagem, que é o mesmo momento em que os três Dockerfiles precisam existir.

### 4. Quantas horas/mês de manutenção?

**Da parte de agora: zero.** Uma fábrica a mais no worker, no mesmo padrão de `createLeadSourceProvider()`.

**Da parte de produção: `UNKNOWN`.** O que compõe, para a estimativa futura:

| Item | Peso |
|---|---|
| Atualização de dependência e imagem base | Zero na opção D — é a mesma imagem do worker |
| Verificar que a separação de redes continua valendo a cada mudança no compose | Baixo, se S10 estiver no CI |
| **Diagnóstico quando uma auditoria falha e não se sabe se foi rede, alvo ou bug** | **É o custo real** |
| A divergência dev/prod: comportamento que só aparece sob `--profile full` | Recorrente, e é o custo que o modo híbrido cria |

O parâmetro mais próximo, quando houver produção, é **o tempo gasto com o container do scraper** — também um processo separado que faz uma coisa só.

### 5. Qual a estratégia de saída se der errado?

O fetcher é serviço sem estado. A saída é substituir a chamada por implementação local no worker — **uma fábrica, exatamente como `LEAD_SOURCE_PROVIDER` já faz** (`apps/worker/src/providers/index.ts:8`):

```text
FETCHER_MODE=remote   → chama o processo isolado
FETCHER_MODE=inline   → busca dentro do worker, só com validação em código
```

Reverter é mudar variável de ambiente e derrubar um container. **Nenhuma migration, nenhum dado a migrar.**

E `inline` **é o modo de desenvolvimento de qualquer forma** — o que tem uma vantagem inesperada: o caminho de saída é exercitado todos os dias, em vez de ser um plano que ninguém nunca rodou.

O que se perde ao reverter em produção é a camada estrutural. `FETCHER_MODE=inline` **é a opção B**, com o risco dela, e precisa aparecer no runbook como **desativação de controle de segurança** — não como opção de configuração.

### 6. O que acontece se **não** adotarmos e simplesmente adiarmos?

A resposta padrão esperada pelo §2 é *"adiar é aceitável"*. **Aqui é aceitável com uma condição, e a condição é o ponto mais importante deste ADR:**

> **Adiar o fetcher é aceitável se, e somente se, adiar a Fase 1 junto.**

O fetcher não tem valor próprio. Existe unicamente porque a auditoria busca URL controlada por terceiro. Sem auditoria, não há entrada hostil, e a resposta correta é um `NÃO` limpo.

Com auditoria, adiar não é adiar: é **escolher a opção B e assumir o risco em silêncio** — o modo de falha que o `PROMPT-01-EXECUTION-REPORT.md` §7 identificou como raiz de tudo neste programa.

**Logo a pergunta 6 não é "fetcher sim ou não". É "Fase 1 sim ou não".** Se a Fase 1 vai acontecer, o custo do fetcher é custo dela e entra na conta dela.

---

## Alternativas consideradas

| Opção | Serviços | Custo | Risco residual |
|---|---|---|---|
| **A** — fetcher com imagem própria | 5 | Build, registry, pipeline e deploy próprios | Nenhum em produção |
| **B** — só validação em código | 4 | Zero | **Um erro na tabela dá acesso a `postgres:5432` e `redis:6379`.** Sete erros encontrados em duas revisões |
| **C** — embutir no container do scraper | 4 | — | **Inviável:** `CLAUDE.md` regra 3 — *"Não modificar o código do clone"* |
| **D** — **mesma imagem do worker, segundo serviço no compose**, em rede própria | 5 | Um bloco no compose e uma rede nova | Nenhum em produção. **Nenhuma proteção em desenvolvimento** |

### Por que D, e como ela fica de fato

`CURRENT / CONFIRMED` contra o `docker-compose.yml` real.

A contagem vai a cinco nas duas. O §2 pede justificativa **de custo/hora**, e é aí que diferem: A acrescenta artefato de build, registry, pipeline de release e um conjunto separado de logs. D acrescenta um bloco e uma rede.

```yaml
# esboço, sobre a estrutura real do compose
networks:
  propectai-network:          # existente
    name: propectai-network
    driver: bridge
  propectai-egress:           # NOVA — só fetcher e worker
    name: propectai-egress
    driver: bridge

services:
  fetcher:
    profiles: ["full"]
    build:
      context: .
      dockerfile: infra/docker/worker.Dockerfile   # a MESMA do worker
    container_name: propectai-fetcher
    restart: unless-stopped
    command: node dist/fetcher.js
    environment:
      NODE_ENV: production
      FETCHER_PORT: 3102
    networks:
      - propectai-egress      # e NÃO propectai-network
    # sem DATABASE_URL, sem REDIS_URL, sem SCRAPER_BASE_URL
    # sem depends_on de postgres ou redis — não precisa, e não pode alcançar

  worker:
    networks:
      - propectai-network     # postgres, redis, scraper
      - propectai-egress      # fala com o fetcher
    environment:
      FETCHER_URL: http://fetcher:3102
      FETCHER_MODE: remote
```

**Três coisas fazem o controle, e as três são ausências:** o fetcher não tem `DATABASE_URL`, não tem `REDIS_URL`, e não está em `propectai-network`. Sem a última, `postgres` e `redis` **nem resolvem como nome** de dentro dele.

O worker habita as duas redes. Isso é seguro: o problema nunca foi o worker ter egress — foi **quem busca a URL hostil** ter credencial de banco.

Prefixo `propectai-` em container e rede, pela regra 1 do `CLAUDE.md`.

**O que este esboço ainda não resolve, e precisa ser decidido em F0:** `propectai-network` é um bridge comum, então `postgres`, `redis` e o scraper **têm saída para a internet hoje**. Marcá-la `internal: true` fecharia isso — mas o scraper a habita e precisa de internet para funcionar. Separar o scraper para a rede de egress é a saída provável, e não é escopo deste ADR.

---

## Decisão

Em duas partes, porque as duas perguntas têm prazos diferentes.

### Parte 1 — agora, e é `Accepted`

**A busca da URL nasce atrás de um contrato, com fronteira de processo prevista e `FETCHER_MODE=inline` como padrão.**

- Custo: **R$ 0,00** e **zero hora/mês**
- Serviços em produção: **continua em 4** — nenhum sobe
- O worker faz a requisição, com a egress policy aplicada em código
- Nenhuma chamada de rede fora do módulo do fetcher, verificável por revisão

Não precisa de aprovação de orçamento porque não gasta orçamento. **F0 está liberada.**

### Parte 2 — quando produção existir, e fica `Deferred`

**Subir o fetcher como quinto serviço, opção D.**

Condicionada a:

1. Os três Dockerfiles de `infra/docker/` existirem
2. Hospedagem escolhida — é o que torna as perguntas 3 e 4 respondíveis
3. As respostas de 3, 4 e 5 preenchidas com número real

**Gate obrigatório:** este item é **pré-requisito do primeiro deploy de produção**, não de F0. Enquanto só houver desenvolvimento, `inline` é adequado: não há infraestrutura a proteger. No dia em que houver, `FETCHER_MODE=inline` em produção passa a ser um risco aceito conscientemente — e precisa estar no checklist de deploy, não descoberto depois.

---

## Consequências

**Positivas**

- Em produção, o único controle que sobrevive a um erro na tabela de faixas. Código valida, rede impede
- Torna o requisito de isolamento **implementável**, ao contrário do que a v1 da egress policy escreveu
- Reversível por variável de ambiente, e o caminho de reversão é exercitado todo dia em desenvolvimento
- Custo marginal de manutenção baixo por compartilhar imagem e pipeline com o worker

**Negativas**

- Quinto serviço: um lugar a mais para procurar quando algo falha
- **A proteção não existe em desenvolvimento**, e é lá que a Fase 1 será escrita. A validação em código continua sendo a única camada durante todo o desenvolvimento
- Comportamento que diverge entre `pnpm dev` e `--profile full` — a classe de bug mais cara de diagnosticar
- O teto de serviços passa a estar estourado, e o próximo componente encontra a régua no limite. **Isso é o §2 funcionando**, não efeito colateral
- `FETCHER_MODE` é um caminho de configuração que desliga a proteção. Vai no runbook, não só no código

---

## Gatilhos de revisão

1. A Fase 1 for cancelada ou adiada indefinidamente — sem entrada hostil, o serviço perde a razão
2. O custo medido exceder o definido na pergunta 3
3. A manutenção exceder o definido na pergunta 4
4. O modo híbrido de desenvolvimento acabar — se `--profile full` virar o padrão de dev, a divergência some e a decisão fica mais barata
5. Surgir mecanismo de isolamento que não custe um serviço

---

## Verificação

| # | Teste | Critério |
|---|---|---|
| **S10a** | De dentro do fetcher, `postgres`, `redis` e `gmaps-scraper` **não resolvem como nome** | F0 |
| **S10b** | De dentro do fetcher, conexão a `postgres:5432` e `redis:6379` falha | F0 |
| **S10c** | **O teste falha, e não passa, se rodar fora de `--profile full`** | F0 — sem isto, S10 é o healthcheck que grita falso |
| — | O bloco do fetcher não tem `DATABASE_URL` nem `REDIS_URL` | Revisão de compose |
| — | Nenhum recurso do PropectAI fora do prefixo `propectai-` | Regra 1 |
| — | `FETCHER_MODE=inline` documentado no runbook como **desativação de controle de segurança** | F0 |

---

## Errata que este ADR gera

| # | Documento | Correção |
|---|---|---|
| **E4** | `SECURITY-EGRESS-POLICY-v2.md` §2.5 e teste S10 | O alvo do isolamento é `postgres:5432` / `redis:6379` **por nome de serviço**, não 5434/6381, que são portas do host |
| **E5** | `SECURITY-EGRESS-POLICY-v2.md` §2.5 | Acrescentar que **o isolamento não existe em `pnpm dev`**, e que os testes de rede só são válidos sob `--profile full` |
| **E6** | `SECURITY-EGRESS-POLICY-v2.md` §9, testes S10 e S11 | **Saem de F0.** Dependem de `--profile full`, que não pode rodar: `infra/docker/` não existe. Vão para o checklist do primeiro deploy. F0 fica com 20 testes, todos executáveis hoje |

---

## Anexo — o que preencher, e quando

**Nada aqui bloqueia F0.** Estas perguntas pertencem ao primeiro deploy de produção, e ficam registradas para não serem descobertas naquele dia.

```text
Preencher junto da decisão de hospedagem:

3. Custo em R$/mês:            ______
4. Horas/mês de manutenção:    ______
5. Condição de reversão:       ______________________________________
```

**A única pergunta de agora, e ela não é sobre o fetcher:**

```text
6. A Fase 1 da auditoria vai acontecer?
   ( ) sim → a Parte 1 é construída junto com ela, a custo zero
   ( ) não → não há entrada hostil, e este ADR inteiro é desnecessário
```

Se a resposta for "não", o valor deste documento não é o fetcher: são as duas erratas da seção anterior, que valem independentemente.
