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

  function HandoffFlow({ animated = true, live }) {
    if (!live) return null;
    const HD = window.HD;
    const sender = HDLib.agentOf(live.sender);
    const receiver = HDLib.agentOf(live.receiver);
    const pend = HD.stream.pending;
    const ob = (HD.outboxByStatus.PENDING || 0) + (HD.outboxByStatus.FAILED || 0);
    const breaker = (HD.breakers || []).find((b) => b.key === 'n8n-webhook') || { state: 'CLOSED' };
    const breakerTone = breaker.state === 'OPEN' ? 'crit' : breaker.state === 'HALF_OPEN' ? 'warn' : 'ok';

    const stages = [
      { icon: 'terminal', label: 'Wrapper', value: 'detect 429', tone: 'warn' },
      { icon: 'database', label: 'Stream', value: pend + ' PEL', tone: 'ok' },
      { icon: 'cpu', label: 'Consumer', value: 'g:ops', tone: 'ok' },
      { icon: 'inbox', label: 'Outbox', value: ob + ' represado', tone: ob > 0 ? 'warn' : 'ok' },
      { icon: 'zap', label: 'n8n', value: breaker.state.toLowerCase().replace('_', '-'), tone: breakerTone },
      { icon: 'bell', label: 'Notify', value: 'wpp / email', tone: 'ok' },
    ];

    return React.createElement(Card, { className: 'flow-card' },
      React.createElement('div', { className: 'flow-head' },
        React.createElement('div', { className: 'flow-head__title' },
          React.createElement('span', { className: 'live-dot' }),
          'Fluxo de handoff ao vivo',
        ),
        React.createElement('span', { className: 'flow-head__tag mono' },
          React.createElement(Icon, { name: 'swap', size: 13 }),
          'fallback / HTTP 429',
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

      // Ramo da DLQ
      React.createElement('div', { className: 'flow-dlq' },
        React.createElement('span', { className: 'flow-dlq__branch' }),
        React.createElement('span', { className: 'flow-dlq__chip' },
          React.createElement(Icon, { name: 'split', size: 14 }),
          'DLQ',
          React.createElement('b', { className: 'mono' }, HD.dlq.length),
        ),
        React.createElement('span', { className: 'flow-dlq__note' }, 'desvio em falha persistente / replay disponível'),
      ),

      // Rodapé: contadores ao vivo
      React.createElement('div', { className: 'flow-foot' },
        [
          { k: 'Ativos agora', v: '2', tone: 'info', icon: 'activity' },
          { k: 'Entregues 24h', v: '84', tone: 'ok', icon: 'check' },
          { k: 'Falhas 24h', v: '1', tone: 'crit', icon: 'xCircle' },
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
  function AgentSummary() {
    const HD = window.HD;
    const lines = [
      { t: '$', txt: 'briefing --scope ops --now', c: 'cmd' },
      { txt: 'Sistema dentro do SLO - p95 do handoff 2.41s (alvo 3s). Taxa de entrega 24h: 98.4%.' },
      { txt: '1 handoff ativo: Claude Code → Antigravity (fallback 429), retomando "timeout no drainOutbox".', hl: 'warn' },
      { txt: 'Atenção: breaker n8n-webhook em HALF_OPEN; 2 itens na DLQ aguardando replay (HMAC + veneno).', hl: 'crit' },
      { txt: 'Outbox: 1 linha FAILED represada há 38min - recomendado backoff agendado por linha.', hl: 'warn' },
      { txt: 'Próximo P0: assinar HMAC sobre raw body e remover sleep bloqueante do consumer.', hl: 'ok' },
    ];
    return React.createElement('div', { className: 'terminal-warm summary' },
      React.createElement('div', { className: 'summary__bar' },
        React.createElement('span', { className: 'summary__dots' },
          React.createElement('i', null), React.createElement('i', null), React.createElement('i', null)),
        React.createElement('span', { className: 'summary__title' },
          React.createElement(Icon, { name: 'brain', size: 13 }), 'Resumo do agente'),
        React.createElement('span', { className: 'summary__model mono' }, 'Gemini 2.5 Pro'),
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
