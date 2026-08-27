# Gate 0 — Resultado

**Data:** 22/08/2026
**Amostra:** 111 leads reais · dermatologia · São Paulo · `data/gmapsdata/94c317c2-…csv`
**Pergunta:** dado um lead do Google Maps, com que taxa é possível descobrir e verificar Instagram e Facebook?

> **Os handles e nomes deste documento estão pseudonimizados de propósito.** A amostra é de negócios e profissionais reais, e o repositório não é lugar para o nome deles — regra 6 do `CLAUDE.md`. Nada do que este documento conclui depende de qual perfil era qual: a evidência é a contagem de bytes, não a identidade. Se alguém for tentado a "restaurar" os nomes para deixar o relato mais concreto, o dado bruto está em `data/gmapsdata/`, fora do git, que é onde ele deve ficar.

---

## Veredito

**Aprovado para leads COM site. Reprovado para leads SEM site — e a reprovação é definitiva, não é questão de melhorar heurística.**

| Faixa | Total | Resolvidos | Taxa |
|---|---:|---:|---:|
| `SITE_PROPRIO` | 77 | 53 | **69%** |
| `SITE_PRECARIO` | 6 | 5 | 83% |
| `SEM_SITE` | 28 | **0** | **0%** |
| **Total** | 111 | 58 | 52% |

Zero bloqueios na camada determinística. Zero candidatos promovidos sem corroboração.

---

## O que funciona

**Camada B — extrair do site do lead.** 53 dos 77 sites próprios trazem link para rede social no HTML. É determinístico: o link está lá ou não está, sem palpite, sem busca, sem custo além da requisição.

**Camada A — o `website` já é a rede.** 4 leads cujo campo `website` do scraper aponta direto para Instagram ou Facebook. Custo zero, confiança máxima.

Os 24 que faltaram na faixa com site se dividem em:

- **16** responderam sem link para redes — pode ser ausência real, ou link injetado por JavaScript que o `fetch` não executa. Um headless browser recuperaria parte, com custo.
- **8** não responderam — fora do ar, timeout ou WAF.

---

## O que não funciona, e por quê

A camada C — descobrir o perfil por heurística de nome — **não é viável por scraping não autenticado.** Isso foi provado, não inferido.

### A medição enganosa

A primeira leitura dos 28 `SEM_SITE` foi: 28 candidatos, HTTP 200 em todos, zero bloqueios, zero corroborações. Parecia "handles errados".

Os handles gerados estavam plausíveis — nome do profissional, nome da clínica, especialidade combinada com bairro. E um handle errado deveria dar 404, não 200.

### O controle positivo

Testamos três perfis que **sabidamente existem** — todos confirmados pela camada A, extraídos do campo `website` do próprio scraper, e portanto reais sem margem de dúvida. Mais um handle inexistente como controle negativo.

```
controle-1 (real)      HTTP 200   623.282 bytes   conteúdo servido? NÃO
controle-2 (real)      HTTP 200   623.273 bytes   conteúdo servido? NÃO
controle-3 (real)      HTTP 200   623.271 bytes   conteúdo servido? NÃO
@zzz-nao-existe-…      HTTP 200   623.778 bytes   og:title vazio
```

**Os três perfis reais e o inexistente devolvem a mesma página**, variando 11 bytes entre si. O Instagram serve um login wall com status 200 e não distingue perfil existente de inexistente sem autenticação.

### Conclusão

`0/28` **não significa que esses leads não têm Instagram.** Significa que este método não enxerga. São coisas diferentes, e confundi-las levaria a marcar 28 leads como `AUSENTE` sem nunca ter verificado — exatamente o defeito que o `scoring.md` §2 existe para impedir.

Nenhuma melhoria de heurística resolve. O problema não é adivinhar o handle certo; é que a página não é servida para ninguém sem login.

---

## Caminhos para os `SEM_SITE`

