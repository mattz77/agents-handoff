import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Bot, GitBranch, ExternalLink, X } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { SectionHeader, QueryState, EmptyState, Spotlight } from '../components/ui/misc.jsx';
import { BrandIcon, brandForText } from '../components/ui/brand-icons.jsx';
import { AgentTaskDrawer } from '../components/drawers/AgentTaskDrawer.jsx';
import { fmtRelative } from '../lib/format';

const COLUMNS = [
  { id: 'queued', label: 'Fila', tones: ['QUEUED', 'PENDING', 'TODO', 'NEW'], badge: 'neutral' },
  { id: 'running', label: 'Em execução', tones: ['IN_PROGRESS', 'RUNNING', 'CLAIMED'], badge: 'info' },
  { id: 'review', label: 'Revisão', tones: ['REVIEW', 'PR_OPEN', 'AWAITING_REVIEW'], badge: 'warn' },
  { id: 'done', label: 'Concluído', tones: ['DONE', 'COMPLETED', 'MERGED', 'SUCCESS'], badge: 'ok' },
  { id: 'failed', label: 'Falhou', tones: ['FAILED', 'ERROR', 'CANCELLED'], badge: 'bad' },
];

const columnOf = (status) => {
  const s = (status || '').toUpperCase();
  return COLUMNS.find((c) => c.tones.includes(s))?.id || 'queued';
};

const LIVE_STATUSES = ['queued', 'running'];

function TaskCard({ task, onOpen }) {
  const title = task.title || task.description?.slice(0, 80) || task.id;
  const isLive = LIVE_STATUSES.includes((task.status || '').toLowerCase());
  const lastLog = Array.isArray(task.log) && task.log.length ? task.log[task.log.length - 1] : null;
  return (
    <Spotlight className="card card-interactive p-3.5" onClick={onOpen}>
      <p className="text-[12.5px] font-medium text-fg leading-snug">{title}</p>
      {isLive && lastLog && (
        <p className="flex items-center gap-1.5 mt-2 data text-[10.5px] text-accent truncate">
          <span className="status-dot status-dot--pulse bg-accent flex-none" /> {lastLog.message}
        </p>
      )}
      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
        {(task.agent || task.engine) && (
          <span className="flex items-center gap-1 text-[10.5px] data text-faint">
            {brandForText(task.agent || task.engine)
              ? <BrandIcon brand={brandForText(task.agent || task.engine)} size={11} />
              : <Bot size={11} />}
            {task.agent || task.engine}
          </span>
        )}
        {task.branch && (
          <span className="flex items-center gap-1 text-[10.5px] data text-faint truncate">
            <GitBranch size={11} /> {task.branch}
          </span>
        )}
        <span className="text-[10.5px] data text-faint ml-auto">{fmtRelative(task.created_at || task.updated_at)}</span>
      </div>
      {task.pr_url && (
        <a
          href={task.pr_url} target="_blank" rel="noreferrer"
          className="flex items-center gap-1.5 mt-2.5 text-[11.5px] text-accent hover:underline"
        >
          <ExternalLink size={11.5} /> Abrir PR
        </a>
      )}
    </Spotlight>
  );
}

