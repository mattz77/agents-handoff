import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Rocket, GitBranch, Terminal, History, ChevronDown } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Badge, StatusBadge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { SectionHeader, QueryState, EmptyState, Spotlight } from '../components/ui/misc.jsx';
import { fmtRelative, fmtDuration } from '../lib/format';

const ACTIONS = [
  { id: 'rebuild+up', label: 'Rebuild + Up' },
  { id: 'rebuild', label: 'Só rebuild' },
  { id: 'up', label: 'Só up' },
];

function LiveLog({ deployId, onDone }) {
  const [lines, setLines] = React.useState([]);
  const [closed, setClosed] = React.useState(false);
  const endRef = React.useRef(null);

  React.useEffect(() => {
    if (!deployId) return;
    setLines([]);
    setClosed(false);
    const es = new EventSource(`${api.deployStreamUrl()}?id=${encodeURIComponent(deployId)}`);
    es.onmessage = (e) => {
      if (e.data === '__END__' || e.data.includes('[stream-end]')) {
        setClosed(true);
        es.close();
        onDone?.();
        return;
      }
      setLines((cur) => [...cur.slice(-500), e.data]);
    };
    es.onerror = () => { setClosed(true); es.close(); onDone?.(); };
    return () => es.close();
  }, [deployId]);

  React.useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines]);

  if (!deployId) return null;
  return (
    <div className="card overflow-hidden mt-4">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
        <Terminal size={13.5} className="text-faint" />
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-faint">log do worker</span>
        <Badge tone={closed ? 'neutral' : 'info'} pulse={!closed} className="ml-auto">
          {closed ? 'finalizado' : 'streaming'}
        </Badge>
      </div>
      <div className="h-[280px] overflow-y-auto p-4 bg-[#050506] data text-[11.5px] leading-[1.7]">
        {lines.length === 0
          ? <span className="text-faint">aguardando saída do worker…</span>
          : lines.map((l, i) => (
            <div key={i} className={cn('whitespace-pre-wrap break-all', /erro|error|fail/i.test(l) ? 'text-[#ff9d9a]' : 'text-[#a8e6a3]')}>{l}</div>
          ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

export default function Deploy() {
  const queryClient = useQueryClient();
  const projects = useQuery({ queryKey: ['deploy-projects'], queryFn: api.deployProjects });
  const history = useQuery({ queryKey: ['deploy-history'], queryFn: api.deployHistory, refetchInterval: 10_000 });
  const [selected, setSelected] = React.useState(null);
  const [branch, setBranch] = React.useState('');
  const [action, setAction] = React.useState('rebuild+up');
  const [activeDeploy, setActiveDeploy] = React.useState(null);

  const list = projects.data?.projects || [];
  const hist = history.data?.requests || [];
  const sel = list.find((p) => p.slug === selected);
  const branches = sel?.branches || [];

  const run = useMutation({
    mutationFn: api.runDeploy,
    onSuccess: (d) => {
      setActiveDeploy(d?.id || null);
      toast.success('Deploy enfileirado — acompanhe o log');
      queryClient.invalidateQueries({ queryKey: ['deploy-history'] });
    },
    onError: (e) => toast.error(`Deploy falhou: ${e.message}`),
  });

  return (
    <div>
      <SectionHeader title="Executar deploy" sub="Selecione o projeto, branch e ação — o worker executa na fila do host" />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <QueryState query={projects} skeleton={<div className="skeleton h-24 sm:col-span-2 lg:col-span-3" />}>
          {list.map((p) => {
            const active = selected === p.slug;
            return (
              <button
                key={p.slug}
                onClick={() => { setSelected(p.slug); setBranch(''); }}
                className={cn(
                  'card card-interactive p-4 text-left',
                  active && 'border-accent-line bg-accent-soft/40 shadow-[var(--glow-accent)]',
                )}
              >
                <p className="text-[13.5px] font-semibold text-fg">{p.display_name || p.slug}</p>
                <p className="data text-[11px] text-faint mt-1 truncate">
                  {p.compose_service ? `docker · ${p.compose_service}` : p.vercel_deploy_hook_url ? 'vercel' : p.slug}
                </p>
                {active && <Badge tone="accent" className="mt-2.5" dot={false}>selecionado</Badge>}
              </button>
            );
          })}
        </QueryState>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex items-center h-9 rounded-lg border border-line bg-overlay min-w-[200px] focus-within:border-accent-line transition-colors">
          <GitBranch size={13.5} className="text-faint flex-none ml-3" />
          {branches.length > 0 ? (
            <>
              <select
                value={branch || branches[0]}
                onChange={(e) => setBranch(e.target.value)}
                className="flex-1 bg-transparent outline-none text-[13px] data text-fg pl-2 pr-7 h-full appearance-none cursor-pointer"
              >
                {branches.map((b) => <option key={b} value={b} className="bg-overlay">{b}</option>)}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 text-faint pointer-events-none" />
            </>
          ) : (
            <input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="branch (default: main)"
              className="flex-1 bg-transparent outline-none text-[13px] data text-fg placeholder:text-faint pl-2 pr-3 h-full"
            />
          )}
        </div>

        <div className="flex items-center rounded-lg border border-line bg-overlay p-0.5">
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAction(a.id)}
              className={cn(
                'h-8 px-3 rounded-md text-[12px] font-medium cursor-pointer transition-colors duration-150 data',
                action === a.id ? 'bg-hover text-fg' : 'text-faint hover:text-muted',
              )}
            >
              {a.label}
            </button>
          ))}
        </div>

        <Button
          variant="primary" size="md"
          disabled={!selected}
          loading={run.isPending}
          onClick={() => run.mutate({ projectSlug: selected, branch: branch || branches[0] || 'main', action, target: 'self-hosted' })}
        >
          <Rocket size={14} /> Deploy
        </Button>
      </div>

      <LiveLog
        deployId={activeDeploy}
        onDone={() => queryClient.invalidateQueries({ queryKey: ['deploy-history'] })}
      />

      <div className="mt-8">
        <SectionHeader title="Histórico" sub="últimas requests de deploy na fila do worker" />
        <QueryState query={history} skeleton={<div className="skeleton h-48" />}>
          {hist.length === 0 ? <EmptyState icon={History} title="Sem deploys ainda" /> : (
            <div className="flex flex-col gap-2">
              {hist.slice(0, 15).map((h) => {
                const dur = h.started_at && h.finished_at
                  ? new Date(h.finished_at) - new Date(h.started_at) : null;
                return (
                  <Spotlight key={h.id} className="card p-4 flex items-center gap-4">
                    <span className="w-8 h-8 rounded-lg bg-subtle border border-line flex items-center justify-center text-faint flex-none">
                      <Rocket size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-fg truncate">
                        {h.project_slug || h.target} <span className="text-faint data text-[11px]">· {h.action}</span>
                      </p>
                      <p className="data text-[11px] text-faint mt-0.5">
                        {h.branch} · {fmtRelative(h.created_at)}{dur != null && ` · ${fmtDuration(dur)}`}
                      </p>
                    </div>
                    {h.error && <span className="data text-[10.5px] text-bad truncate max-w-[200px]">{h.error}</span>}
                    <StatusBadge status={h.status} />
                  </Spotlight>
                );
              })}
            </div>
          )}
        </QueryState>
      </div>
    </div>
  );
}
