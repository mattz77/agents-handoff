import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

const variants = {
  primary:
    'bg-accent text-accent-fg border border-transparent shadow-[0_1px_0_rgba(255,255,255,0.10)_inset] hover:brightness-110 active:brightness-95',
  outline: 'bg-overlay border border-line text-fg hover:bg-hover hover:border-line-strong',
  ghost: 'border border-transparent text-muted hover:text-fg hover:bg-hover',
  danger: 'bg-bad-soft text-bad border border-bad/25 hover:bg-bad/20',
  soft: 'bg-accent-soft text-accent border border-accent-line/40 hover:bg-accent-soft/70',
};

const sizes = {
  xs: 'h-6.5 px-2 text-xs gap-1.5 rounded-md',
  sm: 'h-8 px-3 text-[13px] gap-2 rounded-lg',
  md: 'h-9 px-3.5 text-[13.5px] gap-2 rounded-lg',
};

export const Button = React.forwardRef(function Button(
  { variant = 'outline', size = 'sm', loading = false, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-medium whitespace-nowrap select-none cursor-pointer',
        'transition-all duration-150 ease-out',
        'disabled:opacity-45 disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
});
