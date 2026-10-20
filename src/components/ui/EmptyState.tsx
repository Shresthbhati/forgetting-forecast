import { cn } from '@/lib/utils';
import { SunsetSun } from './SunsetSun';

export interface EmptyStateProps {
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  /** Replaces the default striped sun. */
  icon?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, body, action, icon, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-4 py-10 text-center', className)}>
      {icon ?? <SunsetSun size={72} />}
      <h3 className="mt-2 font-display text-base font-bold uppercase tracking-[0.08em] text-ink">{title}</h3>
      {body && <p className="max-w-sm text-sm text-ink-dim">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export default EmptyState;
