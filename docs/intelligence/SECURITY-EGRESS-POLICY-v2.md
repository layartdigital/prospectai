# SECURITY — Egress Policy e Threat Model · v2

**Produto:** **PropectAI** — corrigido de "ProspectAI" na v1
**Data:** 22/08/2026 · **Prioridade:** P0, pré-requisito da Fase 1 da auditoria
**Substitui:** `SECURITY-EGRESS-POLICY.md` v1, cuja tabela de faixas foi furada por um review adversarial

**Declaração obrigatória:** `F:\drmind` não foi modificado. Nenhum recurso Docker foi tocado.

---

## 0. O que mudou da v1

A v1 acertou o princípio — *"bloqueio por resolução, não por string"* — e errou a tabela. Um reviewer em contexto limpo encontrou seis contornos. **A tabela é o contrato que será implementado; o que não está nela não é bloqueado.**

| Bypass | v1 | v2 |
|---|---|---|
| IPv6 ULA `fc00::/7` — inclui `fd00:ec2::254`, o IMDS da AWS por IPv6 | **Passava** | Bloqueado |
| IPv4-mapped `::ffff:127.0.0.1` | **Passava** se a checagem fosse por família | Normalizado antes de comparar |
| NAT64 `64:ff9b::a9fe:a9fe` e 6to4 `2002::/16` | **Passava** | Bloqueado |
| `http://postgres./` — ponto final de FQDN | **Passava** — era regra de string na seção que proíbe regras de string | Resolvido pela validação pós-DNS |
| Bomba de gzip: 2 MB → 40 GB | **Passava** — S6 verde e worker morto | Limite pós-descompressão |
| DNS rebinding sob a "opção 2" | **Passava** — cache não fecha TOCTOU | Opção 2 removida |

---

## 1. Por que este documento é pré-requisito

A Fase 1 da auditoria busca URL vinda de `Lead.website`, campo preenchido pelo que a empresa cadastrou no Google Maps.

**SSRF por desenho, não por descuido.** O ataque: cadastrar lead com `website = http://[fd00:ec2::254]/latest/meta-data/iam/security-credentials/`, clicar em auditar, e o worker busca o endpoint de metadados de dentro da rede.

O `scope-v0.2.md` §8 trata o risco com User-Agent identificável, timeout e `robots.txt`. Os três são boa cidadania de crawler e **nenhum protege a infraestrutura**.

---

## 2. Egress policy

### 2.1 Faixas bloqueadas — validação pós-resolução

**Normalizar antes de comparar.** IPv4-mapped e IPv4-compatible viram IPv4 e passam pela tabela IPv4. Sem essa etapa, `::ffff:7f00:1` escapa das duas tabelas.

**IPv4**

| Faixa | Motivo |
|---|---|
| `0.0.0.0/8` | Endereço não especificado |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | RFC1918 |
| `100.64.0.0/10` | CGNAT |
| `127.0.0.0/8` | Loopback |
| `169.254.0.0/16` | Link-local — **metadados de cloud** |
| `192.0.0.0/24`, `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` | Reservados e documentação |
| `198.18.0.0/15` | Benchmark |
| `224.0.0.0/4`, `240.0.0.0/4`, `255.255.255.255/32` | Multicast, reservado, broadcast |

**IPv6 — a lacuna que derrubava a v1**

| Faixa | Motivo |
|---|---|
| `::/128`, `::1/128` | Não especificado, loopback |
| **`fc00::/7`** | **ULA — equivalente IPv6 do RFC1918. Inclui `fd00:ec2::254`, o IMDS da AWS. Docker com IPv6 atribui `fd00::/8` aos containers** |
| `fe80::/10` | Link-local |
| `::ffff:0:0/96` | IPv4-mapped — normalizar e revalidar |
| `::/96` | IPv4-compatible, obsoleto |
| **`64:ff9b::/96`** | **NAT64 well-known — carrega IPv4 embutido** |
| **`2002::/16`** | **6to4 — idem** |
| `ff00::/8` | Multicast |

