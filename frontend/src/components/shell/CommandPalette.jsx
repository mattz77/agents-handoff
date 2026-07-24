import React from 'react';
import { createPortal } from 'react-dom';
import { Command } from 'cmdk';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { Search, RefreshCw, Sun, Moon, CornerDownLeft } from 'lucide-react';
import { NAV_GROUPS } from '../../lib/nav.jsx';
import { useAppStore } from '../../store/app';
import { toast } from 'sonner';

function Palette({ onClose }) {
  const { setTab, toggleTheme } = useAppStore();
  const queryClient = useQueryClient();

  const run = (fn) => () => { fn(); onClose(); };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" onClick={onClose} />
      <motion.div
        className="relative w-full max-w-[520px] bg-overlay border border-line-strong rounded-xl overflow-hidden"
        style={{ boxShadow: 'var(--shadow-pop)' }}
        initial={{ opacity: 0, scale: 0.97, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -8 }}
        transition={{ type: 'spring', stiffness: 480, damping: 36 }}
      >
        <Command label="Paleta de comandos" loop>
          <div className="flex items-center gap-2.5 h-12 px-4 border-b border-line">
            <Search size={15} className="text-faint flex-none" />
            <Command.Input
              autoFocus
              placeholder="Digite um comando ou busque uma seção…"
              className="flex-1 bg-transparent outline-none text-[13.5px] text-fg placeholder:text-faint"
            />
            <kbd className="kbd">esc</kbd>
          </div>
          <Command.List className="max-h-[320px] overflow-y-auto p-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.1em] [&_[cmdk-group-heading]]:text-faint">
            <Command.Empty className="py-10 text-center text-[12.5px] text-faint">
              Nenhum comando encontrado.
            </Command.Empty>

            {NAV_GROUPS.map((g) => (
              <Command.Group key={g.id} heading={g.label}>
                {g.items.map((item) => (
                  <PaletteItem
                    key={item.id}
                    icon={item.icon}
                    onSelect={run(() => setTab(item.id))}
                    keywords={[item.label.toLowerCase(), 'ir', 'navegar']}
                  >
                    {item.label}
                    {item.kbd && (
                      <span className="ml-auto flex items-center gap-0.5">
                        {item.kbd.split(' ').map((k) => <kbd key={k} className="kbd">{k}</kbd>)}
                      </span>
                    )}
                  </PaletteItem>
                ))}
              </Command.Group>
            ))}

            <Command.Group heading="Ações">
              <PaletteItem
                icon={RefreshCw}
                onSelect={run(() => {
                  queryClient.invalidateQueries();
                  toast.success('Métricas atualizadas', { duration: 1800 });
                })}
                keywords={['refresh', 'reload', 'atualizar']}
              >
                Atualizar todas as métricas
              </PaletteItem>
              <PaletteItem icon={Sun} onSelect={run(toggleTheme)} keywords={['tema', 'claro', 'light']}>
                Mudar para tema claro
              </PaletteItem>
              <PaletteItem icon={Moon} onSelect={run(toggleTheme)} keywords={['tema', 'escuro', 'dark']}>
                Mudar para tema escuro
              </PaletteItem>
            </Command.Group>
          </Command.List>
          <div className="flex items-center gap-4 h-9 px-4 border-t border-line text-[10.5px] text-faint">
            <span className="flex items-center gap-1.5"><kbd className="kbd">↑↓</kbd> navegar</span>
            <span className="flex items-center gap-1.5"><CornerDownLeft size={10} /> executar</span>
          </div>
        </Command>
      </motion.div>
    </motion.div>
  );
}

function PaletteItem({ icon: Icon, children, onSelect, keywords = [] }) {
  return (
    <Command.Item
      onSelect={onSelect}
      keywords={keywords}
      className="flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-[13px] text-muted cursor-pointer select-none
        data-[selected=true]:bg-hover data-[selected=true]:text-fg transition-colors duration-75"
    >
      {Icon && <Icon size={14.5} strokeWidth={1.8} className="text-faint flex-none" />}
      <span className="font-medium truncate">{children}</span>
    </Command.Item>
  );
}

export function CommandPalette() {
  const { cmdkOpen, setCmdkOpen } = useAppStore();

  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdkOpen(!useAppStore.getState().cmdkOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setCmdkOpen]);

  return createPortal(
    <AnimatePresence>
      {cmdkOpen && <Palette onClose={() => setCmdkOpen(false)} />}
    </AnimatePresence>,
    document.body,
  );
}
