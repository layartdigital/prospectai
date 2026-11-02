# P04-CLOSE-01 v1.0.0 — Encerramento documental do Intelligence Explorer

**Projeto:** ProspectAI · **Módulo:** Intelligence Explorer **0.1.0** · **PR #7 — Draft** · **Branch:** `feat/prompt-04-intelligence-explorer`
**Commit homologado:** `78e9fe2588ee1ee0aafe1804c4f62c1b2d58d225` · **Execução de referência:** GitHub Actions **#77** — https://github.com/layartdigital/prospectai/actions/runs/41450846331 · **Data do registro:** 02/11/2026

**`F:\drmind` (Bellvia) não foi modificado.** Esta rodada é **exclusivamente documental**: nenhuma funcionalidade, refatoração, migration, deploy, merge, acesso ao PostgreSQL de produção ou alteração de código funcional. `SEC-DATA-01` e `GATE-DB-42501` não foram tocados.

## Veredito

```
P04_IMPLEMENTATION          = COMPLETE
P04_AUTOMATED_HOMOLOGATION  = PASS
P04_DOCUMENTATION           = CLOSED   (conteúdo fechado; ver "Pendências declaradas" — 1 campo administrativo)
PRODUCTION_RELEASE          = NOT_AUTHORIZED
```

`P04_AUTOMATED_HOMOLOGATION = PASS` significa: o commit `78e9fe2` foi aprovado pelo CI real do GitHub, inclusive 27/27 cenários do Explorer e 29/29 de regressão em navegador real contra Next.js, NestJS, Prisma e PostgreSQL reais. **Não** significa que o módulo foi publicado, implantado ou homologado em servidor.

## 1. Resultados comprovados

```
P04_QA_04R_RESULT     = PASS
CI_77                 = PASS
EXPLORER_E2E          = 27/27
PRODUCT_REGRESSION    = 29/29
FAILED                = 0
FLAKY                 = 0
SKIPPED               = 0
ARTIFACT_SANITIZATION = PASS
ARTIFACT_UPLOAD       = VERIFIED
PR_7                  = DRAFT
MERGE_EXECUTED        = NO
PRODUCTION_DEPLOYS    = 0
```

| Verificação do PR #7 (run #77) | Resultado |
|---|---|
| Tipos | verde |
| Builds (API e web) | verde (1m 20s) |
| Testes e verificação de RLS (inclui isolamento HTTP do Explorer, suíte completa e portão de RLS) | verde (1m 58s) |
| E2E real (Playwright) | verde (3m 3s) |
| Resultado do CI | verde |

**Origem dos números.** As contagens vêm da **saída de texto do passo “Resumo dos testes (contagem por estado, do relatório bruto)”** do log do job “E2E real (Playwright)”: `explorer: esperados(passaram)=27 inesperados(falharam)=0 instaveis=0 pulados=0` e `regressao: esperados(passaram)=29 inesperados(falharam)=0 instaveis=0 pulados=0`. Foram lidas no log, **não inferidas** de os passos estarem verdes. A Executora não tem acesso direto ao Actions; o trecho do log foi enviado pelo proprietário em captura de tela.

**Não inspecionado:** o diagnóstico de marcadores por categoria de campo do passo “Montar a saída publicável e sanitizada” e o conteúdo do artefato `e2e-evidencias`. O passo de sanitização, a varredura e o upload terminaram verdes.

**Anotações do run (sem relação com os testes):** aviso de que `actions/upload-artifact@v4` declara Node 20 e é executado em Node 24 pelo runner; aviso de que o rótulo `ubuntu-latest` migra para Ubuntu 26 a partir de 19/10/2026. Nenhum alterou o resultado.

## 2. Histórico técnico (o que foi corrigido para chegar ao PASS)

| Tema | O que aconteceu | Onde está |
|---|---|---|
| Sincronização entre resposta HTTP e renderização React | No #76, E2E-05a leu o DOM logo após o `200` da expansão, antes do React desenhar os nós, e viu 0 motivos de score embora a API tivesse devolvido 8. Defeito de **teste**. `carregarRelacao` passou a esperar cada nó devolvido pela API estar no SVG (sem pausa fixa) e E2E-05a exige a contagem exata de `SCORE_REASON`. E2E-05b só “não executou” por dependência serial | `apps/web/e2e/explorer-support.ts`, `explorer-02-…spec.ts` · QA-04R, causa A |
| Healthcheck degradado sem scraper | O `/api/v1/health` agrega banco, Redis e scraper; só o scraper degrada. O scraper não sobe no E2E e o provider é `mock`, então `API degraded` é o estado **correto**. O teste agora confere o payload real (banco e Redis `ok`; status coerente com o scraper) e o rodapé; o CI imprime os três componentes separados e reprova se banco ou Redis não estiverem `ok`. Healthcheck não foi afrouxado e não há scraper falso | `fluxo-1-sessao-e-dashboard.spec.ts`, `ci.yml` · QA-04R, causa B |
| Sanitização dos relatórios Playwright | O relatório bruto continha marcadores sensíveis e a varredura do #76 bloqueou corretamente a publicação. Agora o bruto fica em `$RUNNER_TEMP`; `sanitizar-resultados.mjs` monta a saída publicável por **lista permitida** de campos, relê o que gravou e, achando marcador, apaga o arquivo e reprova. Relatório HTML, JSON bruto e anexos de falha não são publicados. Sem `continue-on-error` nem `|| true` | `apps/web/e2e/ci/sanitizar-resultados.mjs`, `ci.yml` · QA-04R, causa C |
| Isolamento de sessão e de workspace | A troca de sessão em outra aba descarta o Explorer na hora (QA-03: `BroadcastChannel` após confirmação da API, com checagem periódica de 20 s como rede de segurança) e o isolamento Alfa × Beta é garantido por RLS e por prova de profundidade assinada. Até a QA-03 isso só tinha evidência de bancada; agora E2E-06 e E2E-07 passam em navegador real (incluindo remoção do relógio de 20 s da página e resposta atrasada retida) | QA-01/02/03; `explorer-03-isolamento-e-sessao.spec.ts` |
| E2E real com Prisma, NestJS, Next.js e PostgreSQL | Job `e2e`: PostgreSQL 16 efêmero + Redis, migrations em dois estágios, seed, fixtures sintéticas, `nest build` + `next build`, API (só com credenciais de runtime) e Next em produção atrás de um gateway same-origin que apenas repassa, e Chromium/Playwright. Sem simulação de Prisma, Next, HTTP ou autenticação; sem `test.skip`, retry ou `waitForTimeout`; `Resultado do CI` exige o job | QA-04 · `qa/E2E-REAL.md` |

