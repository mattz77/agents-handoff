import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Rocket, GitBranch, Terminal, History, ChevronDown, Plus, X, Server, Cloud } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Badge, StatusBadge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { SectionHeader, QueryState, EmptyState, Spotlight } from '../components/ui/misc.jsx';
import { fmtRelative, fmtDuration, fmtTime } from '../lib/format';

const ACTIONS = [
  { id: 'rebuild+up', label: 'Rebuild + Up' },
  { id: 'rebuild', label: 'Só rebuild' },
  { id: 'up', label: 'Só up' },
];

const TARGETS = [
  { id: 'self-hosted', label: 'Self-hosted', icon: Server },
  { id: 'vercel', label: 'Vercel', icon: Cloud },
];

/* Log ao vivo — o backend emite eventos SSE NOMEADOS (event: log / event: status),
   não o evento default. Cada `log` é {at, line}; `status` é {status, error}. Fecha ao
   receber status done|failed (o servidor dá res.end(); não há sentinela __END__). */
function LiveLog({ deployId, onDone }) {
  const [lines, setLines] = React.useState([]);
  const [status, setStatus] = React.useState('pending');
  const endRef = React.useRef(null);

  React.useEffect(() => {
    if (!deployId) return;
    setLines([]);
    setStatus('pending');
    const es = new EventSource(`${api.deployStreamUrl()}?id=${encodeURIComponent(deployId)}`);
    es.addEventListener('log', (e) => {
      try {
        const l = JSON.parse(e.data);
        setLines((cur) => [...cur.slice(-500), l]);
      } catch { /* linha malformada — ignora */ }
    });
    es.addEventListener('status', (e) => {
      try {
        const d = JSON.parse(e.data);
        setStatus(d.status);
        if (d.status === 'done' || d.status === 'failed') { es.close(); onDone?.(); }
      } catch { /* ignora */ }
    });
    // EventSource reconecta sozinho em blip de rede; só encerra de fato quando o server
    // fecha a conexão (readyState CLOSED) — não fecha no primeiro onerror transiente.
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) onDone?.(); };
    return () => es.close();
  }, [deployId]);

  React.useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines]);

  if (!deployId) return null;
  const running = status === 'pending' || status === 'running';
  return (
    <div className="card overflow-hidden mt-4">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
        <Terminal size={13.5} className="text-faint" />
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-faint">log do worker</span>
        <span className="data text-[10.5px] text-faint truncate">{deployId}</span>
        <StatusBadge status={status} className="ml-auto" />
      </div>
      <div className="h-[280px] overflow-y-auto p-4 bg-[#050506] data text-[11.5px] leading-[1.7]">
        {lines.length === 0
          ? <span className="text-faint">{running ? 'aguardando o worker de host pegar o pedido…' : 'sem saída.'}</span>
          : lines.map((l, i) => {
            const text = typeof l === 'string' ? l : l.line;
            const ts = typeof l === 'object' && l.at ? l.at : null;
            const isCmd = (text || '').startsWith('$ ');
            const isErr = /error|falh|erro|exit code [^0]|saiu com código [^0]/i.test(text || '');
            return (
              <div key={i} className={cn('whitespace-pre-wrap break-all', isErr ? 'text-[#ff9d9a]' : isCmd ? 'text-accent' : 'text-[#a8e6a3]')}>
                {ts && <span className="text-faint mr-2">{fmtTime(ts)}</span>}{text}
              </div>
            );
          })}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function NewDeployProjectModal({ open, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState({ slug: '', displayName: '', localPath: '', composeDir: '', composeService: '', vercelDeployHookUrl: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => api.createDeployProject(form),
    onSuccess: () => {
      toast.success('Projeto de deploy salvo');
      queryClient.invalidateQueries({ queryKey: ['deploy-projects'] });
      setForm({ slug: '', displayName: '', localPath: '', composeDir: '', composeService: '', vercelDeployHookUrl: '' });
      onClose();
    },
    onError: (e) => toast.error(`Falha: ${e.message}`),
  });

  if (!open) return null;
  const inputCls = 'h-9 px-3 rounded-lg border border-line bg-overlay text-[13px] data text-fg placeholder:text-faint outline-none focus:border-accent-line';
  const canSubmit = form.slug.trim() && form.localPath.trim();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" onClick={onClose} />
      <div className="relative w-full max-w-[480px] card p-5" style={{ boxShadow: 'var(--shadow-pop)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14.5px] font-semibold tracking-tight">Novo projeto de deploy</h3>
          <button onClick={onClose} className="text-faint hover:text-fg cursor-pointer" aria-label="Fechar"><X size={16} /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <input value={form.slug} onChange={set('slug')} placeholder="slug (ex: commit-briefing)" className={inputCls} />
            <input value={form.displayName} onChange={set('displayName')} placeholder="nome de exibição" className={inputCls} />
          </div>
          <input value={form.localPath} onChange={set('localPath')} placeholder="local_path — raiz do repo git (ex: C:\Users\...\app)" className={inputCls} />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.composeDir} onChange={set('composeDir')} placeholder="compose_dir (opcional)" className={inputCls} />
            <input value={form.composeService} onChange={set('composeService')} placeholder="compose_service" className={inputCls} />
          </div>
          <input value={form.vercelDeployHookUrl} onChange={set('vercelDeployHookUrl')} placeholder="Vercel deploy hook URL (opcional)" className={inputCls} />
          <div className="flex justify-end gap-2 mt-1">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button variant="primary" loading={save.isPending} disabled={!canSubmit} onClick={() => save.mutate()}>Salvar projeto</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Deploy() {
  const queryClient = useQueryClient();
  const projects = useQuery({ queryKey: ['deploy-projects'], queryFn: api.deployProjects, refetchInterval: 10_000 });
  const history = useQuery({ queryKey: ['deploy-history'], queryFn: api.deployHistory, refetchInterval: 10_000 });
  const [selected, setSelected] = React.useState(null);
  const [branch, setBranch] = React.useState('');
  const [action, setAction] = React.useState('rebuild+up');
  const [target, setTarget] = React.useState('self-hosted');
  const [activeDeploy, setActiveDeploy] = React.useState(null);
  const [newProjectOpen, setNewProjectOpen] = React.useState(false);

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
      <SectionHeader
        title="Executar deploy"
        sub="Selecione o projeto, branch, destino e ação — o worker executa na fila do host"
        actions={<Button variant="outline" size="sm" onClick={() => setNewProjectOpen(true)}><Plus size={14} /> Projeto</Button>}
      />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <QueryState query={projects} skeleton={<div className="skeleton h-24 sm:col-span-2 lg:col-span-3" />}>
          {list.map((p) => {
            const active = selected === p.slug;
            return (
              <button
                key={p.slug}
                onClick={() => { setSelected(p.slug); setBranch(''); }}
                className={cn('card card-interactive p-4 text-left', active && 'border-accent-line bg-accent-soft/40 shadow-[var(--glow-accent)]')}
              >
                <p className="text-[13.5px] font-semibold text-fg">{p.display_name || p.slug}</p>
                <p className="data text-[11px] text-faint mt-1 truncate">
                  {p.compose_service ? `docker · ${p.compose_service}` : p.vercel_deploy_hook_url ? 'vercel' : p.slug}
                </p>
                {p.local_path && <p className="data text-[10px] text-faint mt-0.5 truncate">{p.local_path}</p>}
                {active && <Badge tone="accent" className="mt-2.5" dot={false}>selecionado</Badge>}
              </button>
            );
          })}
        </QueryState>
      </div>

      {sel && target === 'self-hosted' && (
        <p className="data text-[11px] text-faint mb-3">
          {sel.local_path}{sel.compose_dir && sel.compose_dir !== sel.local_path && ` (compose em ${sel.compose_dir})`}
          {sel.compose_service && ` · serviço `}{sel.compose_service && <code className="text-muted">{sel.compose_service}</code>}
          {sel.branches_updated_at && ` · branches ${fmtRelative(sel.branches_updated_at)}`}
          {!branches.length && ' · worker ainda não listou branches — aguarde ~20s'}
        </p>
      )}

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
          {TARGETS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTarget(t.id)}
              className={cn('flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-medium cursor-pointer transition-colors duration-150',
                target === t.id ? 'bg-hover text-fg' : 'text-faint hover:text-muted')}
            >
              <t.icon size={13} /> {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center rounded-lg border border-line bg-overlay p-0.5">
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAction(a.id)}
              className={cn('h-8 px-3 rounded-md text-[12px] font-medium cursor-pointer transition-colors duration-150 data',
                action === a.id ? 'bg-hover text-fg' : 'text-faint hover:text-muted')}
            >
              {a.label}
            </button>
          ))}
        </div>

        <Button
          variant="primary" size="md"
          disabled={!selected}
          loading={run.isPending}
          onClick={() => run.mutate({ projectSlug: selected, branch: branch || branches[0] || 'main', action, target })}
        >
          <Rocket size={14} /> Deploy
        </Button>
      </div>

      {target === 'vercel' && (
        <p className="data text-[11.5px] text-faint mt-2">
          Requer <code className="text-muted">vercel_deploy_hook_url</code> no projeto ou <code className="text-muted">VERCEL_DEPLOY_HOOK_URL</code> global — senão o worker reporta erro no log.
        </p>
      )}

      <LiveLog deployId={activeDeploy} onDone={() => queryClient.invalidateQueries({ queryKey: ['deploy-history'] })} />

      <div className="mt-8">
        <SectionHeader title="Histórico" sub="últimas requests · clique pra re-assistir o log" />
        <QueryState query={history} skeleton={<div className="skeleton h-48" />}>
          {hist.length === 0 ? <EmptyState icon={History} title="Sem deploys ainda" /> : (
            <div className="flex flex-col gap-2">
              {hist.slice(0, 15).map((h) => {
                const dur = h.started_at && h.finished_at ? new Date(h.finished_at) - new Date(h.started_at) : null;
                return (
                  <Spotlight key={h.id} className="card card-interactive p-4 flex items-center gap-4" onClick={() => setActiveDeploy(h.id)}>
                    <span className="w-8 h-8 rounded-lg bg-subtle border border-line flex items-center justify-center text-faint flex-none">
                      <Rocket size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-fg truncate">
                        {h.project_slug || h.target} <span className="text-faint data text-[11px]">· {h.action} · {h.target}</span>
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

      <NewDeployProjectModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
    </div>
  );
}
