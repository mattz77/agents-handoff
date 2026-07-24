import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Cpu, Zap, CheckCircle2, KeyRound } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { SectionHeader, QueryState, Spotlight } from '../components/ui/misc.jsx';

const PROVIDER_META = {
  nvidia: { name: 'NVIDIA NIM', hint: 'Llama, DeepSeek e família Nemotron via build.nvidia.com' },
  openai: { name: 'OpenAI', hint: 'GPT-4o, o-series e embeddings' },
  anthropic: { name: 'Anthropic', hint: 'Claude Sonnet/Opus — reasoning e code' },
  opencode: { name: 'OpenCode Go', hint: 'Gateway multi-modelo com créditos por janela' },
};

function ProviderCard({ type, config, isDefault, onSetDefault, onTest, testing, testResult }) {
  const meta = PROVIDER_META[type] || { name: type, hint: 'provider customizado' };
  const hasKey = !!(config?.apiKey || config?.api_key || config?.hasKey);
  return (
    <Spotlight className={cn('card p-5 flex flex-col gap-3', isDefault && 'border-accent-line')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <span className={cn(
            'w-9 h-9 rounded-lg border flex items-center justify-center flex-none',
            isDefault ? 'bg-accent-soft border-accent-line/50 text-accent' : 'bg-subtle border-line text-faint',
          )}>
            <Cpu size={16} strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-fg truncate">{meta.name}</p>
            <p className="text-[11px] text-faint truncate">{meta.hint}</p>
          </div>
        </div>
        {isDefault && <Badge tone="accent" dot={false}>default</Badge>}
      </div>

      <div className="flex items-center gap-2 data text-[11px]">
        <KeyRound size={11.5} className={hasKey ? 'text-ok' : 'text-faint'} />
        <span className={hasKey ? 'text-muted' : 'text-faint'}>{hasKey ? 'chave configurada' : 'sem chave'}</span>
        {config?.model && <span className="text-faint ml-auto truncate">{config.model}</span>}
      </div>

      {testResult && (
        <div className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg text-[11.5px] data',
          testResult.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad',
        )}>
          {testResult.ok ? <CheckCircle2 size={13} /> : <Zap size={13} />}
          <span className="truncate">{testResult.message}</span>
        </div>
      )}

      <div className="flex items-center gap-2 mt-auto pt-1">
        <Button size="xs" variant="outline" loading={testing} onClick={onTest}>
          <Zap size={12} /> Testar
        </Button>
        {!isDefault && (
          <Button size="xs" variant="ghost" onClick={onSetDefault}>Tornar default</Button>
        )}
      </div>
    </Spotlight>
  );
}

export default function Models() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['providers'], queryFn: api.providers });
  const [testing, setTesting] = React.useState(null);
  const [results, setResults] = React.useState({});

  const test = useMutation({
    mutationFn: api.testProvider,
    onMutate: (type) => setTesting(type),
    onSettled: () => setTesting(null),
    onSuccess: (d, type) => {
      const ok = d?.ok !== false;
      setResults((r) => ({ ...r, [type]: { ok, message: ok ? (d.message || 'conectado') : (d.error || 'falhou') } }));
      if (ok) toast.success(`${type}: conectado`);
      else toast.error(`${type}: ${d?.error || 'falha no teste'}`);
    },
    onError: (e, type) => {
      setResults((r) => ({ ...r, [type]: { ok: false, message: e.message } }));
      toast.error(`${type}: ${e.message}`);
    },
  });

  const save = useMutation({
    mutationFn: api.saveProviders,
    onSuccess: () => {
      toast.success('Default atualizado');
      queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
    onError: (e) => toast.error(`Falha ao salvar: ${e.message}`),
  });

  const data = q.data || {};
  const providers = data.providers || data;
  const defaultType = data.default || data.defaultProvider;
  const types = Object.keys(providers).filter((k) => typeof providers[k] === 'object' && providers[k] !== null);

  return (
    <div>
      <SectionHeader title="Providers de IA" sub="Chaves, modelo default e teste de conectividade por provider" />
      <QueryState query={q} skeleton={<div className="grid sm:grid-cols-2 gap-3">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-44" />)}</div>}>
        <div className="grid sm:grid-cols-2 gap-3">
          {types.map((type) => (
            <ProviderCard
              key={type}
              type={type}
              config={providers[type]}
              isDefault={type === defaultType}
              testing={testing === type}
              testResult={results[type]}
              onTest={() => test.mutate(type)}
              onSetDefault={() => save.mutate({ ...data, default: type })}
            />
          ))}
        </div>
      </QueryState>
    </div>
  );
}
