import React from 'react';
import NumberFlow from '@number-flow/react';
import { cn } from '../../lib/cn';

/* Métrica animada estilo Linear/Vercel — número troca com roll animation. */
export function Stat({ label, value, suffix, prefix, hint, icon: Icon, tone, format, className }) {
  const numeric = typeof value === 'number' && !isNaN(value);
  return (
    <div className={cn('card spotlight p-4 flex flex-col gap-2.5 min-w-0', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-medium text-muted uppercase tracking-[0.06em] truncate">
          {label}
        </span>
        {Icon && (
          <span className={cn('text-faint flex-none', tone && `text-${tone}`)}>
            <Icon size={15} strokeWidth={1.8} />
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className="data tnum text-[26px] leading-none font-semibold text-fg truncate">
          {prefix}
          {numeric ? (
            <NumberFlow
              value={value}
              locales="pt-BR"
              format={format || { maximumFractionDigits: 2 }}
            />
          ) : (
            <span className="text-faint">—</span>
          )}
        </span>
        {suffix && <span className="text-[12px] text-faint data flex-none">{suffix}</span>}
      </div>
      {hint && <div className="text-[11.5px] text-faint truncate">{hint}</div>}
    </div>
  );
}