Rejeitar também literais com identificador de zona (`[fe80::1%25eth0]`).

### 2.2 Regras de resolução

1. **Validar todos os endereços retornados**, não o primeiro. Se a resolução devolver `[203.0.113.5, 127.0.0.1]`, rejeitar — o Happy Eyeballs do Node tenta os demais.
2. **Conectar ao IP validado**, passando o hostname só em `Host` e SNI. Elimina a janela TOCTOU do rebinding.
3. **Fail-closed** em NXDOMAIN, SERVFAIL ou timeout de DNS.

> A "opção 2" da v1 — cachear e revalidar — **foi removida**. Contra um autoritativo com TTL 0, o atacante ganha por construção. Só a conexão ao IP validado fecha.

### 2.3 Redirect

Nunca automático. A cada salto: revalidar **IP, scheme e porta**, resolver `Location` relativo, máximo 3 saltos, e limite de tempo total do job — 3 × 10s por lead multiplica rápido.

### 2.4 Limites de resposta

| Limite | Valor | Observação |
|---|---|---|
| Timeout por requisição | 10s | |
| Tempo total do job | 30s | Cobre a cadeia de redirect |
| **Tamanho comprimido** | 5 MB | Corte no fluxo |
| **Tamanho descomprimido** | 10 MB | **Corte após inflar** — 2 MB de gzip viram 40 GB sem isto |
| `Content-Encoding` aninhado | Rejeitar | |
| Schemes | `http`, `https` | Inclusive após redirect |
| Portas | 80, 443 | Testar isoladamente |

### 2.5 Isolamento de rede — corrigido

A v1 dizia *"o worker de coleta roda sem rota para a rede interna"*. **Isso é irrealizável:** um worker BullMQ sem rota não lê a fila nem grava resultado.

O desenho correto separa dois processos:

```text
┌─────────────────┐        ┌──────────────────────┐
│ worker (BullMQ) │──job──►│ fetcher              │
│ rota interna:   │        │ rota interna: NÃO    │
│ Postgres, Redis │◄─bytes─│ sem credencial de BD │
│ sem egress      │        │ egress apenas        │
└─────────────────┘        └──────────────────────┘
```

O fetcher recebe URL, devolve bytes e headers. Não tem DSN, não tem rota para 5434 nem 6381. **Com bug na validação, o ataque ainda falha** — a rota não existe.

As duas camadas coexistem: o código valida, a rede impede.

### 2.6 Rate limit de egress por tenant

Ausente na v1. Sem ele, 5.000 leads apontando para uma vítima transformam o produto em amplificador de DDoS — com User-Agent identificável, que a §8 do escopo pede justamente para a vítima poder identificar a origem.

### 2.7 Erro uniforme

A auditoria mede **TTFB por desenho**. Isso é um oráculo de temporização entregue como funcionalidade.

Mesmo com todas as faixas bloqueadas, a diferença entre "bloqueado", "NXDOMAIN", "recusado" e "timeout" mapeia a rede interna sem ler um byte. **Erro uniforme e tempo constante** para todo destino rejeitado. Blind SSRF entra no threat model.

---

## 3. PII e segredo: antes do snapshot, não depois

**Correção do defeito mais grave da v1.**

A v1 afirmava *"PII de terceiro nunca entra no banco"*, apoiada na regra 6 do `CLAUDE.md`. Mas o pipeline da v1 gravava o snapshot **antes** de normalizar, e o filtro estava na normalização.

```text
v1 (errado)   fetch → SNAPSHOT → validate → normalize(filtra PII) → persist
                        ▲ PII já no banco

v2 (correto)  fetch → sanitize → SNAPSHOT → validate → normalize → persist
                        ▲ filtro de ingestão
```

O sanitizador roda **entre o fetcher e qualquer gravação**, e remove:

- os campos da regra 6 — `user_reviews`, `user_reviews_extended`, `owner`
- **userinfo de URL** — `https://user:token@host/` nunca chega a `sourceReference`
- `Set-Cookie`, `Authorization`, `Proxy-Authorization` e headers fora da allowlist
- material com forma de credencial no corpo

