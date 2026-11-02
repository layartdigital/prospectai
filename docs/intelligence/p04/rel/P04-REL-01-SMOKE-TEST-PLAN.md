# P04-REL-01 — E. Plano de smoke tests (pós-publicação)

**Projeto:** ProspectAI · **Módulo:** Intelligence Explorer 0.1.0 · **Responsável:** Executora (QA Automation e Frontend/UX; AppSec no isolamento) · **Versão:** 1.0.0 · **Data:** 02/11/2026
**Relação com a homologação:** valida **no destino** o que o CI #77/#78 provou no runner (56 testes: 27 Explorer + 29 regressão). **Nada deste plano foi executado.** `F:\drmind` (Bellvia) não foi modificado.

## 1. Regras

- **Somente leitura sempre que possível.** O Explorer não grava; os testes dele não criam dado.
- **Sem criar usuário, lead, pesquisa ou registro** na stack sem autorização expressa. O que exigir criação está marcado `REQUIRES_AUTHORIZATION`.
- **Contas:** somente contas de homologação autorizadas pelo proprietário. **Nenhuma credencial entra em documento, script ou captura.** Não usar as credenciais publicadas no `.env.example` (histórico R12).
- Capturas de tela só de telas autenticadas **sem senha visível** e, de preferência, com dados do tenant de demonstração.
- Os testes do CI **não rodam como estão no destino**: as fixtures (`prisma/e2e-explorer-fixtures.ts`) **recusam** banco de host não local, de propósito. Este plano é, portanto, manual (e, se o proprietário quiser, automatizável depois com uma ordem própria).
- Qualquer `FAIL` em S2 (isolamento) aciona **G6: rollback imediato**.

## 2. Camadas

| Camada | Exige conta? | Cria dado? | Objetivo |
|---|---|---|---|
| S0 | não | não | roteamento, saúde, versão, módulo carregado |
| S1 | 1 conta de homologação | não | Explorer e ficha do lead funcionando |
| S2 | **2 contas em workspaces diferentes** | não (a conta nova, se não existir, é `REQUIRES_AUTHORIZATION`) | isolamento multi-tenant e sessão |
| S3 | 1 conta | não | regressão dos módulos anteriores |
| S4 | — | não | não funcionais e provas de "nada mais mudou" |

### S0 — Sem sessão (curl; GET/HEAD)

| ID | Verificação | Esperado |
|---|---|---|
| S0-1 | `GET /login` | 200; rodapé `PropectAI v0.1.1` |
| S0-2 | `GET /api/v1/health` | 200; `checks.database=ok`, `checks.redis=ok`; `status` = `ok` (ou `degraded` **só** se o scraper estiver fora, **igual ao estado de D0**) |
| S0-3 | `GET /api/v1/system/version` | 200; `version` = `0.1.1`; `environment` coerente; `commit` = SHA **se** a opção D8 foi feita, senão `null` (documentado) |
| S0-4 | `GET /intelligence` sem sessão | redirecionamento ao login (não 200) |
| S0-5 | `GET /api/v1/intelligence/graph?leadId=<qualquer>` sem sessão | **401** (rota existe e está protegida; 404 = módulo não carregou) |
| S0-6 | `GET /api/v1/intelligence/expand` sem sessão | **401** |
| S0-7 | HTTPS do domínio de homologação | certificado válido, host correto, `/` e `/api` roteados para a stack **identificada no preflight** |

### S1 — Explorer com 1 conta autorizada

| ID | Cenário | Esperado |
|---|---|---|
| S1-1 | Menu lateral | item **Intelligence** presente e navegável |
| S1-2 | `/intelligence` autenticado | página abre; estado vazio com busca de lead; **nenhum modal de bloqueio** |
| S1-3 | Busca de lead e seleção | lead vira a raiz do grafo; grafo inicial com os nós relacionados do próprio workspace |
| S1-4 | Expansão de relações | botões "Carregar relações" com contagem; 8 por página, "Completo" ao esgotar; **sem nó duplicado** |
| S1-5 | Filtros por tipo, zoom (botões e teclado), enquadrar | funcionam; zoom visível em % |
| S1-6 | Painel de detalhes e **proveniência** | mostra origem e verificação de cada relação; sinais `Desconhecido`/`Presente`/`Ausente` conforme o dado |
| S1-7 | Teclado e leitor de tela | foco/Enter seleciona nó; lista alternativa disponível |
| S1-8 | Estados vazio e erro | lead sem relações = estado vazio; id inexistente/malformado = mensagem neutra |
| S1-9 | **Ficha do lead → "Explorar relações"** | abre `/intelligence?lead=<id>` com **o lead correto** como raiz; nada de outro lead |
| S1-10 | Lead removido logicamente | não aparece na busca nem no grafo |
| S1-11 | Console do navegador | **sem exceções não tratadas** |
| S1-12 | Responsividade 1440 / 820 / 390 | sem rolagem horizontal; controles de zoom com alvo ≥ 32 px |
| S1-13 | Profundidade | expandir até o 3º nível funciona; além dele o servidor recusa com mensagem na tela |
| S1-14 | Maior lead disponível (volume) | carrega sem travar; respeita 60 nós por resposta (R14) |

