import React from 'react';
import { Icon, HDLib } from './components/icons.jsx';
import { HDP } from './components/panels.jsx';
import { HDW } from './components/widgets.jsx';
import { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakColor } from './components/tweaks-panel.jsx';

const DS = window.CommitBriefingDesignSystem_27542e;
const { Button, Avatar } = DS;
const { cls } = HDLib;
const { OverviewPanel, HandoffsPanel, BrainPanel, InfraPanel, DataLakePanel, CodeReviewPanel, ProjectsPanel } = HDP;
const { Inspector } = HDW;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "density": "compact",
  "accent": "#3b82f6",
  "flowAnimated": true,
  "serifSummary": false
}/*EDITMODE-END*/;

const NAV = [
  { id: 'overview', label: 'Visão geral', icon: 'gauge' },
  { id: 'handoffs', label: 'Handoffs', icon: 'swap' },
  { id: 'brain', label: 'LLM Brain', icon: 'brain' },
  { id: 'datalake', label: 'DataLake', icon: 'cloud' },
  { id: 'codereview', label: 'Code Review', icon: 'shield' },
  { id: 'projects', label: 'Projetos', icon: 'folder' },
  { id: 'infra', label: 'Infra', icon: 'server' },
];

function LogoMark() {
  return React.createElement('span', { className: 'logo' },
    React.createElement('svg', { className: 'logo__mark', width: 27, height: 27, viewBox: '0 0 28 28', fill: 'none' },
      React.createElement('path', { d: 'M8 6.2A8.2 8.2 0 0 0 8 21.8', stroke: 'var(--copper)', strokeWidth: 2, strokeLinecap: 'round', opacity: 0.5 }),
      React.createElement('path', { d: 'M20 6.2A8.2 8.2 0 0 1 20 21.8', stroke: 'var(--copper)', strokeWidth: 2, strokeLinecap: 'round', opacity: 0.5 }),
      React.createElement('rect', { x: 10.6, y: 8.4, width: 6.8, height: 11.2, rx: 3.4, fill: 'var(--copper)', transform: 'rotate(38 14 14)' }),
      React.createElement('circle', { cx: 14, cy: 14, r: 1.7, fill: 'var(--sidebar)' })),
    React.createElement('span', { className: 'logo__wm' }, 'Handoff', React.createElement('b', null, 'Daemon')));
}

function Sidebar({ tab, setTab, open, onClose }) {
  return React.createElement('aside', { className: cls('sidebar', open && 'open') },
    React.createElement('button', { className: 'sidebar__close-btn', onClick: onClose, 'aria-label': 'Fechar menu' },
      React.createElement(Icon, { name: 'x', size: 18 })),
    React.createElement('div', { className: 'sidebar__brand' }, React.createElement(LogoMark, null)),

    React.createElement('div', { className: 'sidebar__org' },
      React.createElement('span', { className: 'sidebar__org-dot' }), 'nicebyte ops'),
    React.createElement('nav', { className: 'sidebar__nav' },
      NAV.map((n) => React.createElement('button', {
        key: n.id, className: cls('navitem', tab === n.id && 'navitem--active'),
        onClick: () => setTab(n.id),
      }, React.createElement(Icon, { name: n.icon, size: 17 }), React.createElement('span', null, n.label),
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
          React.createElement('span', { className: 'sidebar__user-mail mono' }, 'OTP verificado')),
        React.createElement('button', { className: 'sidebar__logout', title: 'Sair' }, React.createElement(Icon, { name: 'logout', size: 15 })))),
  );
}

function Header({ tab, onRefresh, updated, interval, setInterval_, onSearchToggle }) {
  const titles = { overview: 'Visão geral', handoffs: 'Handoffs & filas', brain: 'LLM Brain', datalake: 'DataLake', codereview: 'Code Review', projects: 'Projetos', infra: 'Infraestrutura' };
  const subs = {
    overview: 'Orquestração de handoff entre agentes (em tempo real)',
    handoffs: 'Auditoria, dead-letter queue, outbox e circuit breakers',
    brain: 'Modelo ativo, decisões e fila de tarefas',
    datalake: 'Google Drive 5\u00a0TB (memória de longo prazo)',
    codereview: 'Revisão diária, riscos mitigados e integridade',
    projects: 'Gerenciamento de repositórios e projetos ativos',
    infra: 'Containers, Redis HA e saúde do sistema',
  };
  return React.createElement('header', { className: 'topbar' },
    React.createElement('div', { className: 'topbar__l' },
      React.createElement('div', { className: 'topbar__crumb mono' }, 'painel', React.createElement(Icon, { name: 'chevronRight', size: 13 }), titles[tab].toLowerCase()),
      React.createElement('h1', { className: 'topbar__title' }, titles[tab]),
      React.createElement('p', { className: 'topbar__sub' }, subs[tab])),
    React.createElement('div', { className: 'topbar__r' },
      React.createElement(Button, { variant: 'outline', size: 'sm', onClick: onSearchToggle, style: { marginRight: '8px' } },
        React.createElement(Icon, { name: 'search', size: 14 }), React.createElement('span', { className: 'btn-search-txt' }, ' Busca Semântica')),
      React.createElement('div', { className: 'seg' },
        ['Manual', '5s', '15s'].map((o, i) => React.createElement('button', {
          key: o, className: cls('seg__btn', interval === i && 'seg__btn--on'), onClick: () => setInterval_(i),
        }, o))),
      React.createElement(Button, { variant: 'outline', size: 'sm', onClick: onRefresh },
        React.createElement(Icon, { name: 'refresh', size: 14 }), React.createElement('span', { className: 'btn-search-txt' }, 'Atualizar'))),
  );
}

