import React from 'react';
import { Icon, HDLib } from '../icons.jsx';
import { HDW } from '../widgets.jsx';
import { HandoffFlow, AgentSummary } from '../flow.jsx';
import { StatusBadge, AlertsList } from './shared.jsx';

const DS = window.CommitBriefingDesignSystem_27542e;
const { Card, Button, Badge } = DS;
const { shortId, ago, cls } = HDLib;
const { Section, StatusPill, AgentTag, DataTable, TimelineChart, DistBars, KpiStrip } = HDW;

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

  return (
    <Section icon="zap" title="Ação necessária" count={total || undefined} accent={total ? 'var(--warning)' : undefined}>
      {total === 0
        ? <div className="muted" style={{ padding: 12 }}>Tudo em dia — nada pendente no momento.</div>
        : (
          <div className="dl-stats">
            {items.filter((i) => i.count > 0).map((i) => (
              <Card key={i.key} className="dl-stat" style={{ cursor: 'pointer' }} onClick={i.onClick}>
                <span className={cls('dl-stat__icon', 'tone-' + i.tone)}><Icon name={i.icon} size={16} /></span>
                <div className="dl-stat__meta">
                  <span className="dl-stat__v mono">{i.count}</span>
                  <span className="dl-stat__k">{i.label}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
    </Section>
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
  return (
    <div className="slo">
      <div className="slo__gauge">
        <div className="slo__gauge-head">
          <span className="slo__label">Latência do handoff (p95)</span>
          <span className="slo__target mono">alvo {(slo.target / 1000).toFixed(2)}s</span>
        </div>
        <div className="slo__track">
          <span className="slo__fill" style={{ width: pct + '%' }} />
          <span className="slo__marker" style={{ left: '100%' }} />
        </div>
        <div className="slo__val mono">
          {(slo.handoffP95Ms / 1000).toFixed(2)}s
          <StatusBadge status="good">dentro do SLO</StatusBadge>
        </div>
      </div>
      <div className="slo__grid">
        {items.map(([k, v, s], i) => (
          <div key={i} className="slo__item">
            <span className="slo__k">{k}</span>
            <span className={cls('slo__v mono', 'tone-' + s)}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OverviewPanel({ onInspect, animatedFlow, onPickStatus }) {
  const HD = window.HD;
  const live = HD.handoffs.find((h) => h.live) || HD.handoffs[0];
  const recent = HD.handoffs.slice(0, 7);

  const recentRows = (recent || []).map((h) => ({
    ...h,
    _onClick: () => onInspect(h),
  }));
  const cols = [
    { label: 'Task', mono: true, render: (r) => shortId(r.task_id) },
    { label: 'Projeto', render: (r) => <Badge variant="outline" mono>{r.project}</Badge> },
    { label: 'Rota', render: (r) => (
      <span className="route">
        <AgentTag id={window.HD.normalizeAgentId?.(r.sender) || r.sender} short />
        <Icon name="arrowRight" size={12} className="route__arr" />
        <AgentTag id={window.HD.normalizeAgentId?.(r.receiver) || r.receiver} short />
      </span>
    ) },
    { label: 'Status', render: (r) => <StatusPill code={r.lifecycle_status} /> },
    { label: 'Tent.', mono: true, align: 'right', render: (r) => r.attempt },
    { label: 'Idade', muted: true, align: 'right', nowrap: true, render: (r) => ago(r.updated_at) },
  ];

  return (
    <div className="panel animate-fade-up">
      <ActionRequired onPickStatus={onPickStatus} />
      <div className="hero-grid">
        <HandoffFlow animated={animatedFlow} live={live} onDlqClick={() => onPickStatus(null, 'handoffs')} />
        <AgentSummary />
      </div>
      <KpiStrip />
      <div className="grid-side">
        <div className="col">
          <Section icon="trending" title="Throughput de handoffs" count="14d"
            actions={<span className="sub-note mono">{HD.slo.last24h} nas últimas 24h</span>}>
            <TimelineChart data={HD.timeline} />
          </Section>
          <Section icon="list" title="Handoffs recentes" count={recent.length}
            actions={<Button variant="ghost" size="sm" onClick={() => onPickStatus(null, 'handoffs')}>Ver todos</Button>}>
            <DataTable cols={cols} rows={recentRows} />
          </Section>
        </div>
        <div className="col sticky-col">
          <Section icon="gauge" title="SLO & saúde" className="slo-card">
            <SloBlock />
          </Section>
          <Section icon="activity" title="Distribuição por status">
            <DistBars map={HD.histStatus} onPick={(k) => onPickStatus(k, 'handoffs')} />
          </Section>
          <Section icon="bell" title="Alertas" count={HD.alerts.length} accent="var(--toil)">
            <AlertsList alerts={HD.alerts} />
          </Section>
        </div>
      </div>
    </div>
  );
}