Linha do tempo de commits: `0028802` (QA-03, CI #75 verde sem teste de navegador) → `84a96c6` (QA-04, #76: Explorer 25/27, regressão 28/29, sanitização bloqueou) → `78e9fe2` (QA-04R, #77: 27/27 e 29/29).

## 3. Limitações (continuam valendo)

1. Os testes E2E usaram **fixtures sintéticas** (Alfa enriquecido e Beta), em banco efêmero do runner; não há dado de cliente.
2. Os **limites extremos de 60 nós por resposta e de 150 nós no canvas não foram exercitados pelo navegador** (a maior página das fixtures tem 25 nós e o grafo chega a ~40). Têm cobertura anterior em testes unitários/HTTP da API e na bancada de volume da QA-01 (3.000 leads, 35 mil notas), não em E2E.
3. **Não houve implantação em servidor de homologação** nem em produção. O E2E roda num runner efêmero.
4. O scraper não participa do E2E: só o ramo `degraded` do rodapé ocorre no CI.
5. **`SEC-DATA-01` permanece separado** e **`GATE-DB-42501` permanece em sua própria trilha** (coleta pendente; T1 não antecipada). Nenhum dos dois foi iniciado ou tocado.
6. A **integração real com IA e com providers investigativos não faz parte desta versão** (somente contrato tipado; nenhuma resposta simulada).
7. “Troca de workspace” não tem tela própria no produto (o workspace muda pelo login); é exercitada como mudança de identidade.
8. O reporter `list` do Playwright imprime erros no **log do job** do GitHub, que não passa pelo sanitizador; as senhas do CI são descartáveis e restritas ao job.

## 4. Segurança das evidências

- Artefato do Actions: **`e2e-evidencias`**, produzido pelo passo “Publicar evidências sanitizadas” do run #77 (verde). Conteúdo previsto: `e2e-publicavel/RESUMO.md`, `resultado-publicavel.json` por etapa, capturas sintéticas e logs `api`/`web`/`gateway`. Retenção configurada no workflow: **`retention-days: 30`**.
- **ID do artefato e data de expiração: não observados pela Executora** (ver “Pendências declaradas”). Não foram inventados nem estimados como se fossem exatos.
- Só referências e evidências **sanitizadas** são preservadas nestes documentos. Nenhuma credencial, cookie, token ou dado de sessão foi inserido; as senhas descartáveis do CI não aparecem em nenhum documento. O relatório bruto do Playwright (JSON, HTML, anexos) nunca é publicado.

## 5. Pendências declaradas

1. **ID do artefato `e2e-evidencias` e sua data de expiração** — a ordem pede o registro; a Executora não tem acesso ao Actions. O proprietário informa os dois valores (página **Summary** do run #77 → seção **Artifacts**; o ID é o número no fim do link `…/runs/41450846331/artifacts/<ID>`; a expiração aparece ao lado do artefato). Enquanto isso, o item permanece marcado como pendente, sem valor.
2. **CI do commit documental.** O workflow dispara em `pull_request` para `main`; a publicação deste commit deve gerar um novo run (#78). **Este commit só é considerado validado depois que o resultado desse run for registrado.** Até lá: `FINAL_DOC_COMMIT_VALIDATED = PENDING`.
3. Nota (fora do escopo desta ordem, nada alterado): `actions/upload-artifact@v4` aponta para versão em Node 20; e `ubuntu-latest` está migrando para Ubuntu 26. Se um run futuro falhar ao instalar o Chromium, fixar `ubuntu-24.04` no job `e2e` é o ajuste provável — exigiria ordem própria.

## 6. Próximo passo

`PRODUCTION_RELEASE = NOT_AUTHORIZED`. Qualquer publicação controlada (tirar o PR #7 de rascunho, merge, deploy com checklist e janela próprios) depende de ordem separada. A Executora para aqui e aguarda instruções.
