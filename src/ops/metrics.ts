import { pg } from "../infra/postgres";
import { redis } from "../infra/redis";
import fs from "node:fs";
import { execSync } from "node:child_process";

const STREAM = "handoff:stream";
const DLQ = "handoff:dlq";
export const ALERTS = "ops:alerts";
const GROUP = "g:ops";

export interface OverviewMetrics {
  handoffsByStatus: Record<string, number>;
  outboxByStatus: Record<string, number>;
  stream: { length: number; groups: number; pending: number };
  dlqLength: number;
  alertsLength: number;
  openBreakers: number;
  slo: { handoffP50Ms: number; handoffP95Ms: number; successRate: number; mttrMin: number; target: number };
  generatedAt: string;
}

/** Painel agregado — uma chamada para os cards do topo. */
export async function getOverview(): Promise<OverviewMetrics> {
  const [handoffsByStatus, outboxByStatus, stream, dlqLength, alertsLength, breakers, slo] =
    await Promise.all([
      countHandoffsByStatus(),
      countOutboxByStatus(),
      getStreamHealth(),
      safeXlen(DLQ),
      safeXlen(ALERTS),
      getBreakers(),
      getRealSLO(),
    ]);

  return {
    handoffsByStatus,
    outboxByStatus,
    stream,
    dlqLength,
    alertsLength,
    openBreakers: breakers.filter((b) => b.state === "OPEN").length,
    slo,
    generatedAt: new Date().toISOString(),
  };
}

async function getRealSLO() {
  try {
    // "Entregue" = handoff que chegou a um estado terminal de sucesso (DONE/COMPLETED).
    // 'DELIVERED' nunca existiu no domínio (ver LifecycleStatus em src/domain/handoff.ts) —
    // a versão anterior desta query sempre retornava 0 (bug, não falta de dado).
    const query = `
      WITH stats AS (
        SELECT
          EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000 AS duration_ms,
          lifecycle_status
        FROM handoffs
      ),
      delivered AS (
        SELECT duration_ms FROM stats WHERE lifecycle_status IN ('DONE', 'COMPLETED')
      ),
      failed AS (
        SELECT duration_ms FROM stats WHERE lifecycle_status = 'FAILED'
      )
      SELECT
        COALESCE((SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) FROM delivered), 0) AS p50,
        COALESCE((SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FROM delivered), 0) AS p95,
        COALESCE((SELECT AVG(duration_ms) / 60000 FROM failed), 0) AS mttr,
        COALESCE((SELECT COUNT(*) FROM delivered)::float / NULLIF((SELECT COUNT(*) FROM stats WHERE lifecycle_status IN ('DONE','COMPLETED','FAILED')), 0), 0) * 100 AS success_rate
    `;
    const { rows } = await pg.query(query);
    const row = rows[0];
    return {
      handoffP50Ms: Math.round(Number(row.p50)),
      handoffP95Ms: Math.round(Number(row.p95)),
      successRate: Math.round(Number(row.success_rate)),
      mttrMin: Math.round(Number(row.mttr)),
      target: 3000 // Fixed target 3 seconds
    };
  } catch (e) {
    console.error("Erro ao calcular SLO:", e);
    return { handoffP50Ms: 0, handoffP95Ms: 0, successRate: 0, mttrMin: 0, target: 3000 };
  }
}

async function countHandoffsByStatus(): Promise<Record<string, number>> {
  const { rows } = await pg.query<{ lifecycle_status: string; n: string }>(
    `select lifecycle_status, count(*)::text as n from handoffs group by lifecycle_status`
  );
  return Object.fromEntries(rows.map((r) => [r.lifecycle_status, Number(r.n)]));
}

