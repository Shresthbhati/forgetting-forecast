'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

export interface CalibrationBucketPoint {
  /** Mean predicted probability in the bucket (0-1) */
  predictedMean: number;
  /** Observed fraction correct in the bucket (0-1) */
  observedAccuracy: number;
  count: number;
}

export interface CalibrationChartProps {
  buckets: CalibrationBucketPoint[];
  /** Buckets with fewer attempts than this are drawn hollow and marked "low sample". */
  minCount?: number;
  className?: string;
}

const S = 360;
const M = { top: 12, right: 14, bottom: 36, left: 40 };

/** Reliability diagram: predicted bucket against observed frequency, with the diagonal as the reference. */
export function CalibrationChart({ buckets, minCount = 5, className }: CalibrationChartProps) {
  const uid = useId();
  const plot = S - M.left - M.right;
  const x = (p: number) => M.left + p * plot;
  const y = (p: number) => M.top + (1 - p) * plot;

  if (buckets.length === 0) {
    return <p className={cn('py-10 text-center font-mono text-xs text-ink-dim', className)}>No calibration data yet.</p>;
  }

  const maxCount = Math.max(...buckets.map(b => b.count));
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const summary = buckets
    .map(b => `predicted ${Math.round(b.predictedMean * 100)}%, observed ${Math.round(b.observedAccuracy * 100)}%, n=${b.count}${b.count < minCount ? ' (low sample)' : ''}`)
    .join('; ');

  return (
    <figure className={cn('w-full', className)}>
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-labelledby={`${uid}-t ${uid}-d`} className="mx-auto h-auto w-full max-w-[420px]">
        <title id={`${uid}-t`}>Calibration: predicted recall versus observed frequency</title>
        <desc id={`${uid}-d`}>{summary}</desc>

        {ticks.map(p => (
          <g key={p}>
            <line x1={M.left} x2={S - M.right} y1={y(p)} y2={y(p)} stroke="var(--color-line)" opacity={0.5} />
            <line x1={x(p)} x2={x(p)} y1={M.top} y2={S - M.bottom} stroke="var(--color-line)" opacity={0.5} />
            <text x={M.left - 6} y={y(p) + 3.5} textAnchor="end" fontSize={10} className="font-mono" fill="var(--color-ink-dim)">{Math.round(p * 100)}%</text>
            <text x={x(p)} y={S - M.bottom + 14} textAnchor="middle" fontSize={10} className="font-mono" fill="var(--color-ink-dim)">{Math.round(p * 100)}%</text>
          </g>
        ))}
        <text x={M.left + plot / 2} y={S - 6} textAnchor="middle" fontSize={10} className="font-mono" fill="var(--color-ink-dim)">PREDICTED</text>
        <text transform={`rotate(-90 11 ${M.top + plot / 2})`} x={11} y={M.top + plot / 2} textAnchor="middle" fontSize={10} className="font-mono" fill="var(--color-ink-dim)">OBSERVED</text>

        {/* perfect calibration */}
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--color-watch)" strokeDasharray="5 4" opacity={0.85} />

        {buckets.map((b, i) => {
          const r = 4 + 7 * Math.sqrt(b.count / maxCount);
          const low = b.count < minCount;
          return (
            <g key={i}>
              <circle
                cx={x(b.predictedMean)}
                cy={y(b.observedAccuracy)}
                r={r}
                fill={low ? 'var(--color-night)' : 'var(--color-cyan)'}
                fillOpacity={low ? 1 : 0.85}
                stroke={low ? 'var(--color-ink-dim)' : 'var(--color-cyan)'}
                strokeWidth={low ? 1.5 : 1}
                strokeDasharray={low ? '2 2' : undefined}
                style={low ? undefined : { filter: 'drop-shadow(0 0 4px var(--color-cyan))' }}
              >
                <title>{`predicted ${Math.round(b.predictedMean * 100)}%, observed ${Math.round(b.observedAccuracy * 100)}%, n=${b.count}${low ? ' (low sample)' : ''}`}</title>
              </circle>
              <text x={x(b.predictedMean)} y={y(b.observedAccuracy) - r - 3} textAnchor="middle" fontSize={9} className="font-mono" fill="var(--color-ink-dim)">
                n={b.count}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 font-mono text-[11px] text-ink-dim">
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full bg-cyan" /> bucket (size = n)</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-ink-dim" /> low sample (n &lt; {minCount})</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-4 bg-watch" /> perfect calibration</span>
      </div>
      <p className="sr-only">{summary}</p>
    </figure>
  );
}

export default CalibrationChart;
