import React from 'react';
import { Icon, HDLib, GDriveGlyph } from './icons.jsx';
import { HDW } from './widgets.jsx';
import { HandoffFlow, AgentSummary, AgentMark } from './flow.jsx';
/* ============================================================
   Painel Handoff — painéis das abas
   Exporta window.HDP (OverviewPanel, HandoffsPanel, BrainPanel, InfraPanel)
   ============================================================ */

  const DS = window.CommitBriefingDesignSystem_27542e;
  const { Card, Button, Badge, Separator } = DS;
  const StatusBadge = ({ status, children }) => {
    const tone = status === 'good' ? 'good' : status === 'critical' ? 'critical' : status === 'info' ? 'info' : 'warning';
    return React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: `var(--${tone})` } },
      React.createElement('span', { style: { width: '5px', height: '5px', borderRadius: '50%', background: `var(--${tone})`, boxShadow: `0 0 5px var(--${tone})` } }),
      children
    );
  };
    const { ago, shortId, statusMeta, agentOf, cls } = HDLib;
  const { Section, StatusPill, AgentTag, DataTable, TimelineChart, DistBars, KpiStrip, Sparkline } = HDW;

  const fmtAgo = (iso) => ago(iso) + ' atrás';

  // ============================================================
  // OVERVIEW
  // ============================================================
  function OverviewPanel({ onInspect, animatedFlow, onPickStatus }) {
    const HD = window.HD;
    const live = HD.handoffs.find((h) => h.live) || HD.handoffs[0];
    const recent = HD.handoffs.slice(0, 7);

    const recentRows = (recent || []).map((h) => ({
      ...h,
      _onClick: () => onInspect(h),
    }));
    const cols = [
      { label: 'Task', mono: true, render: (r) => shortId(r.task_id) },
      { label: 'Projeto', render: (r) => React.createElement(Badge, { variant: 'outline', mono: true }, r.project) },
      { label: 'Rota', render: (r) => React.createElement('span', { className: 'route' }, React.createElement(AgentTag, { id: window.HD.normalizeAgentId(r.sender), short: true }), React.createElement(Icon, { name: 'arrowRight', size: 12, className: 'route__arr' }), React.createElement(AgentTag, { id: window.HD.normalizeAgentId(r.receiver), short: true })) },
      { label: 'Status', render: (r) => React.createElement(StatusPill, { code: r.lifecycle_status }) },
      { label: 'Tent.', mono: true, align: 'right', render: (r) => r.attempt },
      { label: 'Idade', muted: true, align: 'right', nowrap: true, render: (r) => ago(r.updated_at) },
    ];

    return React.createElement('div', { className: 'panel animate-fade-up' },
      React.createElement(ActionRequired, { onPickStatus }),
      // Hero
      React.createElement('div', { className: 'hero-grid' },
        React.createElement(HandoffFlow, { animated: animatedFlow, live }),
        React.createElement(AgentSummary, null),
      ),
      // KPIs
      React.createElement(KpiStrip, null),
      // Corpo
      React.createElement('div', { className: 'grid-side' },
        React.createElement('div', { className: 'col' },
          React.createElement(Section, { icon: 'trending', title: 'Throughput de handoffs', count: '14d',
            actions: React.createElement('span', { className: 'sub-note mono' }, HD.slo.last24h + ' nas últimas 24h') },
            React.createElement(TimelineChart, { data: HD.timeline })),
          React.createElement(Section, { icon: 'list', title: 'Handoffs recentes', count: recent.length,
            actions: React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: () => onPickStatus(null, 'handoffs') }, 'Ver todos') },
            React.createElement(DataTable, { cols, rows: recentRows })),
        ),
        React.createElement('div', { className: 'col sticky-col' },
          React.createElement(Section, { icon: 'gauge', title: 'SLO & saúde', className: 'slo-card' },
            React.createElement(SloBlock, null)),
          React.createElement(Section, { icon: 'activity', title: 'Distribuição por status' },
            React.createElement(DistBars, { map: HD.histStatus, onPick: (k) => onPickStatus(k, 'handoffs') })),
          React.createElement(Section, { icon: 'bell', title: 'Alertas', count: HD.alerts.length, accent: 'var(--toil)' },
            React.createElement(AlertsList, { alerts: HD.alerts })),
        ),
      ),
    );
  }

  // P1 — agrega sinais acionáveis de várias fontes (tasks pendentes, DLQ, code review, containers)
  // num único bloco no topo da Visão geral, pra responder "o que eu preciso fazer agora?".
  function ActionRequired({ onPickStatus }) {
    const HD = window.HD;

    const pendingTasks = (HD.brain?.taskList || []).filter((t) => t.status === 'pending' || t.status === 'in_progress');
    const dlqCount = (HD.dlq || []).length;

    const latestByProject = new Map();
    for (const r of HD.codereview?.reports || []) {
      if (!latestByProject.has(r.project_slug)) latestByProject.set(r.project_slug, r);
    }
    let criticalIssues = 0;
    for (const r of latestByProject.values()) {
      criticalIssues += (r.issues || []).filter((i) => i.severity === 'critical').length;
    }

    const stoppedContainers = (HD.docker?.containers || []).filter((c) => c.status !== 'running').length;

    const items = [
      { key: 'tasks', icon: 'list', label: 'Tasks pendentes', count: pendingTasks.length, tone: pendingTasks.length ? 'warning' : 'good', onClick: () => onPickStatus(null, 'brain') },
      { key: 'dlq', icon: 'alert', label: 'Handoffs em DLQ', count: dlqCount, tone: dlqCount ? 'critical' : 'good', onClick: () => onPickStatus(null, 'handoffs') },
      { key: 'review', icon: 'shield', label: 'Issues críticas (review)', count: criticalIssues, tone: criticalIssues ? 'critical' : 'good', onClick: () => onPickStatus(null, 'codereview') },
      { key: 'infra', icon: 'server', label: 'Containers parados', count: stoppedContainers, tone: stoppedContainers ? 'warning' : 'good', onClick: () => onPickStatus(null, 'infra') },
    ];

    const total = items.reduce((a, i) => a + i.count, 0);

    return React.createElement(Section, { icon: 'zap', title: 'Ação necessária', count: total || undefined, accent: total ? 'var(--warning)' : undefined },
      total === 0
        ? React.createElement('div', { className: 'muted', style: { padding: 12 } }, 'Tudo em dia — nada pendente no momento.')
        : React.createElement('div', { className: 'dl-stats' },
          items.filter((i) => i.count > 0).map((i) => React.createElement(Card, {
            key: i.key, className: 'dl-stat', style: { cursor: 'pointer' }, onClick: i.onClick,
          },
            React.createElement('span', { className: cls('dl-stat__icon', 'tone-' + i.tone) }, React.createElement(Icon, { name: i.icon, size: 16 })),
            React.createElement('div', { className: 'dl-stat__meta' },
              React.createElement('span', { className: 'dl-stat__v mono' }, i.count),
              React.createElement('span', { className: 'dl-stat__k' }, i.label))))
        )
    );
  }

  function SloBlock() {
    const HD = window.HD, slo = HD.slo;
    const pct = Math.min(slo.handoffP95Ms / slo.target * 100, 100);
    const items = [
      ['p95 retomada', (slo.handoffP95Ms / 1000).toFixed(2) + 's', 'good'],
      ['p50 retomada', (slo.handoffP50Ms / 1000).toFixed(2) + 's', 'good'],
      ['MTTR', slo.mttrMin.toFixed(1) + 'min', 'neutral'],
      ['Entrega 24h', slo.successRate + '%', 'good'],
    ];
    return React.createElement('div', { className: 'slo' },
      React.createElement('div', { className: 'slo__gauge' },
        React.createElement('div', { className: 'slo__gauge-head' },
          React.createElement('span', { className: 'slo__label' }, 'Latência do handoff (p95)'),
          React.createElement('span', { className: 'slo__target mono' }, 'alvo ' + (slo.target / 1000).toFixed(2) + 's')),
        React.createElement('div', { className: 'slo__track' },
          React.createElement('span', { className: 'slo__fill', style: { width: pct + '%' } }),
          React.createElement('span', { className: 'slo__marker', style: { left: '100%' } })),
        React.createElement('div', { className: 'slo__val mono' }, (slo.handoffP95Ms / 1000).toFixed(2) + 's',
          React.createElement(StatusBadge, { status: 'good' }, 'dentro do SLO'))),
      React.createElement('div', { className: 'slo__grid' },
        (items || []).map(([k, v, s], i) => React.createElement('div', { key: i, className: 'slo__item' },
          React.createElement('span', { className: 'slo__k' }, k),
          React.createElement('span', { className: cls('slo__v mono', 'tone-' + s) }, v)))),
    );
  }

  function AlertsList({ alerts }) {
    const tone = { CRITICAL: 'critical', WARNING: 'warning', INFO: 'info' };
    const iconFor = { CRITICAL: 'xCircle', WARNING: 'alert', INFO: 'circleDot' };
    return React.createElement('div', { className: 'alerts' },
      (alerts || []).map((a, i) => React.createElement('div', { key: i, className: 'alert' },
        React.createElement('span', { className: cls('alert__icon', 'tone-' + tone[a.level]) }, React.createElement(Icon, { name: iconFor[a.level], size: 14 })),
        React.createElement('div', { className: 'alert__body' },
          React.createElement('div', { className: 'alert__msg' }, a.msg),
          React.createElement('div', { className: 'alert__meta mono' }, a.level + ' · ' + fmtAgo(a.at))),
      )),
    );
  }

  // ============================================================
  // HANDOFFS
  // ============================================================
  function HandoffsPanel({ onInspect, filter, setFilter, dlq, onReplay }) {
    const HD = window.HD;
    const all = filter ? HD.handoffs.filter((h) => h.lifecycle_status === filter) : HD.handoffs;
    const rows = (all || []).map((h) => ({ ...h, _onClick: () => onInspect(h) }));

    const hCols = [
      { label: 'Task', mono: true, render: (r) => shortId(r.task_id) },
      { label: 'Projeto', render: (r) => React.createElement(Badge, { variant: 'outline', mono: true }, r.project) },
      { label: 'Rota', render: (r) => React.createElement('span', { className: 'route' }, React.createElement(AgentTag, { id: window.HD.normalizeAgentId(r.sender), short: true }), React.createElement(Icon, { name: 'arrowRight', size: 12, className: 'route__arr' }), React.createElement(AgentTag, { id: window.HD.normalizeAgentId(r.receiver), short: true })) },
      { label: 'Status', render: (r) => React.createElement(StatusPill, { code: r.lifecycle_status }) },
      { label: 'Hermes', render: (r) => {
        if (!r.hermes_severidade) return React.createElement('span', { className: 'muted' }, '·');
        const sev = r.hermes_severidade;
        const status = sev === 'high' ? 'critical' : sev === 'medium' ? 'warning' : sev === 'low' ? 'good' : 'warning';
        const label = sev === 'unknown' ? '-' : (r.hermes_nota != null ? (r.hermes_nota + '/10') : sev);
        return React.createElement('span', { title: r.hermes_resumo || sev },
          React.createElement(StatusBadge, { status }, label));
      } },
      { label: 'Idade', muted: true, align: 'right', nowrap: true, render: (r) => ago(r.updated_at) },
    ];

    const dlqCols = [
      { label: 'DLQ ID', mono: true, render: (r) => shortId(r.id, 13) },
      { label: 'Projeto', render: (r) => React.createElement(Badge, { variant: 'outline', mono: true }, r.project) },
      { label: 'Motivo', muted: true, render: (r) => React.createElement('span', { className: 'reason', title: r.reason }, r.reason) },
      { label: 'Tent.', mono: true, align: 'right', render: (r) => r.attempt },
      { label: 'Idade', muted: true, align: 'right', nowrap: true, render: (r) => ago(r.dlq_at) },
      { label: '', align: 'right', render: (r) => React.createElement(Button, { size: 'sm', onClick: (e) => { e.stopPropagation(); onReplay(r); } }, React.createElement(Icon, { name: 'replay', size: 13 }), 'Replay') },
    ];

    const obCols = [
      { label: 'ID', mono: true, render: (r) => r.id },
      { label: 'Evento', mono: true, render: (r) => React.createElement(Badge, { variant: 'outline', mono: true }, r.event_type) },
      { label: 'Status', render: (r) => React.createElement(StatusBadge, { status: r.status === 'SENT' ? 'good' : r.status === 'FAILED' ? 'critical' : 'warning' }, r.status) },
      { label: 'Tent.', mono: true, align: 'right', render: (r) => r.attempts },
      { label: 'Idade', muted: true, align: 'right', nowrap: true, render: (r) => ago(r.created_at) },
    ];

    const statuses = Object.keys(HD.histStatus);

    return React.createElement('div', { className: 'panel animate-fade-up' },
      React.createElement('div', { className: 'grid-side' },
        React.createElement('div', { className: 'col' },
          React.createElement(Section, {
            icon: 'list', title: 'Todos os handoffs', count: all.length,
            actions: React.createElement('div', { className: 'chip-row' },
              filter && React.createElement('button', { className: 'fchip fchip--on', onClick: () => setFilter(null) }, statusMeta(filter).label, React.createElement(Icon, { name: 'x', size: 11 })),
              !filter && statuses.slice(0, 4).map((s) => React.createElement('button', { key: s, className: 'fchip', onClick: () => setFilter(s) }, statusMeta(s).label))),
          }, React.createElement(DataTable, { cols: hCols, rows })),
          React.createElement(Section, { icon: 'split', title: 'Dead Letter Queue', count: dlq.length, accent: 'var(--critical)',
            actions: React.createElement('span', { className: 'sub-note' }, 'reinjeta no stream após correção') },
            React.createElement(DataTable, { cols: dlqCols, rows: dlq, empty: 'DLQ vazia - nada a reprocessar.' })),
          React.createElement(Section, { icon: 'inbox', title: 'Outbox represado', count: HD.outbox.filter((o) => o.status !== 'SENT').length, accent: 'var(--toil)' },
            React.createElement(DataTable, { cols: obCols, rows: HD.outbox })),
        ),
        React.createElement('div', { className: 'col sticky-col' },
          React.createElement(Section, { icon: 'shield', title: 'Circuit breakers', count: (HD.breakers || []).length },
            React.createElement(BreakerList, { breakers: HD.breakers || [] })),
          React.createElement(Section, { icon: 'database', title: 'Stream Redis' },
            React.createElement(StreamBlock, null)),
        ),
      ),
    );
  }

  function BreakerList({ breakers }) {
    const tone = { OPEN: 'critical', HALF_OPEN: 'warning', CLOSED: 'good' };
    const label = { OPEN: 'Aberto', HALF_OPEN: 'Half-open', CLOSED: 'Fechado' };
    return React.createElement('div', { className: 'breakers' },
      (breakers || []).map((b, i) => React.createElement('div', { key: i, className: 'breaker' },
        React.createElement('div', { className: 'breaker__top' },
          React.createElement('span', { className: 'breaker__key mono' }, b.key),
          React.createElement(StatusBadge, { status: tone[b.state] }, label[b.state])),
        React.createElement('div', { className: 'breaker__meta' },
          React.createElement('span', null, 'falhas ', React.createElement('b', { className: 'mono' }, b.fails + '/' + b.threshold)),
          React.createElement('span', null, 'cooldown ', React.createElement('b', { className: 'mono' }, (b.cooldownMs / 1000) + 's')),
          b.openedAt && React.createElement('span', null, 'aberto há ', React.createElement('b', { className: 'mono' }, ago(new Date(b.openedAt).toISOString())))),
        React.createElement('div', { className: 'breaker__track' },
          React.createElement('span', { className: cls('breaker__fill', 'tone-bg-' + tone[b.state]), style: { width: Math.min(b.fails / b.threshold * 100, 100) + '%' } })),
      )),
    );
  }

  function StreamBlock() {
    const s = window.HD.stream;
    const pct = Math.min(s.length / s.maxlen * 100, 100);
    const rows = [['Comprimento', s.length.toLocaleString('pt-BR')], ['Consumer groups', s.groups], ['Pendentes (PEL)', s.pending], ['MAXLEN', '~' + (s.maxlen / 1000) + 'k']];
    return React.createElement('div', { className: 'stream' },
      React.createElement('div', { className: 'stream__bar' },
        React.createElement('span', { className: 'stream__fill', style: { width: pct + '%' } })),
      React.createElement('div', { className: 'stream__pct mono' }, pct.toFixed(0) + '% do MAXLEN'),
      React.createElement('div', { className: 'kv' },
        (rows || []).map(([k, v], i) => React.createElement('div', { key: i, className: 'kv__row' },
          React.createElement('span', { className: 'kv__k' }, k),
          React.createElement('span', { className: 'kv__v mono' }, v)))),
    );
  }

  // ============================================================
  // LLM BRAIN
  // ============================================================
  function BrainPanel() {
    const b = window.HD.brain;
    const activeAgent = window.HD.normalizeAgentId(b.activeModel);
    const tone = { done: 'good', in_progress: 'info', pending: 'toil', blocked: 'critical' };
    const tlabel = { done: 'Concluída', in_progress: 'Em progresso', pending: 'Pendente', blocked: 'Bloqueada' };
    const taskCols = [
      { label: 'Tarefa', render: (r) => r.title },
      { label: 'Status', render: (r) => React.createElement(StatusBadge, { status: tone[r.status] }, tlabel[r.status]) },
      { label: 'Responsável', render: (r) => React.createElement(AgentTag, { id: window.HD.normalizeAgentId(r.assigned) }) },
      { label: 'Prio', mono: true, align: 'right', render: (r) => React.createElement(Badge, { variant: r.priority === 'P0' ? 'accent' : 'outline', mono: true }, r.priority) },
    ];
    return React.createElement('div', { className: 'panel animate-fade-up' },
      React.createElement('div', { className: 'brain-hero' },
        React.createElement(Card, { className: 'brain-active' },
          React.createElement('div', { className: 'brain-active__l' },
            React.createElement(AgentMark, { agent: agentOf(activeAgent), size: 44, active: true }),
            React.createElement('div', null,
              React.createElement('div', { className: 'brain-active__model' }, b.activeModel),
              React.createElement('div', { className: 'brain-active__task' }, React.createElement('span', { className: 'muted' }, 'Tarefa atual: '), b.currentTask))),
          React.createElement('div', { className: 'brain-active__r' },
            React.createElement(StatusBadge, { status: 'good' }, 'infra ' + b.infraHealth),
            React.createElement('span', { className: 'brain-active__sync mono' }, 'sync ' + fmtAgo(b.lastSync)))),
        React.createElement('div', { className: 'brain-stats' },
          [['Pendentes', b.pendingTasks, 'toil'], ['Concluídas', b.completedTasks.toLocaleString('pt-BR'), 'good'], ['Bloqueadas', b.blockedTasks, 'critical']].map(([k, v, t], i) =>
            React.createElement(Card, { key: i, className: 'brain-stat' },
              React.createElement('span', { className: 'brain-stat__k' }, k),
              React.createElement('span', { className: cls('brain-stat__v mono', 'tone-' + t) }, v)))),
      ),
      React.createElement('div', { className: 'grid-2' },
        React.createElement(Section, { icon: 'list', title: 'Fila de tarefas', count: b.taskList.length },
          React.createElement(DataTable, { cols: taskCols, rows: b.taskList })),
        React.createElement(Section, { icon: 'gitCommit', title: 'Decisões recentes', count: b.recentDecisions.length },
          React.createElement(DecisionTimeline, { decisions: b.recentDecisions })),
      ),
    );
  }

  function DecisionTimeline({ decisions }) {
    return React.createElement('div', { className: 'decisions' },
      (decisions || []).map((d, i) => {
        const ag = agentOf(window.HD.normalizeAgentId(d.model));
        return React.createElement('div', { key: i, className: 'decision' },
          React.createElement('span', { className: 'decision__rail' }, React.createElement('span', { className: 'decision__dot', style: { background: ag.accent } })),
          React.createElement('div', { className: 'decision__body' },
            React.createElement('div', { className: 'decision__title' }, d.title),
            React.createElement('div', { className: 'decision__meta' },
              React.createElement('span', { className: 'decision__date mono' }, d.date.split('-').reverse().join('/')),
              React.createElement('span', { className: 'decision__model mono', style: { color: ag.accent, background: ag.tint } }, ag.model))));
      }),
    );
  }

  // ============================================================
  // INFRA
  // ============================================================
  function GithubTokenSection() {
    const [status, setStatus] = React.useState(null);
    const [token, setToken] = React.useState('');
    const [saving, setSaving] = React.useState(false);

    const refresh = () => {
      fetch('/ops/api/settings/github-token')
        .then(r => r.json())
        .then(setStatus)
        .catch(() => setStatus({ configured: false, source: 'none' }));
    };
    React.useEffect(() => { refresh(); }, []);

    const save = (e) => {
      e.preventDefault();
      if (!token.trim()) return;
      setSaving(true);
      fetch('/ops/api/settings/github-token', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() })
      }).then(() => { setToken(''); setSaving(false); refresh(); })
        .catch(() => setSaving(false));
    };

    return React.createElement(Section, { icon: 'shield', title: 'GitHub PAT (global)', accent: 'var(--copper)',
        actions: status && React.createElement(StatusBadge, { status: status.configured ? 'good' : 'critical' },
          status.configured ? 'configurado (' + status.source + ')' : 'não configurado') },
      React.createElement('form', { onSubmit: save, style: { display: 'flex', gap: 8, padding: 12 } },
        React.createElement('input', {
          className: 'cb-input', type: 'password', placeholder: 'ghp_... (novo token)',
          value: token, onChange: e => setToken(e.target.value), style: { flex: 1 }
        }),
        React.createElement(Button, { size: 'sm', type: 'submit', disabled: saving || !token.trim() }, saving ? 'Salvando...' : 'Salvar')
      )
    );
  }

  function InfraPanel() {
    const HD = window.HD, s = HD.system, d = HD.docker, r = HD.redisHA;
    const memPct = Math.round(s.memoryUsedMB / s.memoryTotalMB * 100);
    const sysItems = [
      ['Uptime', s.uptimeHours.toFixed(0) + 'h'],
      ['CPU', s.cpuUsage + '%', s.cpuUsage, 'cpu'],
      ['RAM', (s.memoryUsedMB / 1024).toFixed(1) + '/' + (s.memoryTotalMB / 1024).toFixed(0) + ' GB', memPct, 'mem'],
      ['Node', s.nodeVersion],
      ['Plataforma', s.platform],
    ];
    return React.createElement('div', { className: 'panel animate-fade-up' },
      React.createElement(GithubTokenSection),
      React.createElement(Section, { icon: 'cpu', title: 'Sistema', bodyClass: 'sys-body' },
        React.createElement('div', { className: 'sysbar' },
          (sysItems || []).map(([k, v, pct, kind], i) => React.createElement('div', { key: i, className: 'sysbar__item' },
            React.createElement('span', { className: 'sysbar__k' }, k),
            React.createElement('span', { className: 'sysbar__v mono' }, v),
            pct !== undefined && React.createElement('span', { className: 'sysbar__track' }, React.createElement('span', { className: cls('sysbar__fill', pct > 80 ? 'tone-bg-critical' : pct > 60 ? 'tone-bg-warning' : 'tone-bg-good'), style: { width: pct + '%' } })))))),
      React.createElement('div', { className: 'grid-2' },
        React.createElement(Section, { icon: 'box', title: 'Containers Docker', count: d.totalRunning + '/' + d.containers.length },
          React.createElement('div', { className: 'docker' },
            (d.containers || []).map((c, i) => React.createElement('div', { key: i, className: 'docker__row' },
              React.createElement('span', { className: cls('docker__dot', c.status === 'running' ? 'up' : 'down') }),
              React.createElement('span', { className: 'docker__name mono' }, c.name),
              React.createElement('span', { className: 'docker__img' }, c.image),
              React.createElement('span', { className: 'docker__up mono muted' }, c.uptime),
              React.createElement(StatusBadge, { status: c.status === 'running' ? 'good' : 'critical' }, c.status === 'running' ? 'up' : 'down'))))),
        React.createElement('div', { className: 'col' },
          React.createElement(Section, { icon: 'radio', title: 'Redis HA · Sentinel', accent: 'var(--copper)',
            actions: React.createElement(StatusBadge, { status: 'good' }, 'quorum ' + r.quorum) },
            React.createElement(RedisTopology, { ha: r })),
          React.createElement(Section, { icon: 'bell', title: 'Alertas operacionais', count: HD.alerts.length, accent: 'var(--toil)' },
            React.createElement(AlertsList, { alerts: HD.alerts })),
        ),
      ),
    );
  }

  function RedisTopology({ ha }) {
    return React.createElement('div', { className: 'redis' },
      React.createElement('div', { className: 'redis__node redis__master' },
        React.createElement('span', { className: 'redis__role' }, 'master'),
        React.createElement('span', { className: 'redis__name mono' }, ha.master.host),
        React.createElement('span', { className: 'redis__dot up' })),
      React.createElement('div', { className: 'redis__replicas' },
        (ha.replicas || []).map((rp, i) => React.createElement('div', { key: i, className: 'redis__node' },
          React.createElement('span', { className: 'redis__role' }, 'replica'),
          React.createElement('span', { className: 'redis__name mono' }, rp.name),
          React.createElement('span', { className: 'redis__lag mono muted' }, 'lag ' + rp.lagBytes + 'b'),
          React.createElement('span', { className: 'redis__dot up' })))),
      React.createElement('div', { className: 'redis__sentinels' },
        (ha.sentinels || []).map((sn, i) => React.createElement('span', { key: i, className: 'redis__sentinel mono' },
          React.createElement(Icon, { name: 'radio', size: 12 }), sn.name.replace('redis-', '')))),
    );
  }

  // ============================================================
  // DATALAKE (Google Drive 5TB · memória de longo prazo)
  // ============================================================
  function fmtSize(mb) {
    if (mb >= 1048576) return (mb / 1048576).toFixed(2) + ' TB';
    if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
    return mb + ' MB';
  }

  function DataLakePanel() {
    const dl = window.HD.datalake;
    const files = window.HD.brainFiles;
    const pct = Math.round(dl.usedMB / dl.capacityMB * 100);
    const totalFiles = dl.knowledge.reduce((a, k) => a + k.files, 0)
      + dl.projects.reduce((a, p) => a + p.files, 0)
      + dl.backups.reduce((a, b) => a + b.count, 0);

    const kbCols = [
      { label: 'Área', render: (r) => React.createElement('span', { className: 'dl-name' }, React.createElement(Icon, { name: 'folder', size: 14, className: 'dl-name__i' }), r.name) },
      { label: 'Arquivos', mono: true, align: 'right', render: (r) => r.files.toLocaleString('pt-BR') },
      { label: 'Tamanho', mono: true, align: 'right', render: (r) => fmtSize(r.sizeMB) },
      { label: 'Atualizado', muted: true, align: 'right', nowrap: true, render: (r) => ago(r.updated) },
    ];
    const projCols = [
      { label: 'Projeto', render: (r) => React.createElement('span', { className: 'dl-name' }, React.createElement(Icon, { name: 'gitBranch', size: 13, className: 'dl-name__i' }), React.createElement(Badge, { variant: 'outline', mono: true }, r.name)) },
      { label: 'Arquivos', mono: true, align: 'right', render: (r) => r.files.toLocaleString('pt-BR') },
      { label: 'Tamanho', mono: true, align: 'right', render: (r) => fmtSize(r.sizeMB) },
      { label: 'Atualizado', muted: true, align: 'right', nowrap: true, render: (r) => ago(r.updated) },
    ];

    return React.createElement('div', { className: 'panel animate-fade-up' },
      React.createElement('div', { className: 'dl-hero' },
        React.createElement(DlMount, { dl }),
        React.createElement(DlGauge, { dl, pct }),
      ),
      React.createElement('div', { className: 'dl-stats' },
        [
          ['Volume total', fmtSize(dl.totalSizeMB), 'database', 'copper'],
          ['Arquivos indexados', totalFiles.toLocaleString('pt-BR'), 'fileStack', 'neutral'],
          ['Backups', dl.backupCount, 'shield', 'good', 'last ' + ago(dl.lastBackup) + ' atrás'],
          ['Áreas + projetos', (dl.knowledge.length + dl.projects.length), 'layers', 'neutral'],
        ].map(([k, v, icon, tone, sub], i) => React.createElement(Card, { key: i, className: 'dl-stat' },
          React.createElement('span', { className: cls('dl-stat__icon', 'tone-' + tone) }, React.createElement(Icon, { name: icon, size: 16 })),
          React.createElement('div', { className: 'dl-stat__meta' },
            React.createElement('span', { className: 'dl-stat__v mono' }, v),
            React.createElement('span', { className: 'dl-stat__k' }, k),
            sub && React.createElement('span', { className: 'dl-stat__sub mono' }, sub)))),
      ),
      React.createElement('div', { className: 'grid-side' },
        React.createElement('div', { className: 'col' },
          React.createElement(Section, { icon: 'brain', title: 'Knowledge Base', count: dl.knowledge.length,
            actions: React.createElement('span', { className: 'sub-note mono' }, 'Knowledge_Base/') },
            React.createElement(DataTable, { cols: kbCols, rows: dl.knowledge })),
          React.createElement(Section, { icon: 'gitBranch', title: 'Projetos versionados', count: dl.projects.length,
            actions: React.createElement('span', { className: 'sub-note mono' }, 'Projetos/') },
            React.createElement(DataTable, { cols: projCols, rows: dl.projects })),
          React.createElement(Section, { icon: 'workflow', title: 'n8n Workflows', count: (dl.n8nWorkflows || {}).totalWorkflows || 0,
            actions: React.createElement('span', { className: 'sub-note mono' }, 'Backups/n8n-workflows/') },
            React.createElement(N8nWorkflowsList, { n8n: dl.n8nWorkflows || {} })),
          React.createElement(Section, { icon: 'fileText', title: 'LLM-Brain (sincronismo de contexto)', count: files.length, accent: 'var(--copper)',
            actions: React.createElement('span', { className: 'sub-note' }, 'cérebro rápido / estado de curto prazo') },
            React.createElement(BrainSync, { files })),
        ),
        React.createElement('div', { className: 'col sticky-col' },
          React.createElement(Section, { icon: 'shield', title: 'Backups & restore-check', count: dl.backups.length },
            React.createElement(BackupList, { backups: dl.backups })),
          React.createElement(Section, { icon: 'sparkles', title: 'Roadmap', accent: 'var(--copper)' },
            React.createElement(RoadmapNote, { dl })),
          React.createElement(Section, { icon: 'brain', title: 'Memory (RAG)', accent: 'var(--copper)' },
            React.createElement(MemoryRagCard, { mem: dl.memory || {} })),
        ),
      ),
    );
  }

  function DlMount({ dl }) {
    const GDrive = GDriveGlyph;
    return React.createElement(Card, { className: 'dl-mount' },
      React.createElement('div', { className: 'dl-mount__top' },
        React.createElement('span', { className: 'dl-mount__glyph' }, React.createElement(GDrive, { size: 34 })),
        React.createElement('div', { className: 'dl-mount__id' },
          React.createElement('div', { className: 'dl-mount__name' }, 'Luma_DataLake'),
          React.createElement('div', { className: 'dl-mount__path mono' }, dl.mount)),
        React.createElement('div', { className: 'dl-mount__status' },
          React.createElement(StatusBadge, { status: 'good' }, 'montado'),
          React.createElement('span', { className: 'dl-mount__sync mono' }, 'sync ' + ago(dl.lastSync) + ' atrás'))),
      React.createElement(Separator, null),
      React.createElement('div', { className: 'dl-mount__facts' },
        [
          ['Drive', dl.drive, 'cloud'],
          ['Acesso', dl.access, 'cpu'],
          ['Resiliência', dl.cache, 'shield'],
        ].map(([k, v, icon], i) => React.createElement('div', { key: i, className: 'dl-fact' },
          React.createElement('span', { className: 'dl-fact__icon' }, React.createElement(Icon, { name: icon, size: 15 })),
          React.createElement('div', { className: 'dl-fact__meta' },
            React.createElement('span', { className: 'dl-fact__k' }, k),
            React.createElement('span', { className: 'dl-fact__v' }, v))))),
    );
  }

  function DlGauge({ dl, pct }) {
    const R = 52, C = 2 * Math.PI * R, dash = C * pct / 100;
    return React.createElement(Card, { className: 'dl-gauge' },
      React.createElement('div', { className: 'dl-gauge__ring' },
        React.createElement('svg', { width: 132, height: 132, viewBox: '0 0 132 132' },
          React.createElement('circle', { cx: 66, cy: 66, r: R, fill: 'none', stroke: 'var(--muted)', strokeWidth: 11 }),
          React.createElement('circle', { cx: 66, cy: 66, r: R, fill: 'none', stroke: 'var(--copper)', strokeWidth: 11, strokeLinecap: 'round',
            strokeDasharray: dash + ' ' + C, transform: 'rotate(-90 66 66)' })),
        React.createElement('div', { className: 'dl-gauge__center' },
          React.createElement('span', { className: 'dl-gauge__pct mono' }, pct + '%'),
          React.createElement('span', { className: 'dl-gauge__lbl' }, 'em uso'))),
      React.createElement('div', { className: 'dl-gauge__legend' },
        React.createElement('div', { className: 'dl-gauge__row' },
          React.createElement('span', { className: 'dl-gauge__k' }, 'Usado'),
          React.createElement('span', { className: 'dl-gauge__v mono' }, fmtSize(dl.usedMB))),
        React.createElement('div', { className: 'dl-gauge__row' },
          React.createElement('span', { className: 'dl-gauge__k' }, 'Capacidade'),
          React.createElement('span', { className: 'dl-gauge__v mono' }, fmtSize(dl.capacityMB))),
        React.createElement('div', { className: 'dl-gauge__row' },
          React.createElement('span', { className: 'dl-gauge__k' }, 'Livre'),
          React.createElement('span', { className: 'dl-gauge__v mono tone-good' }, fmtSize(dl.capacityMB - dl.usedMB)))),
    );
  }

  function BackupList({ backups }) {
    const tone = { ok: 'good', warn: 'warning', fail: 'critical', 'n/a': 'neutral' };
    const label = { ok: 'restore ok', warn: 'check pendente', fail: 'falhou', 'n/a': '-' };
    return React.createElement('div', { className: 'backups' },
      (backups || []).map((b, i) => React.createElement('div', { key: i, className: 'backup' },
        React.createElement('div', { className: 'backup__top' },
          React.createElement('span', { className: 'backup__engine mono' }, b.engine + ' \u00B7 ' + b.project),
          React.createElement(StatusBadge, { status: tone[b.restore] }, label[b.restore])),
        React.createElement('div', { className: 'backup__meta' },
          React.createElement('span', null, React.createElement('b', { className: 'mono' }, b.count), ' snapshots'),
          React.createElement('span', null, React.createElement('b', { className: 'mono' }, fmtSize(b.sizeMB))),
          React.createElement('span', null, 'last ', React.createElement('b', { className: 'mono' }, ago(b.lastAt) + ' atrás')),
          b.note && React.createElement('span', { className: 'muted' }, b.note)))),
    );
  }

  function BrainSync({ files }) {
    return React.createElement('div', { className: 'bsync' },
      (files || []).map((f, i) => {
        const ag = agentOf(window.HD.normalizeAgentId(f.updatedBy));
        return React.createElement('div', { key: i, className: 'bsync__row' },
          React.createElement('span', { className: 'bsync__icon' }, React.createElement(Icon, { name: 'fileText', size: 15 })),
          React.createElement('div', { className: 'bsync__main' },
            React.createElement('div', { className: 'bsync__name mono' }, f.name,
              React.createElement('span', { className: 'bsync__mode mono' }, f.mode)),
            React.createElement('div', { className: 'bsync__role' }, f.role)),
          React.createElement('div', { className: 'bsync__side' },
            React.createElement('span', { className: 'bsync__by mono', style: { color: ag.accent } }, ag.name),
            React.createElement('span', { className: 'bsync__when mono' }, f.lines + ' linhas / ' + ago(f.updated) + ' atrás')));
      }),
    );
  }

  function N8nWorkflowsList({ n8n }) {
    if (!n8n || !n8n.orgs || !n8n.orgs.length) {
      return React.createElement('div', { className: 'muted', style: { padding: '8px 0' } }, 'Nenhum workflow backupiado.');
    }
    const n8nCols = [
      { label: 'Org', render: (r) => React.createElement('span', { className: 'dl-name' }, React.createElement(Icon, { name: 'building', size: 13, className: 'dl-name__i' }), React.createElement('b', null, r.name)) },
      { label: 'Projetos', mono: true, align: 'right', render: (r) => r.projects },
      { label: 'Workflows', mono: true, align: 'right', render: (r) => React.createElement('span', { style: { color: 'var(--copper)' } }, r.workflows) },
      { label: 'Tamanho', mono: true, align: 'right', render: (r) => fmtSize(r.sizeMB) },
    ];
    return React.createElement(React.Fragment, null,
      React.createElement(DataTable, { cols: n8nCols, rows: n8n.orgs }),
      React.createElement('div', { className: 'dl-stat__sub mono', style: { marginTop: 8 } },
        n8n.lastBackup ? 'last backup ' + ago(n8n.lastBackup) + ' atr\u00E1s' : 'sem backup'),
    );
  }

  function MemoryRagCard({ mem }) {
    const ragTone = mem.hasLance ? 'good' : (mem.corpusFiles > 0 ? 'warning' : 'neutral');
    const ragLabel = mem.hasLance ? 'ativo' : (mem.corpusFiles > 0 ? 'scaffold' : 'planejado');
    return React.createElement('div', { className: 'dl-stats', style: { flexDirection: 'column', gap: 8 } },
      [
        ['Corpus', mem.corpusFiles + ' arquivos', 'fileStack', 'neutral'],
        ['Vetores', (mem.vectorCount || 0).toLocaleString('pt-BR'), 'sparkles', ragTone],
        ['Ingest', mem.lastIngest ? ago(mem.lastIngest) + ' atr\u00E1s' : 'nunca', 'clock', 'neutral'],
        ['LanceDB', mem.hasLance ? 'montado' : 'ausente', 'database', ragTone],
      ].map(([k, v, icon, tone], i) => React.createElement(Card, { key: i, className: 'dl-stat', style: { padding: '8px 12px' } },
        React.createElement('span', { className: cls('dl-stat__icon', 'tone-' + tone) }, React.createElement(Icon, { name: icon, size: 14 })),
        React.createElement('div', { className: 'dl-stat__meta' },
          React.createElement('span', { className: 'dl-stat__v mono' }, v),
          React.createElement('span', { className: 'dl-stat__k' }, k)))),
      React.createElement('div', { style: { marginTop: 4 } },
        React.createElement(StatusBadge, { status: ragTone }, 'RAG: ' + ragLabel)),
    );
  }

  function RoadmapNote({ dl }) {
    return React.createElement('div', { className: 'roadmap' },
      React.createElement('div', { className: 'roadmap__item' },
        React.createElement('span', { className: 'roadmap__dot' }),
        React.createElement('div', null,
          React.createElement('div', { className: 'roadmap__t' }, 'RAG nativo sobre o Drive'),
          React.createElement('div', { className: 'roadmap__d' }, 'Embeddings leves p/ Semantic Search aut\u00F4nomo nos 5\u00a0TB do Data Lake.'))),
      React.createElement('div', { className: 'roadmap__item' },
        React.createElement('span', { className: 'roadmap__dot' }),
        React.createElement('div', null,
          React.createElement('div', { className: 'roadmap__t' }, 'Observabilidade aut\u00F4noma'),
          React.createElement('div', { className: 'roadmap__d' }, 'n8n ingere alertas do Docker/Traefik direto na task-queue.md.'))),
      React.createElement('div', { className: 'roadmap__foot' },
        React.createElement(Badge, { variant: 'outline', mono: true }, 'RAG: ' + dl.rag)),
    );
  }
  // ============================================================
  // CODE REVIEW DIÁRIO
  // ============================================================
  // Consome /ops/api/codereview (Postgres: codereview_reports + handoff_projects — TASK 37/38).
  // Report: { project_slug, display_name, commit_sha, score, summary, issues[], refactors[], pr_url, model_used, created_at }
  // Issue: { file, line, severity: critical|warning|info, category, message, suggestion }
  function CodeReviewPanel() {
    const [crData, setCrData] = React.useState(null);
    const [loading, setLoading] = React.useState(true);
    const [running, setRunning] = React.useState(false);
    const [selected, setSelected] = React.useState(0);
    const [projectFilter, setProjectFilter] = React.useState('');
    const [taskState, setTaskState] = React.useState({}); // issue key -> 'creating'|'done'|'error'

    const load = React.useCallback(() => {
      return fetch('/ops/api/codereview')
        .then(res => res.json())
        .then(data => { setCrData(data); setLoading(false); })
        .catch(err => { console.error('Failed to fetch code review data', err); setLoading(false); });
    }, []);

    React.useEffect(() => { load(); }, [load]);

    const runNow = () => {
      setRunning(true);
      const body = projectFilter ? JSON.stringify({ slug: projectFilter }) : '{}';
      fetch('/ops/api/codereview/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
        .then(res => res.json())
        .then(() => load())
        .catch(err => console.error('Failed to trigger code review', err))
        .finally(() => setRunning(false));
    };

    const createTask = (report, issue, key) => {
      setTaskState((s) => ({ ...s, [key]: 'creating' }));
      const title = `[${report.display_name || report.project_slug}] ${issue.file}${issue.line != null ? ':' + issue.line : ''} — ${issue.message.slice(0, 60)}`;
      fetch('/ops/api/brain/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          project: report.project_slug,
          commit: report.commit_sha || undefined,
          priority: issue.severity === 'critical' ? 'alta' : 'média',
          context: `Issue [${issue.severity}/${issue.category}] encontrada pelo Daemon-CodeReview no commit ${(report.commit_sha || '').slice(0, 7)}.\n\n${issue.file}${issue.line != null ? ':' + issue.line : ''}\n${issue.message}`,
          action: issue.suggestion || '(ver sugestão do review)',
          expected: 'Issue corrigida e commitada.',
        }),
      })
        .then(res => res.json())
        .then((r) => setTaskState((s) => ({ ...s, [key]: r.ok ? 'done' : 'error' })))
        .catch(() => setTaskState((s) => ({ ...s, [key]: 'error' })));
    };

    if (loading) {
      return React.createElement('div', { className: 'panel animate-fade-up', style: { padding: 40, textAlign: 'center', color: 'var(--muted)' } }, 'Carregando Code Review...');
    }

    const allReports = (crData && crData.reports) || [];
    const projectOptions = [...new Set(allReports.map(r => r.project_slug))];
    const reports = projectFilter ? allReports.filter(r => r.project_slug === projectFilter) : allReports;

    if (allReports.length === 0) {
      return React.createElement('div', { className: 'panel animate-fade-up' },
        React.createElement(Section, { icon: 'shield', title: 'Code Review — Minimax M3' },
          React.createElement('div', { style: { padding: '40px 0', textAlign: 'center' } },
            React.createElement('div', { className: 'muted', style: { marginBottom: 16 } }, 'Nenhum relatório de code review encontrado.'),
            React.createElement('button', { className: 'cb-btn', onClick: runNow, disabled: running }, running ? 'Executando…' : 'Rodar review agora')))
      );
    }

    const latest = reports[Math.min(selected, Math.max(reports.length - 1, 0))] || reports[0];
    const issues = Array.isArray(latest.issues) ? latest.issues : [];
    const refactors = Array.isArray(latest.refactors) ? latest.refactors : [];

    const critical = issues.filter(i => i.severity === 'critical');
    const warnings = issues.filter(i => i.severity === 'warning');
    const info = issues.filter(i => i.severity === 'info');

    const score = latest.score != null ? Number(latest.score) : null;
    const scoreColor = score == null ? 'neutral' : (score < 5 ? 'critical' : (score < 8 ? 'warning' : 'good'));
    const when = latest.created_at ? new Date(latest.created_at).toLocaleString('pt-BR') : '';

    // Trend de score: reports do mesmo projeto do latest, do mais antigo pro mais recente.
    const trendReports = allReports.filter(r => r.project_slug === latest.project_slug).slice().reverse();
    const trendScores = trendReports.map(r => r.score != null ? Number(r.score) : 0);

    return React.createElement('div', { className: 'panel animate-fade-up' },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 } },
        React.createElement('select', {
          className: 'cb-select', value: projectFilter,
          onChange: (e) => { setProjectFilter(e.target.value); setSelected(0); },
          style: { background: 'var(--sidebar)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: '0.85rem' },
        },
          React.createElement('option', { value: '' }, 'Todos os projetos'),
          projectOptions.map(p => React.createElement('option', { key: p, value: p }, p))),
        React.createElement('button', { className: 'cb-btn', onClick: runNow, disabled: running },
          running ? 'Executando…' : projectFilter ? `Rodar review — ${projectFilter}` : 'Rodar review agora')),

      React.createElement('div', { className: 'dl-stats', style: { marginBottom: 16 } },
        React.createElement(Card, { className: 'dl-stat' },
          React.createElement('span', { className: cls('dl-stat__icon', 'tone-' + scoreColor) }, React.createElement(Icon, { name: 'shield', size: 16 })),
          React.createElement('div', { className: 'dl-stat__meta' },
            React.createElement('span', { className: 'dl-stat__v mono' }, score == null ? 'N/A' : score.toFixed(1)),
            React.createElement('span', { className: 'dl-stat__k' }, 'Score'),
            React.createElement('span', { className: 'dl-stat__sub mono' }, when)),
          trendScores.length > 1 && React.createElement(Sparkline, { data: trendScores, color: 'var(--' + scoreColor + ')' })),
        React.createElement(Card, { className: 'dl-stat' },
          React.createElement('span', { className: 'dl-stat__icon tone-critical' }, React.createElement(Icon, { name: 'alert', size: 16 })),
          React.createElement('div', { className: 'dl-stat__meta' },
            React.createElement('span', { className: 'dl-stat__v mono' }, critical.length),
            React.createElement('span', { className: 'dl-stat__k' }, 'Issues críticas'))),
        React.createElement(Card, { className: 'dl-stat' },
          React.createElement('span', { className: 'dl-stat__icon tone-warning' }, React.createElement(Icon, { name: 'alert', size: 16 })),
          React.createElement('div', { className: 'dl-stat__meta' },
            React.createElement('span', { className: 'dl-stat__v mono' }, warnings.length + info.length),
            React.createElement('span', { className: 'dl-stat__k' }, 'Avisos & infos'))),
        React.createElement(Card, { className: 'dl-stat' },
          React.createElement('span', { className: 'dl-stat__icon tone-neutral' }, React.createElement(Icon, { name: 'gitBranch', size: 16 })),
          React.createElement('div', { className: 'dl-stat__meta' },
            React.createElement('span', { className: 'dl-stat__v mono' }, (latest.commit_sha || '').slice(0, 7) || '—'),
            React.createElement('span', { className: 'dl-stat__k' }, latest.display_name || latest.project_slug),
            React.createElement('span', { className: 'dl-stat__sub mono' }, latest.model_used || '')))
      ),

      React.createElement('div', { className: 'grid-side' },
        React.createElement('div', { className: 'col' },
          React.createElement(Section, { icon: 'alert', title: 'Issues críticas', count: critical.length, accent: 'var(--critical)' },
            critical.length === 0
              ? React.createElement('div', { className: 'muted', style: { padding: 12 } }, 'Nenhuma issue crítica.')
              : React.createElement(IssueList, { issues: critical, tone: 'critical', report: latest, taskState, onCreateTask: createTask })
          ),
          React.createElement(Section, { icon: 'alert', title: 'Avisos', count: warnings.length, accent: 'var(--warning)' },
            warnings.length === 0
              ? React.createElement('div', { className: 'muted', style: { padding: 12 } }, 'Nenhum aviso.')
              : React.createElement(IssueList, { issues: warnings, tone: 'warning', report: latest, taskState, onCreateTask: createTask })
          ),
          info.length > 0 && React.createElement(Section, { icon: 'fileText', title: 'Informativos', count: info.length },
            React.createElement(IssueList, { issues: info, tone: 'neutral', report: latest, taskState, onCreateTask: createTask })
          ),
          refactors.length > 0 && React.createElement(Section, { icon: 'zap', title: 'Refatorações sugeridas', count: refactors.length },
            React.createElement('div', { className: 'alerts', style: { gap: 8 } },
              refactors.map((r, i) => React.createElement('div', { key: i, className: 'alert', style: { alignItems: 'flex-start' } },
                React.createElement('div', { className: 'alert__body', style: { flex: 1 } },
                  React.createElement('div', { className: 'alert__msg mono', style: { fontWeight: 600, marginBottom: 4 } }, r.file),
                  React.createElement('div', { className: 'alert__meta', style: { lineHeight: 1.4 } }, r.description))))
            )
          )
        ),
        React.createElement('div', { className: 'col sticky-col' },
          React.createElement(Section, { icon: 'alignLeft', title: 'Resumo da revisão' },
            React.createElement('div', { style: { padding: 16, fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--foreground)' } },
              latest.summary || 'Sem resumo disponível.',
              latest.pr_url && React.createElement('div', { style: { marginTop: 10 } },
                React.createElement('a', { href: latest.pr_url, target: '_blank', rel: 'noreferrer', className: 'mono', style: { color: 'var(--primary)' } }, 'Ver PR no GitHub'))
            )
          ),
          React.createElement(Section, { icon: 'history', title: 'Histórico', count: reports.length },
            React.createElement('div', { className: 'alerts' },
              reports.map((r, i) => React.createElement('div', {
                key: r.id || i,
                className: 'alert',
                onClick: () => setSelected(i),
                style: { cursor: 'pointer', outline: i === selected ? '1px solid var(--primary)' : 'none', borderRadius: 6 },
              },
                React.createElement('span', { className: 'alert__icon tone-neutral' }, React.createElement(Icon, { name: 'fileText', size: 14 })),
                React.createElement('div', { className: 'alert__body' },
                  React.createElement('div', { className: 'alert__msg' },
                    (r.display_name || r.project_slug) + ' — score ' + (r.score != null ? Number(r.score).toFixed(1) : 'N/A')),
                  React.createElement('div', { className: 'alert__meta mono' },
                    (r.commit_sha || '').slice(0, 7) + '  ' + (r.created_at ? new Date(r.created_at).toLocaleString('pt-BR') : '')))
              ))
            )
          )
        )
      )
    );
  }

  function IssueList({ issues, tone, report, taskState, onCreateTask }) {
    return React.createElement('div', { className: 'alerts', style: { gap: 8 } },
      issues.map((it, i) => {
        const key = (report?.id || '0') + ':' + i + ':' + it.file;
        const state = taskState?.[key];
        return React.createElement('div', { key: i, className: 'alert', style: { alignItems: 'flex-start' } },
          React.createElement('span', { className: 'alert__icon tone-' + tone, style: { marginTop: 2 } }, React.createElement(Icon, { name: tone === 'critical' ? 'xCircle' : 'alert', size: 14 })),
          React.createElement('div', { className: 'alert__body', style: { flex: 1 } },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 } },
              React.createElement('div', { className: 'alert__msg mono', style: { fontWeight: 600, marginBottom: 4 } },
                it.file + (it.line != null ? ':' + it.line : '') + (it.category ? '  [' + it.category + ']' : '')),
              onCreateTask && React.createElement('button', {
                className: 'cb-btn cb-btn--sm', disabled: state === 'creating' || state === 'done',
                onClick: () => onCreateTask(report, it, key),
                style: { flexShrink: 0, fontSize: '0.7rem', padding: '3px 8px' },
              }, state === 'done' ? 'Task criada ✓' : state === 'creating' ? '…' : state === 'error' ? 'Erro — tentar de novo' : 'Criar task')),
            React.createElement('div', { className: 'alert__meta', style: { marginBottom: 6, lineHeight: 1.4 } }, it.message),
            it.suggestion && React.createElement('div', { className: 'alert__meta mono', style: { color: 'var(--foreground)', background: 'var(--sidebar)', padding: '4px 8px', borderRadius: 4, whiteSpace: 'pre-wrap' } },
              React.createElement('b', { style: { color: 'var(--' + (tone === 'neutral' ? 'muted' : tone) + ')' } }, 'Sugestão: '), it.suggestion
            )
          )
        );
      })
    );
  }

  function ProjectsPanel() {
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

  export const HDP = { OverviewPanel, HandoffsPanel, BrainPanel, InfraPanel, DataLakePanel, CodeReviewPanel, ProjectsPanel };
