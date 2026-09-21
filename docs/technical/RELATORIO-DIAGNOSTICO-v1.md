# Relatório de diagnóstico — a tabela de tradução

**Data:** 18/09/2026 · **Tipo:** conteúdo, não código. É o texto que o cliente lê.
**Leitor:** o dono do negócio auditado. Não é você, e não é o operador do sistema.
**Estado:** revisado com as três decisões de 18/09 — ver §6. Virou código em 19/09 (`packages/types/src/relatorio-diagnostico.ts`, que declara que **este documento manda** se os dois divergirem). Revisado em 21/09 depois do primeiro relatório com medição real — ver `PAGINA_NAO_ENCONTRADA` na §4.2 e a §5.1.

---

## 1. O que este documento é

O produto mede quatro coisas sobre o site de um negócio e guarda o resultado em vocabulário de máquina: `HTTPS / FAILED / TLS_CERTIFICADO_EXPIRADO`. Um dono de padaria não lê isso.

Este documento é a tabela que traduz cada combinação medida em quatro frases: **o que foi medido**, **o que o cliente lê**, **por que importa para o negócio dele**, e **o que fazer**. É o conteúdo do relatório entregável, e é o que separa um diagnóstico vendável de um despejo de dados.

**Por que ele existe antes do código:** a tradução é a parte cara de acertar e a barata de corrigir enquanto é texto. Depois que virar componente, cada ajuste de palavra é um commit.

---

## 2. Três restrições que não são de estilo

### 2.1 A regra 4 vale aqui, e é onde ela é mais fácil de violar

> `CLAUDE.md` regra 4: *"Ausência de sinal é `DESCONHECIDO`, nunca `AUSENTE`."*

Num documento de venda, a tentação é converter tudo em achado, porque achado vende. **`SKIPPED` não é reprovação do site do cliente — é informação sobre a nossa execução**, e o próprio schema diz isso:

> `CheckOutcome`: *"Os três são diferentes no relatório: `FAILED` é informação sobre o site do prospect, `SKIPPED` é informação sobre a nossa execução."*

Então o relatório tem **duas listas separadas e visualmente distintas**: o que foi verificado, e o que não foi possível verificar. A segunda não é rodapé nem letra miúda. É o que torna a primeira crível — um documento que só traz problemas parece peça de venda; um que diz o que não conseguiu medir parece medição.

### 2.2 O score não entra

> `score.ts`: *"O score é uma **priorização comercial**: em que ordem vale a pena abordar. Não é previsão de conversão nem nota de qualidade da empresa."*

O peso mais alto da tabela é `NO_WEBSITE: 30`. Se o score aparecesse no relatório, o cliente o leria como nota — e a nota diria que **não ter site é o melhor resultado possível**. O score é para você escolher quem abordar. Não atravessa a mesa.

### 2.3 Relatório gerado por `mock` não existe

O schema registra, no campo `providerName`, que auditoria medida e auditoria inventada já ficaram indistinguíveis três vezes:

> *"se a versão do verificador precisa ficar registrada para o relatório continuar explicável, a implementação também precisa. (…) e isso aconteceu três vezes em 24 e 25/08."*

**Consequência para o relatório: `providerName !== 'native'` não renderiza.** Não é aviso, não é marca d'água — a página recusa. Entregar a um cliente um documento cujos números foram inventados pelo mock é o pior defeito que este produto pode cometer, e é o mais fácil de cometer sem perceber.

---

## 3. O que existe para medir, medido hoje

| Checagem | Emitida hoje? |
|---|---|
| `DNS` | **sim** |
| `HTTP_REACHABLE` | **sim** |
| `HTTPS` | **sim** |
| `REDIRECT_CHAIN` | **sim** |
| `VIEWPORT_META` | **não, por decisão** — exigiria parsear HTML de terceiro dentro do módulo cujo propósito é conter terceiros |
| `TTFB` | **não, por decisão** — o `fetcher` mede o primeiro salto, e num site que redireciona de http para https o número seria o do redirect, não o da página |
| `TITLE_META` | **não, por decisão** — mesma razão do `VIEWPORT_META` |

*Corrigido em 21/09.* A versão anterior desta tabela dizia "nome reservado no enum, nenhum provedor produz" — o que soava como omissão. O `site-audit.ts` (`SITE_CHECKS_V1`) registra que é decisão, e com o argumento que importa para um documento entregável: *medir errado é pior que não medir — o número errado vai para o relatório do cliente com a mesma cara do certo.*

