import React from 'react';
import { Icon, HDLib } from './components/icons.jsx';
import { HDP } from './components/panels/index.js';
import { HDW } from './components/widgets.jsx';
import { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakColor } from './components/tweaks-panel.jsx';

const DS = window.CommitBriefingDesignSystem_27542e;
const { Button } = DS;
const { cls } = HDLib;
const { OverviewPanel, HandoffsPanel, BrainPanel, InfraPanel, DataLakePanel, CodeReviewPanel, ProjectsPanel, AgentTasksPanel, ModelsPanel, DeployPanel } = HDP;
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
  { id: 'agents', label: 'Agentes', icon: 'brain' },
  { id: 'models', label: 'Modelos IA', icon: 'brain' },
  { id: 'deploy', label: 'Deploy', icon: 'terminal' },
  { id: 'projects', label: 'Projetos', icon: 'folder' },
  { id: 'infra', label: 'Infra', icon: 'server' },
];

function LogoMark() {
  return (
    <span className="logo">
      <svg className="logo__mark" width={27} height={27} viewBox="0 0 28 28" fill="none">
        <path d="M8 6.2A8.2 8.2 0 0 0 8 21.8" stroke="var(--copper)" strokeWidth={2} strokeLinecap="round" opacity={0.5} />
        <path d="M20 6.2A8.2 8.2 0 0 1 20 21.8" stroke="var(--copper)" strokeWidth={2} strokeLinecap="round" opacity={0.5} />
        <rect x={10.6} y={8.4} width={6.8} height={11.2} rx={3.4} fill="var(--copper)" transform="rotate(38 14 14)" />
        <circle cx={14} cy={14} r={1.7} fill="var(--sidebar)" />
      </svg>
      <span className="logo__wm">Handoff<b>Daemon</b></span>
    </span>
  );
}

