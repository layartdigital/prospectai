# SECURITY — Egress Policy e Threat Model

**Data:** 22/08/2026 · **Fase:** Prompt 01, STEP 12
**Prioridade:** **P0 — bloqueante da Fase 1 da v0.2**

---

## 1. Por que este documento vem antes do resto

O `scope-v0.2.md` §9 define a Fase 1 como *"verificador de site — DNS, HTTP, HTTPS, redirect, viewport, TTFB, meta"*.

Esse verificador **busca uma URL vinda de dado de entrada**. O campo `Lead.website` é preenchido por um scraper que lê o Google Maps, que por sua vez lê o que a empresa cadastrou.

**Isso é SSRF por desenho, não por descuido.**

O `scope-v0.2.md` §8 trata o risco como etiqueta — User-Agent identificável, timeout curto, respeito a `robots.txt`. Isso é boa cidadania de crawler, e não protege sua infraestrutura. Nenhum dos três impede que a requisição vá para dentro da sua rede.

### O ataque, concretamente

1. Atacante cria conta trial e cadastra um lead com `website = http://169.254.169.254/latest/meta-data/iam/security-credentials/`
2. Clica em "Auditar presença digital"
3. Seu worker faz a requisição **de dentro da sua infraestrutura**
4. O endpoint de metadados da cloud responde com credenciais
5. O resultado é persistido como evidência e devolvido no relatório

Variantes que contornam validação ingênua de URL: `http://localhost:5434` (seu Postgres), `http://127.0.0.1:6381` (seu Redis), `http://propectai-postgres:5432` (DNS interno do Docker), redirect de domínio público para IP privado, e DNS rebinding.

**Um bloqueio por lista de strings não impede nenhuma dessas.**

---

## 2. Egress policy — requisitos

Aplica-se a **todo** componente que busca URL externa: verificador de site, futuros crawlers, qualquer adapter.

### 2.1 Bloqueio por resolução, não por string

A validação acontece **depois** de resolver o DNS e **antes** de conectar. Validar o texto da URL é insuficiente, porque `evil.com` pode resolver para `127.0.0.1`.

Faixas bloqueadas por padrão:

| Faixa | Motivo |
|---|---|
| `127.0.0.0/8`, `::1` | Loopback — alcança serviços locais |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | RFC1918 — rede interna |
| `169.254.0.0/16`, `fe80::/10` | Link-local — **inclui metadados de cloud** |
| `0.0.0.0/8`, `::` | Endereço não especificado |
| `100.64.0.0/10` | CGNAT |
| `224.0.0.0/4` | Multicast |
| Nomes sem ponto (`postgres`, `redis`) | DNS interno do Docker |

### 2.2 Redirect: revalidar a cada salto

Redirect não pode ser seguido automaticamente pela biblioteca HTTP. Cada salto passa pela mesma validação, com limite de saltos.

```
redirect: 'manual'  →  validar destino  →  seguir  →  repetir
máximo: 3 saltos
```

Um domínio público que redireciona para `127.0.0.1` é o contorno mais comum, e é exatamente o que `scope-v0.2.md` §3.1 já quer detectar como sinal (*"redirect para domínio alheio costuma ser domínio vendido"*) — a mesma checagem serve aos dois propósitos.

### 2.3 DNS rebinding

Entre a validação e a conexão, o DNS pode responder diferente. Duas defesas, em ordem de robustez:

1. **Conectar ao IP validado**, passando o hostname apenas no header `Host` e no SNI — elimina a janela
2. Se a stack não permitir, cachear a resolução por curto período e revalidar

### 2.4 Limites de resposta

| Limite | Valor sugerido | Motivo |
|---|---|---|
| Timeout total | 10s | Site lento é sinal, não motivo para prender worker |
| Tamanho máximo | 5 MB | Evita exaustão de memória; a home basta para a auditoria |
| Schemes | apenas `http`, `https` | Bloqueia `file://`, `gopher://`, `ftp://` |
| Portas | 80, 443 | Bloqueia varredura de porta interna |

**O limite de tamanho é por streaming, com corte** — não por header `Content-Length`, que o servidor controla e pode mentir.

### 2.5 Onde aplicar

**Isolamento de rede é mais confiável que validação em código.** A validação pode ter bug; a rota inexistente, não.

Se o worker que faz a coleta rodar em rede Docker sem rota para a rede interna, o ataque falha mesmo com bug na validação. **As duas camadas devem coexistir** — o código valida, a rede impede.

Isso vale também para qualquer runtime de terceiro que venha a ser adotado.

---

## 3. Threat model proporcional

Modelando o que **este** produto faz, não um catálogo genérico.

