import React from 'react';
import { NAV_FLAT } from '../lib/nav.jsx';
import { useAppStore } from '../store/app';

/* Sequências estilo Linear: "g" seguido de letra navega (ex: g o → overview). */
export function useNavHotkeys() {
  const setTab = useAppStore((s) => s.setTab);

  React.useEffect(() => {
    let pending = null;
    let timer = null;

    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (pending === 'g') {
        clearTimeout(timer);
        pending = null;
        const item = NAV_FLAT.find((n) => n.kbd?.endsWith(` ${e.key.toUpperCase()}`));
        if (item) {
          e.preventDefault();
          setTab(item.id);
        }
        return;
      }
      if (e.key.toLowerCase() === 'g') {
        pending = 'g';
        timer = setTimeout(() => { pending = null; }, 900);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(timer); };
  }, [setTab]);
}
