import React from 'react';
import { motion } from 'framer-motion';
import { X, LogOut } from 'lucide-react';
import { cn } from '../../lib/cn';
import { NAV_GROUPS } from '../../lib/nav.jsx';
import { useAppStore } from '../../store/app';

function LogoMark() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <span className="relative flex items-center justify-center w-7 h-7 rounded-lg bg-accent-soft border border-accent-line/40">
        <svg width="15" height="15" viewBox="0 0 28 28" fill="none">
          <path d="M8 6.2A8.2 8.2 0 0 0 8 21.8" stroke="var(--accent)" strokeWidth={2.4} strokeLinecap="round" opacity={0.55} />
          <path d="M20 6.2A8.2 8.2 0 0 1 20 21.8" stroke="var(--accent)" strokeWidth={2.4} strokeLinecap="round" opacity={0.55} />
          <rect x={10.6} y={8.4} width={6.8} height={11.2} rx={3.4} fill="var(--accent)" transform="rotate(38 14 14)" />
          <circle cx={14} cy={14} r={1.7} fill="var(--bg-raised)" />
        </svg>
      </span>
      <div className="flex flex-col leading-none">
        <span className="text-[13.5px] font-semibold tracking-tight text-fg">nicebyte <span className="text-accent">ops</span></span>
        <span className="text-[10px] text-faint data mt-1">handoff-daemon</span>
      </div>
    </div>
  );
}

function NavItem({ item, active, onSelect }) {
  const Icon = item.icon;
  return (
    <button
      onClick={() => onSelect(item.id)}
      className={cn(
        'relative w-full flex items-center gap-2.5 h-8 px-2.5 rounded-lg text-[13px] cursor-pointer',
        'transition-colors duration-150',
        active ? 'text-fg' : 'text-muted hover:text-fg',
      )}
    >
      {active && (
        <motion.span
          layoutId="nav-active"
          className="absolute inset-0 rounded-lg bg-hover border border-line"
          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
        />
      )}
      <Icon size={15} strokeWidth={1.8} className={cn('relative z-10 flex-none', active && 'text-accent')} />
      <span className="relative z-10 font-medium truncate">{item.label}</span>
      {item.kbd && (
        <span className="relative z-10 ml-auto hidden group-hover/sidebar:flex items-center gap-0.5">
          {item.kbd.split(' ').map((k) => <kbd key={k} className="kbd">{k}</kbd>)}
        </span>
      )}
    </button>
  );
}

export function Sidebar() {
  const { tab, setTab, sidebarOpen, setSidebarOpen } = useAppStore();
  const onSelect = (id) => { setTab(id); setSidebarOpen(false); };

  return (
    <>
      {/* overlay mobile */}
      <div
        className={cn(
          'fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity duration-200',
          sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        onClick={() => setSidebarOpen(false)}
      />
      <aside
        className={cn(
          'group/sidebar fixed lg:sticky top-0 z-40 h-dvh w-[232px] flex-none flex flex-col',
          'bg-raised border-r border-line',
          'transition-transform duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="flex items-center justify-between h-14 px-3 border-b border-line flex-none">
          <LogoMark />
          <button
            className="lg:hidden text-faint hover:text-fg cursor-pointer p-1"
            onClick={() => setSidebarOpen(false)}
            aria-label="Fechar menu"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-5">
          {NAV_GROUPS.map((group) => (
            <div key={group.id}>
              <div className="px-2.5 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
                {group.label}
              </div>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <NavItem key={item.id} item={item} active={tab === item.id} onSelect={onSelect} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="flex-none border-t border-line p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-subtle border border-line">
            <span className="status-dot status-dot--pulse bg-ok text-ok" />
            <span className="text-[11px] text-muted data truncate">ops.nicebyte.ia.br</span>
            <span className="ml-auto text-[9.5px] data text-faint flex-none">CF</span>
          </div>
          <div className="flex items-center gap-2.5 px-2 py-1">
            <span className="w-6.5 h-6.5 rounded-full bg-accent-soft border border-accent-line/40 text-accent text-[10px] font-semibold flex items-center justify-center data flex-none">
              MO
            </span>
            <div className="flex flex-col leading-none min-w-0">
              <span className="text-[12px] font-medium text-fg truncate">mattz77.mo</span>
              <span className="text-[10px] text-faint data mt-0.5">OTP verificado</span>
            </div>
            <button className="ml-auto text-faint hover:text-bad transition-colors cursor-pointer flex-none" title="Sair">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
