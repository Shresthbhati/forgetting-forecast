import { cn } from '@/lib/utils';

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** CSS colour for the line */
  color?: string;
  /** Accessible description, e.g. "Reviews per day, last 14 days". */
  label?: string;
  className?: string;
}

/** Tiny trend line for stat tiles. Fewer than two points renders nothing but a dash. */
export function Sparkline({ values, width = 96, height = 28, color = 'var(--color-cyan)', label = 'Trend', className }: SparklineProps) {
  if (values.length < 2) {
    return <span className={cn('font-mono text-xs text-neutral-400', className)} aria-label={`${label}: not enough data`}>—</span>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 2;
  const pts = values.map((v, i) => {
    const px = pad + (i / (values.length - 1)) * (width - pad * 2);
    const py = pad + (1 - (v - min) / range) * (height - pad * 2);
    return `${px.toFixed(1)},${py.toFixed(1)}`;
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`${label}: from ${values[0]} to ${values[values.length - 1]}`}
      className={className}
    >
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
    </svg>
  );
}

export default Sparkline;
