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
  const raw = q.data;
  const series = Array.isArray(raw) ? raw : raw?.series || raw?.buckets || [];
  const chartData = series.slice(-48).map((p) => ({
    t: p.ts || p.t || p.time || p.bucket,
    n: p.count ?? p.n ?? p.value ?? 0,
  }));

  return (
    <Spotlight className="card p-5">
      <SectionHeader
        title="Throughput"
        sub="volume de handoffs · janela recente"
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
                <linearGradient id="thr" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
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
              <Area type="monotone" dataKey="n" stroke="var(--accent)" strokeWidth={1.8} fill="url(#thr)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Spotlight>
  );
}

export default function Overview() {
  const q = useQuery({ queryKey: ['overview'], queryFn: api.overview, refetchInterval: 10_000 });

  return (
    <div>
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
      >
        <SystemBanner data={q.data} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <Stat label="Stream" value={q.data.stream?.length} icon={ArrowLeftRight} hint={`${q.data.stream?.pending ?? 0} pendentes de ACK`} />
          <Stat label="Outbox" value={Object.values(q.data.outboxByStatus || {}).reduce((a, b) => a + b, 0)} icon={Inbox} hint="notificações aguardando envio" />
          <Stat label="DLQ" value={q.data.dlqLength} icon={AlertOctagon} hint={q.data.dlqLength > 0 ? 'requer replay ou investigação' : 'fila morta vazia'} />
          <Stat label="Alertas" value={q.data.alertsLength} icon={Bell} hint="stream ops:alerts" />
        </div>
        <SloRow slo={q.data.slo} />
        <StatusBreakdown data={q.data} />
        <ThroughputChart />
      </QueryState>
    </div>
  );
}
