'use client';

import { useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

export interface ForecastAttemptPoint {
  /** ms since epoch */
  at: number;
  /** The probability the model predicted just before this attempt. */
  predicted: number;
  correct: boolean;
}

export type ForecastHorizonDays = 1 | 7 | 30;

export interface ForecastCurveProps {
  /** Predicted recall probability (0-1) at a given time, from the current recall state. */
  predict: (at: Date) => number;
  /** ms since epoch of the last review: the curve starts there (the earlier state is not known). Null = from `now`. */
  lastReviewedAt: number | null;
  attempts: ForecastAttemptPoint[];
  now: number;
  targetRecall?: number;
  horizonDays?: ForecastHorizonDays;
  onHorizonChange?: (days: ForecastHorizonDays) => void;
  /** Accessible name, e.g. the concept title. */
  title?: string;
  className?: string;
  /** Skip the draw-in animation (e.g. for static previews). */
  animate?: boolean;
}

const W = 640;
const H = 280;
const M = { top: 16, right: 16, bottom: 30, left: 40 };
const HOUR = 3_600_000;

function fmtOffset(ms: number): string {
  const abs = Math.abs(ms);
  const sign = ms < 0 ? '-' : '+';
  if (abs < HOUR) return 'now';
  if (abs < 48 * HOUR) return `${sign}${Math.round(abs / HOUR)}h`;
  return `${sign}${Math.round(abs / (24 * HOUR))}d`;
}

/** The product's hero visual: neon predicted-recall line, observed attempts, NOW marker and target line. Pure SVG. */
export function ForecastCurve({
  predict,
  lastReviewedAt,
  attempts,
  now,
  targetRecall = 0.8,
  horizonDays: initialHorizon = 7,
  onHorizonChange,
  title = 'Forecast',
  className,
  animate = true,
}: ForecastCurveProps) {
  const uid = useId();
  const [horizon, setHorizon] = useState<ForecastHorizonDays>(initialHorizon);
  const horizonMs = horizon * 24 * HOUR;

  // 20% of the width is the past, so NOW sits at ~1/5 of the plot.
  const start = now - horizonMs * 0.25;
  const end = now + horizonMs;
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const x = (t: number) => M.left + ((t - start) / (end - start)) * plotW;
  const y = (p: number) => M.top + (1 - p) * plotH;

  const { path, atNow, atEnd } = useMemo(() => {
    const from = Math.max(start, lastReviewedAt ?? now);
    const steps = 120;
    const pts: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = from + ((end - from) * i) / steps;
      pts.push(`${i === 0 ? 'M' : 'L'}${x(t).toFixed(1)},${y(predict(new Date(t))).toFixed(1)}`);
    }
    return { path: pts.join(' '), atNow: predict(new Date(now)), atEnd: predict(new Date(end)) };
    // x/y are derived from start/end only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [predict, lastReviewedAt, now, start, end]);

  const visible = attempts.filter(a => a.at >= start && a.at <= now);
  const hidden = attempts.length - visible.length;
  const correct = visible.filter(a => a.correct).length;
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const xTicks = [start, now, now + horizonMs / 2, end];

  const choose = (d: ForecastHorizonDays) => {
    setHorizon(d);
    onHorizonChange?.(d);
  };

  const summary =
    `${title}: estimated recall is ${Math.round(atNow * 100)}% now and ${Math.round(atEnd * 100)}% in ${horizon} ` +
    `${horizon === 1 ? 'day' : 'days'} without another review. Target is ${Math.round(targetRecall * 100)}%. ` +
    `${visible.length} observed attempts in view, ${correct} correct${hidden > 0 ? `, ${hidden} older not shown` : ''}.`;

  return (
    <figure className={cn('w-full', className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <figcaption className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-dim">
          Predicted recall · ESTIMATE
        </figcaption>
        <div role="radiogroup" aria-label="Forecast horizon" className="flex overflow-hidden rounded border border-line">
          {([1, 7, 30] as const).map(d => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={horizon === d}
              onClick={() => choose(d)}
              className={cn(
                'px-3 py-1 font-mono text-[11px] font-semibold tracking-wider transition-colors',
                horizon === d ? 'bg-cyan text-void' : 'bg-transparent text-ink-dim hover:text-ink'
              )}
            >
              {d}D
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${uid}-t ${uid}-d`} className="h-auto w-full">
        <title id={`${uid}-t`}>{`${title}: predicted recall over time`}</title>
        <desc id={`${uid}-d`}>{summary}</desc>

        {/* grid */}
        {yTicks.map(p => (
          <g key={p}>
            <line x1={M.left} x2={W - M.right} y1={y(p)} y2={y(p)} stroke="var(--color-line)" strokeWidth={p === 0 ? 1.5 : 1} opacity={p === 0 ? 1 : 0.55} />
            <text x={M.left - 6} y={y(p) + 3.5} textAnchor="end" fontSize={10} className="font-mono" fill="var(--color-ink-dim)">
              {Math.round(p * 100)}%
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={x(t)} y={H - 8} textAnchor={i === 0 ? 'start' : i === 3 ? 'end' : 'middle'} fontSize={10} className="font-mono" fill="var(--color-ink-dim)">
            {fmtOffset(t - now)}
          </text>
        ))}

        {/* target line */}
        <line x1={M.left} x2={W - M.right} y1={y(targetRecall)} y2={y(targetRecall)} stroke="var(--color-watch)" strokeWidth={1} strokeDasharray="5 4" opacity={0.85} />
        <text x={W - M.right} y={y(targetRecall) - 5} textAnchor="end" fontSize={10} className="font-mono" fill="var(--color-watch)">
          TARGET {Math.round(targetRecall * 100)}%
        </text>

        {/* NOW marker */}
        <line x1={x(now)} x2={x(now)} y1={M.top} y2={H - M.bottom} stroke="var(--color-ink-dim)" strokeWidth={1} strokeDasharray="3 4" />
        <text x={x(now) + 4} y={M.top + 9} fontSize={10} className="font-mono" fill="var(--color-ink)">
          NOW
        </text>

        {/* predicted recall */}
        <path
          d={path}
          pathLength={1}
          fill="none"
          stroke="var(--color-cyan)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            filter: 'drop-shadow(0 0 5px var(--color-cyan))',
            strokeDasharray: 1,
            ['--path-length' as string]: 1,
            animation: animate ? 'draw-in 900ms ease-out both' : undefined,
          }}
        />

        {/* observed attempts: filled magenta = correct, hollow = incorrect */}
        {visible.map((a, i) =>
          a.correct ? (
            <circle key={i} cx={x(a.at)} cy={y(a.predicted)} r={5} fill="var(--color-magenta)" stroke="var(--color-void)" strokeWidth={1.5} style={{ filter: 'drop-shadow(0 0 4px var(--color-magenta))' }}>
              <title>{`Correct recall (predicted ${Math.round(a.predicted * 100)}%)`}</title>
            </circle>
          ) : (
            <circle key={i} cx={x(a.at)} cy={y(a.predicted)} r={5} fill="var(--color-night)" stroke="var(--color-due)" strokeWidth={2}>
              <title>{`Missed recall (predicted ${Math.round(a.predicted * 100)}%)`}</title>
            </circle>
          )
        )}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] text-ink-dim">
        <span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-4 bg-cyan" /> predicted</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full bg-magenta" /> correct · OBSERVED</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full border-2 border-due" /> missed · OBSERVED</span>
        {hidden > 0 && <span>{hidden} older attempt{hidden === 1 ? '' : 's'} not shown</span>}
      </div>
      <p className="sr-only">{summary}</p>
    </figure>
  );
}

export default ForecastCurve;