| Opção | Viabilidade |
|---|---|
| **Instagram Graph API** | **Não serve.** Só dá acesso a perfis business vinculados a páginas que você administra. Prospecção de terceiros está fora do escopo da API por desenho. |
| **Fornecedor pago** (Apify, Bright Data e afins) | Tecnicamente possível. Custo por lead, ToS a verificar, e entra na conta de margem da v0.2. |
| **Headless browser autenticado** | Viola os termos do Instagram e coloca uma conta em risco de banimento. Não recomendado para produto comercial. |
| **Assumir `DESCONHECIDO`** | É o que a arquitetura já faz hoje, e continua correto. |

---

## Duas conclusões que mudam o roadmap

### 1. O sinal viável da v0.2 não é rede social — é qualidade de site

Dos quatro sinais listados como pendentes no `scoring.md` §7:

| Sinal | Situação após o Gate 0 |
|---|---|
| Perfil de Instagram ativo | **Bloqueado** — provado acima |
| Perfil de Facebook ativo | Mesma empresa, mesma política — presumir bloqueado até medir |
| WhatsApp confirmado | Exige WhatsApp Business API. Caro. E o `WHATSAPP_LIKELY` atual, por heurística de celular, já entrega quase o mesmo valor com custo zero |
| **Site não responsivo** | **Viável.** A camada B provou que 69% dos sites respondem e entregam HTML |

**O `WebsiteAuditAgent` deveria vir antes do enriquecimento de redes**, não depois. É o único dos quatro que funciona com a infraestrutura que já existe.

Ironia útil: ele opera justamente sobre os leads que têm site — a faixa que hoje pontua 0 a +15 e que o score trata como oportunidade fraca. Detectar "site próprio, mas lento, sem HTTPS, não responsivo, sem pixel" transforma um lead de peso 0 em oportunidade qualificada. **É criação de sinal onde hoje não há nenhum**, em vez de tentar preencher onde a porta está fechada.

### 2. O Instagram serviria para qualificar `SEM_SITE`, e essa lacuna continua

Hoje os 28 `SEM_SITE` recebem +30 indistintamente. Mas eles não são iguais:

- **sem site e com Instagram ativo** — entende valor de presença digital, está limitado pela plataforma. Melhor lead para quem vende site.
- **sem site e sem nada** — pode ser um negócio que simplesmente não se importa. Lead mais frio.

Sem o sinal social, essa distinção não existe. **Mas o scraper já traz substitutos parciais**: `review_count`, `review_rating`, `open_hours`, `about`, `descriptions`. Um negócio com avaliações recentes e horário cadastrado está ativo — e "ativo, sem site" já é o essencial do argumento comercial.

Vale medir quanto desses substitutos recupera antes de pagar fornecedor por dado social.

---

## Decisão registrada

1. **Camada A + B entram na v0.2.** Determinísticas, sem custo externo, 69% de cobertura na faixa com site.
2. **Camada C não entra.** Via inviável, documentada acima.
3. **Instagram e Facebook permanecem `DESCONHECIDO`** para leads sem site, e isso vai declarado no roadmap — não é omissão, é resultado de medição.
4. **`WebsiteAuditAgent` sobe de prioridade** e passa à frente do enriquecimento social.
5. **Antes de contratar fornecedor de dado social**, medir quanto os sinais que o scraper já traz recuperam da qualificação pretendida.

---

## Pendência: o erro silencioso

O número ainda não foi medido. Dos 58 `PRESENTE`, um já apareceu suspeito na inspeção:

- Um lead cujo link extraído aponta para o perfil de **outra pessoa com o mesmo sobrenome** — parente, sócia, ou apenas homônima. O link estava mesmo no HTML do site: a camada determinística fez o que promete, e ainda assim atribuiu o perfil errado ao lead errado.

Um segundo caso, um handle de duas letras, era lixo de parsing e foi corrigido com comprimento mínimo de handle.

Que um erro tenha aparecido na camada determinística — a que eu esperava ser a mais segura — mostra que a verificação manual não é dispensável nem ali. Abrir os 58 perfis e preencher `verificacao_humana` no CSV leva cerca de 30 minutos. **Limiar: ≤ 3%.**

---

## Custo do gate

Duas execuções de script e um controle. Cerca de 15 minutos de máquina.

Descobriu que uma das três vias planejadas para a v0.2 não existe — antes de qualquer linha de código de produção ter sido escrita.
