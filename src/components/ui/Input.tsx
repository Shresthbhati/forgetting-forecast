'use client';

import { forwardRef, useId, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const fieldBase =
  'w-full rounded-md border border-line bg-night px-4 py-2.5 text-sm text-ink placeholder:text-neutral-400 ' +
  'hover:border-neutral-400 focus:outline-none focus:border-cyan focus:shadow-[var(--glow-cyan)] ' +
  'disabled:bg-panel disabled:text-neutral-400 disabled:cursor-not-allowed transition-[border-color,box-shadow] duration-200';

const labelStyles = 'block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1.5';

function Messages({ error, helperText, errorId, helperId }: { error?: string; helperText?: string; errorId: string; helperId: string }) {
  return (
    <>
      {error && (
        <p id={errorId} className="mt-1.5 text-sm text-danger-600" role="alert">
          {error}
        </p>
      )}
      {helperText && !error && (
        <p id={helperId} className="mt-1.5 text-sm text-neutral-500">
          {helperText}
        </p>
      )}
    </>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode; // decorative; not clickable
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, helperText, leftIcon, rightIcon, id, ...props }, ref) => {
    const generated = useId();
    const inputId = id || generated;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className={labelStyles}>
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">{leftIcon}</div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(fieldBase, error && 'border-danger-500', leftIcon && 'pl-10', rightIcon && 'pr-10', className)}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? errorId : helperText ? helperId : undefined}
            {...props}
          />
          {rightIcon && (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-neutral-400">{rightIcon}</div>
          )}
        </div>
        <Messages error={error} helperText={helperText} errorId={errorId} helperId={helperId} />
      </div>
    );
  }
);
Input.displayName = 'Input';

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> {
  label?: string;
  error?: string;
  helperText?: string;
  rows?: number;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, helperText, id, rows = 4, ...props }, ref) => {
    const generated = useId();
    const textareaId = id || generated;
    const errorId = `${textareaId}-error`;
    const helperId = `${textareaId}-helper`;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={textareaId} className={labelStyles}>
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          className={cn(fieldBase, 'resize-y min-h-[80px]', error && 'border-danger-500', className)}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? errorId : helperText ? helperId : undefined}
          {...props}
        />
        <Messages error={error} helperText={helperText} errorId={errorId} helperId={helperId} />
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  error?: string;
  helperText?: string;
  options: { value: string; label: string }[];
  onChange?: (value: string) => void;
  className?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, helperText, options, id, onChange, ...props }, ref) => {
    const generated = useId();
    const selectId = id || generated;
    const errorId = `${selectId}-error`;
    const helperId = `${selectId}-helper`;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={selectId} className={labelStyles}>
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={cn(fieldBase, 'pr-10 appearance-none', error && 'border-danger-500', className)}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? errorId : helperText ? helperId : undefined}
            onChange={e => onChange?.(e.target.value)}
            {...props}
          >
            {options.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
            <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
        <Messages error={error} helperText={helperText} errorId={errorId} helperId={helperId} />
      </div>
    );
  }
);
Select.displayName = 'Select';

export default { Input, Textarea, Select };
