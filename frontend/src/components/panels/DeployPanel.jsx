import React from "react";
import { Icon, HDLib } from "../icons.jsx";
import { HDW } from "../widgets.jsx";
import { StatusBadge } from "./shared.jsx";

const DS = window.CommitBriefingDesignSystem_27542e;
const { Card, Button } = DS;
const { cls } = HDLib;
const { Section } = HDW;

const ACTIONS = [
  { id: "rebuild", label: "Rebuild", hint: "só builda a imagem, não recria o container" },
  { id: "up", label: "Deploy", hint: "recria o container com a imagem já existente" },
  { id: "rebuild+up", label: "Rebuild + Deploy", hint: "builda e recria — o fluxo normal após merge na main", primary: true },
];

function LogLine({ line }) {
  const isCmd = line.line.startsWith("$ ");
  const isErr = /error|falh|erro|exit code [^0]|saiu com código [^0]/i.test(line.line);
  return (
    <div className={cls("deploy-log__line mono", isCmd && "deploy-log__line--cmd", isErr && "deploy-log__line--err")}>
      <span className="deploy-log__ts">{new Date(line.at).toLocaleTimeString("pt-BR")}</span> {line.line}
    </div>
  );
}

function NewProjectForm({ onSaved, onCancel }) {
  const [form, setForm] = React.useState({ slug: "", displayName: "", localPath: "", composeService: "", vercelDeployHookUrl: "" });
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = () => {
    if (!form.slug || !form.localPath) { setErr("slug e localPath são obrigatórios"); return; }
    setBusy(true); setErr("");
    fetch("/ops/api/deploy/projects", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        setBusy(false);
        if (!r.ok || d.error) { setErr(d.error || `HTTP ${r.status}`); return; }
        onSaved();
      })
      .catch((e) => { setBusy(false); setErr(String(e)); });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input className="cb-input" placeholder="slug (ex: commit-briefing)" value={form.slug} onChange={set("slug")} style={{ width: 200 }} />
        <input className="cb-input" placeholder="nome de exibição" value={form.displayName} onChange={set("displayName")} style={{ width: 200 }} />
      </div>
      <input className="cb-input" placeholder="local_path (ex: C:\\Users\\...\\commitBriefing-gh, ou caminho relativo a este repo)" value={form.localPath} onChange={set("localPath")} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input className="cb-input" placeholder="compose_service (nome do serviço no docker-compose.yml)" value={form.composeService} onChange={set("composeService")} style={{ flex: 1 }} />
      </div>
      <input className="cb-input" placeholder="Vercel deploy hook URL (opcional, sobrepõe VERCEL_DEPLOY_HOOK_URL global)" value={form.vercelDeployHookUrl} onChange={set("vercelDeployHookUrl")} />
      {err && <div style={{ color: "var(--critical)", fontSize: 12 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <Button size="sm" disabled={busy} onClick={save}>{busy ? "Salvando…" : "Salvar projeto"}</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  );
}

export function DeployPanel() {
  const [projects, setProjects] = React.useState([]);
  const [projectSlug, setProjectSlug] = React.useState("handoff-daemon");
  const [showNewProject, setShowNewProject] = React.useState(false);
  const [branch, setBranch] = React.useState("main");
  const [target, setTarget] = React.useState("self-hosted");
  const [busyAction, setBusyAction] = React.useState(null);
  const [current, setCurrent] = React.useState(null); // { id, status, log: [] }
  const [history, setHistory] = React.useState([]);
  const esRef = React.useRef(null);
  const logEndRef = React.useRef(null);

  const loadProjects = React.useCallback(() => {
    fetch("/ops/api/deploy/projects").then(r => r.json()).then(d => {
      const list = d.projects || [];
      setProjects(list);
      if (list.length && !list.some(p => p.slug === projectSlug)) setProjectSlug(list[0].slug);
    }).catch(() => {});
  }, [projectSlug]);

  const loadHistory = React.useCallback(() => {
    fetch("/ops/api/deploy/history").then(r => r.json()).then(d => setHistory(d.requests || [])).catch(() => {});
  }, []);

  React.useEffect(() => { loadProjects(); loadHistory(); }, []);

  // Branches vêm do worker de host (só ele tem git de verdade) — refeteca a lista de
  // projetos periodicamente pra pegar branch nova sem precisar de F5.
  React.useEffect(() => {
    const t = setInterval(loadProjects, 10_000);
    return () => clearInterval(t);
  }, [loadProjects]);

  React.useEffect(() => {
    if (current && current.log && current.log.length) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [current?.log?.length]);

  const subscribe = React.useCallback((id) => {
    if (esRef.current) esRef.current.close();
    setCurrent({ id, status: "pending", log: [] });
    const es = new EventSource(`/ops/api/deploy/stream?id=${encodeURIComponent(id)}`);
    esRef.current = es;
    es.addEventListener("log", (ev) => {
      const line = JSON.parse(ev.data);
      setCurrent((c) => (c && c.id === id ? { ...c, log: [...c.log, line] } : c));
    });
    es.addEventListener("status", (ev) => {
      const d = JSON.parse(ev.data);
      setCurrent((c) => (c && c.id === id ? { ...c, status: d.status, error: d.error } : c));
      if (d.status === "done" || d.status === "failed") {
        es.close();
        setBusyAction(null);
        loadHistory();
      }
    });
    es.onerror = () => { es.close(); };
  }, [loadHistory]);

  React.useEffect(() => () => { if (esRef.current) esRef.current.close(); }, []);

  const run = (action) => {
    setBusyAction(action);
    fetch("/ops/api/deploy/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectSlug, target, action, branch }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) { alert(d.error || `HTTP ${r.status}`); setBusyAction(null); return; }
        subscribe(d.id);
      })
      .catch((e) => { alert(String(e)); setBusyAction(null); });
  };

  const anyBusy = !!busyAction;
  const running = current && (current.status === "pending" || current.status === "running");
  const currentProject = projects.find(p => p.slug === projectSlug);
  const branchOptions = currentProject?.branches || [];

  // Se o branch selecionado sumiu da lista (trocou de projeto, ou branch foi deletado no
  // remote), recai pra 'main' se existir, senão o primeiro disponível.
  React.useEffect(() => {
    if (branchOptions.length && !branchOptions.includes(branch)) {
      setBranch(branchOptions.includes("main") ? "main" : branchOptions[0]);
    }
  }, [branchOptions.join(","), currentProject?.slug]);

  return (
    <div className="panel animate-fade-up stagger">
      <Section icon="terminal" title="Deploy" accent="var(--copper)">
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted-foreground)" }}>
              Projeto
              <select className="cb-input" value={projectSlug} onChange={(e) => setProjectSlug(e.target.value)} style={{ width: 220 }}>
                {projects.map(p => <option key={p.slug} value={p.slug}>{p.display_name}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted-foreground)" }}>
              Branch
              {branchOptions.length > 0 ? (
                <select className="cb-input" value={branch} onChange={(e) => setBranch(e.target.value)} style={{ width: 200 }}>
                  {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              ) : (
                <input className="cb-input" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" title="worker ainda não listou os branches deste projeto" style={{ width: 200 }} />
              )}
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted-foreground)" }}>
              Destino
              <select className="cb-input" value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: 180 }}>
                <option value="self-hosted">Self-hosted (Docker)</option>
                <option value="vercel">Vercel</option>
              </select>
            </label>
            <Button size="sm" variant="outline" onClick={() => setShowNewProject(v => !v)}>
              {showNewProject ? "Fechar" : "+ Projeto"}
            </Button>
          </div>

          {currentProject && target === "self-hosted" && (
            <div className="muted mono" style={{ fontSize: 11 }}>
              {currentProject.local_path} · serviço <code>{currentProject.compose_service}</code>
              {currentProject.branches_updated_at && ` · branches atualizados ${new Date(currentProject.branches_updated_at).toLocaleTimeString("pt-BR")}`}
              {!branchOptions.length && " · worker ainda não listou branches — aguarde ~20s ou confira se o worker está rodando"}
            </div>
          )}

          {showNewProject && (
            <NewProjectForm onCancel={() => setShowNewProject(false)} onSaved={() => { setShowNewProject(false); loadProjects(); }} />
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {ACTIONS.map((a) => (
              <Button
                key={a.id}
                disabled={anyBusy}
                variant={a.primary ? undefined : "outline"}
                title={a.hint}
                onClick={() => run(a.id)}
              >
                {busyAction === a.id ? "Executando…" : a.label}
              </Button>
            ))}
          </div>

          {target === "vercel" && (
            <div className="muted" style={{ fontSize: 12 }}>
              Requer <code>vercel_deploy_hook_url</code> no projeto ou <code>VERCEL_DEPLOY_HOOK_URL</code> global no .env — sem isso o worker reporta erro no log abaixo.
            </div>
          )}

          {current && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <StatusBadge status={current.status === "done" ? "good" : current.status === "failed" ? "critical" : "info"}>
                  {current.status}
                </StatusBadge>
                {running && <span className="deploy-log__dot" />}
                <span className="mono" style={{ fontSize: 11, opacity: 0.6 }}>{current.id}</span>
              </div>
              <div className="deploy-log">
                {current.log.length === 0 && <div className="muted mono" style={{ padding: 8 }}>aguardando o worker de host pegar o pedido…</div>}
                {current.log.map((l, i) => <LogLine key={i} line={l} />)}
                <div ref={logEndRef} />
              </div>
            </div>
          )}
        </div>
      </Section>

      <Section icon="clock" title="Histórico" count={history.length}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {history.length === 0 && <div className="muted" style={{ padding: 12 }}>Nenhum deploy disparado ainda.</div>}
          {history.map((r) => (
            <div key={r.id} className="deploy-hist__row" onClick={() => subscribe(r.id)} style={{ cursor: "pointer" }}>
              <StatusBadge status={r.status === "done" ? "good" : r.status === "failed" ? "critical" : r.status === "running" ? "info" : "warning"}>
                {r.status}
              </StatusBadge>
              <span className="mono" style={{ fontSize: 12 }}>{r.project_slug}</span>
              <span className="mono" style={{ fontSize: 12 }}>{r.target}</span>
              <span className="mono" style={{ fontSize: 12 }}>{r.action}</span>
              <span className="mono" style={{ fontSize: 12 }}>{r.branch}</span>
              <span className="mono muted" style={{ fontSize: 11, marginLeft: "auto" }}>
                {new Date(r.created_at).toLocaleString("pt-BR")}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
