import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Container, Database, GitBranch, Cpu, MemoryStick, Clock } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Badge, StatusBadge } from '../components/ui/badge.jsx';
import { SectionHeader, QueryState, EmptyState, Spotlight } from '../components/ui/misc.jsx';
import { fmtBytes, fmtRelative, fmtDuration } from '../lib/format';

function DockerCard() {
  const q = useQuery({ queryKey: ['docker'], queryFn: api.docker, refetchInterval: 15_000 });
  const containers = Array.isArray(q.data) ? q.data : q.data?.containers || [];
  return (
    <Spotlight className="card p-5 lg:col-span-2">
      <SectionHeader title="Containers" sub={`${containers.length} em execução no host`} />
      <QueryState query={q} skeleton={<div className="skeleton h-48" />}>
        {containers.length === 0 ? <EmptyState icon={Container} title="Nenhum container" /> : (
          <div className="flex flex-col gap-1.5">
            {containers.map((c, i) => {
              const up = (c.state || c.status || '').toLowerCase().includes('up') || (c.state || '').toLowerCase() === 'running';
              return (
                <div key={c.id || c.name || i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-hover transition-colors">
                  <span className={cn('status-dot', up ? 'bg-ok text-ok' : 'bg-bad text-bad', up && 'status-dot--pulse')} />
                  <span className="data text-[12.5px] text-fg font-medium truncate">{c.name}</span>
                  <span className="data text-[11px] text-faint truncate hidden md:block">{c.image}</span>
                  <span className="data text-[11px] text-faint ml-auto flex-none">{c.status || c.state}</span>
                </div>
              );
            })}
          </div>
        )}
      </QueryState>
    </Spotlight>
  );
}

function RedisCard() {
  const q = useQuery({ queryKey: ['redis-ha'], queryFn: api.redisHa, refetchInterval: 15_000 });
  const d = q.data || {};
  const replicas = d.replicas || d.sentinels || [];
  return (
    <Spotlight className="card p-5">
      <SectionHeader title="Redis HA" sub="master + sentinel" />
      <QueryState query={q} skeleton={<div className="skeleton h-32" />}>
        <div className="flex items-center gap-3 mb-3">
          <span className="w-9 h-9 rounded-lg bg-subtle border border-line flex items-center justify-center text-faint"><Database size={15} /></span>
          <div>
            <p className="text-[13px] font-semibold text-fg">{d.master || d.masterAddr || 'master'}</p>
            <p className="data text-[10.5px] text-faint">{d.mode || 'replicação assíncrona'}</p>
          </div>
          <StatusBadge status={d.ok === false ? 'FAILED' : 'OK'} className="ml-auto" />
        </div>
        <div className="flex flex-col gap-1.5">
          {replicas.map((r, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-subtle/60 border border-line data text-[11.5px] text-muted">
              <span className="status-dot bg-info text-info" />
              <span className="truncate">{r.name || r.addr || r}</span>
              {r.lag != null && <span className="ml-auto tnum text-faint flex-none">lag {r.lag}ms</span>}
            </div>
          ))}
        </div>
      </QueryState>
    </Spotlight>
  );
}

function SystemCard() {
  const q = useQuery({ queryKey: ['system'], queryFn: api.system, refetchInterval: 15_000 });
  const d = q.data || {};
  const memPct = d.memTotal ? Math.round((d.memUsed / d.memTotal) * 100) : d.memPct;
  const rows = [
    { icon: Cpu, label: 'CPU', value: d.cpuPct != null ? `${Math.round(d.cpuPct)}%` : d.load || '—' },
    { icon: MemoryStick, label: 'Memória', value: d.memUsed != null ? `${fmtBytes(d.memUsed)} / ${fmtBytes(d.memTotal)}` : (memPct != null ? `${memPct}%` : '—') },
    { icon: Clock, label: 'Uptime', value: d.uptimeSec != null ? fmtDuration(d.uptimeSec * 1000) : d.uptime || '—' },
  ];
  return (
    <Spotlight className="card p-5">
      <SectionHeader title="Host" sub="recursos do sistema" />
      <QueryState query={q} skeleton={<div className="skeleton h-32" />}>
        <div className="flex flex-col gap-2.5">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-md bg-subtle border border-line flex items-center justify-center text-faint flex-none"><r.icon size={13} /></span>
              <span className="text-[12px] text-muted">{r.label}</span>
              <span className="data tnum text-[12.5px] text-fg font-medium ml-auto">{r.value}</span>
            </div>
          ))}
          {memPct != null && (
            <div className="h-1.5 rounded-full bg-subtle overflow-hidden mt-1">
              <div
                className={cn('h-full rounded-full transition-all duration-700', memPct > 85 ? 'bg-bad' : memPct > 65 ? 'bg-warn' : 'bg-accent')}
                style={{ width: `${Math.min(memPct, 100)}%` }}
              />
            </div>
          )}
        </div>
      </QueryState>
    </Spotlight>
  );
}

function GitCard() {
  const q = useQuery({ queryKey: ['git'], queryFn: api.git, refetchInterval: 30_000 });
  const d = q.data || {};
  return (
    <Spotlight className="card p-5">
      <SectionHeader title="Git" sub="estado do repositório do daemon" />
      <QueryState query={q} skeleton={<div className="skeleton h-32" />}>
        <div className="flex items-center gap-3 mb-3">
          <span className="w-9 h-9 rounded-lg bg-subtle border border-line flex items-center justify-center text-faint"><GitBranch size={15} /></span>
          <div className="min-w-0">
            <p className="data text-[13px] font-semibold text-fg truncate">{d.branch || '—'}</p>
            <p className="data text-[10.5px] text-faint truncate">{d.commit || d.sha || ''}</p>
          </div>
          {d.dirty != null && <Badge tone={d.dirty ? 'warn' : 'ok'} className="ml-auto">{d.dirty ? 'dirty' : 'clean'}</Badge>}
        </div>
        {d.lastCommit && (
          <p className="text-[12px] text-muted leading-relaxed line-clamp-2">{d.lastCommit.message || d.lastCommit}</p>
        )}
        {d.ahead != null && (
          <p className="data text-[11px] text-faint mt-2">
            {d.ahead} ahead · {d.behind ?? 0} behind {d.upstream || 'origin'}
          </p>
        )}
      </QueryState>
    </Spotlight>
  );
}

export default function Infra() {
  return (
    <div>
      <SectionHeader title="Infraestrutura" sub="Estado ao vivo do host, containers e Redis HA" />
      <div className="grid lg:grid-cols-2 gap-4">
        <DockerCard />
        <RedisCard />
        <SystemCard />
        <GitCard />
      </div>
    </div>
  );
}
