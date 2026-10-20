'use client';

import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'outlined';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hover?: boolean; // lift + glow on hover (use for clickable cards)
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', padding = 'md', hover = false, children, ...props }, ref) => {
    const paddingStyles = { none: '', sm: 'p-4', md: 'p-6', lg: 'p-8' };

    const variantStyles = {
      default: 'border border-line',
      elevated: 'border border-line shadow-[0_8px_32px_rgb(0_0_0/0.45)]',
      outlined: 'border-2 border-line',
    };

    return (
      <div
        ref={ref}
        className={cn(
          'rounded-lg bg-panel/85 backdrop-blur-sm',
          'shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]',
          'transition-[box-shadow,border-color,transform] duration-200',
          paddingStyles[padding],
          variantStyles[variant],
          hover && 'cursor-pointer hover:-translate-y-0.5 hover:border-magenta/60 hover:shadow-[var(--glow-magenta)]',
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={cn('px-6 py-4 border-b border-line', className)} {...props}>
      {children}
    </div>
  )
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, children, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-base font-semibold text-neutral-900', className)} {...props}>
      {children}
    </h3>
  )
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, children, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm text-neutral-500 mt-1', className)} {...props}>
      {children}
    </p>
  )
);
CardDescription.displayName = 'CardDescription';

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={cn('p-6', className)} {...props}>
      {children}
    </div>
  )
);
CardContent.displayName = 'CardContent';

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={cn('px-6 py-4 border-t border-line flex items-center gap-3', className)} {...props}>
      {children}
    </div>
  )
);
CardFooter.displayName = 'CardFooter';

export default { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
