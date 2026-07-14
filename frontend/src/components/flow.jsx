import React from 'react';
import { Icon, HDLib } from './icons.jsx';
/* ============================================================
   Painel Handoff - Fluxo de Handoff ao vivo + Resumo do agente
   Exporta window.HandoffFlow, window.AgentSummary, window.AgentMark
   ============================================================ */

  const { Card } = window.CommitBriefingDesignSystem_27542e;
    const { cls } = HDLib;

  // Marca abstrata do agente (placeholder warm, sem brand real)
  function AgentMark({ agent, size = 36, active = false }) {
    const initials = agent.id === 'Claude_Code' ? 'CC' : agent.id === 'ZCode_Agent' ? 'ZC' : 'AG';
    return React.createElement('span', {
      className: 'agent-mark', style: {
        width: size, height: size, background: agent.tint,
        color: agent.accent, boxShadow: active ? `0 0 0 2px ${agent.accent}, 0 0 14px ${agent.accent}55` : `inset 0 0 0 1px ${agent.accent}44`,
      },
    }, React.createElement('span', { className: 'agent-mark__txt', style: { fontSize: size * 0.34 } }, initials));
  }

  function AgentStation({ agent, role, active }) {
    return React.createElement('div', { className: cls('flow-agent', active && 'flow-agent--active') },
      React.createElement(AgentMark, { agent, active }),
      React.createElement('div', { className: 'flow-agent__meta' },
        React.createElement('div', { className: 'flow-agent__name' }, agent.name),
        React.createElement('div', { className: 'flow-agent__model mono' }, agent.model),
      ),
      React.createElement('span', { className: 'flow-agent__role', style: { color: agent.accent, background: agent.tint } }, role),
    );
  }

  // Um estágio do pipeline
  function Stage({ icon, label, value, tone }) {
    return React.createElement('div', { className: 'flow-node' },
      React.createElement('span', { className: cls('flow-node__chip', tone && `tone-${tone}`) }, React.createElement(Icon, { name: icon, size: 17 })),
      React.createElement('div', { className: 'flow-node__label' }, label),
      React.createElement('div', { className: 'flow-node__val mono' }, value),
    );
  }

  function Connector({ index, animated, tone }) {
    return React.createElement('div', { className: cls('flow-connector', tone && `tone-${tone}`) },
      animated && React.createElement('span', { className: 'flow-packet', style: { animationDelay: (index * 0.55) + 's' } }),
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
    const isFailed = live.lifecycle_status === 'FAILED';

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

    return React.createElement(Card, { className: 'flow-card' },
      React.createElement('div', { className: 'flow-head' },
        React.createElement('div', { className: 'flow-head__title' },
          React.createElement('span', { className: 'live-dot' }),
          'Fluxo de handoff ao vivo',
        ),
        React.createElement('span', { className: 'flow-head__tag mono' },
          React.createElement(Icon, { name: 'swap', size: 13 }),
          (statusMeta.pt || statusMeta.label) + (isFallback ? ' / HTTP 429' : ''),
        ),
      ),

      // Agentes (origem → destino)
      React.createElement('div', { className: 'flow-agents' },
        React.createElement(AgentStation, { agent: sender, role: sender.role, active: true }),
        React.createElement('div', { className: 'flow-agents__arrow' },
          React.createElement(Icon, { name: 'arrowRight', size: 20 }),
          React.createElement('span', { className: 'flow-agents__handoff mono' }, 'handoff'),
        ),
        React.createElement(AgentStation, { agent: receiver, role: receiver.role, active: false }),
      ),

      // Rail do pipeline
      React.createElement('div', { className: 'flow-rail' },
        stages.map((s, i) => [
          React.createElement(Stage, { key: 'n' + i, ...s }),
          i < stages.length - 1 && React.createElement(Connector, { key: 'c' + i, index: i, animated, tone: 'ok' }),
        ]),
      ),

      // Ramo da DLQ — clicável, leva pra fila com detalhe/replay
      React.createElement('div', { className: 'flow-dlq' },
        React.createElement('span', { className: 'flow-dlq__branch' }),
        React.createElement('span', {
          className: 'flow-dlq__chip',
          style: onDlqClick ? { cursor: 'pointer' } : undefined,
          title: 'Ver fila e detalhes das falhas',
          onClick: onDlqClick,
        },
          React.createElement(Icon, { name: 'split', size: 14 }),
          'DLQ',
          React.createElement('b', { className: 'mono' }, HD.dlq.length),
        ),
        React.createElement('span', { className: 'flow-dlq__note' },
          HD.dlq.length
            ? ('última falha: ' + String(HD.dlq[0]?.reason || 'motivo desconhecido').slice(0, 60) + ' — clique pra inspecionar/replay')
            : 'nenhuma falha persistente — replay disponível quando houver'),
      ),

      // Rodapé: contadores ao vivo
      React.createElement('div', { className: 'flow-foot' },
        [
          { k: 'Ativos agora', v: String(activeCount), tone: 'info', icon: 'activity' },
          { k: 'Entregues 24h', v: String(done24h), tone: 'ok', icon: 'check' },
          { k: 'Falhas', v: String(failedCount), tone: failedCount ? 'crit' : 'ok', icon: 'xCircle' },
          { k: 'MTTR', v: HD.slo.mttrMin.toFixed(1) + 'min', tone: 'ok', icon: 'clock' },
        ].map((s, i) => React.createElement('div', { key: i, className: 'flow-foot__item' },
          React.createElement('span', { className: cls('flow-foot__icon', 'tone-' + s.tone) }, React.createElement(Icon, { name: s.icon, size: 13 })),
          React.createElement('div', { className: 'flow-foot__meta' },
            React.createElement('span', { className: 'flow-foot__v mono' }, s.v),
            React.createElement('span', { className: 'flow-foot__k' }, s.k)))),
      ),
    );
  }

  // ---- Resumo executivo do agente (terminal-warm) ----
  // Gera briefing a partir do estado real (window.HD) — nada hardcoded.
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
    return React.createElement('div', { className: 'terminal-warm summary' },
      React.createElement('div', { className: 'summary__bar' },
        React.createElement('span', { className: 'summary__dots' },
          React.createElement('i', null), React.createElement('i', null), React.createElement('i', null)),
        React.createElement('span', { className: 'summary__title' },
          React.createElement(Icon, { name: 'brain', size: 13 }), 'Resumo do agente'),
        React.createElement('span', { className: 'summary__model mono' }, model),
      ),
      React.createElement('div', { className: 'summary__body' },
        lines.map((l, i) => React.createElement('div', { key: i, className: cls('summary__line', l.c === 'cmd' && 'summary__line--cmd', l.hl && `hl-${l.hl}`) },
          l.t && React.createElement('span', { className: 'summary__prompt' }, l.t),
          React.createElement('span', null, l.txt),
        )),
        React.createElement('div', { className: 'summary__line' },
          React.createElement('span', { className: 'summary__prompt' }, '$'),
          React.createElement('span', { className: 'cursor-blink summary__cursor' }, '▍'),
        ),
      ),
    );
  }

export { HandoffFlow, AgentSummary, AgentMark };
