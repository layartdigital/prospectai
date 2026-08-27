# THIRD PARTY — Flowsint

**Data:** 22/08/2026 · **Fase:** Prompt 01, STEP 4 · atende §36
**Método:** verificação direta do repositório público

---

## 1. Correção de premissa do Prompt 01

O §3 do Prompt 01 afirma:

> *"o repositório público do Flowsint apresenta a release **v1.2.11** como release mais recente, publicada em **01/07/2026**."*

**Verificação em 22/08/2026:**

| Item | Afirmado no prompt | Verificado |
|---|---|---|
| Release mais recente | v1.2.11 | **v1.2.10** |
| Data | 01/07/2026 | **05/06/2024** |
| Existe v1.2.11? | pressuposto | **Não** |

As dez releases listadas vão de v1.2.1 a v1.2.10, todas datadas de **janeiro a junho de 2024**.

O próprio §3 antecipa a possibilidade e instrui: *"NÃO considere a documentação pública isoladamente como fonte absoluta de verdade."* A regra se aplica ao próprio prompt.

---

## 2. Referência pinada

| Campo | Valor |
|---|---|
| Repository URL | `https://github.com/reconurge/flowsint` |
| Release escolhida | **v1.2.10** — a mais recente que existe |
| Data da release | 05/06/2024 |
| Commit SHA | `PENDENTE` — exige `git ls-remote`, não executável neste ambiente |
| Branch default | `main` — 875 commits |

**Ação requerida antes de qualquer integração:**

```bash
git ls-remote --tags https://github.com/reconurge/flowsint v1.2.10
```

O §3.6 proíbe desenvolver contra `main` flutuante sem decisão registrada. A tag v1.2.10 é o alvo de pinning proposto.

---

## 3. Licença

| Campo | Valor |
|---|---|
| Licença | **Apache License 2.0** |
| Copyright | `Copyright 2025-2026 Reconurge` |
| Uso comercial | **Permitido** |
| Copyleft | Não |

### 3.1 Obrigações se houver adoção

| Obrigação | Quando se aplica |
|---|---|
| Manter aviso de copyright e cópia da licença | Qualquer redistribuição de código-fonte ou binário |
| Preservar arquivo `NOTICE`, se existir | Redistribuição |
| **Declarar modificações** nos arquivos alterados | Se o código for alterado |
| Não usar marcas do licenciante | Sempre |

### 3.2 Distinção que muda tudo

**Operar como serviço (SaaS) não é redistribuição.** Rodar o Flowsint em container próprio, sem entregar o software ao cliente, **não aciona as obrigações de redistribuição** — diferente do que ocorreria sob AGPL.

Isso torna a licença um **não-problema** para o modelo do ProspectAI, desde que o código não seja distribuído.

### 3.3 Pendências jurídicas

- **Licenças das dependências não auditadas.** Uma dependência GPL/AGPL dentro de um projeto Apache pode contaminar conforme a forma de integração. Exige varredura antes da adoção.
- Confirmar se existe `NOTICE` na tag v1.2.10.
- Ler `ETHICS.md`, que não é licença mas declara intenção de uso do autor.

Nada aqui é parecer jurídico. Os itens acima são para validação profissional se houver decisão de adotar.

---

## 4. Maturidade declarada pelo próprio projeto

| Sinal | Valor |
|---|---|
| Stars | 7.5k |
| Forks | 944 |
| Commits | 875 |
| Última release | 05/06/2024 — **há mais de 2 anos** |
| Status no README | *"in early development"* |
| Testes | *"test suites across modules are incomplete"* |

**Leitura:** popularidade alta e maturidade auto-declarada baixa. O autor pede ajuda da comunidade e admite cobertura de testes incompleta.

O intervalo entre a última release e hoje é o dado mais relevante para o risco de upstream. Há commits em `main` posteriores — o `LICENSE` traz copyright 2025-2026 —, mas **nenhuma release cortada em mais de dois anos** significa que não existe versão estável recente para pinar.

---

## 5. Capacidades e aderência

`HYPOTHESIS / REQUIRES VALIDATION` — baseado em documentação pública, não em leitura do código da tag

O Flowsint é uma plataforma de **investigação OSINT baseada em grafo**, para analistas de segurança, jornalistas e pesquisadores. Conceitos: Types, Tools, Enrichers, Flows, Entities, Relationships, nós e arestas, confidence. Stack: FastAPI, Celery, Neo4j, PostgreSQL, Redis.

Cruzando com as capabilities que o ProspectAI precisa (Prompt 02 §8):

| Capability do ProspectAI | Flowsint atende? | Observação |
|---|---|---|
| Maps Discovery | Não | Já resolvido pelo `gosom/google-maps-scraper` |
| Website Health Audit | Não | É o escopo da v0.2, nativo |
| Tech Stack Intelligence | Parcial | BuiltWith e Wappalyzer resolvem melhor e mais barato |
| Review Mining | Não | Scraper atual já traz avaliações |
| Social Intelligence | Parcial | **Bloqueado por login wall — medido no Gate 0** |
| Company 360 / Decision Maker | Parcial | Sobreposição com dados pessoais — ver §6 |
| Email Finder / Verification | Sim | Mas é dado de pessoa física |
| Ads Intelligence | Não | Sem fonte legítima no Brasil |
| Hiring / Funding Signals | Não | Providers especializados |

---

## 6. O conflito central

Este é o achado que o ADR-002 precisa enfrentar.

O Flowsint é forte justamente em **investigação de pessoas**: e-mails, telefones, perfis sociais, dados de vazamento, correlação de identidades. É o que o torna valioso para OSINT.

O ProspectAI **proibiu esse território por decisão registrada**:

- `CLAUDE.md` regra 6: *"Dados pessoais de terceiros não são persistidos"* — avaliações com nome, foto e URL de pessoa física são descartadas na normalização
- Prompt 01 §19: *"Funcionalidades de breach lookup ou equivalentes NÃO devem entrar no ProspectAI comercial por simples disponibilidade técnica no Flowsint"*
- `scope-v0.2.md` §3.2: busca de perfil por nome fora de escopo

**Removida a camada de dados pessoais, o que resta do Flowsint que o ProspectAI precisa é pequeno** — e a parte que resta tem alternativas mais baratas e mais maduras.

Some-se o custo operacional: Neo4j, Celery, FastAPI e Redis adicionais, contra um orçamento de uma pessoa.

---

## 7. Recomendação preliminar para o ADR-002

`HYPOTHESIS` — a decisão formal é do STEP 8

**Não adotar o Flowsint agora.** Manter `FlowsintAdapter` como um dos adapters previstos no contrato de provider (Prompt 02 §5), sem implementação, e reavaliar quando existir uma capability concreta que só ele atenda.

O que preserva a opção sem pagar por ela:

1. O `ProviderContract` e o `ProviderRouter` nascem provider-agnostic — o Flowsint entra depois sem refatoração
2. A licença Apache 2.0 continua compatível, e o pinning em v1.2.10 fica registrado
3. Nenhum custo operacional é incorrido

**Gatilhos que reabrem a decisão:**

- surgir capability de grafo com pergunta de produto real de profundidade maior que 2
- o projeto cortar release nova com testes completos
- aparecer necessidade de correlação de entidades que o Postgres não atenda

Isso **não é rejeição do programa Intelligence.** A foundation do Prompt 02 continua necessária — ela só deixa de ter o Flowsint no caminho crítico.
