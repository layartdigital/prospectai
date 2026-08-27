# Decisões abertas — as que pertencem ao Product Owner

**Versão 1 · 24/08/2026 · situação revista em 27/08/2026**

Seis decisões que o código não pode tomar sozinho. Cinco vinham arrastadas desde a `SECURITY-EGRESS-POLICY-v3.md`; a sexta nasceu hoje, com a migration de auditoria.

Cada uma traz a pergunta real, a tensão que a criou, as opções com consequência, e uma recomendação — **marcada como recomendação**, porque a escolha é sua.

---

## Resumo

| # | Decisão | Situação |
|---|---|---|
| **D1** | Privacidade do link social | ✅ **decidida em 27/08** — coleta estrita agora, classificação pelo tenant depois |
| **D2** | Isolamento na leitura: RLS ou Prisma | ✅ **decidida e executada em 27/08** |
| **D3** | Quarentena sem store | ✅ **ratificada em 27/08** |
| **D4** | `AuditLog` vs. LGPD art. 18 VI | ✅ **decidida em 27/08** — pseudonimizar o ator |
| **D5** | ADR-004 Parte 2 | ⛔ **bloqueada** — produção não existe |
| **D6** | Retenção das medições | ✅ **decidida em 27/08** — 180 dias, e virou fatia de trabalho |

**As cinco que podiam ser respondidas foram.** Restam consequências, não decisões: a D1 gera trabalho em duas etapas, a D4 gera uma migration, e a D6 virou uma fatia com quatro peças. A D5 continua esperando o primeiro deploy, e isso está correto.

**O parecer jurídico da D1 e da D4 continua valendo a pena** — só não bloqueia mais nada. O desenho escolhido nas duas reduz exposição e sobrevive a qualquer resposta: se o parecer afrouxar, afrouxa-se; se apertar, a `observedUrl` diz exatamente quais linhas apagar.

---

## D1 — O link de rede social é dado comercial ou pessoal? · ✅ decidida

> **Resolvida em 27/08.** Classificação aceita: **perfil de pessoa física é dado pessoal; de pessoa jurídica não é.** Mas o sistema **não consegue distinguir os dois**, e isso não é limitação de esforço — é medição:
>
> - o nome não diz (`dra.maria.silva` pode ser o handle oficial da clínica);
> - o Gate 0 mediu que o Instagram serve a **mesma página de login** para perfil existente e inexistente — 623.282 bytes contra 623.778. Sem autenticar não dá para confirmar nem que o perfil existe, muito menos ler se é conta comercial;
> - olhar o conteúdo do perfil para classificar já seria processar o dado em questão.
>
> Então a regra **não vira um `if`**. O que se decidiu foi separar **coletar** de **usar**:
>
> **Etapa 1 — agora, sem interface.** Coleta apenas a URL e a página de origem (`observedUrl`). Nada de nome, foto, seguidores ou bio. **Não pontua no score.** O link fica visível só para o tenant, marcado `NAO_CLASSIFICADO`, e não sai do workspace.
>
> **Etapa 2 — quando a tela existir.** O tenant classifica: comercial, pessoal, ou não sei. **Só `comercial` entra no relatório entregue.** Os outros dois continuam visíveis para ele e ficam de fora do artefato que sai.
>
> **Por que assim:** não bloqueia a Fase 3 nem o PDF, que era a urgência inteira desta decisão; põe o julgamento humano onde ele muda o resultado, em vez de pedir classificação para depois não usar; e o padrão é o lado seguro — não classificado nunca sai. É a regra 4 aplicada à privacidade: o silêncio erra para o lado certo.
>
> **O enum `SiteCheck` só ganha os valores novos com esta decisão escrita.** Enquanto não estivesse, o bloqueio era código e não intenção — agora está, e os valores podem entrar.

### A pergunta

O `SOCIAL_LINK_DISCOVERY` encontra o link de Instagram ou Facebook publicado no site da empresa. **A regra 6 proíbe persistir dado pessoal de terceiro.** Esse link cai de que lado?

### Por que ela existe

Os dois casos moram no mesmo lugar da página e têm a mesma forma:

- `instagram.com/clinicasorriso` — perfil da empresa. Comercial, sem dúvida.
- `instagram.com/dra.maria.silva` — perfil **pessoal** da dona, usado como canal do negócio.

Para clínica, advogado e MEI — que são o público-alvo do produto — **o segundo caso é o comum, não a exceção**. E não há heurística confiável: o nome do perfil não diz, a foto não diz, e olhar o conteúdo do perfil para decidir já seria processar o dado que está em questão.

Por isso o enum `SiteCheck` **não tem** `INSTAGRAM_LINK` nem `FACEBOOK_LINK`. O bloqueio está em código e não em prosa: enquanto o valor não existir no enum, nenhum provider pode executá-lo por engano.

### Opções

**(a) Não coletar.** Seguro e definitivo. Mata a checagem e, com ela, parte do que o relatório da Fase 3 teria a dizer sobre presença digital.

**(b) Coletar só a URL, nunca conteúdo do perfil.** Fundamentação: *a própria empresa publicou aquele link no site dela, como forma de contato*. A evidência é verificável — a página onde o link estava fica registrada em `observedUrl`.

**(c) Coletar, mas exigir confirmação do tenant** antes de o link entrar em relatório. Move a decisão para quem conhece o lead. Custa um passo de UI e trava o relatório automático.

### Recomendação

**(b)**, com três amarras:

1. Guardar **apenas a URL**, nunca nome, foto, seguidores ou qualquer conteúdo do perfil.
2. Registrar a página de origem, para que a fundamentação seja demonstrável e não alegada.
3. Não usar o link para pontuação até que a decisão esteja documentada — sinal que não pontua não cria incentivo para coletar mais do que o necessário.

O argumento de (b) é o mais forte disponível: o dado foi publicado pelo titular, no site dele, com finalidade de contato. **Não sou advogado**, e é exatamente por isso que esta decisão tem prazo próprio — se ela precisar de parecer, o relógio começa quando você pedir, não quando o código estiver pronto.

### Prazo

**Comece hoje.** É a única das seis cujo tempo de resposta não depende de você. Ela trava a Fase 3 e, pela aresta `F5 → F7`, o relatório em PDF — que é o eixo comercial da v0.2.

---

## D2 — Isolamento na leitura: convenção ou restrição? · ✅ decidida e executada

> **Resolvida em 27/08.** Escolha: **(b) RLS**, com o `comTenant` explícito no lugar da extensão. O spike de meio dia sugerido abaixo foi feito (`SPIKE-RLS-v1.md`), virou plano em seis passos (`PLANO-RLS-v1.md`), e os cinco primeiros estão entregues — política ligada em `digital_presence_audits` e `digital_presence_checks`, com S8 e S9 provados pelo banco em `apps/worker/test/rls-canario.spec.ts`. Falta o passo 6, que é espalhar para as demais famílias de tabelas.
>
> **O que a medição acrescentou ao argumento**, e que não estava previsto aqui: o custo é de ~5 ms por chamada de `comTenant` (+168% numa consulta barata, medido com braço de controle a 0,2% de ruído), e **dois terços dele são a transação, não o `set_config`**. Ou seja, o preço de adotar RLS não é a variável de sessão: é a transação que ela obriga a existir — e a extensão do Prisma, que não precisa de transação, não pagaria nada. A escolha continua sendo a mesma, agora com o número na mesa.
>
> O texto original fica abaixo, sem edição, porque a recomendação e a razão dela continuam corretas.

### A pergunta

As FKs compostas de F0 fazem o **banco** impedir escrita cruzada entre tenants. Na **leitura**, o que impede?

### Por que ela existe

Hoje, nada estrutural. O `tenant.guard.ts` resolve o tenant da requisição e cada serviço lembra de filtrar. Funciona enquanto todo mundo lembrar.

O pipeline de auditoria entregue hoje usa chave composta na leitura (`tenantId_id`), e o teste S13 prova que um payload com o `tenantId` do vizinho não encontra a auditoria. **Mas isso é uma tabela.** A pergunta é sobre as outras quarenta.

### Opções

**(a) Extensão do Prisma** que injeta `where: { tenantId }` automaticamente.

