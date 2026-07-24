import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ShieldCheck, Play, GitPullRequest, Swords, GitMerge, RefreshCcw,
  Sliders, Zap, Check, AlertTriangle, Send, ChevronRight,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Badge, StatusBadge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { SectionHeader, QueryState, EmptyState, Spotlight } from '../components/ui/misc.jsx';
import { Drawer } from '../components/ui/drawer.jsx';
import { fmtRelative, fmtDateTime } from '../lib/format';

const TABS = [
  { id: 'reports', label: 'Reports', icon: ShieldCheck },
  { id: 'prs', label: 'PRs & Merge', icon: GitPullRequest },
];

/* ---------------- helpers de tom ---------------- */

function scoreTone(score) {
  if (score == null) return 'neutral';
  if (score >= 8) return 'ok';
  if (score >= 5) return 'warn';
  return 'bad';
}
const TONE_VAR = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', info: 'var(--info)', neutral: 'var(--border-strong)', accent: 'var(--accent)' };
const TONE_TEXT = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', info: 'text-info', neutral: 'text-faint', accent: 'text-accent' };

function sevTone(sev) {
  const v = (sev || '').toLowerCase();
  if (v === 'critical' || v === 'high') return 'bad';
  if (v === 'warning' || v === 'medium') return 'warn';
  return 'info';
}

/* ---------------- Score ring (SVG, tokens do redesign) ---------------- */

function ScoreRing({ score, size = 104 }) {
  const tone = scoreTone(score);
  const R = 42, C = 2 * Math.PI * R;
  const pct = score == null ? 0 : Math.max(0, Math.min(score / 10, 1));
  return (
    <div className="relative flex-none" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 104 104">
        <circle cx="52" cy="52" r={R} fill="none" stroke="var(--bg-subtle)" strokeWidth="9" />
        <circle
          cx="52" cy="52" r={R} fill="none" stroke={TONE_VAR[tone]} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 52 52)"
          style={{ transition: 'stroke-dasharray 0.7s cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('data tnum text-[24px] font-bold leading-none', TONE_TEXT[tone])}>
          {score == null ? 'N/A' : Number(score).toFixed(1)}
        </span>
        <span className="text-[9.5px] uppercase tracking-[0.1em] text-faint mt-1">score</span>
      </div>
    </div>
  );
}

function Sparkline({ data, tone = 'accent', width = 120, height = 30 }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={TONE_VAR[tone]} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------------- Model pickers (review/fix/verify, persist localStorage) ---------------- */

const MODEL_FIELDS = [
  { role: 'review', key: 'cr.model.review', glyph: '◆', label: 'Review' },
  { role: 'fix', key: 'cr.model.fix', glyph: '▲', label: 'Fix' },
  { role: 'verify', key: 'cr.model.verify', glyph: '●', label: 'Verify' },
];

function useModelSel(key) {
  const [val, setVal] = React.useState(() => localStorage.getItem(key) || '');
  const set = React.useCallback((v) => { localStorage.setItem(key, v); setVal(v); }, [key]);
  return [val, set];
}

function ModelPickers({ open, models, recommended, sel }) {
  if (!open || models.length === 0) return null;
  return (
    <div className="grid sm:grid-cols-3 gap-2 mb-4">
      {MODEL_FIELDS.map((f) => {
        const [val, setVal] = sel[f.role];
        const rec = (recommended[f.role] || []).filter((m) => models.includes(m));
        return (
          <label key={f.role} className="flex flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-[0.07em] text-faint font-semibold">{f.glyph} {f.label}</span>
            <select
              value={val} onChange={(e) => setVal(e.target.value)}
              className="h-8 px-2.5 rounded-lg border border-line bg-overlay text-[12px] data text-fg outline-none focus:border-accent-line cursor-pointer"
            >
              <option value="">padrão</option>
              {rec.length > 0 && (
                <optgroup label="Indicados">
                  {rec.map((m) => <option key={`r-${m}`} value={m}>{m}</option>)}
                </optgroup>
              )}
              <optgroup label="Todos">
                {models.map((m) => <option key={`a-${m}`} value={m}>{m}</option>)}
              </optgroup>
            </select>
          </label>
        );
      })}
    </div>
  );
}

/* ---------------- Attack progress + result ---------------- */

function AttackProgress({ a }) {
  const pct = Math.round(100 * (a.issues_fixed || 0) / Math.max(a.issues_total || 1, 1));
  const log = Array.isArray(a.log) ? a.log.slice(-3) : [];
  return (
    <Spotlight className="card p-4 mb-4 border-info/30">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-fg">
          <Zap size={14} className="text-info" />
          Rodada {a.round || 1} · {a.project_slug}
          {a.pr_number && <span className="text-faint data">· PR #{a.pr_number}</span>}
        </span>
        <span className="data tnum text-[12px] text-muted">{a.issues_fixed || 0}/{a.issues_total || 0} corrigidas</span>
      </div>
      <div className="flex items-center gap-2 data text-[11.5px] text-info mb-2">
        <span className="status-dot status-dot--pulse bg-info" /> {a.current_step || 'iniciando…'}
      </div>
      <div className="h-1.5 rounded-full bg-subtle overflow-hidden mb-2">
        <div className="h-full rounded-full bg-info transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      {log.map((l, i) => (
        <div key={i} className="data text-[10.5px] text-faint truncate">
          [{l.status}] {l.file}{l.line != null ? `:${l.line}` : ''} — {l.detail}
        </div>
      ))}
    </Spotlight>
  );
}

