'use client';

import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  size?: 'sm' | 'md' | 'lg';
  dot?: boolean; // leading status dot
}

export const Badge = ({ className, variant = 'default', size = 'md', dot = false, children, ...props }: BadgeProps) => {
  const variantStyles = {
    default: 'bg-neutral-100 text-neutral-700 border-neutral-300',
    success: 'bg-success-50 text-success-700 border-success-200',
    warning: 'bg-warning-50 text-warning-700 border-warning-200',
    danger: 'bg-danger-50 text-danger-700 border-danger-200',
    info: 'bg-info-50 text-info-700 border-info-200',
    neutral: 'bg-neutral-100 text-neutral-700 border-neutral-300',
  };

  const sizeStyles = {
    sm: 'px-2 py-0.5 text-[10px] gap-1',
    md: 'px-2.5 py-1 text-xs gap-1.5',
    lg: 'px-3 py-1.5 text-sm gap-2',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center font-mono font-semibold uppercase tracking-wider rounded border',
        sizeStyles[size],
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn(
            'w-1.5 h-1.5 rounded-full flex-shrink-0',
            variant === 'success' && 'bg-success-500',
            variant === 'warning' && 'bg-warning-500',
            variant === 'danger' && 'bg-danger-500',
            variant === 'info' && 'bg-info-500',
            (variant === 'default' || variant === 'neutral') && 'bg-neutral-400'
          )}
        />
      )}
      {children}
    </span>
  );
};

Badge.displayName = 'Badge';

export default Badge;
