import { v7 as uuidv7, v4 as uuidv4 } from "uuid";
import { createHash } from "node:crypto";

export type LifecycleStatus =
  | "INIT" | "IN_PROGRESS"
  | "AWAITING_HANDOFF_OPS" | "AWAITING_HANDOFF_DEV"
  | "FALLBACK_TRIGGERED" | "DONE" | "FAILED"
  | "ACKNOWLEDGED" | "COMPLETED";

/** LifecycleStatus válidos para transição via endpoint REST. */
export const REST_ALLOWED_STATUSES: LifecycleStatus[] = [
  "INIT", "IN_PROGRESS",
  "AWAITING_HANDOFF_OPS", "AWAITING_HANDOFF_DEV",
  "FALLBACK_TRIGGERED", "DONE", "FAILED",
  "ACKNOWLEDGED", "COMPLETED",
];

export type Agent = "Claude_Code" | "Antigravity_Daemon" | "ZCode_Agent" | "Hermes_Linter" | "Minimax_Reviewer";

/** Severidade de uma auditoria do Hermes. "unknown" = Ollama off ou saída malformada. */
export type HermesSeverity = "low" | "medium" | "high" | "unknown";

/** Resultado estruturado de uma auditoria do Hermes 3 (não é transição de ciclo de vida). */
export interface HermesAudit {
  nota: number;                // 0-10
  severidade: HermesSeverity;
  riscos: string[];
  resumo: string;              // 1 linha
}

export interface GitContext {
  commit_sha: string;
  diff_uri: string;            // git://repo@sha ou URL de PR — NUNCA conteúdo
  untracked_files: string[];
}

export interface EnvironmentState {
  active_containers: string[];
  affected_databases: Array<"Supabase" | "SQL Server" | "MySQL" | "NoSQL" | "Postgres">;
}

export interface HandoffPayload {
  macro_goal: string;
  completed_milestones: string[];
  pending_action_item: string;
  git_context: GitContext;
  environment_state: EnvironmentState;
}

export interface HandoffEnvelope {
  task_id: string;             // UUIDv7
  idempotency_key: string;     // sha256(project + commit_sha + pending_action_item)
  schema_version: "7.0";
  timestamp: string;           // ISO-8601 -03:00
  correlation_id: string;      // UUIDv7
  project: string;
  current_branch: string;
  lifecycle_status: LifecycleStatus;
  attempt: number;
  payload: HandoffPayload;
  signatures: { sender: Agent; receiver: Agent };
  // Discriminador de roteamento no consumer. Ausente/"handoff" = transição de ciclo de vida.
  // "hermes.audit" = anexo de auditoria → persiste em hermes_audits, NÃO toca a máquina de estados.
  event_kind?: "handoff" | "hermes.audit";
  hermes_audit?: HermesAudit;  // presente apenas quando event_kind === "hermes.audit"
}

export const newTaskId = () => {
  try {
    return uuidv7();
  } catch (e) {
    return uuidv4(); // Fallback se UUIDv7 não estiver disponível na versão do pacote
  }
};

export function idempotencyKey(p: { project: string; commitSha: string; action: string }) {
  return createHash("sha256")
    .update(`${p.project}|${p.commitSha}|${p.action}`)
    .digest("hex");
}
