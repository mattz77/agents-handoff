import React from 'react';
import { Icon, HDLib } from '../icons.jsx';
import { HDW } from '../widgets.jsx';
import { AgentMark } from '../flow.jsx';
import { StatusBadge, fmtAgo } from './shared.jsx';

const DS = window.CommitBriefingDesignSystem_27542e;
const { Card, Badge } = DS;
const { agentOf, cls } = HDLib;
const { Section, AgentTag, DataTable } = HDW;

function DecisionTimeline({ decisions }) {
  return (
    <div className="decisions">
      {(decisions || []).map((d, i) => {
        const ag = agentOf(window.HD.normalizeAgentId?.(d.model) || d.model);
        return (
          <div key={i} className="decision">
            <span className="decision__rail">
              <span className="decision__dot" style={{ background: ag.accent }} />
            </span>
            <div className="decision__body">
              <div className="decision__title">{d.title}</div>
              <div className="decision__meta">
                <span className="decision__date mono">{d.date.split('-').reverse().join('/')}</span>
                <span className="decision__model mono" style={{ color: ag.accent, background: ag.tint }}>{ag.model}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function BrainPanel() {
  const b = window.HD.brain;
  const activeAgent = window.HD.normalizeAgentId?.(b.activeModel) || b.activeModel;
  const tone = { done: 'good', in_progress: 'info', pending: 'toil', blocked: 'critical' };
  const tlabel = { done: 'Concluída', in_progress: 'Em progresso', pending: 'Pendente', blocked: 'Bloqueada' };
  const prioRail = (p) => p === 'P0' || p === 'alta' ? 'critical' : p === 'P1' || p === 'média' ? 'warning' : 'neutral';
  const taskCols = [
    { label: 'Tarefa', render: (r) => (
      <span className="brain-task">
        <span className={cls('brain-task__rail', 'tone-bg-' + (prioRail(r.priority) === 'neutral' ? 'good' : prioRail(r.priority)))} />
        {r.title}
      </span>
    ) },
    { label: 'Status', render: (r) => <StatusBadge status={tone[r.status]}>{tlabel[r.status]}</StatusBadge> },
    { label: 'Responsável', render: (r) => <AgentTag id={window.HD.normalizeAgentId?.(r.assigned) || r.assigned} /> },
    { label: 'Prio', mono: true, align: 'right', render: (r) => <Badge variant={r.priority === 'P0' ? 'accent' : 'outline'} mono>{r.priority}</Badge> },
  ];

  const done = Number(b.completedTasks) || 0;
  const pend = Number(b.pendingTasks) || 0;
  const blocked = Number(b.blockedTasks) || 0;
  const total = done + pend + blocked || 1;
  const segs = [
    ['good', done, 'concluídas'],
    ['toil', pend, 'pendentes'],
    ['critical', blocked, 'bloqueadas'],
  ];

  return (
    <div className="panel animate-fade-up stagger">
      <div className="brain-hero">
        <Card className="brain-active brain-active--v2">
          <div className="brain-active__l">
            <AgentMark agent={agentOf(activeAgent)} size={48} active />
            <div style={{ minWidth: 0 }}>
              <div className="brain-active__eyebrow">Modelo ativo · cérebro compartilhado</div>
              <div className="brain-active__model">{b.activeModel}</div>
              <div className="brain-active__task">
                <span className="muted">Tarefa atual: </span>{b.currentTask}
              </div>
            </div>
          </div>
          <div className="brain-active__r">
            <StatusBadge status="good">infra {b.infraHealth}</StatusBadge>
            <span className="brain-active__sync mono">sync {fmtAgo(b.lastSync)}</span>
            <div className="brain-progress">
              <div className="brain-progress__bar">
                {segs.map(([t, n], i) => n > 0 && (
                  <span key={i} className={'tone-bg-' + t} style={{ width: (n / total * 100) + '%' }} />
                ))}
              </div>
              <div className="brain-progress__legend mono">
                {segs.map(([t, n, lbl], i) => (
                  <span key={i} className={'tone-' + t}>{n.toLocaleString('pt-BR')} {lbl}</span>
                ))}
              </div>
            </div>
          </div>
        </Card>
        <div className="brain-stats">
          {[['Pendentes', pend, 'toil', 'clock'], ['Concluídas', done.toLocaleString('pt-BR'), 'good', 'check'], ['Bloqueadas', blocked, 'critical', 'alert']].map(([k, v, t, icon], i) => (
            <Card key={i} className="brain-stat brain-stat--v2">
              <span className={cls('brain-stat__icon', 'tone-' + t)}><Icon name={icon} size={15} /></span>
              <span className="brain-stat__k">{k}</span>
              <span className={cls('brain-stat__v mono', 'tone-' + t)}>{v}</span>
            </Card>
          ))}
        </div>
      </div>
      <div className="grid-2">
        <Section icon="list" title="Fila de tarefas" count={b.taskList.length}
          actions={<span className="sub-note mono">task-queue.md</span>}>
          <DataTable cols={taskCols} rows={b.taskList} />
        </Section>
        <Section icon="gitCommit" title="Decisões recentes" count={b.recentDecisions.length}
          actions={<span className="sub-note mono">decisions.md</span>}>
          <DecisionTimeline decisions={b.recentDecisions} />
        </Section>
      </div>
    </div>
  );
}
