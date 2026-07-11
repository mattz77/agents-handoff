/* ============================================================
   Painel Handoff — ícones (Lucide-style, stroke 1.75) + helpers
   Exporta window.Icon e window.HDLib
   ============================================================ */

// Path data — subconjunto Lucide desenhado para o painel.
const ICON_PATHS = {
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  gitCommit: 'M12 3v6 M12 15v6 M3 12h6 M15 12h6|circle:12,12,3',
  layers: 'M12 2 2 7l10 5 10-5-10-5Z M2 17l10 5 10-5 M2 12l10 5 10-5',
  alert: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z M12 9v4 M12 17h.01',
  check: 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4 12 14.01l-3-3',
  xCircle: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z M15 9l-6 6 M9 9l6 6',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z M12 6v6l4 2',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  database: 'M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3Z M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5 M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3',
  server: 'M5 2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z M5 14h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z M6 6h.01 M6 18h.01',
  cpu: 'M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z M9 9h6v6H9z M9 1v3 M15 1v3 M9 20v3 M15 20v3 M20 9h3 M20 14h3 M1 9h3 M1 14h3',
  box: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z M3.3 7 12 12l8.7-5 M12 22V12',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0',
  replay: 'M3 2v6h6 M3.51 9a9 9 0 1 0 2.13-3.36L3 8',
  arrowRight: 'M5 12h14 M12 5l7 7-7 7',
  swap: 'M8 3 4 7l4 4 M4 7h16 M16 21l4-4-4-4 M20 17H4',
  chevronRight: 'M9 18l6-6-6-6',
  x: 'M18 6 6 18 M6 6l12 12',
  refresh: 'M21 2v6h-6 M3 12a9 9 0 0 1 15-6.7L21 8 M3 22v-6h6 M21 12a9 9 0 0 1-15 6.7L3 16',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M21 21l-4.3-4.3',
  brain: 'M12 5a3 3 0 1 0-5.99.5 M12 5a3 3 0 1 1 5.99.5 M6.01 5.5A3.5 3.5 0 0 0 4 12a3.5 3.5 0 0 0 2.5 5.5 M17.99 5.5A3.5 3.5 0 0 1 20 12a3.5 3.5 0 0 1-2.5 5.5 M6.5 17.5A3 3 0 0 0 12 19a3 3 0 0 0 5.5-1.5 M12 5v14',
  gauge: 'M12 14l4-4 M3.34 19a10 10 0 1 1 17.32 0Z',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2 M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z',
  split: 'M16 3h5v5 M8 3H3v5 M21 3l-7.5 7.5a2.83 2.83 0 0 0-.83 2v8.5 M3 3l7.5 7.5',
  terminal: 'M4 17l6-6-6-6 M12 19h8',
  circleDot: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z|circle:12,12,3',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  hardDrive: 'M22 12H2 M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z M6 16h.01 M10 16h.01',
  settings: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z|circle:12,12,3',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  play: 'M6 3l14 9-14 9V3Z',
  radio: 'M4.93 19.07a10 10 0 0 1 0-14.14 M7.76 16.24a6 6 0 0 1 0-8.49 M16.24 7.76a6 6 0 0 1 0 8.49 M19.07 4.93a10 10 0 0 1 0 14.14|circle:12,12,2',
  pause: 'M6 4h4v16H6z M14 4h4v16h-4z',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  fileText: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
  trending: 'M22 7l-8.5 8.5-5-5L2 17 M16 7h6v6',
  folder: 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z',
  cloud: 'M17.5 19a4.5 4.5 0 1 0 0-9h-1.8A7 7 0 1 0 4 15.7',
  infinity: 'M12 12c-2-2.7-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.3 6-4Zm0 0c2 2.7 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.3-6 4Z',
  gitBranch: 'M6 3v12 M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M15 6a9 9 0 0 1-9 9',
  fileStack: 'M21 7h-6a2 2 0 0 1-2-2V1 M17 21h-8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z M4 11v8a2 2 0 0 0 2 2h8',
  sparkles: 'M12 3l1.9 5.8L19.5 10l-5.6 1.2L12 17l-1.9-5.8L4.5 10l5.6-1.2L12 3Z M19 15l.8 2.4L22 18l-2.2.6L19 21l-.8-2.4L16 18l2.2-.6L19 15Z',
  dot: '|circle:12,12,9',
};

// Glifo de marca Google Drive (tri-color autêntico) — integração do DataLake.
function GDriveGlyph({ size = 20 }) {
  return React.createElement('svg', { width: size, height: size, viewBox: '0 0 87.3 78', 'aria-hidden': true },
    React.createElement('path', { fill: '#0066da', d: 'm6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z' }),
    React.createElement('path', { fill: '#00ac47', d: 'm43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z' }),
    React.createElement('path', { fill: '#ea4335', d: 'm73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z' }),
    React.createElement('path', { fill: '#00832d', d: 'm43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z' }),
    React.createElement('path', { fill: '#2684fc', d: 'm59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z' }),
    React.createElement('path', { fill: '#ffba00', d: 'm73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z' }),
  );
}
window.GDriveGlyph = GDriveGlyph;

function Icon({ name, size = 16, strokeWidth = 1.75, className = '', style = {}, ...props }) {
  const raw = ICON_PATHS[name] || ICON_PATHS.dot;
  const [pathsRaw, ...circleDefs] = raw.split('|');
  const paths = pathsRaw.trim();
  const circles = circleDefs.filter((c) => c.startsWith('circle:')).map((c, i) => {
    const [cx, cy, r] = c.replace('circle:', '').split(',');
    return React.createElement('circle', { key: i, cx, cy, r });
  });
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round',
    className, style, 'aria-hidden': true, ...props,
  }, paths ? paths.split(' M').map((seg, i) => React.createElement('path', { key: i, d: i === 0 ? seg : 'M' + seg })) : null, ...circles);
}

// ---- helpers de formatação ----
function ago(iso) {
  if (!iso) return '—';
  const d = new Date(iso); if (isNaN(d)) return String(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 5) return 'agora';
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'min';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
function shortId(s, n = 8) { return s ? (String(s).length > n + 1 ? String(s).slice(0, n) + '…' : s) : '—'; }
function statusMeta(code) { return (window.HD.STATUS[code]) || { label: code, ds: 'neutral', pt: code }; }
function agentOf(id) { return (window.HD.AGENTS[id]) || { id, name: id, model: '—', accent: 'var(--muted-foreground)', tint: 'var(--muted)' }; }
function cls(...a) { return a.filter(Boolean).join(' '); }

window.Icon = Icon;
window.HDLib = { ago, shortId, statusMeta, agentOf, cls };
