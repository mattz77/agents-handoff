import React from "react";
import { Icon, HDLib } from "../icons.jsx";
import { HDW } from "../widgets.jsx";
import { StatusBadge } from "./shared.jsx";

const DS = window.CommitBriefingDesignSystem_27542e;
const { Card, Button, Badge } = DS;
const { shortId, cls } = HDLib;
const { Section, StatusPill, AgentTag, DataTable } = HDW;

export function AgentTasksPanel() {
  // "failed" (task-agent aborta sozinho — task ambígua, sem edits aplicáveis, erro de API) é um
  // status distinto de "rejected" (humano rejeitou no drawer) no backend, mas ambos caem na
  // mesma coluna visual — sem isso, tasks failed não apareciam em NENHUMA coluna (só contavam
  // no total do header), somem do kanban assim que davam erro.
  const COLUMNS = [
    { id: 'queued', label: 'Fila', match: ['queued'] },
    { id: 'running', label: 'Em execução', match: ['running'] },
    { id: 'awaiting_review', label: 'Aguardando revisão', match: ['awaiting_review'] },
    { id: 'merged', label: 'Aprovado', match: ['merged'] },
    { id: 'rejected', label: 'Rejeitado / Falhou', match: ['rejected', 'failed'] },
  ];
  const [tasks, setTasks] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [projects, setProjects] = React.useState([]);
  const [formOpen, setFormOpen] = React.useState(false);
  const [selected, setSelected] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [models, setModels] = React.useState([]);
  const [recommendedFix, setRecommendedFix] = React.useState([]);
  const emptyForm = { title: '', description: '', project_slug: '', engine: 'nim', model: '' };
  const [formData, setFormData] = React.useState(emptyForm);

  const fetchTasks = React.useCallback(() => {
    fetch('/ops/api/agent-tasks')
      .then(r => r.json())
      .then(d => { setTasks(d.tasks || []); setLoading(false); })
      .catch(e => { console.error(e); setLoading(false); });
  }, []);

  React.useEffect(() => {
    fetch('/ops/api/projects').then(r => r.json()).then(d => setProjects(d.projects || [])).catch(() => {});
    // Mesmo catálogo de modelos NIM usado no Code Review — só motor NIM ligado por ora.
    fetch('/ops/api/codereview/models').then(r => r.json())
      .then(d => { setModels(Array.isArray(d.models) ? d.models : []); setRecommendedFix((d.recommended && d.recommended.fix) || []); })
      .catch(() => {});
    fetchTasks();
  }, [fetchTasks]);

  const hasActive = tasks.some(t => t.status === 'queued' || t.status === 'running');
  React.useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(fetchTasks, 4000);
    return () => clearInterval(id);
  }, [hasActive, fetchTasks]);

  // Mesmo caveat do painel de Code Review: browser pode clampar setInterval em aba oculta —
  // refresh imediato ao voltar o foco evita depender de F5 pra ver o estado atualizado.
  React.useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') fetchTasks(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [fetchTasks]);

  // Mantém a task selecionada (drawer aberto) sincronizada com a lista.
  React.useEffect(() => {
    if (!selected) return;
    const fresh = tasks.find(t => t.id === selected.id);
    if (fresh) setSelected(fresh);
  }, [tasks]);

  const createTask = (e) => {
    e.preventDefault();
    if (!formData.title.trim() || !formData.description.trim() || !formData.project_slug) return;
    setBusy(true);
    fetch('/ops/api/agent-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    }).then(r => r.json()).then(() => {
      setBusy(false);
      setFormOpen(false);
      setFormData(emptyForm);
      fetchTasks();
    }).catch(e => { setBusy(false); alert(e); });
  };

  const approve = (id) => {
    setBusy(true);
    fetch(`/ops/api/agent-tasks/${id}/approve`, { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        setBusy(false);
        if (d.error) { alert(d.error); return; }
        if (d.promotion && d.promotion.prUrl) {
          alert('Mergeado. PR de promoção pra branch final: ' + d.promotion.prUrl);
        }
        fetchTasks();
      })
      .catch(e => { setBusy(false); alert(e); });
  };

  const reject = (id) => {
    if (!confirm('Rejeitar esta task e fechar o PR?')) return;
    setBusy(true);
    fetch(`/ops/api/agent-tasks/${id}/reject`, { method: 'POST' })
      .then(() => { setBusy(false); fetchTasks(); })
      .catch(e => { setBusy(false); alert(e); });
  };

  const remove = (id) => {
    if (!confirm('Remover task do kanban? (não fecha PR já aberto)')) return;
    fetch(`/ops/api/agent-tasks/${id}`, { method: 'DELETE' })
      .then(() => { setSelected(null); fetchTasks(); });
  };

  const retry = (id) => {
    setBusy(true);
    fetch(`/ops/api/agent-tasks/${id}/retry`, { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        setBusy(false);
        if (d.error) { alert(d.error); return; }
        setSelected(null);
        fetchTasks();
      })
      .catch(e => { setBusy(false); alert(e); });
  };

  const engineLabel = (e) => e === 'claude-cli' ? 'Claude Code CLI' : 'NVIDIA NIM';
  const statusTone = (s) => s === 'merged' ? 'good' : s === 'rejected' || s === 'failed' ? 'critical' : s === 'running' ? 'info' : 'warning';

  const Card_ = (t) => React.createElement('div', {
    key: t.id, className: 'kanban-card', onClick: () => setSelected(t),
  },
    React.createElement('div', { className: 'kanban-card__title' }, t.title),
    React.createElement('div', { className: 'kanban-card__meta' },
      React.createElement('span', { className: 'mono' }, t.project_slug),
      React.createElement(StatusBadge, { status: statusTone(t.status) }, engineLabel(t.engine))),
    t.model && React.createElement('div', { className: 'kanban-card__model mono' }, t.model),
    t.error && React.createElement('div', { className: 'kanban-card__error' }, t.error.slice(0, 120)),
    t.pr_url && React.createElement('a', { className: 'kanban-card__pr', href: t.pr_url, target: '_blank', rel: 'noreferrer', onClick: (e) => e.stopPropagation() }, 'PR #' + t.pr_number),
    (t.status === 'failed' || t.status === 'rejected') && React.createElement('button', {
      className: 'kanban-card__retry', onClick: (e) => { e.stopPropagation(); retry(t.id); },
    }, 'Tentar novamente')
  );

  return React.createElement('div', { className: 'grid-1' },
    React.createElement(Section, {
      icon: 'brain',
      title: 'Agentes — tasks delegadas',
      count: tasks.length,
      actions: React.createElement(Button, { size: 'sm', onClick: () => setFormOpen(true) }, 'Nova Task'),
    },
      loading ? React.createElement('div', { className: 'empty' }, 'Carregando...') :
      React.createElement('div', { className: 'kanban' },
        COLUMNS.map(col => {
          const colTasks = tasks.filter(t => col.match.includes(t.status));
          return React.createElement('div', { key: col.id, className: 'kanban-col' },
            React.createElement('div', { className: 'kanban-col__head' },
              React.createElement('span', null, col.label),
              React.createElement('span', { className: 'kanban-col__count' }, colTasks.length)),
            React.createElement('div', { className: 'kanban-col__body' },
              colTasks.map(Card_),
              !colTasks.length && React.createElement('div', { className: 'kanban-col__empty' }, '—')));
        })
      )
    ),

    formOpen && React.createElement('div', { className: 'drawer-ov open', style: { zIndex: 100 }, onClick: () => setFormOpen(false) }),
    formOpen && React.createElement('div', { className: 'drawer open', style: { zIndex: 101, padding: '24px', width: '100%', maxWidth: '460px' } },
      React.createElement('h3', { style: { marginTop: 0 } }, 'Nova Task para Agente'),
      React.createElement('form', { onSubmit: createTask, style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', fontSize: '13px', marginBottom: '4px' } }, 'Título'),
          React.createElement('input', { className: 'cb-input', required: true, value: formData.title, onChange: e => setFormData({ ...formData, title: e.target.value }) })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', fontSize: '13px', marginBottom: '4px' } }, 'Descrição da task'),
          React.createElement('textarea', { className: 'cb-input', required: true, rows: 6, placeholder: 'Descreva exatamente o que o agente deve fazer…', value: formData.description, onChange: e => setFormData({ ...formData, description: e.target.value }) })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', fontSize: '13px', marginBottom: '4px' } }, 'Projeto'),
          React.createElement('select', { className: 'cb-input', required: true, value: formData.project_slug, onChange: e => setFormData({ ...formData, project_slug: e.target.value }) },
            React.createElement('option', { value: '' }, 'Selecione…'),
            projects.map(p => React.createElement('option', { key: p.slug, value: p.slug }, p.display_name)))
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', fontSize: '13px', marginBottom: '4px' } }, 'Motor'),
          React.createElement('div', { style: { fontSize: '13px', opacity: 0.7 } }, 'NVIDIA NIM (Claude Code CLI em breve)')
        ),
        models.length > 0 && React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', fontSize: '13px', marginBottom: '4px' } }, 'Modelo'),
          React.createElement('select', { className: 'cr-model-select', style: { width: '100%' }, value: formData.model, onChange: e => setFormData({ ...formData, model: e.target.value }) },
            React.createElement('option', { value: '' }, 'padrão'),
            recommendedFix.filter(m => models.includes(m)).length > 0 && React.createElement('optgroup', { label: 'Indicados' },
              recommendedFix.filter(m => models.includes(m)).map(m => React.createElement('option', { key: 'rec-' + m, value: m }, m))),
            React.createElement('optgroup', { label: 'Todos' },
              models.map(m => React.createElement('option', { key: 'all-' + m, value: m }, m))))
        ),
        React.createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
          React.createElement(Button, { type: 'submit', disabled: busy }, busy ? 'Criando…' : 'Delegar ao agente'),
          React.createElement(Button, { type: 'button', variant: 'outline', onClick: () => setFormOpen(false) }, 'Cancelar'))
      )
    ),

    selected && React.createElement('div', { className: 'drawer-ov open', style: { zIndex: 100 }, onClick: () => setSelected(null) }),
    selected && React.createElement('div', { className: 'drawer open', style: { zIndex: 101, padding: '24px', width: '100%', maxWidth: '520px', overflowY: 'auto' } },
      React.createElement('h3', { style: { marginTop: 0 } }, selected.title),
      React.createElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' } },
        React.createElement(StatusBadge, { status: statusTone(selected.status) }, selected.status),
        React.createElement('span', { className: 'mono', style: { fontSize: '12px', opacity: 0.7 } }, selected.project_slug),
        React.createElement('span', { className: 'mono', style: { fontSize: '12px', opacity: 0.7 } }, engineLabel(selected.engine)),
        selected.model && React.createElement('span', { className: 'mono', style: { fontSize: '12px', opacity: 0.7 } }, selected.model)),
      React.createElement('p', { style: { fontSize: '13px', whiteSpace: 'pre-wrap', opacity: 0.85 } }, selected.description),
      selected.branch && React.createElement('div', { style: { fontSize: '12px', marginBottom: '8px' } }, 'Branch: ', React.createElement('span', { className: 'mono' }, selected.branch)),
      selected.pr_url && React.createElement('div', { style: { marginBottom: '12px' } },
        React.createElement('a', { href: selected.pr_url, target: '_blank', rel: 'noreferrer' }, 'Ver PR #' + selected.pr_number, ' →')),
      selected.error && React.createElement('div', { style: { fontSize: '12px', color: 'var(--critical)', marginBottom: '12px' } }, selected.error),
      React.createElement('h4', { style: { fontSize: '13px', marginBottom: '6px' } }, 'Log de execução'),
      React.createElement('div', { className: 'mono', style: { fontSize: '11px', maxHeight: '260px', overflowY: 'auto', background: 'var(--panel-2, rgba(0,0,0,0.2))', borderRadius: '8px', padding: '10px' } },
        (selected.log || []).map((l, i) => React.createElement('div', { key: i, style: { marginBottom: '6px', opacity: 0.85 } },
          React.createElement('span', { style: { opacity: 0.5 } }, new Date(l.at).toLocaleTimeString('pt-BR') + ' '), l.message))),
      React.createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' } },
        selected.status === 'awaiting_review' && React.createElement(Button, { size: 'sm', disabled: busy, onClick: () => approve(selected.id) }, 'Aprovar e mergear'),
        selected.status === 'awaiting_review' && React.createElement(Button, { size: 'sm', variant: 'outline', disabled: busy, onClick: () => reject(selected.id) }, 'Rejeitar'),
        (selected.status === 'failed' || selected.status === 'rejected') && React.createElement(Button, { size: 'sm', disabled: busy, onClick: () => retry(selected.id) }, busy ? 'Recriando…' : 'Tentar novamente'),
        React.createElement(Button, { size: 'sm', variant: 'outline', onClick: () => remove(selected.id) }, 'Remover'),
        React.createElement(Button, { size: 'sm', variant: 'outline', onClick: () => setSelected(null) }, 'Fechar'))
    )
  );
}

// ============================================================
// MODELOS IA — provedores (NVIDIA NIM / OpenAI / Anthropic)
// ============================================================