async function countOutboxByStatus(): Promise<Record<string, number>> {
  const { rows } = await pg.query<{ status: string; n: string }>(
    `select status, count(*)::text as n from outbox group by status`
  );
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

async function getStreamHealth(): Promise<{ length: number; groups: number; pending: number }> {
  try {
    const info = (await redis.xinfo("STREAM", STREAM)) as any[];
    const length = pairValue(info, "length") ?? 0;
    const groups = pairValue(info, "groups") ?? 0;
    let pending = 0;
    try {
      const p = (await redis.xpending(STREAM, GROUP)) as any[];
      pending = Number(p?.[0] ?? 0);
    } catch {
      /* grupo ainda não criado */
    }
    return { length: Number(length), groups: Number(groups), pending };
  } catch {
    return { length: 0, groups: 0, pending: 0 };
  }
}

async function safeXlen(key: string): Promise<number> {
  try {
    return await redis.xlen(key);
  } catch {
    return 0;
  }
}

/** Lê o estado dos circuit breakers via scan de chaves cb:*:state. */
export async function getBreakers(): Promise<
  Array<{ key: string; state: string; openedAt: number | null; fails: number }>
> {
  const stateKeys: string[] = [];
  let cursor = "0";
  do {
    const [next, found] = await redis.scan(cursor, "MATCH", "cb:*:state", "COUNT", 100);
    cursor = next;
    stateKeys.push(...found);
  } while (cursor !== "0");

  const breakers = await Promise.all(
    stateKeys.map(async (sk) => {
      const base = sk.replace(/:state$/, "");
      const key = base.replace(/^cb:/, "");
      const [state, openedAt, fails] = await redis.mget(
        sk,
        `${base}:openedAt`,
        `${base}:fails`
      );
      return {
        key,
        state: state ?? "UNKNOWN",
        openedAt: openedAt ? Number(openedAt) : null,
        fails: fails ? Number(fails) : 0,
      };
    })
  );
  return breakers.sort((a, b) => a.key.localeCompare(b.key));
}

/** Handoffs recentes da auditoria (Postgres). */
export async function getRecentHandoffs(limit = 50, status?: string) {
  const params: any[] = [];
  let where = "";
  if (status) {
    params.push(status);
    where = `where lifecycle_status = $1`;
  }
  params.push(Math.min(limit, 200));
  // LEFT JOIN LATERAL: anexa a auditoria Hermes mais recente por correlation_id (se houver).
  const { rows } = await pg.query(
    `select h.task_id, h.correlation_id, h.project, h.branch, h.lifecycle_status, h.sender, h.receiver,
            h.attempt, h.created_at, h.updated_at,
            h.payload->>'pending_action_item' as pending_action,
            ha.severidade as hermes_severidade, ha.nota as hermes_nota, ha.resumo as hermes_resumo
       from handoffs h
       left join lateral (
         select severidade, nota, resumo from hermes_audits a
          where a.correlation_id = h.correlation_id
          order by a.created_at desc limit 1
       ) ha on true
       ${where ? where.replace(/\b(lifecycle_status)\b/g, "h.$1") : ""}
       order by h.updated_at desc
       limit $${params.length}`,
    params
  );
  return rows;
}

/** Auditorias do Hermes, mais recentes primeiro (opcional por correlation_id). */
export async function getHermesAudits(limit = 50, correlationId?: string) {
  const params: any[] = [];
  let where = "";
  if (correlationId) {
    params.push(correlationId);
    where = `where correlation_id = $1`;
  }
  params.push(Math.min(limit, 200));
  const { rows } = await pg.query(
    `select id, correlation_id, handoff_task_id, project, nota, severidade, riscos, resumo, created_at
       from hermes_audits ${where}
       order by created_at desc
       limit $${params.length}`,
    params
  );
  return rows;
}

/** Detalhes completos de um handoff (payload JSON) para o LLM Brain Inspector */
export async function getHandoffDetails(taskId: string) {
  const { rows } = await pg.query(
    `select * from handoffs where task_id = $1 limit 1`,
    [taskId]
  );
  return rows[0] || null;
}

/** Itens do outbox — foco nos que estão represados. */
export async function getOutbox(limit = 50, status?: string) {
  const params: any[] = [];
  let where = "";
  if (status) {
    params.push(status);
    where = `where status = $1`;
  }
  params.push(Math.min(limit, 200));
  const { rows } = await pg.query(
    `select id, aggregate_id, event_type, status, attempts, created_at, sent_at
       from outbox ${where}
       order by id desc
       limit $${params.length}`,
    params
  );
  return rows;
}

/** Entradas da DLQ (Redis stream handoff:dlq), mais recentes primeiro. */
export async function getDlq(limit = 50) {
  let entries: [string, string[]][] = [];
  try {
    entries = (await redis.xrevrange(DLQ, "+", "-", "COUNT", Math.min(limit, 200))) as any;
  } catch {
    return [];
  }
  return entries.map(([id, fields]) => {
    const data = parseFields(fields);
    return {
      id,
      task_id: data?.task_id ?? null,
      correlation_id: data?.correlation_id ?? null,
      project: data?.project ?? null,
      reason: data?._dlq_reason ?? null,
      dlq_at: data?._dlq_at ?? null,
      original_status: data?._dlq_original_status ?? null,
      attempt: data?.attempt ?? null,
      payload: data ?? null,
    };
  });
}

/** Guard-rail: dispara alerta se HOT files do Brain passarem do limite (TASK 35 Fase 6). */
export async function checkBrainSizeAlert(): Promise<void> {
  const status = getBrainStatus();
  if (!status.hotSizeAlert) return;
  try {
    await redis.xadd(
      ALERTS,
      "*",
      "data",
      JSON.stringify({
        level: "WARN",
        msg: `LLM-Brain HOT files em ${status.hotSizeKB}KB (> ${HOT_ALERT_LIMIT_KB}KB) — rodar brain-compact.js`,
        at: new Date().toISOString(),
      })
    );
  } catch (err) {
    console.error("[metrics] falha ao publicar alerta de brain size:", err);
  }
}

/** Alertas operacionais recentes. */
export async function getAlerts(limit = 30) {
  let entries: [string, string[]][] = [];
  try {
    entries = (await redis.xrevrange(ALERTS, "+", "-", "COUNT", Math.min(limit, 100))) as any;
  } catch {
    return [];
  }
  return entries.map(([id, fields]) => {
    const data = parseFields(fields);
    return { id, level: data?.level ?? "INFO", msg: data?.msg ?? "", at: data?.at ?? null };
  });
}

// ---- helpers ----

function pairValue(arr: any[], key: string): any {
  for (let i = 0; i < arr.length - 1; i += 2) {
    if (arr[i] === key) return arr[i + 1];
  }
  return undefined;
}

function parseFields(fields: string[]): any {
  const idx = fields.indexOf("data");
  const raw = idx >= 0 ? fields[idx + 1] : fields[1];
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── LLM-Brain + DataLake + System ─────────────────────────────────

const BRAIN_DIR = process.env.LLM_BRAIN_DIR || "/data/llm-brain";
const DATALAKE_DIR = process.env.DATALAKE_DIR || "/data/datalake";

function safeReadFile(path: string): string | null {
  try { return fs.readFileSync(path, "utf-8"); } catch { return null; }
}

export interface NewBrainTask {
  title: string;
  project?: string;
  commit?: string;
  assigned?: string;
  priority?: string;
  context?: string;
  action?: string;
  expected?: string;
}

/** Insere uma nova task [pending] no topo de task-queue.md (logo após o cabeçalho de convenção). */
export function appendBrainTask(t: NewBrainTask): { ok: boolean; error?: string } {
  const filePath = `${BRAIN_DIR}/task-queue.md`;
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    return { ok: false, error: `Não foi possível ler task-queue.md: ${(e as Error).message}` };
  }

  const block = [
    `## [pending] ${t.title}`,
    "",
    `**Assigned:** ${t.assigned || "Claude"}`,
    `**Created by:** Painel /ops (Code Review)`,
    `**Prioridade:** ${t.priority || "média"}`,
    ...(t.project ? [`**Projeto:** ${t.project}`] : []),
    ...(t.commit ? [`**Commit:** ${t.commit}`] : []),
    "",
    "### Contexto",
    t.context || (t.project ? `Gerada a partir de issue de code review no projeto ${t.project}.` : "Gerada a partir do painel /ops."),
    "",
    "### O que fazer",
    t.action || "(preencher)",
    "",
    "### Resultado esperado",
    t.expected || "(preencher)",
    "",
    "### Resultado",
    "_[preencher]_",
    "",
    "---",
    "",
  ].join("\n");

  const marker = text.indexOf("\n---\n");
  const insertAt = marker === -1 ? 0 : marker + 5;
  const updated = text.slice(0, insertAt) + block + text.slice(insertAt);

  try {
    fs.writeFileSync(filePath, updated, "utf-8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Falha ao escrever task-queue.md (mount read-only?): ${(e as Error).message}` };
  }
}

function safeStat(path: string): fs.Stats | null {
  try { return fs.statSync(path); } catch { return null; }
}

function safeExec(cmd: string, timeout = 5000): string {
  try { return execSync(cmd, { encoding: "utf-8", timeout, stdio: ["pipe", "pipe", "pipe"] }).trim(); } catch { return ""; }
}

export interface BrainStatus {
  activeModel: string;
  lastSync: string;
  currentTask: string;
  pendingTasks: number;
  completedTasks: number;
  blockedTasks: number;
  recentDecisions: Array<{ date: string; title: string; model: string }>;
  infraHealth: string;
  taskList: Array<{ title: string; status: string; assigned: string; priority: string; project?: string; commit?: string }>;
  hotSizeKB: number;
  hotSizeAlert: boolean;
}

const HOT_ALERT_LIMIT_KB = 40;

export function getBrainStatus(): BrainStatus {
  const ctx = safeReadFile(`${BRAIN_DIR}/active-context.md`) ?? "";
  const tq = safeReadFile(`${BRAIN_DIR}/task-queue.md`) ?? "";
  const dec = safeReadFile(`${BRAIN_DIR}/decisions.md`) ?? "";

  const hotBytes = Buffer.byteLength(ctx, "utf-8") + Buffer.byteLength(tq, "utf-8");
  const hotSizeKB = Math.round((hotBytes / 1024) * 10) / 10;
  const hotSizeAlert = hotSizeKB > HOT_ALERT_LIMIT_KB;

  const modelMatch = ctx.match(/## Modelo ativo\n(.+)/);
  const syncMatch = ctx.match(/Última Sincronização:\s*(.+?)(?:\s*\(|$)/m);
  const taskMatch = ctx.match(/## Tarefa atual\n(.+)/);
  const healthMatch = ctx.match(/### handoff-daemon \/health\n(.+)/);

  const taskBlocks = tq.match(/## \[(pending|in_progress|done|blocked)\]/gi) ?? [];
  let pending = 0, done = 0, blocked = 0;
  for (const b of taskBlocks) {
    if (/pending/i.test(b)) pending++;
    else if (/done/i.test(b)) done++;
    else if (/blocked/i.test(b)) blocked++;
  }

  const taskList: BrainStatus["taskList"] = [];
  const headerRegex = /## \[(pending|in_progress|done|blocked)\]\s*(?:TASK \d+ — )?(.+)/gi;
  let m;
  while ((m = headerRegex.exec(tq)) !== null) {
    const next = tq.indexOf("\n## ", m.index + 1);
    const block = tq.slice(m.index, next === -1 ? undefined : next);
    const field = (name: string) => block.match(new RegExp(`\\*\\*${name}:\\*\\*\\s*(.+)`))?.[1]?.trim();
    taskList.push({
      status: m[1],
      title: m[2].trim(),
      assigned: field("Assigned") ?? "—",
      priority: field("Prioridade") ?? "—",
      project: field("Projeto"),
      commit: field("Commit"),
    });
  }

  const decisions: BrainStatus["recentDecisions"] = [];
  const decRegex = /## \[(\d{4}-\d{2}-\d{2})\]\s+(.+)\n\*\*Modelo:\*\*\s*(.+)/g;
  while ((m = decRegex.exec(dec)) !== null) {
    decisions.push({ date: m[1], title: m[2].trim(), model: m[3].trim() });
  }

  return {
    activeModel: modelMatch?.[1]?.trim() ?? "Unknown",
    lastSync: syncMatch?.[1]?.trim() ?? "—",
    currentTask: taskMatch?.[1]?.trim() ?? "Nenhuma",
    pendingTasks: pending,
    completedTasks: done,
    blockedTasks: blocked,
    recentDecisions: decisions.slice(-5).reverse(),
    infraHealth: healthMatch?.[1]?.trim() ?? "Unknown",
    taskList: taskList.slice(0, 10),
    hotSizeKB,
    hotSizeAlert,
  };
}

export interface DataLakeDirStat {
  name: string;
  files: number;
  sizeMB: number;
  updated: string;
}

export interface BackupEngineStat {
  engine: string;       // Postgres | MySQL | Redis | SQL_Server
  project: string;      // subdir do projeto
  count: number;        // nº de snapshots
  sizeMB: number;       // soma dos dumps
  lastAt: string;       // ISO do mais recente
}

export interface RestoreCheckStat {
  lastRunAt: string | null;
  ok: boolean;
  total: number;
  passed: number;
  failed: Array<{ engine: string; project: string; reason: string }>;
  byTarget: Record<string, { ok: boolean; checkedAt: string | null; reason?: string }>;
}

export interface MemoryStat {
  corpusFiles: number;
  vectorCount: number;
  lastIngest: string | null;
  hasLance: boolean;
}

export interface N8nWorkflowsStat {
  orgs: Array<{ name: string; projects: number; workflows: number; sizeMB: number }>;
  totalWorkflows: number;
  lastBackup: string | null;
}

export interface DataLakeStats {
  totalSizeMB: number;
  capacityMB: number;
  backupCount: number;
  lastBackup: string;
  lastSync: string;
  backups: BackupEngineStat[];
  restoreChecks: RestoreCheckStat;
  knowledge: DataLakeDirStat[];
  knowledgeAreas: DataLakeDirStat[];   // alias p/ compat
  projects: DataLakeDirStat[];
  projectDirs: DataLakeDirStat[];      // alias p/ compat
  memory: MemoryStat;
  n8nWorkflows: N8nWorkflowsStat;
}

const DATALAKE_CAPACITY_MB = 5 * 1024 * 1024; // 5 TB Google Workspace

let cachedDataLakeStats: DataLakeStats = {
  totalSizeMB: 0,
  capacityMB: DATALAKE_CAPACITY_MB,
  backupCount: 0,
  lastBackup: "—",
  lastSync: new Date().toISOString(),
  backups: [],
  restoreChecks: { lastRunAt: null, ok: true, total: 0, passed: 0, failed: [], byTarget: {} },
  knowledge: [],
  knowledgeAreas: [],
  projects: [],
  projectDirs: [],
  memory: { corpusFiles: 0, vectorCount: 0, lastIngest: null, hasLance: false },
  n8nWorkflows: { orgs: [], totalWorkflows: 0, lastBackup: null },
};

let isDatalakeUpdating = false;

/** Extensões reconhecidas como dump de banco. */
const DUMP_EXT = /\.(sql\.gz|sql|dump|gz|rdb)$/i;

async function asyncDirStat(dirPath: string, name: string): Promise<DataLakeDirStat> {
  const stat = { size: 0, files: 0, newestTime: 0 };
  async function walk(dir: string) {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          await walk(p);
        } else {
          try {
            const s = await fs.promises.stat(p);
            stat.size += s.size;
            stat.files += 1;
            if (s.mtimeMs > stat.newestTime) stat.newestTime = s.mtimeMs;
          } catch {}
        }
      }
    } catch {}
  }
  await walk(dirPath);
  return {
    name,
    files: stat.files,
    sizeMB: Math.round(stat.size / 1024 / 1024),
    updated: stat.newestTime > 0 ? new Date(stat.newestTime).toISOString() : new Date().toISOString()
  };
}

/** Inclui subdirs nomeados como data (YYYY-MM-DD ou YYYY-MM-DD_HHMM) ao varrer snapshots. */
const DATE_DIR_RE = /^\d{4}-\d{2}-\d{2}([_T]\d+)?$/;

/** Infere a engine a partir do nome do dump quando só há a pasta de data (layout B). */
function engineOf(fileName: string): string | null {
  const n = fileName.toLowerCase();
  if (/postgres|pg-|\.sql(\.gz)?$/i.test(n) && !/redis|mysql|mssql|sqlserver/i.test(n)) return "Postgres";
  if (/redis|\.rdb$/i.test(n)) return "Redis";
  if (/mysql|maria/i.test(n)) return "MySQL";
  if (/sql.?server|mssql|\.bak$/i.test(n)) return "SQL_Server";
  return null;
}

/** Varre Backups/Databases/ suportando os dois layouts de snapshot:
 *  - A: <engine>/<project>/<dump>           (1 dump = 1 projeto nomeado)
 *  - B: <YYYY-MM-DD[_HHMM]>/<dump>          (snapshots diários flat, engine inferida do nome) */
async function scanBackups(): Promise<{ backups: BackupEngineStat[]; total: number; lastBackup: string }> {
  const dbRoot = `${DATALAKE_DIR}/Backups/Databases`;
  const out: BackupEngineStat[] = [];
  let lastTime = 0;
  let lastBackup = "—";
  let totalSnapshots = 0;

  let engines: fs.Dirent[] = [];
  try { engines = await fs.promises.readdir(dbRoot, { withFileTypes: true }); } catch { return { backups: [], total: 0, lastBackup: "—" }; }

  for (const eng of engines) {
    if (!eng.isDirectory() || eng.name.startsWith("_")) continue;   // ignora _restore_checks, _corrupt
    const engPath = `${dbRoot}/${eng.name}`;
    let projects: fs.Dirent[] = [];
    try { projects = await fs.promises.readdir(engPath, { withFileTypes: true }); } catch { continue; }
    for (const proj of projects) {
      if (!proj.isDirectory() || proj.name.startsWith(".")) continue;
      const projPath = `${engPath}/${proj.name}`;
      const agg = { count: 0, size: 0, newestTime: 0 };
      await walkDumps(projPath, agg);
      if (agg.count === 0) continue;   // dir vazio não aparece
      totalSnapshots += agg.count;
      if (agg.newestTime > lastTime) { lastTime = agg.newestTime; lastBackup = new Date(agg.newestTime).toISOString(); }
      out.push({
        engine: eng.name,
        project: proj.name,
        count: agg.count,
        sizeMB: Math.round(agg.size / 1024 / 1024),
        lastAt: agg.newestTime > 0 ? new Date(agg.newestTime).toISOString() : "—",
      });
    }
  }

  // Layout B — pasta de data com dumps flat (engine inferida do nome do arquivo).
  // Acumula por engine num pseudo-projeto "<date>".
  for (const d of engines) {
    if (!d.isDirectory() || !DATE_DIR_RE.test(d.name)) continue;
    const datePath = `${dbRoot}/${d.name}`;
    const byEngine = new Map<string, { count: number; size: number; newestTime: number }>();
    await walkDumpsFlat(datePath, (file, size, mtime) => {
      const inferred = engineOf(file);
      if (!inferred) return;          // dump sem engine reconhecível é ignorado
      const cur = byEngine.get(inferred) || { count: 0, size: 0, newestTime: 0 };
      cur.count += 1; cur.size += size; if (mtime > cur.newestTime) cur.newestTime = mtime;
      byEngine.set(inferred, cur);
    });
    for (const [inferred, agg] of byEngine) {
      totalSnapshots += agg.count;
      if (agg.newestTime > lastTime) { lastTime = agg.newestTime; lastBackup = new Date(agg.newestTime).toISOString(); }
      out.push({
        engine: inferred,
        project: d.name,
        count: agg.count,
        sizeMB: Math.round(agg.size / 1024 / 1024),
        lastAt: agg.newestTime > 0 ? new Date(agg.newestTime).toISOString() : "—",
      });
    }
  }

  out.sort((a, b) => a.engine.localeCompare(b.engine) || a.project.localeCompare(b.project));
  return { backups: out, total: totalSnapshots, lastBackup };

  async function walkDumps(dir: string, agg: { count: number; size: number; newestTime: number }) {
    let entries: fs.Dirent[] = [];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) { await walkDumps(p, agg); continue; }
      if (!DUMP_EXT.test(e.name)) continue;
      try {
        const s = await fs.promises.stat(p);
        agg.count += 1;
        agg.size += s.size;
        if (s.mtimeMs > agg.newestTime) agg.newestTime = s.mtimeMs;
      } catch {}
    }
  }

  async function walkDumpsFlat(dir: string, emit: (file: string, size: number, mtime: number) => void) {
    let entries: fs.Dirent[] = [];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) { await walkDumpsFlat(p, emit); continue; }
      if (!DUMP_EXT.test(e.name)) continue;
      try {
        const s = await fs.promises.stat(p);
        emit(e.name, s.size, s.mtimeMs);
      } catch {}
    }
  }
}

