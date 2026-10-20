import { cn } from '@/lib/utils';

export type StatTag = 'estimate' | 'observed' | 'sample';

const tagStyles: Record<StatTag, { label: string; classes: string }> = {
  estimate: { label: 'ESTIMATE', classes: 'border-cyan/40 text-cyan' },
  observed: { label: 'OBSERVED', classes: 'border-strong/40 text-strong' },
  sample: { label: 'SAMPLE DATA', classes: 'border-sunset/40 text-sunset' },
};

export interface StatTileProps {
  label: string;
  /** null renders an em dash plus emptyHint: never invent a number. */
  value: React.ReactNode | null;
  unit?: string;
  tag?: StatTag;
  foot?: React.ReactNode;
  glow?: 'magenta' | 'cyan' | 'none';
  emptyHint?: string;
  icon?: React.ReactNode;
  className?: string;
}

export function StatTile({ label, value, unit, tag, foot, glow = 'none', emptyHint, icon, className }: StatTileProps) {
  const empty = value === null || value === undefined;
  return (
    <div
      className={cn(
        'rounded-lg border border-line bg-panel/85 p-4 backdrop-blur-sm',
        'shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]',
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-dim">{label}</p>
        {icon && <span className="text-ink-dim" aria-hidden="true">{icon}</span>}
      </div>
      <p
        className={cn(
          'mt-3 font-display text-3xl font-bold tabular-nums leading-none',
          empty ? 'text-neutral-400' : 'text-ink',
          !empty && glow === 'magenta' && 'text-glow-magenta',
          !empty && glow === 'cyan' && 'text-glow-cyan'
        )}
      >
        {empty ? '—' : value}
        {!empty && unit && <span className="ml-1 font-mono text-sm font-normal text-ink-dim">{unit}</span>}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {tag && (
          <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.14em]', tagStyles[tag].classes)}>
            {tagStyles[tag].label}
          </span>
        )}
        {(empty ? emptyHint : foot) && <span className="font-mono text-[11px] text-ink-dim">{empty ? emptyHint : foot}</span>}
      </div>
    </div>
  );
}

export default StatTile;
