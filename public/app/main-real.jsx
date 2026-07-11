/* ============================================================
   Painel Handoff — app principal (shell + estado + tweaks)
   ============================================================ */
(function () {
  const DS = window.CommitBriefingDesignSystem_27542e;
  const { Button, StatusBadge, Avatar } = DS;
  const Icon = window.Icon;
  const { cls } = window.HDLib;
  const { OverviewPanel, HandoffsPanel, BrainPanel, InfraPanel, DataLakePanel } = window.HDP;
  const { Inspector } = window.HDW;
  const { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakColor } = window;

  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "theme": "light",
    "density": "regular",
    "accent": "#c4956a",
    "flowAnimated": true,
    "serifSummary": false
  }/*EDITMODE-END*/;

  const NAV_IDS = ['overview', 'handoffs', 'brain', 'datalake', 'infra'];
  const NAV = [
    { id: 'overview', label: 'Visão geral', icon: 'gauge' },
    { id: 'handoffs', label: 'Handoffs', icon: 'swap' },
    { id: 'brain', label: 'LLM Brain', icon: 'brain' },
    { id: 'datalake', label: 'DataLake', icon: 'cloud' },
    { id: 'infra', label: 'Infra', icon: 'server' },
  ];

  function LogoMark() {
    // Marca Handoff — dois arcos (agentes) passando um "baton" de contexto.
    return React.createElement('span', { className: 'logo' },
      React.createElement('svg', { className: 'logo__mark', width: 27, height: 27, viewBox: '0 0 28 28', fill: 'none' },
        React.createElement('path', { d: 'M8 6.2A8.2 8.2 0 0 0 8 21.8', stroke: 'var(--copper)', strokeWidth: 2, strokeLinecap: 'round', opacity: 0.5 }),
        React.createElement('path', { d: 'M20 6.2A8.2 8.2 0 0 1 20 21.8', stroke: 'var(--copper)', strokeWidth: 2, strokeLinecap: 'round', opacity: 0.5 }),
        React.createElement('rect', { x: 10.6, y: 8.4, width: 6.8, height: 11.2, rx: 3.4, fill: 'var(--copper)', transform: 'rotate(38 14 14)' }),
        React.createElement('circle', { cx: 14, cy: 14, r: 1.7, fill: 'var(--sidebar)' })),
      React.createElement('span', { className: 'logo__wm' }, 'Handoff', React.createElement('b', null, 'Daemon')));
  }

  function Sidebar({ tab, setTab, counts }) {
    return React.createElement('aside', { className: 'sidebar' },
      React.createElement('div', { className: 'sidebar__brand' }, React.createElement(LogoMark, null)),
      React.createElement('div', { className: 'sidebar__org' },
        React.createElement('span', { className: 'sidebar__org-dot' }), 'nicebyte · ops'),
      React.createElement('nav', { className: 'sidebar__nav' },
        NAV.map((n, i) => React.createElement('button', {
          key: n.id, className: cls('navitem', tab === n.id && 'navitem--active'),
          onClick: () => setTab(n.id),
          title: 'Atalho: ' + (i + 1),
        }, React.createElement(Icon, { name: n.icon, size: 17 }), React.createElement('span', null, n.label),
          counts[n.id] > 0 && React.createElement('span', { className: 'navitem__badge' }, counts[n.id] > 99 ? '99+' : counts[n.id]),
          tab === n.id && React.createElement('span', { className: 'navitem__rail' })))),
      React.createElement('div', { className: 'sidebar__foot' },
        React.createElement('div', { className: 'sidebar__env' },
          React.createElement('span', { className: 'sidebar__env-dot' }),
          React.createElement('span', null, 'ops.nicebyte.ia.br'),
          React.createElement('span', { className: 'sidebar__env-cf mono' }, 'CF Access')),
        React.createElement('div', { className: 'sidebar__user' },
          React.createElement('span', { className: 'sidebar__avatar mono' }, 'MO'),
          React.createElement('div', { className: 'sidebar__user-meta' },
            React.createElement('span', { className: 'sidebar__user-name' }, 'mattz77.mo'),
            React.createElement('span', { className: 'sidebar__user-mail mono' }, 'OTP · verificado')),
          React.createElement('button', { className: 'sidebar__logout', title: 'Sair' }, React.createElement(Icon, { name: 'logout', size: 15 })))),
    );
  }

  function Header({ tab, onRefresh, updated, interval, setInterval_ }) {
    const titles = { overview: 'Visão geral', handoffs: 'Handoffs & filas', brain: 'LLM Brain', datalake: 'DataLake', infra: 'Infraestrutura' };
    const subs = {
      overview: 'Orquestração de handoff entre agentes — em tempo real',
      handoffs: 'Auditoria, dead-letter queue, outbox e circuit breakers',
      brain: 'Modelo ativo, decisões e fila de tarefas',
      datalake: 'Google Drive 5\u00a0TB · memória de longo prazo do LLM-Brain',
      infra: 'Containers, Redis HA e saúde do sistema',
    };
    return React.createElement('header', { className: 'topbar' },
      React.createElement('div', { className: 'topbar__l' },
        React.createElement('div', { className: 'topbar__crumb mono' }, 'painel', React.createElement(Icon, { name: 'chevronRight', size: 13 }), titles[tab].toLowerCase()),
        React.createElement('h1', { className: 'topbar__title' }, titles[tab]),
        React.createElement('p', { className: 'topbar__sub' }, subs[tab])),
      React.createElement('div', { className: 'topbar__r' },
        React.createElement('div', { className: 'live' },
          React.createElement('span', { className: 'live-dot' }),
          React.createElement('span', { className: 'live__txt' }, 'ao vivo'),
          React.createElement('span', { className: 'live__time mono' }, updated)),
        React.createElement('div', { className: 'seg' },
          ['Manual', '5s', '15s'].map((o, i) => React.createElement('button', {
            key: o, className: cls('seg__btn', interval === i && 'seg__btn--on'), onClick: () => setInterval_(i),
          }, o))),
        React.createElement(Button, { variant: 'outline', size: 'sm', onClick: onRefresh },
          React.createElement(Icon, { name: 'refresh', size: 14 }), 'Atualizar')),
    );
  }

  function Toast({ toast }) {
    if (!toast) return null;
    return React.createElement('div', { className: cls('toast', 'toast--' + (toast.kind || 'info'), 'show') },
      React.createElement(Icon, { name: toast.kind === 'ok' ? 'check' : toast.kind === 'bad' ? 'xCircle' : 'circleDot', size: 15 }),
      toast.msg);
  }

  function App() {
    const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
    const [tab, setTab] = React.useState('overview');
    const [filter, setFilter] = React.useState(null);
    const [inspect, setInspect] = React.useState(null);
    const [dlq, setDlq] = React.useState(() => window.HD.dlq.slice());
    const [toast, setToast] = React.useState(null);
    const [updated, setUpdated] = React.useState(() => new Date().toLocaleTimeString('pt-BR'));
    const [interval_, setInterval_] = React.useState(1);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    const showToast = React.useCallback((msg, kind) => {
      setToast({ msg, kind });
      clearTimeout(showToast._t);
      showToast._t = setTimeout(() => setToast(null), 3200);
    }, []);

    const refresh = React.useCallback(() => {
      if (window.HD_fetchAll) window.HD_fetchAll();
      setUpdated(new Date().toLocaleTimeString('pt-BR'));
      showToast('Atualizando métricas...', 'info');
    }, [showToast]);

    React.useEffect(() => {
      window.HDReload = () => {
        setUpdated(new Date().toLocaleTimeString('pt-BR'));
        setDlq(window.HD.dlq.slice());
        forceUpdate();
      };
      return () => { window.HDReload = null; };
    }, []);

    React.useEffect(() => {
      const intervals = [0, 5000, 15000];
      const ms = intervals[interval_];
      if (!ms) return;
      const id = setInterval(() => { if (window.HD_fetchAll) window.HD_fetchAll(); }, ms);
      return () => clearInterval(id);
    }, [interval_]);

    // Keyboard shortcuts: 1-5 nav, R refresh, Escape close inspector
    React.useEffect(() => {
      const handler = (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey) return;
        if (e.key >= '1' && e.key <= '5') { setTab(NAV_IDS[Number(e.key) - 1]); return; }
        if (e.key === 'r' || e.key === 'R') { refresh(); return; }
        if (e.key === 'Escape') setInspect(null);
      };
      document.addEventListener('keydown', handler);
      return () => document.removeEventListener('keydown', handler);
    }, [refresh]);

    const onReplay = React.useCallback(async (item) => {
      try {
        const res = await fetch('/ops/api/dlq/replay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id }),
        });
        const data = await res.json();
        if (data.ok) {
          setDlq((cur) => cur.filter((d) => d.id !== item.id));
          showToast('Replay OK · stream ' + item.id.split('-')[0], 'ok');
        } else {
          showToast('Replay falhou: ' + (data.error || 'erro desconhecido'), 'bad');
        }
      } catch (e) {
        showToast('Replay error: ' + e.message, 'bad');
      }
    }, [showToast]);

    const pickStatus = React.useCallback((status, goTab) => {
      setFilter(status);
      if (goTab) setTab(goTab);
    }, []);

    // Sidebar live counts
    const hd = window.HD;
    const counts = {
      overview: hd.alerts.filter(a => a.level === 'CRITICAL').length,
      handoffs: hd.dlq.length,
      brain: hd.brain?.pendingTasks || 0,
      datalake: 0,
      infra: 0,
    };

    // Tema / densidade / acento aplicados no root do app
    React.useEffect(() => {
      const root = document.getElementById('app-root');
      root.classList.toggle('dark', t.theme === 'dark');
      root.setAttribute('data-density', t.density);
      root.style.setProperty('--brand-accent', t.accent);
      root.style.setProperty('--copper', t.accent);
    }, [t.theme, t.density, t.accent]);

    const panel = tab === 'overview'
      ? React.createElement(OverviewPanel, { onInspect: setInspect, animatedFlow: t.flowAnimated, onPickStatus: pickStatus })
      : tab === 'handoffs'
        ? React.createElement(HandoffsPanel, { onInspect: setInspect, filter, setFilter, dlq, onReplay })
        : tab === 'brain' ? React.createElement(BrainPanel, null)
          : tab === 'datalake' ? React.createElement(DataLakePanel, null)
            : React.createElement(InfraPanel, null);

    return React.createElement('div', { className: cls('shell', t.serifSummary && 'serif-summary') },
      React.createElement(Sidebar, { tab, setTab, counts }),
      React.createElement('main', { className: 'main' },
        React.createElement(Header, { tab, onRefresh: refresh, updated, interval: interval_, setInterval_ }),
        React.createElement('div', { className: 'content' }, panel),
      ),
      React.createElement(Inspector, { handoff: inspect, onClose: () => setInspect(null) }),
      React.createElement(Toast, { toast }),
      React.createElement(TweaksPanel, null,
        React.createElement(TweakSection, { label: 'Aparência' }),
        React.createElement(TweakRadio, { label: 'Tema', value: t.theme, options: ['light', 'dark'], onChange: (v) => setTweak('theme', v) }),
        React.createElement(TweakRadio, { label: 'Densidade', value: t.density, options: ['compact', 'regular', 'comfy'], onChange: (v) => setTweak('density', v) }),
        React.createElement(TweakColor, { label: 'Acento', value: t.accent, options: ['#c4956a', '#a67c52', '#8d6e4c', '#b54a35'], onChange: (v) => setTweak('accent', v) }),
        React.createElement(TweakSection, { label: 'Fluxo & resumo' }),
        React.createElement(TweakToggle, { label: 'Animar fluxo de handoff', value: t.flowAnimated, onChange: (v) => setTweak('flowAnimated', v) }),
        React.createElement(TweakToggle, { label: 'Resumo em serifa (Lora)', value: t.serifSummary, onChange: (v) => setTweak('serifSummary', v) }),
      ),
    );
  }

  ReactDOM.createRoot(document.getElementById('app-root')).render(React.createElement(App));
})();
