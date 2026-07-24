import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderGit2, GitBranch, ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import { Badge } from '../components/ui/badge.jsx';
import { SectionHeader, QueryState, EmptyState, Spotlight } from '../components/ui/misc.jsx';
import { fmtRelative } from '../lib/format';

export default function Projects() {
  const q = useQuery({ queryKey: ['projects'], queryFn: api.projects, refetchInterval: 30_000 });
  const items = Array.isArray(q.data) ? q.data : q.data?.projects || [];

  return (
    <div>
      <SectionHeader title="Projetos ativos" sub="repositórios gerenciados no ecossistema nicebyte" />
      <QueryState query={q} skeleton={<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{[...Array(6)].map((_, i) => <div key={i} className="skeleton h-36" />)}</div>}>
        {items.length === 0 ? <EmptyState icon={FolderGit2} title="Nenhum projeto registrado" /> : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((p) => {
              const name = p.name || p.slug || p.id;
              return (
                <Spotlight key={name} className="card card-interactive p-5 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-9 h-9 rounded-lg bg-subtle border border-line flex items-center justify-center text-faint flex-none">
                        <FolderGit2 size={16} strokeWidth={1.8} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-semibold text-fg truncate">{name}</p>
                        {p.repo && <p className="data text-[10.5px] text-faint truncate">{p.repo}</p>}
                      </div>
                    </div>
                    {p.status && <Badge tone={p.status === 'active' ? 'ok' : 'neutral'} dot={false}>{p.status}</Badge>}
                  </div>
                  {p.description && <p className="text-[12px] text-muted leading-relaxed line-clamp-2">{p.description}</p>}
                  <div className="flex items-center gap-3 mt-auto pt-1 data text-[10.5px] text-faint">
                    {p.branch && <span className="flex items-center gap-1 truncate"><GitBranch size={11} /> {p.branch}</span>}
                    {(p.updated_at || p.last_commit_at) && <span className="ml-auto flex-none">{fmtRelative(p.updated_at || p.last_commit_at)}</span>}
                    {p.url && (
                      <a href={p.url} target="_blank" rel="noreferrer" className="text-faint hover:text-accent transition-colors flex-none" aria-label="Abrir repo">
                        <ExternalLink size={12.5} />
                      </a>
                    )}
                  </div>
                </Spotlight>
              );
            })}
          </div>
        )}
      </QueryState>
    </div>
  );
}