**Allowlist de headers persistíveis**, não denylist: `content-type`, `content-length`, `location`, `strict-transport-security`, `server`, `x-powered-by`. O resto é descartado.

### 3.1 Quarentena passa pelo mesmo filtro

Falha da v1: a quarentena recebia o payload verbatim para preservar a forma não normalizada — **pulando o único lugar onde o filtro rodava**.

Como o `validate()` retorna `SCHEMA_DRIFT` a partir de conteúdo que o dono do site controla, o atacante escolhia o que depositar num store sem filtro, sem tenant e sem retenção.

**Na v2:** quarentena é tenant-aware, tem retenção definida, e recebe o payload **já sanitizado**. Guarda a forma estrutural, não o conteúdo bruto.

---

## 4. Threat model

### Alta — decorrem do que o produto faz

| # | Ameaça | Mitigação |
|---|---|---|
| T1 | SSRF | §2 inteira, com §2.5 como camada estrutural |
| T2 | Vazamento entre tenants | RLS no PostgreSQL — ver §5 |
| T3 | Exaustão por resposta grande | Limite pós-descompressão |
| T4 | Vazamento em export e no link público | §6 |
| T5 | Segredo em log, evidência ou snapshot | §3, no ingresso |
| **T6** | **Job forjado na fila** | Reautorizar após dequeue — ver abaixo |
| **T7** | **Prompt injection indireta** | **Existe IA hoje** — ver §7 |

**T6 era prioridade média na v1 e não tinha mitigação.** O pipeline autoriza antes de enfileirar e nunca depois. Quem escreve na fila executa como qualquer tenant, e o worker obedece porque o campo está lá — alcançável via SSRF ao Redis, que é o exemplo do §1.

**Correção:** reautorizar tenant e entitlement **após o dequeue**, e derivar o tenant de algo que o produtor da mensagem não controle.

### Avaliadas e não prioritárias

Container breakout, DNS tunneling, model exfiltration. Registrado como decisão consciente.

---

## 5. Isolamento de tenant — disciplina não basta

A v1 propunha *"teste de isolamento no CI"*. Um teste cobre os caminhos que alguém lembrou de escrever.

**Row-Level Security do PostgreSQL 16** é o mecanismo estrutural e não foi citado na v1. Alternativa mínima: extensão do Prisma Client que exija `tenantId` em toda query a modelo tenant-aware.

A diferença é entre invariante e disciplina. A v1 escolheu disciplina sem dizer que estava escolhendo.

**Pontos que a v1 não cobriu:**

- `RawSnapshot` com `contentHash`: se a dedup for global, Tenant A recebe o snapshot de B — e antes disso descobre **que B auditou aquele domínio**. Para agências concorrentes, o oráculo vale mais que o conteúdo. **Chave de dedup inclui tenant.**
- Unicidade de `fingerprint` e `placeId`: se global, conflito de inserção enumera a base de qualquer concorrente. **Escopo por tenant.**
- Junções `LeadTag` e `ProposalItem` não têm `tenantId`. O Postgres não impede escrita cruzada sem FK composta em `(tenantId, id)`.
- Chave de cache do Redis: requisito declarado, nunca testado.

---

## 6. Link público — fora de todo o modelo

`AuditReport` terá link público com validade. Nenhuma regra de tenant se aplica: a única proteção é a imprevisibilidade do identificador.

| Requisito | |
|---|---|
| Identificador | ≥128 bits de entropia criptográfica. **Não ULID** — ordenável e com prefixo temporal |
| Expiração | Verificada no acesso |
| Revogação | Ao remover o lead, encerrar o tenant, ou atender exclusão de titular |
| Indexação | `X-Robots-Tag: noindex` e `robots.txt` |
| Rate limit | Por token e por IP |

---

## 7. Correção: existe IA no produto hoje

A v1 dispensou prompt injection alegando *"não há IA no caminho"*. **Falso.**

