# Lacunas estruturais — observações de 06/08/2026

**Origem:** revisão do produto pelo responsável, com o sistema em execução.
**Status:** diagnóstico e recomendação de sequência. Nenhuma decisão de escopo tomada.

---

## 1. Por que estas quatro observações são uma só

Serviços travados numa persona, ausência de gestão de usuários, ausência de gestão de clientes e ausência de configuração de pagamento parecem quatro pedidos independentes. Não são.

O produto tem **um plano de operação** — o que o cliente da Layart usa para prospectar — e **nenhum dos outros dois**:

| Plano | Quem administra | O que faria | Estado |
|---|---|---|---|
| **Operação** | O usuário final | Buscar, qualificar, abordar, acompanhar | Existe e funciona |
| **Tenant** | O dono da conta cliente | Equipe, papéis, preferências do workspace | Só preferências |
| **Provedor** | A Layart | Tenants, consumo, cobrança, configuração global | **Não existe** |

A v0.1.1 construiu o plano de operação com rigor. Os outros dois nunca entraram em escopo, e por isso não aparecem como lacuna na conferência dos 24 critérios — a lista de aceite descreve a operação, não a administração.

É a mesma limitação que a lacuna de exportação revelou em 06/08: **conferência guiada por lista de aceite herda os buracos da lista.**

---

## 2. Gestão de usuários — promessa comercial não cumprida

Não é lacuna de conveniência. É defeito na tabela de preços.

| Plano | maxUsers | Como criar o segundo usuário |
|---|---:|---|
| FREE | 1 | — |
| START | 1 | — |
| PRO | **5** | **Não há forma** |
| AGENCY | **25** | **Não há forma** |

`register` cria tenant e dono. Depois disso, nada. Sem convite, sem endpoint, sem tela.

Dois efeitos:

**Comercial.** PRO e AGENCY vendem 5 e 25 usuários, e o produto entrega 1. Vender qualquer um dos dois hoje é prometer o que não existe — exatamente o defeito que o `scope-v0.1.1.md` §1 diz que o produto foi construído para evitar.

**Técnico.** O RBAC está implementado e inalcançável. Cinco papéis (`OWNER`, `ADMIN`, `MANAGER`, `SDR`, `VIEWER`), guardas `MinRole` em endpoints sensíveis, teste de isolamento passando. Com um usuário por tenant, todo esse sistema é código morto — nunca exercitado em uso real, portanto nunca provado além do que o teste força.

Escopo mínimo para deixar de ser promessa falsa: convidar por e-mail, atribuir papel, listar, revogar, e o `maxUsers` sendo efetivamente aplicado no convite.

---

## 3. Painel do provedor — não dá para operar o SaaS

Hoje, para saber quais clientes existem, quanto consumiram ou quem pagou, a resposta é consultar o banco. Para trocar o plano de um cliente, a resposta é `pnpm db:plan` no terminal — um script que, por desenho, **só age em tenants marcados `isDemo: true`**. Ou seja: não existe nem o caminho manual para um cliente real.

O que falta, em ordem de urgência:

1. **Listar tenants** com plano, consumo do período e data da última atividade
2. **Trocar plano** de um tenant específico, com registro de quem trocou e por quê
3. **Suspender e reativar** — inadimplência sem suspensão é serviço grátis
4. **Ver consumo** por tenant: leads, buscas, gerações de IA, exportações. Todos já contados em `PlanUsage`
5. **Cobrança** — assinatura, gateway, webhook de pagamento

Os quatro primeiros são leitura e escrita sobre dado que já existe. O quinto é integração externa e projeto próprio.

**Nota de arquitetura:** este painel não é uma tela a mais dentro do produto. Precisa de autenticação separada e de um modelo de permissão que não passe pelo `TenantGuard` — porque, por definição, ele enxerga todos os tenants. Misturar os dois planos no mesmo sistema de autorização é o caminho mais curto para vazamento entre clientes, que é o defeito que o produto mais se esforçou para evitar.

---

## 4. Taxonomia de segmentos — reposiciona o produto

A base enviada (`base_inteligencia_b2b_500_segmentos_v1`) não é lista de serviços. São treze colunas por segmento que configuram **o funil inteiro**:

| Coluna da base | Onde entra |
|---|---|
| Palavras-chave / Termos de Busca | Nova Busca — o termo que vai ao scraper |
| ICP B2B + Setores-alvo | Nichos prospectados — o +15 do score |
| Sinais de Oportunidade | Motor de score |
| Serviços Principais | Abordagem por IA |
| Necessidade / Dor | Gancho do texto de abordagem |
| Modelo de Contratação, Recorrência | Qualificação e priorização |

Hoje `SERVICE_OPTIONS` e a lista de nichos vivem como constantes TypeScript, com cinco e quinze valores respectivamente, todos de agência digital.

**O que muda:** o produto deixa de ser ferramenta de agência e passa a servir qualquer prestador B2B — software house, contabilidade, consultoria — cada um com o funil pré-configurado. O onboarding troca "quais nichos você atende" por "qual seu segmento", e carrega o resto.

**O que isso exige:**

- Taxonomia no banco, não em constante compilada. Muda o score, então precisa de versão, como o `algorithmVersion` já tem
- Busca com autocompletar e dois níveis (macro-segmento → segmento). 500 itens em lista suspensa é inutilizável
- Campo livre para acrescentar, porque nenhuma taxonomia cobre todo mundo
- Conversão de codificação na importação: o arquivo está em cp1252, não UTF-8

---

## 5. Configuração do Google Maps — provavelmente não se aplica

A pergunta foi se a configuração do Google Maps seria feita internamente pela programação. A resposta é que **não há chave de API para configurar**.

O motor de coleta é o `gosom/google-maps-scraper`, container próprio, sem credencial de Google. É decisão registrada na regra 3 do `CLAUDE.md` e reafirmada em 31/07 quando a §7 F02 do prompt mestre propôs trocar por Places API — rejeitada como instrução, aceita como registro de risco.

O que faz sentido configurar, e hoje é código, são os parâmetros de coleta: profundidade, concorrência, zoom, tempo limite. Cabem em `AppSetting`, como os pesos do score já fazem.

Se um dia houver `GooglePlacesProvider` como alternativa, aí sim entra chave de API — e ela pertence ao painel do provedor, nunca ao tenant.

---

## 6. Alcance global — decisão de 06/08/2026

O produto deve atender **qualquer país onde o Google Maps opere**. Não é hipótese de longo prazo; é requisito.

Isso corrige uma afirmação errada feita anteriormente neste projeto. O **mercado** nunca foi brasileiro — o scraper busca em Milão tão bem quanto em Guarulhos. Brasileira é a **implementação**, e a distinção muda tudo.

### 6.1 O que trava hoje

| Item | Estado | Custo de mudar depois |
|---|---|---|
| **`country` no Lead** | **Não existe.** Todo lead é brasileiro por omissão | **Alto** — migration sobre dado ambíguo. Sem o campo, não há como desambiguar retroativamente |
| `addressStateUf` | Sigla de duas letras, normalizada por tabela de UF | Médio. Província italiana cabe em dois caracteres; condado inglês e estado alemão, não |
| `phoneE164` | **Já internacional.** Formato E.164 é padrão mundial | Nenhum |
| `addressPostalCode` | String livre — serve CEP, CAP, ZIP | Nenhum |
| Moeda | Plano e proposta presumem BRL | Médio |
| `maskPhone` | Regra brasileira de DDD | Baixo — recebe E.164, falta regra por país |
| WhatsApp "provável" | 9 dígitos após DDD, regra do Brasil | Baixo |
| Lista de construtor gratuito | `wixsite`, `negocio.site` — sabor Brasil | Baixo, já vive em `AppSetting` |
| Interface | Só pt-BR | Médio. i18n é chato, mas mecânico |

**A regra de corte:** o que é schema entra agora; o que é regra por país entra quando houver cliente naquele país.

`country`, região genérica e moeda são migration. O resto é configuração ou tradução, e adiar não encarece.

### 6.2 O problema que a taxonomia esconde

A coluna *Palavras-chave / Termos de Busca* da base de 500 segmentos é o que vai **literalmente ao scraper**. Está em português.

`agência de marketing digital em Milano` não devolve nada útil no Google Maps. O termo correto é `agenzia di marketing digitale`.

