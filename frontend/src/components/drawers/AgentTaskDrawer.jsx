import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RotateCcw, Trash2, ExternalLink } from 'lucide-react';
import { api } from '../../lib/api';
import { Drawer, KV, JsonBlock } from '../ui/drawer.jsx';
import { StatusBadge } from '../ui/badge.jsx';
import { Button } from '../ui/button.jsx';
import { Spinner } from '../ui/misc.jsx';
import { fmtDateTime, fmtRelative } from '../../lib/format';

/* Detalhe de task delegada — log completo, erro, ações (retry/delete/PR). */
export function AgentTaskDrawer({ task, onClose }) {
  const queryClient = useQueryClient();
  const id = task?.id;
  const q = useQuery({
    queryKey: ['agent-task', id],
    queryFn: () => api.agentTask(id),
    enabled: !!id,
  });
  const t = q.data || task || {};
  const canRetry = ['failed', 'rejected'].includes((t.status || '').toLowerCase());

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['agent-tasks'] });
    queryClient.invalidateQueries({ queryKey: ['agent-task', id] });
  };
  const retry = useMutation({
    mutationFn: () => api.retryAgentTask(id),
    onSuccess: () => { toast.success('Retry clonado como nova task'); invalidate(); onClose(); },
    onError: (e) => toast.error(`Retry falhou: ${e.message}`),
  });
  const del = useMutation({
    mutationFn: () => api.deleteAgentTask(id),
    onSuccess: () => { toast.success('Task removida'); invalidate(); onClose(); },
    onError: (e) => toast.error(`Delete falhou: ${e.message}`),
  });

  return (
    <Drawer
      open={!!task}
      onClose={onClose}
      title={t.title || 'Task'}
      sub={t.id}
      actions={t.status && <StatusBadge status={t.status} />}
    >
      {q.isPending && !task ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {canRetry && (
              <Button size="sm" variant="soft" loading={retry.isPending} onClick={() => retry.mutate()}>
                <RotateCcw size={13} /> Reexecutar
              </Button>
            )}
            {t.pr_url && (
              <a href={t.pr_url} target="_blank" rel="noreferrer">
                <Button size="sm" variant="outline"><ExternalLink size={13} /> PR #{t.pr_number}</Button>
              </a>
            )}
            <Button size="sm" variant="danger" loading={del.isPending} onClick={() => del.mutate()}>
              <Trash2 size={13} /> Remover
            </Button>
          </div>

          <KV k="Projeto" v={t.project_slug} />
          <KV k="Engine" v={t.engine} />
          <KV k="Model" v={t.model} />
          <KV k="Branch" v={t.branch} />
          <KV k="Criada" v={fmtDateTime(t.created_at)} />
          <KV k="Atualizada" v={t.updated_at ? `${fmtDateTime(t.updated_at)} (${fmtRelative(t.updated_at)})` : null} />

          {t.description && <JsonBlock data={t.description} label="Descrição" />}
          {t.error && <JsonBlock data={t.error} label="Erro" />}
          {t.log && <JsonBlock data={t.log} label="Log do agente" />}
        </>
      )}
    </Drawer>
  );
}
