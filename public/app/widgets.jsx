/* ============================================================
   Painel Handoff — widgets compartilhados
   Exporta window.HDW (Section, StatusPill, DataTable, TimelineChart,
   DistBars, KpiStrip, Sparkline, Inspector, AgentTag)
   ============================================================ */
(function () {
  const DS = window.CommitBriefingDesignSystem_27542e;
  const { Card, StatusBadge, Badge, KpiCard, Button, Avatar } = DS;
  const Icon = window.Icon;
  const { ago, shortId, statusMeta, agentOf, cls } = window.HDLib;

  // ---- Seção (Card com cabeçalho) ----
  function Section({ icon, title, count, accent, actions, children, bodyClass = '', className = '' }) {
    return React.createElement(Card, { className: cls('section', className) },
      React.createElement('div', { className: 'section__head' },
        icon && React.createElement('span', { className: 'section__icon', style: accent ? { color: accent } : null }, React.createElement(Icon, { name: icon, size: 15 })),
        React.createElement('h2', { className: 'section__title' }, title),
        (count !== undefined && count !== null) && React.createElement('span', { className: 'section__count mono' }, count),
        actions && React.createElement('span', { className: 'section__actions' }, actions),
      ),
      React.createElement('div', { className: cls('section__body', bodyClass) }, children),
    );
  }

  // ---- Pill de status (lifecycle) ----
  function StatusPill({ code, onClick }) {
    const m = statusMeta(code);
    return React.createElement('span', { onClick, style: onClick ? { cursor: 'pointer' } : null },
      React.createElement(StatusBadge, { status: m.ds }, m.label));
  }

  // ---- Tag de agente ----
  function AgentTag({ id, short }) {
    const a = agentOf(id);
    const name = short ? (id === 'Claude_Code' ? 'Claude' : 'Antigravity') : a.name;
    return React.createElement('span', { className: 'agent-tag mono', style: { color: a.accent } },
      React.createElement('span', { className: 'agent-tag__dot', style: { background: a.accent } }),
      name);
  }

  // ---- Tabela genérica ----
  function DataTable({ cols, rows, empty = 'Nenhum registro.' }) {
    if (!rows.length) return React.createElement('div', { className: 'empty' }, empty);
    return React.createElement('div', { className: 'table-wrap' },
      React.createElement('table', { className: 'tbl' },
        React.createElement('thead', null, React.createElement('tr', null,
          cols.map((c, i) => React.createElement('th', { key: i, style: c.w ? { width: c.w } : null, className: c.align === 'right' ? 'ar' : '' }, c.label)))),
        React.createElement('tbody', null,
          rows.map((r, ri) => React.createElement('tr', { key: ri, className: r._onClick ? 'row-click' : '', onClick: r._onClick },
            cols.map((c, ci) => React.createElement('td', { key: ci, className: cls(c.mono && 'mono', c.muted && 'muted', c.align === 'right' && 'ar', c.nowrap && 'nowrap') }, c.render ? c.render(r) : r[c.key])))))),
    );
  }

  // ---- Timeline 14d (Area chart + falhas) ----
  function TimelineChart({ data }) {
    if (!data || !data.length) return React.createElement('div', { className: 'empty' }, 'Sem dados.');
    const max = data.reduce((m, d) => Math.max(m, d.count), 1);
    const W = Math.max(data.length * 40, 200);
    const H = 130;
    const gap = W / data.length;

    const points = data.map((d, i) => {
      const x = i * gap + gap / 2;
      const y = H - Math.max((d.count / max) * (H - 15), 5);
      return { x, y, ...d };
    });

    const dPath = 'M 0 ' + H + ' ' + points.map((p, i) => {
      if (i === 0) return `L ${p.x} ${p.y}`;
      const prev = points[i - 1];
      const cpX = (prev.x + p.x) / 2;
      return `C ${cpX} ${prev.y}, ${cpX} ${p.y}, ${p.x} ${p.y}`;
    }).join(' ') + ` L ${W} ${H} Z`;

    const lPath = 'M ' + points.map((p, i) => {
      if (i === 0) return `${p.x} ${p.y}`;
      const prev = points[i - 1];
      const cpX = (prev.x + p.x) / 2;
      return `C ${cpX} ${prev.y}, ${cpX} ${p.y}, ${p.x} ${p.y}`;
    }).join(' ');

    return React.createElement('div', { className: 'timeline' },
      React.createElement('svg', { className: 'timeline__svg', viewBox: `0 0 ${W} ${H + 20}`, preserveAspectRatio: 'none', style: { overflow: 'visible' } },
        React.createElement('defs', null,
          React.createElement('linearGradient', { id: 'tl-grad', x1: '0', y1: '0', x2: '0', y2: '1' },
            React.createElement('stop', { offset: '0%', stopColor: 'var(--chart-1)', stopOpacity: 0.5 }),
            React.createElement('stop', { offset: '100%', stopColor: 'var(--chart-1)', stopOpacity: 0.05 })
          )
        ),
        [0.25, 0.5, 0.75, 1].map((g, i) => React.createElement('line', { key: 'g'+i, x1: 0, x2: W, y1: H - g * H, y2: H - g * H, stroke: 'var(--border)', strokeWidth: 1, strokeDasharray: '4 4', opacity: 0.4 })),
        React.createElement('path', { d: dPath, fill: 'url(#tl-grad)' }),
        React.createElement('path', { d: lPath, fill: 'none', stroke: 'var(--chart-1)', strokeWidth: 2.5 }),
        points.map((p, i) => {
          const fh = p.failed > 0 ? Math.max((p.failed / max) * (H - 15), 3) : 0;
          return React.createElement('g', { key: i, className: 'timeline__node' },
            React.createElement('circle', { cx: p.x, cy: p.y, r: 4, fill: 'var(--chart-1)', stroke: 'var(--background)', strokeWidth: 2 },
              React.createElement('title', null, `${p.date}: ${p.count} handoffs`)
            ),
            fh > 0 && React.createElement('rect', { x: p.x - 3, y: H - fh, width: 6, height: fh, rx: 1.5, fill: 'var(--critical)' },
              React.createElement('title', null, `${p.failed} falhas`)
            ),
            React.createElement('text', { x: p.x, y: H + 15, fill: 'var(--muted-foreground)', fontSize: 9, textAnchor: 'middle', fontFamily: 'var(--font-mono)' }, p.date.slice(8))
          );
        })
      ),
      React.createElement('div', { className: 'timeline__legend' },
        React.createElement('span', null, React.createElement('i', { style: { background: 'var(--chart-1)', borderRadius: '50%' } }), 'handoffs/dia'),
        React.createElement('span', null, React.createElement('i', { style: { background: 'var(--critical)' } }), 'falhas'),
      ),
    );
  }

  // ---- Barras de distribuição por status ----
  function DistBars({ map, onPick }) {
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
    const max = entries.reduce((m, e) => Math.max(m, e[1]), 1);
    const colorFor = { good: 'var(--good)', warning: 'var(--warning)', critical: 'var(--critical)', toil: 'var(--toil)', info: 'var(--info)', neutral: 'var(--taupe)' };
    return React.createElement('div', { className: 'dist' },
      entries.map(([k, v], i) => {
        const m = statusMeta(k);
        return React.createElement('div', { key: i, className: 'dist__row', onClick: onPick ? () => onPick(k) : null },
          React.createElement('span', { className: 'dist__lbl' }, m.label),
          React.createElement('span', { className: 'dist__track' }, React.createElement('span', { className: 'dist__fill', style: { width: Math.round(v / max * 100) + '%', background: colorFor[m.ds] } })),
          React.createElement('span', { className: 'dist__n mono' }, v.toLocaleString('pt-BR')),
        );
      }),
    );
  }

  function Sparkline({ data, color = 'var(--chart-1)' }) {
    const max = Math.max(...data, 1);
    return React.createElement('span', { className: 'spark' },
      data.map((v, i) => React.createElement('i', { key: i, style: { height: Math.max(v / max * 100, 8) + '%', background: color } })));
  }

  // ---- KPI strip (DORA-style) ----
  function KpiStrip() {
    const HD = window.HD;
    const slo = HD.slo;
    const openB = HD.breakers.filter((b) => b.state !== 'CLOSED').length;
    const ob = (HD.outboxByStatus.PENDING || 0) + (HD.outboxByStatus.FAILED || 0);
    const kpis = [
      { title: 'Velocidade de retomada', value: (slo.handoffP95Ms / 1000).toFixed(2) + 's', status: 'good', icon: 'gauge', trend: 'up', trendValue: 'p95 · alvo 3.00s', description: '' },
      { title: 'Ritmo de handoffs', value: slo.last24h + '/24h', status: 'neutral', icon: 'activity', trend: 'up', trendValue: '+12%', description: 'deploy freq.' },
      { title: 'Taxa de entrega', value: slo.successRate + '%', status: 'good', icon: 'check', trend: 'neutral', trendValue: '', description: 'sem DLQ' },
      { title: 'Pendentes (PEL)', value: HD.stream.pending, status: HD.stream.pending > 5 ? 'warning' : 'neutral', icon: 'cpu', description: 'consumer group' },
      { title: 'Dead Letter Queue', value: HD.dlq.length, status: HD.dlq.length > 0 ? 'critical' : 'good', icon: 'split', showPulse: HD.dlq.length > 0, description: 'aguardando replay' },
      { title: 'Breakers em alerta', value: openB, status: openB > 0 ? 'warning' : 'good', icon: 'shield', description: 'n8n-webhook half-open' },
    ];
    return React.createElement('div', { className: 'kpi-strip' },
      kpis.map((k, i) => React.createElement(KpiCard, { key: i, ...k, icon: React.createElement(Icon, { name: k.icon, size: 16 }) })));
  }

  // ---- Inspector (drawer): detalhes + trace waterfall ----
  function TraceWaterfall({ spans }) {
    const total = spans.reduce((m, s) => Math.max(m, s.t0 + s.dur), 1);
    return React.createElement('div', { className: 'trace' },
      spans.map((s, i) => React.createElement('div', { key: i, className: 'trace__row' },
        React.createElement('div', { className: 'trace__name' },
          React.createElement('span', { className: 'mono trace__span' }, s.span),
          React.createElement('span', { className: 'trace__svc' }, s.svc)),
        React.createElement('div', { className: 'trace__track' },
          React.createElement('span', { className: cls('trace__bar', s.ok ? 'ok' : 'fail'), style: { left: (s.t0 / total * 100) + '%', width: Math.max(s.dur / total * 100, 1.5) + '%' } })),
        React.createElement('div', { className: 'trace__dur mono' }, s.dur + 'ms'),
      )),
      React.createElement('div', { className: 'trace__foot mono' }, 'total ' + total + 'ms · correlation propagado ponta a ponta'),
    );
  }

  function Inspector({ handoff, onClose }) {
    const open = !!handoff;
    const h = handoff || {};
    const HD = window.HD;
    const sender = agentOf(h.sender), receiver = agentOf(h.receiver);
    const spans = handoff ? HD.traceFor(h) : [];
    const meta = handoff ? [
      ['Task ID', React.createElement('span', { className: 'mono' }, h.task_id)],
      ['Correlation', React.createElement('span', { className: 'mono' }, h.correlation_id)],
      ['Projeto', React.createElement(Badge, { variant: 'outline', mono: true }, h.project)],
      ['Branch', React.createElement('span', { className: 'mono' }, h.branch || '—')],
      ['Status', React.createElement(StatusPill, { code: h.lifecycle_status })],
      ['Origem → Destino', React.createElement('span', { className: 'insp-route' }, React.createElement(AgentTag, { id: h.sender }), React.createElement(Icon, { name: 'arrowRight', size: 13 }), React.createElement(AgentTag, { id: h.receiver }))],
      ['Tentativa', React.createElement('span', { className: 'mono' }, h.attempt)],
      ['Atualizado', ago(h.updated_at) + ' atrás'],
    ] : [];

    return React.createElement(React.Fragment, null,
      React.createElement('div', { className: cls('drawer-ov', open && 'open'), onClick: onClose }),
      React.createElement('aside', { className: cls('drawer', open && 'open') },
        handoff && React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'drawer__head' },
            React.createElement('div', { className: 'drawer__title' },
              React.createElement(Icon, { name: 'gitCommit', size: 16 }), 'Inspector de handoff'),
            React.createElement('button', { className: 'drawer__close', onClick: onClose }, React.createElement(Icon, { name: 'x', size: 16 })),
          ),
          React.createElement('div', { className: 'drawer__body' },
            React.createElement('div', { className: 'insp-sec' },
              React.createElement('h4', null, 'Contexto'),
              React.createElement('div', { className: 'insp-grid' },
                meta.map(([k, v], i) => React.createElement('div', { key: i, className: 'insp-row' },
                  React.createElement('span', { className: 'insp-k' }, k),
                  React.createElement('span', { className: 'insp-v' }, v))))),
            React.createElement('div', { className: 'insp-sec' },
              React.createElement('h4', null, 'Ação pendente'),
              React.createElement('div', { className: 'insp-action' }, h.pending_action || '—')),
            h.error && React.createElement('div', { className: 'insp-sec' },
              React.createElement('h4', null, 'Motivo da falha'),
              React.createElement('div', { className: 'insp-error mono' }, h.error)),
            React.createElement('div', { className: 'insp-sec' },
              React.createElement('h4', null, 'Trace distribuído · correlation_id'),
              React.createElement(TraceWaterfall, { spans })),
          ),
        ),
      ),
    );
  }

  window.HDW = { Section, StatusPill, AgentTag, DataTable, TimelineChart, DistBars, Sparkline, KpiStrip, Inspector };
})();
