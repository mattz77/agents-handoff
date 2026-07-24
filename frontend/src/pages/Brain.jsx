import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Brain, Search, Sparkles, ListChecks, BookOpen } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Badge, StatusBadge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { SectionHeader, QueryState, EmptyState, Spotlight, Spinner } from '../components/ui/misc.jsx';
import { BrandIcon, brandForText } from '../components/ui/brand-icons.jsx';
import { fmtRelative } from '../lib/format';

function SemanticSearch() {
  const [query, setQuery] = React.useState('');
  const [submitted, setSubmitted] = React.useState('');
  const q = useQuery({
    queryKey: ['brain-search', submitted],
    queryFn: () => api.brainSearch(submitted),
    enabled: !!submitted,
  });
  const results = q.data?.results || (Array.isArray(q.data) ? q.data : []);

  return (
    <Spotlight className="card p-5 mb-5">
      <SectionHeader title="Busca semântica" sub="RAG sobre active-context, decisions e checkpoints" />
      <form
        onSubmit={(e) => { e.preventDefault(); if (query.trim()) setSubmitted(query.trim()); }}
        className="flex gap-2 mb-4"
      >
        <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-overlay flex-1 focus-within:border-accent-line transition-colors">
          <Search size={13.5} className="text-faint flex-none" />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="ex: decisão sobre circuit breaker, task do datalake…"
            className="flex-1 bg-transparent outline-none text-[13px] text-fg placeholder:text-faint"
          />
        </div>
        <Button type="submit" variant="primary" size="md" loading={q.isFetching}>Buscar</Button>
      </form>
      {q.isFetching && <div className="flex justify-center py-6"><Spinner /></div>}
      {!q.isFetching && submitted && results.length === 0 && !q.isError && (
        <EmptyState title="Nenhum resultado" hint="Tente outros termos — a busca é vetorial, sinônimos funcionam." />
      )}
      <div className="flex flex-col gap-2">
        {results.map((r, i) => (
          <div key={i} className="p-3.5 rounded-lg border border-line bg-subtle/60 hover:bg-hover transition-colors">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="data text-[10.5px] text-accent font-semibold">SCORE {Math.round((r.score || 0) * 100)}%</span>
              <span className="data text-[10.5px] text-faint truncate">{r.heading || r.source || 'texto'}</span>
            </div>
            <p className="text-[12.5px] text-muted leading-relaxed">{r.snippet || r.text}</p>
          </div>
        ))}
      </div>
    </Spotlight>
  );
}

export default function BrainPage() {
  const q = useQuery({ queryKey: ['brain'], queryFn: api.brain, refetchInterval: 20_000 });
  const data = q.data || {};
  const decisions = data.recentDecisions || [];
  const tasks = data.taskList || [];

  return (
    <div>
      <SemanticSearch />
      <QueryState query={q} skeleton={<div className="skeleton h-64" />}>
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: 'Pendentes', value: data.pendingTasks, tone: 'text-warn' },
            { label: 'Em andamento/concluídas', value: data.completedTasks, tone: 'text-ok' },
            { label: 'Bloqueadas', value: data.blockedTasks, tone: 'text-bad' },
          ].map((s) => (
            <div key={s.label} className="card p-4">
              <p className={cn('data tnum text-[22px] font-semibold leading-none', s.tone)}>{s.value ?? '—'}</p>
              <p className="text-[10.5px] text-faint uppercase tracking-[0.06em] mt-2">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <Spotlight className="card p-5">
            <SectionHeader title="Modelo ativo" sub="quem está dirigindo agora" />
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-accent-soft border border-accent-line/50 flex items-center justify-center text-accent">
                {brandForText(data.activeModel)
                  ? <BrandIcon brand={brandForText(data.activeModel)} size={18} />
                  : <Sparkles size={17} strokeWidth={1.8} />}
              </span>
              <div>
                <p className="text-[15px] font-semibold text-fg">{data.activeModel || '—'}</p>
                <p className="data text-[11px] text-faint mt-0.5">
                  {data.lastSync ? `sync ${fmtRelative(data.lastSync)}` : 'sem sync registrado'}
                  {data.hotSizeKB != null && ` · hot ${data.hotSizeKB} KB`}
                </p>
              </div>
            </div>
            {data.currentTask && (
              <div className="mt-4 p-3 rounded-lg bg-subtle border border-line">
                <p className="text-[10.5px] uppercase tracking-[0.07em] text-faint font-semibold mb-1">tarefa atual</p>
                <p className="text-[12.5px] text-muted">{data.currentTask}</p>
              </div>
            )}
          </Spotlight>

          <Spotlight className="card p-5">
            <SectionHeader title="Fila de tarefas" sub={`${tasks.length} listada(s)`} />
            {tasks.length === 0 ? <EmptyState icon={ListChecks} title="Fila vazia" /> : (
              <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto -mr-1 pr-1">
                {tasks.slice(0, 12).map((t, i) => (
                  <div key={t.id || i} className="flex items-center gap-3 p-2.5 rounded-lg border border-line bg-subtle/50">
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-medium text-fg truncate">{t.title || t.name || t.id}</p>
                      <p className="data text-[10.5px] text-faint mt-0.5">
                        {[t.assigned && `→ ${t.assigned}`, t.priority].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <StatusBadge status={t.status} />
                  </div>
                ))}
              </div>
            )}
          </Spotlight>
        </div>

        <Spotlight className="card p-5 mt-4">
          <SectionHeader title="Decisões recentes" sub="log append-only de decisões arquiteturais" />
          {decisions.length === 0 ? <EmptyState icon={BookOpen} title="Sem decisões registradas" /> : (
            <div className="flex flex-col gap-2.5 max-h-[340px] overflow-y-auto -mr-1 pr-1">
              {decisions.slice(0, 15).map((d, i) => {
                const brand = brandForText(d.model);
                return (
                <div key={i} className="flex gap-3 p-3 rounded-lg border border-line bg-subtle/50">
                  {brand ? <BrandIcon brand={brand} size={14} className="text-accent flex-none mt-0.5" /> : <Brain size={14} className="text-accent flex-none mt-0.5" />}
                  <div className="min-w-0">
                    <p className="text-[12.5px] text-fg leading-snug">{d.title || d.decision || d.text}</p>
                    <p className="data text-[10.5px] text-faint mt-1">
                      {[d.model, d.date || d.created_at ? fmtRelative(d.date || d.created_at) : null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </Spotlight>
      </QueryState>
    </div>
  );
}
