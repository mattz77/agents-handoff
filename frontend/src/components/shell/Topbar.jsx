import React from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search, Sun, Moon, Menu, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/cn';
import { navById } from '../../lib/nav.jsx';
import { useAppStore } from '../../store/app';
import { Button } from '../ui/button';

const REFRESH_OPTS = [
  { label: 'Manual', ms: 0 },
  { label: '5s', ms: 5000 },
  { label: '15s', ms: 15000 },
];

export function Topbar() {
  const { tab, refreshInterval, setRefreshInterval, setCmdkOpen, theme, toggleTheme, setSidebarOpen } = useAppStore();
  const nav = navById(tab);
  const queryClient = useQueryClient();
  const isFetching = useIsFetching();

  const refreshAll = () => {
    queryClient.invalidateQueries();
    toast.success('Métricas atualizadas', { duration: 1800 });
  };

  return (
    <header className="sticky top-0 z-20 h-14 flex items-center gap-3 px-4 lg:px-6 border-b border-line bg-bg/80 backdrop-blur-md flex-none">
      <button
        className="lg:hidden text-muted hover:text-fg cursor-pointer flex-none"
        onClick={() => setSidebarOpen(true)}
        aria-label="Abrir menu"
      >
        <Menu size={17} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[10.5px] data text-faint uppercase tracking-[0.08em]">
          <span>ops</span>
          <ChevronRight size={10} />
          <span className="text-accent">{nav?.label}</span>
        </div>
        <p className="text-[12px] text-muted truncate mt-0.5 hidden sm:block">{nav?.sub}</p>
      </div>

      <div className="flex items-center gap-2 flex-none">
        <Button variant="outline" size="sm" onClick={() => setCmdkOpen(true)} className="hidden md:inline-flex text-muted">
          <Search size={13.5} />
          <span>Buscar ou comandar</span>
          <kbd className="kbd ml-1">⌘K</kbd>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setCmdkOpen(true)} className="md:hidden px-2" aria-label="Comandos">
          <Search size={15} />
        </Button>

        <div className="hidden sm:flex items-center rounded-lg border border-line bg-overlay p-0.5">
          {REFRESH_OPTS.map((o) => (
            <button
              key={o.label}
              onClick={() => setRefreshInterval(o.ms)}
              className={cn(
                'h-6.5 px-2.5 rounded-md text-[11.5px] font-medium cursor-pointer transition-colors duration-150',
                refreshInterval === o.ms ? 'bg-hover text-fg shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]' : 'text-faint hover:text-muted',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>

        <Button variant="outline" size="sm" onClick={refreshAll} className="px-2" aria-label="Atualizar">
          <RefreshCw size={13.5} className={cn(isFetching > 0 && 'animate-spin')} />
        </Button>

        <Button variant="ghost" size="sm" onClick={toggleTheme} className="px-2" aria-label="Alternar tema">
          {theme === 'dark' ? <Sun size={14.5} /> : <Moon size={14.5} />}
        </Button>
      </div>
    </header>
  );
}
