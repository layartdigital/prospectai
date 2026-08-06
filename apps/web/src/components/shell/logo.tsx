import { cn } from '@/lib/utils';

/**
 * Logo textual PropectAI.
 * "PROPECT" em azul-marinho, "AI" em azul vivo - conceito Prospect + AI.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn('select-none text-[17px] font-bold tracking-tight', className)}
      aria-label="PropectAI"
    >
      <span className="text-navy-900">PROPECT</span>
      <span className="text-brand-600"> AI</span>
    </span>
  );
}
