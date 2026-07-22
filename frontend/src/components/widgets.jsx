import React from 'react';
import { Icon, HDLib } from './icons.jsx';

const DS = window.CommitBriefingDesignSystem_27542e;
const { Card, Badge, KpiCard, Button } = DS;
const { ago, statusMeta, agentOf, cls } = HDLib;

function Section({ icon, title, count, accent, actions, children, bodyClass = '', className = '' }) {
  return (
    <Card className={cls('section', className)}>
      <div className="section__head">
        {icon && (
          <span className="section__icon" style={accent ? { color: accent } : null}>
            <Icon name={icon} size={15} />
          </span>
        )}
        <h2 className="section__title">{title}</h2>
        {(count !== undefined && count !== null) && <span className="section__count mono">{count}</span>}
        {actions && <span className="section__actions">{actions}</span>}
      </div>
      <div className={cls('section__body', bodyClass)}>{children}</div>
    </Card>
  );
}

function StatusPill({ code, onClick }) {
  const m = statusMeta(code);
  const colorFor = { good: 'var(--good)', warning: 'var(--warning)', critical: 'var(--critical)', toil: 'var(--toil)', info: 'var(--info)', neutral: 'var(--taupe)' };
  return (
    <span
      onClick={onClick}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: onClick ? 'pointer' : 'default', fontWeight: 500 }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: colorFor[m.ds] || 'var(--taupe)' }} />
      {m.label}
    </span>
  );
}

function AgentTag({ id, short }) {
  const a = agentOf(id);
  const name = short ? (id === 'Claude_Code' ? 'Claude' : 'Antigravity') : a.name;
  return (
    <span className="agent-tag mono" style={{ color: a.accent }}>
      <span className="agent-tag__dot" style={{ background: a.accent }} />
      {name}
    </span>
  );
}

