import { BookOpen, LifeBuoy, MessageCircleQuestion, Terminal } from 'lucide-react';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'Ajuda' };

const TOPICS = [
  {
    icon: BookOpen,
    title: 'Como o score é calculado',
    body: 'Cada lead mostra os pesos aplicados com a evidência que os gerou. O score é uma priorização comercial — em que ordem abordar — e não uma previsão de conversão.',
  },
  {
    icon: MessageCircleQuestion,
    title: 'Por que alguns sinais dizem "não verificado"',
    body: 'Instagram, Facebook e WhatsApp não vêm da fonte de coleta. Marcá-los como ausentes sem ter verificado seria falso negativo, então eles aparecem em cinza e não pontuam.',
  },
  {
    icon: LifeBuoy,
    title: 'Cobrança por lead',
    body: 'Você consome crédito apenas por lead novo. Duplicados são atualizados sem custo e buscas que falham devolvem a reserva automaticamente.',
  },
  {
    icon: Terminal,
    title: 'Documentação técnica',
    body: 'A referência da API está em /api/docs. O detalhamento do modelo de dados e do motor de score fica no repositório, em docs/technical.',
  },
];

export default function HelpPage() {
  return (
    <>
      <PageHeader
        title="Central de Ajuda"
        subtitle="Como o produto decide o que decide."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {TOPICS.map((topic) => {
          const Icon = topic.icon;
          return (
            <section key={topic.title} className="pa-card p-4">
              <h2 className="flex items-center gap-2 text-card-title text-navy-900">
                <Icon className="h-4 w-4 text-brand-600" aria-hidden="true" />
                {topic.title}
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-muted">{topic.body}</p>
            </section>
          );
        })}
      </div>

      <p className="mt-4 rounded-card border border-dashed border-line px-4 py-3 text-xs text-muted">
        Tutoriais em vídeo e suporte por chat entram em versões seguintes. Não
        colocamos cards aqui prometendo o que ainda não existe.
      </p>
    </>
  );
}
