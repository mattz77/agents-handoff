/* Camada de acesso à API real do ops daemon.
   Substitui o legado window.HD (data-real.js IIFE). */

const BASE = '/ops/api';

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.error || body.message || detail;
    } catch { /* resposta não-JSON */ }
    throw new Error(`${res.status} · ${detail}`);
  }
  return res.json();
}

export const api = {
  // Command
  overview: () => req('/overview'),
  handoffs: () => req('/handoffs'),
  handoff: (id) => req(`/handoffs/${id}`),
  outbox: () => req('/outbox'),
  outboxStats: () => req('/outbox-stats'),
  dlq: () => req('/dlq'),
  alerts: () => req('/alerts'),
  breakers: () => req('/breakers'),
  timeline: () => req('/timeline'),
  replayDlq: (id) => req('/dlq/replay', { method: 'POST', body: JSON.stringify({ id }) }),

  // Intelligence
  brain: () => req('/brain'),
  brainSearch: (q) => req(`/brain/search?q=${encodeURIComponent(q)}`),
  addBrainTask: (task) => req('/brain/tasks', { method: 'POST', body: JSON.stringify(task) }),
  datalake: () => req('/datalake'),
  agentTasks: () => req('/agent-tasks'),
  agentTask: (id) => req(`/agent-tasks/${id}`),
  createAgentTask: (task) => req('/agent-tasks', { method: 'POST', body: JSON.stringify(task) }),
  retryAgentTask: (id) => req(`/agent-tasks/${id}/retry`, { method: 'POST' }),
  deleteAgentTask: (id) => req(`/agent-tasks/${id}`, { method: 'DELETE' }),
  providers: () => req('/settings/providers'),
  saveProviders: (data) => req('/settings/providers', { method: 'PUT', body: JSON.stringify(data) }),
  testProvider: (providerType) => req('/settings/providers/test', { method: 'POST', body: JSON.stringify({ providerType }) }),

  // Govern
  codereview: () => req('/codereview'),
  codereviewModels: () => req('/codereview/models'),
  codereviewPrs: () => req('/codereview/prs'),
  runCodereview: () => req('/codereview/run', { method: 'POST' }),
  codereviewRunStatus: () => req('/codereview/run-status'),
  projects: () => req('/projects'),

  // System
  docker: () => req('/docker'),
  redisHa: () => req('/redis-ha'),
  git: () => req('/git'),
  system: () => req('/system'),
  hermes: () => req('/hermes'),

  // Deploy
  deployProjects: () => req('/deploy/projects'),
  deployHistory: () => req('/deploy/history'),
  deployLatest: () => req('/deploy/latest'),
  runDeploy: (payload) => req('/deploy/run', { method: 'POST', body: JSON.stringify(payload) }),
  deployStreamUrl: () => `${BASE}/deploy/stream`,
};