Isso significa que a taxonomia **não é traduzível como texto de interface — ela é funcional.** Tradução errada não deixa a tela feia; deixa a busca vazia, e o cliente conclui que o produto não funciona no país dele.

São 500 segmentos multiplicados por idioma. Manualmente, inviável.

É aqui que o **Gemini** deixa de ser acessório e vira infraestrutura: gerar termos de busca por segmento e por locale é exatamente o que um modelo faz bem.

Com uma trava obrigatória: **termo gerado precisa ser validado contra resultado real antes de virar padrão.** Se o modelo inventar uma expressão que ninguém usa, a busca volta vazia — e o defeito aparece como "o produto não serve para a Itália", não como "o termo estava errado". Validação sugerida: rodar o termo no scraper e exigir um mínimo de resultados antes de publicar.

### 6.3 Consequência no modelo de dados da taxonomia

Segmento é conceito, e não muda entre países. Palavra-chave é por locale.

```text
Segmento          conceito estável — "Agência de Marketing Digital"
SegmentoLocale    idioma, país, termos de busca, rótulo traduzido
                  status: gerado | validado | curado
```

Sem essa separação, cada idioma vira uma cópia da taxonomia inteira, e manter as duas em sincronia é trabalho permanente.

---

## 7. Recomendação de sequência

Dois critérios, nesta ordem: **primeiro o que encarece a cada dia, depois o que destrava receita.**

| Ordem | O quê | Por quê |
|---:|---|---|
| **1** | Schema internacional: `country` e região genérica no Lead; `country`, `currency`, `taxId` e `customerType` no Tenant | Único item cujo custo cresce todo dia. Uma migration hoje; arqueologia de dados depois de mil leads em três países. Os campos de tenant habilitam *reverse charge* (§8.2) e tiram a decisão PF/PJ do caminho crítico técnico (§8.5) |
| **2** | Gestão de usuários no tenant | Destrava a venda de PRO e AGENCY, que hoje prometem 5 e 25 usuários e entregam 1. E torna o RBAC alcançável |
| **3** | Painel do provedor, itens 1 a 4 | Sem ele não há como atender cliente real. Leitura e escrita sobre dado que já existe — barato |
| **4** | Taxonomia com locale + Gemini como provedor de IA | Habilita o alcance global de verdade. Sem termos locais, "atende o mundo" é promessa vazia |
| **5** | Cobrança com Stripe, atrás de `PaymentProvider` | Métodos locais em cada país saem do próprio Stripe, Pix e Boleto incluídos. Ver §8.2 |
| **6** | Auditoria de presença digital (`scope-v0.2.md`) | Segundo eixo de preço. Faz sentido depois de existir a máquina de cobrar |

A auditoria de presença digital saiu do primeiro para o sexto lugar ao longo desta análise, e vale explicitar o raciocínio: ela aumenta **quanto** se cobra por cliente. Os itens 1 a 5 determinam se é possível **ter** cliente, e em quantos países. Aumentar o preço de uma base que ainda não pode existir é otimizar a variável errada.

O item 1 é o único que eu não adiaria por nenhum motivo. Os outros cinco competem entre si; esse compete com o relógio.

---

## 8. Respostas — 06/08/2026

### 8.1 Modelo de negócio: multissegmento e global

**Não é uso interno.** O produto é para vender, multissegmento e para qualquer país onde o Google Maps opere.

Duas consequências diretas:

O painel do provedor deixa de ser opcional. E a contradição fica visível na primeira tela: um produto que se apresenta como multissegmento e global oferece hoje cinco serviços de agência digital e presume Brasil em cada campo de endereço.

### 8.2 Gateway: abstrair primeiro, escolher depois

A preocupação declarada foi *"não ter que refazer isso depois"*. A forma de não refazer **não é acertar a escolha** — é não se acoplar a ela.

O produto já faz isso com o motor de coleta: `LeadSourceProvider` tem duas implementações, e trocar de fonte não toca o domínio. Cobrança merece o mesmo: `PaymentProvider` com `criarAssinatura`, `trocarPlano`, `cancelar` e um manipulador de webhook. A escolha do fornecedor vira detalhe de implementação.

**Recomendação de fornecedor, com a tensão explícita:**

