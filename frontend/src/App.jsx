import React, { Suspense, lazy } from 'react';
import { Toaster } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { Sidebar } from './components/shell/Sidebar.jsx';
import { Topbar } from './components/shell/Topbar.jsx';
import { CommandPalette } from './components/shell/CommandPalette.jsx';
import { Spinner } from './components/ui/misc.jsx';
import { useAppStore } from './store/app';
import { useNavHotkeys } from './lib/useNavHotkeys';

const pages = {
  overview: lazy(() => import('./pages/Overview.jsx')),
  handoffs: lazy(() => import('./pages/Handoffs.jsx')),
  deploy: lazy(() => import('./pages/Deploy.jsx')),
  agents: lazy(() => import('./pages/Agents.jsx')),
  models: lazy(() => import('./pages/Models.jsx')),
  brain: lazy(() => import('./pages/Brain.jsx')),
  datalake: lazy(() => import('./pages/DataLake.jsx')),
  codereview: lazy(() => import('./pages/CodeReview.jsx')),
  projects: lazy(() => import('./pages/Projects.jsx')),
  infra: lazy(() => import('./pages/Infra.jsx')),
};

function PageFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <Spinner size={20} />
    </div>
  );
}

export default function App() {
  const { tab, theme, refreshInterval } = useAppStore();
  const queryClient = useQueryClient();
  useNavHotkeys();

  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  React.useEffect(() => {
    if (!refreshInterval) return;
    const id = setInterval(() => queryClient.invalidateQueries(), refreshInterval);
    return () => clearInterval(id);
  }, [refreshInterval, queryClient]);

  const Page = pages[tab] || pages.overview;

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-fg">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="px-4 lg:px-6 py-5 max-w-[1400px] mx-auto"
            >
              <Suspense fallback={<PageFallback />}>
                <Page />
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette />
      <Toaster
        theme={theme}
        position="bottom-right"
        toastOptions={{ style: { fontSize: '13px' } }}
        gap={8}
      />
    </div>
  );
}
