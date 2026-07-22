import React from 'react';
import { Icon, HDLib } from './icons.jsx';

const { Card } = window.CommitBriefingDesignSystem_27542e;
const { cls } = HDLib;

function AgentMark({ agent, size = 36, active = false }) {
  const initials = agent.id === 'Claude_Code' ? 'CC' : agent.id === 'ZCode_Agent' ? 'ZC' : 'AG';
  return (
    <span
      className="agent-mark"
      style={{
        width: size, height: size, background: agent.tint,
        color: agent.accent,
        boxShadow: active ? `0 0 0 2px ${agent.accent}, 0 0 14px ${agent.accent}55` : `inset 0 0 0 1px ${agent.accent}44`,
      }}
    >
      <span className="agent-mark__txt" style={{ fontSize: size * 0.34 }}>{initials}</span>
    </span>
  );
}

function AgentStation({ agent, role, active }) {
  return (
    <div className={cls('flow-agent', active && 'flow-agent--active')}>
      <AgentMark agent={agent} active={active} />
      <div className="flow-agent__meta">
        <div className="flow-agent__name">{agent.name}</div>
        <div className="flow-agent__model mono">{agent.model}</div>
      </div>
      <span className="flow-agent__role" style={{ color: agent.accent, background: agent.tint }}>{role}</span>
    </div>
  );
}

function Stage({ icon, label, value, tone }) {
  return (
    <div className="flow-node">
      <span className={cls('flow-node__chip', tone && `tone-${tone}`)}>
        <Icon name={icon} size={17} />
      </span>
      <div className="flow-node__label">{label}</div>
      <div className="flow-node__val mono">{value}</div>
    </div>
  );
}

function Connector({ index, animated, tone }) {
  return (
    <div className={cls('flow-connector', tone && `tone-${tone}`)}>
      {animated && <span className="flow-packet" style={{ animationDelay: (index * 0.55) + 's' }} />}
    </div>
  );
}

