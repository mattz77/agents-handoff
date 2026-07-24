import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FolderGit2, GitBranch, ShieldCheck, Swords, ExternalLink, Plus, Pencil, X, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { SectionHeader, QueryState, EmptyState, Spotlight } from '../components/ui/misc.jsx';
import { BrandIcon } from '../components/ui/brand-icons.jsx';

const emptyForm = {
  slug: '', display_name: '', local_path: '', git_owner: '', git_repo: '',
  default_branch: 'main', codereview_schedule: '02:00', codereview_auto: false,
};

function ProjectModal({ open, onClose, project }) {
  const queryClient = useQueryClient();
  const isEdit = !!project;
  const [form, setForm] = React.useState(emptyForm);

  React.useEffect(() => {
    if (open) {
      setForm(project ? {
        slug: project.slug || '', display_name: project.display_name || '',
        local_path: project.local_path || '', git_owner: project.git_owner || '',
        git_repo: project.git_repo || '', default_branch: project.default_branch || 'main',
        codereview_schedule: project.codereview_schedule || '02:00',
        codereview_auto: !!project.codereview_auto,
      } : emptyForm);
    }
  }, [open, project]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = useMutation({
    mutationFn: () => isEdit
      ? api.updateProject(project.slug, {
          display_name: form.display_name, local_path: form.local_path,
          git_owner: form.git_owner, git_repo: form.git_repo,
          default_branch: form.default_branch, codereview_schedule: form.codereview_schedule,
          codereview_auto: form.codereview_auto,
        })
      : api.createProject(form),
    onSuccess: () => {
      toast.success(isEdit ? 'Projeto atualizado' : 'Projeto criado');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
    onError: (e) => toast.error(`Falha ao salvar: ${e.message}`),
  });

  if (!open) return null;
  const canSubmit = form.slug.trim() && form.display_name.trim();
  const inputCls = 'h-9 px-3 rounded-lg border border-line bg-overlay text-[13px] text-fg placeholder:text-faint outline-none focus:border-accent-line';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" onClick={onClose} />
      <div className="relative w-full max-w-[460px] card p-5" style={{ boxShadow: 'var(--shadow-pop)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14.5px] font-semibold tracking-tight">{isEdit ? `Editar ${project.slug}` : 'Novo projeto'}</h3>
          <button onClick={onClose} className="text-faint hover:text-fg cursor-pointer" aria-label="Fechar"><X size={16} /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <input value={form.slug} onChange={set('slug')} disabled={isEdit} placeholder="slug (ex: laje)" className={inputCls} />
            <input value={form.display_name} onChange={set('display_name')} placeholder="Nome de exibição" className={inputCls} />
          </div>
          <input value={form.local_path} onChange={set('local_path')} placeholder="Caminho local (ex: C:\...\repo)" className={inputCls} />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.git_owner} onChange={set('git_owner')} placeholder="git owner" className={inputCls} />
            <input value={form.git_repo} onChange={set('git_repo')} placeholder="git repo" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={form.default_branch} onChange={set('default_branch')} placeholder="branch default" className={inputCls} />
            <input value={form.codereview_schedule} onChange={set('codereview_schedule')} placeholder="horário review (HH:mm)" className={inputCls} />
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-muted cursor-pointer select-none">
            <input type="checkbox" checked={form.codereview_auto} onChange={set('codereview_auto')} className="accent-[var(--accent)]" />
            Rodar code review automaticamente
          </label>
          <div className="flex justify-end gap-2 mt-1">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button variant="primary" loading={save.isPending} disabled={!canSubmit} onClick={() => save.mutate()}>
              {isEdit ? 'Salvar' : 'Criar projeto'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Projects() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['projects'], queryFn: api.projects, refetchInterval: 30_000 });
  const items = q.data?.projects || (Array.isArray(q.data) ? q.data : []);
  const [modalProject, setModalProject] = React.useState(undefined); // undefined = fechado, null = criar, obj = editar

  const deactivate = useMutation({
    mutationFn: (slug) => api.deleteProject(slug),
    onSuccess: (_d, slug) => {
      toast.success(`${slug} desativado (review desligado)`);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => toast.error(`Falha ao desativar: ${e.message}`),
  });

  return (
    <div>
      <SectionHeader
        title="Projetos ativos"
        sub="repositórios gerenciados no ecossistema nicebyte"
        actions={<Button variant="primary" size="sm" onClick={() => setModalProject(null)}><Plus size={14} /> Novo projeto</Button>}
      />
      <QueryState query={q} skeleton={<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-40" />)}</div>}>
        {items.length === 0 ? (
          <EmptyState icon={FolderGit2} title="Nenhum projeto registrado" action={<Button variant="primary" size="sm" onClick={() => setModalProject(null)}><Plus size={14} /> Novo projeto</Button>} />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((p) => {
              const repo = p.git_owner && p.git_repo ? `${p.git_owner}/${p.git_repo}` : null;
              const repoUrl = repo ? `https://github.com/${repo}` : null;
              return (
                <Spotlight key={p.slug || p.id} className="card card-interactive p-5 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-9 h-9 rounded-lg bg-subtle border border-line flex items-center justify-center text-faint flex-none">
                        <FolderGit2 size={16} strokeWidth={1.8} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-semibold text-fg truncate">{p.display_name || p.slug}</p>
                        {repo && (
                          <p className="data text-[10.5px] text-faint truncate flex items-center gap-1">
                            <BrandIcon brand="github" size={10} className="flex-none" /> {repo}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-none">
                      <button onClick={() => setModalProject(p)} className="text-faint hover:text-accent transition-colors" aria-label="Editar projeto">
                        <Pencil size={13.5} />
                      </button>
                      <button
                        onClick={() => { if (confirm(`Desativar projeto ${p.slug}? (desliga code review, não apaga dados)`)) deactivate.mutate(p.slug); }}
                        className="text-faint hover:text-bad transition-colors" aria-label="Desativar projeto"
                      >
                        <Trash2 size={13.5} />
                      </button>
                      {repoUrl && (
                        <a href={repoUrl} target="_blank" rel="noreferrer" className="text-faint hover:text-accent transition-colors" aria-label="Abrir repo">
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 data text-[10.5px] text-faint">
                    <GitBranch size={11} className="flex-none" />
                    <span className="truncate">{p.default_branch || 'main'}</span>
                    {p.codereview_model && <span className="ml-auto truncate text-faint">{p.codereview_model}</span>}
                  </div>

                  <div className="flex flex-wrap gap-1.5 mt-auto pt-1">
                    {p.codereview_enabled && (
                      <Badge tone="accent" dot={false} className="gap-1"><ShieldCheck size={10} /> review{p.codereview_auto ? ' · auto' : ''}</Badge>
                    )}
                    {p.attack_auto && (
                      <Badge tone="warn" dot={false} className="gap-1"><Swords size={10} /> attack auto</Badge>
                    )}
                    {p.auto_merge_on_consensus && <Badge tone="ok" dot={false}>auto-merge</Badge>}
                  </div>
                </Spotlight>
              );
            })}
          </div>
        )}
      </QueryState>
      <ProjectModal open={modalProject !== undefined} onClose={() => setModalProject(undefined)} project={modalProject} />
    </div>
  );
}
