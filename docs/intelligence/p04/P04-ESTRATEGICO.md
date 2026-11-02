# P04 — Intelligence Explorer · Documentação estratégica

**`F:\drmind` (Bellvia) não foi modificado.**

## Tese

O ProspectAI hoje entrega listas (Meus Leads) e um score. O que falta é **confiança no score**: o usuário vê "82" e não vê de onde veio. O Explorer transforma o cadastro em um mapa navegável em que cada ligação tem origem rastreável. A aposta é que a prospecção local se decide por entender um lead em minutos, e que **explicabilidade verificável** é o diferencial defensável — mais do que "mais dados".

## Princípios que o incremento fixa

1. **Verificável antes de esperto.** Nada de relação suposta na interface. Inferência só entra com regra explícita, rotulada e testável.
2. **Ausência de sinal é `DESCONHECIDO`.** O mapa não pode produzir falso negativo.
3. **Isolamento é invariante, não feature.** Todo caminho de leitura passa por RLS e por `tenantId` explícito.
4. **Reutilizar, não duplicar.** Auth, tenant, score, máscara de telefone e busca de leads são os existentes.
5. **IA só com evidência.** O contrato impede afirmação sem ancoragem no subgrafo.

## Por que implementação própria e não o Flowsint

O Flowsint é uma plataforma de investigação OSINT de pessoas (FastAPI, Celery, Neo4j, Redis; licença Apache 2.0). O ADR-002 já decidiu **não adotar agora**: custo operacional alto para uma pessoa, e conflito com a regra permanente de não persistir dados pessoais de terceiros. O Explorer cobre a pergunta de produto do ProspectAI (entender um lead *da própria base do usuário*) sem nova infraestrutura.

## O que este incremento habilita

- Base para IA explicável (resumir/explicar relação) com evidência obrigatória.
- Base para relações **entre** leads (mesmo domínio, mesmo telefone) sem redesenho do grafo, desde que haja regra e verificação.
- Base para investigação salva/compartilhável por equipe.

## Riscos

| Risco | Mitigação / estado |
|---|---|
| Serviço nunca compilado contra o Prisma gerado real | Rodar `pnpm typecheck && pnpm test` no CI antes de homologar a branch |
| Grafo com muitas notas fica denso | Rótulos condicionais, filtro por tipo, teto de 150; paginação já limita |
| FK `leads.searchId` não é composta com tenant | Registrado; migration de integridade só com autorização |
| Expectativa de "IA" na tela sem provedor | Tela diz que não está disponível; nada simulado |

## Próximos incrementos candidatos (não iniciados)

1. Rodar CI real e corrigir o que o compilador apontar (pré-requisito de qualquer deploy).
2. Relações entre leads por campo normalizado, com `provenance` do tipo regra e selo "Inferida".
3. Provedor de IA aprovado + endpoint que use `AiRequest`/`AiResponse` e `validarRespostaIa`.
4. Diferenciação por plano em `limitesDoPlano` — **depende de decisão comercial**, não técnica.