`native.provider.ts` devolve `[dns, alcance, tls, cadeia]`. O mock devolve o mesmo conjunto.

**O relatório v1 fala de quatro coisas.** Escrever texto para as outras três seria escrever para medições que não acontecem.

**E o relatório fala só da auditoria do site.** Os sinais de presença (`hasInstagram`, `hasFacebook`, `hasReviews`…) vêm do scraper, com outra origem e outro prazo de retenção, e a maioria nasce `DESCONHECIDO`. Misturá-los aqui seria convidar exatamente a frase que a §2.1 proíbe.

---

## 4. A tabela

**Tratamento: "sua empresa".** Decidido em 18/09. O documento é entregue a uma empresa e pode ser lido por mais de uma pessoa — o contador, o sócio, o sobrinho que cuida do site. "Você" cria intimidade que não existe ainda e endereça um leitor só.

---

### 4.1 `DNS` — o endereço do site existe?

**`OK`, sem código de erro**

- **Medido:** o nome do domínio resolveu para um endereço público.
- **O cliente lê:** *"O endereço do site da sua empresa está ativo e responde na internet."*
- **Por que importa:** é a base de tudo. Sem isso, nada mais funciona — nem e-mail no domínio próprio, nem link em anúncio.
- **O que fazer:** nada. Está certo.

---

**`FAILED` · `NAO_RESOLVE`**

- **Medido:** o nome não resolveu em nenhuma consulta. Domínio inexistente, expirado, ou sem configuração de DNS.
- **O cliente lê:** *"O endereço **{site}** não existe na internet hoje. Quem digitar esse endereço não chega a lugar nenhum."*
- **Por que importa:** este é o achado mais grave da lista, e o mais invisível de dentro. O site pode ter funcionado por anos; um domínio expira em silêncio, e a empresa só descobre quando alguém avisa. **Todo cartão, panfleto, anúncio e assinatura de e-mail que traz esse endereço está mandando o cliente para o vazio.**
- **O que fazer:** verificar com quem registrou o domínio se ele está vencido. Se estiver, renovar costuma resolver em horas. Se não estiver, é configuração de DNS.

---

**`OK` · `DESTINO_BLOQUEADO`**

- **Medido:** o nome resolveu, mas para um endereço de rede interna ou reservado. **Nós recusamos conectar** — é decisão nossa de segurança, não defeito dele.
- **O cliente lê:** *"Não foi possível verificar este endereço. Ele aponta para uma rede interna, e nossa verificação não acessa endereços desse tipo."*
- **Por que importa:** não importa para a empresa. É informação sobre a nossa execução, e vai **na lista do que não foi verificado**, não na lista de achados.
- **O que fazer:** nada, do lado dela. Do seu lado: confirmar se o endereço cadastrado é o público.

### 4.2 `HTTP_REACHABLE` — o site abre?

**`OK`** (resposta 2xx)

- **Medido:** o site respondeu com sucesso em **{urlObservada}**.
- **O cliente lê:** *"O site da sua empresa abre normalmente."*
- **Por que importa:** confirma que o servidor está no ar e entregando conteúdo.
- **O que fazer:** nada.

---

**`FAILED` · `ERRO_DO_SERVIDOR`** (resposta 5xx)

- **Medido:** o servidor respondeu com erro — status **{status}**.
- **O cliente lê:** *"O site está no ar, mas devolveu um erro ao ser aberto (código {status}). Quem visitar agora vê uma página de erro em vez do conteúdo da sua empresa."*
- **Por que importa:** é pior que estar fora do ar, porque parece descuido em vez de acidente. E como o servidor responde, ferramentas de monitoramento simples não acusam.
- **O que fazer:** falar com quem hospeda o site. Erro 5xx é do servidor, não da internet do visitante.

---

**`FAILED` · `REDIRECT_PARA_DESTINO_QUEBRADO`**

- **Medido:** a porta 80 respondeu e mandou seguir adiante, e o destino do redirecionamento falhou.
- **O cliente lê:** *"O endereço da sua empresa redireciona o visitante para outro lugar, e esse outro lugar não abre. O caminho começa certo e termina quebrado."*
- **Por que importa:** é a falha mais difícil de perceber de dentro: quem já tem o site aberto no navegador ou salvo em favoritos pode não passar pelo redirecionamento. **Quem chega pela primeira vez, passa.**
- **O que fazer:** verificar para onde o endereço está redirecionando.

---

**`FAILED` · `PAGINA_NAO_ENCONTRADA`** (resposta 404 ou 410) — *acrescentado em 21/09/2026*