function Sidebar({ tab, setTab, open, onClose }) {
  return (
    <aside className={cls('sidebar', open && 'open')}>
      <button className="sidebar__close-btn" onClick={onClose} aria-label="Fechar menu">
        <Icon name="x" size={18} />
      </button>
      <div className="sidebar__brand"><LogoMark /></div>
      <div className="sidebar__org">
        <span className="sidebar__org-dot" />nicebyte ops
      </div>
      <nav className="sidebar__nav">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={cls('navitem', tab === n.id && 'navitem--active')}
            onClick={() => setTab(n.id)}
          >
            <Icon name={n.icon} size={17} />
            <span>{n.label}</span>
            {tab === n.id && <span className="navitem__rail" />}
          </button>
        ))}
      </nav>
      <div className="sidebar__foot">
        <div className="sidebar__env">
          <span className="sidebar__env-dot" />
          <span>ops.nicebyte.ia.br</span>
          <span className="sidebar__env-cf mono">CF Access</span>
        </div>
        <div className="sidebar__user">
          <span className="sidebar__avatar mono">MO</span>
          <div className="sidebar__user-meta">
            <span className="sidebar__user-name">mattz77.mo</span>
            <span className="sidebar__user-mail mono">OTP verificado</span>
          </div>
          <button className="sidebar__logout" title="Sair">
            <Icon name="logout" size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function Header({ tab, onRefresh, interval, setInterval_, onSearchToggle }) {
  const titles = { overview: 'Visão geral', handoffs: 'Handoffs & filas', brain: 'LLM Brain', datalake: 'DataLake', codereview: 'Code Review', agents: 'Agentes', models: 'Modelos IA', deploy: 'Deploy', projects: 'Projetos', infra: 'Infraestrutura' };
  const subs = {
    overview: 'Orquestração de handoff entre agentes (em tempo real)',
    handoffs: 'Auditoria, dead-letter queue, outbox e circuit breakers',
    brain: 'Modelo ativo, decisões e fila de tarefas',
    datalake: 'Google Drive 5\u00a0TB (memória de longo prazo)',
    codereview: 'Revisão diária, riscos mitigados e integridade',
    agents: 'Delegue tasks a agentes — kanban, branch isolada e PR pra revisão',
    models: 'Provedores de IA: NVIDIA NIM, OpenAI, Anthropic — API keys e default',
    deploy: 'Rebuild e deploy do daemon — self-hosted ou Vercel, log em tempo real',
    projects: 'Gerenciamento de repositórios e projetos ativos',
    infra: 'Containers, Redis HA e saúde do sistema',
  };
  return (
    <header className="topbar">
      <div className="topbar__l">
        <div className="topbar__crumb mono">
          painel <Icon name="chevronRight" size={13} /> {titles[tab].toLowerCase()}
        </div>
        <h1 className="topbar__title">{titles[tab]}</h1>
        <p className="topbar__sub">{subs[tab]}</p>
      </div>
      <div className="topbar__r">
        <Button variant="outline" size="sm" onClick={onSearchToggle} style={{ marginRight: '8px' }}>
          <Icon name="search" size={14} />
          <span className="btn-search-txt"> Busca Semântica</span>
          <kbd className="kbd topbar__kbd">Ctrl K</kbd>
        </Button>
        <div className="seg">
          {['Manual', '5s', '15s'].map((o, i) => (
            <button
              key={o}
              className={cls('seg__btn', interval === i && 'seg__btn--on')}
              onClick={() => setInterval_(i)}
            >{o}</button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <Icon name="refresh" size={14} />
          <span className="btn-search-txt">Atualizar</span>
        </Button>
      </div>
    </header>
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

  return (
    <>
      <div className={cls('more-menu-ov', moreOpen && 'open')} onClick={() => setMoreOpen(false)} />
      <div className={cls('more-menu', moreOpen && 'open')}>
        {moreTabs.map(n => (
          <button
            key={n.id}
            className={cls('more-menu__item', tab === n.id && 'active')}
            onClick={() => onTabSelect(n.id)}
          >
            <Icon name={n.icon} size={16} />{n.label}
          </button>
        ))}
      </div>
      <nav className="bottom-nav">
        {mainTabs.map(n => (
          <button
            key={n.id}
            className={cls('bottom-nav__item', tab === n.id && 'active')}
            onClick={() => onTabSelect(n.id)}
          >
            <Icon name={n.icon} size={18} />{n.label}
          </button>
        ))}
        <button
          className={cls('bottom-nav__item', moreTabs.some(n => n.id === tab) && 'active')}
          onClick={() => setMoreOpen(!moreOpen)}
        >
          <Icon name="menu" size={18} />Mais
        </button>
      </nav>
    </>
  );
}

function CommandPalette({ open, onClose, setTab, onRefresh, onSearch }) {
  const [q, setQ] = React.useState('');
  const [sel, setSel] = React.useState(0);
  const inputRef = React.useRef(null);

  const commands = React.useMemo(() => [
    ...NAV.map((n) => ({ id: 'nav:' + n.id, icon: n.icon, label: 'Ir para ' + n.label, hint: 'seção', run: () => setTab(n.id) })),
    { id: 'act:refresh', icon: 'refresh', label: 'Atualizar métricas', hint: 'ação', run: onRefresh },
    { id: 'act:search', icon: 'search', label: 'Busca Semântica no LLM Brain', hint: 'ação', run: onSearch },
  ], [setTab, onRefresh, onSearch]);

  const filtered = q
    ? commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()))
    : commands;

  React.useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);
  React.useEffect(() => { setSel(0); }, [q]);

  const runSel = (c) => { if (!c) return; c.run(); onClose(); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); runSel(filtered[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.target !== inputRef.current) onKey(e); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  if (!open) return null;

  return (
    <>
      <div className="cmdk-ov" onClick={onClose} />
      <div className="cmdk" role="dialog" aria-label="Paleta de comandos">
        <div className="cmdk__inputrow">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            className="cmdk__input"
            placeholder="Digite um comando ou seção…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
          />
          <kbd className="kbd">esc</kbd>
        </div>
        <div className="cmdk__list">
          {filtered.length === 0
            ? <div className="empty">Nenhum comando.</div>
            : filtered.map((c, i) => (
              <button
                key={c.id}
                className={cls('cmdk__item', i === sel && 'cmdk__item--on')}
                onMouseEnter={() => setSel(i)}
                onClick={() => runSel(c)}
              >
                <Icon name={c.icon} size={15} />
                <span className="cmdk__label">{c.label}</span>
                <span className="cmdk__hint">{c.hint}</span>
              </button>
            ))}
        </div>
      </div>
    </>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={cls('toast', 'toast--' + (toast.kind || 'info'), 'show')}>
      <Icon name={toast.kind === 'ok' ? 'check' : toast.kind === 'bad' ? 'xCircle' : 'circleDot'} size={15} />
      {toast.msg}
    </div>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [hdReady, setHdReady] = React.useState(() => !!window.HD?.handoffs);

  React.useEffect(() => {
    if (hdReady) return;
    const id = setInterval(() => {
      if (window.HD?.handoffs) { setHdReady(true); clearInterval(id); }
    }, 100);
    return () => clearInterval(id);
  }, [hdReady]);

  const [tab, setTabRaw] = React.useState(() => {
    const saved = localStorage.getItem('hd.tab');
    return saved && NAV.some((n) => n.id === saved) ? saved : 'overview';
  });
  const setTab = React.useCallback((id) => { localStorage.setItem('hd.tab', id); setTabRaw(id); }, []);
  const [filter, setFilter] = React.useState(null);
  const [inspect, setInspect] = React.useState(null);
  const [dlq, setDlq] = React.useState(() => window.HD?.dlq?.slice() || []);
  const [toast, setToast] = React.useState(null);
  const [interval_, setInterval_] = React.useState(1);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [cmdkOpen, setCmdkOpen] = React.useState(false);
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

  const refresh = (notify) => {
    setDlq(window.HD?.dlq?.slice() || []);
    if (notify) showToast('Métricas atualizadas', 'ok');
  };
  const manualRefresh = () => refresh(true);

  React.useEffect(() => {
    window.HDReload = () => refresh(false);
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
  const closeMenu = () => setMenuOpen(false);
  const onTabChange = (id) => { setTab(id); closeMenu(); };

  React.useEffect(() => {
    const root = document.getElementById('app-root');
    if (root) {
      root.classList.toggle('dark', t.theme === 'dark');
      root.setAttribute('data-density', t.density);
      root.style.setProperty('--brand-accent', t.accent);
      root.style.setProperty('--copper', t.accent);
    }
  }, [t.theme, t.density, t.accent]);

  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdkOpen((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  React.useEffect(() => {
    const ms = interval_ === 1 ? 5000 : interval_ === 2 ? 15000 : 0;
    if (!ms || !window.HD_fetchAll) return;
    const id = setInterval(() => window.HD_fetchAll(), ms);
    return () => clearInterval(id);
  }, [interval_, hdReady]);

  const panel = !hdReady ? null : tab === 'overview'
    ? <OverviewPanel onInspect={setInspect} animatedFlow={t.flowAnimated} onPickStatus={pickStatus} />
    : tab === 'handoffs'
      ? <HandoffsPanel onInspect={setInspect} filter={filter} setFilter={setFilter} dlq={dlq} onReplay={onReplay} />
      : tab === 'brain' ? <BrainPanel />
        : tab === 'datalake' ? <DataLakePanel />
          : tab === 'codereview' ? <CodeReviewPanel />
            : tab === 'agents' ? <AgentTasksPanel />
              : tab === 'models' ? <ModelsPanel />
                : tab === 'deploy' ? <DeployPanel />
                  : tab === 'projects' ? <ProjectsPanel />
                    : <InfraPanel />;

  if (!hdReady) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'monospace', color: 'var(--muted-foreground)' }}>
        Inicializando Handoff Daemon...
      </div>
    );
  }

  return (
    <div className={cls('shell', t.serifSummary && 'serif-summary')}>
      <div className={cls('sidebar-ov', menuOpen && 'open')} onClick={closeMenu} />
      <Sidebar tab={tab} setTab={onTabChange} open={menuOpen} onClose={closeMenu} />
      <main className="main">
        <Header tab={tab} onRefresh={manualRefresh} interval={interval_} setInterval_={setInterval_} onSearchToggle={() => setSearchOpen(true)} />
        <div className="content">{panel}</div>
      </main>
      <BottomNav tab={tab} setTab={onTabChange} />
      {searchOpen && <div className="drawer-ov open" style={{ zIndex: 100 }} onClick={() => setSearchOpen(false)} />}
      {searchOpen && (
        <div className="drawer open" style={{ zIndex: 101, padding: '24px', width: '100%', maxWidth: '500px' }}>
          <h3 style={{ marginTop: 0 }}>Busca Semântica no LLM Brain</h3>
          <form onSubmit={performSearch} style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <input className="cb-input" style={{ flex: 1 }} placeholder="O que você está procurando?" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            <Button type="submit">Buscar</Button>
          </form>
          {searchResults === 'loading' ? <div className="empty">Buscando vetores (RAG)...</div> :
            Array.isArray(searchResults) && searchResults.length === 0 ? <div className="empty">Nenhum resultado encontrado.</div> :
              Array.isArray(searchResults) ? searchResults.map((r, i) => (
                <div key={i} style={{ padding: '12px', background: 'var(--bg-subtle)', borderRadius: '6px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span className="mono" style={{ fontSize: '11px', color: 'var(--brand-accent)' }}>SCORE: {Math.round((r.score || 0) * 100)}%</span>
                    <span className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{r.heading || 'texto'}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '13px' }}>{r.snippet}</p>
                </div>
              )) : null}
        </div>
      )}
      <CommandPalette
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
        setTab={onTabChange}
        onRefresh={manualRefresh}
        onSearch={() => setSearchOpen(true)}
      />
      <Inspector handoff={inspect} onClose={() => setInspect(null)} />
      <Toast toast={toast} />
      <TweaksPanel>
        <TweakSection label="Aparência" />
        <TweakRadio label="Tema" value={t.theme} options={['light', 'dark']} onChange={(v) => setTweak('theme', v)} />
        <TweakRadio label="Densidade" value={t.density} options={['compact', 'regular', 'comfy']} onChange={(v) => setTweak('density', v)} />
        <TweakColor label="Acento" value={t.accent} options={['#3b82f6', '#10b981', '#6366f1', '#eab308']} onChange={(v) => setTweak('accent', v)} />
        <TweakSection label="Fluxo & resumo" />
        <TweakToggle label="Animar fluxo de handoff" value={t.flowAnimated} onChange={(v) => setTweak('flowAnimated', v)} />
      </TweaksPanel>
    </div>
  );
}

export default App;