function AttackResult({ a, onMerge, merging, mergedFlag }) {
  const converged = a.verify_status === 'approved';
  const needsHuman = a.verify_status === 'needs_human';
  const tone = a.status !== 'done' ? 'bad' : converged ? 'ok' : needsHuman ? 'warn' : 'bad';
  const isMerged = mergedFlag || /mergead/i.test(a.current_step || '');
  return (
    <div className={cn(
      'card p-4 mb-4 flex flex-col gap-2',
      tone === 'ok' && 'border-ok/30', tone === 'warn' && 'border-warn/30', tone === 'bad' && 'border-bad/30',
    )}>
      <div className="flex items-center gap-2.5 flex-wrap">
        {converged ? <Check size={15} className="text-ok" /> : <AlertTriangle size={15} className={tone === 'warn' ? 'text-warn' : 'text-bad'} />}
        <span className="text-[12.5px] font-semibold text-fg">
          {converged ? `Ciclo aprovado pelo Daemon-Verifier (rodada ${a.round || 1})`
            : needsHuman ? `Precisa de revisão humana (rodada ${a.round || 1})`
            : 'Ataque falhou'}
        </span>
        <span className="data text-[11.5px] text-muted">— {a.issues_fixed}/{a.issues_total} corrigidas</span>
        {a.pr_url && (
          <a href={a.pr_url} target="_blank" rel="noreferrer" className="text-[11.5px] text-accent hover:underline flex items-center gap-1">
            <GitPullRequest size={11.5} /> PR #{a.pr_number}
          </a>
        )}
        {converged && a.pr_number && (
          <Button size="xs" variant="soft" className="ml-auto" loading={merging} disabled={isMerged} onClick={() => onMerge(a)}>
            <GitMerge size={12} /> {isMerged ? 'Mergeado ✓' : 'Aprovar e Mergear'}
          </Button>
        )}
      </div>
      {a.verify_notes && <p className="text-[11.5px] text-muted leading-relaxed">{a.verify_notes}</p>}
      {a.error && <p className="data text-[11px] text-bad">{a.error}</p>}
    </div>
  );
}

/* ---------------- Issue list (severidade + sugestão + criar task) ---------------- */