| | Stripe | Paddle |
|---|---|---|
| Modelo | Processador. Você é o vendedor | Merchant of Record. Eles revendem |
| Taxa base | ~2,9% + US$ 0,30 | ~5% + US$ 0,50 |
| Taxa real internacional | 5%+ somando cartão internacional, conversão, Billing e Tax | ~5%, já com tudo |
| Impostos | Sua responsabilidade em cada jurisdição | Deles |
| Brasil doméstico | BRL, Pix e Boleto | Fraco |

**Decisão de 06/08/2026: Stripe.**

O percurso da recomendação ficou registrado de propósito. Argumentei primeiro por Stripe sob a premissa errada de que o produto era brasileiro; depois por Paddle, quando o alcance global entrou como requisito. A decisão final foi Stripe, e ela se sustenta melhor do que meu segundo argumento sugeria — por um fato que eu não havia levantado.

**O PropectAI vende B2B.** Quem compra é agência, software house, escritório, consultoria — pessoa jurídica, não consumidor final. Isso muda a natureza da obrigação fiscal:

- **União Europeia:** serviço digital vendido a empresa com número de VAT válido aplica *reverse charge*. Quem recolhe é o comprador, não o vendedor. A obrigação do vendedor é validar o número e emitir a fatura corretamente
- **Estados Unidos:** *economic nexus* só existe acima de limiares por estado, tipicamente na casa das dezenas de milhares de dólares
- **Demais mercados:** quase todos têm limiar de registro, e nenhum é atingido no primeiro ano de um SaaS iniciante

O cenário de horror fiscal que justifica Merchant of Record é sobretudo **B2C**, onde não existe reverse charge e o vendedor recolhe desde o primeiro euro. Não é este caso.

**Consequência de produto, e não é pequena:** para que o reverse charge se aplique, o sistema precisa **coletar e validar o número de identificação fiscal** do cliente na assinatura — VAT na Europa, CNPJ no Brasil, equivalente em cada país. Sem isso, a venda é tratada como B2C e a isenção não vale.

Isso é campo em `Tenant`, portanto schema, portanto entra junto com `country` e moeda no item 1 da sequência. O Stripe Tax faz o cálculo e a validação do número; o campo precisa existir para alimentá-lo.

**Pix, Boleto e métodos locais** vêm do próprio Stripe, sem provider paralelo — é uma das razões pelas quais a escolha simplifica o Brasil em vez de complicá-lo.

**Reavaliar quando:** a receita B2C passar a ser relevante, ou o volume ultrapassar o limiar de registro em algum mercado grande. Aí a conta muda, e a abstração `PaymentProvider` existe justamente para que mudar não seja reescrita.

### 8.3 Taxonomia: importar tudo, tratar como padrão editável

Decisão delegada. A recomendação é **importar os 500 inteiros**, e o motivo é o enquadramento:

A base não precisa ser verdade curada. Precisa ser **melhor que um campo em branco.** Quando o tenant escolhe o segmento, os valores vêm pré-preenchidos e ele ajusta. Isso elimina o custo de curadoria: erro numa linha vira edição de um cliente, não defeito de produto.

Quatro decisões de modelagem que decorrem disso:

- **Dois níveis**, macro-segmento e segmento, com busca por texto. 500 itens em lista suspensa é inutilizável
- **Campo livre preservado**, porque nenhuma taxonomia cobre todo mundo
- **Versão na taxonomia**, porque ela altera o score — mesmo motivo do `algorithmVersion`
- **Locale separado do conceito** — ver §6.3. Segmento é estável entre países; palavra-chave de busca, não

**Distinção que a base torna óbvia e que ainda não estava no produto:** existem *duas* taxonomias, com propósitos diferentes.

| Taxonomia | Descreve | Origem |
|---|---|---|
| Segmento do cliente | Quem **usa** o PropectAI e o que vende | Esta base de 500 |
| Categoria do lead | Quem é **prospectado** | Categorias do Google Places |

A coluna *Palavras-chave / Termos de Busca* é a ponte entre as duas — é o que vai literalmente ao scraper. Confundi-las produziria um filtro que não devolve nada.