- **Medido:** o servidor respondeu, e a resposta foi que a página não existe.
- **O cliente lê:** *"O endereço {site} responde, mas leva a uma página que não existe. Quem visita vê uma página de erro no lugar do site da empresa."*
- **Por que importa:** costuma acontecer quando o site foi desativado, nunca chegou a ser publicado ou mudou de endereço. O endereço continua de pé, e o cartão, o anúncio e o perfil no Google seguem mandando gente para uma página de erro.
- **O que fazer:** verificar com quem cuida do site se ele está publicado. Se o site mudou de endereço, atualizar o endereço divulgado — a começar pelo perfil no Google.

**Por que esta linha existe.** Até 21/09 o 404 estava no grupo inconclusivo, junto do 403. O primeiro relatório emitido com medição real — `odontocenter-demo.wixsite.com` — mostrou o custo: a Wix responde por qualquer nome sob `wixsite.com`, então endereço, certificado e redirecionamento saíram certos, e a página final respondia **404**. O relatório abria com "nenhum problema encontrado" sobre um site que não existe. **O 403 continua inconclusivo**: é o que firewall responde a robô. O 404 não recusa a pergunta — responde a ela.

---

**`FAILED` · `TIMEOUT`**

- **Medido:** nenhuma resposta dentro do prazo da verificação.
- **O cliente lê:** *"O site da sua empresa não respondeu no tempo da nossa verificação. Ou está fora do ar, ou está lento a ponto de o visitante desistir antes de ver a primeira tela."*
- **Por que importa:** as duas hipóteses custam visita, e o visitante não distingue uma da outra — ele fecha a aba.
- **O que fazer:** abrir o site pelo celular, com dados móveis, fora da rede da empresa. Se abrir rápido aí, a suspeita é intermitência; se demorar, é o servidor.

---

**`FAILED` · `CONEXAO_RECUSADA` / `REDE_INALCANCAVEL` / `CONEXAO_PERDIDA`**

- **Medido:** o endereço existe, e a conexão foi recusada ou interrompida.
- **O cliente lê:** *"O endereço do site existe, mas não aceitou a conexão. Normalmente significa que o serviço que entrega o site está parado."*
- **Por que importa:** o domínio está pago e o site não está no ar. Costuma ser hospedagem vencida ou serviço derrubado.
- **O que fazer:** falar com quem hospeda.

---

**`SKIPPED` · `RESPOSTA_NAO_CONCLUSIVA`**

- **Medido:** o servidor respondeu algo que não permite concluir — tipicamente 401, 403 ou 429, as respostas que proteção contra robôs costuma dar. (404 e 410 saíram daqui em 21/09: ver `PAGINA_NAO_ENCONTRADA` acima.)
- **O cliente lê:** *"Não foi possível concluir a verificação: o servidor respondeu de uma forma que não permite afirmar se a página abre para um visitante comum. Muitos sites bloqueiam verificações automáticas, e isso por si só não é defeito."*
- **Por que importa:** vai **na lista do que não foi verificado.** Afirmar que o site está quebrado aqui seria inventar um achado — e é exatamente o erro que o código do provedor registra ter cometido e corrigido.
- **O que fazer:** abrir o endereço no navegador e ver com os próprios olhos.

---

**`SKIPPED` · `SEM_DNS`**

- **Medido:** não houve o que alcançar, porque o nome não resolveu.
- **O cliente lê:** *nada nesta seção.* A causa já está dita no `DNS`, e repeti-la em três checagens transformaria um problema em quatro.
- **Por que importa:** **um problema, uma linha.** O relatório perde credibilidade quando infla.
- **O que fazer:** ver o item de `DNS`.

### 4.3 `HTTPS` — o site é seguro?

**`OK`**

- **Medido:** a navegação terminou em `https` com certificado válido — o transporte recusa certificado inválido, então "chegou" é prova de que validou.
- **O cliente lê:** *"O site da sua empresa tem certificado de segurança válido. O navegador mostra o cadeado."*
- **Por que importa:** sem ele, navegadores mostram aviso de "site não seguro" antes de a pessoa ver qualquer coisa.
- **O que fazer:** nada.

---

**`FAILED` · `TLS_CERTIFICADO_EXPIRADO`**

