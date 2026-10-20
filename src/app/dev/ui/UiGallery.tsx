'use client';

import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  Input,
  ProgressRing,
  Select,
  Skeleton,
  StatTile,
  StatusPill,
  SunsetSun,
  Textarea,
  TerminalPanel,
  useToast,
} from '@/components/ui';
import { CalibrationChart, ForecastCurve, RetentionBars, Sparkline } from '@/components/charts';

const HOUR = 3_600_000;
const FIXTURE_NOW = Date.parse('2026-10-20T12:00:00Z');

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="font-display text-lg font-bold uppercase tracking-[0.08em] text-chrome">{title}</h2>
      {children}
    </section>
  );
}

/** Visual QA sheet for the UI primitives and charts. Fixture data lives here only, never in production code. */
export function UiGallery() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  // A fixed fixture time keeps server and client renders identical (no hydration mismatch).
  const now = FIXTURE_NOW;

  // fixture: last review 30h ago, half-life 40h, difficulty 3
  const last = now - 30 * HOUR;
  const predict = useMemo(() => (at: Date) => Math.max(0.01, 0.93 * 0.5 ** ((at.getTime() - last) / (40 * HOUR))), [last]);
  const attempts = [
    { at: now - 5.5 * 24 * HOUR, predicted: 0.62, correct: false },
    { at: now - 4 * 24 * HOUR, predicted: 0.81, correct: true },
    { at: now - 2.2 * 24 * HOUR, predicted: 0.78, correct: true },
    { at: last, predicted: 0.74, correct: true },
  ];
  const buckets = [
    { predictedMean: 0.15, observedAccuracy: 0.2, count: 4 },
    { predictedMean: 0.45, observedAccuracy: 0.4, count: 12 },
    { predictedMean: 0.65, observedAccuracy: 0.7, count: 30 },
    { predictedMean: 0.85, observedAccuracy: 0.82, count: 58 },
  ];
  const retention = [
    { id: '1', label: 'Binary search complexity', value: 0.91 },
    { id: '2', label: 'Normal forms (3NF)', value: 0.64 },
    { id: '3', label: 'Action potential depolarization', value: 0.38 },
    { id: '4', label: 'Never reviewed yet', value: 0.5 },
  ];

  return (
    <main className="container space-y-12 py-10">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-dim">// DEV · UI QA SHEET</p>
        <h1 className="font-display text-3xl font-black uppercase tracking-[0.08em] text-chrome">Forgetting Forecast UI</h1>
        <p className="mt-2 max-w-prose text-ink-dim">Every primitive in every state. Not linked from the nav; returns 404 in production.</p>
      </header>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button size="icon" variant="secondary" aria-label="Icon button">★</Button>
        </div>
      </Section>

      <Section title="Fields">
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Text input" placeholder="Type here" helperText="Helper text sits under the field" />
          <Input label="With error" defaultValue="oops" error="This value is not allowed" />
          <Input label="Disabled" disabled defaultValue="locked" />
          <Select label="Select" options={[{ value: 'a', label: 'Option A' }, { value: 'b', label: 'Option B' }]} />
          <div className="md:col-span-2"><Textarea label="Textarea" placeholder="Longer answer" /></div>
        </div>
      </Section>

      <Section title="Badges and status pills">
        <div className="flex flex-wrap items-center gap-3">
          <Badge>Default</Badge>
          <Badge variant="success" dot>Success</Badge>
          <Badge variant="warning" dot>Warning</Badge>
          <Badge variant="danger" dot>Danger</Badge>
          <Badge variant="info" dot>Info</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill status="strong" />
          <StatusPill status="watch" />
          <StatusPill status="due" />
          <StatusPill status="pending" />
        </div>
      </Section>

      <Section title="Panels and cards">
        <div className="grid gap-4 md:grid-cols-2">
          <TerminalPanel title="FORECAST.EXE" actions={<Button size="sm" variant="ghost">Action</Button>}>
            <p className="text-ink-dim">Window-chrome panel with a title bar, dots and a bevel.</p>
          </TerminalPanel>
          <Card hover>
            <CardHeader><CardTitle>Card title</CardTitle><CardDescription>Hoverable card</CardDescription></CardHeader>
            <CardContent className="text-ink-dim">Card content on a translucent panel.</CardContent>
          </Card>
        </div>
      </Section>

      <Section title="Stat tiles">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Due now" value={5} glow="magenta" tag="estimate" foot="~6 min" />
          <StatTile label="At risk in 7d" value={9} tag="estimate" />
          <StatTile label="Delayed accuracy" value="78" unit="%" tag="observed" glow="cyan" foot="n = 40" />
          <StatTile label="Calibration (Brier)" value={null} emptyHint="needs more reviews" />
        </div>
      </Section>

      <Section title="Rings, sparklines, empty and loading states">
        <div className="flex flex-wrap items-center gap-6">
          <ProgressRing value={0.92} />
          <ProgressRing value={0.66} />
          <ProgressRing value={0.31} />
          <ProgressRing value={null} />
          <Sparkline values={[3, 5, 4, 8, 7, 11, 9]} label="Reviews per day" />
          <Sparkline values={[1]} />
          <SunsetSun size={80} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <TerminalPanel title="EMPTY.EXE"><EmptyState title="Nothing due" body="All signals strong. Next review in 6 hours." action={<Button size="sm">Add a concept</Button>} /></TerminalPanel>
          <TerminalPanel title="LOADING.EXE">
            <div className="space-y-3"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-24 w-full" /></div>
          </TerminalPanel>
        </div>
      </Section>

      <Section title="Charts">
        <TerminalPanel title="FORECAST_CURVE.EXE"><ForecastCurve predict={predict} lastReviewedAt={last} attempts={attempts} now={now} title="Binary search complexity" /></TerminalPanel>
        <div className="grid gap-4 lg:grid-cols-2">
          <TerminalPanel title="RETENTION.EXE"><RetentionBars items={retention} /></TerminalPanel>
          <TerminalPanel title="CALIBRATION.EXE"><CalibrationChart buckets={buckets} /></TerminalPanel>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <TerminalPanel title="ZERO_POINTS.EXE"><ForecastCurve predict={predict} lastReviewedAt={null} attempts={[]} now={now} animate={false} title="No attempts" /></TerminalPanel>
          <TerminalPanel title="EMPTY_BARS.EXE"><RetentionBars items={[]} emptyText="No concepts at risk." /></TerminalPanel>
          <TerminalPanel title="EMPTY_CAL.EXE"><CalibrationChart buckets={[]} /></TerminalPanel>
        </div>
      </Section>

      <Section title="Toasts and dialog">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => toast('Concept saved', { variant: 'success' })}>Success toast</Button>
          <Button variant="secondary" onClick={() => toast('NOT SAVED — retry', { variant: 'error', action: { label: 'Retry', onClick: () => toast('Retrying…') } })}>Error toast</Button>
          <Button variant="secondary" onClick={() => toast('Forecast updated: 64% → 81%')}>Info toast</Button>
          <Button onClick={() => setOpen(true)}>Open dialog</Button>
        </div>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="CONFIRM.EXE"
          description="Native dialog: focus is trapped and Esc closes it."
          actions={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" onClick={() => setOpen(false)}>Delete</Button></>}
        >
          <Input label="Type to confirm" placeholder="DELETE" />
        </Dialog>
      </Section>
    </main>
  );
}
