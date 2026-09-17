# THIRD PARTY — Flowsint

**Data:** 22/08/2026 · **Fase:** Prompt 01, STEP 4 · atende §36
**Método:** verificação direta do repositório público
**Revisado em 17/09/2026** — as seções 1, 2, 3.3 e 4 foram reescritas depois de uma segunda medição. **As três afirmações centrais da versão anterior estavam erradas**, e o erro está nomeado na §1.

---

## 1. Correção de premissa do Prompt 01 — **retirada**

O §3 do Prompt 01 afirma:

> *"o repositório público do Flowsint apresenta a release **v1.2.11** como release mais recente, publicada em **01/07/2026**."*

**Este documento disse, em 22/08/2026, que isso estava errado. Estava certo.**

Medição de 17/09/2026, por `git ls-remote --tags` seguido de `git fetch --depth 1` de cada tag e leitura da data do commit — não por leitura de página:

| Tag | SHA do commit | Data do commit |
|---|---|---|
| v1.0.0 | `b819c83…` | **03/12/2025** |
| v1.2.0 / v1.2.1 | `308172a…` / `f1ef843…` | **25/01/2026** |
| v1.2.9 | `249374e…` | **31/05/2026** |
| v1.2.10 | `12bf293…` | **05/06/2026** |
| **v1.2.11** | `0d092c4…` | **01/07/2026** |
| **v1.2.12** | `12f1eb9…` (tag anotada `f852436…`) | **26/08/2026** |

Confronto com o que este documento afirmou:

| Afirmação de 22/08 | Realidade medida |
|---|---|
| "Release mais recente: **v1.2.10**" | v1.2.11 já existia havia 7 semanas; v1.2.12 saiu 4 dias depois |
| "Data: **05/06/2024**" | **05/06/2026** |
| "Existe v1.2.11? **Não**" | **Sim** — `0d092c44f0db5bae76093966f812f8a4073bee36`, 01/07/2026 |
| "As dez releases … todas datadas de **janeiro a junho de 2024**" | Janeiro a junho **de 2026**. Os meses estavam certos |

### O erro tem nome, e não é "desatualizado"

**Os meses acertaram e os anos erraram, todos na mesma direção, por exatamente dois anos.** Isso não é dado velho: é ano inventado sobre mês lido. A leitura veio da página de releases, onde a data recente aparece sem o ano, e o ano foi preenchido por suposição em vez de medição — e a suposição veio de uma noção interna de "hoje" que estava dois anos atrás.

O agravante está na §1 da versão anterior, que citava o próprio prompt para se autorizar:

> *"O próprio §3 antecipa a possibilidade e instrui: 'NÃO considere a documentação pública isoladamente como fonte absoluta de verdade.' A regra se aplica ao próprio prompt."*

A regra se aplicava, e foi aplicada ao alvo errado. **O prompt foi conferido; a conferência não foi.** Um `git ls-remote` — o mesmo comando que a §2 já registrava como pendência — teria mostrado v1.2.11 e v1.2.12 no primeiro dia.

<details>
<summary>Texto original da §1, preservado</summary>

> **Verificação em 22/08/2026:**
>
> | Item | Afirmado no prompt | Verificado |
> |---|---|---|
> | Release mais recente | v1.2.11 | **v1.2.10** |
> | Data | 01/07/2026 | **05/06/2024** |
> | Existe v1.2.11? | pressuposto | **Não** |
>
> As dez releases listadas vão de v1.2.1 a v1.2.10, todas datadas de **janeiro a junho de 2024**.
>
> O próprio §3 antecipa a possibilidade e instrui: *"NÃO considere a documentação pública isoladamente como fonte absoluta de verdade."* A regra se aplica ao próprio prompt.

</details>

---

## 2. Referência pinada

