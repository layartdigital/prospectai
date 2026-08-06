import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-soft text-muted">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <p className="text-sm font-semibold text-navy-900">{title}</p>
        <p className="mt-1 max-w-sm text-xs text-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}
