import { cn } from '@/lib/utils';
import { pillFromProbability, type PillStatus } from './StatusPill';

const stroke: Record<PillStatus, string> = {
  strong: 'var(--color-strong)',
  watch: 'var(--color-watch)',
  due: 'var(--color-due)',
  pending: 'var(--color-ink-dim)',
};

export interface ProgressRingProps {
  /** 0-1, or null for "no estimate yet". */
  value: number | null;
  size?: number;
  strokeWidth?: number;
  /** Accessible name, e.g. "Estimated recall". The percentage is appended automatically. */
  label?: string;
  className?: string;
}

export function ProgressRing({ value, size = 64, strokeWidth = 6, label = 'Estimated recall', className }: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = value === null ? 0 : Math.min(1, Math.max(0, value));
  const status = pillFromProbability(value);
  const pct = value === null ? null : Math.round(clamped * 100);

  return (
    <div
      role="img"
      aria-label={pct === null ? `${label}: not available` : `${label}: ${pct}%`}
      className={cn('relative inline-grid place-items-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-line)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={stroke[status]}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          style={{ filter: `drop-shadow(0 0 4px ${stroke[status]})`, transition: 'stroke-dashoffset 600ms ease-out' }}
        />
      </svg>
      <span className="absolute font-mono text-xs font-semibold tabular-nums text-ink" aria-hidden="true">
        {pct === null ? '—' : `${pct}%`}
      </span>
    </div>
  );
}

export default ProgressRing;
