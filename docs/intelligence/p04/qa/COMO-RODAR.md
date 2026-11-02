# Como obter a validação real do Intelligence Explorer (P04-QA-02)

A Executora não alcança o registro npm nem o GitHub a partir do ambiente dela (o proxy de git recusa o push: repositório fora do conjunto autorizado da sessão; nada foi contornado). Quem publica a branch é **o proprietário, com o acesso Git que ele já tem autorizado**. Rota preferida: **A (GitHub Actions)**.

## Rota A — CI do GitHub (preferida; evidência pública e reprodutível)

Procedimento mínimo, no seu PC, na pasta do projeto (`C:\ResgateProjetos\prospectai`):

```powershell
# 1. traz a branch do bundle entregue (nao altera a main; nao faz merge)
git fetch "C:\ResgateProjetos\prospectai\Claude outputs\PROSPECTAI-P04-QA02-EXPLORER.bundle" feat/prompt-04-intelligence-explorer:feat/prompt-04-intelligence-explorer
git switch feat/prompt-04-intelligence-explorer
git log --oneline -3          # o topo deve ser o commit "QA-02" (hash na mensagem de entrega)

# 2. publica a branch (acesso Git ja autorizado do proprietario)
git push -u origin feat/prompt-04-intelligence-explorer

# 3. abre o PR RASCUNHO para a main (sem merge)
gh pr create --draft --base main --head feat/prompt-04-intelligence-explorer --title "P04: Intelligence Explorer 0.1.0 (QA-01/QA-02) - NAO FAZER MERGE" --body "Rascunho para executar o CI. Sem merge, sem deploy. Ver docs/intelligence/p04/P04-QA-02-RELATORIO.md"
```

Sem o `gh`, abra o PR rascunho (“Create draft pull request”) pela página do GitHub. O workflow só dispara em **pull request para a `main`** (e em push na `main`); empurrar a branch sozinha não dispara nada.

**O que o CI executa** (`.github/workflows/ci.yml`, sem deploy, sem SSH, sem segredo de produção; `permissions: contents: read`; bancos efêmeros do runner):

| Job | Passos obrigatórios (qualquer falha reprova o CI) |
|---|---|
| `Tipos` | segredos do compose · `pnpm install --frozen-lockfile` · `prisma generate` · **typecheck:all** (fontes, testes, scripts) · **lint** |
| `Builds (API e web)` | **`nest build`** (API) · **`next build`** (web) |
| `Testes e verificação de RLS` | migrations em dois estágios · seed · **`intelligence-tenant.spec.ts`** (HTTP real, Prisma real, papel `propectai_app`) · **suíte completa** · **portão de RLS** (`gate-rls.sql`) |
| `Resultado do CI` | falha se qualquer um dos três acima não terminou em `success` |

Devolva o resultado dos quatro jobs (print ou texto). Falha de CI deve ser corrigida na branch, sem merge.

## Rota B — local (alternativa; Node 24 e Docker Desktop)

```powershell
git switch feat/prompt-04-intelligence-explorer      # depois do git fetch acima, com a arvore limpa
.\docs\intelligence\p04\qa\validar-p04-qa.ps1
```

O script (v1.1.0, endurecido na QA-02) **não foi executado pela Executora**: foi revisado por leitura, sem interpretador PowerShell disponível para teste de sintaxe. Garantias que ele agora impõe:

- **Pré-voo antes de qualquer efeito:** `git`, `docker`, `node` ≥ 24, `pnpm`, daemon do Docker, árvore limpa (ou `-PermitirArvoreSuja`), portas **5439/6389 livres** e sem contêiner publicando nelas. Falhou = aborta sem criar nada.
- **Só mexe no que é seu:** contêineres com nome único da execução e rótulo `br.com.layart.propectai.qa=p04-qa`; remoção **pelo ID** devolvido por `docker run`, e só se o rótulo conferir. Nunca remove por nome, nem em lote, nem prune. Restos de execução anterior: aborta e lista; só com `-LimparRestosAnteriores` remove — e apenas os que têm o rótulo.
- **Não conecta em outro PostgreSQL por engano:** portas publicadas só em `127.0.0.1`; as quatro URLs são validadas (`localhost:5439/propectai`); e a execução grava um **marcador** dentro do Postgres e do Redis descartáveis e o **lê de volta pelo caminho do host**. Se houver outro serviço naquela porta, o marcador não confere e tudo termina antes de migration, seed ou teste.
- **Para na primeira falha crítica** (install, build, typecheck, lint, migrations, seed, identidade). As três etapas de teste (11–13) rodam todas para o quadro ficar completo, e o código de saída final é diferente de zero se qualquer etapa falhou.
- **Cada comando nativo tem o exit code verificado**, inclusive `docker run` (o ID devolvido precisa ter 64 hex) e a espera de prontidão (aborta em vez de seguir adiante).
- **Limpeza limitada ao que a execução criou** (contêineres por ID+rótulo, pasta temporária de migrations com sufixo da execução) e **variáveis de ambiente restauradas**. Não toca no Bellvia, no banco de desenvolvimento (5434/6381), nem em produção.

Cole `qa-logs\<execução>\99-resumo.txt` e o log de qualquer passo que falhe.

## O que ainda exige o aplicativo completo

A captura real da ficha do lead com o botão “Explorar relações”, a troca de workspace no navegador com o aplicativo completo e a regressão manual (login, lista, dashboard, pipeline) só existem com a stack rodando e **depois de um CI verde**. Nenhuma captura artificial foi gerada no lugar delas.
