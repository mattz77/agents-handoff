import { randomUUID } from "node:crypto";
import { redis } from "../infra/redis";

// Kanban de tasks delegadas a agente — persistido em Redis (hash por task + sorted set de índice).
const INDEX_KEY = "agent:tasks:index"; // zset: score = created_at (ms), member = task id
const TASK_KEY = (id: string) => `agent:task:${id}`;

export type AgentTaskEngine = "nim" | "claude-cli";
export type AgentTaskStatus =
  | "queued" | "running" | "awaiting_review" | "approved" | "merged" | "rejected" | "failed";

export interface AgentTaskLogEntry {
  at: string;
  message: string;
}

export interface AgentTask {
  id: string;
  title: string;
  description: string;
  project_slug: string;
  engine: AgentTaskEngine;
  status: AgentTaskStatus;
  model: string | null;
  branch: string | null;
  pr_number: number | null;
  pr_url: string | null;
  error: string | null;
  log: AgentTaskLogEntry[];
  created_at: string;
  updated_at: string;
}

function serialize(t: AgentTask): Record<string, string> {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    project_slug: t.project_slug,
    engine: t.engine,
    status: t.status,
    model: t.model ?? "",
    branch: t.branch ?? "",
    pr_number: t.pr_number != null ? String(t.pr_number) : "",
    pr_url: t.pr_url ?? "",
    error: t.error ?? "",
    log: JSON.stringify(t.log),
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

function deserialize(h: Record<string, string>): AgentTask | null {
  if (!h || !h.id) return null;
  return {
    id: h.id,
    title: h.title,
    description: h.description,
    project_slug: h.project_slug,
    engine: h.engine as AgentTaskEngine,
    status: h.status as AgentTaskStatus,
    model: h.model || null,
    branch: h.branch || null,
    pr_number: h.pr_number ? Number(h.pr_number) : null,
    pr_url: h.pr_url || null,
    error: h.error || null,
    log: h.log ? JSON.parse(h.log) : [],
    created_at: h.created_at,
    updated_at: h.updated_at,
  };
}

export async function createAgentTask(input: {
  title: string; description: string; project_slug: string; engine: AgentTaskEngine; model?: string | null;
}): Promise<AgentTask> {
  const now = new Date().toISOString();
  const task: AgentTask = {
    id: randomUUID(),
    title: input.title,
    description: input.description,
    project_slug: input.project_slug,
    engine: input.engine,
    status: "queued",
    model: input.model || null,
    branch: null,
    pr_number: null,
    pr_url: null,
    error: null,
    log: [{ at: now, message: "Task criada — na fila." }],
    created_at: now,
    updated_at: now,
  };
  await redis.hset(TASK_KEY(task.id), serialize(task));
  await redis.zadd(INDEX_KEY, Date.now(), task.id);
  return task;
}

export async function listAgentTasks(): Promise<AgentTask[]> {
  const ids = await redis.zrevrange(INDEX_KEY, 0, 199);
  if (!ids.length) return [];
  const pipeline = redis.pipeline();
  ids.forEach((id) => pipeline.hgetall(TASK_KEY(id)));
  const results = await pipeline.exec();
  return (results || [])
    .map(([, h]) => deserialize(h as Record<string, string>))
    .filter((t): t is AgentTask => t !== null);
}

export async function getAgentTask(id: string): Promise<AgentTask | null> {
  const h = await redis.hgetall(TASK_KEY(id));
  return deserialize(h);
}

export async function updateAgentTask(id: string, patch: Partial<AgentTask>): Promise<void> {
  const current = await getAgentTask(id);
  if (!current) return;
  const next: AgentTask = { ...current, ...patch, updated_at: new Date().toISOString() };
  await redis.hset(TASK_KEY(id), serialize(next));
}

export async function appendAgentTaskLog(id: string, message: string): Promise<void> {
  const current = await getAgentTask(id);
  if (!current) return;
  current.log.push({ at: new Date().toISOString(), message });
  if (current.log.length > 200) current.log = current.log.slice(-200);
  await updateAgentTask(id, { log: current.log });
}

export async function deleteAgentTask(id: string): Promise<void> {
  await redis.del(TASK_KEY(id));
  await redis.zrem(INDEX_KEY, id);
}
