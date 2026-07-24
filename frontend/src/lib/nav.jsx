import {
  LayoutDashboard, ArrowLeftRight, Rocket,
  Bot, Cpu, Brain, Database,
  ShieldCheck, FolderGit2, Server,
} from 'lucide-react';

/* Navegação re-arquitetada: 10 seções flat → 4 grupos por domínio.
   Cada item: id, label, icon, descrição (subtitle do topbar), atalho opcional. */

export const NAV_GROUPS = [
  {
    id: 'operate',
    label: 'Operate',
    items: [
      {
        id: 'overview', label: 'Overview', icon: LayoutDashboard, kbd: 'G O',
        sub: 'Estado do sistema em tempo real — stream, filas e agentes',
      },
      {
        id: 'handoffs', label: 'Handoffs', icon: ArrowLeftRight, kbd: 'G H',
        sub: 'Stream, dead-letter queue, outbox e circuit breakers',
      },
      {
        id: 'deploy', label: 'Deploy', icon: Rocket, kbd: 'G D',
        sub: 'Rebuild e deploy dos projetos — fila do worker, log ao vivo',
      },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    items: [
      {
        id: 'agents', label: 'Agents', icon: Bot, kbd: 'G A',
        sub: 'Kanban de tasks delegadas — branch isolada e PR pra revisão',
      },
      {
        id: 'models', label: 'Models', icon: Cpu, kbd: 'G M',
        sub: 'Providers de IA — chaves, default e teste de conectividade',
      },
      {
        id: 'brain', label: 'LLM Brain', icon: Brain, kbd: 'G B',
        sub: 'Memória compartilhada — modelo ativo, decisões, fila e busca',
      },
      {
        id: 'datalake', label: 'DataLake', icon: Database, kbd: 'G L',
        sub: 'Google Drive 5 TB — memória de longo prazo dos agentes',
      },
    ],
  },
  {
    id: 'govern',
    label: 'Govern',
    items: [
      {
        id: 'codereview', label: 'Code Review', icon: ShieldCheck, kbd: 'G R',
        sub: 'Pipeline diário — riscos, verificação, PRs e integridade',
      },
      {
        id: 'projects', label: 'Projects', icon: FolderGit2, kbd: 'G P',
        sub: 'Repositórios e projetos ativos no ecossistema',
      },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      {
        id: 'infra', label: 'Infra', icon: Server, kbd: 'G I',
        sub: 'Containers, Redis HA, git e saúde do host',
      },
    ],
  },
];

export const NAV_FLAT = NAV_GROUPS.flatMap((g) => g.items);
export const navById = (id) => NAV_FLAT.find((n) => n.id === id);
