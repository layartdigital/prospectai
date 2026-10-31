# P04 — Intelligence Explorer · Documentação comercial

**`F:\drmind` (Bellvia) não foi modificado.**

> Nenhum preço, limite comercial, nome de plano novo ou promessa de resultado foi definido aqui. O que segue descreve **proposta de valor** e **pontos de decisão** do dono.

## Proposta de valor (o que o recurso entrega hoje)

"Veja de onde vem o score do seu lead e tudo o que já se sabe sobre ele, em uma tela, com a origem de cada informação." Útil para: justificar a abordagem a um cliente, priorizar a fila de contato e treinar quem entra na equipe.

## Argumentos que a implementação sustenta

- Cada ligação mostra sua origem no cadastro (selo "Verificada").
- Sinais não verificados aparecem como "Desconhecido", sem acusar ausência.
- Dados separados por workspace.
- Funciona com a base que o usuário já tem; não exige nova integração.

## Argumentos que **não** devem ser feitos

- "IA que investiga o lead": a camada de IA não existe (só contrato).
- "Descobre conexões ocultas entre empresas": relações entre leads não foram implementadas.
- "Exporta/compartilha investigações": não existe.

## Decisões de monetização que cabem ao dono

| Decisão | Gancho técnico já pronto |
|---|---|
| O Explorer entra em todos os planos ou só em planos superiores? | Possível via nova `Capability` no `EntitlementsService` (não criada) |
| Limite de entidades por grafo / profundidade por plano? | `limitesDoPlano(planCode)` no serviço |
| IA como adicional pago? | Contrato pronto; depende de provedor e de custo por chamada |
| Nome comercial: "Intelligence" no menu | Já visível como item de menu; revisar nome e posicionamento |

Regra permanente: nenhum modal de bloqueio abre sozinho. Se o Explorer for gated, o gate só aparece após tentativa explícita do usuário.
