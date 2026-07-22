import React from 'react';
import { Icon, HDLib } from '../icons.jsx';
import { HDW } from '../widgets.jsx';
import { StatusBadge } from './shared.jsx';

const DS = window.CommitBriefingDesignSystem_27542e;
const { Card, Button, Badge } = DS;
const { shortId, ago, statusMeta, cls } = HDLib;
const { Section, StatusPill, AgentTag, DataTable } = HDW;

function DlqDetail({ item, onClose, onReplay }) {
  const meta = [
    ['DLQ ID', item.id],
    ['Task', item.task_id || '—'],
    ['Correlation', item.correlation_id || '—'],
    ['Projeto', item.project || '—'],
    ['Status original', item.original_status || '—'],
    ['Tentativas', item.attempt != null ? String(item.attempt) : '—'],
    ['Entrou na DLQ', item.dlq_at ? new Date(item.dlq_at).toLocaleString('pt-BR') : '—'],
  ];
  return (
    <Card className="dlq-detail" style={{ marginTop: 10, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
          <Icon name="alert" size={14} /> Falha na entrega
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="sm" onClick={() => onReplay(item)}>
            <Icon name="replay" size={13} /> Replay
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <Icon name="x" size={13} />
          </Button>
        </div>
      </div>
      <div className="mono" style={{ color: 'var(--critical)', marginBottom: 10, fontSize: 13 }}>
        {item.reason || 'motivo não registrado'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginBottom: 10 }}>
        {meta.map(([k, v], i) => (
          <div key={i}>
            <div className="muted" style={{ fontSize: 11 }}>{k}</div>
            <div className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>{v}</div>
          </div>
        ))}
      </div>
      {item.payload && (
        <details>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>Payload completo</summary>
          <pre className="mono" style={{ fontSize: 11, overflowX: 'auto', maxHeight: 260, marginTop: 6, padding: 8, background: 'rgb(0 0 0 / 0.25)', borderRadius: 6 }}>
            {JSON.stringify(item.payload, null, 2)}
          </pre>
        </details>
      )}
    </Card>
  );
}

function BreakerList({ breakers }) {
  const tone = { OPEN: 'critical', HALF_OPEN: 'warning', CLOSED: 'good' };
  const label = { OPEN: 'Aberto', HALF_OPEN: 'Half-open', CLOSED: 'Fechado' };
  return (
    <div className="breakers">
      {(breakers || []).map((b, i) => (
        <div key={i} className="breaker">
          <div className="breaker__top">
            <span className="breaker__key mono">{b.key}</span>
            <StatusBadge status={tone[b.state]}>{label[b.state]}</StatusBadge>
          </div>
          <div className="breaker__meta">
            <span>falhas <b className="mono">{b.fails}/{b.threshold}</b></span>
            <span>cooldown <b className="mono">{(b.cooldownMs / 1000)}s</b></span>
            {b.openedAt && <span>aberto há <b className="mono">{ago(new Date(b.openedAt).toISOString())}</b></span>}
          </div>
          <div className="breaker__track">
            <span className={cls('breaker__fill', 'tone-bg-' + tone[b.state])} style={{ width: Math.min(b.fails / b.threshold * 100, 100) + '%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function StreamBlock() {
  const s = window.HD.stream;
  const hasMax = Number.isFinite(s.maxlen) && s.maxlen > 0;
  const pct = hasMax ? Math.min(s.length / s.maxlen * 100, 100) : 0;
  const rows = [['Comprimento', s.length.toLocaleString('pt-BR')], ['Consumer groups', s.groups], ['Pendentes (PEL)', s.pending], ['MAXLEN', hasMax ? '~' + (s.maxlen / 1000) + 'k' : 'sem limite']];
  return (
    <div className="stream">
      <div className="stream__bar">
        <span className="stream__fill" style={{ width: pct + '%' }} />
      </div>
      <div className="stream__pct mono">{hasMax ? pct.toFixed(0) + '% do MAXLEN' : 'stream sem MAXLEN configurado'}</div>
      <div className="kv">
        {rows.map(([k, v], i) => (
          <div key={i} className="kv__row">
            <span className="kv__k">{k}</span>
            <span className="kv__v mono">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HandoffsPanel({ onInspect, filter, setFilter, dlq, onReplay }) {
  const HD = window.HD;
  const [dlqSel, setDlqSel] = React.useState(null);
  const all = filter ? HD.handoffs.filter((h) => h.lifecycle_status === filter) : HD.handoffs;
  const rows = (all || []).map((h) => ({ ...h, _onClick: () => onInspect(h) }));
  const dlqRows = (dlq || []).map((d) => ({ ...d, _onClick: () => setDlqSel((cur) => (cur && cur.id === d.id ? null : d)) }));
  const norm = (id) => window.HD.normalizeAgentId?.(id) || id;

  const hCols = [
    { label: 'Task', mono: true, render: (r) => shortId(r.task_id) },
    { label: 'Projeto', render: (r) => <Badge variant="outline" mono>{r.project}</Badge> },
    { label: 'Rota', render: (r) => (
      <span className="route">
        <AgentTag id={norm(r.sender)} short />
        <Icon name="arrowRight" size={12} className="route__arr" />
        <AgentTag id={norm(r.receiver)} short />
      </span>
    ) },
    { label: 'Status', render: (r) => <StatusPill code={r.lifecycle_status} /> },
    { label: 'Hermes', render: (r) => {
      if (!r.hermes_severidade) return <span className="muted">·</span>;
      const sev = r.hermes_severidade;
      const status = sev === 'high' ? 'critical' : sev === 'medium' ? 'warning' : sev === 'low' ? 'good' : 'warning';
      const label = sev === 'unknown' ? '-' : (r.hermes_nota != null ? (r.hermes_nota + '/10') : sev);
      return <span title={r.hermes_resumo || sev}><StatusBadge status={status}>{label}</StatusBadge></span>;
    } },
    { label: 'Idade', muted: true, align: 'right', nowrap: true, render: (r) => ago(r.updated_at) },
  ];

  const dlqCols = [
    { label: 'DLQ ID', mono: true, render: (r) => shortId(r.id, 13) },
    { label: 'Projeto', render: (r) => <Badge variant="outline" mono>{r.project}</Badge> },
    { label: 'Motivo', muted: true, render: (r) => <span className="reason" title={r.reason}>{r.reason}</span> },
    { label: 'Tent.', mono: true, align: 'right', render: (r) => r.attempt },
    { label: 'Idade', muted: true, align: 'right', nowrap: true, render: (r) => ago(r.dlq_at) },
    { label: '', align: 'right', render: (r) => (
      <Button size="sm" onClick={(e) => { e.stopPropagation(); onReplay(r); }}>
        <Icon name="replay" size={13} /> Replay
      </Button>
    ) },
  ];

  const obCols = [
    { label: 'ID', mono: true, render: (r) => r.id },
    { label: 'Evento', mono: true, render: (r) => <Badge variant="outline" mono>{r.event_type}</Badge> },
    { label: 'Status', render: (r) => <StatusBadge status={r.status === 'SENT' ? 'good' : r.status === 'FAILED' ? 'critical' : 'warning'}>{r.status}</StatusBadge> },
    { label: 'Tent.', mono: true, align: 'right', render: (r) => r.attempts },
    { label: 'Idade', muted: true, align: 'right', nowrap: true, render: (r) => ago(r.created_at) },
  ];

  const statuses = Object.keys(HD.histStatus);

  return (
    <div className="panel animate-fade-up">
      <div className="grid-side">
        <div className="col">
          <Section
            icon="list" title="Todos os handoffs" count={all.length}
            actions={(
              <div className="chip-row">
                {filter && (
                  <button className="fchip fchip--on" onClick={() => setFilter(null)}>
                    {statusMeta(filter).label}<Icon name="x" size={11} />
                  </button>
                )}
                {!filter && statuses.slice(0, 4).map((s) => (
                  <button key={s} className="fchip" onClick={() => setFilter(s)}>{statusMeta(s).label}</button>
                ))}
              </div>
            )}
          >
            <DataTable cols={hCols} rows={rows} pageSize={25} />
          </Section>
          <Section icon="split" title="Dead Letter Queue" count={dlq.length} accent="var(--critical)"
            actions={<span className="sub-note">clique na linha pra ver a falha · replay reinjeta no stream</span>}>
            <DataTable cols={dlqCols} rows={dlqRows} empty="DLQ vazia - nada a reprocessar." />
            {dlqSel && <DlqDetail item={dlqSel} onClose={() => setDlqSel(null)} onReplay={(it) => { onReplay(it); setDlqSel(null); }} />}
          </Section>
          <Section icon="inbox" title="Outbox represado" count={HD.outbox.filter((o) => o.status !== 'SENT').length} accent="var(--toil)">
            <DataTable cols={obCols} rows={HD.outbox} pageSize={20} />
          </Section>
        </div>
        <div className="col sticky-col">
          <Section icon="shield" title="Circuit breakers" count={(HD.breakers || []).length}>
            <BreakerList breakers={HD.breakers || []} />
          </Section>
          <Section icon="database" title="Stream Redis">
            <StreamBlock />
          </Section>
        </div>
      </div>
    </div>
  );
}
