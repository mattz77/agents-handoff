import React from "react";
import { Icon, HDLib } from "../icons.jsx";
import { HDW } from "../widgets.jsx";
import { StatusBadge } from "./shared.jsx";

const DS = window.CommitBriefingDesignSystem_27542e;
const { Card, Button, Badge } = DS;
const { cls } = HDLib;
const { Section } = HDW;

const PROVIDER_META = {
    nim:       { label: 'NVIDIA NIM', hint: 'meta/llama-3.1-70b-instruct', keyHint: 'nvapi-...', showBaseUrl: true },
    openai:    { label: 'OpenAI',     hint: 'gpt-5',                       keyHint: 'sk-...',    showBaseUrl: false },
    anthropic: { label: 'Anthropic',  hint: 'claude-sonnet-5',            keyHint: 'sk-ant-...', showBaseUrl: false },
    opencode:  { label: 'OpenCode Go', hint: 'kimi-k2.5',                 keyHint: 'opencode zen key', showBaseUrl: true },
  };

function ProviderCard({ p, onSaved }) {
  const meta = PROVIDER_META[p.provider];
  const [model, setModel] = React.useState(p.model || '');
  const [baseUrl, setBaseUrl] = React.useState(p.base_url || '');
  const [apiKey, setApiKey] = React.useState('');
  const [isDefault, setIsDefault] = React.useState(!!p.is_default);
  const [busy, setBusy] = React.useState(false);
  const [test, setTest] = React.useState(null);

  const save = () => {
    setBusy(true); setTest(null);
    const body = { providerType: p.provider, model, isDefault };
    if (meta.showBaseUrl && baseUrl) body.baseUrl = baseUrl;
    if (apiKey.trim()) body.apiKey = apiKey.trim();
    fetch('/ops/api/settings/providers', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => { setBusy(false); setApiKey(''); if (!ok) setTest({ ok: false, error: d.error }); else onSaved(); })
      .catch(e => { setBusy(false); setTest({ ok: false, error: String(e) }); });
  };
  const doTest = () => {
    setBusy(true); setTest(null);
    fetch('/ops/api/settings/providers/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerType: p.provider }) })
      .then(r => r.json()).then(d => { setBusy(false); setTest(d); }).catch(e => { setBusy(false); setTest({ ok: false, error: String(e) }); });
  };
  const remove = () => {
    setBusy(true);
    fetch('/ops/api/settings/providers?providerType=' + p.provider, { method: 'DELETE' })
      .then(() => { setBusy(false); setModel(''); setBaseUrl(''); onSaved(); }).catch(() => setBusy(false));
  };

  const statusTone = p.configured ? (p.is_default ? 'good' : 'info') : 'warning';
  const statusText = p.configured ? (p.is_default ? 'padrão · conectado' : 'conectado') : 'não configurado';

  return React.createElement(Section, {
      icon: 'brain', title: meta.label, accent: 'var(--copper)',
      actions: React.createElement(StatusBadge, { status: statusTone }, statusText) },
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, padding: 12 } },
      React.createElement('input', { className: 'cb-input', placeholder: 'modelo (ex: ' + meta.hint + ')', value: model, onChange: e => setModel(e.target.value) }),
      meta.showBaseUrl && React.createElement('input', { className: 'cb-input', placeholder: 'base URL (opcional)', value: baseUrl, onChange: e => setBaseUrl(e.target.value) }),
      React.createElement('input', { className: 'cb-input', type: 'password', placeholder: p.configured ? 'API key (••• salva — preencha só p/ trocar)' : ('API key (' + meta.keyHint + ')'), value: apiKey, onChange: e => setApiKey(e.target.value) }),
      React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted-foreground)' } },
        React.createElement('input', { type: 'checkbox', checked: isDefault, onChange: e => setIsDefault(e.target.checked) }), 'Usar como padrão do daemon'),
      React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        React.createElement(Button, { size: 'sm', disabled: busy, onClick: save }, busy ? '...' : 'Salvar'),
        React.createElement(Button, { size: 'sm', variant: 'outline', disabled: busy || !p.configured, onClick: doTest }, 'Testar'),
        p.configured && React.createElement(Button, { size: 'sm', variant: 'outline', disabled: busy, onClick: remove }, 'Remover')),
      test && React.createElement('div', { style: { fontSize: 12, color: test.ok ? 'var(--good)' : 'var(--critical)' } },
        test.ok ? ('pong em ' + test.latencyMs + 'ms') : ('erro: ' + (test.error || 'falhou')))
    )
  );
}

export function ModelsPanel() {
  const [data, setData] = React.useState(null);
  const refresh = () => fetch('/ops/api/settings/providers').then(r => r.json()).then(setData).catch(() => setData({ secretsEnabled: false, providers: [] }));
  React.useEffect(() => { refresh(); }, []);
  if (!data) return React.createElement('div', { className: 'panel animate-fade-up' }, React.createElement('div', { style: { padding: 24, color: 'var(--muted-foreground)' } }, 'Carregando provedores...'));
  return React.createElement('div', { className: 'panel animate-fade-up' },
    !data.secretsEnabled && React.createElement(Section, { icon: 'shield', title: 'Configuração bloqueada', accent: 'var(--critical)' },
      React.createElement('div', { style: { padding: 12, fontSize: 13, color: 'var(--muted-foreground)' } },
        'Defina ', React.createElement('code', null, 'AGENT_PROVIDER_MASTER_KEY'), ' (32 bytes base64) no .env do daemon e reinicie o container. Sem ela, segredos não podem ser criptografados e a escrita retorna 503.')),
    React.createElement('div', { className: 'grid-2' },
      (data.providers || []).map(p => React.createElement(ProviderCard, { key: p.provider, p, onSaved: refresh })))
  );
}

