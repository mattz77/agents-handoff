import React, { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertTriangle, Inbox, Bell } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button } from './button';
import { Badge } from './badge';
import { api } from '../../lib/api';
import { fmtRelative } from '../../lib/format';

/* Spotlight wrapper — injeta --mx/--my pro glow radial seguir o cursor. */
export function Spotlight({ className, children, ...props }) {
  const ref = useRef(null);
  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  return (
    <div ref={ref} onMouseMove={onMove} className={cn('spotlight', className)} {...props}>
      {children}
    </div>
  );
}

export function SectionHeader({ title, sub, actions, className }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 mb-4', className)}>
      <div className="min-w-0">
        <h2 className="text-[14px] font-semibold text-fg tracking-tight">{title}</h2>
        {sub && <p className="text-[12px] text-faint mt-0.5">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-none">{actions}</div>}
    </div>
  );
}

export function Spinner({ size = 16, className }) {
  return <Loader2 size={size} className={cn('animate-spin text-faint', className)} />;
}

export function EmptyState({ icon: Icon = Inbox, title = 'Nada por aqui', hint, action, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 py-14 text-center', className)}>
      <div className="w-10 h-10 rounded-xl bg-subtle border border-line flex items-center justify-center text-faint mb-1">
        <Icon size={18} strokeWidth={1.6} />
      </div>
      <p className="text-[13px] font-medium text-muted">{title}</p>
      {hint && <p className="text-[12px] text-faint max-w-[320px]">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="Falha ao carregar"
      hint={error?.message || 'Erro desconhecido'}
      className={className}
      action={onRetry && <Button size="sm" onClick={onRetry}>Tentar de novo</Button>}
    />
  );
}

/* Estado padrão de query: loading → skeleton, error → ErrorState, senão children.
   ATENÇÃO: children não devem desreferenciar query.data em props — o JSX dos
   filhos é avaliado no render do pai. Prefira guard early-return na página. */
export function QueryState({ query, skeleton, children }) {
  if (query.isPending || query.data === undefined) return skeleton || <div className="skeleton h-32 w-full" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return children;
}

const ALERT_TONE = { CRITICAL: 'bad', ERROR: 'bad', WARN: 'warn', WARNING: 'warn', INFO: 'info' };

/* Lista de alertas operacionais (stream ops:alerts) — usada em Overview e Infra. */
export function AlertsList({ limit = 15, className }) {
  const q = useQuery({ queryKey: ['alerts', limit], queryFn: () => api.alerts(limit), refetchInterval: 20_000 });
  const items = Array.isArray(q.data) ? q.data : q.data?.items || [];
  return (
    <QueryState query={q} skeleton={<div className={cn('skeleton h-32', className)} />}>
      {items.length === 0 ? (
        <EmptyState icon={Bell} title="Sem alertas" hint="Nada no stream ops:alerts no momento." className={className} />
      ) : (
        <div className={cn('flex flex-col gap-1.5 max-h-[280px] overflow-y-auto -mr-1 pr-1', className)}>
          {items.slice(0, limit).map((a) => (
            <div key={a.id} className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-hover transition-colors">
              <Badge tone={ALERT_TONE[(a.level || '').toUpperCase()] || 'neutral'} dot={false} className="flex-none mt-0.5">
                {(a.level || '?').toString().slice(0, 8)}
              </Badge>
              <span className="text-[12px] text-muted leading-snug flex-1 min-w-0 break-words">{a.msg}</span>
              <span className="data text-[10px] text-faint flex-none whitespace-nowrap">{fmtRelative(a.at)}</span>
            </div>
          ))}
        </div>
      )}
    </QueryState>
  );
}
