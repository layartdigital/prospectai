# P04 — Intelligence Explorer · Documentação funcional

**`F:\drmind` (Bellvia) não foi modificado.**

## Para quem é

Quem prospecta e precisa entender **por que** um lead tem o score que tem e **o que já se sabe** sobre ele, sem abrir cinco telas.

## Como se usa

1. **Entrada pela ficha do lead.** Na ficha, em "Ações rápidas", o botão **Explorar relações** abre `/intelligence?lead=<id>` já com o grafo daquele lead.
2. **Entrada pelo menu.** O item **Intelligence** abre a tela vazia com a busca. Escolha um lead (busca por nome, filtros de cidade e categoria; lista ordenada do maior score para o menor).
3. **Leia o grafo.** O lead fica no centro. Ao redor: a pesquisa que o encontrou, o score, a presença digital e o cartão do pipeline.
4. **Carregue mais.** Selecione um nó; o painel da direita mostra os dados e botões **Carregar** por relação ("Nota — 16 de 30 no grafo"). Cada clique traz mais uma página, sem duplicar.
5. **Entenda a origem.** Em "Conexões", cada ligação mostra o selo **Vínculo no cadastro**, a descrição e a coluna do banco de onde vem (ex.: `leads.searchId → prospecting_searches.id`).
6. **Filtre.** "Tipos no grafo" oculta tipos inteiros (ex.: as notas) sem recarregar.
7. **Recomece.** "Explorar a partir deste lead" ou "Recomeçar deste lead" troca a raiz.
8. **Navegue pelo teclado.** Tab entre nós, Enter seleciona, setas movem, `+`/`-`/`0` zoom e enquadramento, Esc limpa.

## O que o usuário **não** vê, por desenho

- Relação suposta. Só aparece o que o cadastro comprova.
- Sinal não verificado como "ausente". Instagram, Facebook e WhatsApp sem verificação aparecem como **Desconhecido**, em cinza.
- Dados de outro workspace. Um lead de outro tenant responde "Não encontrado neste workspace", idêntico a um lead inexistente.
- Telefone completo quando o plano o mascara.
- Modal bloqueante abrindo sozinho. Nenhum.

## Estados da tela

Vazio (sem lead), carregando, erro com "Tentar de novo", lead não encontrado, grafo no teto de 150 entidades (aviso "N de no máximo 150 entidades"), e 390 px/820 px sem rolagem horizontal.

## Status das funcionalidades

| Funcionalidade | Status |
|---|---|
| Rota `/intelligence` | IMPLEMENTED |
| Grafo de relações verificáveis com proveniência | IMPLEMENTED |
| Expansão paginada por relação | IMPLEMENTED |
| Busca/seleção de lead de partida | IMPLEMENTED |
| Botão "Explorar relações" na ficha do lead | IMPLEMENTED (código; sem captura de tela da ficha) |
| Ajuda contextual mínima ("Como usar") | IMPLEMENTED |
| Âncoras para tour guiado | IMPLEMENTED (âncoras; sem tour) |
| Gancho de entitlements | PARTIAL (gancho sem diferenciação por plano) |
| Relações inferidas | PARTIAL (tipo reservado; nenhuma regra) |
| Camada de IA | NOT_STARTED (somente contrato; sem provedor aprovado) |
| Salvar/compartilhar investigação, exportar grafo | NOT_STARTED |
| Relações entre leads (mesmo telefone, mesmo domínio) | NOT_STARTED |