function BottomNav({ tab, setTab }) {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const mainTabs = NAV.slice(0, 4);
  const moreTabs = NAV.slice(4);

  const onTabSelect = (id) => {
    setTab(id);
    setMoreOpen(false);
  };

  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: cls('more-menu-ov', moreOpen && 'open'), onClick: () => setMoreOpen(false) }),
    React.createElement('div', { className: cls('more-menu', moreOpen && 'open') },
      moreTabs.map(n => React.createElement('button', {
        key: n.id,
        className: cls('more-menu__item', tab === n.id && 'active'),
        onClick: () => onTabSelect(n.id)
      }, React.createElement(Icon, { name: n.icon, size: 16 }), n.label))
    ),
    React.createElement('nav', { className: 'bottom-nav' },
      mainTabs.map(n => React.createElement('button', {
        key: n.id,
        className: cls('bottom-nav__item', tab === n.id && 'active'),
        onClick: () => onTabSelect(n.id)
      }, React.createElement(Icon, { name: n.icon, size: 18 }), n.label)),
      React.createElement('button', {
        className: cls('bottom-nav__item', moreTabs.some(n => n.id === tab) && 'active'),
        onClick: () => setMoreOpen(!moreOpen)
      }, React.createElement(Icon, { name: 'menu', size: 18 }), 'Mais')
    )
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
  const [hdReady, setHdReady] = React.useState(() => !!window.HD?.handoffs);

  // Poll until data-real.js populates window.HD (Vite puts bundle in <head>, before body scripts)
  React.useEffect(() => {
    if (hdReady) return;
    const id = setInterval(() => {
      if (window.HD?.handoffs) { setHdReady(true); clearInterval(id); }
    }, 100);
    return () => clearInterval(id);
  }, [hdReady]);
  const [tab, setTab] = React.useState('overview');
  const [filter, setFilter] = React.useState(null);
  const [inspect, setInspect] = React.useState(null);
  const [dlq, setDlq] = React.useState(() => window.HD?.dlq?.slice() || []);
  const [toast, setToast] = React.useState(null);
  const [updated, setUpdated] = React.useState(() => new Date().toLocaleTimeString('pt-BR'));
  const [interval_, setInterval_] = React.useState(1);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState(null);

  const performSearch = (e) => {
    e.preventDefault();
    setSearchResults('loading');
    fetch('/ops/api/brain/search?q=' + encodeURIComponent(searchQuery))
      .then(r => r.json())
      .then(d => setSearchResults(d.results || []))
      .catch(err => { console.error(err); setSearchResults([]); });
  };
  const showToast = (msg, kind) => { setToast({ msg, kind }); clearTimeout(showToast._t); showToast._t = setTimeout(() => setToast(null), 3200); };

  const refresh = () => {
    setUpdated(new Date().toLocaleTimeString('pt-BR'));
    setDlq(window.HD?.dlq?.slice() || []);
    showToast('Métricas atualizadas', 'ok');
  };

  React.useEffect(() => {
    // Setup global reload function for data-real.js to call
    window.HDReload = refresh;
    return () => { delete window.HDReload; };
  }, []);

  const onReplay = (item) => {
    fetch('/ops/api/dlq/replay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok && d.ok !== false, d })))
      .then(({ ok, d }) => {
        if (ok) {
          setDlq((cur) => cur.filter((x) => x.id !== item.id));
          if (window.HD) window.HD.dlq = (window.HD.dlq || []).filter((x) => x.id !== item.id);
          showToast('Replay OK · reinjetado no stream' + (d.newStreamId ? ' (' + d.newStreamId + ')' : ''), 'ok');
        } else {
          showToast('Replay falhou: ' + (d.error || 'erro desconhecido'), 'bad');
        }
      })
      .catch((e) => showToast('Replay falhou: ' + e.message, 'bad'));
  };

  const pickStatus = (status, goTab) => { setFilter(status); if (goTab) setTab(goTab); };
  const toggleMenu = () => setMenuOpen((v) => !v);
  const closeMenu = () => setMenuOpen(false);
  const onTabChange = (id) => { setTab(id); closeMenu(); };

  React.useEffect(() => {
    const root = document.getElementById('app-root');
    if(root) {
      root.classList.toggle('dark', t.theme === 'dark');
      root.setAttribute('data-density', t.density);
      root.style.setProperty('--brand-accent', t.accent);
      root.style.setProperty('--copper', t.accent); // Keeping this var name for compatibility but it's now just the accent
    }
  }, [t.theme, t.density, t.accent]);

  // Auto-refresh: seletor Manual/5s/15s no topbar — window.HD_fetchAll é exportado por data-real.js
  React.useEffect(() => {
    const ms = interval_ === 1 ? 5000 : interval_ === 2 ? 15000 : 0;
    if (!ms || !window.HD_fetchAll) return;
    const id = setInterval(() => window.HD_fetchAll(), ms);
    return () => clearInterval(id);
  }, [interval_, hdReady]);

  const panel = !hdReady ? null : tab === 'overview'
    ? React.createElement(OverviewPanel, { onInspect: setInspect, animatedFlow: t.flowAnimated, onPickStatus: pickStatus })
    : tab === 'handoffs'
      ? React.createElement(HandoffsPanel, { onInspect: setInspect, filter, setFilter, dlq, onReplay })
      : tab === 'brain' ? React.createElement(BrainPanel, null)
        : tab === 'datalake' ? React.createElement(DataLakePanel, null)
          : tab === 'codereview' ? React.createElement(CodeReviewPanel, null)
            : tab === 'projects' ? React.createElement(ProjectsPanel, null)
              : React.createElement(InfraPanel, null);

  if (!hdReady) {
    return React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'monospace', color: 'var(--muted-foreground)' } }, 'Inicializando Handoff Daemon...');
  }

  return React.createElement('div', { className: cls('shell', t.serifSummary && 'serif-summary') },
    React.createElement('div', { className: cls('sidebar-ov', menuOpen && 'open'), onClick: closeMenu }),
    React.createElement(Sidebar, { tab, setTab: onTabChange, open: menuOpen, onClose: closeMenu }),
    React.createElement('main', { className: 'main' },
      React.createElement(Header, { tab, onRefresh: refresh, updated, interval: interval_, setInterval_, onSearchToggle: () => setSearchOpen(true) }),
      React.createElement('div', { className: 'content' }, panel),
    ),
    React.createElement(BottomNav, { tab, setTab: onTabChange }),
    searchOpen && React.createElement('div', { className: 'drawer-ov open', style: { zIndex: 100 }, onClick: () => setSearchOpen(false) }),
    searchOpen && React.createElement('div', { className: 'drawer open', style: { zIndex: 101, padding: '24px', width: '100%', maxWidth: '500px' } },
      React.createElement('h3', { style: { marginTop: 0 } }, 'Busca Semântica no LLM Brain'),
      React.createElement('form', { onSubmit: performSearch, style: { display: 'flex', gap: '8px', marginBottom: '16px' } },
        React.createElement('input', { className: 'cb-input', style: { flex: 1 }, placeholder: 'O que você está procurando?', value: searchQuery, onChange: e => setSearchQuery(e.target.value) }),
        React.createElement(Button, { type: 'submit' }, 'Buscar')
      ),
      searchResults === 'loading' ? React.createElement('div', { className: 'empty' }, 'Buscando vetores (RAG)...') :
      Array.isArray(searchResults) && searchResults.length === 0 ? React.createElement('div', { className: 'empty' }, 'Nenhum resultado encontrado.') :
      Array.isArray(searchResults) ? searchResults.map((r, i) => React.createElement('div', { key: i, style: { padding: '12px', background: 'var(--bg-subtle)', borderRadius: '6px', marginBottom: '8px' } },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '4px' } },
          React.createElement('span', { className: 'mono', style: { fontSize: '11px', color: 'var(--brand-accent)' } }, 'SCORE: ' + Math.round((r.score || 0) * 100) + '%'),
          React.createElement('span', { className: 'mono', style: { fontSize: '11px', color: 'var(--text-muted)' } }, r.heading || 'texto')
        ),
        React.createElement('p', { style: { margin: 0, fontSize: '13px' } }, r.snippet)
      )) : null
    ),
    React.createElement(Inspector, { handoff: inspect, onClose: () => setInspect(null) }),
    React.createElement(Toast, { toast }),
    React.createElement(TweaksPanel, null,
      React.createElement(TweakSection, { label: 'Aparência' }),
      React.createElement(TweakRadio, { label: 'Tema', value: t.theme, options: ['light', 'dark'], onChange: (v) => setTweak('theme', v) }),
      React.createElement(TweakRadio, { label: 'Densidade', value: t.density, options: ['compact', 'regular', 'comfy'], onChange: (v) => setTweak('density', v) }),
      React.createElement(TweakColor, { label: 'Acento', value: t.accent, options: ['#3b82f6', '#10b981', '#6366f1', '#eab308'], onChange: (v) => setTweak('accent', v) }),
      React.createElement(TweakSection, { label: 'Fluxo & resumo' }),
      React.createElement(TweakToggle, { label: 'Animar fluxo de handoff', value: t.flowAnimated, onChange: (v) => setTweak('flowAnimated', v) }),
    ),
  );
}

export default App;
