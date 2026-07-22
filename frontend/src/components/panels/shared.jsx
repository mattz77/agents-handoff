import React from 'react';
import { Icon, HDLib } from '../icons.jsx';

const { cls } = HDLib;

export function StatusBadge({ status, children }) {
  const tone = status === 'good' ? 'good' : status === 'critical' ? 'critical' : status === 'info' ? 'info' : 'warning';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: `var(--${tone})` }}>
      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: `var(--${tone})`, boxShadow: `0 0 5px var(--${tone})` }} />
      {children}
    </span>
  );
}

export function fmtAgo(iso) {
  return HDLib.ago(iso) + ' atrás';
}

export function AlertsList({ alerts }) {
  const [expanded, setExpanded] = React.useState(false);
  const tone = { CRITICAL: 'critical', WARNING: 'warning', INFO: 'info' };
  const iconFor = { CRITICAL: 'xCircle', WARNING: 'alert', INFO: 'circleDot' };
  const groups = [];
  const byKey = new Map();
  for (const a of alerts || []) {
    const key = a.level + '|' + a.msg;
    const g = byKey.get(key);
    if (g) { g.count++; if (a.at > g.last) g.last = a.at; if (a.at < g.first) g.first = a.at; }
    else { const ng = { ...a, count: 1, last: a.at, first: a.at }; byKey.set(key, ng); groups.push(ng); }
  }
  groups.sort((x, y) => (y.last || '').localeCompare(x.last || ''));
  const ALERTS_CAP = 6;
  const visible = expanded ? groups : groups.slice(0, ALERTS_CAP);
  return (
    <div className="alerts">
      {visible.map((a, i) => (
        <div key={i} className="alert">
          <span className={cls('alert__icon', 'tone-' + tone[a.level])}>
            <Icon name={iconFor[a.level]} size={14} />
          </span>
          <div className="alert__body">
            <div className="alert__msg">
              {a.msg}
              {a.count > 1 && <span className="alert__count mono">×{a.count}</span>}
            </div>
            <div className="alert__meta mono">
              {a.level + ' · ' + (a.count > 1 ? 'último ' + fmtAgo(a.last) + ' · desde ' + fmtAgo(a.first) : fmtAgo(a.last))}
            </div>
          </div>
        </div>
      ))}
      {groups.length > ALERTS_CAP && (
        <button className="tbl-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Mostrar menos' : 'Mostrar mais ' + (groups.length - ALERTS_CAP) + ' alertas'}
        </button>
      )}
    </div>
  );
}