- Barato, sem migration, reversível.
- **Falha aberto.** Um `$queryRaw`, um `$executeRaw`, ou um caminho que não passe pelo client passa direto. A extensão não sabe que existe.

**(b) RLS no Postgres** — políticas por linha, o banco recusa.

- Fecha o buraco inclusive para SQL cru.
- Custa operação real: exige variável de sessão por requisição, e isso tem atrito conhecido com pool de conexões. Precisa ser medido no seu ambiente, não deduzido.

**(c) Os dois.** RLS como garantia, extensão como conveniência para não escrever o `where` à mão.

### Recomendação

**(b), tendendo a (c)** — mas **não decida antes de medir**.

O argumento a favor é de coerência: F0 já escolheu *o banco impõe* para escrita. Fazer da leitura uma convenção seria dizer que a mesma garantia vale metade — e o dia de hoje foi inteiro sobre afirmações que o sistema não sustentava. Uma extensão do Prisma é uma promessa; RLS é uma restrição.

O argumento contra é operacional e é sério. **Sugiro um spike de meio dia**: ligar RLS em uma tabela, rodar a suíte da API, ver o que quebra com o pool de conexões. É a única das seis decisões em que mais medição muda genuinamente a resposta.

### Prazo

Antes de S8 e S9 de F0 — os testes de isolamento na leitura mudam de forma conforme a resposta. Escrevê-los antes seria escrevê-los duas vezes.

---

## D3 — Quarentena sem store · ✅ ratificada em 27/08

> Mantida como está: sem armazenamento de payload suspeito, detecção de desvio por assinatura de forma calculada **depois** da sanitização.

### A pergunta

A `SECURITY-EGRESS-POLICY-v3.md` cortou o store de quarentena. Ratifica?

### Por que ela existe

A v2 previa guardar payloads suspeitos para inspeção posterior. A v3 cortou: um store de payload suspeito é uma segunda cópia do dado que a política existe para não guardar, e a inspeção manual nunca acontece na prática.

O que ficou no lugar: detecção de desvio por **assinatura de forma**, calculada **depois** da sanitização. Isso pega mudança de estrutura na fonte sem guardar conteúdo — e o "depois" não é detalhe: calculada antes, a assinatura vazaria nomes de chave com dado pessoal (`{"user_reviews": {"Maria Silva - CRM-SP 12345": …}}`).

### Recomendação

**Ratificar como está.** A decisão já foi tomada e testada; falta o "ok". Risco baixo, reversível.

---

## D4 — `AuditLog` append-only vs. direito à eliminação · ✅ decidida

> **Resolvida em 27/08: pseudonimizar o ator.** O `userId` vira uma lápide irreversível; o evento, a data e o efeito permanecem.
>
> **O argumento que decidiu é o escopo.** O `AuditLog` guarda id de **membros da equipe do cliente**, não de leads — dado de terceiro mora em `leads`, e a regra 6 já cuida dele. O que se perde apagando a linha inteira é grande e concreto: é o `AuditLog` que responde "quem trocou o plano", "quem suspendeu", "quem pediu esta auditoria", em suporte, em disputa de cobrança e nos eventos de segurança. O que se perde pseudonimizando é uma coisa só — ligar uma ação antiga a uma pessoa nomeada —, que é exatamente o que ela tem direito de remover.
>
> ### Duas descobertas ao ir implementar
>
> **1. Não existe fluxo de eliminação nenhum.** O `removeMember` do `TeamService` faz *soft delete* do `Membership` (`deletedAt`), e a linha de `User` permanece intacta. Nenhum caminho do produto apaga um usuário. Ou seja, **o conflito que a D4 resolve ainda não aconteceu** — o que ela faz é decidir a forma antes de existir a pressão.
>
> **2. O schema já tem metade da resposta, e a metade errada.** `AuditLog.actor` está com `onDelete: SetNull`. Se um dia alguém apagar um `User`, o `actorId` vira NULL sozinho: o registro sobrevive e **a identidade some por inteiro** — inclusive a capacidade de agrupar "todas as ações daquela mesma pessoa removida", que é o que importa ao investigar um incidente depois que ela saiu.
>
> ### A forma escolhida
>
> Coluna `actorPseudonym` na `AuditLog`. Na eliminação, um rótulo **aleatório** é gerado uma vez por pessoa, escrito em todas as linhas dela, e o `actorId` é anulado. Aleatório porque é irreversível por construção — não há hash a quebrar; estável porque é escrito de uma vez em todas as linhas, então o agrupamento sobrevive.
>
> **Onde `SetNull` basta, `SetNull` fica.** `Lead.notes.authorId`, `LeadContactRecord.authorId`, `PipelineCard.ownerId`, `DigitalPresenceAudit.requestedById` — nenhum deles é append-only, e apagar o vínculo ali não destrói propriedade nenhuma. A lápide existe só onde o registro perderia o sentido sem ela.
>
> **O gatilho fica em aberto**, e é decisão de produto, não de código: quem pode pedir a eliminação, como se confirma, e se o pedido apaga o `User` ou só o desliga.

