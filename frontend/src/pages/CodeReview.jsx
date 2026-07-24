import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ShieldCheck, Play, GitPullRequest, FileWarning, Star,
  Swords, GitMerge, RefreshCcw,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Badge, StatusBadge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Stat } from '../components/ui/stat.jsx';
import { SectionHeader, QueryState, EmptyState, Spotlight } from '../components/ui/misc.jsx';
import { ReportDrawer } from '../components/drawers/ReportDrawer.jsx';
import { fmtRelative } from '../lib/format';

const TABS = [
  { id: 'reports', label: 'Reports', icon: ShieldCheck },
  { id: 'prs', label: 'PRs & Merge', icon: GitPullRequest },
  { id: 'conflicts', label: 'Conflitos', icon: GitMerge },
];

/* ---------------- Reports (existente) ---------------- */

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
    </div>
  );
}

function ReportsTab({ onOpenReport }) {
  const queryClient = useQueryClient();
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
  const running = runStatus.data?.running || runStatus.data?.status === 'RUNNING';
  const scores = reports.map((r) => r.score).filter((s) => s != null);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const totalIssues = reports.reduce((acc, r) => acc + (Array.isArray(r.issues) ? r.issues.length : (r.issues ?? 0)), 0);

  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        <Button variant="primary" size="sm" loading={run.isPending || running} onClick={() => run.mutate()}>
          <Play size={13.5} /> {running ? 'Rodando…' : 'Rodar agora'}
        </Button>
      </div>
      <QueryState
        query={q}
        skeleton={<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-[104px]" />)}</div>}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <Stat label="Score médio" value={avgScore != null ? Math.round(avgScore * 10) / 10 : undefined} suffix="/10" icon={Star} hint={`${scores.length} reports com score`} />
          <Stat label="Issues" value={totalIssues} icon={FileWarning} format={{ maximumFractionDigits: 0 }} hint="achados acumulados" />
          <Stat label="Reports" value={reports.length} icon={ShieldCheck} format={{ maximumFractionDigits: 0 }} hint="análises persistidas" />
          <Stat label="Último report" value={undefined} icon={Play} hint={reports[0] ? fmtRelative(reports[0].created_at) : 'nunca rodou'} />
        </div>

        <Spotlight className="card p-5">
          <SectionHeader title="Reports" sub="mais recentes primeiro · clique para detalhe e ações" />
          {reports.length === 0 ? <EmptyState icon={ShieldCheck} title="Nenhum report" hint="Dispare o pipeline para gerar a primeira análise." /> : (
            <div className="flex flex-col gap-2 max-h-[480px] overflow-y-auto -mr-1 pr-1">
              {reports.slice(0, 25).map((r) => <ReportRow key={r.id} r={r} onOpen={() => onOpenReport(r)} />)}
            </div>
          )}
        </Spotlight>
      </QueryState>
    </div>
  );
}

/* ---------------- PRs & Merge ---------------- */

function PrRow({ pr, slug, onMerged }) {
  const queryClient = useQueryClient();
  const conflicted = pr.conflicted || pr.mergeable === false || (pr.mergeStateStatus || '').toUpperCase() === 'DIRTY';

  const merge = useMutation({
    mutationFn: () => api.mergePr({ slug, prNumber: pr.number, mergeMethod: 'squash' }),
    onSuccess: (d) => {
      if (d?.promotion?.prUrl) {
        toast.success(<>Merge OK — promoção aberta: <a className="underline" href={d.promotion.prUrl} target="_blank" rel="noreferrer">PR</a></>);
      } else {
        toast.success(`PR #${pr.number} mergeado (squash)`);
      }
      queryClient.invalidateQueries({ queryKey: ['codereview-prs', slug] });
      onMerged?.();
    },
    onError: (e) => toast.error(`Merge falhou: ${e.message}`),
  });

  return (
    <div className="flex items-center gap-3.5 p-3.5 rounded-lg border border-line bg-subtle/50 hover:bg-hover transition-colors">
      <GitPullRequest size={14} className="text-accent flex-none" />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-fg truncate">#{pr.number} · {pr.title || 'sem título'}</p>
        <p className="data text-[10.5px] text-faint mt-0.5 truncate">
          {[pr.headRefName || pr.branch, pr.author?.login || pr.author, fmtRelative(pr.createdAt || pr.created_at)].filter(Boolean).join(' · ')}
        </p>
      </div>
      {conflicted && <Badge tone="bad" pulse>conflito</Badge>}
      <StatusBadge status={pr.state} />
      {pr.url && (
        <a href={pr.url} target="_blank" rel="noreferrer" className="text-faint hover:text-accent transition-colors flex-none" aria-label="Abrir PR"
          onClick={(e) => e.stopPropagation()}>
          <GitPullRequest size={13} />
        </a>
      )}
      <Button size="xs" variant="soft" loading={merge.isPending} disabled={conflicted}
        onClick={() => merge.mutate()}>
        <GitMerge size={12} /> Merge
      </Button>
    </div>
  );
}