function HandoffFlow({ animated = true, live, onDlqClick }) {
  if (!live) return null;
  const HD = window.HD;
  const sender = HDLib.agentOf(live.sender);
  const receiver = HDLib.agentOf(live.receiver);
  const pend = HD.stream.pending;
  const obPending = HD.outboxByStatus.PENDING || 0;
  const obFailed = HD.outboxByStatus.FAILED || 0;
  const ob = obPending + obFailed;
  const breaker = (HD.breakers || []).find((b) => b.key === 'n8n-webhook') || { state: 'CLOSED' };
  const breakerTone = breaker.state === 'OPEN' ? 'crit' : breaker.state === 'HALF_OPEN' ? 'warn' : 'ok';

  const statusMeta = HD.STATUS[live.lifecycle_status] || { label: live.lifecycle_status, pt: live.lifecycle_status };
  const isFallback = live.lifecycle_status === 'FALLBACK_TRIGGERED';

  const stages = [
    { icon: 'terminal', label: 'Wrapper', value: isFallback ? 'detect 429' : 'monitor', tone: isFallback ? 'warn' : 'ok' },
    { icon: 'database', label: 'Stream', value: pend + ' PEL', tone: pend > 0 ? 'warn' : 'ok' },
    { icon: 'cpu', label: 'Consumer', value: 'g:ops', tone: 'ok' },
    { icon: 'inbox', label: 'Outbox', value: ob > 0 ? ob + ' represado' : 'drenado', tone: obFailed > 0 ? 'crit' : ob > 0 ? 'warn' : 'ok' },
    { icon: 'zap', label: 'n8n', value: breaker.state.toLowerCase().replace('_', '-'), tone: breakerTone },
    { icon: 'bell', label: 'Notify', value: 'wpp / email', tone: 'ok' },
  ];

  const activeCount = (HD.handoffs || []).filter((h) => h.live).length;
  const done24h = HD.slo.last24h || 0;
  const failedCount = (HD.handoffsByStatus || {}).FAILED || 0;

  return (
    <Card className="flow-card">
      <div className="flow-head">
        <div className="flow-head__title">
          <span className="live-dot" />
          Fluxo de handoff ao vivo
        </div>
        <span className="flow-head__tag mono">
          <Icon name="swap" size={13} />
          {(statusMeta.pt || statusMeta.label) + (isFallback ? ' / HTTP 429' : '')}
        </span>
      </div>

      <div className="flow-agents">
        <AgentStation agent={sender} role={sender.role} active />
        <div className="flow-agents__arrow">
          <Icon name="arrowRight" size={20} />
          <span className="flow-agents__handoff mono">handoff</span>
        </div>
        <AgentStation agent={receiver} role={receiver.role} active={false} />
      </div>

      <div className="flow-rail">
        {stages.map((s, i) => (
          <React.Fragment key={'s' + i}>
            <Stage {...s} />
            {i < stages.length - 1 && <Connector index={i} animated={animated} tone="ok" />}
          </React.Fragment>
        ))}
      </div>

      <div className="flow-dlq">
        <span className="flow-dlq__branch" />
        <span
          className="flow-dlq__chip"
          style={onDlqClick ? { cursor: 'pointer' } : undefined}
          title="Ver fila e detalhes das falhas"
          onClick={onDlqClick}
        >
          <Icon name="split" size={14} />
          DLQ
          <b className="mono">{HD.dlq.length}</b>
        </span>
        <span className="flow-dlq__note">
          {HD.dlq.length
            ? ('última falha: ' + String(HD.dlq[0]?.reason || 'motivo desconhecido').slice(0, 60) + ' — clique pra inspecionar/replay')
            : 'nenhuma falha persistente — replay disponível quando houver'}
        </span>
      </div>

      <div className="flow-foot">
        {[
          { k: 'Ativos agora', v: String(activeCount), tone: 'info', icon: 'activity' },
          { k: 'Entregues 24h', v: String(done24h), tone: 'ok', icon: 'check' },
          { k: 'Falhas', v: String(failedCount), tone: failedCount ? 'crit' : 'ok', icon: 'xCircle' },
          { k: 'MTTR', v: HD.slo.mttrMin.toFixed(1) + 'min', tone: 'ok', icon: 'clock' },
        ].map((s, i) => (
          <div key={i} className="flow-foot__item">
            <span className={cls('flow-foot__icon', 'tone-' + s.tone)}>
              <Icon name={s.icon} size={13} />
            </span>
            <div className="flow-foot__meta">
              <span className="flow-foot__v mono">{s.v}</span>
              <span className="flow-foot__k">{s.k}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function buildSummaryLines(HD) {
  const lines = [{ t: '$', txt: 'briefing --scope ops --now', c: 'cmd' }];

  const slo = HD.slo || {};
  const p95 = (slo.handoffP95Ms || 0) / 1000;
  const inSlo = (slo.handoffP95Ms || 0) <= (slo.target || 3000);
  lines.push({
    txt: `Sistema ${inSlo ? 'dentro' : 'FORA'} do SLO - p95 do handoff ${p95.toFixed(2)}s (alvo ${((slo.target || 3000) / 1000).toFixed(0)}s). Taxa de entrega 24h: ${slo.successRate != null ? slo.successRate + '%' : 'n/d'}.`,
    hl: inSlo ? undefined : 'crit',
  });

  const actives = (HD.handoffs || []).filter((h) => h.live);
  if (actives.length) {
    const h = actives[0];
    const s = HDLib.agentOf(h.sender), r = HDLib.agentOf(h.receiver);
    const st = (HD.STATUS[h.lifecycle_status] || {}).pt || h.lifecycle_status;
    lines.push({ txt: `${actives.length} handoff${actives.length > 1 ? 's' : ''} ativo${actives.length > 1 ? 's' : ''}: ${s.name} → ${r.name} (${st}) — projeto ${h.project || '?'}.`, hl: 'warn' });
  } else {
    lines.push({ txt: 'Nenhum handoff ativo no momento.' });
  }

  const badBreakers = (HD.breakers || []).filter((b) => b.state !== 'CLOSED');
  const dlqN = (HD.dlq || []).length;
  if (badBreakers.length || dlqN) {
    const parts = [];
    if (badBreakers.length) parts.push('breaker ' + badBreakers.map((b) => `${b.key} em ${b.state}`).join(', '));
    if (dlqN) parts.push(`${dlqN} ite${dlqN > 1 ? 'ns' : 'm'} na DLQ aguardando replay` + (HD.dlq[0]?.reason ? ` (${String(HD.dlq[0].reason).slice(0, 50)})` : ''));
    lines.push({ txt: 'Atenção: ' + parts.join('; ') + '.', hl: 'crit' });
  }

  const obFailed = (HD.outboxByStatus || {}).FAILED || 0;
  const obPending = (HD.outboxByStatus || {}).PENDING || 0;
  if (obFailed || obPending) {
    lines.push({ txt: `Outbox: ${obFailed ? obFailed + ' FAILED' : ''}${obFailed && obPending ? ' + ' : ''}${obPending ? obPending + ' PENDING' : ''} represado${obFailed + obPending > 1 ? 's' : ''} — replay/backoff via aba Handoffs.`, hl: obFailed ? 'crit' : 'warn' });
  } else {
    lines.push({ txt: 'Outbox drenado - nenhuma entrega represada.', hl: 'ok' });
  }

  const tasks = (HD.brain?.taskList || []).filter((t) => t.status === 'pending' || t.status === 'in_progress');
  if (tasks.length) {
    lines.push({ txt: `LLM-Brain: ${tasks.length} task${tasks.length > 1 ? 's' : ''} pendente${tasks.length > 1 ? 's' : ''} — próxima: "${String(tasks[0].title).slice(0, 60)}" (${tasks[0].assigned}).`, hl: 'warn' });
  }

  const critReview = (() => {
    const latest = new Map();
    for (const r of HD.codereview?.reports || []) if (!latest.has(r.project_slug)) latest.set(r.project_slug, r);
    let n = 0;
    for (const r of latest.values()) n += (r.issues || []).filter((i) => i.severity === 'critical').length;
    return n;
  })();
  if (critReview) lines.push({ txt: `Daemon-CodeReview: ${critReview} issue${critReview > 1 ? 's' : ''} crítica${critReview > 1 ? 's' : ''} em aberto no último review.`, hl: 'crit' });

  return lines;
}

function AgentSummary() {
  const HD = window.HD;
  const lines = buildSummaryLines(HD);
  const model = HD.brain?.activeModel && HD.brain.activeModel !== 'Desconhecido'
    ? HD.brain.activeModel : 'daemon';
  return (
    <div className="terminal-warm summary">
      <div className="summary__bar">
        <span className="summary__dots"><i /><i /><i /></span>
        <span className="summary__title">
          <Icon name="brain" size={13} /> Resumo do agente
        </span>
        <span className="summary__model mono">{model}</span>
      </div>
      <div className="summary__body">
        {lines.map((l, i) => (
          <div key={i} className={cls('summary__line', l.c === 'cmd' && 'summary__line--cmd', l.hl && `hl-${l.hl}`)}>
            {l.t && <span className="summary__prompt">{l.t}</span>}
            <span>{l.txt}</span>
          </div>
        ))}
        <div className="summary__line">
          <span className="summary__prompt">$</span>
          <span className="cursor-blink summary__cursor">█</span>
        </div>
      </div>
    </div>
  );
}

export { HandoffFlow, AgentSummary, AgentMark };
