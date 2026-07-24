import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldCheck, Play, GitPullRequest, ExternalLink, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Badge, StatusBadge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Stat } from '../components/ui/stat.jsx';
import { SectionHeader, QueryState, EmptyState, Spotlight } from '../components/ui/misc.jsx';
import { fmtRelative } from '../lib/format';

function PrsList() {
  const q = useQuery({ queryKey: ['codereview-prs'], queryFn: api.codereviewPrs });
  const prs = Array.isArray(q.data) ? q.data : q.data?.prs || [];
  return (
    <Spotlight className="card p-5">
      <SectionHeader title="Pull Requests" sub="gerados pelo pipeline de review/fix" />
      <QueryState query={q} skeleton={<div className="skeleton h-40" />}>
        {prs.length === 0 ? <EmptyState icon={GitPullRequest} title="Nenhum PR aberto" /> : (
          <div className="flex flex-col gap-2">
            {prs.map((pr, i) => (
              <div key={pr.number || pr.id || i} className="flex items-center gap-3 p-3 rounded-lg border border-line bg-subtle/50 hover:bg-hover transition-colors">
                <GitPullRequest size={14} className="text-accent flex-none" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium text-fg truncate">{pr.title || `#${pr.number}`}</p>
                  <p className="data text-[10.5px] text-faint mt-0.5">
                    {[pr.repo, pr.branch, fmtRelative(pr.created_at || pr.updated_at)].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <StatusBadge status={pr.state || pr.status} />
                {pr.url && (
                  <a href={pr.url} target="_blank" rel="noreferrer" className="text-faint hover:text-accent transition-colors flex-none" aria-label="Abrir PR">
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </QueryState>
    </Spotlight>
  );
}

export default function CodeReview() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['codereview'], queryFn: api.codereview, refetchInterval: 20_000 });
  const runStatus = useQuery({ queryKey: ['codereview-run'], queryFn: api.codereviewRunStatus, refetchInterval: 5_000 });

  const run = useMutation({
    mutationFn: api.runCodereview,
    onSuccess: () => {
      toast.success('Pipeline de review disparado');
      queryClient.invalidateQueries({ queryKey: ['codereview-run'] });
    },
    onError: (e) => toast.error(`Falha ao disparar: ${e.message}`),
  });

  const d = q.data || {};
  const running = runStatus.data?.running || runStatus.data?.status === 'RUNNING';
  const risks = d.risks || d.findings || [];
  const mitigated = d.mitigated ?? d.fixed ?? 0;

  return (
    <div>
      <SectionHeader
        title="Pipeline de review"
        sub="Análise diária com Verifier + CIFix — integridade via webhook"
        actions={
          <Button variant="primary" size="sm" loading={run.isPending || running} onClick={() => run.mutate()}>
            <Play size={13.5} /> {running ? 'Rodando…' : 'Rodar agora'}
          </Button>
        }
      />

      <QueryState
        query={q}
        skeleton={<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-[104px]" />)}</div>}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <Stat label="Riscos abertos" value={risks.filter((r) => !r.fixed && !r.mitigated).length || d.openRisks} icon={AlertTriangle} hint="aguardando fix-agent" />
          <Stat label="Mitigados" value={mitigated} icon={CheckCircle2} hint="corrigidos e verificados" />
          <Stat label="Último run" value={undefined} icon={ShieldCheck} hint={d.lastRun ? fmtRelative(d.lastRun) : 'nunca rodou'} />
          <Stat label="Reports" value={d.reportCount ?? d.reports} icon={GitPullRequest} hint="análises persistidas" />
        </div>

        {risks.length > 0 && (
          <Spotlight className="card p-5 mb-4">
            <SectionHeader title="Riscos" sub="achados do último report" />
            <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto -mr-1 pr-1">
              {risks.slice(0, 20).map((r, i) => (
                <div key={r.id || i} className="flex items-start gap-3 p-3 rounded-lg border border-line bg-subtle/50">
                  <span className={cn(
                    'mt-0.5 w-6 h-6 rounded-md flex items-center justify-center flex-none text-[10px] font-bold data',
                    (r.severity || '').toUpperCase() === 'HIGH' ? 'bg-bad-soft text-bad'
                      : (r.severity || '').toUpperCase() === 'MEDIUM' ? 'bg-warn-soft text-warn'
                      : 'bg-info-soft text-info',
                  )}>
                    {(r.severity || '?')[0].toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] text-fg leading-snug">{r.title || r.message || r.description}</p>
                    <p className="data text-[10.5px] text-faint mt-1 truncate">{[r.file, r.line ? `L${r.line}` : null].filter(Boolean).join(':')}</p>
                  </div>
                  <StatusBadge status={r.fixed || r.mitigated ? 'DONE' : 'OPEN'} />
                </div>
              ))}
            </div>
          </Spotlight>
        )}

        <PrsList />
      </QueryState>
    </div>
  );
}
