# Como obter a validação real do Intelligence Explorer

A Executora não alcança o registro npm nem o GitHub a partir do ambiente dela. Há duas rotas; qualquer uma resolve o bloqueio.

## Rota A — CI do GitHub (mais simples, evidência pública)

No seu PC, na pasta do projeto:

```powershell
git fetch "C:\ResgateProjetos\prospectai\Claude outputs\PROSPECTAI-P04-QA01-EXPLORER.bundle" feat/prompt-04-intelligence-explorer:feat/prompt-04-intelligence-explorer
git switch feat/prompt-04-intelligence-explorer
git push -u origin feat/prompt-04-intelligence-explorer
```

O único workflow (`ci.yml`) só dispara em push na `main` e em **pull request para a `main`**; empurrar a branch sozinha não dispara nada. Para disparar o CI, abra um **PR rascunho** para a `main` e **não faça merge**. O workflow não tem deploy, SSH nem segredos de produção; o banco dele é um Postgres efêmero do runner. Cole aqui o resultado dos jobs "Tipos" e "Testes e verificação de RLS".

## Rota B — local (Node 24, Docker Desktop)

```powershell
git switch feat/prompt-04-intelligence-explorer      # depois do git fetch acima
.\docs\intelligence\p04\qa\validar-p04-qa.ps1
```

Usa contêineres `propectai-qa-pg` (porta 5439) e `propectai-qa-redis` (6389), não toca no banco de desenvolvimento (5434) e remove os dois no fim. Cole `qa-logs\99-resumo.txt` e o log de qualquer passo que falhe.

## O que ainda exige o aplicativo completo

A captura real da ficha do lead com o botão "Explorar relações" e a regressão manual (login, lista, dashboard, pipeline) só existem com a stack rodando (`pnpm dev` + Docker de desenvolvimento). Nenhuma captura artificial foi gerada no lugar.