/** Lê _restore_checks/<engine>/<project>/<date>.json — resultado do restore-check.js. */
async function scanRestoreChecks(): Promise<RestoreCheckStat> {
  const root = `${DATALAKE_DIR}/Backups/_restore_checks`;
  const byTarget: Record<string, { ok: boolean; checkedAt: string | null; reason?: string }> = {};
  let lastRunAt: number | null = null;
  let total = 0, passed = 0;
  const failed: Array<{ engine: string; project: string; reason: string }> = [];

  let engines: fs.Dirent[] = [];
  try { engines = await fs.promises.readdir(root, { withFileTypes: true }); } catch {
    return { lastRunAt: null, ok: true, total: 0, passed: 0, failed: [], byTarget: {} };
  }

  for (const eng of engines) {
    if (!eng.isDirectory()) continue;
    const engPath = `${root}/${eng.name}`;
    let projects: fs.Dirent[] = [];
    try { projects = await fs.promises.readdir(engPath, { withFileTypes: true }); } catch { continue; }
    for (const proj of projects) {
      if (!proj.isDirectory()) continue;
      const projPath = `${engPath}/${proj.name}`;
      let jsons: string[] = [];
      try { jsons = (await fs.promises.readdir(projPath)).filter(f => f.endsWith(".json")); } catch { continue; }
      if (!jsons.length) continue;
      jsons.sort();   // YYYY-MM-DD.json — pega o mais recente
      const latest = jsons[jsons.length - 1];
      try {
        const raw = await fs.promises.readFile(`${projPath}/${latest}`, "utf-8");
        const data = JSON.parse(raw);
        const key = `${eng.name}/${proj.name}`;
        const checkedAt = data.checkedAt ? Date.parse(data.checkedAt) : null;
        total += 1;
        if (data.ok) { passed += 1; } else { failed.push({ engine: eng.name, project: proj.name, reason: data.reason || "unknown" }); }
        if (checkedAt && (lastRunAt === null || checkedAt > lastRunAt)) lastRunAt = checkedAt;
        byTarget[key] = { ok: !!data.ok, checkedAt: data.checkedAt ?? null, reason: data.reason };
      } catch {}
    }
  }

  return {
    lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
    ok: failed.length === 0 && total > 0,
    total,
    passed,
    failed,
    byTarget,
  };
}

