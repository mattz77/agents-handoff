import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Rocket, GitBranch, Terminal, History } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Badge, StatusBadge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { SectionHeader, QueryState, EmptyState, Spotlight } from '../components/ui/misc.jsx';
import { fmtRelative } from '../lib/format';

function LiveLog({ active }) {
  const [lines, setLines] = React.useState([]);
  const endRef = React.useRef(null);

  React.useEffect(() => {
    if (!active) return;
    const es = new EventSource(api.deployStreamUrl());
    es.onmessage = (e) => {
      setLines((cur) => [...cur.slice(-400), e.data]);
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [active]);

  React.useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines]);

  if (!active) return null;
  return (
    <div className="card overflow-hidden mt-4">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
        <Terminal size={13.5} className="text-faint" />
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-faint">log do worker</span>
        <Badge tone="info" pulse className="ml-auto">streaming</Badge>
      </div>
      <div className="h-[260px] overflow-y-auto p-4 bg-[#050506] data text-[11.5px] leading-[1.7]">
        {lines.length === 0
          ? <span className="text-faint">aguardando saída do worker…</span>
          : lines.map((l, i) => <div key={i} className="text-[#a8e6a3] whitespace-pre-wrap break-all">{l}</div>)}
        <div ref={endRef} />
      </div>
    </div>
  );
}

export default function Deploy() {
  const queryClient = useQueryClient();
  const projects = useQuery({ queryKey: ['deploy-projects'], queryFn: api.deployProjects });
  const history = useQuery({ queryKey: ['deploy-history'], queryFn: api.deployHistory });
  const [selected, setSelected] = React.useState(null);
  const [branch, setBranch] = React.useState('');
  const [deploying, setDeploying] = React.useState(false);

  const list = Array.isArray(projects.data) ? projects.data : projects.data?.projects || [];
  const hist = Array.isArray(history.data) ? history.data : history.data?.items || [];

  const run = useMutation({
    mutationFn: api.runDeploy,
    onSuccess: () => {
      setDeploying(true);
      toast.success('Deploy enfileirado — acompanhe o log');
      queryClient.invalidateQueries({ queryKey: ['deploy-history'] });
    },
    onError: (e) => toast.error(`Deploy falhou: ${e.message}`),
  });

  return (
    <div>
      <SectionHeader title="Executar deploy" sub="Selecione o projeto e a branch — o worker rebuilda e sobe o serviço" />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <QueryState query={projects} skeleton={<div className="skeleton h-24 sm:col-span-2 lg:col-span-4" />}>
          {list.map((p) => {
            const name = p.name || p.slug || p.id;
            const active = selected === name;
            return (
              <button
                key={name}
                onClick={() => setSelected(name)}
                className={cn(
                  'card card-interactive p-4 text-left',
                  active && 'border-accent-line bg-accent-soft/40 shadow-[var(--glow-accent)]',
                )}
              >
                <p className="text-[13.5px] font-semibold text-fg">{name}</p>
                <p className="data text-[11px] text-faint mt-1 truncate">{p.service || p.path || '—'}</p>
                {active && <Badge tone="accent" className="mt-2.5" dot={false}>selecionado</Badge>}
              </button>
            );
          })}
        </QueryState>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-overlay flex-1 min-w-[220px] max-w-[340px]">
          <GitBranch size={13.5} className="text-faint flex-none" />
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="branch (vazio = atual do worker)"
            className="flex-1 bg-transparent outline-none text-[13px] data text-fg placeholder:text-faint"
          />
        </div>
        <Button
          variant="primary" size="md"
          disabled={!selected}
          loading={run.isPending}
          onClick={() => run.mutate({ project: selected, branch: branch || undefined })}
        >
          <Rocket size={14} /> Deploy {selected && `· ${selected}`}
        </Button>
      </div>

      <LiveLog active={deploying} />

      <div className="mt-8">
        <SectionHeader title="Histórico" sub="últimos deploys executados pelo worker" />
        <QueryState query={history} skeleton={<div className="skeleton h-48" />}>
          {hist.length === 0 ? <EmptyState icon={History} title="Sem deploys ainda" /> : (
            <div className="flex flex-col gap-2">
              {hist.slice(0, 15).map((h, i) => (
                <Spotlight key={h.id || i} className="card p-4 flex items-center gap-4">
                  <span className="w-8 h-8 rounded-lg bg-subtle border border-line flex items-center justify-center text-faint flex-none">
                    <Rocket size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-fg truncate">{h.project || h.name || '—'}</p>
                    <p className="data text-[11px] text-faint mt-0.5">
                      {h.branch && <>{h.branch} · </>}{fmtRelative(h.finished_at || h.started_at || h.created_at)}
                    </p>
                  </div>
                  <StatusBadge status={h.status} />
                </Spotlight>
              ))}
            </div>
          )}
        </QueryState>
      </div>
    </div>
  );
}