`OutreachMessage` tem `prompt`, `content`, `provider`, `model`, `tokensEstimated`, `version`. `PlanUsage` conta `aiGenerationsCount`. O módulo `outreach` está entre os 17.

Há IA em produção gerando abordagem a partir de dados de lead — e a auditoria vai alimentar esses dados com conteúdo de um site que **o alvo controla**. Prompt injection indireta é vetor **atual**, não futuro.

`parecer-prompt-faro.md` §4 já aprovou as regras: proibir invenção de números, clientes, resultados, preços e garantias; gerar variações; exigir aprovação antes do envio; versionar o prompt e registrar a versão enviada. **Elas se aplicam ao conteúdo que a auditoria coletar.**

---

## 8. LGPD

| Item | Situação |
|---|---|
| Base legal — legítimo interesse com teste de proporcionalidade | Pendente |
| Registro de operações (art. 37) | Pendente |
| Encarregado designado (art. 41) | Pendente |
| Fluxo de exclusão de titular | Pendente |
| Retenção de `LeadSourceRecord.payload` | Indefinida |

**Conflito estrutural não registrado na v1:** `AuditLog` é append-only por desenho. Atender o art. 18 VI exigiria apagar dado de uma tabela que não permite exclusão. Precisa de decisão — redação de campo, pseudonimização, ou exceção documentada.

E `SOCIAL_LINK_DISCOVERY` contradiz a classe `PROHIBITED`: para clínica, advogado e MEI, o Instagram do site **é o perfil pessoal**, e a URL é persistida como evidência. Reclassificar.

---

## 9. Testes

| # | Teste | Fase |
|---|---|---|
| S1 | `http://127.0.0.1:5434` | F0 |
| S2 | `http://169.254.169.254/` | F0 |
| **S2b** | **`http://[fd00:ec2::254]/`** — IMDS por IPv6 | **F0** |
| **S2c** | **`http://[::ffff:127.0.0.1]/`** — mapped | **F0** |
| **S2d** | **`http://[64:ff9b::a9fe:a9fe]/`** — NAT64 | **F0** |
| S3 | Domínio público que resolve para IP privado | F0 |
| **S3b** | **Resposta DNS com um público e um privado** | **F0** |
| **S3c** | **Rebinding: TTL 0 respondendo diferente na 2ª consulta** | **F0** |
| S4 | Redirect de público para loopback | F0 |
| S5 | `http://postgres./` — FQDN com ponto final | F0 |
| S6 | 50 MB não comprimidos | F0 |
| **S6b** | **2 MB de gzip que inflam para 40 GB** | **F0** |
| S7 | `file:///etc/passwd`, `gopher://`, `dict://` | F0 |
| **S7b** | **Porta isolada: `http://publico:6381/`** | **F0** |
| **S10** | **Isolamento de rede: fetcher não alcança 5434 nem 6381** | **F0** |
| **S11** | **Erro e tempo uniformes entre bloqueado, NXDOMAIN e recusado** | **F0** |
| S8 | Tenant A lê auditoria de B | F0 |
| S9 | Export de A com filtro de B | F0 |
| **S12** | **Job forjado na fila com tenant de outro** | **F0** |
| **S13** | **Dedup de snapshot por hash entre tenants** | **F0** |
| **S14** | **Sanitizador remove PII antes do snapshot** | **F0** |
| **S15** | **Userinfo de URL não chega a `sourceReference`** | **F0** |

**As 22 são de F0**, não cinco. A v1 agendava só S1–S5 e deixava vazamento entre tenants sem fase.

Nota de método: se S3 e S3c rodarem contra resolver mockado, passam trivialmente. Precisam da configuração de rede real do container.

---

## 10. Resumo

A v1 tinha o princípio certo e a execução furada. A v2 corrige seis contornos, move o filtro de PII para o ingresso, separa o processo de fetch do worker, troca disciplina por RLS, e reconhece que existe IA em produção.

**O item de maior retorno é o §2.5** — a separação de processos. É o único controle que sobrevive a um bug na tabela de faixas.
