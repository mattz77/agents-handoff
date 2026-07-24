import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Container, Database, GitBranch, Cpu, MemoryStick, Clock, GitCommit, KeyRound } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { SectionHeader, QueryState, EmptyState, Spotlight, AlertsList } from '../components/ui/misc.jsx';
import { fmtRelative } from '../lib/format';

function DockerCard() {
  const q = useQuery({ queryKey: ['docker'], queryFn: api.docker, refetchInterval: 15_000 });
  const containers = q.data?.containers || (Array.isArray(q.data) ? q.data : []);
  const running = q.data?.totalRunning ?? containers.filter((c) => (c.state || '').toLowerCase() === 'running').length;
  return (
    <Spotlight className="card p-5 lg:col-span-2">
      <SectionHeader
        title="Containers"
        sub={`${running} rodando${q.data?.totalStopped != null ? ` · ${q.data.totalStopped} parados` : ''}`}
      />
      <QueryState query={q} skeleton={<div className="skeleton h-48" />}>
        {containers.length === 0 ? <EmptyState icon={Container} title="Nenhum container" /> : (
          <div className="flex flex-col gap-1 max-h-[320px] overflow-y-auto -mr-1 pr-1">
            {containers.map((c, i) => {
              const up = (c.state || '').toLowerCase() === 'running' || (c.status || '').toLowerCase().startsWith('up');
              return (
                <div key={c.name || i} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-hover transition-colors">
                  <span className={cn('status-dot', up ? 'bg-ok text-ok' : 'bg-faint text-faint', up && 'status-dot--pulse')} />
                  <span className="data text-[12px] text-fg font-medium truncate">{c.name}</span>
                  <span className="data text-[10.5px] text-faint truncate hidden lg:block max-w-[200px]">{c.image}</span>
                  <span className="data text-[10.5px] text-faint ml-auto flex-none">{c.uptime || c.status}</span>
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
  const healthy = (d.status || '').toLowerCase() === 'ok' || d.status === true;
  const nodes = [
    d.master && { ...d.master, role: 'master' },
    ...(d.replicas || []).map((r) => ({ ...r, role: 'replica' })),
    ...(d.sentinels || []).map((s) => ({ ...s, role: 'sentinel' })),
  ].filter(Boolean);
  return (
    <Spotlight className="card p-5">
      <SectionHeader
        title="Redis HA"
        sub={d.quorum != null ? `quorum ${d.quorum}` : 'master + replicas + sentinels'}
      />
      <QueryState query={q} skeleton={<div className="skeleton h-32" />}>
        <div className="flex items-center gap-2 mb-3">
          <Badge tone={healthy ? 'ok' : 'bad'} pulse={healthy}>{String(d.status ?? '—')}</Badge>
          <span className="data text-[10.5px] text-faint">{nodes.length} nós</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {nodes.map((n, i) => (
            <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-subtle/60 border border-line data text-[11.5px]">
              <span className={cn(
                'w-1.5 h-1.5 rounded-full flex-none',
                n.role === 'master' ? 'bg-accent' : n.role === 'replica' ? 'bg-info' : 'bg-faint',
              )} />
              <span className="text-muted truncate">{n.name || `${n.host}:${n.port}`}</span>
              <span className="text-faint flex-none">{n.role}</span>
              {n.lagBytes != null && <span className="ml-auto tnum text-faint flex-none">lag {n.lagBytes}B</span>}
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
  const memPct = d.memoryTotalMB ? Math.round((d.memoryUsedMB / d.memoryTotalMB) * 100) : null;
  const rows = [
    { icon: Cpu, label: 'CPU', value: d.cpuUsage != null ? `${Math.round(d.cpuUsage)}%` : '—' },
    { icon: MemoryStick, label: 'Memória', value: d.memoryUsedMB != null ? `${Math.round(d.memoryUsedMB / 102.4) / 10} / ${Math.round(d.memoryTotalMB / 102.4) / 10} GB` : '—' },
    { icon: Clock, label: 'Uptime', value: d.uptimeHours != null ? `${Math.round(d.uptimeHours)}h` : '—' },
  ];
  return (
    <Spotlight className="card p-5">
      <SectionHeader title="Host" sub={[d.platform, d.nodeVersion && `node ${d.nodeVersion}`].filter(Boolean).join(' · ') || 'recursos do sistema'} />
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
                style={{ width: `${memPct}%` }}
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
  const commits = d.recentCommits || [];
  return (
    <Spotlight className="card p-5">
      <SectionHeader title="Git" sub="estado do repositório do daemon" />
      <QueryState query={q} skeleton={<div className="skeleton h-32" />}>
        <div className="flex items-center gap-3 mb-3">
          <span className="w-9 h-9 rounded-lg bg-subtle border border-line flex items-center justify-center text-faint flex-none"><GitBranch size={15} /></span>
          <div className="min-w-0">
            <p className="data text-[13px] font-semibold text-fg truncate">{d.currentBranch || '—'}</p>
            <p className="data text-[10.5px] text-faint truncate">
              {d.lastPush ? `push ${fmtRelative(d.lastPush)}` : ''}
            </p>
          </div>
          {d.uncommittedChanges != null && (
            <Badge tone={d.uncommittedChanges > 0 ? 'warn' : 'ok'} className="ml-auto">
              {d.uncommittedChanges > 0 ? `${d.uncommittedChanges} não commitados` : 'clean'}
            </Badge>
          )}
        </div>
        <div className="flex flex-col gap-1 max-h-[180px] overflow-y-auto -mr-1 pr-1">
          {commits.slice(0, 8).map((c) => (
            <div key={c.hash} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md hover:bg-hover transition-colors">
              <GitCommit size={12} className="text-faint flex-none" />
              <span className="data text-[10.5px] text-accent flex-none">{c.hash?.slice(0, 7)}</span>
              <span className="text-[11.5px] text-muted truncate">{c.message}</span>
              <span className="data text-[10px] text-faint ml-auto flex-none">{fmtRelative(c.date)}</span>
            </div>
          ))}
        </div>
      </QueryState>
    </Spotlight>
  );
}

function GithubTokenCard() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['github-token'], queryFn: api.githubToken });
  const [token, setToken] = React.useState('');
  const d = q.data || {};

  const save = useMutation({
    mutationFn: () => api.saveGithubToken(token),
    onSuccess: () => {
      toast.success('Token salvo');
      setToken('');
      queryClient.invalidateQueries({ queryKey: ['github-token'] });
    },
    onError: (e) => toast.error(`Falha ao salvar: ${e.message}`),
  });

  return (
    <Spotlight className="card p-5">
      <SectionHeader
        title="GitHub PAT"
        sub="token usado pra diffs, comentários e merge de PR"
        actions={
          d.configured ? (
            <Badge tone="ok" dot={false}>configurado ({d.source})</Badge>
          ) : (
            <Badge tone="warn" dot={false}>não configurado</Badge>
          )
        }
      />
      <QueryState query={q} skeleton={<div className="skeleton h-16" />}>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-overlay flex-1 focus-within:border-accent-line transition-colors">
            <KeyRound size={13.5} className="text-faint flex-none" />
            <input
              type="password" value={token} onChange={(e) => setToken(e.target.value)}
              placeholder={d.configured ? 'Substituir token existente…' : 'ghp_…'}
              className="flex-1 bg-transparent outline-none text-[13px] data text-fg placeholder:text-faint"
            />
          </div>
          <Button variant="primary" size="md" loading={save.isPending} disabled={!token.trim()} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </div>
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
        <GithubTokenCard />
        <Spotlight className="card p-5">
          <SectionHeader title="Alertas operacionais" sub="stream ops:alerts" />
          <AlertsList limit={10} />
        </Spotlight>
      </div>
    </div>
  );
}