### S2 — Isolamento e sessão (**2 workspaces**)

Pré-condição: contas **A** e **B** de workspaces diferentes, com ao menos um lead cada. Se B não existir, criar via cadastro normal é `REQUIRES_AUTHORIZATION` e deve ser **marcada como conta de teste** (R11).

| ID | Cenário | Esperado |
|---|---|---|
| S2-1 | B busca no Explorer | **só** leads de B |
| S2-2 | B abre a URL `/intelligence?lead=<id de A>` | resposta neutra de "não encontrado"; **nenhum dado de A na tela**; API devolve 404 |
| S2-3 | B abre `/leads/<id de A>` | 404; nada de A |
| S2-4 | B reaproveita a prova de profundidade de um nó de A na API (`expand`) | **recusada** (400/403) |
| S2-5 | Duas janelas simultâneas (A e B, perfis de navegador separados) | sem mistura de nós |
| S2-6 | Logout em outra aba | o Explorer descarta o grafo em segundos |
| S2-7 | Login de outro workspace em outra aba | o Explorer da aba antiga descarta os dados de A (não os mostra a B) |
| S2-8 | Troca silenciosa de sessão + voltar à aba (foco) | descarte ao voltar |
| S2-9 | Lead excluído logicamente de A | B e A **não** o veem |

**Qualquer FAIL em S2 = G6.** Registrar o que apareceu sem copiar dado pessoal para o relatório.

### S3 — Regressão operacional (1 conta)

Dashboard (cartões e números coerentes); lista de leads (paginação, filtros, ordenação); ficha do lead (todas as abas, notas, atividades); pipeline (colunas, mover cartão **só se autorizado**, pois grava); pesquisa/nova busca (abre; **não disparar coleta** sem autorização — consome scraper e cria dados); scores e motivos; login e logout; planos e entitlements (nenhum modal abre sozinho); onboarding (apenas abrir); rodapé com versão; itens de menu levam a páginas que funcionam. Quem grava (mover cartão, nova busca) é `REQUIRES_AUTHORIZATION`.

### S4 — Não funcionais e "nada mais mudou"

| ID | Verificação | Esperado |
|---|---|---|
| S4-1 | `StartedAt` de `worker`, `gateway`, `postgres`, `redis`, `gmaps-scraper` | idêntico ao de `startedat-antes-<STAMP>.txt` |
| S4-2 | `RestartCount` de `api` e `web` | 0 |
| S4-3 | Log da API (últimos 10 min, **filtrado**) | sem `Error`/`CredencialDeBancoAusente`; **nenhuma senha ou token** |
| S4-4 | API roda como `propectai_app` | confirmado pelo comando de D5 (mascarado) |
| S4-5 | Latência | `/login` e `/api/v1/health` respondem em tempo normal; expansão do grafo em poucos segundos |
| S4-6 | Banco | **nenhuma** escrita causada pelo Explorer (leitura apenas) — conferir que o smoke não deixou registros |
| S4-7 | Carga no host | `uptime`/`free` sem degradação sustentada após o build |

## 3. Critérios de aprovação

- **Aprovado** quando: todos os testes S0, S1, S2 e S4 obrigatórios passam; S3 sem regressão nos módulos exercitáveis sem criar dado; nenhum item `REQUIRES_AUTHORIZATION` foi executado sem autorização; capturas sintéticas anexadas; registro de release preenchido.
- **Reprovado (rollback)** em qualquer gatilho G1–G9 do plano de rollback.
- **Aprovado com limitações** quando só S3 parcial (por falta de autorização para testes que gravam) e o proprietário aceita por escrito.

## 4. Evidências

Tabela `S0…S4` com resultado, hora UTC e SHA; capturas PNG **sem credenciais**; saídas dos comandos de verificação; nenhum dado pessoal de terceiros (regra 6 do projeto).