- **Medido:** existe certificado, e ele está fora da validade.
- **O cliente lê:** *"O certificado de segurança do site **está vencido**. O navegador exibe um aviso vermelho de 'sua conexão não é particular' antes de qualquer conteúdo aparecer — e a maioria das pessoas volta nesse momento."*
- **Por que importa:** **é o achado mais vendável desta lista.** É concreto, verificável em dez segundos por quem recebe o relatório, tem consequência imediata na visita, e o conserto é barato. Também tem prazo: certificado vencido não melhora sozinho.
- **O que fazer:** renovar o certificado com quem hospeda. Hoje a maioria das hospedagens emite gratuitamente e renova sozinha — se venceu, a renovação automática está desligada ou falhou.

---

**`FAILED` · `TLS_NOME_NAO_CONFERE`**

- **Medido:** há certificado válido, emitido para outro nome de domínio.
- **O cliente lê:** *"O site tem certificado de segurança, mas ele foi emitido para outro endereço. Para o navegador, isso é o mesmo que não ter: o aviso de risco aparece igual."*
- **Por que importa:** é o caso em que a empresa tem certificado e jura que está tudo certo — e está, só que não para o endereço que ela divulga.
- **O que fazer:** pedir a quem hospeda a emissão do certificado para o endereço correto, com e sem `www`.

---

**`FAILED` · `TLS_AUTOASSINADO` / `TLS_INVALIDO`**

- **Medido:** o certificado não é reconhecido pelos navegadores.
- **O cliente lê:** *"O certificado do site não é reconhecido pelos navegadores, e o visitante vê um aviso de segurança antes do conteúdo."*
- **Por que importa:** mesmo efeito prático do vencido.
- **O que fazer:** substituir por um certificado emitido por autoridade reconhecida — gratuito na maioria das hospedagens.

---

**`FAILED` · `SEM_HTTPS`**

- **Medido:** o site não atende em `https`.
- **O cliente lê:** *"O site da sua empresa não tem certificado de segurança. Navegadores marcam endereços assim como **'Não seguro'** na barra de endereço, e buscadores tratam isso como sinal negativo."*
- **Por que importa:** é um selo de desatualização visível para qualquer visitante, permanente e gratuito de resolver.
- **O que fazer:** ativar o certificado gratuito na hospedagem.

---

**`FAILED` · `TIMEOUT` / `CONEXAO_RECUSADA` e demais códigos de conexão**

- **Medido:** a sonda não chegou a avaliar certificado nenhum.
- **O cliente lê:** *"Não foi possível verificar o certificado de segurança, porque não houve resposta."*
- **Por que importa:** vai **na lista do que não foi verificado.** Dizer "não tem certificado" quando não se conseguiu olhar é afirmar o contrário do que se observou — e o código do provedor tem um comentário inteiro sobre esse erro, cometido e corrigido: *"afirmar o contrário do que se observou é pior que não afirmar nada."*
- **O que fazer:** nada aqui; a causa está no item de alcance.

### 4.4 `REDIRECT_CHAIN` — quem digita o endereço sem `https` chega em segurança?

**`OK`, com `forcaHttps: true`**

- **Medido:** a porta 80 respondeu e encaminhou para `https`, em **{saltos}** salto(s).
- **O cliente lê:** *"Quem digita o endereço da sua empresa sem 'https' é levado automaticamente para a versão segura."*
- **Por que importa:** é o comportamento correto, e quase ninguém digita `https://` à mão.
- **O que fazer:** nada.

---

**`OK`, com `forcaHttps: false`**

- **Medido:** a sonda foi conclusiva e **não** houve encaminhamento para `https`.
- **O cliente lê:** *"Quem digita o endereço sem 'https' continua navegando na versão sem proteção — o site não o leva para a versão segura."*
- **Por que importa:** ter certificado e não encaminhar é ter a porta trancada com a chave na fechadura: existe proteção, e o visitante comum nunca passa por ela.
- **O que fazer:** pedir à hospedagem o redirecionamento permanente de `http` para `https`. É configuração, não desenvolvimento.

---

**`SKIPPED` · `SONDA_HTTP_NAO_CONCLUSIVA`**

- **Medido:** a resposta não permitiu concluir se há encaminhamento — a sonda pode ter sido atendida por um intermediário, sem chegar ao site.
- **O cliente lê:** *"Não foi possível concluir se o endereço sem 'https' encaminha para a versão segura."*
- **Por que importa:** vai **na lista do que não foi verificado**, e a razão está escrita no provedor: registrar `false` aqui *"afirma que o site aceita tráfego em claro — um achado inventado, sobre uma sonda que não chegou ao site."*
- **O que fazer:** nada.

---

**`SKIPPED` · `SEM_RESPOSTA`**

- **Medido:** nenhuma sonda obteve resposta.
- **O cliente lê:** *nada nesta seção.* A causa está no alcance.

