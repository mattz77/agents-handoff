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

export function DeployPanel() {
  const [branch, setBranch] = React.useState("main");
  const [target, setTarget] = React.useState("self-hosted");
  const [busyAction, setBusyAction] = React.useState(null);
  const [current, setCurrent] = React.useState(null); // { id, status, log: [] }
  const [history, setHistory] = React.useState([]);
  const esRef = React.useRef(null);
  const logEndRef = React.useRef(null);

  const loadHistory = React.useCallback(() => {
    fetch("/ops/api/deploy/history").then(r => r.json()).then(d => setHistory(d.requests || [])).catch(() => {});
  }, []);

  React.useEffect(() => { loadHistory(); }, [loadHistory]);

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
      body: JSON.stringify({ target, action, branch }),
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

  return (
    <div className="panel animate-fade-up stagger">
      <Section icon="terminal" title="Deploy" accent="var(--copper)">
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted-foreground)" }}>
              Branch
              <input className="cb-input" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" style={{ width: 200 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted-foreground)" }}>
              Destino
              <select className="cb-input" value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: 200 }}>
                <option value="self-hosted">Self-hosted (Docker)</option>
                <option value="vercel">Vercel</option>
              </select>
            </label>
          </div>

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
              Requer <code>VERCEL_DEPLOY_HOOK_URL</code> no .env do host — sem isso o worker reporta erro no log abaixo.
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
