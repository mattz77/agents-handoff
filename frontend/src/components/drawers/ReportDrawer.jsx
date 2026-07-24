import React from 'react';
import { FileWarning, GitPullRequest, Lightbulb } from 'lucide-react';
import { Drawer, KV, JsonBlock } from '../ui/drawer.jsx';
import { Badge } from '../ui/badge.jsx';
import { Button } from '../ui/button.jsx';
import { cn } from '../../lib/cn';
import { fmtDateTime } from '../../lib/format';

function sevTone(s) {
  const v = (s || '').toUpperCase();
  if (v === 'HIGH' || v === 'CRITICAL') return 'bad';
  if (v === 'MEDIUM') return 'warn';
  return 'info';
}

/* Detalhe de um report do pipeline de code review. */
export function ReportDrawer({ report, onClose }) {
  const r = report || {};
  const issues = Array.isArray(r.issues) ? r.issues : [];
  const refactors = Array.isArray(r.refactors) ? r.refactors : [];

  return (
    <Drawer
      open={!!report}
      onClose={onClose}
      title={r.display_name || r.project_slug || 'Report'}
      sub={`${r.commit_sha || ''} · ${fmtDateTime(r.created_at)}`}
      width={540}
      actions={
        r.pr_url ? (
          <a href={r.pr_url} target="_blank" rel="noreferrer">
            <Button size="xs" variant="outline"><GitPullRequest size={12} /> #{r.pr_number}</Button>
          </a>
        ) : null
      }
    >
      <div className="flex items-center gap-3 mb-4">
        <span className={cn(
          'w-11 h-11 rounded-xl border flex items-center justify-center data tnum text-[16px] font-bold',
          r.score >= 8 ? 'bg-ok-soft border-ok/25 text-ok' : r.score >= 5 ? 'bg-warn-soft border-warn/25 text-warn' : 'bg-bad-soft border-bad/25 text-bad',
        )}>
          {r.score ?? '—'}
        </span>
        <div>
          <p className="text-[13px] font-semibold text-fg">Score do review</p>
          <p className="data text-[11px] text-faint">{r.model_used || 'modelo desconhecido'}{r.diff_lines != null && ` · ${r.diff_lines} linhas de diff`}</p>
        </div>
      </div>

      <KV k="Projeto" v={r.project_slug} />
      <KV k="Commit" v={r.commit_sha} />
      <KV k="PR comentado" v={r.pr_commented ? 'sim' : 'não'} />

      {r.summary && <JsonBlock data={r.summary} label="Resumo" />}

      {issues.length > 0 && (
        <div className="mt-4">
          <p className="text-[10.5px] uppercase tracking-[0.07em] text-faint font-semibold mb-2">
            Issues ({issues.length})
          </p>
          <div className="flex flex-col gap-2">
            {issues.map((it, i) => (
              <div key={i} className="flex items-start gap-2.5 p-3 rounded-lg border border-line bg-subtle/50">
                <Badge tone={sevTone(it.severity)} dot={false} className="flex-none mt-0.5">
                  {(it.severity || '?').toString().slice(0, 4)}
                </Badge>
                <div className="min-w-0">
                  <p className="text-[12px] text-fg leading-snug">{it.message || it.title || it.description || JSON.stringify(it)}</p>
                  {(it.file || it.path) && (
                    <p className="data text-[10.5px] text-faint mt-1 flex items-center gap-1 truncate">
                      <FileWarning size={10.5} /> {it.file || it.path}{it.line ? `:${it.line}` : ''}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {refactors.length > 0 && (
        <div className="mt-4">
          <p className="text-[10.5px] uppercase tracking-[0.07em] text-faint font-semibold mb-2 flex items-center gap-1.5">
            <Lightbulb size={11} /> Refactors sugeridos ({refactors.length})
          </p>
          <div className="flex flex-col gap-2">
            {refactors.map((rf, i) => (
              <div key={i} className="p-3 rounded-lg border border-line bg-subtle/50">
                <p className="text-[12px] text-muted leading-snug">{typeof rf === 'string' ? rf : (rf.message || rf.title || JSON.stringify(rf))}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </Drawer>
  );
}