### Prioridade alta — decorrem do que o produto é

| # | Ameaça | Vetor | Mitigação |
|---|---|---|---|
| T1 | **SSRF** | URL de entrada no verificador | §2 inteira |
| T2 | **Vazamento entre tenants** | Query sem filtro, ID enumerável | Teste de isolamento no CI |
| T3 | **Exaustão por resposta grande** | Site com resposta de centenas de MB | Limite por streaming |
| T4 | **Vazamento em export** | Export sem filtro de tenant | Mesmo caminho de leitura |
| T5 | **Segredo em log ou evidência** | Payload persistido com header | Filtro na normalização |

### Prioridade média

| # | Ameaça | Situação |
|---|---|---|
| T6 | Bypass de quota | Entitlement checado só na UI |
| T7 | Poisoning de fila | Job forjado sem tenant |
| T8 | HTML malicioso | Parse de HTML de terceiro — usar parser que não executa script |

### Avaliadas e não prioritárias

Container breakout, DNS tunneling, model exfiltration, prompt injection. **Registrado como decisão consciente**, não omissão: não há IA no caminho e não há execução de código de terceiro.

Prompt injection volta a ser relevante no dia em que houver IA lendo conteúdo coletado — e aí é indireta por desenho, porque a empresa-alvo controla o próprio site.

---

## 4. Privacidade

A maior parte já está decidida e implementada. Este documento registra e eleva a regra de arquitetura.

### O que já protege

`CLAUDE.md` regra 6 descarta `user_reviews`, `user_reviews_extended` e `owner` — nome, foto e URL de pessoa física — **na normalização, antes de gravar**. PII de terceiro nunca entra no banco.

Isso resolve boa parte do §19 do Prompt 01 antes de ele ser escrito, e é um ponto forte que deve virar teste, não permanecer como convenção.

### Classificação de capabilities

| Classe | Capabilities |
|---|---|
| `ALLOWED_DEFAULT` | Dados cadastrais públicos, site, tecnologia, avaliações agregadas |
| `ALLOWED_WITH_RESTRICTIONS` | Contato corporativo — e-mail e telefone da empresa |
| `ADMIN_ONLY` | — nenhuma hoje |
| `DISABLED_BY_DEFAULT` | — nenhuma hoje |
| `PROHIBITED` | Breach lookup, credencial vazada, telefone pessoal, perfil pessoal, geolocalização de pessoa, avaliação individual identificável |

**Toda capability nova recebe classificação antes de ser implementada.** Sem classificação, não entra no registry.

### LGPD — o que falta

| Item | Situação |
|---|---|
| Base legal para contato corporativo | **Pendente** — legítimo interesse exige teste de proporcionalidade registrado |
| Registro de operações (art. 37) | **Pendente** |
| Encarregado designado (art. 41) | **Pendente** — sendo uma pessoa, é ela mesma, com contato publicado |
| Fluxo de exclusão de titular | **Pendente** — prazo legal, não os 48h de marketing |
| Retenção de `LeadSourceRecord.payload` | **Pendente** — hoje indefinida |

Nenhum é bloqueante da Fase 1, mas todos são anteriores ao lançamento comercial da v0.2 — o relatório é entregue a terceiros e afirma coisas sobre o negócio deles.

---

## 5. Testes obrigatórios

Sem estes, a afirmação de segurança não se sustenta.

| # | Teste | Falha esperada |
|---|---|---|
| S1 | URL `http://127.0.0.1:5434` | Bloqueado antes de conectar |
| S2 | URL `http://169.254.169.254/` | Bloqueado |
| S3 | Domínio público que resolve para IP privado | Bloqueado após resolução |
| S4 | Redirect de público para `localhost` | Bloqueado no salto |
| S5 | Hostname sem ponto (`postgres`) | Bloqueado |
| S6 | Resposta de 50 MB | Cortada no limite |
| S7 | `file:///etc/passwd` | Scheme rejeitado |
| S8 | Tenant A lê auditoria de Tenant B | Negado |
| S9 | Export de A com filtro de B | Negado |

**S1 a S5 devem existir antes da primeira linha do verificador.** São o gate de segurança da Fase 1.

---

## 6. Resumo executivo

Um item bloqueia a v0.2 e não estava no escopo dela:

> **Egress policy com validação pós-resolução de DNS, revalidação a cada redirect, limite de resposta por streaming e isolamento de rede do worker de coleta.**

Custa pouco — é uma função de validação e uma configuração de rede — e sem ela a primeira funcionalidade da v0.2 é um proxy aberto para dentro da sua infraestrutura, acionável por qualquer usuário trial.