Sobre fontes externas: **CNAE** (IBGE) é a classificação oficial brasileira e serve de âncora para o segmento do cliente; as **categorias do Google Places** são a referência do lado do lead, porque é o vocabulário que o motor de coleta entende. Nenhuma das duas substitui a base enviada — a base tem ICP, dor e sinais de oportunidade, que classificação oficial não tem.

### 8.4 Auditoria avulsa — o que é a pergunta

O plano inclui N auditorias por mês. Isso resolve o cliente recorrente.

O problema é outro cenário: a agência fecha uma campanha e quer auditar cinquenta prospects **de uma vez**, neste mês. Ela não vai trocar de plano permanentemente por causa de um pico — vai desistir, ou vai fazer na mão fora do produto.

A resposta natural é vender pacote avulso. E a decisão que precisa vir **antes** da Fase 5, não depois:

**A auditoria não usada acumula ou expira?**

| | Contador que zera | Saldo que acumula |
|---|---|---|
| Modelo de dados | `auditsCount` em `PlanUsage`, zera no período | Tabela de saldo com origem, validade e consumo |
| Percepção | "Perdi o que não usei" | "Tenho crédito guardado" |
| Receita | Previsível, força uso ou perda | Passivo contábil — crédito vendido e não entregue |
| Complexidade | Trivial, já existe | Precisa de ordem de consumo: gasta o do plano ou o avulso primeiro? |

Muda o modelo de dados, e é por isso que não dá para decidir depois. Minha recomendação: **contador mensal para o plano, saldo com validade para o pacote avulso.** O cliente entende — o do plano é do mês, o comprado dura noventa dias — e o consumo gasta primeiro o do plano, preservando o que ele pagou à parte.

---

### 8.5 Pessoa física: liberada no Brasil, PJ obrigatório fora

**Decisão de 06/08/2026.** Postura de lançamento, não regra permanente.

**O peso fiscal não é uniforme.** Na venda a empresa, o *reverse charge* transfere a obrigação ao comprador. Na venda a pessoa física não há essa saída, e boa parte dos países cobra **desde o primeiro euro, sem limiar**, de vendedor estrangeiro de serviço digital — União Europeia, Reino Unido, Noruega, Austrália, entre outros. Nos Estados Unidos muda pouco, porque o limiar de *economic nexus* vale para os dois tipos. No Brasil, PF é trivial.

**O que se perde ao excluir PF:** o freelancer que vende site, tráfego ou social media para negócio local. É exatamente o perfil dos planos FREE e START — a base do funil, onde a aquisição é mais barata e o boca a boca começa. Não é corte trivial.

**A regra escolhida:** PF liberado no Brasil, número fiscal obrigatório fora dele. Maior cobertura de mercado por unidade de dor fiscal. Em código é uma validação no cadastro, no mesmo lugar onde `country` já será lido.

**Campos que isso exige em `Tenant`**, junto com os do item 1 da sequência:

```text
country        país da empresa cliente
currency       moeda de cobrança
taxId          número fiscal — VAT, CNPJ, equivalente
customerType   PF | PJ
```

O `customerType` é o que **tira a decisão comercial do caminho crítico técnico**. Abrir PF na Europa depois vira registro no OSS e mudança de uma regra de validação — não migration, não reescrita de cobrança.

**Quando reabrir:** quando houver demanda de PF fora do Brasil em volume que justifique o registro no OSS europeu. Vale registrar que o OSS é **um único registro cobrindo toda a União Europeia**, não vinte e sete — menos assustador do que parece, mas é obrigação recorrente com declaração trimestral, e não se abre por três clientes.

---

## 9. Perguntas que continuam abertas

1. **Preço do pacote avulso de auditoria** — quantas unidades e por quanto
2. **Quais idiomas na largada?** A interface em pt-BR mais inglês cobre a maioria dos mercados iniciais; a taxonomia precisa do idioma **local** de cada país onde houver cliente, que é problema diferente e maior
3. **Quem é o primeiro cliente pagante real, e de que país?** Define quanto do painel do provedor e quanta localização precisam existir antes da primeira cobrança
4. **Preço por país.** Plano único convertido pela cotação do dia trata Brasil e Suíça como o mesmo mercado. Preço por região é prática corrente em SaaS e depende de decisão comercial, não técnica — o `currency` no schema já deixa a porta aberta
