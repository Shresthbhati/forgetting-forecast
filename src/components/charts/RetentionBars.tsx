import { cn } from '@/lib/utils';
import { pillFromProbability, StatusPill } from '@/components/ui';

export interface RetentionBarItem {
  id: string;
  label: string;
  /** 0-1 recall probability */
  value: number;
}

export interface RetentionBarsProps {
  items: RetentionBarItem[];
  targetRecall?: number;
  emptyText?: string;
  className?: string;
  onSelect?: (id: string) => void;
}

const fill = { strong: 'bg-strong', watch: 'bg-watch', due: 'bg-due', pending: 'bg-ink-dim' } as const;

/** Horizontal bars per concept, coloured by status, with the percentage and a status label in mono. */
export function RetentionBars({ items, targetRecall = 0.8, emptyText = 'Nothing to show yet.', className, onSelect }: RetentionBarsProps) {
  if (items.length === 0) {
    return <p className={cn('py-6 text-center font-mono text-xs text-ink-dim', className)}>{emptyText}</p>;
  }

  const summary = items.map(i => `${i.label} ${Math.round(i.value * 100)}%`).join('; ');

  return (
    <div className={className}>
      <ul className="space-y-3" aria-label="Retention by concept">
        {items.map(item => {
          const status = pillFromProbability(item.value, targetRecall);
          const pct = Math.round(item.value * 100);
          const Row = onSelect ? 'button' : 'div';
          return (
            <li key={item.id}>
              <Row
                {...(onSelect ? { type: 'button' as const, onClick: () => onSelect(item.id) } : {})}
                className={cn('block w-full text-left', onSelect && 'rounded transition-colors hover:bg-panel-hi/60')}
              >
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="truncate text-sm text-ink">{item.label}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <StatusPill status={status} />
                    <span className="w-10 text-right font-mono text-xs font-semibold tabular-nums text-ink">{pct}%</span>
                  </span>
                </div>
                <div className="relative h-2 overflow-hidden rounded-sm bg-panel-hi" aria-hidden="true">
                  <div className={cn('h-full rounded-sm', fill[status])} style={{ width: `${pct}%`, boxShadow: '0 0 8px currentColor' }} />
                  <span className="absolute inset-y-0 w-px bg-ink/60" style={{ left: `${targetRecall * 100}%` }} />
                </div>
              </Row>
            </li>
          );
        })}
      </ul>
      <p className="sr-only">{summary}</p>
    </div>
  );
}

export default RetentionBars;
