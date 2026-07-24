import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Zap, CheckCircle2, KeyRound, Trash2, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { SectionHeader, QueryState, Spotlight } from '../components/ui/misc.jsx';
import { BrandBadge } from '../components/ui/brand-icons.jsx';

const PROVIDER_META = {
  nim: { name: 'NVIDIA NIM', hint: 'z-ai/glm-5.2', keyHint: 'nvapi-…', showBaseUrl: true, brand: 'nvidia' },
  openai: { name: 'OpenAI', hint: 'gpt-5', keyHint: 'sk-…', showBaseUrl: false, brand: null },
  anthropic: { name: 'Anthropic', hint: 'claude-sonnet-5', keyHint: 'sk-ant-…', showBaseUrl: false, brand: 'anthropic' },
  opencode: { name: 'OpenCode Go', hint: 'deepseek-v4-flash-free', keyHint: 'opencode zen key', showBaseUrl: true, brand: 'opencode' },
};

function ProviderCard({ p, secretsEnabled }) {
  const queryClient = useQueryClient();
  const meta = PROVIDER_META[p.provider] || { name: p.provider, hint: '', keyHint: 'api key', showBaseUrl: true };
  const [model, setModel] = React.useState(p.model || '');
  const [baseUrl, setBaseUrl] = React.useState(p.base_url || '');
  const [apiKey, setApiKey] = React.useState('');
  const [isDefault, setIsDefault] = React.useState(!!p.is_default);
  const [test, setTest] = React.useState(null);

  // Re-sincroniza campos quando a query recarrega (ex: após salvar noutro card).
  React.useEffect(() => {
    setModel(p.model || ''); setBaseUrl(p.base_url || ''); setIsDefault(!!p.is_default);
  }, [p.model, p.base_url, p.is_default]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['providers'] });

  const save = useMutation({
    mutationFn: () => {
      const body = { providerType: p.provider, model, isDefault };
      if (meta.showBaseUrl && baseUrl) body.baseUrl = baseUrl;
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      return api.saveProvider(body);
    },
    onSuccess: () => { setApiKey(''); toast.success(`${meta.name} salvo`); invalidate(); },
    onError: (e) => toast.error(`Falha ao salvar: ${e.message}`),
  });

  const doTest = useMutation({
    mutationFn: () => api.testProvider(p.provider),
    onMutate: () => setTest(null),
    onSuccess: (d) => {
      setTest(d);
      if (d?.ok) toast.success(`${p.provider}: pong em ${d.latencyMs}ms`);
      else toast.error(`${p.provider}: ${d?.error || 'falhou'}`);
    },
    onError: (e) => { setTest({ ok: false, error: e.message }); toast.error(`${p.provider}: ${e.message}`); },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteProvider(p.provider),
    onSuccess: () => { setModel(''); setBaseUrl(''); toast.success(`${meta.name} removido`); invalidate(); },
    onError: (e) => toast.error(`Falha ao remover: ${e.message}`),
  });

  const statusTone = p.configured ? (p.is_default ? 'ok' : 'info') : 'warn';
  const statusText = p.configured ? (p.is_default ? 'padrão · conectado' : 'configurado') : 'não configurado';
  const inputCls = 'h-9 px-3 rounded-lg border border-line bg-overlay text-[13px] data text-fg placeholder:text-faint outline-none focus:border-accent-line';

  return (
    <Spotlight className={cn('card p-5 flex flex-col gap-3', p.is_default && 'border-accent-line')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <span className={cn('w-9 h-9 rounded-lg border flex items-center justify-center flex-none',
            p.is_default ? 'bg-accent-soft border-accent-line/50 text-accent' : 'bg-subtle border-line text-fg')}>
            <BrandBadge brand={meta.brand} text={meta.name} size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-fg truncate">{meta.name}</p>
            <p className="text-[11px] text-faint truncate">{p.provider}</p>
          </div>
        </div>
        <Badge tone={statusTone} dot={false}>{statusText}</Badge>
      </div>

      <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={`modelo (ex: ${meta.hint})`} className={inputCls} />
      {meta.showBaseUrl && (
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="base URL (opcional)" className={inputCls} />
      )}
      <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-overlay focus-within:border-accent-line transition-colors">
        <KeyRound size={13} className={p.configured ? 'text-ok flex-none' : 'text-faint flex-none'} />
        <input
          type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
          placeholder={p.configured ? 'API key salva — preencha só p/ trocar' : `API key (${meta.keyHint})`}
          className="flex-1 bg-transparent outline-none text-[13px] data text-fg placeholder:text-faint"
        />
      </div>

      <label className="flex items-center gap-2 text-[12px] text-muted cursor-pointer select-none">
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="accent-[var(--accent)]" />
        Usar como padrão do daemon
      </label>

      {test && (
        <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg text-[11.5px] data',
          test.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad')}>
          {test.ok ? <CheckCircle2 size={13} /> : <Zap size={13} />}
          <span className="truncate">{test.ok ? `pong em ${test.latencyMs}ms` : `erro: ${test.error || 'falhou'}`}</span>
        </div>
      )}

      <div className="flex items-center gap-2 mt-auto pt-1">
        <Button size="sm" variant="primary" loading={save.isPending} disabled={!secretsEnabled} onClick={() => save.mutate()}>Salvar</Button>
        <Button size="sm" variant="outline" loading={doTest.isPending} disabled={!p.configured} onClick={() => doTest.mutate()}>
          <Zap size={12} /> Testar
        </Button>
        {p.configured && (
          <Button size="sm" variant="danger" loading={remove.isPending} disabled={!secretsEnabled} onClick={() => remove.mutate()}>
            <Trash2 size={12} /> Remover
          </Button>
        )}
      </div>
    </Spotlight>
  );
}

export default function Models() {
  const q = useQuery({ queryKey: ['providers'], queryFn: api.providers });
  const data = q.data || {};
  const list = Array.isArray(data.providers) ? data.providers : [];
  const secretsEnabled = data.secretsEnabled !== false;

  return (
    <div>
      <SectionHeader
        title="Providers de IA"
        sub="Chave, modelo, base URL, default e teste de conectividade por provider"
      />
      {data.secretsEnabled === false && (
        <div className="card p-4 mb-4 flex items-start gap-3 border-bad/30">
          <ShieldAlert size={16} className="text-bad flex-none mt-0.5" />
          <div>
            <p className="text-[12.5px] font-semibold text-fg">Configuração bloqueada</p>
            <p className="text-[12px] text-muted mt-0.5">
              Defina <code className="text-fg">AGENT_PROVIDER_MASTER_KEY</code> (32 bytes base64) no .env do daemon e reinicie o container. Sem ela, segredos não podem ser criptografados e a escrita retorna 503.
            </p>
          </div>
        </div>
      )}
      <QueryState query={q} skeleton={<div className="grid sm:grid-cols-2 gap-3">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-64" />)}</div>}>
        <div className="grid sm:grid-cols-2 gap-3">
          {list.map((p) => <ProviderCard key={p.provider} p={p} secretsEnabled={secretsEnabled} />)}
        </div>
      </QueryState>
    </div>
  );
}
