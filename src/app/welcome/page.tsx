'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Crosshair, LineChart, Play, Brain, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { SunsetSun } from '@/components/ui/SunsetSun';
import { TerminalPanel } from '@/components/ui/TerminalPanel';
import { ForecastCurve } from '@/components/charts';

const HOUR = 3_600_000;
// A fixed fixture time keeps server and client renders identical; the chart only shows relative offsets.
const FIXTURE_NOW = Date.parse('2026-10-20T12:00:00Z');

const steps = [
  { icon: Brain, title: 'Recall', body: 'Answer short retrieval prompts. Every attempt, confidence rating and response time is recorded.' },
  { icon: LineChart, title: 'Forecast', body: 'A transparent half-life model estimates the chance you will still remember each concept, days ahead.' },
  { icon: Crosshair, title: 'Intervene', body: 'Review what is about to fade, right before it does. Not what you studied most recently.' },
];

export default function WelcomePage() {
  const [demoLoading, setDemoLoading] = useState(false);
  const [error, setError] = useState('');

  const last = FIXTURE_NOW - 20 * HOUR;
  const predict = useMemo(() => (at: Date) => Math.max(0.01, 0.93 * 0.5 ** ((at.getTime() - last) / (52 * HOUR))), [last]);
  const attempts = [
    { at: FIXTURE_NOW - 3.1 * 24 * HOUR, predicted: 0.71, correct: false },
    { at: FIXTURE_NOW - 1.6 * 24 * HOUR, predicted: 0.83, correct: true },
    { at: last, predicted: 0.78, correct: true },
  ];

  const startDemo = async () => {
    setError('');
    setDemoLoading(true);
    try {
      const res = await fetch('/api/demo-login', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Could not start the demo');
      }
      // Full navigation: the server set the session cookie, and AuthProvider must re-initialise to see it.
      window.location.assign('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the demo');
      setDemoLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-night">
      <div className="synth-grid" aria-hidden="true" />
      <div className="synth-horizon" aria-hidden="true" />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <span className="flex items-center gap-2.5">
          <SunsetSun size={30} />
          <span className="font-display text-xs font-black uppercase tracking-[0.16em] text-ink">
            Forgetting <span className="text-magenta">Forecast</span>
          </span>
        </span>
        <nav aria-label="Account" className="flex items-center gap-2">
          <Link href="/auth/signin">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link href="/auth/signup" className="hidden sm:block">
            <Button variant="secondary" size="sm">Sign up</Button>
          </Link>
        </nav>
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="mx-auto flex max-w-4xl flex-col items-center px-4 pb-16 pt-6 text-center sm:px-6">
          <SunsetSun size={200} className="mb-2 sm:mb-4 sm:h-[260px] sm:w-[260px]" />
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-ink-dim">// Memory weather station</p>
          <h1 className="mt-3 font-display text-4xl font-black uppercase leading-[1.05] tracking-[0.04em] text-chrome sm:text-6xl">
            Know what you&apos;ll forget.
          </h1>
          <p className="mt-5 max-w-xl text-base text-ink-dim sm:text-lg">
            Forgetting Forecast predicts your recall and tells you what to review before it fades.
          </p>

          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
            <Button size="lg" onClick={startDemo} loading={demoLoading}>
              <Play size={16} aria-hidden="true" />
              Try the demo
            </Button>
            <Link href="/auth/signup">
              <Button size="lg" variant="secondary">Sign up</Button>
            </Link>
          </div>
          {error && (
            <p role="alert" className="mt-4 rounded border border-danger-200 bg-danger-50 px-3 py-2 font-mono text-xs text-danger-700">
              {error}
            </p>
          )}
          <p className="mt-4 font-mono text-[11px] text-ink-dim">The demo runs on SAMPLE DATA: a simulated learner, not real study history.</p>
        </section>

        {/* Recall -> Forecast -> Intervene */}
        <section aria-labelledby="how" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
          <h2 id="how" className="sr-only">How it works</h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.title} className="relative rounded-lg border border-line bg-panel/85 p-5 backdrop-blur-sm">
                <span className="font-mono text-[11px] tracking-[0.2em] text-ink-dim">STEP 0{i + 1}</span>
                <div className="mt-2 flex items-center gap-3">
                  <s.icon className="h-6 w-6 text-magenta" aria-hidden="true" />
                  <h3 className="font-display text-lg font-bold uppercase tracking-[0.1em] text-ink">{s.title}</h3>
                </div>
                <p className="mt-3 text-sm text-ink-dim">{s.body}</p>
                {i < steps.length - 1 && (
                  <span aria-hidden="true" className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 font-display text-xl text-magenta md:block">▶</span>
                )}
              </li>
            ))}
          </ol>
        </section>

        {/* Preview */}
        <section aria-labelledby="preview" className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
          <h2 id="preview" className="sr-only">Forecast preview</h2>
          <TerminalPanel
            title="MEMORY_WEATHER.EXE"
            actions={<span className="rounded border border-sunset/50 bg-sunset/10 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.14em] text-sunset">SAMPLE DATA</span>}
          >
            <ForecastCurve predict={predict} lastReviewedAt={last} attempts={attempts} now={FIXTURE_NOW} title="Example concept" />
          </TerminalPanel>
        </section>

        {/* Honesty */}
        <section aria-labelledby="honesty" className="mx-auto max-w-4xl px-4 pb-24 sm:px-6">
          <div className="rounded-lg border border-line bg-panel/85 p-6 backdrop-blur-sm sm:p-8">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-6 w-6 text-strong" aria-hidden="true" />
              <h2 id="honesty" className="font-display text-xl font-bold uppercase tracking-[0.08em] text-ink">
                Every forecast is checked against your real delayed results.
              </h2>
            </div>
            <ul className="mt-5 grid gap-3 text-sm text-ink-dim sm:grid-cols-3">
              <li><span className="font-mono text-xs text-cyan">LOGGED</span><br />Each forecast is saved before the outcome is known, and can never be edited.</li>
              <li><span className="font-mono text-xs text-cyan">EVALUATED</span><br />When you review later, the forecast is scored against what actually happened.</li>
              <li><span className="font-mono text-xs text-cyan">COMPARED</span><br />Calibration and a simple baseline show whether the model really helps, with sample sizes.</li>
            </ul>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-line/60 py-6 text-center font-mono text-[11px] text-ink-dim">
        Forgetting Forecast · a transparent prototype
      </footer>
    </div>
  );
}
