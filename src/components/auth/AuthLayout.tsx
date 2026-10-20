import Link from 'next/link';
import { SunsetSun } from '@/components/ui/SunsetSun';
import { TerminalPanel } from '@/components/ui/TerminalPanel';

interface AuthLayoutProps {
  /** Window title, e.g. "LOGIN.EXE" */
  title: string;
  children: React.ReactNode;
}

/** Centered terminal window over the sun and the grid floor, shared by every auth page. */
export function AuthLayout({ title, children }: AuthLayoutProps) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-night px-4 py-10">
      <div className="synth-grid" aria-hidden="true" />
      <div className="synth-horizon" aria-hidden="true" />
      <main className="relative z-10 w-full max-w-md">
        <Link href="/welcome" className="mb-6 flex flex-col items-center gap-3" aria-label="Forgetting Forecast home">
          <SunsetSun size={84} />
          <span className="font-display text-sm font-black uppercase tracking-[0.18em] text-ink">
            Forgetting <span className="text-magenta text-glow-magenta">Forecast</span>
          </span>
        </Link>
        <TerminalPanel title={title}>{children}</TerminalPanel>
      </main>
    </div>
  );
}

export default AuthLayout;