### A pergunta

O `AuditLog` é append-only por integridade. O art. 18 VI da LGPD dá ao titular o direito à eliminação. Como as duas coisas convivem?

### Por que ela existe

Um log de auditoria que pode ser apagado não é um log de auditoria — o valor dele vem de ser imutável. Mas ele guarda `userId`, e `userId` identifica uma pessoa.

### Opções

**(a) Apagar as entradas na eliminação.** Honra o pedido de forma óbvia e destrói a propriedade que faz o log existir.

**(b) Manter tudo.** Preserva a integridade e ignora o pedido.

**(c) Pseudonimizar o ator.** O `userId` vira uma lápide (`usuario-removido-<hash>`); o evento, a data e o efeito permanecem.

### Recomendação

**(c).** O que o titular tem direito de eliminar é o **dado pessoal** — o identificador. O fato de um evento ter ocorrido, e seu efeito sobre o workspace, não são dados dele: são registro da operação, com base em obrigação legal e interesse legítimo.

**Não sou advogado**, e esta merece confirmação junto com a D1 se você for consultar alguém — as duas são da mesma conversa.

### Prazo

Não urgente enquanto não houver titular exercendo o direito. Mas **decida antes de o log ter volume**: depois vira migração em tabela grande, e o custo muda de categoria.

---

## D5 — ADR-004 Parte 2 · bloqueada

### A pergunta

Custo em R$/mês, horas/mês de operação, e condição de reversão do processo isolado de fetch.

### Por que ela não pode ser respondida

**Produção não existe.** `infra/docker/` não está no repositório, e o perfil `full` do compose não pode subir. Sem ambiente de produção não há custo de infraestrutura para estimar nem baseline de operação para comparar.

Foi justamente isso que destravou o F0: a Parte 1 do ADR (`FETCHER_MODE=inline`, custo R$0, nenhum serviço novo) resolve hoje, e o transporte injetável já é a costura por onde a Parte 2 entra sem mudar nada acima de `buscar()`.

### Recomendação

**Deixar como está.** Revisitar no primeiro deploy. Está registrada assim no próprio ADR — `Accepted em duas partes`.

---

## D6 — Retenção das medições · ✅ decidida em 27/08, e virou fatia de trabalho

> **180 dias confirmados.** Mas a decisão veio com três pedidos que não são configuração — são produto. E ao ir escrevê-los apareceu uma quarta peça, que faltava:
>
> **Hoje o `retentionUntil` é decorativo.** Ele é gravado em toda checagem e **nada o lê**. Não existe rotina de expurgo. Os 180 dias são uma promessa que ninguém cumpre — pior que não ter prazo, porque o campo dá a impressão de que há controle.
>
> ### As quatro peças
>
> **1. Mostrar o prazo.** `retentionUntil` na resposta de `GET /audits/:id`, e a tela diz até quando as medições ficam disponíveis. Uma linha na API, uma na interface.
>
> **2. Exportar.** `GET /audits/:id/export`, auditoria e checagens em CSV ou JSON. **O PDF não serve para isto** — ele é Fase 3 e depende da D1. O export cru serve hoje e usa o mesmo argumento de portabilidade que mantém o `GET /leads/export` liberado mesmo sob suspensão (§10.4).
>
> **3. Avisar antes — 15 dias, pela tabela `Notification`**, que já existe com serviço próprio, gerado por um job diário no worker. E-mail fica para quando houver mecanismo de envio; propor agora seria propor infraestrutura inexistente.
>
> Por que 15: perto o bastante para a pessoa agir, longe o bastante para caber um fim de semana. Trinta vira ruído que ninguém lê; sete não sobrevive a férias.
>
> **4. Apagar — e só depois de ter avisado.**
>
> Esta é a peça que dá sentido às outras três. **O expurgo não apaga checagem cuja notificação não foi registrada — ele adia.** Sem essa trava, um defeito no notificador vira perda silenciosa de dado: o cliente descobre que o relatório sumiu no dia em que foi procurá-lo, e nós descobrimos junto com ele.
>
> É a mesma forma do `decidirExecucao` do worker: a ação destrutiva exige **prova** de que a condição anterior aconteceu, não confiança de que aconteceu.

