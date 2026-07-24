import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderGit2, GitBranch, ShieldCheck, Swords, ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import { Badge } from '../components/ui/badge.jsx';
import { SectionHeader, QueryState, EmptyState, Spotlight } from '../components/ui/misc.jsx';

export default function Projects() {
  const q = useQuery({ queryKey: ['projects'], queryFn: api.projects, refetchInterval: 30_000 });
  const items = q.data?.projects || (Array.isArray(q.data) ? q.data : []);

  return (
    <div>
      <SectionHeader title="Projetos ativos" sub="repositórios gerenciados no ecossistema nicebyte" />
      <QueryState query={q} skeleton={<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-40" />)}</div>}>
        {items.length === 0 ? <EmptyState icon={FolderGit2} title="Nenhum projeto registrado" /> : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((p) => {
              const repo = p.git_owner && p.git_repo ? `${p.git_owner}/${p.git_repo}` : null;
              const repoUrl = repo ? `https://github.com/${repo}` : null;
              return (
                <Spotlight key={p.slug || p.id} className="card card-interactive p-5 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-9 h-9 rounded-lg bg-subtle border border-line flex items-center justify-center text-faint flex-none">
                        <FolderGit2 size={16} strokeWidth={1.8} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-semibold text-fg truncate">{p.display_name || p.slug}</p>
                        {repo && <p className="data text-[10.5px] text-faint truncate">{repo}</p>}
                      </div>
                    </div>
                    {repoUrl && (
                      <a href={repoUrl} target="_blank" rel="noreferrer" className="text-faint hover:text-accent transition-colors flex-none" aria-label="Abrir repo">
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 data text-[10.5px] text-faint">
                    <GitBranch size={11} className="flex-none" />
                    <span className="truncate">{p.default_branch || 'main'}</span>
                    {p.codereview_model && <span className="ml-auto truncate text-faint">{p.codereview_model}</span>}
                  </div>

                  <div className="flex flex-wrap gap-1.5 mt-auto pt-1">
                    {p.codereview_enabled && (
                      <Badge tone="accent" dot={false} className="gap-1"><ShieldCheck size={10} /> review{p.codereview_auto ? ' · auto' : ''}</Badge>
                    )}
                    {p.attack_auto && (
                      <Badge tone="warn" dot={false} className="gap-1"><Swords size={10} /> attack auto</Badge>
                    )}
                    {p.auto_merge_on_consensus && <Badge tone="ok" dot={false}>auto-merge</Badge>}
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
