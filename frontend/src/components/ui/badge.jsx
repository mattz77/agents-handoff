import React from 'react';
import { cn } from '../../lib/cn';

const tones = {
  neutral: 'bg-hover text-muted border-line',
  accent: 'bg-accent-soft text-accent border-accent-line/40',
  ok: 'bg-ok-soft text-ok border-ok/25',
  warn: 'bg-warn-soft text-warn border-warn/25',
  bad: 'bg-bad-soft text-bad border-bad/25',
  info: 'bg-info-soft text-info border-info/25',
  // Fixo, independente do --accent (que segue a cor primária escolhida pelo usuário) — convenção
  // universal de PR (GitHub/GitLab): merge sempre violeta, não deve mudar se o accent mudar.
  violet: 'bg-violet-500/10 text-violet-400 border-violet-500/25',
};

const dotColors = {
  neutral: 'bg-faint',
  accent: 'bg-accent',
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  info: 'bg-info',
  violet: 'bg-violet-500',
};

export function Badge({ tone = 'neutral', pulse = false, dot = true, className, children }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full border',
        'text-[11px] font-medium tracking-wide uppercase',
        tones[tone],
        className,
      )}
    >
      {dot && (
        <span
          className={cn('status-dot', pulse && 'status-dot--pulse', dotColors[tone])}
          style={{ color: 'currentColor' }}
        />
      )}
      {children}
    </span>
  );
}

/* Mapeia status do domínio (handoff/outbox) para tom do Badge. */
export function StatusBadge({ status, className }) {
  const s = (status || '').toUpperCase();
  const tone =
    ['DONE', 'COMPLETED', 'SENT', 'DELIVERED', 'OK', 'CLOSED', 'SUCCESS'].includes(s) ? 'ok'
    : ['FAILED', 'ERROR', 'OPEN', 'DLQ', 'DEAD'].includes(s) ? 'bad'
    : ['PENDING', 'QUEUED', 'RETRY', 'HALF_OPEN', 'RUNNING'].includes(s) ? 'warn'
    : ['IN_PROGRESS', 'PROCESSING', 'CLAIMED'].includes(s) ? 'info'
    : 'neutral';
  const pulse = tone === 'info' || tone === 'warn';
  return <Badge tone={tone} pulse={pulse} className={className}>{s || '—'}</Badge>;
}
