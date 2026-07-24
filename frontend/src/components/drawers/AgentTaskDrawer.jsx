import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RotateCcw, Trash2, ExternalLink, Check, X as XIcon, Terminal } from 'lucide-react';
import { api } from '../../lib/api';
import { Drawer, KV, JsonBlock } from '../ui/drawer.jsx';
import { StatusBadge } from '../ui/badge.jsx';
import { Button } from '../ui/button.jsx';
import { Spinner } from '../ui/misc.jsx';
import { cn } from '../../lib/cn';
import { fmtDateTime, fmtRelative, fmtTime } from '../../lib/format';

const LIVE_STATUSES = ['queued', 'running'];

/* Detalhe de task delegada — log ao vivo enquanto em execução, ações (retry/delete/PR/approve). */
export function AgentTaskDrawer({ task, onClose }) {
  const queryClient = useQueryClient();
  const id = task?.id;
  const q = useQuery({
    queryKey: ['agent-task', id],
    queryFn: () => api.agentTask(id),
    enabled: !!id,
    // Task roda em background no servidor (POST retorna 202 na hora) — só polling mostra o
    // progresso real; sem isso o drawer ficava congelado no snapshot do momento em que abriu.
    refetchInterval: (query) => LIVE_STATUSES.includes((query.state.data?.status || '').toLowerCase()) ? 2000 : false,
  });
  const t = q.data || task || {};
  const isLive = LIVE_STATUSES.includes((t.status || '').toLowerCase());
  const canRetry = ['failed', 'rejected'].includes((t.status || '').toLowerCase());
  const canReview = !!t.pr_number && !['merged', 'rejected'].includes((t.status || '').toLowerCase());

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
  const approve = useMutation({
    mutationFn: () => api.approveAgentTask(id),
    onSuccess: (d) => {
      toast.success(d?.promotion?.prUrl ? 'PR mergeado — promoção aberta' : 'PR mergeado');
      invalidate(); onClose();
    },
    onError: (e) => toast.error(`Approve falhou: ${e.message}`),
  });
  const reject = useMutation({
    mutationFn: () => api.rejectAgentTask(id),
    onSuccess: () => { toast.success('PR fechado e task rejeitada'); invalidate(); onClose(); },
    onError: (e) => toast.error(`Reject falhou: ${e.message}`),
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
            {canReview && (
              <>
                <Button size="sm" variant="soft" loading={approve.isPending} onClick={() => approve.mutate()}>
                  <Check size={13} /> Approve (merge)
                </Button>
                <Button size="sm" variant="danger" loading={reject.isPending} onClick={() => reject.mutate()}>
                  <XIcon size={13} /> Reject
                </Button>
              </>
            )}
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
          <LiveTaskLog log={t.log} live={isLive} />
        </>
      )}
    </Drawer>
  );
}

function LiveTaskLog({ log, live }) {
  const entries = Array.isArray(log) ? log : [];
  const endRef = React.useRef(null);
  React.useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [entries.length]);
  if (entries.length === 0) return null;
  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-1.5">
        <Terminal size={11} className="text-faint" />
        <p className="text-[10.5px] uppercase tracking-[0.07em] text-faint font-semibold">Log do agente</p>
        {live && <span className="status-dot status-dot--pulse bg-accent" />}
      </div>
      <div className="data text-[11px] leading-[1.65] bg-[#050506] border border-line rounded-lg p-3 max-h-[300px] overflow-y-auto">
        {entries.map((l, i) => (
          <div key={i} className="text-muted whitespace-pre-wrap break-words">
            <span className="text-faint">{fmtTime(l.at)}</span> {l.message}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