function CreateTaskModal({ open, onClose }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [projectSlug, setProjectSlug] = React.useState('');
  const [engine, setEngine] = React.useState('nim');
  const [model, setModel] = React.useState('');

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: api.projects, enabled: open });
  const modelsQ = useQuery({ queryKey: ['codereview-models'], queryFn: api.codereviewModels, enabled: open });
  const projects = projectsQ.data?.projects || [];
  const models = modelsQ.data?.models || [];

  const create = useMutation({
    mutationFn: api.createAgentTask,
    onSuccess: () => {
      toast.success('Task delegada — agente vai criar branch isolada');
      queryClient.invalidateQueries({ queryKey: ['agent-tasks'] });
      setTitle(''); setDescription(''); setProjectSlug(''); setModel('');
      onClose();
    },
    onError: (e) => toast.error(`Falha ao delegar: ${e.message}`),
  });

  if (!open) return null;
  const canSubmit = title.trim() && description.trim() && projectSlug;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" onClick={onClose} />
      <div className="relative w-full max-w-[440px] card p-5" style={{ boxShadow: 'var(--shadow-pop)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14.5px] font-semibold tracking-tight">Delegar task a um agente</h3>
          <button onClick={onClose} className="text-faint hover:text-fg cursor-pointer" aria-label="Fechar"><X size={16} /></button>
        </div>
        <div className="flex flex-col gap-3">
          <input
            autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Título curto da task"
            className="h-9 px-3 rounded-lg border border-line bg-overlay text-[13px] text-fg placeholder:text-faint outline-none focus:border-accent-line"
          />
          <textarea
            value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Contexto, arquivos envolvidos, resultado esperado…" rows={4}
            className="px-3 py-2.5 rounded-lg border border-line bg-overlay text-[13px] text-fg placeholder:text-faint outline-none focus:border-accent-line resize-none"
          />
          <select
            value={projectSlug} onChange={(e) => setProjectSlug(e.target.value)}
            className="h-9 px-3 rounded-lg border border-line bg-overlay text-[13px] text-fg outline-none focus:border-accent-line cursor-pointer"
          >
            <option value="">Projeto (obrigatório)…</option>
            {projects.map((p) => <option key={p.slug} value={p.slug}>{p.display_name || p.slug}</option>)}
          </select>
          <div className="flex gap-2">
            <select
              value={engine} onChange={(e) => setEngine(e.target.value)}
              className="h-9 px-3 rounded-lg border border-line bg-overlay text-[13px] data text-fg outline-none focus:border-accent-line cursor-pointer"
            >
              <option value="nim">nim</option>
            </select>
            <select
              value={model} onChange={(e) => setModel(e.target.value)}
              className="flex-1 min-w-0 h-9 px-3 rounded-lg border border-line bg-overlay text-[13px] data text-fg outline-none focus:border-accent-line cursor-pointer"
            >
              <option value="">Modelo (default do projeto)…</option>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 mt-1">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button
              variant="primary" loading={create.isPending} disabled={!canSubmit}
              onClick={() => create.mutate({
                title: title.trim(),
                description: description.trim(),
                project_slug: projectSlug,
                engine,
                model: model || undefined,
              })}
            >
              Delegar task
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Agents() {
  const [modalOpen, setModalOpen] = React.useState(false);
  const [selected, setSelected] = React.useState(null);
  const q = useQuery({
    queryKey: ['agent-tasks'], queryFn: api.agentTasks,
    // Poll rápido enquanto alguma task está na fila/rodando — sensação de acompanhar ao vivo
    // no kanban, não só dentro do drawer.
    refetchInterval: (query) => {
      const tasks = query.state.data?.tasks || [];
      return tasks.some((t) => LIVE_STATUSES.includes((t.status || '').toLowerCase())) ? 3000 : 15_000;
    },
  });
  const items = q.data?.tasks || (Array.isArray(q.data) ? q.data : []);

  return (
    <div>
      <SectionHeader
        title="Kanban de tasks"
        sub="Cada task roda em branch isolada e volta como PR pra revisão"
        actions={<Button variant="primary" size="sm" onClick={() => setModalOpen(true)}><Plus size={14} /> Nova task</Button>}
      />
      <QueryState query={q} skeleton={<div className="skeleton h-72" />}>
        {items.length === 0 ? (
          <EmptyState
            icon={Bot} title="Nenhuma task delegada"
            hint="Delegue a primeira task — o agente trabalha em branch própria e abre PR."
            action={<Button variant="primary" size="sm" onClick={() => setModalOpen(true)}><Plus size={14} /> Nova task</Button>}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-start">
            {COLUMNS.map((col) => {
              const tasks = items.filter((t) => columnOf(t.status) === col.id);
              return (
                <div key={col.id} className="flex flex-col gap-2 min-w-0">
                  <div className="flex items-center gap-2 px-1">
                    <Badge tone={col.badge} dot={false}>{col.label}</Badge>
                    <span className="data tnum text-[11px] text-faint">{tasks.length}</span>
                  </div>
                  <div className="flex flex-col gap-2 min-h-[60px] p-1.5 rounded-xl border border-dashed border-line/70 bg-subtle/40">
                    {tasks.map((t) => <TaskCard key={t.id} task={t} onOpen={() => setSelected(t)} />)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </QueryState>
      <CreateTaskModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <AgentTaskDrawer task={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