/** Memory/RAG: conta corpus (.md), lê ingest-log.jsonl, checa lance/. */
async function scanMemory(): Promise<MemoryStat> {
  const memDir = `${DATALAKE_DIR}/Memory`;
  const corpusDir = await dirExists(`${memDir}/sources`) ? `${memDir}/sources`
    : await dirExists(`${memDir}/corpus`) ? `${memDir}/corpus` : null;

  let corpusFiles = 0;
  if (corpusDir) {
    corpusFiles = await countFiles(corpusDir, ".md");
  }

  // ingest-log.jsonl — última linha tem o último ingest
  let vectorCount = 0;
  let lastIngest: string | null = null;
  try {
    const log = await fs.promises.readFile(`${memDir}/ingest-log.jsonl`, "utf-8");
    const lines = log.split("\n").filter(Boolean);
    vectorCount = lines.length;
    if (lines.length) {
      const last = JSON.parse(lines[lines.length - 1]);
      lastIngest = last.ingestedAt || last.ts || null;
    }
  } catch {}

  const hasLance = await dirExists(`${memDir}/lance`);

  return { corpusFiles, vectorCount, lastIngest, hasLance };
}

/** n8n-workflows: <org>/<project>/ quantos .json por org + total. */
async function scanN8n(): Promise<N8nWorkflowsStat> {
  const root = `${DATALAKE_DIR}/Backups/n8n-workflows`;
  const orgs: N8nWorkflowsStat["orgs"] = [];
  let totalWorkflows = 0;
  let lastTime: number | null = null;

  let entries: fs.Dirent[] = [];
  try { entries = await fs.promises.readdir(root, { withFileTypes: true }); } catch {
    return { orgs: [], totalWorkflows: 0, lastBackup: null };
  }
  // Ignora arquivos soltos (n8n-knowledge-transfer.md etc.); só dirs = orgs
  for (const org of entries) {
    if (!org.isDirectory() || org.name.startsWith(".")) continue;
    const orgPath = `${root}/${org.name}`;
    const agg = { projects: new Set<string>(), workflows: 0, size: 0, newestTime: 0 };
    await walkWorkflows(orgPath, agg, "");
    if (agg.workflows === 0) continue;
    totalWorkflows += agg.workflows;
    if (agg.newestTime > 0 && (lastTime === null || agg.newestTime > lastTime)) lastTime = agg.newestTime;
    orgs.push({
      name: org.name,
      projects: agg.projects.size,
      workflows: agg.workflows,
      sizeMB: Math.round(agg.size / 1024 / 1024),
    });
  }
  orgs.sort((a, b) => b.workflows - a.workflows);
  return { orgs, totalWorkflows, lastBackup: lastTime ? new Date(lastTime).toISOString() : null };

  async function walkWorkflows(dir: string, agg: { projects: Set<string>; workflows: number; size: number; newestTime: number }, project: string) {
    let es: fs.Dirent[] = [];
    try { es = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        await walkWorkflows(p, agg, project || e.name);
      } else if (e.name.endsWith(".json")) {
        if (project) agg.projects.add(project);
        agg.workflows += 1;
        try {
          const s = await fs.promises.stat(p);
          agg.size += s.size;
          if (s.mtimeMs > agg.newestTime) agg.newestTime = s.mtimeMs;
        } catch {}
      }
    }
  }
}

