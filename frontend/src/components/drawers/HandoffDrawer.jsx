import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Drawer, KV, JsonBlock } from '../ui/drawer.jsx';
import { StatusBadge } from '../ui/badge.jsx';
import { Spinner } from '../ui/misc.jsx';
import { fmtDateTime } from '../../lib/format';

/* Detalhe completo de um handoff — aberto ao clicar na linha da tabela. */
export function HandoffDrawer({ id, onClose }) {
  const q = useQuery({
    queryKey: ['handoff', id],
    queryFn: () => api.handoff(id),
    enabled: !!id,
  });
  const h = q.data || {};
  const hermesQ = useQuery({
    queryKey: ['hermes', h.correlation_id],
    queryFn: () => api.hermes(h.correlation_id),
    enabled: !!h.correlation_id,
  });
  const hermesSteps = Array.isArray(hermesQ.data) ? hermesQ.data : (hermesQ.data?.items || hermesQ.data?.audits || []);

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={h.hermes_resumo || h.task_id || 'Handoff'}
      sub={h.task_id}
      actions={h.lifecycle_status && <StatusBadge status={h.lifecycle_status} />}
    >
      {q.isPending ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : q.isError ? (
        <p className="text-[12.5px] text-bad">Falha ao carregar: {q.error.message}</p>
      ) : (
        <>
          <div className="mb-2">
            <KV k="Correlação" v={h.correlation_id} />
            <KV k="Fluxo" v={`${h.sender || '—'} → ${h.receiver || '—'}`} />
            <KV k="Projeto" v={h.project} />
            <KV k="Branch" v={h.branch} />
            <KV k="Tentativa" v={h.attempt} />
            <KV k="Criado" v={fmtDateTime(h.created_at)} />
            <KV k="Atualizado" v={fmtDateTime(h.updated_at)} />
            <KV k="Ação pendente" v={h.pending_action} />
          </div>
          {(h.hermes_severidade || h.hermes_nota != null) && (
            <div className="mt-4 p-3 rounded-lg bg-subtle border border-line">
              <p className="text-[10.5px] uppercase tracking-[0.07em] text-faint font-semibold mb-1.5">Análise Hermes</p>
              <div className="flex items-center gap-3 data text-[12px] text-muted">
                {h.hermes_severidade && <span>severidade: <b className="text-fg">{h.hermes_severidade}</b></span>}
                {h.hermes_nota != null && <span>nota: <b className="text-fg">{h.hermes_nota}</b></span>}
              </div>
            </div>
          )}
          {h.correlation_id && hermesSteps.length > 0 && (
            <div className="mt-4">
              <p className="text-[10.5px] uppercase tracking-[0.07em] text-faint font-semibold mb-1.5">Agents Hermes</p>
              <div className="flex flex-col gap-1.5">
                {hermesSteps.map((s, i) => (
                  <div key={s.id || i} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-subtle/60 border border-line data text-[11.5px]">
                    <StatusBadge status={s.status} />
                    <span className="text-muted truncate">{s.name || s.agent || s.step || '—'}</span>
                    {s.updated_at && <span className="text-faint ml-auto flex-none">{fmtDateTime(s.updated_at)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          <JsonBlock data={h.payload || h.envelope || h.data} label="Payload" />
          <JsonBlock data={h.error || h.last_error} label="Erro" />
        </>
      )}
    </Drawer>
  );
}
