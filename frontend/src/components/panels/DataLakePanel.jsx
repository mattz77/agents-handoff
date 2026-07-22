import React from 'react';
import { Icon, HDLib, GDriveGlyph } from '../icons.jsx';
import { HDW } from '../widgets.jsx';
import { StatusBadge, fmtAgo } from './shared.jsx';

const DS = window.CommitBriefingDesignSystem_27542e;
const { Card, Badge, Separator } = DS;
const { ago, agentOf, cls } = HDLib;
const { Section, DataTable } = HDW;

function fmtSize(mb) {
  if (mb >= 1048576) return (mb / 1048576).toFixed(2) + ' TB';
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
  return mb + ' MB';
}

function DlMount({ dl }) {
  return (
    <Card className="dl-mount">
      <div className="dl-mount__top">
        <span className="dl-mount__glyph"><GDriveGlyph size={34} /></span>
        <div className="dl-mount__id">
          <div className="dl-mount__name">Luma_DataLake</div>
          <div className="dl-mount__path mono">{dl.mount}</div>
        </div>
        <div className="dl-mount__status">
          <StatusBadge status="good">montado</StatusBadge>
          <span className="dl-mount__sync mono">sync {ago(dl.lastSync)} atrás</span>
        </div>
      </div>
      <Separator />
      <div className="dl-mount__facts">
        {[['Drive', dl.drive, 'cloud'], ['Acesso', dl.access, 'cpu'], ['Resiliência', dl.cache, 'shield']].map(([k, v, icon], i) => (
          <div key={i} className="dl-fact">
            <span className="dl-fact__icon"><Icon name={icon} size={15} /></span>
            <div className="dl-fact__meta">
              <span className="dl-fact__k">{k}</span>
              <span className="dl-fact__v">{v}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function DlGauge({ dl, pct }) {
  const R = 52, C = 2 * Math.PI * R, dash = C * pct / 100;
  const kSize = (dl.knowledge || []).reduce((a, k) => a + (k.sizeMB || 0), 0);
  const pSize = (dl.projects || []).reduce((a, p) => a + (p.sizeMB || 0), 0);
  const bSize = (dl.backups || []).reduce((a, b) => a + (b.sizeMB || 0), 0);
  const catTotal = kSize + pSize + bSize || 1;
  const cats = [
    ['Knowledge', kSize, 'var(--copper)'],
    ['Projetos', pSize, 'var(--info)'],
    ['Backups', bSize, 'var(--good)'],
  ];
  return (
    <Card className="dl-gauge">
      <div className="dl-gauge__ring">
        <svg width={132} height={132} viewBox="0 0 132 132">
          <circle cx={66} cy={66} r={R} fill="none" stroke="var(--muted)" strokeWidth={11} />
          <circle cx={66} cy={66} r={R} fill="none" stroke="var(--copper)" strokeWidth={11} strokeLinecap="round"
            strokeDasharray={dash + ' ' + C} transform="rotate(-90 66 66)" className="dl-gauge__arc" />
        </svg>
        <div className="dl-gauge__center">
          <span className="dl-gauge__pct mono">{pct}%</span>
          <span className="dl-gauge__lbl">em uso</span>
        </div>
      </div>
      <div className="dl-gauge__legend">
        <div className="dl-gauge__row"><span className="dl-gauge__k">Usado</span><span className="dl-gauge__v mono">{fmtSize(dl.usedMB)}</span></div>
        <div className="dl-gauge__row"><span className="dl-gauge__k">Capacidade</span><span className="dl-gauge__v mono">{fmtSize(dl.capacityMB)}</span></div>
        <div className="dl-gauge__row"><span className="dl-gauge__k">Livre</span><span className="dl-gauge__v mono tone-good">{fmtSize(dl.capacityMB - dl.usedMB)}</span></div>
      </div>
      <div className="dl-cats">
        <div className="dl-cats__bar">
          {cats.map(([, n, c], i) => n > 0 && <span key={i} style={{ width: (n / catTotal * 100) + '%', background: c }} />)}
        </div>
        <div className="dl-cats__legend">
          {cats.map(([k, n, c], i) => (
            <span key={i} className="dl-cats__item">
              <i style={{ background: c }} />{k} <b className="mono">{fmtSize(n)}</b>
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

function BackupList({ backups }) {
  const tone = { ok: 'good', warn: 'warning', fail: 'critical', 'n/a': 'neutral' };
  const label = { ok: 'restore ok', warn: 'check pendente', fail: 'falhou', 'n/a': '-' };
  return (
    <div className="backups">
      {(backups || []).map((b, i) => (
        <div key={i} className="backup">
          <div className="backup__top">
            <span className="backup__engine mono">{b.engine} · {b.project}</span>
            <StatusBadge status={tone[b.restore]}>{label[b.restore]}</StatusBadge>
          </div>
          <div className="backup__meta">
            <span><b className="mono">{b.count}</b> snapshots</span>
            <span><b className="mono">{fmtSize(b.sizeMB)}</b></span>
            <span>last <b className="mono">{ago(b.lastAt)} atrás</b></span>
            {b.note && <span className="muted">{b.note}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function BrainSync({ files }) {
  return (
    <div className="bsync">
      {(files || []).map((f, i) => {
        const ag = agentOf(window.HD.normalizeAgentId?.(f.updatedBy) || f.updatedBy);
        return (
          <div key={i} className="bsync__row">
            <span className="bsync__icon"><Icon name="fileText" size={15} /></span>
            <div className="bsync__main">
              <div className="bsync__name mono">
                {f.name}
                <span className="bsync__mode mono">{f.mode}</span>
              </div>
              <div className="bsync__role">{f.role}</div>
            </div>
            <div className="bsync__side">
              <span className="bsync__by mono" style={{ color: ag.accent }}>{ag.name}</span>
              <span className="bsync__when mono">{f.lines} linhas / {ago(f.updated)} atrás</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function N8nWorkflowsList({ n8n }) {
  if (!n8n || !n8n.orgs || !n8n.orgs.length) {
    return <div className="muted" style={{ padding: '8px 0' }}>Nenhum workflow backupiado.</div>;
  }
  const n8nCols = [
    { label: 'Org', render: (r) => <span className="dl-name"><Icon name="building" size={13} className="dl-name__i" /><b>{r.name}</b></span> },
    { label: 'Projetos', mono: true, align: 'right', render: (r) => r.projects },
    { label: 'Workflows', mono: true, align: 'right', render: (r) => <span style={{ color: 'var(--copper)' }}>{r.workflows}</span> },
    { label: 'Tamanho', mono: true, align: 'right', render: (r) => fmtSize(r.sizeMB) },
  ];
  return (
    <>
      <DataTable cols={n8nCols} rows={n8n.orgs} />
      <div className="dl-stat__sub mono" style={{ marginTop: 8 }}>
        {n8n.lastBackup ? 'last backup ' + ago(n8n.lastBackup) + ' atrás' : 'sem backup'}
      </div>
    </>
  );
}

function MemoryRagCard({ mem }) {
  const ragTone = mem.hasLance ? 'good' : (mem.corpusFiles > 0 ? 'warning' : 'neutral');
  const ragLabel = mem.hasLance ? 'ativo' : (mem.corpusFiles > 0 ? 'scaffold' : 'planejado');
  return (
    <div className="dl-stats" style={{ flexDirection: 'column', gap: 8 }}>
      {[
        ['Corpus', mem.corpusFiles + ' arquivos', 'fileStack', 'neutral'],
        ['Vetores', (mem.vectorCount || 0).toLocaleString('pt-BR'), 'sparkles', ragTone],
        ['Ingest', mem.lastIngest ? ago(mem.lastIngest) + ' atrás' : 'nunca', 'clock', 'neutral'],
        ['LanceDB', mem.hasLance ? 'montado' : 'ausente', 'database', ragTone],
      ].map(([k, v, icon, tone], i) => (
        <Card key={i} className="dl-stat" style={{ padding: '8px 12px' }}>
          <span className={cls('dl-stat__icon', 'tone-' + tone)}><Icon name={icon} size={14} /></span>
          <div className="dl-stat__meta">
            <span className="dl-stat__v mono">{v}</span>
            <span className="dl-stat__k">{k}</span>
          </div>
        </Card>
      ))}
      <div style={{ marginTop: 4 }}>
        <StatusBadge status={ragTone}>RAG: {ragLabel}</StatusBadge>
      </div>
    </div>
  );
}

function RoadmapNote({ dl }) {
  return (
    <div className="roadmap">
      <div className="roadmap__item">
        <span className="roadmap__dot" />
        <div>
          <div className="roadmap__t">RAG nativo sobre o Drive</div>
          <div className="roadmap__d">Embeddings leves p/ Semantic Search autônomo nos 5 TB do Data Lake.</div>
        </div>
      </div>
      <div className="roadmap__item">
        <span className="roadmap__dot" />
        <div>
          <div className="roadmap__t">Observabilidade autônoma</div>
          <div className="roadmap__d">n8n ingere alertas do Docker/Traefik direto na task-queue.md.</div>
        </div>
      </div>
      <div className="roadmap__foot">
        <Badge variant="outline" mono>RAG: {dl.rag}</Badge>
      </div>
    </div>
  );
}

export function DataLakePanel() {
  const dl = window.HD.datalake;
  const files = window.HD.brainFiles;
  const pct = Math.round(dl.usedMB / dl.capacityMB * 100);
  const totalFiles = dl.knowledge.reduce((a, k) => a + k.files, 0)
    + dl.projects.reduce((a, p) => a + p.files, 0)
    + dl.backups.reduce((a, b) => a + b.count, 0);

  const kbCols = [
    { label: 'Área', render: (r) => <span className="dl-name"><Icon name="folder" size={14} className="dl-name__i" />{r.name}</span> },
    { label: 'Arquivos', mono: true, align: 'right', render: (r) => r.files.toLocaleString('pt-BR') },
    { label: 'Tamanho', mono: true, align: 'right', render: (r) => fmtSize(r.sizeMB) },
    { label: 'Atualizado', muted: true, align: 'right', nowrap: true, render: (r) => ago(r.updated) },
  ];
  const projCols = [
    { label: 'Projeto', render: (r) => <span className="dl-name"><Icon name="gitBranch" size={13} className="dl-name__i" /><Badge variant="outline" mono>{r.name}</Badge></span> },
    { label: 'Arquivos', mono: true, align: 'right', render: (r) => r.files.toLocaleString('pt-BR') },
    { label: 'Tamanho', mono: true, align: 'right', render: (r) => fmtSize(r.sizeMB) },
    { label: 'Atualizado', muted: true, align: 'right', nowrap: true, render: (r) => ago(r.updated) },
  ];

  return (
    <div className="panel animate-fade-up stagger">
      <div className="dl-hero">
        <DlMount dl={dl} />
        <DlGauge dl={dl} pct={pct} />
      </div>
      <div className="dl-stats">
        {[
          ['Volume total', fmtSize(dl.totalSizeMB), 'database', 'copper'],
          ['Arquivos indexados', totalFiles.toLocaleString('pt-BR'), 'fileStack', 'neutral'],
          ['Backups', dl.backupCount, 'shield', 'good', 'last ' + ago(dl.lastBackup) + ' atrás'],
          ['Áreas + projetos', (dl.knowledge.length + dl.projects.length), 'layers', 'neutral'],
        ].map(([k, v, icon, tone, sub], i) => (
          <Card key={i} className="dl-stat">
            <span className={cls('dl-stat__icon', 'tone-' + tone)}><Icon name={icon} size={16} /></span>
            <div className="dl-stat__meta">
              <span className="dl-stat__v mono">{v}</span>
              <span className="dl-stat__k">{k}</span>
              {sub && <span className="dl-stat__sub mono">{sub}</span>}
            </div>
          </Card>
        ))}
      </div>
      <div className="grid-side">
        <div className="col">
          <Section icon="brain" title="Knowledge Base" count={dl.knowledge.length}
            actions={<span className="sub-note mono">Knowledge_Base/</span>}>
            <DataTable cols={kbCols} rows={dl.knowledge} />
          </Section>
          <Section icon="gitBranch" title="Projetos versionados" count={dl.projects.length}
            actions={<span className="sub-note mono">Projetos/</span>}>
            <DataTable cols={projCols} rows={dl.projects} />
          </Section>
          <Section icon="workflow" title="n8n Workflows" count={(dl.n8nWorkflows || {}).totalWorkflows || 0}
            actions={<span className="sub-note mono">Backups/n8n-workflows/</span>}>
            <N8nWorkflowsList n8n={dl.n8nWorkflows || {}} />
          </Section>
          <Section icon="fileText" title="LLM-Brain (sincronismo de contexto)" count={files.length} accent="var(--copper)"
            actions={<span className="sub-note">cérebro rápido / estado de curto prazo</span>}>
            <BrainSync files={files} />
          </Section>
        </div>
        <div className="col sticky-col">
          <Section icon="shield" title="Backups & restore-check" count={dl.backups.length}>
            <BackupList backups={dl.backups} />
          </Section>
          <Section icon="sparkles" title="Roadmap" accent="var(--copper)">
            <RoadmapNote dl={dl} />
          </Section>
          <Section icon="brain" title="Memory (RAG)" accent="var(--copper)">
            <MemoryRagCard mem={dl.memory || {}} />
          </Section>
        </div>
      </div>
    </div>
  );
}
