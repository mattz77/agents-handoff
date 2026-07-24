import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, HardDrive, FolderTree, FileClock } from 'lucide-react';
import { api } from '../lib/api';
import { Stat } from '../components/ui/stat.jsx';
import { SectionHeader, QueryState, EmptyState, Spotlight } from '../components/ui/misc.jsx';
import { fmtBytes, fmtRelative } from '../lib/format';

export default function DataLake() {
  const q = useQuery({ queryKey: ['datalake'], queryFn: api.datalake, refetchInterval: 30_000 });
  const d = q.data || {};
  const entries = d.entries || d.files || d.recent || [];
  const folders = d.folders || d.tree || [];

  return (
    <div>
      <QueryState
        query={q}
        skeleton={
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-[104px]" />)}</div>
            <div className="skeleton h-64" />
          </div>
        }
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <Stat label="Usado" value={d.usedBytes != null ? d.usedBytes / 1e12 : d.usedTb} suffix="TB" icon={Database} format={{ maximumFractionDigits: 2 }} hint={`de ${d.totalTb ?? 5} TB no Drive`} />
          <Stat label="Arquivos" value={d.fileCount ?? d.files} icon={FolderTree} format={{ maximumFractionDigits: 0 }} />
          <Stat label="Pastas" value={d.folderCount ?? folders.length} icon={HardDrive} format={{ maximumFractionDigits: 0 }} />
          <Stat label="Backups" value={d.backupCount ?? d.backups} icon={FileClock} format={{ maximumFractionDigits: 0 }} hint="snapshots do brain" />
        </div>

        {folders.length > 0 && (
          <Spotlight className="card p-5 mb-4">
            <SectionHeader title="Estrutura" sub="pastas raiz do data lake" />
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {folders.map((f, i) => (
                <div key={f.id || f.name || i} className="flex items-center gap-2.5 p-3 rounded-lg border border-line bg-subtle/50 hover:bg-hover transition-colors">
                  <FolderTree size={14} className="text-accent flex-none" />
                  <span className="data text-[12px] text-fg truncate">{f.name || f.path}</span>
                  {f.count != null && <span className="data tnum text-[10.5px] text-faint ml-auto flex-none">{f.count}</span>}
                </div>
              ))}
            </div>
          </Spotlight>
        )}

        <Spotlight className="card p-5">
          <SectionHeader title="Atividade recente" sub="últimas escritas no lake" />
          {entries.length === 0 ? (
            <EmptyState icon={Database} title="Sem atividade" hint="Escritas dos agentes aparecem aqui." />
          ) : (
            <div className="flex flex-col gap-1.5">
              {entries.slice(0, 15).map((e, i) => (
                <div key={e.id || e.path || i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-hover transition-colors">
                  <FileClock size={13.5} className="text-faint flex-none" />
                  <span className="data text-[12px] text-fg truncate flex-1">{e.path || e.name || e.title}</span>
                  {e.size != null && <span className="data tnum text-[11px] text-faint flex-none">{fmtBytes(e.size)}</span>}
                  <span className="data text-[11px] text-faint flex-none">{fmtRelative(e.modified_at || e.updated_at || e.ts)}</span>
                </div>
              ))}
            </div>
          )}
        </Spotlight>
      </QueryState>
    </div>
  );
}
