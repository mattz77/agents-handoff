import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, HardDrive, FolderTree, Archive, RefreshCcw } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Stat } from '../components/ui/stat.jsx';
import { SectionHeader, QueryState, EmptyState, Spotlight } from '../components/ui/misc.jsx';
import { fmtRelative } from '../lib/format';

const fmtMB = (mb) => {
  if (mb == null || isNaN(mb)) return '—';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
};

function CapacityBar({ used, total }) {
  const pct = total ? Math.min(Math.round((used / total) * 100), 100) : 0;
  return (
    <div className="card p-5 mb-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div>
          <p className="text-[13px] font-semibold text-fg">Capacidade do Drive</p>
          <p className="data text-[11px] text-faint mt-0.5">{fmtMB(used)} usados de {fmtMB(total)}</p>
        </div>
        <span className="data tnum text-[20px] font-semibold text-fg">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-subtle overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-700', pct > 85 ? 'bg-bad' : pct > 65 ? 'bg-warn' : 'bg-accent')}
          style={{ width: `${pct}%`, boxShadow: 'var(--glow-accent)' }}
        />
      </div>
    </div>
  );
}

function AreaGrid({ title, icon: Icon, items }) {
  if (!items?.length) return null;
  return (
    <Spotlight className="card p-5">
      <SectionHeader title={title} sub={`${items.length} área(s)`} />
      <div className="grid sm:grid-cols-2 gap-2">
        {items.map((a, i) => (
          <div key={a.name || i} className="flex items-center gap-3 p-3 rounded-lg border border-line bg-subtle/50 hover:bg-hover transition-colors">
            <Icon size={14} className="text-accent flex-none" />
            <div className="min-w-0 flex-1">
              <p className="data text-[12px] text-fg truncate">{a.name}</p>
              <p className="data text-[10.5px] text-faint mt-0.5">{a.files} arquivo(s) · {fmtMB(a.sizeMB)}</p>
            </div>
            <span className="data text-[10.5px] text-faint flex-none">{fmtRelative(a.updated)}</span>
          </div>
        ))}
      </div>
    </Spotlight>
  );
}

export default function DataLake() {
  const q = useQuery({ queryKey: ['datalake'], queryFn: api.datalake, refetchInterval: 30_000 });
  const d = q.data || {};
  const backups = d.backups || [];

  return (
    <div>
      <QueryState
        query={q}
        skeleton={
          <div className="flex flex-col gap-4">
            <div className="skeleton h-[110px]" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-[104px]" />)}</div>
            <div className="skeleton h-64" />
          </div>
        }
      >
        <CapacityBar used={d.totalSizeMB} total={d.capacityMB} />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <Stat label="Backups" value={d.backupCount} icon={Archive} format={{ maximumFractionDigits: 0 }} hint={d.lastBackup ? `último ${fmtRelative(d.lastBackup)}` : 'nenhum backup'} />
          <Stat label="Engines" value={new Set(backups.map((b) => b.engine)).size} icon={Database} format={{ maximumFractionDigits: 0 }} hint="sistemas com snapshot" />
          <Stat label="Tamanho total" value={d.totalSizeMB != null ? d.totalSizeMB / 1024 : undefined} suffix="GB" icon={HardDrive} hint="soma de todos os dados" />
          <Stat label="Último sync" value={undefined} icon={RefreshCcw} hint={d.lastSync ? fmtRelative(d.lastSync) : '—'} />
        </div>

        <div className="grid lg:grid-cols-2 gap-4 mb-4">
          <AreaGrid title="Áreas de conhecimento" icon={FolderTree} items={d.knowledgeAreas} />
          <AreaGrid title="Projetos" icon={Database} items={d.projectDirs} />
        </div>

        <Spotlight className="card p-5">
          <SectionHeader title="Backups por engine" sub="snapshots mais recentes de cada sistema" />
          {backups.length === 0 ? <EmptyState icon={Archive} title="Sem backups" /> : (
            <div className="card overflow-hidden border-0 shadow-none">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    {['Engine', 'Projeto', 'Arquivos', 'Tamanho', 'Último'].map((h) => (
                      <th key={h} className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-faint">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {backups.slice(0, 20).map((b, i) => (
                    <tr key={`${b.engine}-${b.project}-${i}`} className="border-b border-line/60 last:border-0 hover:bg-hover transition-colors">
                      <td className="px-3 py-2.5 data text-fg">{b.engine}</td>
                      <td className="px-3 py-2.5 data text-muted">{b.project}</td>
                      <td className="px-3 py-2.5 data tnum text-muted">{b.count}</td>
                      <td className="px-3 py-2.5 data tnum text-muted">{fmtMB(b.sizeMB)}</td>
                      <td className="px-3 py-2.5 data text-faint">{fmtRelative(b.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Spotlight>
      </QueryState>
    </div>
  );
}