### A pergunta

Por quanto tempo as linhas de `DigitalPresenceCheck` ficam?

### Por que ela existe

Escrevi `RETENCAO_CHECK_DIAS = 180` no `audit-decisoes.ts` e **o número é chute meu**. O que não é chute é a existência do prazo: sem ele a tabela cresce sem limite, que é exatamente o defeito que o `LeadSourceRecord.payload` já tem e que este modelo foi desenhado para não repetir.

### O que decide o número

Quanto tempo um relatório entregue a um prospect precisa continuar **explicável**. Se um cliente volta em quatro meses perguntando "de onde saiu isso?", a medição precisa estar lá. Se ninguém nunca volta depois de trinta dias, 180 é armazenamento pago à toa.

### Recomendação

Manter **180 dias** até haver dado de uso real, e revisitar quando existir histórico de quanto tempo os relatórios são de fato consultados. É reversível: mudar o valor afeta só as linhas novas, e uma migração pode reescrever as antigas se necessário.

---

## O que eu faria nesta semana

*Escrito em 24/08. Situação em 27/08 ao lado de cada item.*

1. **Hoje:** mandar a D1 para quem for dar o parecer. É a única com relógio externo.
   → **Não foi feita.** Três dias, e é o único item da lista cujo atraso não se recupera trabalhando mais rápido depois.
2. **Hoje, cinco minutos:** ratificar D3 e D6.
   → Pendente. Continua sendo cinco minutos.
3. **Meio dia, quando couber:** o spike de RLS da D2 — a única onde medir muda a resposta.
   → ✅ Feito, e virou os passos 1 a 5 do `PLANO-RLS-v1.md`.
4. **Junto com a D1**, se houver consulta jurídica: incluir a D4, que é a mesma conversa.
   → Pendente, junto com a D1.
5. **D5:** não fazer nada. Está bloqueada por ausência de produção, e isso está correto.
   → Nada feito, como planejado.

**A ordem não mudou, e o item 1 subiu de importância pelo simples fato de ter esperado.** O trabalho de engenharia avançou cinco passos enquanto a única decisão com prazo externo ficou parada — o que é exatamente o padrão que faz uma fase inteira travar no fim, por um parecer que podia ter sido pedido na primeira semana.

---

## Fechamento — 27/08/2026

Cinco das seis decidas no mesmo dia, e a lição das duas primeiras horas de conversa vale registrar: **nenhuma delas era difícil.** O que as segurava era não estarem formuladas com as consequências à vista.

A D1 destravou quando parou de ser "isto é dado pessoal?" e virou "coletar e usar são momentos diferentes". A D4 destravou quando o escopo apareceu — são membros da equipe do cliente, não leads. A D6 parecia ratificação de um minuto e revelou que o campo de retenção não era lido por ninguém.

**Duas foram além do que a pergunta pedia**, e as duas viraram trabalho:

- a **D1** virou duas etapas de implementação, e desbloqueou o enum `SiteCheck`;
- a **D6** virou uma fatia de quatro peças, incluindo a rotina de expurgo que não existia.

O que continua aberto não é decisão: é o **parecer jurídico** da D1 e da D4, que vale pedir e não bloqueia mais nada, e a **D5**, que espera o primeiro deploy.

`F:\drmind` não foi modificado.
