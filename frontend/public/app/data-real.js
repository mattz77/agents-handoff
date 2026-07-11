/* ============================================================
   data-real.js — carrega dados das APIs reais do daemon e
   popula window.HD no mesmo schema do data.js original.
   ============================================================ */
(function () {
  const now = Date.now();

  // Agentes estáticos (não vêm da API) — trinca LLM-Brain (Agent em src/domain/handoff.ts)
  const AGENTS = {
    Claude_Code:        { id:"Claude_Code",        name:"Claude Code",  model:"Claude Sonnet 4.6", role:"Dev", accent:"var(--copper)",    tint:"rgb(196 149 106 / 0.14)" },
    Antigravity_Daemon: { id:"Antigravity_Daemon", name:"Antigravity", model:"Gemini 2.5 Pro",    role:"Ops", accent:"var(--walnut)",    tint:"rgb(141 110 76 / 0.16)"  },
    ZCode_Agent:        { id:"ZCode_Agent",        name:"ZCode",        model:"GLM-5.2",           role:"Dev", accent:"var(--walnut-900)","tint":"rgb(115 90 58 / 0.18)"  },
  };

  // Normaliza strings livres da task-queue/decisions ("ZCode", "Antigravity", "Claude ...")
  // para um id de AGENTS. A task-queue é editada por humanos, então variantes aparecem.
  function normalizeAgentId(raw) {
    const s = String(raw || '').toLowerCase();
    if (s.includes('zcode') || s.includes('glm')) return 'ZCode_Agent';
    if (s.includes('antigravity') || s.includes('gemini')) return 'Antigravity_Daemon';
    if (s.includes('claude')) return 'Claude_Code';
    return 'Antigravity_Daemon';
  }
  const STATUS = {
    INIT:                 { label:"Iniciado",       ds:"info",     pt:"Iniciado" },
    IN_PROGRESS:          { label:"Em progresso",   ds:"info",     pt:"Em progresso" },
    AWAITING_HANDOFF_OPS: { label:"Aguardando Ops", ds:"toil",     pt:"Aguardando Ops" },
    AWAITING_HANDOFF_DEV: { label:"Aguardando Dev", ds:"toil",     pt:"Aguardando Dev" },
    FALLBACK_TRIGGERED:   { label:"Fallback",       ds:"warning",  pt:"Fallback acionado" },
    ACKNOWLEDGED:         { label:"Recebido",       ds:"neutral",  pt:"Recebido pelo agente" },
    DONE:                 { label:"Concluído",      ds:"good",     pt:"Concluído" },
    COMPLETED:            { label:"Finalizado",     ds:"good",     pt:"Finalizado e verificado" },
    FAILED:               { label:"Falhou",         ds:"critical", pt:"Falhou" },
  };

  function traceFor(h) {
    const failed = h.lifecycle_status === "FAILED";
    const done   = h.lifecycle_status === "DONE";
    return [
      { span:"wrapper.detect",  svc:"claude-smart-wrap", t0:0,   dur:42,  ok:true,  note:"sinal estruturado detectado" },
      { span:"context.compile", svc:"fallback-ctx",      t0:44,  dur:88,  ok:true,  note:"branch + HEAD + diff-stat" },
      { span:"producer.publish",svc:"producer",          t0:134, dur:16,  ok:true,  note:"SET NX idempotency" },
      { span:"consumer.read",   svc:"g:ops",             t0:152, dur:9,   ok:true,  note:"xreadgroup" },
      { span:"outbox.write",    svc:"postgres",          t0:163, dur:21,  ok:true,  note:"applyHandoffTransition" },
      { span:"outbox.drain",    svc:"drainOutbox",       t0:186, dur:34,  ok:true,  note:"FOR UPDATE SKIP LOCKED" },
      { span:"webhook.n8n",     svc:"n8n",               t0:222, dur:540, ok:!failed, note: failed?"HMAC mismatch":"HMAC verificado · 200" },
      { span:"notify.email",    svc:"handoff-daemon",    t0:764, dur:180, ok:done,  note: done?"entregue":"não disparado" },
    ];
  }

  // Placeholder inicial (evita crash se React montar antes do fetch)
  window.HD = {
    AGENTS, STATUS, projects: [], normalizeAgentId,
    handoffs: [], dlq: [], outbox: [], outboxByStatus: {}, outboxStats: { sent:0,failed:0,pending:0,avgDeliveryMs:0 },
    breakers: [], alerts: [], stream: { length:0, groups:0, pending:0 },
    handoffsByStatus: {}, histStatus: {}, slo: { handoffP95Ms:0,handoffP50Ms:0,target:3000,successRate:0,mttrMin:0,last24h:0 },
    timeline: [], brain: { activeModel: 'Desconhecido', lastSync: new Date().toISOString(), recentDecisions: [], taskList: [], pendingTasks: 0, completedTasks: 0, blockedTasks: 0 }, docker: { totalRunning: 0, totalStopped: 0, containers: [] }, redisHA: { status: 'unknown', quorum: 0, master: { host: '—', port: 6379 }, replicas: [], sentinels: [] }, system: { memoryUsedMB: 0, memoryTotalMB: 1, uptimeHours: 0, cpuUsage: 0, nodeVersion: '?', platform: '?' }, git: { recentCommits: [], currentBranch: '—', uncommittedChanges: 0, lastPush: '—' },
    datalake: { mount: 'Desconectado', drive: 'Local', access: 'Nenhum', cache: '-', syncStatus: 'error', lastSync: new Date().toISOString(), usedMB: 0, capacityMB: 1, totalSizeMB: 0, rag: 'indisponível', knowledge: [], projects: [], backups: [], backupCount: 0, lastBackup: '—', restoreChecks:{ lastRunAt:null, ok:true, total:0, passed:0, failed:[], byTarget:{} }, memory:{ corpusFiles:0, vectorCount:0, lastIngest:null, hasLance:false }, n8nWorkflows:{ orgs:[], totalWorkflows:0, lastBackup:null } }, brainFiles: [], codereview: { reports: [] },
    traceFor,
    fmt: { now, min:(m)=>new Date(Date.now()-m*60000).toISOString(), hr:(h)=>new Date(Date.now()-h*3600000).toISOString(), day:(d)=>new Date(Date.now()-d*86400000).toISOString() },
  };

  const REDIS_HA_EMPTY = {
    status: 'unknown', quorum: 0,
    master:    { host: '—', port: 6379 },
    replicas:  [],
    sentinels: [],
  };

  function buildDatalake(datalake) {
    if (datalake && !datalake.error) {
      // Deriva restore status por engine+project a partir de restoreChecks.byTarget
      const rc = datalake.restoreChecks || {};
      const byTarget = rc.byTarget || {};
      const backups = (datalake.backups || []).map(b => {
        const key = (b.engine + '/' + b.project).toLowerCase();
        const chk = byTarget[key];
        let restore = 'n/a';   // sem check registrado
        if (chk) restore = chk.ok ? 'ok' : 'fail';
        else if (rc.total > 0) restore = 'n/a';   // checks existem mas não pra este target
        return { engine: b.engine, project: b.project, restore, count: b.count, sizeMB: b.sizeMB, lastAt: b.lastAt };
      });

      const mem = datalake.memory || {};
      const ragStatus = mem.hasLance ? 'ativo' : (mem.corpusFiles > 0 ? 'scaffold' : 'planejado');
      const n8n = datalake.n8nWorkflows || {};

      return {
        mount: 'G:\\Meu Drive\\Luma_DataLake',
        drive: 'Google Workspace · 5 TB',
        access: 'OS-level I/O · sem API HTTP',
        cache: 'cache nativo GDrive · resiliente a quedas',
        syncStatus: 'ok',
        lastSync: datalake.lastSync || new Date().toISOString(),
        usedMB: datalake.totalSizeMB || 0,
        capacityMB: datalake.capacityMB || 5*1024*1024,
        totalSizeMB: datalake.totalSizeMB || 0,
        rag: ragStatus,
        knowledge: (datalake.knowledge || datalake.knowledgeAreas || []).map(a => ({ name: a.name, files: a.files, sizeMB: a.sizeMB, updated: a.updated })),
        projects: (datalake.projects || datalake.projectDirs || []).map(a => ({ name: a.name, files: a.files, sizeMB: a.sizeMB, updated: a.updated })),
        backups,
        backupCount: datalake.backupCount || 0,
        lastBackup: datalake.lastBackup || '—',
        restoreChecks: rc,
        memory: mem,
        n8nWorkflows: n8n,
      };
    }
    return { mount:'Desconectado', drive:'Local', access:'Nenhum', cache:'-', syncStatus:'error',
      lastSync:new Date().toISOString(), usedMB:0, capacityMB:1, totalSizeMB:0, rag:'indisponível',
      knowledge:[], projects:[], backups:[], backupCount:0, lastBackup:'—',
      restoreChecks:{ lastRunAt:null, ok:true, total:0, passed:0, failed:[], byTarget:{} },
      memory:{ corpusFiles:0, vectorCount:0, lastIngest:null, hasLance:false },
      n8nWorkflows:{ orgs:[], totalWorkflows:0, lastBackup:null } };
  }

  function buildBrainFiles(brain) {
    if (!brain) return [];
    return [
      { name:'active-context.md', role:'Snapshot da sessão · checkpoints', lines:0, updatedBy:(brain.activeModel||'—').split('—')[0].trim(), updated:brain.lastSync, mode:'read/write' },
      { name:'task-queue.md', role:'Fila de delegação entre modelos', lines:0, updatedBy:'ambos', updated:brain.lastSync, mode:'append/own' },
      { name:'decisions.md', role:'Log append-only de decisões', lines:(brain.recentDecisions||[]).length, updatedBy:'ambos', updated:brain.lastSync, mode:'append-only' },
    ];
  }

  let isFetching = false;
  async function fetchAll() {
    if (isFetching) return;
    isFetching = true;
    try {
      const [overview, handoffs, dlq, outbox, breakers, alerts] = await Promise.all([
        fetch('/ops/api/overview').then(r=>r.ok?r.json():Promise.reject(r)).catch(()=>({})),
        fetch('/ops/api/handoffs?limit=50').then(r=>r.ok?r.json():Promise.reject(r)).catch(()=>window.HD.handoffs || []),
        fetch('/ops/api/dlq?limit=50').then(r=>r.ok?r.json():Promise.reject(r)).catch(()=>window.HD.dlq || []),
        fetch('/ops/api/outbox?limit=50').then(r=>r.ok?r.json():Promise.reject(r)).catch(()=>window.HD.outbox || []),
        fetch('/ops/api/breakers').then(r=>r.ok?r.json():Promise.reject(r)).catch(()=>window.HD.breakers || []),
        fetch('/ops/api/alerts?limit=30').then(r=>r.ok?r.json():Promise.reject(r)).catch(()=>window.HD.alerts || []),
      ]);

      const hByStatus = overview.handoffsByStatus || {};
      const _handoffs = Array.isArray(handoffs) ? handoffs : [];
      const projects = [...new Set(_handoffs.map(h=>h.project).filter(Boolean))];
      
      Object.assign(window.HD, {
        projects,
        handoffs: _handoffs.map(h=>({...h, live: h.lifecycle_status === 'IN_PROGRESS' || h.lifecycle_status === 'AWAITING_HANDOFF_DEV' || h.lifecycle_status === 'AWAITING_HANDOFF_OPS'})),
        dlq: Array.isArray(dlq) ? dlq : [],
        outbox: Array.isArray(outbox) ? outbox : [],
        outboxByStatus: overview.outboxByStatus || {},
        breakers: (Array.isArray(breakers) ? breakers : []).map(b=>({...b, threshold:5, cooldownMs:30000})),
        alerts: Array.isArray(alerts) ? alerts : [],
        stream: overview.stream || { length:0, groups:0, pending:0 },
        handoffsByStatus: hByStatus,
        histStatus: hByStatus,
        slo: Object.assign({}, window.HD.slo, overview.slo || {}),
        fmt: { now:Date.now(), min:(m)=>new Date(Date.now()-m*60000).toISOString(), hr:(h)=>new Date(Date.now()-h*3600000).toISOString(), day:(d)=>new Date(Date.now()-d*86400000).toISOString() },
      });
      if (window.HDReload) window.HDReload();
    } catch(e) {
      console.error('[data-real] wave1 error:', e);
    }

    // Wave 2 — slow intel (docker socket, git, fs, timeline Postgres)
    try {
      const [brain, docker, system, git, datalake, timeline, outboxStats, codereview] = await Promise.all([
        fetch('/ops/api/brain').then(r=>r.ok?r.json():Promise.reject(r)).catch(()=>window.HD.brain || {}),
        fetch('/ops/api/docker').then(r=>r.ok?r.json():Promise.reject(r)).catch(()=>window.HD.docker || {}),
        fetch('/ops/api/system').then(r=>r.ok?r.json():Promise.reject(r)).catch(()=>window.HD.system || {}),
        fetch('/ops/api/git').then(r=>r.ok?r.json():Promise.reject(r)).catch(()=>window.HD.git || {}),
        fetch('/ops/api/datalake').then(r=>r.ok?r.json():Promise.reject(r)).catch(()=>window.HD.datalake || {}),
        fetch('/ops/api/timeline').then(r=>r.ok?r.json():Promise.reject(r)).catch(()=>window.HD.timeline || []),
        fetch('/ops/api/outbox-stats').then(r=>r.ok?r.json():Promise.reject(r)).catch(()=>window.HD.outboxStats || {}),
        fetch('/ops/api/codereview').then(r=>r.ok?r.json():Promise.reject(r)).catch(()=>window.HD.codereview || { reports: [] }),
      ]);

      const _timeline = Array.isArray(timeline) ? timeline : [];
      const _brain = brain && brain.activeModel && !brain.error ? brain : { activeModel: 'Desconhecido', lastSync: new Date().toISOString(), recentDecisions: [], taskList: [], pendingTasks: 0, completedTasks: 0, blockedTasks: 0 };

      window.HD = Object.assign({}, window.HD, {
        brain: _brain,
        docker: docker && docker.containers && !docker.error ? docker : { totalRunning: 0, totalStopped: 0, containers: [] },
        redisHA: REDIS_HA_EMPTY,
        system: system && system.cpuUsage !== undefined && !system.error ? system : { memoryUsedMB: 0, memoryTotalMB: 1, uptimeHours: 0, cpuUsage: 0, nodeVersion: '?', platform: '?' },
        datalake: buildDatalake(datalake),
        brainFiles: buildBrainFiles(_brain),
        outboxStats: outboxStats && !outboxStats.error ? outboxStats : { sent:0, failed:0, pending:0, avgDeliveryMs:0 },
        git: git && !git.error ? git : { recentCommits: [], currentBranch: '—', uncommittedChanges: 0, lastPush: '—' },
        codereview: codereview && Array.isArray(codereview.reports) ? codereview : { reports: [] },
        timeline: _timeline.length ? _timeline : window.HD.timeline,
        slo: Object.assign({}, window.HD.slo, { last24h: _timeline.slice(-1)[0]?.count||0 }),
      });
      if (window.HDReload) window.HDReload();
    } catch(e) {
      console.error('[data-real] wave2 error:', e);
    } finally {
      isFetching = false;
    }
  }

  // Carrega dados reais imediatamente
  fetchAll();

  // Exporta para uso pelo app (auto-refresh)
  window.HD_fetchAll = fetchAll;
})();