async function dirExists(p: string): Promise<boolean> {
  try { return (await fs.promises.stat(p)).isDirectory(); } catch { return false; }
}

async function countFiles(dir: string, ext: string): Promise<number> {
  let n = 0;
  async function walk(d: string) {
    let es: fs.Dirent[] = [];
    try { es = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(ext)) n += 1;
    }
  }
  await walk(dir);
  return n;
}

async function updateDataLakeStats() {
  if (isDatalakeUpdating) return;
  isDatalakeUpdating = true;
  try {
    const kbDir = `${DATALAKE_DIR}/Knowledge_Base`;
    const projDir = `${DATALAKE_DIR}/Projetos`;

    const [backupsScan, restoreChecks, memory, n8nWorkflows] = await Promise.all([
      scanBackups(),
      scanRestoreChecks(),
      scanMemory(),
      scanN8n(),
    ]);

    let kbAreasNames: string[] = [];
    try {
      const entries = await fs.promises.readdir(kbDir, { withFileTypes: true });
      kbAreasNames = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {}
    const knowledge = await Promise.all(kbAreasNames.map(name => asyncDirStat(`${kbDir}/${name}`, name)));

    let projDirsNames: string[] = [];
    try {
      const entries = await fs.promises.readdir(projDir, { withFileTypes: true });
      projDirsNames = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {}
    const projects = await Promise.all(projDirsNames.map(name => asyncDirStat(`${projDir}/${name}`, name)));

    // Total size = walk tudo exceto scripts/_corrupt/_restore_checks (ruído de infra, não "memória")
    const totalStat = { size: 0 };
    async function walkAll(dir: string, depth = 0) {
      let es: fs.Dirent[] = [];
      try { es = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of es) {
        // pula scripts e pastas internas de checagem/corrompidas (não são conteúdo do lago)
        if (depth > 0 && (e.name === "scripts" || e.name === "_corrupt")) continue;
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) await walkAll(p, depth + 1);
        else {
          try { totalStat.size += (await fs.promises.stat(p)).size; } catch {}
        }
      }
    }
    await walkAll(DATALAKE_DIR);

    cachedDataLakeStats = {
      totalSizeMB: Math.round(totalStat.size / 1024 / 1024),
      capacityMB: DATALAKE_CAPACITY_MB,
      backupCount: backupsScan.total,
      lastBackup: backupsScan.lastBackup,
      lastSync: new Date().toISOString(),
      backups: backupsScan.backups,
      restoreChecks,
      knowledge,
      knowledgeAreas: knowledge,      // alias
      projects,
      projectDirs: projects,          // alias
      memory,
      n8nWorkflows,
    };
  } finally {
    isDatalakeUpdating = false;
  }
}

// Start background loop
setInterval(updateDataLakeStats, 15 * 60 * 1000); // 15 mins
updateDataLakeStats().catch(() => {});

export function getDataLakeStats(): DataLakeStats {
  return cachedDataLakeStats;
}

export interface DockerStatus {
  containers: Array<{ name: string; status: string; image: string; state: string; uptime: string }>;
  totalRunning: number;
  totalStopped: number;
}

export async function getDockerStatus(): Promise<DockerStatus> {
  const proxyHost = process.env.DOCKER_PROXY_HOST || "docker-socket-proxy";
  const proxyPort = process.env.DOCKER_PROXY_PORT || "2375";
  try {
    const res = await fetch(`http://${proxyHost}:${proxyPort}/containers/json?all=true`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as any[];
    const containers = data.map(c => {
      const name = (c.Names?.[0] ?? "").replace(/^\//, "");
      const state = c.State ?? "unknown";
      const statusStr = c.Status ?? "";
      const upMatch = statusStr.match(/Up\s+(.+?)(?:\s+\(|$)/);
      return {
        name,
        status: state === "running" ? "running" : "stopped",
        image: (c.Image ?? "").split(":")[0].split("/").pop() ?? "",
        state,
        uptime: upMatch?.[1] ?? (state === "running" ? statusStr : "—"),
      };
    });
    return {
      containers: containers.sort((a, b) => a.name.localeCompare(b.name)),
      totalRunning: containers.filter(c => c.status === "running").length,
      totalStopped: containers.filter(c => c.status !== "running").length,
    };
  } catch {
    return { containers: [], totalRunning: 0, totalStopped: 0 };
  }
}

export interface RedisHAStatus {
  status: "ok" | "degraded" | "unknown";
  quorum: number;
  master: { host: string; port: number; name?: string };
  replicas: Array<{ host: string; port: number; state: string; name: string; lagBytes: number }>;
  sentinels: Array<{ host: string; port: number; state: string; name: string }>;
}

const SENTINEL_NODES = [
  { host: "sentinel-1", port: 26379 },
  { host: "sentinel-2", port: 26379 },
  { host: "sentinel-3", port: 26379 },
];

// ioredis não expõe SENTINEL masters/replicas/sentinels no cliente já conectado ao master
// (esse fala com redis-master, não sentinel) — abre conexão avulsa curta a um sentinel vivo.
export async function getRedisHA(): Promise<RedisHAStatus> {
  const IORedisClient: any = require("ioredis");
  for (const node of SENTINEL_NODES) {
    let sc: any;
    try {
      sc = new IORedisClient({ host: node.host, port: node.port, connectTimeout: 1500, lazyConnect: true, retryStrategy: () => null });
      await sc.connect();
      const [masterInfo, replicas, sentinels] = await Promise.all([
        sc.call("sentinel", "master", "mymaster") as Promise<string[]>,
        sc.call("sentinel", "replicas", "mymaster") as Promise<string[][]>,
        sc.call("sentinel", "sentinels", "mymaster") as Promise<string[][]>,
      ]);
      const kv = (arr: string[]) => { const o: Record<string, string> = {}; for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1]; return o; };
      const m = kv(masterInfo);
      const quorum = Number(m["quorum"] ?? sentinels.length + 1);
      return {
        status: "ok",
        quorum,
        master: { host: m["ip"] ?? "—", port: Number(m["port"] ?? 6379), name: m["name"] ?? "mymaster" },
        replicas: replicas.map((r) => {
          const o = kv(r);
          return {
            host: o["ip"] ?? "—", port: Number(o["port"] ?? 6379),
            state: o["master-link-status"] ?? o["flags"] ?? "unknown",
            name: o["name"] ?? `${o["ip"] ?? "replica"}:${o["port"] ?? ""}`,
            lagBytes: Math.max(0, Number(m["master-repl-offset"] ?? 0) - Number(o["slave-repl-offset"] ?? 0)),
          };
        }),
        sentinels: (() => {
          const others = SENTINEL_NODES.filter((n) => n.host !== node.host);
          return [
            { host: node.host, port: node.port, state: "connected", name: node.host },
            ...sentinels.map((s, i) => {
              const o = kv(s);
              return { host: o["ip"] ?? "—", port: Number(o["port"] ?? 26379), state: (o["flags"] ?? "").includes("down") ? "down" : "connected", name: others[i]?.host ?? o["ip"] ?? "sentinel" };
            }),
          ];
        })(),
      };
    } catch {
      continue;
    } finally {
      try { sc?.disconnect(); } catch {}
    }
  }
  return { status: "unknown", quorum: 0, master: { host: "—", port: 6379 }, replicas: [], sentinels: [] };
}

export interface GitActivity {
  recentCommits: Array<{ hash: string; message: string; author: string; date: string; branch: string }>;
  currentBranch: string;
  uncommittedChanges: number;
  lastPush: string;
}

export function getGitActivity(): GitActivity {
  const repoDir = process.env.LUMA_REPO_DIR || "/repo";
  const logRaw = safeExec(`git -C "${repoDir}" log --all --oneline --format="%H|%s|%an|%ai|%D" -15`);
  const branchRaw = safeExec(`git -C "${repoDir}" branch --show-current`);
  const statusRaw = safeExec(`git -C "${repoDir}" status --porcelain`);

  const commits = logRaw.split("\n").filter(Boolean).map(line => {
    const parts = line.split("|");
    const hash = parts[0], message = parts[1], author = parts[2], date = parts[3], refs = parts.slice(4).join("|");
    const branchMatch = refs?.match(/(?:HEAD -> |origin\/)(\S+)/);
    return {
      hash: hash?.slice(0, 8) ?? "",
      message: message ?? "",
      author: author ?? "",
      date: date ?? "",
      branch: branchMatch?.[1] ?? "",
    };
  });

  return {
    recentCommits: commits,
    currentBranch: branchRaw || "detached",
    uncommittedChanges: statusRaw ? statusRaw.split("\n").filter(Boolean).length : 0,
    lastPush: safeExec(`git -C "${repoDir}" log --format="%ai" -1 origin/main`) || "—",
  };
}

export interface SystemInfo {
  uptimeHours: number;
  memoryUsedMB: number;
  memoryTotalMB: number;
  cpuUsage: number;
  nodeVersion: string;
  platform: string;
}

export function getSystemInfo(): SystemInfo {
  const os = require("node:os");
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpus = os.cpus();
  let cpuIdle = 0, cpuTotal = 0;
  for (const cpu of cpus) {
    for (const [type, time] of Object.entries(cpu.times)) {
      cpuTotal += time as number;
      if (type === "idle") cpuIdle += time as number;
    }
  }

  return {
    uptimeHours: Math.round(os.uptime() / 3600 * 10) / 10,
    memoryUsedMB: Math.round((totalMem - freeMem) / 1024 / 1024),
    memoryTotalMB: Math.round(totalMem / 1024 / 1024),
    cpuUsage: Math.round((1 - cpuIdle / cpuTotal) * 100),
    nodeVersion: process.version,
    platform: `${os.type()} ${os.release()}`,
  };
}

/** Handoff throughput: count per day for last 14 days */
export async function getHandoffTimeline(): Promise<Array<{ date: string; count: number; failed: number }>> {
  const { rows } = await pg.query(`
    select date_trunc('day', created_at)::date as d,
           count(*)::int as total,
           count(*) filter (where lifecycle_status = 'FAILED')::int as failed
    from handoffs
    where created_at > now() - interval '14 days'
    group by 1 order by 1
  `);
  return rows.map(r => ({ date: new Date(r.d).toISOString().slice(0, 10), count: r.total, failed: r.failed }));
}

/** Outbox delivery success rate */
export async function getOutboxStats(): Promise<{ sent: number; failed: number; pending: number; avgDeliveryMs: number }> {
  const { rows } = await pg.query(`
    select status, count(*)::int as n,
           avg(extract(epoch from (sent_at - created_at)) * 1000) filter (where sent_at is not null)::int as avg_ms
    from outbox group by status
  `);
  let sent = 0, failed = 0, pending = 0, avgMs = 0;
  for (const r of rows) {
    if (r.status === "SENT") { sent = r.n; avgMs = r.avg_ms ?? 0; }
    else if (r.status === "FAILED") failed = r.n;
    else if (r.status === "PENDING") pending = r.n;
  }
  return { sent, failed, pending, avgDeliveryMs: avgMs };
}
