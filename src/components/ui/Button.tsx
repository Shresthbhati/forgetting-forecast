'use client';

import { forwardRef, ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'icon'; // icon = square, icon-only (give it an aria-label)
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading = false,
      fullWidth = false,
      disabled,
      children,
      type = 'button',
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center gap-2 rounded-md font-semibold uppercase tracking-wider ' +
      'transition-[box-shadow,border-color,color,background-color,transform] duration-200 ease-out ' +
      'disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] select-none';

    const variantStyles = {
      // glossy sunset bevel: gradient, 1px white inner top highlight, magenta glow on hover/focus
      primary:
        'bg-sunset text-void shadow-[inset_0_1px_0_rgb(255_255_255/0.65),0_1px_0_rgb(0_0_0/0.4)] ' +
        'hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.65),var(--glow-magenta)] ' +
        'focus-visible:shadow-[inset_0_1px_0_rgb(255_255_255/0.65),var(--glow-magenta)]',
      secondary: 'border border-line bg-transparent text-ink hover:border-cyan hover:text-cyan',
      outline: 'border border-line bg-transparent text-ink hover:border-cyan hover:text-cyan',
      ghost: 'bg-transparent text-ink-dim hover:bg-panel-hi hover:text-ink',
      danger:
        'bg-due text-void shadow-[inset_0_1px_0_rgb(255_255_255/0.4)] hover:shadow-[0_0_8px_#ff3d7faa,0_0_24px_#ff3d7f55]',
    };

    const sizeStyles = {
      sm: 'px-3 py-1.5 text-xs gap-1.5',
      md: 'px-4 py-2 text-xs gap-2',
      lg: 'px-6 py-3 text-sm gap-2',
      icon: 'p-2 text-xs',
    };

    return (
      <button
        ref={ref}
        type={type}
        className={cn(baseStyles, variantStyles[variant], sizeStyles[size], fullWidth && 'w-full', className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && (
          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;
