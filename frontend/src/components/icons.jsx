import React from 'react';
import {
  Activity, GitCommit, Layers, AlertTriangle, Check, XCircle, Clock, Zap,
  Shield, Database, Server, Cpu, Box, Bell, RotateCcw, ArrowRight,
  ArrowLeftRight, ChevronRight, X, RefreshCw, Search, Brain, Gauge,
  Inbox, Split, Terminal, CircleDot, Users, HardDrive, Settings, LogOut,
  Menu, Play, Radio, Pause, List, FileText, TrendingUp, Folder, Cloud,
  Infinity, GitBranch, Files, Sparkles, Circle, Building2, Workflow,
} from 'lucide-react';

const ICONS = {
  activity: Activity,
  gitCommit: GitCommit,
  layers: Layers,
  alert: AlertTriangle,
  check: Check,
  xCircle: XCircle,
  clock: Clock,
  zap: Zap,
  shield: Shield,
  database: Database,
  server: Server,
  cpu: Cpu,
  box: Box,
  bell: Bell,
  replay: RotateCcw,
  arrowRight: ArrowRight,
  swap: ArrowLeftRight,
  chevronRight: ChevronRight,
  x: X,
  refresh: RefreshCw,
  search: Search,
  brain: Brain,
  gauge: Gauge,
  inbox: Inbox,
  split: Split,
  terminal: Terminal,
  circleDot: CircleDot,
  users: Users,
  hardDrive: HardDrive,
  settings: Settings,
  logout: LogOut,
  menu: Menu,
  play: Play,
  radio: Radio,
  pause: Pause,
  list: List,
  fileText: FileText,
  trending: TrendingUp,
  folder: Folder,
  cloud: Cloud,
  infinity: Infinity,
  gitBranch: GitBranch,
  fileStack: Files,
  sparkles: Sparkles,
  dot: Circle,
  building: Building2,
  workflow: Workflow,
};

function GDriveGlyph({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 87.3 78" aria-hidden="true">
      <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" />
      <path fill="#00ac47" d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" />
      <path fill="#ea4335" d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" />
      <path fill="#00832d" d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
      <path fill="#2684fc" d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
    </svg>
  );
}

function Icon({ name, size = 16, strokeWidth = 1.75, className = '', style = {}, ...props }) {
  const Cmp = ICONS[name] || Circle;
  return (
    <Cmp
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      style={style}
      aria-hidden="true"
      {...props}
    />
  );
}

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

export { Icon, GDriveGlyph };
export const HDLib = { ago, shortId, statusMeta, agentOf, cls };
