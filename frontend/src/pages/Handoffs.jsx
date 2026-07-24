import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RotateCcw, Inbox, AlertOctagon, ArrowLeftRight, ShieldAlert, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Badge, StatusBadge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { SectionHeader, QueryState, EmptyState, Spotlight } from '../components/ui/misc.jsx';
import { HandoffDrawer } from '../components/drawers/HandoffDrawer.jsx';
import { fmtRelative, fmtDateTime } from '../lib/format';

const TABS = [
  { id: 'stream', label: 'Stream', icon: ArrowLeftRight },
  { id: 'dlq', label: 'DLQ', icon: AlertOctagon },
  { id: 'outbox', label: 'Outbox', icon: Inbox },
  { id: 'breakers', label: 'Breakers', icon: ShieldAlert },
];

function StreamTab() {
  const q = useQuery({ queryKey: ['handoffs'], queryFn: api.handoffs });
  const [inspect, setInspect] = React.useState(null);
  const items = Array.isArray(q.data) ? q.data : q.data?.items || [];
  return (
    <QueryState query={q} skeleton={<div className="skeleton h-64" />}>
      {items.length === 0 ? <EmptyState title="Stream vazio" hint="Nenhum handoff registrado ainda." /> : (
        <div className="card overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left">
                {['Task', 'Origem → Destino', 'Status', 'Atualizado', ''].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-faint">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((h, i) => (
                <tr
                  key={h.task_id || h.id || i}
                  onClick={() => setInspect(h.task_id || h.id)}
                  className="border-b border-line/60 last:border-0 hover:bg-hover transition-colors cursor-pointer group"
                >
                  <td className="px-4 py-2.5 max-w-[260px]">
                    <span className="data text-fg block truncate">{h.hermes_resumo || h.task_id || h.id}</span>
                    {h.project && <span className="data text-[10.5px] text-faint">{h.project}{h.branch ? ` · ${h.branch}` : ''}</span>}
                  </td>
                  <td className="px-4 py-2.5 data text-muted whitespace-nowrap">
                    {h.sender || '—'} <span className="text-faint">→</span> {h.receiver || '—'}
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={h.lifecycle_status || h.status} /></td>
                  <td className="px-4 py-2.5 data text-faint whitespace-nowrap">{fmtRelative(h.updated_at || h.created_at)}</td>
                  <td className="px-2 py-2.5 w-8">
                    <ChevronRight size={14} className="text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <HandoffDrawer id={inspect} onClose={() => setInspect(null)} />
    </QueryState>
  );
}

function DlqTab() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['dlq'], queryFn: api.dlq });
  const replay = useMutation({
    mutationFn: api.replayDlq,
    onSuccess: (d) => {
      toast.success(`Replay OK — reinjetado no stream${d?.newStreamId ? ` (${d.newStreamId})` : ''}`);
      queryClient.invalidateQueries({ queryKey: ['dlq'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (e) => toast.error(`Replay falhou: ${e.message}`),
  });
  const items = Array.isArray(q.data) ? q.data : q.data?.items || [];
  return (
    <QueryState query={q} skeleton={<div className="skeleton h-64" />}>
      {items.length === 0 ? <EmptyState icon={AlertOctagon} title="DLQ vazia" hint="Nenhuma mensagem morta. O pipeline está saudável." /> : (
        <div className="flex flex-col gap-2">
          {items.map((it) => (
            <Spotlight key={it.id} className="card card-interactive p-4 flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="data text-[12.5px] text-fg">{it.id}</span>
                  {it.original_status && <StatusBadge status={it.original_status} />}
                </div>
                <p className="text-[12px] text-muted mt-1 truncate">{it.reason || 'sem motivo registrado'}</p>
                <p className="data text-[11px] text-faint mt-0.5">{fmtDateTime(it.dlq_at)}</p>
              </div>
              <Button
                size="sm" variant="soft"
                loading={replay.isPending && replay.variables === it.id}
                onClick={() => replay.mutate(it.id)}
              >
                <RotateCcw size={13} /> Replay
              </Button>
            </Spotlight>
          ))}
        </div>
      )}
    </QueryState>
  );
}

function OutboxTab() {
  const q = useQuery({ queryKey: ['outbox'], queryFn: api.outbox });
  const items = Array.isArray(q.data) ? q.data : q.data?.items || [];
  return (
    <QueryState query={q} skeleton={<div className="skeleton h-64" />}>
      {items.length === 0 ? <EmptyState icon={Inbox} title="Outbox limpa" hint="Nenhuma notificação represada." /> : (
        <div className="card overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left">
                {['ID', 'Canal', 'Status', 'Tentativas', 'Criado'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-faint">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((o, i) => (
                <tr key={o.id || i} className="border-b border-line/60 last:border-0 hover:bg-hover transition-colors">
                  <td className="px-4 py-2.5 data text-fg">{o.id}</td>
                  <td className="px-4 py-2.5 data text-muted">{o.event_type || o.channel || '—'}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={o.status} /></td>
                  <td className="px-4 py-2.5 data tnum text-muted">{o.attempts ?? o.tries ?? 0}</td>
                  <td className="px-4 py-2.5 data text-faint">{fmtRelative(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </QueryState>
  );
}

function BreakersTab() {
  const q = useQuery({ queryKey: ['breakers'], queryFn: api.breakers });
  const items = Array.isArray(q.data) ? q.data : [];
  return (
    <QueryState query={q} skeleton={<div className="skeleton h-40" />}>
      {items.length === 0 ? <EmptyState icon={ShieldAlert} title="Nenhum breaker" hint="Circuit breakers aparecem quando configurados." /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((b) => {
            const fails = b.fails ?? b.failures;
            return (
              <Spotlight key={b.key} className="card p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="data text-[12px] text-muted truncate">{b.key}</span>
                  <StatusBadge status={b.state} />
                </div>
                <div className="flex items-center gap-3 mt-2 data text-[11px] text-faint">
                  {fails != null && <span>{fails} falhas</span>}
                  {b.openedAt && <span>aberto {fmtRelative(b.openedAt)}</span>}
                </div>
              </Spotlight>
            );
          })}
        </div>
      )}
    </QueryState>
  );
}

export default function Handoffs() {
  const [tab, setTab] = React.useState('stream');
  return (
    <div>
      <div className="flex items-center gap-1 mb-5 rounded-lg border border-line bg-overlay p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 h-7.5 px-3 rounded-md text-[12.5px] font-medium cursor-pointer transition-colors duration-150',
              tab === t.id ? 'bg-hover text-fg' : 'text-faint hover:text-muted',
            )}
          >
            <t.icon size={13.5} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'stream' && <StreamTab />}
      {tab === 'dlq' && <DlqTab />}
      {tab === 'outbox' && <OutboxTab />}
      {tab === 'breakers' && <BreakersTab />}
    </div>
  );
}