| Campo | Valor |
|---|---|
| Repository URL | `https://github.com/reconurge/flowsint` |
| Release escolhida | **v1.2.12** — a mais recente que existe, medida em 17/09/2026 |
| Data da release | **26/08/2026** |
| Tag anotada | `f8524366a7b031f07c35a5c0e43c422707aacded` |
| **Commit SHA** | `12f1eb936768e95981054aa2896ad14613377d7f` |
| Branch default | `main` |

**A referência mudou de v1.2.10 para v1.2.12 em 17/09/2026**, e a razão não é preferência por novidade: **v1.2.10 foi pinada por engano**, sob a crença de que era a mais recente. O pin não é decisão de adoção — nada é construído contra ele —, então movê-lo não custa nada e não movê-lo manteria no documento a consequência de um erro já corrigido no parágrafo acima.

É também a tag contra a qual todas as medições de 17/09 foram feitas: o catálogo de enrichers, o `README`, o `NOTICE` e a suíte de testes das seções seguintes.

```bash
git ls-remote --tags https://github.com/reconurge/flowsint
# …
# 0d092c44f0db5bae76093966f812f8a4073bee36  refs/tags/v1.2.11
# f8524366a7b031f07c35a5c0e43c422707aacded  refs/tags/v1.2.12
# 12f1eb936768e95981054aa2896ad14613377d7f  refs/tags/v1.2.12^{}
```

O `^{}` importa: v1.2.12 é **tag anotada**, e o SHA que interessa para pinning é o do commit — `12f1eb9…` —, não o do objeto da tag.

O §3.6 proíbe desenvolver contra `main` flutuante sem decisão registrada. A tag v1.2.12 é o alvo pinado.

> ✅ **A dúvida registrada nesta seção foi resolvida em 17/09/2026 — e resolvida contra quem a escreveu.**
>
> O texto anterior dizia: *"Se houver tag posterior à v1.2.10, esta seção precisa dizer **por que** a escolhida não é a mais nova — e 'era a mais nova quando escrevi' é uma razão válida, desde que escrita."*
>
> **Essa razão não estava disponível.** Não era a mais nova quando foi escrita: v1.2.11 tinha 7 semanas. A única razão verdadeira é a da §1 — o ano foi suposto, não medido.
>
> <details>
> <summary>Texto original da caixa de dúvida, preservado</summary>
>
> > ⚠ **Uma afirmação desta seção ficou em dúvida, e não foi resolvida.**
> >
> > A linha "Release escolhida" diz **"a mais recente que existe"**, com data 05/06/2024. O texto do Prompt 01 §3 afirma outra coisa: que a release mais recente é a **v1.2.11**, publicada em **01/07/2026**.
> >
> > As duas não podem estar certas. Isso importa menos para a licença — que a v1.2.10 já fixa — e mais para a base do **ADR-002**, cuja crítica registrada foi exatamente essa: tabela de capabilities como `HYPOTHESIS` promovida a `Accepted`. Uma decisão de não adotar apoiada numa leitura desatualizada do que existe é frágil pelo mesmo motivo.
> >
> > Resolve-se com um comando, e ele lista tudo em vez de perguntar por uma tag:
> >
> > ```bash
> > git ls-remote --tags https://github.com/reconurge/flowsint
> > ```
>
> </details>

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

- **Licenças das dependências não auditadas.** Uma dependência GPL/AGPL dentro de um projeto Apache pode contaminar conforme a forma de integração. Exige varredura antes da adoção. **Continua aberta** — é o 03A §6 e seguintes.
- ~~Confirmar se existe `NOTICE`~~ — **resolvido em 17/09/2026: existe**, tanto em v1.2.10 quanto em v1.2.12, e é o `NOTICE` padrão da Apache 2.0 com `Copyright 2025-2026 Reconurge`. Em caso de redistribuição, preservá-lo é obrigação.
- ~~Ler `ETHICS.md`~~ — **existe na raiz** desde v1.2.10, ao lado de `DISCLAIMER.md`. **Não foi lido ainda**, e continua pendente: não é licença, mas declara intenção de uso do autor, e é entrada direta do 03A §35–36 (classificação de privacidade).