function IssueList({ issues, tone, report }) {
  const [state, setState] = React.useState({});
  const delegate = useMutation({
    mutationFn: ({ issue }) => api.addBrainTask({
      title: `[${report.display_name || report.project_slug}] ${issue.file || ''}${issue.line != null ? `:${issue.line}` : ''} — ${(issue.message || '').slice(0, 60)}`,
      project: report.project_slug,
      commit: report.commit_sha || undefined,
      priority: (issue.severity === 'critical' || issue.severity === 'high') ? 'alta' : 'média',
      context: `Issue [${issue.severity}/${issue.category || 's/cat'}] do code review no commit ${(report.commit_sha || '').slice(0, 7)}.\n\n${issue.file || ''}${issue.line != null ? `:${issue.line}` : ''}\n${issue.message || ''}`,
      action: issue.suggestion || '(ver sugestão do review)',
      expected: 'Issue corrigida e commitada.',
    }),
    onMutate: ({ key }) => setState((s) => ({ ...s, [key]: 'creating' })),
    onSuccess: (_d, { key }) => { setState((s) => ({ ...s, [key]: 'done' })); toast.success('Task delegada ao Brain'); },
    onError: (e, { key }) => { setState((s) => ({ ...s, [key]: 'error' })); toast.error(`Falha ao delegar: ${e.message}`); },
  });

  return (
    <div className="flex flex-col gap-2">
      {issues.map((it, i) => {
        const key = `${report.id || 0}:${i}:${it.file || ''}`;
        const st = state[key];
        return (
          <div key={i} className={cn(
            'p-3 rounded-lg border bg-subtle/50',
            tone === 'bad' && 'border-bad/20', tone === 'warn' && 'border-warn/20', tone === 'info' && 'border-line',
          )}>
            <div className="flex items-start justify-between gap-2">
              <p className="data text-[11.5px] font-semibold text-fg leading-snug">
                {it.file}{it.line != null ? `:${it.line}` : ''}
                {it.category && <span className="text-faint font-normal"> [{it.category}]</span>}
              </p>
              <Button
                size="xs" variant="ghost" className="flex-none"
                disabled={st === 'creating' || st === 'done'}
                onClick={() => delegate.mutate({ issue: it, key })}
              >
                <Send size={11} /> {st === 'done' ? 'Criada ✓' : st === 'creating' ? '…' : st === 'error' ? 'Erro' : 'Criar task'}
              </Button>
            </div>
            <p className="text-[12px] text-muted mt-1 leading-snug">{it.message}</p>
            {it.suggestion && (
              <p className="data text-[11px] text-muted mt-1.5 bg-[#050506] border border-line rounded-md px-2.5 py-1.5 whitespace-pre-wrap break-words">
                <b className={TONE_TEXT[tone]}>Sugestão: </b>{it.suggestion}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SeverityBar({ critical, warning, info }) {
  const total = critical + warning + info || 1;
  const segs = [['bad', critical], ['warn', warning], ['info', info]];
  return (
    <div className="flex h-2 rounded-full overflow-hidden bg-subtle">
      {segs.map(([t, n], i) => n > 0 && (
        <span key={i} style={{ width: `${(n / total) * 100}%`, background: TONE_VAR[t] }} />
      ))}
    </div>
  );
}

/* ---------------- Reports tab ---------------- */

function ReportsTab() {
  const queryClient = useQueryClient();
  const [projectFilter, setProjectFilter] = React.useState('');
  const [selected, setSelected] = React.useState(0);
  const [showModels, setShowModels] = React.useState(false);
  const [mergedFlag, setMergedFlag] = React.useState({});

  const sel = {
    review: useModelSel('cr.model.review'),
    fix: useModelSel('cr.model.fix'),
    verify: useModelSel('cr.model.verify'),
  };

  const q = useQuery({ queryKey: ['codereview', projectFilter], queryFn: () => api.codereview(), refetchInterval: 20_000 });
  const modelsQ = useQuery({ queryKey: ['codereview-models'], queryFn: api.codereviewModels });
  const models = modelsQ.data?.models || [];
  const recommended = modelsQ.data?.recommended || { review: [], fix: [], verify: [] };

  const allReports = q.data?.reports || [];
  const crProjects = q.data?.projects || [];
  const projectOptions = crProjects.length ? crProjects.map((p) => p.slug) : [...new Set(allReports.map((r) => r.project_slug))];
  const reports = projectFilter ? allReports.filter((r) => r.project_slug === projectFilter) : allReports;
  const latest = reports[Math.min(selected, Math.max(reports.length - 1, 0))] || reports[0];
  const shownSlug = projectFilter || latest?.project_slug || '';

  const attacksQ = useQuery({
    queryKey: ['codereview-attacks', shownSlug],
    queryFn: () => api.codereviewAttacks(shownSlug),
    enabled: !!shownSlug,
    refetchInterval: (query) => {
      const list = query.state.data?.attacks || [];
      return list.some((a) => a.status === 'running') ? 2000 : 20_000;
    },
  });
  const attacks = attacksQ.data?.attacks || [];
  const projAttacks = latest ? attacks.filter((a) => a.report_id === latest.id) : [];
  const attacking = attacks.some((a) => a.status === 'running' && a.project_slug === shownSlug);

  // POST /codereview/run fica pendurado até o review terminar (o backend faz `await` do ciclo
  // inteiro) — não dá pra depender só do fetch pra "tempo real": se a aba não estiver com o
  // projeto certo selecionado, ou o proxy cortar a conexão longa (blip de rede), a UI ficava
  // muda até o fetch resolver (ou nunca). Poll dedicado e independente do mutate resolve os dois
  // casos: cobre "Todos" (getAllReviewProgress) e sobrevive mesmo se o fetch original falhar.
  const runStatusQ = useQuery({
    queryKey: ['codereview-run-status', projectFilter],
    queryFn: () => api.codereviewRunStatus(projectFilter || undefined),
    refetchInterval: (query) => {
      const d = query.state.data;
      const running = projectFilter ? d?.status === 'running' : Object.values(d || {}).some((p) => p?.status === 'running');
      return running ? 1500 : 6000;
    },
  });
  const runningEntries = projectFilter
    ? (runStatusQ.data?.status === 'running' ? [[projectFilter, runStatusQ.data]] : [])
    : Object.entries(runStatusQ.data || {}).filter(([, p]) => p?.status === 'running');
  const anyRunning = runningEntries.length > 0;

  const run = useMutation({
    mutationFn: () => {
      const [reviewModel] = sel.review;
      return api.runCodereview({ ...(projectFilter ? { slug: projectFilter } : {}), ...(reviewModel ? { model: reviewModel } : {}) });
    },
    onSuccess: (r) => {
      // Resposta de "Todos" (POST sem slug) não tem {ok}, tem {triggered, results} — trata como
      // sucesso genérico. Resposta de projeto único carrega ok/alreadyReviewed/error.
      if (r && r.ok === false) toast.error(r.error || 'Review falhou');
      else if (r && r.alreadyReviewed) toast.info('Sem commit novo desde o último review — nada a fazer');
      else toast.success('Review concluído');
      queryClient.invalidateQueries({ queryKey: ['codereview'] });
      runStatusQ.refetch();
    },
    onError: (e) => toast.error(`Review falhou: ${e.message}`),
  });

  const attack = useMutation({
    mutationFn: (report) => {
      const fixModel = sel.fix[0]; const verifyModel = sel.verify[0];
      return api.runAttack({
        slug: report.project_slug, reportId: report.id,
        ...(fixModel ? { model: fixModel } : {}),
        ...(verifyModel ? { verifyModel } : {}),
      });
    },
    onSuccess: () => { toast.success('Ciclo de ataque disparado'); attacksQ.refetch(); },
    onError: (e) => toast.error(`Ataque falhou: ${e.message}`),
  });

  const merge = useMutation({
    mutationFn: (a) => api.mergePr({ slug: a.project_slug, prNumber: a.pr_number, mergeMethod: 'squash' }),
    onSuccess: (d, a) => {
      setMergedFlag((m) => ({ ...m, [a.id]: true }));
      toast.success(d?.promotion?.prUrl ? 'Mergeado — PR de promoção aberto' : 'PR mergeado');
      attacksQ.refetch();
    },
    onError: (e) => toast.error(`Merge falhou: ${e.message}`),
  });

  const toolbar = (
    <div className="flex flex-col gap-3 mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => { setProjectFilter(''); setSelected(0); }}
            className={cn('h-7.5 px-3 rounded-lg border text-[12px] font-medium cursor-pointer transition-colors',
              !projectFilter ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-overlay text-muted hover:text-fg')}
          >Todos</button>
          {projectOptions.map((p) => (
            <button key={p} onClick={() => { setProjectFilter(p); setSelected(0); }}
              className={cn('h-7.5 px-3 rounded-lg border text-[12px] font-medium cursor-pointer transition-colors data',
                projectFilter === p ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-overlay text-muted hover:text-fg')}
            >{p}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowModels((v) => !v)} className={showModels ? 'text-accent' : ''}>
            <Sliders size={13} /> Modelos
          </Button>
          <Button variant="primary" size="sm" loading={run.isPending} disabled={anyRunning && !run.isPending} onClick={() => run.mutate()}>
            <Play size={13} /> {run.isPending || anyRunning ? 'Rodando…' : projectFilter ? `Rodar — ${projectFilter}` : 'Rodar review'}
          </Button>
          {latest && (
            <Button variant="soft" size="sm" loading={attack.isPending}
              disabled={attacking || !latest || (Array.isArray(latest.issues) ? latest.issues.length === 0 : true)}
              onClick={() => attack.mutate(latest)}>
              <Swords size={13} /> {attacking ? 'Atacando…' : 'Atacar PR'}
            </Button>
          )}
        </div>
      </div>
      <ModelPickers open={showModels} models={models} recommended={recommended} sel={sel} />
      {anyRunning && (
        <div className="flex flex-col gap-1">
          {runningEntries.map(([slug, p]) => (
            <div key={slug} className="flex items-center gap-2 data text-[11.5px] text-muted">
              <span className="status-dot status-dot--pulse bg-accent" />
              {!projectFilter && <span className="text-fg font-medium">{slug}:</span>} {p.step || 'rodando…'}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div>
      {toolbar}
      <QueryState query={q} skeleton={<div className="skeleton h-96" />}>
        {reports.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Nenhum report" hint={`Dispare o pipeline${projectFilter ? ` para ${projectFilter}` : ''} pra gerar a primeira análise.`} />
        ) : (() => {
          const issues = Array.isArray(latest.issues) ? latest.issues : [];
          const refactors = Array.isArray(latest.refactors) ? latest.refactors : [];
          const critical = issues.filter((i) => i.severity === 'critical' || i.severity === 'high');
          const warnings = issues.filter((i) => i.severity === 'warning' || i.severity === 'medium');
          const info = issues.filter((i) => !['critical', 'high', 'warning', 'medium'].includes(i.severity));
          const trendReports = allReports.filter((r) => r.project_slug === latest.project_slug).slice().reverse();
          const trendScores = trendReports.map((r) => (r.score != null ? Number(r.score) : 0));
          const runningAttack = projAttacks.find((a) => a.status === 'running');
          const lastAttack = projAttacks.find((a) => a.status !== 'running');

          return (
            <div className="flex flex-col gap-4">
              {(runningAttack || attacking) && projAttacks[0] && <AttackProgress a={projAttacks[0]} />}
              {!runningAttack && !attacking && lastAttack && (
                <AttackResult a={lastAttack} onMerge={(a) => merge.mutate(a)} merging={merge.isPending} mergedFlag={mergedFlag[lastAttack.id]} />
              )}

              {/* Hero: score ring + severidade */}
              <div className="grid lg:grid-cols-2 gap-4">
                <Spotlight className="card p-5 flex items-center gap-5">
                  <ScoreRing score={latest.score != null ? Number(latest.score) : null} />
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-fg truncate">{latest.display_name || latest.project_slug}</p>
                    <p className="data text-[11px] text-faint mt-0.5 truncate">
                      {(latest.commit_sha || '').slice(0, 7) || '—'} · {latest.model_used || 'modelo n/d'}
                    </p>
                    <p className="data text-[11px] text-faint">{fmtDateTime(latest.created_at)}</p>
                    {trendScores.length > 1 && (
                      <div className="flex items-center gap-2 mt-2">
                        <Sparkline data={trendScores} tone={scoreTone(latest.score)} />
                        <span className="data text-[10.5px] text-faint">{trendScores.length} reviews</span>
                      </div>
                    )}
                  </div>
                </Spotlight>

                <Spotlight className="card p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[13px] font-semibold text-fg">Issues por severidade</span>
                    <span className="data tnum text-[13px] text-muted">{issues.length}</span>
                  </div>
                  <SeverityBar critical={critical.length} warning={warnings.length} info={info.length} />
                  <div className="flex flex-col gap-1.5 mt-3">
                    {[['bad', critical.length, 'críticas'], ['warn', warnings.length, 'avisos'], ['info', info.length, 'infos'], ['neutral', refactors.length, 'refactors']].map(([t, n, lbl]) => (
                      <div key={lbl} className="flex items-center justify-between">
                        <Badge tone={t} dot={false}>{lbl}</Badge>
                        <span className="data tnum text-[12px] text-muted">{n}</span>
                      </div>
                    ))}
                  </div>
                </Spotlight>
              </div>

              {/* Issues + summary/histórico */}
              <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4 items-start">
                <div className="flex flex-col gap-4">
                  {critical.length > 0 && (
                    <Spotlight className="card p-5">
                      <SectionHeader title={`Issues críticas (${critical.length})`} />
                      <IssueList issues={critical} tone="bad" report={latest} />
                    </Spotlight>
                  )}
                  {warnings.length > 0 && (
                    <Spotlight className="card p-5">
                      <SectionHeader title={`Avisos (${warnings.length})`} />
                      <IssueList issues={warnings} tone="warn" report={latest} />
                    </Spotlight>
                  )}
                  {info.length > 0 && (
                    <Spotlight className="card p-5">
                      <SectionHeader title={`Informativos (${info.length})`} />
                      <IssueList issues={info} tone="info" report={latest} />
                    </Spotlight>
                  )}
                  {refactors.length > 0 && (
                    <Spotlight className="card p-5">
                      <SectionHeader title={`Refatorações sugeridas (${refactors.length})`} />
                      <div className="flex flex-col gap-2">
                        {refactors.map((r, i) => (
                          <div key={i} className="p-3 rounded-lg border border-line bg-subtle/50">
                            {(typeof r !== 'string' && r.file) && <p className="data text-[11.5px] font-semibold text-fg mb-1">{r.file}</p>}
                            <p className="text-[12px] text-muted leading-snug">{typeof r === 'string' ? r : (r.description || r.message || JSON.stringify(r))}</p>
                          </div>
                        ))}
                      </div>
                    </Spotlight>
                  )}
                  {issues.length === 0 && refactors.length === 0 && (
                    <EmptyState icon={Check} title="Sem issues" hint="Este report não apontou problemas." />
                  )}
                </div>

                <div className="flex flex-col gap-4">
                  <Spotlight className="card p-5">
                    <SectionHeader title="Resumo da revisão" />
                    {issues.length === 0 && latest.pr_number && (
                      <Badge tone="ok" className="gap-1 mb-3"><Check size={10} /> aprovado · pronto pra merge</Badge>
                    )}
                    <p className="text-[12.5px] text-muted leading-relaxed whitespace-pre-wrap">{latest.summary || 'Sem resumo disponível.'}</p>
                    {latest.pr_url && (
                      <a href={latest.pr_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 mt-3 text-[12px] text-accent hover:underline">
                        <GitPullRequest size={12.5} /> Ver PR #{latest.pr_number || ''}
                      </a>
                    )}
                  </Spotlight>

                  <Spotlight className="card p-5">
                    <SectionHeader title={`Histórico (${reports.length})`} />
                    <div className="flex flex-col gap-1.5 max-h-[420px] overflow-y-auto -mr-1 pr-1">
                      {reports.map((r, i) => {
                        const rowIssues = Array.isArray(r.issues) ? r.issues.length : 0;
                        const prNum = r.pr_number || (r.pr_url ? (String(r.pr_url).match(/\/pull\/(\d+)/) || [])[1] : null);
                        const rowBusy = attacks.some((a) => a.status === 'running' && a.project_slug === r.project_slug);
                        return (
                          <div key={r.id || i} className={cn('flex items-center gap-2.5 p-2.5 rounded-lg border transition-colors',
                            i === selected ? 'border-accent-line bg-accent-soft/30' : 'border-line bg-subtle/40 hover:bg-hover')}>
                            <button onClick={() => setSelected(i)} className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer">
                              <span className={cn('data tnum text-[13px] font-bold w-7 flex-none', TONE_TEXT[scoreTone(r.score)])}>
                                {r.score == null ? '—' : Number(r.score).toFixed(1)}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-[12px] font-medium text-fg truncate">
                                  {r.display_name || r.project_slug}{prNum && <span className="data text-faint"> PR #{prNum}</span>}
                                </span>
                                <span className="block data text-[10.5px] text-faint truncate">
                                  {(r.commit_sha || '').slice(0, 7)} · {fmtRelative(r.created_at)}
                                </span>
                              </span>
                              <span className="data text-[10.5px] text-faint flex-none">{rowIssues} issues</span>
                            </button>
                            <div className="flex items-center gap-1 flex-none">
                              {r.pr_url && (
                                <a href={r.pr_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                                  className="text-faint hover:text-accent transition-colors" aria-label="Abrir PR"><ChevronRight size={13} /></a>
                              )}
                              <Button size="xs" variant="ghost" disabled={rowBusy || rowIssues === 0 || attack.isPending}
                                onClick={() => { setSelected(i); attack.mutate(r); }}>
                                <Swords size={11} /> {rowBusy ? '…' : 'Atacar'}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Spotlight>
                </div>
              </div>
            </div>
          );
        })()}
      </QueryState>
    </div>
  );
}

/* ---------------- Conflict drawer (markers reais + resolução) ---------------- */

function ConflictDrawer({ open, slug, prNumber, onClose }) {
  const queryClient = useQueryClient();
  const [attempt, setAttempt] = React.useState(null);
  const q = useQuery({
    queryKey: ['conflicts', slug, prNumber],
    queryFn: () => api.conflicts(slug, prNumber),
    enabled: open && !!slug && !!prNumber,
  });
  const d = q.data || {};
  const running = attempt?.status === 'running';

  const resolve = useMutation({
    mutationFn: () => api.resolveConflict({ slug, prNumber }),
    onSuccess: () => { setAttempt({ status: 'running', current_step: 'iniciando…' }); toast.info('Resolução iniciada'); },
    onError: (e) => toast.error(`Falha: ${e.message}`),
  });

  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      try {
        const r = await api.conflictStatus(slug, prNumber);
        const a = r.attempt || null;
        setAttempt(a);
        if (a && a.status !== 'running') {
          clearInterval(t);
          if (a.status === 'done' || a.status === 'success') { toast.success('Conflitos resolvidos'); q.refetch(); queryClient.invalidateQueries({ queryKey: ['codereview-prs'] }); }
          else if (a.status === 'failed' || a.status === 'error') toast.error(`Resolução falhou: ${a.error || a.current_step || 'erro'}`);
        }
      } catch { /* mantém */ }
    }, 3000);
    return () => clearInterval(t);
  }, [running, slug, prNumber]);

  return (
    <Drawer open={open} onClose={onClose} title={`Conflitos — PR #${prNumber}`} sub={slug} width={640}>
      {q.isPending ? <div className="skeleton h-40" />
        : q.isError || (d.ok === false) ? <p className="text-[12.5px] text-bad">{q.error?.message || d.error}</p>
        : !d.hasConflicts ? <p className="text-[12.5px] text-ok">Sem conflitos — PR pode ser mergeado normalmente.</p>
        : (
          <>
            <p className="data text-[11.5px] text-muted mb-3">{d.headBranch} → {d.baseBranch} · {(d.files || []).length} arquivo(s)</p>
            <div className="flex flex-col gap-3">
              {(d.files || []).map((f) => (
                <div key={f.path}>
                  <p className="data text-[11.5px] font-semibold text-fg mb-1">{f.path}</p>
                  <pre className="data text-[10px] leading-[1.6] text-muted bg-[#050506] border border-line rounded-lg p-3 overflow-auto max-h-[220px] whitespace-pre-wrap break-all">{f.markers}</pre>
                </div>
              ))}
            </div>
            {attempt && (
              <div className="flex items-center gap-2 mt-3">
                <StatusBadge status={attempt.status} />
                <span className="data text-[11.5px] text-muted">{attempt.current_step}</span>
              </div>
            )}
            {attempt?.error && <p className="data text-[11px] text-bad mt-1">{attempt.error}</p>}
            <Button variant="primary" size="sm" className="mt-4" loading={resolve.isPending} disabled={running} onClick={() => resolve.mutate()}>
              <RefreshCcw size={13} /> {running ? 'Resolvendo…' : 'Corrigir conflitos automaticamente'}
            </Button>
          </>
        )}
    </Drawer>
  );
}

/* ---------------- PRs & Merge tab ---------------- */

function PrRow({ pr, slug, approved, onOpenConflict, onMerged }) {
  const queryClient = useQueryClient();
  const merge = useMutation({
    mutationFn: () => api.mergePr({ slug, prNumber: pr.number, mergeMethod: 'squash' }),
    onSuccess: (d) => {
      toast.success(d?.promotion?.prUrl ? 'Mergeado — promoção aberta' : `PR #${pr.number} mergeado`);
      queryClient.invalidateQueries({ queryKey: ['codereview-prs', slug] });
      onMerged?.();
    },
    onError: (e) => toast.error(`Merge falhou: ${e.message}`),
  });
  const readyToMerge = approved && !pr.conflicted && !pr.draft;
  return (
    <div className={cn(
      'flex items-center gap-3 p-3.5 rounded-lg border bg-subtle/50 hover:bg-hover transition-colors',
      readyToMerge ? 'border-ok/30 bg-ok-soft/20' : 'border-line',
    )}>
      <GitPullRequest size={14} className={readyToMerge ? 'text-ok flex-none' : 'text-accent flex-none'} />
      <div className="min-w-0 flex-1">
        <a href={pr.url} target="_blank" rel="noreferrer" className="text-[12.5px] font-medium text-fg truncate hover:text-accent block">#{pr.number} · {pr.title || 'sem título'}</a>
        <p className="data text-[10.5px] text-faint mt-0.5 truncate">{[pr.head, pr.base && `→ ${pr.base}`, pr.author].filter(Boolean).join(' ')}</p>
      </div>
      {readyToMerge && <Badge tone="ok" className="gap-1"><Check size={10} /> aprovado · pronto pra merge</Badge>}
      {pr.draft && <Badge tone="neutral" dot={false}>draft</Badge>}
      {!pr.draft && !readyToMerge && <Badge tone="ok" dot={false}>aberto</Badge>}
      {pr.conflicted && (
        <Button size="xs" variant="ghost" className="text-bad" onClick={() => onOpenConflict(pr.number)}>
          <GitMerge size={12} /> conflitos
        </Button>
      )}
      <Button size="xs" variant={readyToMerge ? 'primary' : 'soft'} loading={merge.isPending} disabled={pr.conflicted} onClick={() => merge.mutate()}>
        <GitMerge size={12} /> Merge
      </Button>
    </div>
  );
}

function PrsTab({ projects }) {
  const [slug, setSlug] = React.useState('');
  const [conflictPr, setConflictPr] = React.useState(null);
  const effective = slug || projects[0]?.slug || '';
  const q = useQuery({ queryKey: ['codereview-prs', effective], queryFn: () => api.codereviewPrs(effective), enabled: !!effective });
  const open = q.data?.open || [];
  const merged = q.data?.merged || [];

  // Cruza PR aberto com o report mais recente daquele número — sem issues = já auditado e
  // pronto pra merge, sem depender de rodar ataque/verify (que só existe pra corrigir issue).
  const reportsQ = useQuery({ queryKey: ['codereview'], queryFn: () => api.codereview() });
  const approvedPrNumbers = React.useMemo(() => {
    const reports = reportsQ.data?.reports || [];
    const set = new Set();
    for (const r of reports) {
      if (r.project_slug !== effective) continue;
      const issues = Array.isArray(r.issues) ? r.issues.length : 0;
      if (issues === 0 && r.pr_number) set.add(r.pr_number);
    }
    return set;
  }, [reportsQ.data, effective]);

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {projects.map((p) => (
          <button key={p.slug} onClick={() => setSlug(p.slug)}
            className={cn('h-8 px-3 rounded-lg border text-[12px] font-medium cursor-pointer transition-colors data',
              effective === p.slug ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-overlay text-muted hover:text-fg')}>
            {p.display_name || p.slug}
          </button>
        ))}
      </div>
      <QueryState query={q} skeleton={<div className="skeleton h-48" />}>
        {open.length === 0 && merged.length === 0 ? (
          <EmptyState icon={GitPullRequest} title="Nenhum PR" hint={`Sem PRs em ${effective}.`} />
        ) : (
          <div className="flex flex-col gap-5">
            {open.length > 0 && (
              <div>
                <p className="text-[10.5px] uppercase tracking-[0.07em] text-faint font-semibold mb-2">Abertos ({open.length})</p>
                <div className="flex flex-col gap-2">
                  {open.map((pr) => (
                    <PrRow key={pr.number} pr={pr} slug={effective} approved={approvedPrNumbers.has(pr.number)}
                      onOpenConflict={(n) => setConflictPr(n)} onMerged={() => q.refetch()} />
                  ))}
                </div>
              </div>
            )}
            {merged.length > 0 && (
              <div>
                <p className="text-[10.5px] uppercase tracking-[0.07em] text-faint font-semibold mb-2">Últimos mergeados</p>
                <div className="flex flex-col gap-2">
                  {merged.map((pr) => (
                    <div key={pr.number} className="flex items-center gap-3 p-3 rounded-lg border border-line bg-subtle/40">
                      <Badge tone="violet" dot={false}>mergeado</Badge>
                      <a href={pr.url} target="_blank" rel="noreferrer" className="text-[12px] text-muted truncate hover:text-accent flex-1 min-w-0">#{pr.number} {pr.title}</a>
                      <span className="data text-[10.5px] text-faint flex-none">{pr.mergedAt ? fmtRelative(pr.mergedAt) : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </QueryState>
      <ConflictDrawer open={conflictPr != null} slug={effective} prNumber={conflictPr} onClose={() => setConflictPr(null)} />
    </div>
  );
}

/* ---------------- Página ---------------- */

export default function CodeReview() {
  const [tab, setTab] = React.useState('reports');
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const projects = projectsQ.data?.projects || [];

  return (
    <div>
      <SectionHeader title="Pipeline de review" sub="Análise, ataques adversariais, merge assistido e resolução de conflitos" />
      <div className="flex items-center gap-1 mb-5 rounded-lg border border-line bg-overlay p-1 w-fit">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn('flex items-center gap-1.5 h-7.5 px-3 rounded-md text-[12.5px] font-medium cursor-pointer transition-colors duration-150',
              tab === t.id ? 'bg-hover text-fg' : 'text-faint hover:text-muted')}>
            <t.icon size={13.5} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'reports' && <ReportsTab />}
      {tab === 'prs' && <PrsTab projects={projects} />}
    </div>
  );
}
