# ⚠️ NÃO RODE O `resolve_domains.py` COMO ESTÁ

**Data:** 22/08/2026
**Motivo:** o script mira o alvo errado para este produto.

---

## O que aconteceu

O `resolve_domains.py` foi escrito para medir **CNPJ → domínio**, a partir de uma análise de mercado feita **sem acesso a este repositório**. A premissa era que o ProspectAI entrava por cadastro de CNPJ, como Econodata e Speedio.

**Está errado.** Depois de ler `CLAUDE.md`, `README.md` e `docs/technical/scoring.md`:

- o produto entra por **busca no Google Maps** (`gosom/google-maps-scraper`), não por CNPJ
- o `website` já vem do scraper — a "ponte" que o script tenta construir **já está resolvida pela fonte de dados**
- multi-tenancy, planos, quotas e score explicável **já existem**

Rodar o script como está mede uma coisa que o produto não faz.

---

## O Gate 0 correto para ESTE produto

A pendência real está declarada no seu próprio `scoring.md`, §7:

> | Sinal | Por que não | Quando |
> |---|---|---|
> | Site não responsivo | Exige buscar e renderizar o site | v0.2, com `WebsiteAuditAgent` |
> | Perfil de Instagram ativo | Exige varredura de redes sociais | v0.2 |
> | Perfil de Facebook ativo | Idem | v0.2 |
> | WhatsApp confirmado | Exige verificação externa | v0.2 |

Esses quatro sinais são `DESCONHECIDO` hoje e **não pontuam**. A v0.2 existe para ligá-los.

**A pergunta que decide se a v0.2 é viável:**

> Dado um lead do Google Maps — nome, endereço, telefone, categoria, site quando existe —
> com que taxa consigo **descobrir e verificar** Instagram, Facebook e WhatsApp?
> E com que taxa de **erro silencioso** — o perfil de outra empresa com nome parecido?

Se a taxa de descoberta for baixa, o `score-v2` nasce com os mesmos `DESCONHECIDO` e a v0.2 não entrega o que promete.

Se o erro silencioso for alto, é pior: viola a regra fundadora do seu próprio scoring — *"o score só pontua o que foi efetivamente observado"* — e marcar o Instagram errado como `PRESENTE` é o mesmo falso positivo que o produto existe para não cometer.

**Limiares sugeridos, a confirmar:** descoberta ≥ 50% · erro silencioso ≤ 3%.

O 3% é mais duro que o do documento original (5%) porque aqui o erro entra no score e o score é o produto.

---

## O que aproveitar do script atual

Duas ideias sobrevivem e valem para o alvo certo:

**1. Verificação determinística.** O script original procurava o CNPJ no HTML do site — se está lá, o vínculo está provado sem opinião humana.

O equivalente aqui: **o site do lead linka para o Instagram/Facebook dele.** Se `vianna-smile-studio.base44.app` tem `<a href="instagram.com/viannasmile">` no HTML, o perfil está confirmado — sem heurística de nome, sem busca, sem palpite.

Isso funciona para todo lead que tem site. Para os `SEM_SITE`, que são os de maior peso no score (+30), não funciona — e é aí que mora a dificuldade real.

**2. Separar CONFIRMADO de CANDIDATO.** Confirmado vira `PRESENTE`. Candidato **fica `DESCONHECIDO`** até verificação. Nunca promova candidato a presente para melhorar a cobertura — é exatamente o defeito do concorrente que o `scoring.md` §8 usa como caso de teste.

---

## Próximo passo

Confirme o recorte antes de eu escrever o script novo. A pergunta em aberto: a descoberta de perfis sociais deve partir **do site do lead** (funciona só para quem tem site) ou também tentar busca por nome + cidade (cobre os `SEM_SITE`, mas é onde o erro silencioso nasce)?

O `resolve_domains.py` fica na pasta como referência das duas ideias acima. **Não o execute.**
