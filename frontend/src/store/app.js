import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAppStore = create(
  persist(
    (set) => ({
      // navegação
      tab: 'overview',
      setTab: (tab) => set({ tab }),

      // aparência
      theme: 'dark',
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),

      // refresh global
      refreshInterval: 0, // 0 = manual, 5000, 15000
      setRefreshInterval: (refreshInterval) => set({ refreshInterval }),

      // ui efêmera (não persiste — partialize abaixo)
      cmdkOpen: false,
      setCmdkOpen: (cmdkOpen) => set({ cmdkOpen }),
      sidebarOpen: false,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    }),
    {
      name: 'nicebyte-ops',
      partialize: (s) => ({ tab: s.tab, theme: s.theme, refreshInterval: s.refreshInterval }),
    },
  ),
);
