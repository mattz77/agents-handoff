import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

/* Drawer lateral direito — camada de drill-down do painel.
   Uso: <Drawer open={!!x} onClose={...} title="..." sub="...">...</Drawer> */
export function Drawer({ open, onClose, title, sub, actions, width = 480, children }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-black/55 backdrop-blur-[3px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.aside
            className="absolute right-0 top-0 h-full bg-raised border-l border-line-strong flex flex-col"
            style={{ width: `min(${width}px, 94vw)`, boxShadow: 'var(--shadow-pop)' }}
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
          >
            <div className="flex items-start gap-3 px-5 h-16 border-b border-line flex-none">
              <div className="min-w-0 flex-1 py-3.5">
                <h3 className="text-[14px] font-semibold tracking-tight text-fg truncate">{title}</h3>
                {sub && <p className="data text-[11px] text-faint truncate mt-0.5">{sub}</p>}
              </div>
              <div className="flex items-center gap-1.5 py-3.5 flex-none">
                {actions}
                <button
                  onClick={onClose}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-faint hover:text-fg hover:bg-hover transition-colors cursor-pointer"
                  aria-label="Fechar (Esc)"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* Bloco chave-valor denso pra metadados */
export function KV({ k, v, mono = true, className }) {
  if (v === null || v === undefined || v === '') return null;
  return (
    <div className={cn('flex items-baseline gap-3 py-1.5 border-b border-line/50 last:border-0', className)}>
      <span className="text-[10.5px] uppercase tracking-[0.07em] text-faint font-semibold w-[110px] flex-none">{k}</span>
      <span className={cn('text-[12px] text-fg min-w-0 break-all', mono && 'data')}>{v}</span>
    </div>
  );
}

/* Viewer JSON mono com scroll */
export function JsonBlock({ data, label }) {
  if (data === null || data === undefined) return null;
  let text;
  try { text = typeof data === 'string' ? data : JSON.stringify(data, null, 2); }
  catch { text = String(data); }
  return (
    <div className="mt-4">
      {label && <p className="text-[10.5px] uppercase tracking-[0.07em] text-faint font-semibold mb-1.5">{label}</p>}
      <pre className="data text-[11px] leading-[1.65] text-muted bg-[#050506] border border-line rounded-lg p-3.5 overflow-auto max-h-[340px] whitespace-pre-wrap break-all">
        {text}
      </pre>
    </div>
  );
}
