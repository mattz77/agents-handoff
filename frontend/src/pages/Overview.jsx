import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Activity, ArrowLeftRight, Inbox, AlertOctagon, Bell,
  Zap, Gauge, Timer, CheckCircle2,
} from 'lucide-react';
import { api } from '../lib/api';
import { Stat } from '../components/ui/stat.jsx';
import { Badge, StatusBadge } from '../components/ui/badge.jsx';
import { SectionHeader, QueryState, Spotlight } from '../components/ui/misc.jsx';
import { fmtRelative, fmtDuration } from '../lib/format';
import { useAppStore } from '../store/app';
import { cn } from '../lib/cn';

function SystemBanner({ data }) {
  const healthy = data.dlqLength === 0 && data.openBreakers === 0;
  return (
    <div className="relative card overflow-hidden mb-5">
      <div className="absolute inset-0 dot-grid opacity-60" />
      <div className="relative flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className={cn('status-dot status-dot--pulse', healthy ? 'bg-ok text-ok' : 'bg-bad text-bad')} style={{ width: 9, height: 9 }} />
          <div>
            <p className="text-[15px] font-semibold tracking-tight">
              {healthy ? 'Todos os sistemas operacionais' : 'Atenção: anomalias detectadas'}
            </p>
            <p className="text-[11.5px] text-faint data">
              gerado {fmtRelative(data.generatedAt)} · stream <span className="text-muted">{data.stream?.length ?? 0}</span> msgs · {data.stream?.groups ?? 0} consumer groups
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {data.openBreakers > 0 && <Badge tone="bad" pulse>{data.openBreakers} breaker{data.openBreakers > 1 ? 's' : ''} aberto{data.openBreakers > 1 ? 's' : ''}</Badge>}
          {data.dlqLength > 0 && <Badge tone="warn" pulse>{data.dlqLength} na DLQ</Badge>}
          {healthy && <Badge tone="ok">SLO dentro do alvo</Badge>}
        </div>
      </div>
    </div>
  );
}

function SloRow({ slo }) {
  if (!slo) return null;
  const rate = Math.round((slo.successRate ?? 0) * (slo.successRate <= 1 ? 100 : 1));
  const items = [
    { icon: CheckCircle2, label: 'Taxa de sucesso', value: `${rate}%`, tone: rate >= 99 ? 'text-ok' : rate >= 95 ? 'text-warn' : 'text-bad' },
    { icon: Zap, label: 'p50 handoff', value: fmtDuration(slo.handoffP50Ms), tone: 'text-fg' },
    { icon: Gauge, label: 'p95 handoff', value: fmtDuration(slo.handoffP95Ms), tone: 'text-fg' },
    { icon: Timer, label: 'MTTR', value: slo.mttrMin != null ? `${slo.mttrMin}min` : '—', tone: 'text-fg' },
  ];
  return (
    <div className="card px-5 py-4 mb-5 grid grid-cols-2 md:grid-cols-4 gap-4">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-3 min-w-0">
          <span className="w-8 h-8 rounded-lg bg-subtle border border-line flex items-center justify-center text-faint flex-none">
            <it.icon size={15} strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <p className={cn('data tnum text-[17px] font-semibold leading-none truncate', it.tone)}>{it.value}</p>
            <p className="text-[10.5px] text-faint uppercase tracking-[0.06em] mt-1.5 truncate">{it.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusBreakdown({ data }) {
  const setTab = useAppStore((s) => s.setTab);
  const entries = Object.entries(data.handoffsByStatus || {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  const total = entries.reduce((acc, [, n]) => acc + n, 0);
  return (
    <Spotlight className="card p-5 mb-5">
      <SectionHeader title="Handoffs por status" sub={`${total} no total · clique para auditar`} />
      <div className="flex flex-wrap gap-2">
        {entries.map(([status, n]) => (
          <button
            key={status}
            onClick={() => setTab('handoffs')}
            className="card-interactive flex items-center gap-2.5 h-9 pl-2.5 pr-3 rounded-lg border border-line bg-subtle"
          >
            <StatusBadge status={status} dot={false} />
            <span className="data tnum text-[13.5px] font-semibold text-fg">{n}</span>
          </button>
        ))}
      </div>
    </Spotlight>
  );
}

function ThroughputChart() {
  const q = useQuery({ queryKey: ['timeline'], queryFn: api.timeline });
  const raw = Array.isArray(q.data) ? q.data : [];
  const chartData = raw.map((p) => ({
    t: (p.date || '').slice(5), // MM-DD
    ok: Math.max((p.count ?? 0) - (p.failed ?? 0), 0),
    failed: p.failed ?? 0,
  }));

  return (
    <Spotlight className="card p-5">
      <SectionHeader
        title="Throughput"
        sub="handoffs por dia · verde = sucesso, vermelho = falhas"
        actions={<Badge tone="info" pulse>live</Badge>}
      />
      {chartData.length < 2 ? (
        <div className="h-[180px] flex items-center justify-center text-[12px] text-faint">
          Sem dados suficientes para o gráfico.
        </div>
      ) : (
        <div className="h-[180px] -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="thrOk" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="thrBad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--bad)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--bad)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tick={{ fill: 'var(--text-3)', fontSize: 10, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
              <YAxis hide domain={[0, 'dataMax + 2']} />
              <Tooltip
                cursor={{ stroke: 'var(--border-strong)', strokeDasharray: '3 3' }}
                contentStyle={{
                  background: 'var(--bg-overlay)', border: '1px solid var(--border-strong)',
                  borderRadius: 10, fontSize: 12, fontFamily: 'var(--font-mono)',
                }}
                labelStyle={{ color: 'var(--text-3)' }}
                itemStyle={{ color: 'var(--text)' }}
              />
              <Area type="monotone" dataKey="ok" name="sucesso" stroke="var(--accent)" strokeWidth={1.8} fill="url(#thrOk)" isAnimationActive={false} />
              <Area type="monotone" dataKey="failed" name="falhas" stroke="var(--bad)" strokeWidth={1.5} fill="url(#thrBad)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Spotlight>
  );
}

export default function Overview() {
  const q = useQuery({ queryKey: ['overview'], queryFn: api.overview, refetchInterval: 10_000 });

  // Guard ANTES de criar filhos: props como `q.data.stream` são avaliadas
  // no render do pai — acessar q.data aqui dentro crasha se undefined.
  if (q.isPending || q.isError || !q.data) {
    return (
      <QueryState
        query={q}
        skeleton={
          <div className="flex flex-col gap-5">
            <div className="skeleton h-[76px]" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-[104px]" />)}
            </div>
            <div className="skeleton h-[72px]" />
            <div className="skeleton h-[240px]" />
          </div>
        }
      />
    );
  }

  const d = q.data;

  return (
    <div>
      <SystemBanner data={d} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Stream" value={d.stream?.length} icon={ArrowLeftRight} hint={`${d.stream?.pending ?? 0} pendentes de ACK`} />
        <Stat label="Outbox" value={Object.values(d.outboxByStatus || {}).reduce((a, b) => a + b, 0)} icon={Inbox} hint="notificações aguardando envio" />
        <Stat label="DLQ" value={d.dlqLength} icon={AlertOctagon} hint={d.dlqLength > 0 ? 'requer replay ou investigação' : 'fila morta vazia'} />
        <Stat label="Alertas" value={d.alertsLength} icon={Bell} hint="stream ops:alerts" />
      </div>
      <SloRow slo={d.slo} />
      <StatusBreakdown data={d} />
      <ThroughputChart />
    </div>
  );
}