function PrsTab({ projects }) {
  const [slug, setSlug] = React.useState('');
  const effective = slug || projects[0]?.slug || '';
  const q = useQuery({
    queryKey: ['codereview-prs', effective],
    queryFn: () => api.codereviewPrs(effective),
    enabled: !!effective,
  });
  const prs = q.data?.prs || (Array.isArray(q.data) ? q.data : []);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {projects.map((p) => (
          <button
            key={p.slug}
            onClick={() => setSlug(p.slug)}
            className={cn(
              'h-8 px-3 rounded-lg border text-[12px] font-medium cursor-pointer transition-colors data',
              effective === p.slug
                ? 'border-accent-line bg-accent-soft text-accent'
                : 'border-line bg-overlay text-muted hover:text-fg',
            )}
          >
            {p.display_name || p.slug}
          </button>
        ))}
      </div>
      <QueryState query={q} skeleton={<div className="skeleton h-48" />}>
        {prs.length === 0 ? (
          <EmptyState icon={GitPullRequest} title="Nenhum PR aberto" hint={`Sem PRs do pipeline em ${effective}.`} />
        ) : (
          <div className="flex flex-col gap-2">
            {prs.map((pr) => <PrRow key={pr.number} pr={pr} slug={effective} />)}
          </div>
        )}
      </QueryState>
    </div>
  );
}

/* ---------------- Conflitos ---------------- */

function ConflictRow({ c }) {
  const queryClient = useQueryClient();
  const [attempt, setAttempt] = React.useState(null);
  const slug = c.slug || c.project_slug;
  const prNumber = c.number || c.pr_number || c.prNumber;
  const running = attempt?.status === 'running';

  const resolve = useMutation({
    mutationFn: () => api.resolveConflict({ slug, prNumber }),
    onSuccess: () => {
      setAttempt({ status: 'running', current_step: 'iniciando…' });
      toast.info('Resolução de conflito iniciada');
    },
    onError: (e) => toast.error(`Falha: ${e.message}`),
  });

  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      try {
        const d = await api.conflictStatus(slug, prNumber);
        const a = d.attempt || null;
        setAttempt(a);
        if (a && a.status !== 'running') {
          clearInterval(t);
          if (a.status === 'success' || a.status === 'resolved') {
            toast.success(`Conflito resolvido no PR #${prNumber}`);
            queryClient.invalidateQueries({ queryKey: ['codereview-conflicts'] });
          } else if (a.status === 'failed' || a.status === 'error') {
            toast.error(`Resolução falhou: ${a.error || a.current_step || 'erro'}`);
          }
        }
      } catch { /* mantém polling */ }
    }, 3000);
    return () => clearInterval(t);
  }, [running, slug, prNumber, queryClient]);

  return (
    <div className="flex items-center gap-3.5 p-3.5 rounded-lg border border-line bg-subtle/50">
      <GitMerge size={14} className="text-bad flex-none" />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-fg truncate">{slug} · PR #{prNumber}</p>
        <p className="data text-[10.5px] text-faint mt-0.5 truncate">
          {running ? `resolvendo: ${attempt?.current_step || '…'}` : (c.title || c.branch || 'conflito de merge detectado')}
        </p>
      </div>
      {running
        ? <Badge tone="info" pulse>{attempt?.current_step || 'rodando'}</Badge>
        : (
          <Button size="xs" variant="soft" loading={resolve.isPending} onClick={() => resolve.mutate()}>
            <RefreshCcw size={12} /> Resolver
          </Button>
        )}
    </div>
  );
}

function ConflictsTab() {
  const q = useQuery({ queryKey: ['codereview-conflicts'], queryFn: api.conflicts, refetchInterval: 30_000 });
  const items = q.data?.conflicts || q.data?.prs || (Array.isArray(q.data) ? q.data : []);
  return (
    <QueryState query={q} skeleton={<div className="skeleton h-40" />}>
      {items.length === 0 ? (
        <EmptyState icon={GitMerge} title="Sem conflitos" hint="Nenhum PR do pipeline com conflito de merge no momento." />
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((c, i) => <ConflictRow key={`${c.slug || c.project_slug}-${c.number || c.pr_number || i}`} c={c} />)}
        </div>
      )}
    </QueryState>
  );
}

/* ---------------- Página ---------------- */

export default function CodeReview() {
  const [tab, setTab] = React.useState('reports');
  const [selected, setSelected] = React.useState(null);
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const projects = projectsQ.data?.projects || [];

  return (
    <div>
      <SectionHeader
        title="Pipeline de review"
        sub="Análise, ataques adversariais, merge assistido e resolução de conflitos"
      />
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

      {tab === 'reports' && <ReportsTab onOpenReport={setSelected} />}
      {tab === 'prs' && <PrsTab projects={projects} />}
      {tab === 'conflicts' && <ConflictsTab />}

      <ReportDrawer report={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
