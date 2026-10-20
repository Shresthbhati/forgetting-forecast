import { cn } from '@/lib/utils';

export type PillStatus = 'strong' | 'watch' | 'due' | 'pending';

const config: Record<PillStatus, { label: string; glyph: string; classes: string }> = {
  strong: { label: 'STRONG', glyph: '●', classes: 'border-strong/50 bg-strong/10 text-strong' },
  watch: { label: 'WATCH', glyph: '▲', classes: 'border-watch/50 bg-watch/10 text-watch' },
  due: { label: 'DUE', glyph: '■', classes: 'border-due/60 bg-due/10 text-due' },
  pending: { label: 'PENDING', glyph: '○', classes: 'border-line bg-panel-hi text-ink-dim' },
};

/** Maps the forecast engine's status strings to a pill status. */
export function pillFromForecast(status: string | null | undefined): PillStatus {
  if (status === 'Strong') return 'strong';
  if (status === 'Review soon') return 'watch';
  if (status === 'Due now') return 'due';
  return 'pending';
}

/** Recall probability -> pill status using the same cut-offs as the forecast engine (0.55 / target 0.8). */
export function pillFromProbability(p: number | null | undefined, target = 0.8): PillStatus {
  if (p === null || p === undefined) return 'pending';
  return p < 0.55 ? 'due' : p < target ? 'watch' : 'strong';
}

/** Colour is never the only signal: every status carries a text label and a distinct glyph. */
export function StatusPill({ status, label, className }: { status: PillStatus; /** Overrides the default text, e.g. READY / FAILED for a source. */ label?: string; className?: string }) {
  const c = config[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.14em]',
        c.classes,
        className
      )}
    >
      <span aria-hidden="true">{c.glyph}</span>
      {label ?? c.label}
    </span>
  );
}

export default StatusPill;