---

## 5. A estrutura da página

1. **Cabeçalho** — nome do negócio auditado, endereço auditado, data da medição.
2. **O que encontramos** — só o que é `FAILED` com causa atribuível ao site. Ordem: `DNS` → `HTTPS` → alcance → cadeia. Cada achado nos quatro campos da §4, sem o rótulo técnico à vista.
3. **O que está certo** — os `OK`. Curto, e não é enfeite: um relatório só de problemas parece peça de venda.
4. **O que não foi possível verificar** — os `SKIPPED` e as recusas nossas, com a razão. Mesmo peso visual das outras seções.
5. **Como medimos** — data, versão do verificador (`auditVersion`), e a frase que sustenta o resto: *cada item acima foi verificado automaticamente contra o endereço informado, na data indicada.*
6. **Validade** — `retentionUntil`: até quando o dado medido continua disponível no sistema.
7. **Assinatura** — o nome da empresa que entrega (`Tenant.name`), em texto.

**E acaba aí.** Decidido em 18/09: **o documento termina na medição**, sem última linha convidando à conversa.

Não é timidez comercial, é o que faz o documento funcionar. Um relatório que termina vendendo se revela peça de venda no último parágrafo, e retroativamente coloca em dúvida os quatro anteriores — o leitor releitura tudo perguntando o que foi exagerado para chegar ali. Terminando na medição, o documento continua sendo o que diz ser, e **a conversa acontece fora dele**, que é onde ela acontece de verdade: no telefonema, na mensagem, na visita. O relatório é o motivo da conversa, não o lugar dela.

**O que não aparece em lugar nenhum:** score, pesos, motivos de pontuação, nome de concorrente, estimativa de faturamento, promessa de resultado, e qualquer número que não tenha saído de uma medição desta auditoria.

### 5.1 Duas regras que só existem no conjunto — acrescentadas em 21/09/2026

A tabela da §4 traduz uma checagem de cada vez. O primeiro relatório com medição real mostrou que isso não basta: cada frase do caso `wixsite.com` era verdadeira, e o documento inteiro dizia que um site inexistente estava bem.

**1. Certificado e redirecionamento só entram em "O que está certo" se a página abriu.** São propriedades do *endereço*, não do site — numa plataforma que responde por qualquer nome, o certificado é o da plataforma e o redirecionamento também. Quando o alcance não é `OK`, os dois itens **saem** do relatório; não mudam de seção, porque são medições corretas sobre a coisa errada. O `DNS` fica: "o endereço está ativo" é verdade e ajuda a localizar o problema. A regra só remove itens certos — achado e "não verificado" nunca saem por ela. Implementada em `montarRelatorio`, com teste construído a partir do CSV da auditoria real.

**2. A primeira frase não diz mais do que foi medido.** Sem achados e sem nada pendente, "O que encontramos" diz *"Nenhum problema encontrado nas verificações desta lista."* Sem achados mas com itens não verificados, diz *"Nenhum problema encontrado no que foi possível verificar. Parte da verificação não pôde ser concluída — veja abaixo."* Quem lê um laudo para na primeira linha.

---

## 6. As três decisões de 18/09

**1. Tratamento: "sua empresa".** O documento é entregue a uma empresa e pode ser lido por mais de uma pessoa. "Você" endereça um leitor só e cria intimidade que ainda não existe.

**2. Fecho: termina na medição.** Sem convite à conversa. Ver a justificativa no fim da §5.

**3. Assinatura: o nome da empresa que entrega, em texto. Sem logo, e sem o nome do produto.**

- **Nome da agência, e não nada.** Sem assinatura, o relatório não é entregável — quem for usar colaria o conteúdo no próprio timbre, e voltaríamos a ter matéria-prima em vez de documento.
- **Em texto, e não logo.** `Tenant.name` já existe no schema, ao lado de `taxId` e `customerType`. Logo exigiria upload, armazenamento e serviço de arquivo — infraestrutura nova para um ganho que ninguém pediu ainda. Fica para quando pedirem; se não pedirem, a funcionalidade inteira foi economizada.
- **O nome do produto fica fora.** Quem entrega é a agência, e propaganda da ferramenta dentro do documento do cliente dela não serve a ninguém que paga. Além disso o nome está indefinido. E há um motivo comercial: **relatório sem marca da plataforma é o padrão que se vende** — "remova a marca no plano X" é alavanca conhecida, e para poder usá-la um dia basta que hoje o nome do produto tenha **um lugar só** no código. Esse lugar fica preparado e vazio.
