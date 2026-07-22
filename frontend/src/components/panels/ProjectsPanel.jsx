import React from "react";
import { Icon, HDLib } from "../icons.jsx";
import { HDW } from "../widgets.jsx";
import { StatusBadge } from "./shared.jsx";

const DS = window.CommitBriefingDesignSystem_27542e;
const { Card, Button, Badge } = DS;
const { cls } = HDLib;
const { Section, StatusPill, DataTable } = HDW;

export function ProjectsPanel() {
  const [projects, setProjects] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editingSlug, setEditingSlug] = React.useState(null);
  const emptyForm = { slug: '', display_name: '', local_path: '', git_owner: '', git_repo: '', default_branch: 'main', codereview_schedule: '02:00', codereview_auto: false };
  const [formData, setFormData] = React.useState(emptyForm);

  const fetchProjects = () => {
    fetch('/ops/api/projects')
      .then(r => r.json())
      .then(d => { setProjects(d.projects || []); setLoading(false); })
      .catch(e => { console.error(e); setLoading(false); });
  };

  React.useEffect(() => { fetchProjects(); }, []);

  const openNew = () => { setEditingSlug(null); setFormData(emptyForm); setFormOpen(true); };
  const openEdit = (r) => {
    setEditingSlug(r.slug);
    setFormData({
      slug: r.slug,
      display_name: r.display_name || '',
      local_path: r.local_path || '',
      git_owner: r.git_owner || '',
      git_repo: r.git_repo || '',
      default_branch: r.default_branch || 'main',
      codereview_schedule: r.codereview_schedule || '02:00',
      codereview_auto: !!r.codereview_auto,
    });
    setFormOpen(true);
  };

  const saveProject = (e) => {
    e.preventDefault();
    const isEdit = !!editingSlug;
    const url = isEdit ? '/ops/api/projects/' + encodeURIComponent(editingSlug) : '/ops/api/projects';
    const { slug, ...patchBody } = formData;
    fetch(url, {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isEdit ? patchBody : formData)
    }).then(() => {
      setFormOpen(false);
      setEditingSlug(null);
      fetchProjects();
    }).catch(e => alert(e));
  };

  const deleteProject = (slug) => {
    if(confirm('Desativar projeto ' + slug + '?')) {
      fetch('/ops/api/projects/' + encodeURIComponent(slug), { method: 'DELETE' })
        .then(fetchProjects);
    }
  };

  const cols = [
    { label: 'Slug', w: '150px', mono: true, render: (r) => r.slug },
    { label: 'Nome', render: (r) => r.display_name },
    { label: 'Repositório', muted: true, render: (r) => React.createElement('span', { className: 'mono' }, (r.git_owner || '?') + '/' + (r.git_repo || '?')) },
    { label: 'Caminho Local', muted: true, render: (r) => React.createElement('span', { className: 'mono' }, r.local_path || '—') },
    { label: 'Review Diário', align: 'center', render: (r) => r.codereview_auto
      ? React.createElement(StatusBadge, { status: 'good' }, 'auto ' + (r.codereview_schedule || '02:00'))
      : React.createElement(StatusBadge, { status: 'neutral' }, 'manual') },
    { label: 'Ações', align: 'right', render: (r) => React.createElement('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } },
      React.createElement(Button, { size: 'sm', variant: 'outline', onClick: (e) => { e.stopPropagation(); openEdit(r); } }, 'Editar'),
      React.createElement(Button, { size: 'sm', variant: 'outline', onClick: (e) => { e.stopPropagation(); deleteProject(r.slug); } }, 'Remover')
    ) },
  ];

  const rows = projects;

  return React.createElement('div', { className: 'grid-1' },
    React.createElement(Section, { 
      icon: 'folder', 
      title: 'Projetos', 
      count: projects.length,
      actions: React.createElement(Button, { size: 'sm', onClick: openNew }, 'Adicionar Projeto')
    },
      loading ? React.createElement('div', { className: 'empty' }, 'Carregando...') :
      React.createElement(DataTable, { cols, rows, empty: 'Nenhum projeto cadastrado.' })
    ),
    formOpen && React.createElement('div', { className: 'drawer-ov open', style: { zIndex: 100 }, onClick: () => setFormOpen(false) }),
    formOpen && React.createElement('div', { className: 'drawer open', style: { zIndex: 101, padding: '24px', width: '100%', maxWidth: '400px' } },
      React.createElement('h3', { style: { marginTop: 0 } }, editingSlug ? 'Editar Projeto — ' + editingSlug : 'Novo Projeto'),
      React.createElement('form', { onSubmit: saveProject, style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', fontSize: '13px', marginBottom: '4px' } }, 'Slug (ID)'),
          React.createElement('input', { className: 'cb-input', required: true, disabled: !!editingSlug, value: formData.slug, onChange: e => setFormData({...formData, slug: e.target.value}) })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', fontSize: '13px', marginBottom: '4px' } }, 'Nome de Exibição'),
          React.createElement('input', { className: 'cb-input', required: true, value: formData.display_name, onChange: e => setFormData({...formData, display_name: e.target.value}) })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', fontSize: '13px', marginBottom: '4px' } }, 'Git Owner'),
          React.createElement('input', { className: 'cb-input', placeholder: 'ex: mattz77', value: formData.git_owner, onChange: e => setFormData({...formData, git_owner: e.target.value}) })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', fontSize: '13px', marginBottom: '4px' } }, 'Git Repo'),
          React.createElement('input', { className: 'cb-input', placeholder: 'ex: handoff-daemon', value: formData.git_repo, onChange: e => setFormData({...formData, git_repo: e.target.value}) })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', fontSize: '13px', marginBottom: '4px' } }, 'Caminho Local (Docker)'),
          React.createElement('input', { className: 'cb-input', placeholder: '/repo', value: formData.local_path, onChange: e => setFormData({...formData, local_path: e.target.value}) })
        ),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('input', { type: 'checkbox', id: 'cr-auto', checked: !!formData.codereview_auto, onChange: e => setFormData({...formData, codereview_auto: e.target.checked}) }),
          React.createElement('label', { htmlFor: 'cr-auto', style: { fontSize: '13px', cursor: 'pointer' } }, 'Review diário automático')
        ),
        formData.codereview_auto && React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', fontSize: '13px', marginBottom: '4px' } }, 'Horário do review (BRT)'),
          React.createElement('input', { className: 'cb-input', type: 'time', value: formData.codereview_schedule, onChange: e => setFormData({...formData, codereview_schedule: e.target.value}) })
        ),
        React.createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } },
          React.createElement(Button, { type: 'submit' }, 'Salvar'),
          React.createElement(Button, { variant: 'outline', onClick: () => setFormOpen(false) }, 'Cancelar')
        )
      )
    )
  );
}

