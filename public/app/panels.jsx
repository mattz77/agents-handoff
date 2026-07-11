/* ============================================================
   Painel Handoff — painéis das abas
   Exporta window.HDP (OverviewPanel, HandoffsPanel, BrainPanel, InfraPanel)
   ============================================================ */
(function () {
  const DS = window.CommitBriefingDesignSystem_27542e;
  const { Card, Button, Badge, StatusBadge, Separator } = DS;
  const Icon = window.Icon;
  const { ago, shortId, statusMeta, agentOf, cls } = window.HDLib;
  const { Section, StatusPill, AgentTag, DataTable, TimelineChart, DistBars, KpiStrip, Sparkline } = window.HDW;

  const fmtAgo = (iso) => ago(iso) + ' atrás';

  // ============================================================
  // OVERVIEW
  // ============================================================
  function OverviewPanel({ onInspect, animatedFlow, onPickStatus }) {
    const HD = window.HD;
    const live = HD.handoffs.find((h) => h.live) || HD.handoffs[0];
    const recent = HD.handoffs.slice(0, 7);

    const recentRows = recent.map((h) => ({
      ...h,
      _onClick: () => onInspect(h),
    }));
    const cols = [
      { label: 'Task', mono: true, render: (r) => shortId(r.task_id) },
      { label: 'Projeto', render: (r) => React.createElement('span', { style: { cursor: 'pointer' }, onClick: (e) => { e.stopPropagation(); onPickStatus(null, 'handoffs'); } }, React.createElement(Badge, { variant: 'outline', mono: true }, r.project)) },
      { label: 'Rota', render: (r) => React.createElement('span', { className: 'route' }, React.createElement(AgentTag, { id: r.sender, short: true }), React.createElement(Icon, { name: 'arrowRight', size: 12, className: 'route__arr' }), React.createElement(AgentTag, { id: r.receiver, short: true })) },
      { label: 'Status', render: (r) => React.createElement('span', { className: 'status-click', title: 'Filtrar por ' + r.lifecycle_status, onClick: (e) => { e.stopPropagation(); onPickStatus(r.lifecycle_status, 'handoffs'); } }, React.createElement(StatusPill, { code: r.lifecycle_status })) },
      { label: 'Tent.', mono: true, align: 'right', render: (r) => r.attempt },
      { label: 'Idade', muted: true, align: 'right', nowrap: true, render: (r) => ago(r.updated_at) },
    ];

    return React.createElement('div', { className: 'panel animate-fade-up' },
      // Hero
      React.createElement('div', { className: 'hero-grid' },
        React.createElement(window.HandoffFlow, { animated: animatedFlow, live }),
        React.createElement(window.AgentSummary, null),
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

  function SloBlock() {
    const HD = window.HD, slo = HD.slo, ob = HD.outboxStats || {};
    const pct = Math.min(slo.handoffP95Ms / slo.target * 100, 100);
    const deliveryRate = (ob.sent || 0) + (ob.failed || 0) > 0
      ? Math.round((ob.sent / ((ob.sent || 0) + (ob.failed || 0))) * 1000) / 10 : null;
    const items = [
      ['p95 retomada', (slo.handoffP95Ms / 1000).toFixed(2) + 's', 'good'],
      ['p50 retomada', (slo.handoffP50Ms / 1000).toFixed(2) + 's', 'good'],
      ['MTTR', slo.mttrMin.toFixed(1) + 'min', 'neutral'],
      ['Entrega 24h', slo.successRate + '%', 'good'],
    ];
    const obItems = [
      ['Enviados', ob.sent || 0, 'good'],
      ['Falharam', ob.failed || 0, ob.failed > 0 ? 'critical' : 'neutral'],
      ['Pendentes', ob.pending || 0, ob.pending > 0 ? 'toil' : 'neutral'],
      ['Latência média', ob.avgDeliveryMs ? (ob.avgDeliveryMs / 1000).toFixed(1) + 's' : '—', 'neutral'],
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
        items.map(([k, v, s], i) => React.createElement('div', { key: i, className: 'slo__item' },
          React.createElement('span', { className: 'slo__k' }, k),
          React.createElement('span', { className: cls('slo__v mono', 'tone-' + s) }, v)))),
      React.createElement('div', { className: 'slo__sep' }),
      React.createElement('div', { className: 'slo__section-label' }, 'Outbox · entregas'),
      React.createElement('div', { className: 'slo__grid' },
        obItems.map(([k, v, s], i) => React.createElement('div', { key: i, className: 'slo__item' },
          React.createElement('span', { className: 'slo__k' }, k),
          React.createElement('span', { className: cls('slo__v mono', 'tone-' + s) }, v)))),
    );
  }

  function AlertsList({ alerts }) {
    const tone = { CRITICAL: 'critical', WARNING: 'warning', INFO: 'info' };
    const iconFor = { CRITICAL: 'xCircle', WARNING: 'alert', INFO: 'circleDot' };
    return React.createElement('div', { className: 'alerts' },
      alerts.map((a, i) => React.createElement('div', { key: i, className: 'alert' },
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
    const rows = all.map((h) => ({ ...h, _onClick: () => onInspect(h) }));

    const hCols = [
      { label: 'Task', mono: true, render: (r) => shortId(r.task_id) },
      { label: 'Projeto', render: (r) => React.createElement(Badge, { variant: 'outline', mono: true }, r.project) },
      { label: 'Rota', render: (r) => React.createElement('span', { className: 'route' }, React.createElement(AgentTag, { id: r.sender, short: true }), React.createElement(Icon, { name: 'arrowRight', size: 12, className: 'route__arr' }), React.createElement(AgentTag, { id: r.receiver, short: true })) },
      { label: 'Status', render: (r) => React.createElement(StatusPill, { code: r.lifecycle_status }) },
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
            React.createElement(DataTable, { cols: dlqCols, rows: dlq, empty: 'DLQ vazia — nada a reprocessar.' })),
          React.createElement(Section, { icon: 'inbox', title: 'Outbox represado', count: HD.outbox.filter((o) => o.status !== 'SENT').length, accent: 'var(--toil)' },
            React.createElement(DataTable, { cols: obCols, rows: HD.outbox })),
        ),
        React.createElement('div', { className: 'col sticky-col' },
          React.createElement(Section, { icon: 'shield', title: 'Circuit breakers', count: HD.breakers.length },
            React.createElement(BreakerList, { breakers: HD.breakers })),
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
      breakers.map((b, i) => React.createElement('div', { key: i, className: 'breaker' },
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
        rows.map(([k, v], i) => React.createElement('div', { key: i, className: 'kv__row' },
          React.createElement('span', { className: 'kv__k' }, k),
          React.createElement('span', { className: 'kv__v mono' }, v)))),
    );
  }

  // ============================================================
  // LLM BRAIN
  // ============================================================
  function BrainPanel() {
    const b = window.HD.brain;
    const git = window.HD.git || {};
    const commits = git.recentCommits || [];
    const isClaude = (b.activeModel || '').toLowerCase().includes('claude');
    const activeAgent = isClaude ? 'Claude_Code' : 'Antigravity_Daemon';
    const tone = { done: 'good', in_progress: 'info', pending: 'toil', blocked: 'critical' };
    const tlabel = { done: 'Concluída', in_progress: 'Em progresso', pending: 'Pendente', blocked: 'Bloqueada' };
    const taskCols = [
      { label: 'Tarefa', render: (r) => r.title },
      { label: 'Status', render: (r) => React.createElement(StatusBadge, { status: tone[r.status] }, tlabel[r.status]) },
      { label: 'Responsável', render: (r) => React.createElement(AgentTag, { id: r.assigned && r.assigned.toLowerCase().includes('claude') ? 'Claude_Code' : 'Antigravity_Daemon' }) },
      { label: 'Prio', mono: true, align: 'right', render: (r) => React.createElement(Badge, { variant: r.priority === 'P0' ? 'accent' : 'outline', mono: true }, r.priority) },
    ];
    return React.createElement('div', { className: 'panel animate-fade-up' },
      React.createElement('div', { className: 'brain-hero' },
        React.createElement(Card, { className: 'brain-active' },
          React.createElement('div', { className: 'brain-active__l' },
            React.createElement(window.AgentMark, { agent: agentOf(activeAgent), size: 44, active: true }),
            React.createElement('div', null,
              React.createElement('div', { className: 'brain-active__eyebrow' }, 'Modelo ativo no momento'),
              React.createElement('div', { className: 'brain-active__model' }, b.activeModel),
              React.createElement('div', { className: 'brain-active__task' }, React.createElement('span', { className: 'muted' }, 'Tarefa atual: '), b.currentTask))),
          React.createElement('div', { className: 'brain-active__r' },
            React.createElement(StatusBadge, { status: b.infraHealth && b.infraHealth.includes('UP') ? 'good' : 'warning' }, 'infra ' + (b.infraHealth || '—')),
            React.createElement('span', { className: 'brain-active__sync mono' }, 'sync ' + fmtAgo(b.lastSync)))),
        React.createElement('div', { className: 'brain-stats' },
          [['Pendentes', b.pendingTasks, 'toil'], ['Concluídas', (b.completedTasks || 0).toLocaleString('pt-BR'), 'good'], ['Bloqueadas', b.blockedTasks, 'critical']].map(([k, v, t], i) =>
            React.createElement(Card, { key: i, className: 'brain-stat' },
              React.createElement('span', { className: 'brain-stat__k' }, k),
              React.createElement('span', { className: cls('brain-stat__v mono', 'tone-' + t) }, v)))),
      ),
      React.createElement('div', { className: 'grid-2' },
        React.createElement(Section, { icon: 'list', title: 'Fila de tarefas', count: b.taskList.length },
          React.createElement(DataTable, { cols: taskCols, rows: b.taskList, empty: 'Nenhuma tarefa na fila.' })),
        React.createElement(Section, { icon: 'gitCommit', title: 'Decisões recentes', count: b.recentDecisions.length },
          React.createElement(DecisionTimeline, { decisions: b.recentDecisions })),
      ),
      commits.length > 0 && React.createElement(Section, {
        icon: 'gitBranch',
        title: 'Commits recentes · Luma-APP',
        count: commits.length,
        accent: 'var(--taupe)',
        actions: React.createElement('span', { className: 'sub-note mono' },
          (git.uncommittedChanges || 0) > 0 ? (git.uncommittedChanges + ' changes não commitadas') : 'working tree limpo'),
      }, React.createElement(CommitList, { commits, branch: git.currentBranch })),
    );
  }

  function CommitList({ commits, branch }) {
    return React.createElement('div', { className: 'commits' },
      commits.slice(0, 10).map((c, i) => React.createElement('div', { key: i, className: 'commit' },
        React.createElement('span', { className: 'commit__hash mono' }, c.hash),
        React.createElement('div', { className: 'commit__main' },
          React.createElement('div', { className: 'commit__msg' }, c.message),
          React.createElement('div', { className: 'commit__meta mono muted' }, c.author + ' · ' + ago(c.date) + ' atrás' + (c.branch ? ' · ' + c.branch : ''))),
      )),
    );
  }

  function DecisionTimeline({ decisions }) {
    return React.createElement('div', { className: 'decisions' },
      decisions.map((d, i) => {
        const isClaude = d.model.toLowerCase().includes('claude');
        const ag = agentOf(isClaude ? 'Claude_Code' : 'Antigravity_Daemon');
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
      React.createElement(Section, { icon: 'cpu', title: 'Sistema', bodyClass: 'sys-body' },
        React.createElement('div', { className: 'sysbar' },
          sysItems.map(([k, v, pct, kind], i) => React.createElement('div', { key: i, className: 'sysbar__item' },
            React.createElement('span', { className: 'sysbar__k' }, k),
            React.createElement('span', { className: 'sysbar__v mono' }, v),
            pct !== undefined && React.createElement('span', { className: 'sysbar__track' }, React.createElement('span', { className: cls('sysbar__fill', pct > 80 ? 'tone-bg-critical' : pct > 60 ? 'tone-bg-warning' : 'tone-bg-good'), style: { width: pct + '%' } })))))),
      React.createElement('div', { className: 'grid-2' },
        React.createElement(Section, { icon: 'box', title: 'Containers Docker', count: d.totalRunning + '/' + d.containers.length },
          React.createElement('div', { className: 'docker' },
            d.containers.map((c, i) => React.createElement('div', { key: i, className: 'docker__row' },
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
    if (!ha || !ha.master) return React.createElement('div', { className: 'redis muted' }, 'carregando…');
    const replicas = ha.replicas || [];
    const sentinels = ha.sentinels || [];
    return React.createElement('div', { className: 'redis' },
      React.createElement('div', { className: 'redis__node redis__master' },
        React.createElement('span', { className: 'redis__role' }, 'master'),
        React.createElement('span', { className: 'redis__name mono' }, ha.master.host),
        React.createElement('span', { className: 'redis__dot up' })),
      React.createElement('div', { className: 'redis__replicas' },
        replicas.map((rp, i) => React.createElement('div', { key: i, className: 'redis__node' },
          React.createElement('span', { className: 'redis__role' }, 'replica'),
          React.createElement('span', { className: 'redis__name mono' }, rp.name),
          React.createElement('span', { className: 'redis__lag mono muted' }, 'lag ' + rp.lagBytes + 'b'),
          React.createElement('span', { className: 'redis__dot up' })))),
      React.createElement('div', { className: 'redis__sentinels' },
        sentinels.map((sn, i) => React.createElement('span', { key: i, className: 'redis__sentinel mono' },
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
          React.createElement(Section, { icon: 'fileText', title: 'LLM-Brain · sincronismo de contexto', count: files.length, accent: 'var(--copper)',
            actions: React.createElement('span', { className: 'sub-note' }, 'cérebro rápido · estado de curto prazo') },
            React.createElement(BrainSync, { files })),
        ),
        React.createElement('div', { className: 'col sticky-col' },
          React.createElement(Section, { icon: 'shield', title: 'Backups & restore-check', count: dl.backups.length },
            React.createElement(BackupList, { backups: dl.backups })),
          React.createElement(Section, { icon: 'sparkles', title: 'Roadmap', accent: 'var(--copper)' },
            React.createElement(RoadmapNote, { dl })),
        ),
      ),
    );
  }

  function DlMount({ dl }) {
    const GDrive = window.GDriveGlyph;
    return React.createElement(Card, { className: 'dl-mount' },
      React.createElement('div', { className: 'dl-mount__top' },
        React.createElement('span', { className: 'dl-mount__glyph' }, React.createElement(GDrive, { size: 34 })),
        React.createElement('div', { className: 'dl-mount__id' },
          React.createElement('div', { className: 'dl-mount__eyebrow' }, 'Data Lake · memória de longo prazo'),
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
    const label = { ok: 'restore ok', warn: 'check pendente', fail: 'falhou', 'n/a': '—' };
    return React.createElement('div', { className: 'backups' },
      backups.map((b, i) => React.createElement('div', { key: i, className: 'backup' },
        React.createElement('div', { className: 'backup__top' },
          React.createElement('span', { className: 'backup__engine mono' }, b.engine),
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
      files.map((f, i) => {
        const isClaude = f.updatedBy.toLowerCase().includes('claude');
        const ag = agentOf(isClaude ? 'Claude_Code' : 'Antigravity_Daemon');
        return React.createElement('div', { key: i, className: 'bsync__row' },
          React.createElement('span', { className: 'bsync__icon' }, React.createElement(Icon, { name: 'fileText', size: 15 })),
          React.createElement('div', { className: 'bsync__main' },
            React.createElement('div', { className: 'bsync__name mono' }, f.name,
              React.createElement('span', { className: 'bsync__mode mono' }, f.mode)),
            React.createElement('div', { className: 'bsync__role' }, f.role)),
          React.createElement('div', { className: 'bsync__side' },
            React.createElement('span', { className: 'bsync__by mono', style: { color: ag.accent } }, ag.name),
            React.createElement('span', { className: 'bsync__when mono' }, f.lines + ' linhas · ' + ago(f.updated) + ' atrás')));
      }),
    );
  }

  function RoadmapNote({ dl }) {
    return React.createElement('div', { className: 'roadmap' },
      React.createElement('div', { className: 'roadmap__item' },
        React.createElement('span', { className: 'roadmap__dot' }),
        React.createElement('div', null,
          React.createElement('div', { className: 'roadmap__t' }, 'RAG nativo sobre o Drive'),
          React.createElement('div', { className: 'roadmap__d' }, 'Embeddings leves p/ Semantic Search autônomo nos 5\u00a0TB do Data Lake.'))),
      React.createElement('div', { className: 'roadmap__item' },
        React.createElement('span', { className: 'roadmap__dot' }),
        React.createElement('div', null,
          React.createElement('div', { className: 'roadmap__t' }, 'Observabilidade autônoma'),
          React.createElement('div', { className: 'roadmap__d' }, 'n8n ingere alertas do Docker/Traefik direto na task-queue.md.'))),
      React.createElement('div', { className: 'roadmap__foot' },
        React.createElement(Badge, { variant: 'outline', mono: true }, 'RAG: ' + dl.rag)),
    );
  }

  window.HDP = { OverviewPanel, HandoffsPanel, BrainPanel, InfraPanel, DataLakePanel };
})();
