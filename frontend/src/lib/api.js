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
  approveAgentTask: (id) => req(`/agent-tasks/${id}/approve`, { method: 'POST' }),
  rejectAgentTask: (id) => req(`/agent-tasks/${id}/reject`, { method: 'POST' }),
  deleteAgentTask: (id) => req(`/agent-tasks/${id}`, { method: 'DELETE' }),
  providers: () => req('/settings/providers'),
  saveProvider: (data) => req('/settings/providers', { method: 'PUT', body: JSON.stringify(data) }),
  deleteProvider: (providerType) => req(`/settings/providers?providerType=${encodeURIComponent(providerType)}`, { method: 'DELETE' }),
  testProvider: (providerType) => req('/settings/providers/test', { method: 'POST', body: JSON.stringify({ providerType }) }),

  // Govern
  codereview: () => req('/codereview'),
  codereviewModels: () => req('/codereview/models'),
  codereviewPrs: (slug) => req(`/codereview/prs?slug=${encodeURIComponent(slug)}`),
  codereviewAttacks: (slug) => req(`/codereview/attacks${slug ? `?slug=${encodeURIComponent(slug)}` : ''}`),
  runCodereview: (payload) => req('/codereview/run', { method: 'POST', body: JSON.stringify(payload || {}) }),
  codereviewRunStatus: (slug) => req(`/codereview/run-status${slug ? `?slug=${encodeURIComponent(slug)}` : ''}`),
  runAttack: (payload) => req('/codereview/attack', { method: 'POST', body: JSON.stringify(payload) }),
  mergePr: (payload) => req('/codereview/merge', { method: 'POST', body: JSON.stringify(payload) }),
  conflicts: (slug, prNumber) => req(`/codereview/conflicts?slug=${encodeURIComponent(slug)}&prNumber=${prNumber}`),
  conflictStatus: (slug, prNumber) => req(`/codereview/conflicts/status?slug=${encodeURIComponent(slug)}&prNumber=${prNumber}`),
  resolveConflict: (payload) => req('/codereview/conflicts/resolve', { method: 'POST', body: JSON.stringify(payload) }),
  projects: () => req('/projects'),
  createProject: (p) => req('/projects', { method: 'POST', body: JSON.stringify(p) }),
  updateProject: (slug, p) => req(`/projects/${slug}`, { method: 'PATCH', body: JSON.stringify(p) }),

  // System
  docker: () => req('/docker'),
  redisHa: () => req('/redis-ha'),
  git: () => req('/git'),
  system: () => req('/system'),
  hermes: (correlationId) => req(`/hermes${correlationId ? `?correlation_id=${encodeURIComponent(correlationId)}` : ''}`),
  githubToken: () => req('/settings/github-token'),
  saveGithubToken: (token) => req('/settings/github-token', { method: 'PUT', body: JSON.stringify({ token }) }),

  // Deploy
  deployProjects: () => req('/deploy/projects'),
  createDeployProject: (p) => req('/deploy/projects', { method: 'POST', body: JSON.stringify(p) }),
  deployHistory: () => req('/deploy/history'),
  deployLatest: () => req('/deploy/latest'),
  runDeploy: (payload) => req('/deploy/run', { method: 'POST', body: JSON.stringify(payload) }),
  deployStreamUrl: () => `${BASE}/deploy/stream`,
};
