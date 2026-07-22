import React from 'react';
import { Icon, HDLib } from '../icons.jsx';
import { HDW } from '../widgets.jsx';
import { StatusBadge, AlertsList } from './shared.jsx';

const DS = window.CommitBriefingDesignSystem_27542e;
const { Button } = DS;
const { cls } = HDLib;
const { Section } = HDW;

function GithubTokenSection() {
  const [status, setStatus] = React.useState(null);
  const [token, setToken] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const refresh = () => {
    fetch('/ops/api/settings/github-token')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus({ configured: false, source: 'none' }));
  };
  React.useEffect(() => { refresh(); }, []);

  const save = (e) => {
    e.preventDefault();
    if (!token.trim()) return;
    setSaving(true);
    fetch('/ops/api/settings/github-token', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.trim() })
    }).then(() => { setToken(''); setSaving(false); refresh(); })
      .catch(() => setSaving(false));
  };

  return (
    <Section icon="shield" title="GitHub PAT (global)" accent="var(--copper)"
      actions={status && (
        <StatusBadge status={status.configured ? 'good' : 'critical'}>
          {status.configured ? 'configurado (' + status.source + ')' : 'não configurado'}
        </StatusBadge>
      )}>
      <form onSubmit={save} style={{ display: 'flex', gap: 8, padding: 12 }}>
        <input
          className="cb-input" type="password" placeholder="ghp_... (novo token)"
          value={token} onChange={e => setToken(e.target.value)} style={{ flex: 1 }}
        />
        <Button size="sm" type="submit" disabled={saving || !token.trim()}>{saving ? 'Salvando...' : 'Salvar'}</Button>
      </form>
    </Section>
  );
}

function RedisTopology({ ha }) {
  return (
    <div className="redis">
      <div className="redis__node redis__master">
        <span className="redis__role">master</span>
        <span className="redis__name mono">{ha.master.host}</span>
        <span className="redis__dot up" />
      </div>
      <div className="redis__replicas">
        {(ha.replicas || []).map((rp, i) => (
          <div key={i} className="redis__node">
            <span className="redis__role">replica</span>
            <span className="redis__name mono">{rp.name}</span>
            <span className="redis__lag mono muted">lag {rp.lagBytes}b</span>
            <span className="redis__dot up" />
          </div>
        ))}
      </div>
      <div className="redis__sentinels">
        {(ha.sentinels || []).map((sn, i) => (
          <span key={i} className="redis__sentinel mono">
            <Icon name="radio" size={12} />{sn.name.replace('redis-', '')}
          </span>
        ))}
      </div>
    </div>
  );
}

export function InfraPanel() {
  const HD = window.HD, s = HD.system, d = HD.docker, r = HD.redisHA;
  const memPct = Math.round(s.memoryUsedMB / s.memoryTotalMB * 100);
  const sysItems = [
    ['Uptime', s.uptimeHours.toFixed(0) + 'h'],
    ['CPU', s.cpuUsage + '%', s.cpuUsage, 'cpu'],
    ['RAM', (s.memoryUsedMB / 1024).toFixed(1) + '/' + (s.memoryTotalMB / 1024).toFixed(0) + ' GB', memPct, 'mem'],
    ['Node', s.nodeVersion],
    ['Plataforma', s.platform],
  ];
  return (
    <div className="panel animate-fade-up">
      <GithubTokenSection />
      <Section icon="cpu" title="Sistema" bodyClass="sys-body">
        <div className="sysbar">
          {sysItems.map(([k, v, pct], i) => (
            <div key={i} className="sysbar__item">
              <span className="sysbar__k">{k}</span>
              <span className="sysbar__v mono">{v}</span>
              {pct !== undefined && (
                <span className="sysbar__track">
                  <span className={cls('sysbar__fill', pct > 80 ? 'tone-bg-critical' : pct > 60 ? 'tone-bg-warning' : 'tone-bg-good')} style={{ width: pct + '%' }} />
                </span>
              )}
            </div>
          ))}
        </div>
      </Section>
      <div className="grid-2">
        <Section icon="box" title="Containers Docker" count={d.totalRunning + '/' + d.containers.length}>
          <div className="docker">
            {(d.containers || []).map((c, i) => (
              <div key={i} className="docker__row">
                <span className={cls('docker__dot', c.status === 'running' ? 'up' : 'down')} />
                <span className="docker__name mono">{c.name}</span>
                <span className="docker__img">{c.image}</span>
                <span className="docker__up mono muted">{c.uptime}</span>
                <StatusBadge status={c.status === 'running' ? 'good' : 'critical'}>
                  {c.status === 'running' ? 'up' : 'down'}
                </StatusBadge>
              </div>
            ))}
          </div>
        </Section>
        <div className="col">
          <Section icon="radio" title="Redis HA · Sentinel" accent="var(--copper)"
            actions={(
              <StatusBadge status={r.status === 'ok' && r.quorum > 0 ? 'good' : 'critical'}>
                {r.status === 'ok' ? 'quorum ' + r.quorum : 'indisponível'}
              </StatusBadge>
            )}>
            <RedisTopology ha={r} />
          </Section>
          <Section icon="bell" title="Alertas operacionais" count={HD.alerts.length} accent="var(--toil)">
            <AlertsList alerts={HD.alerts} />
          </Section>
        </div>
      </div>
    </div>
  );
}
