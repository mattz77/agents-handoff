import { pg } from "./infra/postgres";
import { HandoffEnvelope, REST_ALLOWED_STATUSES, LifecycleStatus } from "./domain/handoff";
import { redis } from "./infra/redis";
import crypto from "node:crypto";

export async function applyHandoffTransition(env: HandoffEnvelope) {
  const client = await pg.connect();
  try {
    await client.query("BEGIN");

    // Transição automática: se chegou como AWAITING e o consumer está processando → IN_PROGRESS
    const targetStatus: string =
      env.lifecycle_status === "AWAITING_HANDOFF_DEV" || env.lifecycle_status === "AWAITING_HANDOFF_OPS"
        ? "IN_PROGRESS"
        : env.lifecycle_status;

    // 1) Atualiza estado de auditoria (idempotente via ON CONFLICT)
    await client.query(
      `insert into handoffs (task_id, idempotency_key, correlation_id, project, branch,
         lifecycle_status, payload, sender, receiver, attempt)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (task_id) do update
         set lifecycle_status = excluded.lifecycle_status,
             attempt = excluded.attempt, updated_at = now()`,
      [env.task_id, env.idempotency_key, env.correlation_id, env.project, env.current_branch,
       targetStatus, env.payload, env.signatures.sender, env.signatures.receiver, env.attempt]
    );

    // 2) Enfileira efeito colateral NA MESMA TRANSAÇÃO
    if (["IN_PROGRESS", "DONE", "FAILED", "ACKNOWLEDGED", "COMPLETED"].includes(targetStatus)) {
      const action = env.payload?.pending_action_item;
      await client.query(
        `insert into outbox (aggregate_id, event_type, payload)
         values ($1, 'email.notify', $2)`,
        [env.task_id, { project: env.project, status: targetStatus, action }]
      );
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e; // volta pro retry/DLQ do worker
  } finally {
    client.release();
  }
}

/** Atualiza o lifecycle_status de um handoff existente. Usado por endpoint REST. */
export async function transitionStatus(taskId: string, newStatus: string): Promise<{ ok: boolean; error?: string }> {
  if (!REST_ALLOWED_STATUSES.includes(newStatus as LifecycleStatus)) {
    return { ok: false, error: `Status inválido: ${newStatus}` };
  }
  const { rowCount } = await pg.query(
    `update handoffs set lifecycle_status = $2, updated_at = now() where task_id = $1`,
    [taskId, newStatus]
  );
  if (rowCount === 0) return { ok: false, error: `Handoff ${taskId} não encontrado` };
  return { ok: true };
}

/** Persiste uma auditoria do Hermes (anexo a um handoff). Idempotente por (correlation_id, resumo). */
export async function persistHermesAudit(env: HandoffEnvelope) {
  const a = env.hermes_audit;
  if (!a) throw new Error("hermes_audit ausente no envelope event_kind=hermes.audit");
  // Dedupe leve: não regravar auditoria idêntica (mesmo correlation_id + resumo) já existente.
  const dup = await pg.query(
    `select 1 from hermes_audits where correlation_id = $1 and resumo is not distinct from $2 limit 1`,
    [env.correlation_id, a.resumo]
  );
  if ((dup.rowCount ?? 0) > 0) return;
  await pg.query(
    `insert into hermes_audits (correlation_id, handoff_task_id, project, nota, severidade, riscos, resumo, raw)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [env.correlation_id, env.task_id, env.project,
     a.severidade === "unknown" ? null : a.nota, a.severidade,
     JSON.stringify(a.riscos ?? []), a.resumo, env.payload?.pending_action_item ?? null]
  );
}

export async function drainOutbox() {
  for (;;) {
    const { rows } = await pg.query(
      `select * from outbox where status = 'PENDING' order by id limit 20 for update skip locked`
    );
    for (const row of rows) {
      try {
        await deliverEffect(row); // publica em ops:comm (n8n)
        await pg.query(`update outbox set status='SENT', sent_at=now() where id=$1`, [row.id]);
      } catch (e) {
        console.error("Erro ao enviar para webhook:", e);
        const attempts = row.attempts + 1;
        const status = attempts >= 5 ? "FAILED" : "PENDING";
        await pg.query(`update outbox set attempts=$1, status=$2 where id=$3`, [attempts, status, row.id]);
      }
    }
    if (rows.length === 0) await new Promise((r) => setTimeout(r, 2000));
  }
}

async function deliverEffect(row: any) {
  const webhookUrl = process.env.WEBHOOK_URL;
  const webhookSecret = process.env.WEBHOOK_SECRET;

  if (!webhookUrl || !webhookSecret) {
    throw new Error("Faltam variáveis de ambiente (WEBHOOK_URL ou WEBHOOK_SECRET)");
  }

  const p = row.payload;
  const outgoing = {
    ...row,
    message_content: `[${p?.project ?? row.aggregate_id}] ${row.event_type} | Status: ${p?.status ?? row.status} | Acao: ${p?.action ?? "-"}`,
  };
  const bodyStr = JSON.stringify(outgoing);
  const signature = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(bodyStr).digest('hex');

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Signature": signature },
    body: bodyStr,
  });

  if (!response.ok) {
    throw new Error(`Falha no webhook HTTP: ${response.status} ${response.statusText}`);
  }
}
