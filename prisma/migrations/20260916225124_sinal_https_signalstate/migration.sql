-- `websiteHasHttps` deixa de ser `Boolean?` e passa a `SignalState`.
--
-- Escrita a mao, e o motivo importa: o `prisma migrate dev` gera, para troca de
-- tipo, um `DROP COLUMN` seguido de `ADD COLUMN`. Isso **apagaria os valores**.
-- Migration destrutiva e proibida — `PROMPT 02` §11 e §74 — e aqui nao ha nem
-- necessidade: `ALTER ... TYPE ... USING` converte linha a linha.
--
-- O mapeamento preserva os tres estados, e nenhum deles e inventado:
--
--   true  -> PRESENTE       o site declarado comeca com https://
--   false -> AUSENTE        o site declarado comeca com http://
--   NULL  -> DESCONHECIDO   nao ha site, ou a URL nao e analisavel
--
-- **`NULL` vira `DESCONHECIDO`, nunca `AUSENTE`.** E a regra 4 do `CLAUDE.md`,
-- e e a unica linha deste arquivo que pode estar errada de um jeito que os
-- testes nao pegam — porque um `AUSENTE` indevido pontua no score como se
-- alguem tivesse medido.
--
-- Medido antes de escrever, em 16/09/2026 (`PROVIDER-CONTRACT-v5.md` §7.3):
--   11 linhas NULL, 13 true, 1 false, em 25 presencas digitais.
--   Zero divergencia de tenant em lead_digital_presences, lead_source_records,
--   lead_scores e lead_score_reasons.

-- Defensivo: `Boolean?` nao tem default hoje, mas um default existente
-- bloquearia a troca de tipo com "default for column cannot be cast".
ALTER TABLE "lead_digital_presences"
  ALTER COLUMN "websiteHasHttps" DROP DEFAULT;

ALTER TABLE "lead_digital_presences"
  ALTER COLUMN "websiteHasHttps" TYPE "SignalState"
  USING CASE
    WHEN "websiteHasHttps" IS TRUE  THEN 'PRESENTE'::"SignalState"
    WHEN "websiteHasHttps" IS FALSE THEN 'AUSENTE'::"SignalState"
    ELSE                                 'DESCONHECIDO'::"SignalState"
  END;

-- Depois do `USING` nao restam nulos: o `ELSE` os cobriu.
ALTER TABLE "lead_digital_presences"
  ALTER COLUMN "websiteHasHttps" SET NOT NULL,
  ALTER COLUMN "websiteHasHttps" SET DEFAULT 'DESCONHECIDO';
