import { publishHandoff } from "../src/producer";
import { HandoffEnvelope, newTaskId, idempotencyKey } from "../src/domain/handoff";

async function runTest() {
  const commitSha = "abc123def456";
  const action = "Implementar login UI";
  const project = "Projeto_Teste";

  const env: HandoffEnvelope = {
    task_id: newTaskId(),
    idempotency_key: idempotencyKey({ project, commitSha, action }),
    schema_version: "7.0",
    timestamp: new Date().toISOString(),
    correlation_id: newTaskId(),
    project,
    current_branch: "feat/login",
    lifecycle_status: "AWAITING_HANDOFF_DEV",
    attempt: 1,
    payload: {
      macro_goal: "Autenticação Completa",
      completed_milestones: ["Configuração Supabase"],
      pending_action_item: action,
      git_context: {
        commit_sha: commitSha,
        diff_uri: "git://repo@abc123def456",
        untracked_files: []
      },
      environment_state: {
        active_containers: ["redis-master", "postgres"],
        affected_databases: ["Supabase"]
      }
    },
    signatures: {
      sender: "Claude_Code",
      receiver: "Antigravity_Daemon"
    }
  };

  console.log("Publicando Handoff Simulado no Redis Streams...");
  const streamId = await publishHandoff(env);
  
  if (streamId) {
    console.log(`✅ Handoff publicado com sucesso! Stream ID: ${streamId}`);
  } else {
    console.log(`⚠️ Handoff não publicado (Idempotência bloqueou duplicata).`);
  }
  
  process.exit(0);
}

runTest().catch(console.error);
