# Adapters externos de IA — documentados, não ativados

A v0.1.1 usa apenas o `MockAIProvider`. Este documento descreve como plugar um
provider externo quando houver decisão comercial e chave contratada.

## Contrato

Qualquer provider implementa `AIProvider` (em `@propectai/types`):

```ts
interface AIProvider {
  readonly name: string;
  readonly model: string | null;
  generateOutreach(input: {
    prompt: string;
    channel: OutreachChannel;
    tone: OutreachTone;
  }): Promise<{ content: string; tokensEstimated: number }>;
}
```

Nenhuma camada acima do provider sabe qual está ativo. Trocar significa
escrever uma classe nova e mudar `AI_PROVIDER` no `.env`.

## Restrição que vale para todos

O prompt já carrega apenas dados verificados do lead. O provider externo
precisa receber instrução explícita de **não afirmar nada fora do contexto**.

Um modelo que inventa "vi que vocês atendem em três unidades" produz abordagem
constrangedora e queima o lead — o custo do erro recai sobre o cliente do
PropectAI, não sobre nós. Por isso a instrução de sistema deve conter:

> Use exclusivamente os fatos listados no contexto. Não infira número de
> unidades, tempo de mercado, nome de sócios, faturamento ou qualquer dado
> ausente. Se um dado não estiver no contexto, não o mencione.

## Esqueleto — OpenAI

```ts
export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  readonly model = 'gpt-4o-mini';

  constructor(private readonly apiKey: string) {}

  async generateOutreach(input) {
    // POST https://api.openai.com/v1/chat/completions
    // messages: [{ role: 'system', content: SYSTEM_RULE }, { role: 'user', content: input.prompt }]
    // temperature: 0.7, max_tokens: 400
  }
}
```

## Esqueleto — Anthropic

```ts
export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  readonly model = 'claude-sonnet-4';

  constructor(private readonly apiKey: string) {}

  async generateOutreach(input) {
    // POST https://api.anthropic.com/v1/messages
    // system: SYSTEM_RULE
    // messages: [{ role: 'user', content: input.prompt }]
  }
}
```

## Antes de ativar

1. Chave em variável de ambiente, nunca versionada
2. Rate limit por tenant, além do limite de gerações do plano
3. Custo por geração monitorado — `tokensEstimated` já é gravado em
   `OutreachMessage`
4. Fallback para o mock quando o provider externo falhar: é melhor entregar
   um rascunho simples do que um erro
5. Registrar `provider` e `model` em cada mensagem, para saber depois o que
   gerou o quê

## O que não muda

Na v0.1.1 e enquanto a política não for revista: **nenhuma mensagem é
disparada automaticamente**. O produto gera rascunho, o humano lê, edita e
envia. Isso não é limitação técnica — é decisão de conformidade.