function DataTable({ cols, rows, empty = 'Nenhum registro.', pageSize }) {
  const [limit, setLimit] = React.useState((pageSize && pageSize > 0) ? pageSize : Infinity);
  if (!rows.length) return <div className="empty">{empty}</div>;
  const visible = rows.length > limit ? rows.slice(0, limit) : rows;
  const hidden = rows.length - visible.length;
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th key={i} style={c.w ? { width: c.w } : null} className={c.align === 'right' ? 'ar' : ''}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((r, ri) => (
            <tr key={ri} className={r._onClick ? 'row-click' : ''} onClick={r._onClick}>
              {cols.map((c, ci) => (
                <td key={ci} className={cls(c.mono && 'mono', c.muted && 'muted', c.align === 'right' && 'ar', c.nowrap && 'nowrap')}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 && (
        <button className="tbl-more" onClick={() => setLimit((l) => l + (pageSize || 25))}>
          Mostrar mais <b className="mono">{Math.min(hidden, pageSize || 25)}</b> de <b className="mono">{hidden}</b> restantes
        </button>
      )}
    </div>
  );
}

function TimelineChart({ data }) {
  if (!data || !data.length) return <div className="empty">Sem dados.</div>;
  const max = data.reduce((m, d) => Math.max(m, d.count), 1);
  const W = data.length * 40, H = 130;
  return (
    <div className="timeline">
      <svg className="timeline__svg" viewBox={`0 0 ${W} ${H + 18}`} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75, 1].map((g, i) => (
          <line key={i} x1={0} x2={W} y1={H - g * H} y2={H - g * H} stroke="var(--border)" strokeWidth={1} strokeDasharray="2 4" opacity={0.5} />
        ))}
        {data.map((d, i) => {
          const h = Math.max((d.count / max) * (H - 8), 3);
          const x = i * 40 + 7;
          const fh = d.failed > 0 ? Math.max((d.failed / max) * (H - 8), 3) : 0;
          return (
            <g key={i}>
              <rect x={x} y={H - h} width={22} height={h} rx={3} fill="var(--chart-1)" opacity={0.85}>
                <title>{`${d.date}: ${d.count} handoffs`}</title>
              </rect>
              {fh > 0 && (
                <rect x={x + 7} y={H - fh} width={8} height={fh} rx={2} fill="var(--critical)">
                  <title>{`${d.failed} falhas`}</title>
                </rect>
              )}
              <text x={x + 11} y={H + 13} fill="var(--muted-foreground)" fontSize={9} textAnchor="middle" fontFamily="var(--font-mono)">{d.date.slice(8)}</text>
            </g>
          );
        })}
      </svg>
      <div className="timeline__legend">
        <span><i style={{ background: 'var(--chart-1)' }} />handoffs/dia</span>
        <span><i style={{ background: 'var(--critical)' }} />falhas</span>
      </div>
    </div>
  );
}

function DistBars({ map, onPick }) {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const max = entries.reduce((m, e) => Math.max(m, e[1]), 1);
  const colorFor = { good: 'var(--good)', warning: 'var(--warning)', critical: 'var(--critical)', toil: 'var(--toil)', info: 'var(--info)', neutral: 'var(--taupe)' };
  return (
    <div className="dist">
      {entries.map(([k, v], i) => {
        const m = statusMeta(k);
        return (
          <div key={i} className="dist__row" onClick={onPick ? () => onPick(k) : null}>
            <span className="dist__lbl">{m.label}</span>
            <span className="dist__track">
              <span className="dist__fill" style={{ width: Math.round(v / max * 100) + '%', background: colorFor[m.ds] }} />
            </span>
            <span className="dist__n mono">{v.toLocaleString('pt-BR')}</span>
          </div>
        );
      })}
    </div>
  );
}

function Sparkline({ data, color = 'var(--chart-1)' }) {
  const max = Math.max(...data, 1);
  return (
    <span className="spark">
      {data.map((v, i) => (
        <i key={i} style={{ height: Math.max(v / max * 100, 8) + '%', background: color }} />
      ))}
    </span>
  );
}

function KpiStrip() {
  const HD = window.HD;
  const slo = HD.slo;
  const openB = (HD.breakers || []).filter((b) => b.state !== 'CLOSED').length;
  const kpis = [
    { title: 'Velocidade de retomada', value: (slo.handoffP95Ms / 1000).toFixed(2) + 's', status: 'good', icon: 'gauge', trend: 'up', trendValue: 'p95 · alvo 3.00s', description: '' },
    { title: 'Ritmo de handoffs', value: slo.last24h + '/24h', status: 'neutral', icon: 'activity', trend: 'up', trendValue: '+12%', description: 'deploy freq.' },
    { title: 'Taxa de entrega', value: slo.successRate + '%', status: 'good', icon: 'check', trend: 'neutral', trendValue: '', description: 'sem DLQ' },
    { title: 'Pendentes (PEL)', value: HD.stream.pending, status: HD.stream.pending > 5 ? 'warning' : 'neutral', icon: 'cpu', description: 'consumer group' },
    { title: 'Dead Letter Queue', value: HD.dlq.length, status: HD.dlq.length > 0 ? 'critical' : 'good', icon: 'split', showPulse: HD.dlq.length > 0, description: 'aguardando replay' },
    { title: 'Breakers em alerta', value: openB, status: openB > 0 ? 'warning' : 'good', icon: 'shield', description: 'n8n-webhook half-open' },
  ];
  return (
    <div className="kpi-strip">
      {kpis.map((k, i) => (
        <KpiCard key={i} {...k} icon={<Icon name={k.icon} size={16} />} />
      ))}
    </div>
  );
}

function TraceWaterfall({ spans }) {
  const total = spans.reduce((m, s) => Math.max(m, s.t0 + s.dur), 1);
  return (
    <div className="trace">
      {spans.map((s, i) => (
        <div key={i} className="trace__row">
          <div className="trace__name">
            <span className="mono trace__span">{s.span}</span>
            <span className="trace__svc">{s.svc}</span>
          </div>
          <div className="trace__track">
            <span className={cls('trace__bar', s.ok ? 'ok' : 'fail')} style={{ left: (s.t0 / total * 100) + '%', width: Math.max(s.dur / total * 100, 1.5) + '%' }} />
          </div>
          <div className="trace__dur mono">{s.dur}ms</div>
        </div>
      ))}
      <div className="trace__foot mono">total {total}ms · correlation propagado ponta a ponta</div>
    </div>
  );
}

function Inspector({ handoff, onClose }) {
  const open = !!handoff;
  const h = handoff || {};
  const HD = window.HD;
  const spans = handoff ? HD.traceFor(h) : [];
  const [hermesAudits, setHermesAudits] = React.useState([]);

  React.useEffect(() => {
    if (h.correlation_id) {
      fetch('/ops/api/hermes?correlation_id=' + encodeURIComponent(h.correlation_id))
        .then(res => res.json())
        .then(data => setHermesAudits(Array.isArray(data) ? data : []))
        .catch(err => console.error('Erro ao buscar Hermes:', err));
    } else {
      setHermesAudits([]);
    }
  }, [h.correlation_id]);

  const meta = handoff ? [
    ['Task ID', <span className="mono" key="t">{h.task_id}</span>],
    ['Correlation', <span className="mono" key="c">{h.correlation_id}</span>],
    ['Projeto', <Badge key="p" variant="outline" mono>{h.project}</Badge>],
    ['Branch', <span className="mono" key="b">{h.branch || '?'}</span>],
    ['Status', <StatusPill key="s" code={h.lifecycle_status} />],
    ['Origem → Destino', (
      <span className="insp-route" key="r">
        <AgentTag id={h.sender} />
        <Icon name="arrowRight" size={13} />
        <AgentTag id={h.receiver} />
      </span>
    )],
    ['Tentativa', <span className="mono" key="a">{h.attempt}</span>],
    ['Atualizado', ago(h.updated_at) + ' atrás'],
  ] : [];

  return (
    <>
      <div className={cls('drawer-ov', open && 'open')} onClick={onClose} />
      <aside className={cls('drawer', open && 'open')}>
        {handoff && (
          <>
            <div className="drawer__head">
              <div className="drawer__title">
                <Icon name="gitCommit" size={16} /> Inspector de handoff
              </div>
              <button className="drawer__close" onClick={onClose}>
                <Icon name="x" size={16} />
              </button>
            </div>
            <div className="drawer__body">
              <div className="insp-sec">
                <h4>Contexto</h4>
                <div className="insp-grid">
                  {meta.map(([k, v], i) => (
                    <div key={i} className="insp-row">
                      <span className="insp-k">{k}</span>
                      <span className="insp-v">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="insp-sec">
                <h4>Ação pendente</h4>
                <div className="insp-action">{h.pending_action || '?'}</div>
              </div>
              {h.error && (
                <div className="insp-sec">
                  <h4>Motivo da falha</h4>
                  <div className="insp-error mono">{h.error}</div>
                </div>
              )}
              <div className="insp-sec">
                <h4>Trace distribuído · correlation_id</h4>
                <TraceWaterfall spans={spans} />
              </div>
              {hermesAudits.length > 0 && (
                <div className="insp-sec">
                  <h4>Auditoria Hermes</h4>
                  {hermesAudits.map((a, idx) => (
                    <Card key={idx} style={{ marginBottom: '8px', padding: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <Badge variant={a.severidade === 'high' ? 'destructive' : 'outline'}>{a.severidade}</Badge>
                        <span className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{ago(a.created_at) + ' atrás'}</span>
                      </div>
                      <p style={{ margin: '0 0 8px 0', fontSize: '13px' }}>{a.resumo}</p>
                      <div className="mono" style={{ fontSize: '12px', background: 'var(--bg-subtle)', padding: '8px', borderRadius: '4px' }}>
                        Nota: {a.nota}/10
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}

export const HDW = { Section, StatusPill, AgentTag, DataTable, TimelineChart, DistBars, Sparkline, KpiStrip, Inspector };
