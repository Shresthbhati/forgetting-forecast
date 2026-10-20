'use client';

import { useEffect, useId, useRef } from 'react';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  /** Buttons for the footer. */
  actions?: React.ReactNode;
}

/**
 * Native <dialog>: the browser traps focus and Esc closes it. Closing by Esc, the backdrop or a button all
 * call onClose, so the parent's `open` state stays the single source of truth.
 */
export function Dialog({ open, onClose, title, description, children, actions }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onClick={e => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto w-[min(92vw,520px)] rounded-lg border border-line bg-panel p-0 text-ink shadow-[0_0_0_1px_var(--color-magenta),0_24px_80px_rgb(0_0_0/0.7)] backdrop:bg-void/80 backdrop:backdrop-blur-sm"
    >
      <header className="flex items-center justify-between border-b border-line bg-panel-hi/70 px-4 py-2">
        <h2 id={titleId} className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-dim">
          {title}
        </h2>
        <button type="button" aria-label="Close dialog" onClick={onClose} className="text-ink-dim hover:text-ink">
          ×
        </button>
      </header>
      <div className="space-y-4 p-5">
        {description && (
          <p id={descId} className="text-sm text-ink-dim">
            {description}
          </p>
        )}
        {children}
      </div>
      {actions && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{actions}</footer>}
    </dialog>
  );
}

export default Dialog;
