import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldCheck, Play, GitPullRequest, ExternalLink, FileWarning, Star } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Stat } from '../components/ui/stat.jsx';
import { SectionHeader, QueryState, EmptyState, Spotlight } from '../components/ui/misc.jsx';
import { ReportDrawer } from '../components/drawers/ReportDrawer.jsx';
import { fmtRelative } from '../lib/format';

function scoreTone(score) {
  if (score == null) return 'neutral';
  if (score >= 8) return 'ok';
  if (score >= 5) return 'warn';
  return 'bad';
}

function ReportRow({ r, onOpen }) {
  const issues = Array.isArray(r.issues) ? r.issues.length : (r.issues ?? 0);
  return (
    <div
      onClick={onOpen}
      className="flex items-center gap-3.5 p-3.5 rounded-lg border border-line bg-subtle/50 hover:bg-hover hover:border-line-strong transition-colors cursor-pointer"
    >
      <span className={cn(
        'w-9 h-9 rounded-lg border flex items-center justify-center data tnum text-[13px] font-bold flex-none',
        scoreTone(r.score) === 'ok' && 'bg-ok-soft border-ok/25 text-ok',
        scoreTone(r.score) === 'warn' && 'bg-warn-soft border-warn/25 text-warn',
        scoreTone(r.score) === 'bad' && 'bg-bad-soft border-bad/25 text-bad',
        scoreTone(r.score) === 'neutral' && 'bg-subtle border-line text-faint',
      )}>
        {r.score ?? '—'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-fg truncate">{r.summary || r.display_name || r.project_slug}</p>
        <p className="data text-[10.5px] text-faint mt-0.5 truncate">
          {[r.project_slug, r.commit_sha?.slice(0, 7), r.model_used, fmtRelative(r.created_at)].filter(Boolean).join(' · ')}
        </p>
      </div>
      {issues > 0 && (
        <span className="flex items-center gap-1 text-[11px] data text-warn flex-none">
          <FileWarning size={12} /> {issues}
        </span>
      )}
      {r.pr_url && (
        <a href={r.pr_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11.5px] text-accent hover:underline flex-none">
          <GitPullRequest size={12.5} /> #{r.pr_number}
        </a>
      )}
    </div>
  );
}

export default function CodeReview() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = React.useState(null);
  const q = useQuery({ queryKey: ['codereview'], queryFn: api.codereview, refetchInterval: 20_000 });
  const runStatus = useQuery({ queryKey: ['codereview-run'], queryFn: api.codereviewRunStatus, refetchInterval: 5_000 });

  const run = useMutation({
    mutationFn: api.runCodereview,
    onSuccess: () => {
      toast.success('Pipeline de review disparado');
      queryClient.invalidateQueries({ queryKey: ['codereview-run'] });
      queryClient.invalidateQueries({ queryKey: ['codereview'] });
    },
    onError: (e) => toast.error(`Falha ao disparar: ${e.message}`),
  });

  const reports = q.data?.reports || [];
  const projects = q.data?.projects || [];
  const running = runStatus.data?.running || runStatus.data?.status === 'RUNNING';

  const scores = reports.map((r) => r.score).filter((s) => s != null);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const totalIssues = reports.reduce((acc, r) => acc + (Array.isArray(r.issues) ? r.issues.length : (r.issues ?? 0)), 0);
  const withPr = reports.filter((r) => r.pr_url).length;

  return (
    <div>
      <SectionHeader
        title="Pipeline de review"
        sub="Análise com Verifier + CIFix — score, issues e PRs comentados"
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
          <Stat label="Score médio" value={avgScore != null ? Math.round(avgScore * 10) / 10 : undefined} suffix="/10" icon={Star} hint={`${scores.length} reports com score`} />
          <Stat label="Issues" value={totalIssues} icon={FileWarning} format={{ maximumFractionDigits: 0 }} hint="achados acumulados" />
          <Stat label="PRs comentados" value={withPr} icon={GitPullRequest} format={{ maximumFractionDigits: 0 }} hint="reviews postados no GitHub" />
          <Stat label="Último report" value={undefined} icon={ShieldCheck} hint={reports[0] ? fmtRelative(reports[0].created_at) : 'nunca rodou'} />
        </div>

        {projects.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {projects.map((p) => (
              <Badge key={p.slug} tone="neutral" dot={false}>{p.display_name || p.slug}</Badge>
            ))}
          </div>
        )}

        <Spotlight className="card p-5">
          <SectionHeader title="Reports" sub={`${reports.length} análises persistidas · mais recentes primeiro`} />
          {reports.length === 0 ? <EmptyState icon={ShieldCheck} title="Nenhum report" hint="Dispare o pipeline para gerar a primeira análise." /> : (
            <div className="flex flex-col gap-2 max-h-[480px] overflow-y-auto -mr-1 pr-1">
              {reports.slice(0, 25).map((r) => <ReportRow key={r.id} r={r} onOpen={() => setSelected(r)} />)}
            </div>
          )}
        </Spotlight>
      </QueryState>
      <ReportDrawer report={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
