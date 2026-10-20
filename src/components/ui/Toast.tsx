'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastOptions {
  variant?: ToastVariant;
  /** Optional inline action, e.g. { label: 'Retry', onClick }. */
  action?: { label: string; onClick: () => void };
  /** Milliseconds before auto-dismiss (default 4000). */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}

type ToastFn = (message: string, options?: ToastOptions) => void;

const ToastContext = createContext<ToastFn | null>(null);

const variantStyles: Record<ToastVariant, string> = {
  success: 'border-strong/50 text-strong',
  error: 'border-due/60 text-due',
  info: 'border-cyan/50 text-cyan',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems(prev => prev.filter(t => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const toast = useCallback<ToastFn>(
    (message, options = {}) => {
      const id = nextId.current++;
      setItems(prev => [...prev.slice(-3), { id, message, ...options }]);
      timers.current.set(id, setTimeout(() => dismiss(id), options.duration ?? 4000));
    },
    [dismiss]
  );

  useEffect(() => {
    const active = timers.current;
    return () => active.forEach(clearTimeout);
  }, []);

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-4 bottom-20 z-[10000] flex flex-col items-end gap-2 sm:inset-x-auto sm:bottom-4 sm:right-4 lg:bottom-4"
      >
        {items.map(t => (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-lg border bg-panel px-4 py-3 shadow-[0_8px_32px_rgb(0_0_0/0.5)]',
              variantStyles[t.variant ?? 'info']
            )}
          >
            <p className="flex-1 font-mono text-xs text-ink">{t.message}</p>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
                className="font-mono text-xs font-semibold uppercase tracking-wider underline underline-offset-2"
              >
                {t.action.label}
              </button>
            )}
            <button type="button" aria-label="Dismiss notification" onClick={() => dismiss(t.id)} className="text-ink-dim hover:text-ink">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Returns a toast function; a safe no-op when rendered outside a ToastProvider. */
export function useToast(): ToastFn {
  return useContext(ToastContext) ?? (() => {});
}
