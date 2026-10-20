import { cn } from '@/lib/utils';

export interface TerminalPanelProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  /** Window title, e.g. "FORECAST.EXE". Rendered as the panel's heading. */
  title: string;
  /** Controls placed in the title bar, left of the window dots. */
  actions?: React.ReactNode;
  /** Pad the body (default). Pass false for edge-to-edge content such as tables. */
  padded?: boolean;
  headingLevel?: 'h2' | 'h3';
}

/** Y2K window-chrome panel: thin title bar with a mono uppercase label, three dots and a 1px bevel highlight. */
export function TerminalPanel({
  title,
  actions,
  padded = true,
  headingLevel: Heading = 'h2',
  className,
  children,
  ...props
}: TerminalPanelProps) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-lg border border-line bg-panel/85 backdrop-blur-sm',
        'shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_8px_32px_rgb(0_0_0/0.35)]',
        className
      )}
      {...props}
    >
      <header className="flex items-center justify-between gap-3 border-b border-line bg-panel-hi/70 px-3 py-1.5">
        <Heading className="truncate font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-dim">{title}</Heading>
        <div className="flex shrink-0 items-center gap-3">
          {actions}
          <span aria-hidden="true" className="flex gap-1">
            <i className="h-2 w-2 rounded-[2px] bg-line" />
            <i className="h-2 w-2 rounded-[2px] bg-line" />
            <i className="h-2 w-2 rounded-[2px] bg-magenta/70" />
          </span>
        </div>
      </header>
      <div className={cn(padded && 'p-4 sm:p-5')}>{children}</div>
    </section>
  );
}

export default TerminalPanel;
