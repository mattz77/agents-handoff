/* Formatação — timestamps sempre BRT (UTC-3), regra do projeto. */

const BRT = 'America/Sao_Paulo';

export const fmtTime = (ts) => {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (isNaN(d)) return '—';
  return d.toLocaleTimeString('pt-BR', { timeZone: BRT, hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export const fmtDateTime = (ts) => {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (isNaN(d)) return '—';
  return d.toLocaleString('pt-BR', { timeZone: BRT, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export const fmtRelative = (ts) => {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (isNaN(d)) return '—';
  const diff = Date.now() - d;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? 'atrás' : '';
  if (abs < 5_000) return 'agora';
  if (abs < 60_000) return `${Math.floor(abs / 1000)}s ${suffix}`.trim();
  if (abs < 3_600_000) return `${Math.floor(abs / 60_000)}min ${suffix}`.trim();
  if (abs < 86_400_000) return `${Math.floor(abs / 3_600_000)}h ${suffix}`.trim();
  return `${Math.floor(abs / 86_400_000)}d ${suffix}`.trim();
};

export const fmtNumber = (n) => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return new Intl.NumberFormat('pt-BR').format(n);
};

export const fmtBytes = (bytes) => {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
  const v = bytes / 2 ** (10 * i);
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
};

export const fmtDuration = (ms) => {
  if (ms === null || ms === undefined || isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
};