Nada aqui é parecer jurídico. Os itens acima são para validação profissional se houver decisão de adotar.

---

## 4. Maturidade declarada pelo próprio projeto

Reescrita em 17/09/2026. **A leitura anterior — "projeto parado há mais de dois anos" — era consequência direta do erro de ano da §1, e invertia o sinal.**

| Sinal | Valor | Quando medido |
|---|---|---|
| Primeira release (v1.0.0) | 03/12/2025 | 17/09/2026 |
| Última release (v1.2.12) | **26/08/2026** | 17/09/2026 |
| Releases em 2026 | **v1.2.0 a v1.2.12**, de 25/01 a 26/08 | 17/09/2026 |
| Status no README | *"Flowsint is still in early development and definetly needs the help of the community!"* | v1.2.12, linha 28 |
| Testes | *"Each module has its own (incomplete) test suite"* | v1.2.12, linha 292 |
| Arquivos de teste | **41**, em `flowsint-api/tests`, `flowsint-core/tests`, `flowsint-enrichers/tests`, `flowsint-types/tests` | v1.2.12 |
| Stars / Forks / Commits | 7.5k / 944 / 875 | **22/08/2026 — não reconferido** |

**Leitura corrigida: o projeto está ativo, e a maturidade auto-declarada continua baixa.** As duas coisas ao mesmo tempo, e a segunda não decorre da primeira.

O `CHANGELOG` da v1.2.12 mostra em que o esforço recente foi gasto, e é informativo: dezenas de correções de `mypy`, `ruff`, `isort`, `eslint` e `react-hooks`, um *typecheck ratchet* em CI, tipagem das fronteiras de API do frontend. **É um projeto endurecendo a base, não um projeto abandonado** — e também não é um projeto que fechou a lacuna de testes, que continua declarada no README da mesma tag.

O intervalo entre a última release e hoje é de **três semanas**, não de dois anos.

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

> **Ressalva registrada em 17/09/2026.** Esta seção, e a frase equivalente no ADR-002 (*"a única área de força real do Flowsint é justamente a que o produto proibiu"*), são largas demais. A regra 6 proíbe dados de avaliadores e o link de perfil pessoal do `owner`; **e-mail e telefone comerciais já são coletados e pontuados hoje** pelo pipeline. O que de fato colide é **decision maker como pessoa física nomeada**. E a exclusão do `scope-v0.2` §3.2 é por **qualidade** — falso positivo de homônimo —, não por privacidade. A conclusão da seção não muda; a extensão dela, sim.

Some-se o custo operacional: Neo4j, Celery, FastAPI e Redis adicionais, contra um orçamento de uma pessoa.

---

## 7. Recomendação preliminar para o ADR-002

`HYPOTHESIS` — a decisão formal é do STEP 8

**Não adotar o Flowsint agora.** Manter `FlowsintAdapter` como um dos adapters previstos no contrato de provider (Prompt 02 §5), sem implementação, e reavaliar quando existir uma capability concreta que só ele atenda.

O que preserva a opção sem pagar por ela:

1. O `ProviderContract` e o `ProviderRouter` nascem provider-agnostic — o Flowsint entra depois sem refatoração
2. A licença Apache 2.0 continua compatível, e o pinning em **v1.2.12** fica registrado
3. Nenhum custo operacional é incorrido

**Gatilhos que reabrem a decisão:**

- surgir capability de grafo com pergunta de produto real de profundidade maior que 2
- ~~o projeto cortar release nova com testes completos~~ — **disparou pela metade em 17/09/2026**: releases novas existem (v1.2.11, v1.2.12), e o README da v1.2.12 **continua declarando a suíte incompleta**. A condição tem duas partes e só uma ocorreu. Ver o ADR-002, seção "Correção de fato"
- aparecer necessidade de correlação de entidades que o Postgres não atenda

Isso **não é rejeição do programa Intelligence.** A foundation do Prompt 02 continua necessária — ela só deixa de ter o Flowsint no caminho crítico.
