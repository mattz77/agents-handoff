import React from "react";
import { Icon, HDLib } from "../icons.jsx";
import { HDW } from "../widgets.jsx";
import { StatusBadge, fmtAgo } from "./shared.jsx";

const DS = window.CommitBriefingDesignSystem_27542e;
const { Card, Button, Badge } = DS;
const { shortId, cls, ago } = HDLib;
const { Section, StatusPill, DataTable, Sparkline } = HDW;

// Anel de score 0-10 (mesma linguagem visual do gauge do DataLake).
function ScoreRing({ score, tone }) {
  const R = 44, C = 2 * Math.PI * R;
  const pct = score == null ? 0 : Math.max(0, Math.min(score / 10, 1));
  return React.createElement('div', { className: 'cr-ring' },
    React.createElement('svg', { width: 112, height: 112, viewBox: '0 0 112 112' },
      React.createElement('circle', { cx: 56, cy: 56, r: R, fill: 'none', stroke: 'var(--muted)', strokeWidth: 10 }),
      React.createElement('circle', { cx: 56, cy: 56, r: R, fill: 'none', stroke: 'var(--' + tone + ')', strokeWidth: 10, strokeLinecap: 'round',
        strokeDasharray: (C * pct) + ' ' + C, transform: 'rotate(-90 56 56)', className: 'cr-ring__arc' })),
    React.createElement('div', { className: 'cr-ring__center' },
      React.createElement('span', { className: cls('cr-ring__val mono', 'tone-' + tone) }, score == null ? 'N/A' : score.toFixed(1)),
      React.createElement('span', { className: 'cr-ring__lbl' }, 'score')));
}

export function CodeReviewPanel() {
  const [crData, setCrData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [running, setRunning] = React.useState(false);
  const [selected, setSelected] = React.useState(0);
  const [projectFilter, setProjectFilter] = React.useState('');
  const [taskState, setTaskState] = React.useState({}); // issue key -> 'creating'|'done'|'error'
  const [models, setModels] = React.useState([]);
  const [recommended, setRecommended] = React.useState({ review: [], fix: [], verify: [], test: [] });
  // Seleção de modelo por função persiste em localStorage — usuário não deveria ter
  // que reescolher toda vez que a página recarrega ou o attack termina.
  const [modelSel, setModelSelRaw] = React.useState(() => localStorage.getItem('cr.model.review') || '');
  const [attackModelSel, setAttackModelSelRaw] = React.useState(() => localStorage.getItem('cr.model.fix') || '');
  const [verifyModelSel, setVerifyModelSelRaw] = React.useState(() => localStorage.getItem('cr.model.verify') || '');
  const setModelSel = React.useCallback((v) => { localStorage.setItem('cr.model.review', v); setModelSelRaw(v); }, []);
  const setAttackModelSel = React.useCallback((v) => { localStorage.setItem('cr.model.fix', v); setAttackModelSelRaw(v); }, []);
  const setVerifyModelSel = React.useCallback((v) => { localStorage.setItem('cr.model.verify', v); setVerifyModelSelRaw(v); }, []);
  const [showModelPickers, setShowModelPickers] = React.useState(false);
  const [runError, setRunError] = React.useState('');
  const [reviewStep, setReviewStep] = React.useState('');
  const [attacks, setAttacks] = React.useState([]);
  const [attacking, setAttacking] = React.useState(false);
  const [merging, setMerging] = React.useState(false);
  const [promotionInfo, setPromotionInfo] = React.useState(null);
  const [prs, setPrs] = React.useState(null);
  const [conflictPr, setConflictPr] = React.useState(null); // { number, slug } do drawer aberto
  const [conflictData, setConflictData] = React.useState(null); // resultado do GET /conflicts
  const [conflictLoading, setConflictLoading] = React.useState(false);
  const [conflictAttempt, setConflictAttempt] = React.useState(null); // status da resolução em curso
  const pollRef = React.useRef(null);
  const timeoutRef = React.useRef(null);

  // Slug do projeto exibido — filtro ativo, ou projeto do report selecionado quando em "Todos".
  const shownSlug = React.useMemo(() => {
    if (projectFilter) return projectFilter;
    const all = (crData && crData.reports) || [];
    const l = all[Math.min(selected, Math.max(all.length - 1, 0))] || all[0];
    return (l && l.project_slug) || '';
  }, [crData, projectFilter, selected]);

  // PRs abertos + últimos mergeados do projeto exibido.
  React.useEffect(() => {
    if (!shownSlug) { setPrs(null); return; }
    let alive = true;
    setPrs(null);
    fetch('/ops/api/codereview/prs?slug=' + encodeURIComponent(shownSlug))
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive) setPrs(d); })
      .catch(() => { if (alive) setPrs(null); });
    return () => { alive = false; };
  }, [shownSlug]);

  const load = React.useCallback(() => {
    return fetch('/ops/api/codereview')
      .then(res => res.json())
      .then(data => { setCrData(data); setLoading(false); })
      .catch(err => { console.error('Failed to fetch code review data', err); setLoading(false); });
  }, []);

  const loadAttacks = React.useCallback(() => {
    return fetch('/ops/api/codereview/attacks')
      .then(r => r.json())
      .then(d => {
        const list = Array.isArray(d.attacks) ? d.attacks : [];
        setAttacks(list);
        return list;
      })
      .catch(() => []);
  }, []);

  React.useEffect(() => { load(); loadAttacks(); return () => { if (pollRef.current) clearInterval(pollRef.current); if (timeoutRef.current) clearTimeout(timeoutRef.current); }; }, [load, loadAttacks]);
  React.useEffect(() => {
    fetch('/ops/api/codereview/models').then(r => r.json())
      .then(d => {
        setModels(Array.isArray(d.models) ? d.models : []);
        if (d.recommended) setRecommended(d.recommended);
      })
      .catch(() => {});
  }, []);

  // Enquanto houver ciclo running, polla a cada 2s — current_step muda a cada fase
  // (revisando/commitando/verificando), então intervalo curto é o que dá a sensação de
  // "ver o agente trabalhando" em vez de só um spinner sem contexto.
  // Depende só de `attacking` (não de `attacks`, que muda a cada poll) — antes recriava o
  // interval a cada tick e, se a lista buscada num instante intermediário não trouxesse
  // nenhum item running (race com o insert no banco, ou só timing), o efeito saía sem nunca
  // ligar o polling e sem resetar `attacking`, travando o botão em "Atacando…" pra sempre
  // (só um F5 recarregava attacks do zero e corrigia o estado).
  React.useEffect(() => {
    if (!attacking) return;
    const t = setInterval(() => {
      loadAttacks().then(list => {
        if (!list.some(a => a.status === 'running')) { setAttacking(false); load(); }
      });
    }, 2000);
    return () => clearInterval(t);
  }, [attacking, loadAttacks, load]);

  // Timers de JS são clampados/pausados em aba em segundo plano por muitos browsers — ao
  // voltar o foco, força um refresh imediato em vez de esperar o próximo tick do polling
  // (que pode ter ficado parado o tempo todo que a aba esteve oculta).
  React.useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') { loadAttacks(); load(); } };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [loadAttacks, load]);

  const openConflict = React.useCallback((slug, prNumber) => {
    setConflictPr({ slug, number: prNumber });
    setConflictData(null);
    setConflictAttempt(null);
    setConflictLoading(true);
    fetch(`/ops/api/codereview/conflicts?slug=${encodeURIComponent(slug)}&prNumber=${prNumber}`)
      .then(r => r.json())
      .then(d => setConflictData(d))
      .catch(e => setConflictData({ ok: false, error: String(e) }))
      .finally(() => setConflictLoading(false));
    fetch(`/ops/api/codereview/conflicts/status?slug=${encodeURIComponent(slug)}&prNumber=${prNumber}`)
      .then(r => r.json())
      .then(d => setConflictAttempt(d.attempt || null))
      .catch(() => {});
  }, []);

  const resolveConflict = React.useCallback(() => {
    if (!conflictPr) return;
    fetch('/ops/api/codereview/conflicts/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: conflictPr.slug, prNumber: conflictPr.number }),
    }).then(() => setConflictAttempt({ status: 'running', current_step: 'iniciando…' }))
      .catch(e => alert(e));
  }, [conflictPr]);

  // Enquanto a resolução estiver rodando, polla o status a cada 3s.
  React.useEffect(() => {
    if (!conflictPr || !conflictAttempt || conflictAttempt.status !== 'running') return;
    const t = setInterval(() => {
      fetch(`/ops/api/codereview/conflicts/status?slug=${encodeURIComponent(conflictPr.slug)}&prNumber=${conflictPr.number}`)
        .then(r => r.json())
        .then(d => {
          setConflictAttempt(d.attempt || null);
          if (d.attempt && d.attempt.status === 'done') {
            // Refresh a detecção — conflitos devem ter sumido.
            fetch(`/ops/api/codereview/conflicts?slug=${encodeURIComponent(conflictPr.slug)}&prNumber=${conflictPr.number}`)
              .then(r => r.json()).then(setConflictData).catch(() => {});
          }
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [conflictPr, conflictAttempt]);

  const mergeReport = React.useCallback((slug, prNumber) => {
    if (!prNumber || merging) return;
    setMerging(true);
    setRunError('');
    setPromotionInfo(null);
    fetch('/ops/api/codereview/merge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, prNumber, mergeMethod: 'squash' }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok || data.error) setRunError(data.error || `HTTP ${r.status}`);
        if (data.promotion && data.promotion.prUrl) setPromotionInfo(data.promotion);
        return loadAttacks();
      })
      .catch(err => setRunError(String(err)))
      .finally(() => setMerging(false));
  }, [merging, loadAttacks]);

  const runNow = () => {
    setRunning(true);
    setRunError('');
    setReviewStep('iniciando…');
    const targetSlug = projectFilter || null;
    const body = JSON.stringify({ ...(projectFilter ? { slug: projectFilter } : {}), ...(modelSel ? { model: modelSel } : {}) });
    fetch('/ops/api/codereview/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      .then(res => res.json())
      .then((r) => {
        if (r && r.ok === false) setRunError(r.error || 'falha desconhecida');
        else if (r && r.alreadyReviewed) setRunError('');
        return load();
      })
      .catch(err => { console.error('Failed to trigger code review', err); setRunError(String(err)); })
      .finally(() => { setRunning(false); setReviewStep(''); });

    if (targetSlug) {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      pollRef.current = setInterval(() => {
        fetch(`/ops/api/codereview/run-status?slug=${encodeURIComponent(targetSlug)}`)
          .then(r => r.json())
          .then(p => {
            if (p && p.status === 'running') setReviewStep(p.step || '');
            if (p && p.status !== 'running') { clearInterval(pollRef.current); pollRef.current = null; }
          })
          .catch(() => {});
      }, 1500);
      timeoutRef.current = setTimeout(() => { clearInterval(pollRef.current); pollRef.current = null; }, 5 * 60 * 1000);
    }
  };

  const attackNow = (report) => {
    if (!report || attacking) return;
    setAttacking(true);
    setRunError('');
    fetch('/ops/api/codereview/attack', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: report.project_slug, reportId: report.id,
        ...(attackModelSel ? { model: attackModelSel } : {}),
        ...(verifyModelSel ? { verifyModel: verifyModelSel } : {}),
      }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok || data.error) { setRunError(data.error || `HTTP ${r.status}`); setAttacking(false); }
        return loadAttacks();
      })
      .catch(err => { setRunError(String(err)); setAttacking(false); });
  };

  const createTask = (report, issue, key) => {
    setTaskState((s) => ({ ...s, [key]: 'creating' }));
    const title = `[${report.display_name || report.project_slug}] ${issue.file}${issue.line != null ? ':' + issue.line : ''} — ${issue.message.slice(0, 60)}`;
    fetch('/ops/api/brain/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        project: report.project_slug,
        commit: report.commit_sha || undefined,
        priority: issue.severity === 'critical' ? 'alta' : 'média',
        context: `Issue [${issue.severity}/${issue.category}] encontrada pelo Daemon-CodeReview no commit ${(report.commit_sha || '').slice(0, 7)}.\n\n${issue.file}${issue.line != null ? ':' + issue.line : ''}\n${issue.message}`,
        action: issue.suggestion || '(ver sugestão do review)',
        expected: 'Issue corrigida e commitada.',
      }),
    })
      .then(res => res.json())
      .then((r) => setTaskState((s) => ({ ...s, [key]: r.ok ? 'done' : 'error' })))
      .catch(() => setTaskState((s) => ({ ...s, [key]: 'error' })));
  };

  if (loading) {
    return React.createElement('div', { className: 'panel animate-fade-up', style: { padding: 40, textAlign: 'center', color: 'var(--muted)' } }, 'Carregando Code Review...');
  }

  const allReports = (crData && crData.reports) || [];
  const crProjects = (crData && crData.projects) || [];
  const projectOptions = crProjects.length
    ? crProjects.map(p => p.slug)
    : [...new Set(allReports.map(r => r.project_slug))];
  const reports = projectFilter ? allReports.filter(r => r.project_slug === projectFilter) : allReports;

  const renderModelPicker = () => showModelPickers && models.length > 0 && React.createElement('div', { className: 'cr-model-row' },
    [['review', modelSel, setModelSel, '◆', 'Review'], ['fix', attackModelSel, setAttackModelSel, '▲', 'Fix'], ['verify', verifyModelSel, setVerifyModelSel, '●', 'Verify']].map(function (field) {
      const role = field[0], val = field[1], setter = field[2], glyph = field[3], label = field[4];
      const recForRole = (recommended[role] || []).filter(function (m) { return models.includes(m); });
      const options = [React.createElement('option', { key: 'def', value: '' }, 'padrão')];
      if (recForRole.length > 0) {
        options.push(React.createElement('optgroup', { key: 'rec', label: 'Indicados' },
          recForRole.map(function (m) { return React.createElement('option', { key: 'rec-' + m, value: m }, m); })));
      }
      options.push(React.createElement('optgroup', { key: 'all', label: 'Todos' },
        models.map(function (m) { return React.createElement('option', { key: 'all-' + m, value: m }, m); })));
      return React.createElement('label', { key: role, className: 'cr-model-field' },
        React.createElement('span', { className: cls('cr-model-field__lbl', 'cr-model-field__lbl--' + role) }, glyph + ' ' + label),
        React.createElement('select', { className: 'cr-model-select', value: val, onChange: function (e) { setter(e.target.value); } }, options));
    }));

  if (reports.length === 0) {
    return React.createElement('div', { className: 'panel animate-fade-up stagger' },
      React.createElement('div', { className: 'cr-toolbar' },
        React.createElement('div', { className: 'chip-row' },
          React.createElement('button', { className: cls('fchip', !projectFilter && 'fchip--on'), onClick: () => { setProjectFilter(''); setSelected(0); } }, 'Todos'),
          projectOptions.map(p => React.createElement('button', {
            key: p, className: cls('fchip', projectFilter === p && 'fchip--on'),
            onClick: () => { setProjectFilter(p); setSelected(0); },
          }, p))),
        React.createElement('div', { className: 'cr-toolbar__run' },
          React.createElement('button', {
            className: cls('cb-btn cb-btn--ghost', showModelPickers && 'cb-btn--ghost-on'), onClick: () => setShowModelPickers(v => !v),
            title: 'Escolher modelo por função (review / fix / verify)',
          }, React.createElement(Icon, { name: 'settings', size: 13 }), ' Modelos'))),
      renderModelPicker(),
      React.createElement(Section, { icon: 'shield', title: 'Code Review — Minimax M3' },
        React.createElement('div', { style: { padding: '40px 0', textAlign: 'center' } },
          React.createElement('div', { className: 'muted', style: { marginBottom: 16 } }, 'Nenhum relatório de code review encontrado' + (projectFilter ? ` para ${projectFilter}` : '') + '.'),
          running && reviewStep && React.createElement('div', { className: 'muted', style: { marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 } },
            React.createElement('span', { className: 'cr-attack__dot' }), reviewStep),
          runError && !running && React.createElement('div', { className: 'cr-attack-result cr-attack-result--warn', style: { marginBottom: 16, textAlign: 'left' } },
            React.createElement('strong', null, 'Review falhou'), ' — ', runError),
          React.createElement('button', { className: 'cb-btn', onClick: runNow, disabled: running }, running ? 'Executando…' : projectFilter ? `Rodar review — ${projectFilter}` : 'Rodar review agora')))
    );
  }

  const latest = reports[Math.min(selected, Math.max(reports.length - 1, 0))] || reports[0];
  // Banner "Ciclo aprovado"/"PR #N" preso ao REPORT selecionado (report_id) — sem fallback pro
  // projeto inteiro. Ataques antigos (pré-coluna report_id) ficam com report_id null; um fallback
  // por projeto reincide no mesmo bug (PR antigo travado em report novo), só trocando qual PR
  // aparece. Sem attack ligado a ESTE report.id, não há banner — correto: report sem issues
  // (ex. 0 críticas/avisos) nunca foi atacado, não deveria mostrar ciclo de PR nenhum.
  const projAttacks = attacks.filter(a => a.report_id === latest.id);
  const issues = Array.isArray(latest.issues) ? latest.issues : [];
  const refactors = Array.isArray(latest.refactors) ? latest.refactors : [];

  const critical = issues.filter(i => i.severity === 'critical');
  const warnings = issues.filter(i => i.severity === 'warning');
  const info = issues.filter(i => i.severity === 'info');

  const score = latest.score != null ? Number(latest.score) : null;
  const scoreColor = score == null ? 'neutral' : (score < 5 ? 'critical' : (score < 8 ? 'warning' : 'good'));
  const when = latest.created_at ? new Date(latest.created_at).toLocaleString('pt-BR') : '';

  // Trend de score: reports do mesmo projeto do latest, do mais antigo pro mais recente.
  const trendReports = allReports.filter(r => r.project_slug === latest.project_slug).slice().reverse();
  const trendScores = trendReports.map(r => r.score != null ? Number(r.score) : 0);

  const sevSegs = [
    ['critical', critical.length, 'críticas'],
    ['warning', warnings.length, 'avisos'],
    ['info', info.length, 'infos'],
  ];
  const sevTotal = issues.length || 1;

  return React.createElement('div', { className: 'panel animate-fade-up stagger' },
    React.createElement('div', { className: 'cr-toolbar' },
      React.createElement('div', { className: 'chip-row' },
        React.createElement('button', { className: cls('fchip', !projectFilter && 'fchip--on'), onClick: () => { setProjectFilter(''); setSelected(0); } }, 'Todos'),
        projectOptions.map(p => React.createElement('button', {
          key: p, className: cls('fchip', projectFilter === p && 'fchip--on'),
          onClick: () => { setProjectFilter(p); setSelected(0); },
        }, p))),
      React.createElement('div', { className: 'cr-toolbar__run' },
        React.createElement('button', { className: 'cb-btn', onClick: runNow, disabled: running },
          running ? 'Executando…' : projectFilter ? `Rodar review — ${projectFilter}` : 'Rodar review agora'),
        React.createElement('button', {
          className: 'cb-btn cb-btn--attack', onClick: () => attackNow(latest),
          disabled: attacking || !latest || issues.length === 0 || attacks.some(a => a.status === 'running' && a.project_slug === latest.project_slug),
          title: 'Ciclo: Daemon-FixAgent corrige as issues e abre PR; Daemon-Verifier audita o PR e aprova ou devolve o que falta — repete até consenso ou limite de rodadas.',
        }, attacking ? 'Atacando…' : 'Atacar PR'),
        React.createElement('button', {
          className: cls('cb-btn cb-btn--ghost', showModelPickers && 'cb-btn--ghost-on'), onClick: () => setShowModelPickers(v => !v),
          title: 'Escolher modelo por função (review / fix / verify)',
        }, React.createElement(Icon, { name: 'settings', size: 13 }), ' Modelos'))),
      renderModelPicker(),
    running && reviewStep && React.createElement('div', { className: 'muted', style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: -4, marginBottom: 8 } },
      React.createElement('span', { className: 'cr-attack__dot' }), reviewStep),
    runError && React.createElement('div', { className: 'alert cr-run-error' },
      React.createElement(Icon, { name: 'alert', size: 14 }), ' ', runError),
    projAttacks.length > 0 && (projAttacks[0].status === 'running' || attacking) && React.createElement(Card, { className: 'cr-attack' },
      React.createElement('div', { className: 'cr-attack__head' },
        React.createElement('span', { className: 'cr-attack__title' },
          React.createElement(Icon, { name: 'zap', size: 14 }),
          ' Rodada ', projAttacks[0].round || 1, ' — ', projAttacks[0].project_slug,
          projAttacks[0].pr_number && React.createElement('span', { className: 'muted' }, ' · PR #' + projAttacks[0].pr_number)),
        React.createElement('span', { className: 'mono' }, (projAttacks[0].issues_fixed || 0) + '/' + (projAttacks[0].issues_total || 0) + ' corrigidas')),
      React.createElement('div', { className: 'cr-attack__step mono' },
        React.createElement('span', { className: 'cr-attack__dot' }), ' ', projAttacks[0].current_step || 'iniciando…'),
      React.createElement('div', { className: 'cr-attack__bar' },
        React.createElement('span', { style: { width: Math.round(100 * (projAttacks[0].issues_fixed || 0) / Math.max(projAttacks[0].issues_total || 1, 1)) + '%' } })),
      Array.isArray(projAttacks[0].log) && projAttacks[0].log.slice(-3).map((l, i) =>
        React.createElement('div', { key: i, className: 'cr-attack__log mono' },
          `[${l.status}] ${l.file}${l.line != null ? ':' + l.line : ''} — ${l.detail}`))),
    projAttacks.length > 0 && projAttacks[0].status !== 'running' && !attacking && (() => {
      const a = projAttacks[0];
      const converged = a.verify_status === 'approved';
      const needsHuman = a.verify_status === 'needs_human';
      const tone = a.status !== 'done' ? 'fail' : converged ? 'ok' : needsHuman ? 'warn' : 'fail';
      const projLabel = (crProjects.find(p => p.slug === a.project_slug) || {}).display_name || a.project_slug;
      // current_step carrega o texto definido pelo merge endpoint/fix-agent/verify-agent quando
      // o PR já foi mergeado (manual ou automaticamente) — usa isso pra travar o botão de vez.
      const isMerged = /mergead/i.test(a.current_step || '');
      return React.createElement('div', { className: cls('alert cr-attack-result', 'cr-attack-result--' + tone) },
        React.createElement(Icon, { name: converged ? 'check' : needsHuman ? 'alert' : 'alert', size: 14 }),
        projLabel && React.createElement('span', { className: 'cr-attack-result__proj mono' }, projLabel),
        ' ', converged ? `Ciclo aprovado pelo Daemon-Verifier (rodada ${a.round || 1})` : needsHuman ? `Precisa de revisão humana (rodada ${a.round || 1})` : `Ataque falhou`,
        ' — ', a.issues_fixed, '/', a.issues_total, ' corrigidas',
        a.pr_url && React.createElement('a', { href: a.pr_url, target: '_blank', rel: 'noreferrer', style: { marginLeft: 8 } }, 'ver PR #' + a.pr_number),
        converged && a.pr_number && React.createElement('button', {
          className: 'cb-btn cb-btn--merge', style: { marginLeft: 10 }, disabled: merging || isMerged,
          onClick: () => mergeReport(a.project_slug, a.pr_number),
        }, isMerged ? 'Mergeado ✓' : merging ? 'Mergeando…' : 'Aprovar e Mergear'),
        a.verify_notes && React.createElement('div', { className: 'cr-attack-result__notes' }, a.verify_notes),
        a.error && React.createElement('span', { className: 'muted', style: { marginLeft: 8 } }, a.error),
        runError && React.createElement('div', { className: 'cr-attack-result__notes', style: { color: 'var(--critical)' } }, runError),
        promotionInfo && promotionInfo.prUrl && React.createElement('div', { className: 'cr-attack-result__notes', style: { color: 'var(--good)' } },
          promotionInfo.alreadyExisted ? 'PR de promoção já existia — ' : 'PR de promoção aberto — ',
          React.createElement('a', { href: promotionInfo.prUrl, target: '_blank', rel: 'noreferrer' }, 'aprove o merge final aqui')));
    })(),

    React.createElement('div', { className: 'cr-hero' },
      React.createElement(Card, { className: 'cr-score' },
        React.createElement(ScoreRing, { score, tone: scoreColor }),
        React.createElement('div', { className: 'cr-score__meta' },
          React.createElement('div', { className: 'cr-score__proj' }, latest.display_name || latest.project_slug),
          React.createElement('div', { className: 'cr-score__sub mono' },
            ((latest.commit_sha || '').slice(0, 7) || '—') + ' · ' + (latest.model_used || 'modelo n/d')),
          React.createElement('div', { className: 'cr-score__sub mono' }, when),
          trendScores.length > 1 && React.createElement('div', { className: 'cr-score__trend' },
            React.createElement(Sparkline, { data: trendScores, color: 'var(--' + scoreColor + ')' }),
            React.createElement('span', { className: 'sub-note mono' }, trendScores.length + ' reviews')))),
      React.createElement(Card, { className: 'cr-sev' },
        React.createElement('div', { className: 'cr-sev__head' },
          React.createElement('span', { className: 'cr-sev__title' }, 'Issues por severidade'),
          React.createElement('span', { className: 'cr-sev__total mono' }, issues.length)),
        React.createElement('div', { className: 'cr-sev__bar' },
          sevSegs.map(([t, n], i) => n > 0 && React.createElement('span', {
            key: i, className: 'tone-bg-' + (t === 'info' ? 'good' : t), style: { width: (n / sevTotal * 100) + '%', background: t === 'info' ? 'var(--info)' : undefined },
          }))),
        React.createElement('div', { className: 'cr-sev__rows' },
          sevSegs.map(([t, n, lbl], i) => React.createElement('div', { key: i, className: 'cr-sev__row' },
            React.createElement(StatusBadge, { status: t }, lbl),
            React.createElement('span', { className: 'mono cr-sev__n' }, n))),
          refactors.length > 0 && React.createElement('div', { className: 'cr-sev__row' },
            React.createElement(StatusBadge, { status: 'info' }, 'refactors'),
            React.createElement('span', { className: 'mono cr-sev__n' }, refactors.length))))),

    prs && ((prs.open || []).length > 0 || (prs.merged || []).length > 0) && React.createElement(Card, { className: 'cr-prs' },
      React.createElement('div', { className: 'cr-prs__head' },
        React.createElement(Icon, { name: 'split', size: 14 }),
        React.createElement('span', { className: 'cr-prs__title' }, 'Pull Requests — ' + (latest.display_name || latest.project_slug))),
      (prs.open || []).length > 0 && React.createElement('div', { className: 'cr-prs__group' },
        React.createElement('div', { className: 'cr-prs__lbl' }, 'Abertos'),
        prs.open.map(p => React.createElement('div', { key: 'o' + p.number, className: 'cr-prs__row' },
          React.createElement(StatusBadge, { status: p.draft ? 'info' : 'warning' }, p.draft ? 'draft' : 'aberto'),
          p.conflicted && React.createElement(StatusBadge, { status: 'critical' }, 'conflitos'),
          React.createElement('a', { href: p.url, target: '_blank', rel: 'noreferrer', className: 'cr-prs__link' }, '#' + p.number + ' ' + p.title),
          React.createElement('span', { className: 'mono muted cr-prs__meta' }, p.head + ' → ' + p.base),
          p.conflicted && React.createElement('button', {
            className: 'cb-btn cb-btn--sm', style: { marginLeft: 8 },
            onClick: () => openConflict(shownSlug, p.number),
          }, 'Ver conflitos')))),
      (prs.merged || []).length > 0 && React.createElement('div', { className: 'cr-prs__group' },
        React.createElement('div', { className: 'cr-prs__lbl' }, 'Últimos mergeados'),
        prs.merged.map(p => React.createElement('div', { key: 'm' + p.number, className: 'cr-prs__row' },
          React.createElement(StatusBadge, { status: 'good' }, 'mergeado'),
          React.createElement('a', { href: p.url, target: '_blank', rel: 'noreferrer', className: 'cr-prs__link' }, '#' + p.number + ' ' + p.title),
          React.createElement('span', { className: 'mono muted cr-prs__meta' },
            new Date(p.mergedAt).toLocaleDateString('pt-BR')))))),

    React.createElement('div', { className: 'grid-side' },
      React.createElement('div', { className: 'col' },
        React.createElement(Section, { icon: 'alert', title: 'Issues críticas', count: critical.length, accent: 'var(--critical)' },
          critical.length === 0
            ? React.createElement('div', { className: 'muted', style: { padding: 12 } }, 'Nenhuma issue crítica.')
            : React.createElement(IssueList, { issues: critical, tone: 'critical', report: latest, taskState, onCreateTask: createTask })
        ),
        React.createElement(Section, { icon: 'alert', title: 'Avisos', count: warnings.length, accent: 'var(--warning)' },
          warnings.length === 0
            ? React.createElement('div', { className: 'muted', style: { padding: 12 } }, 'Nenhum aviso.')
            : React.createElement(IssueList, { issues: warnings, tone: 'warning', report: latest, taskState, onCreateTask: createTask })
        ),
        info.length > 0 && React.createElement(Section, { icon: 'fileText', title: 'Informativos', count: info.length },
          React.createElement(IssueList, { issues: info, tone: 'neutral', report: latest, taskState, onCreateTask: createTask })
        ),
        refactors.length > 0 && React.createElement(Section, { icon: 'zap', title: 'Refatorações sugeridas', count: refactors.length },
          React.createElement('div', { className: 'alerts', style: { gap: 8 } },
            refactors.map((r, i) => React.createElement('div', { key: i, className: 'alert', style: { alignItems: 'flex-start' } },
              React.createElement('div', { className: 'alert__body', style: { flex: 1 } },
                React.createElement('div', { className: 'alert__msg mono', style: { fontWeight: 600, marginBottom: 4 } }, r.file),
                React.createElement('div', { className: 'alert__meta', style: { lineHeight: 1.4 } }, r.description))))
          )
        )
      ),
      React.createElement('div', { className: 'col sticky-col' },
        React.createElement(Section, { icon: 'fileText', title: 'Resumo da revisão' },
          React.createElement('div', { style: { padding: 16, fontSize: 'var(--text-base)', lineHeight: 1.65, color: 'var(--foreground)' } },
            latest.summary || 'Sem resumo disponível.',
            latest.pr_url && React.createElement('div', { style: { marginTop: 10 } },
              React.createElement('a', { href: latest.pr_url, target: '_blank', rel: 'noreferrer', className: 'mono', style: { color: 'var(--primary)' } }, 'Ver PR no GitHub'))
          )
        ),
        React.createElement(Section, { icon: 'clock', title: 'Histórico', count: reports.length },
          React.createElement('div', { className: 'cr-hist' },
            reports.map((r, i) => {
              const sc = r.score != null ? Number(r.score) : null;
              const t = sc == null ? 'neutral' : sc < 5 ? 'critical' : sc < 8 ? 'warning' : 'good';
              const prNum = r.pr_number || (r.pr_url ? (String(r.pr_url).match(/\/pull\/(\d+)/) || [])[1] : null);
              const rowIssues = Array.isArray(r.issues) ? r.issues : [];
              const attackBusy = attacks.some(a => a.status === 'running' && a.project_slug === r.project_slug);
              return React.createElement('div', {
                key: r.id || i,
                className: cls('cr-hist__row', i === selected && 'cr-hist__row--on'),
              },
                React.createElement('button', {
                  className: 'cr-hist__rowbtn', onClick: () => setSelected(i), title: 'Ver detalhe deste report',
                },
                  React.createElement('span', { className: cls('cr-hist__score mono', 'tone-' + t) }, sc == null ? '—' : sc.toFixed(1)),
                  React.createElement('span', { className: 'cr-hist__meta' },
                    React.createElement('span', { className: 'cr-hist__proj' },
                      r.display_name || r.project_slug,
                      prNum && React.createElement('span', { className: 'cr-hist__pr mono' }, ' PR #' + prNum)),
                    React.createElement('span', { className: 'cr-hist__sub mono' },
                      (r.commit_sha || '').slice(0, 7) + ' · ' + (r.created_at ? ago(r.created_at) + ' atrás' : ''))),
                  React.createElement('span', { className: 'cr-hist__n mono' }, rowIssues.length + ' issues')),
                React.createElement('div', { className: 'cr-hist__actions' },
                  r.pr_url && React.createElement('a', {
                    href: r.pr_url, target: '_blank', rel: 'noreferrer', className: 'cb-btn cb-btn--sm cb-btn--ghost', title: 'Ver PR no GitHub',
                    onClick: (e) => e.stopPropagation(),
                  }, React.createElement(Icon, { name: 'arrowRight', size: 12 })),
                  React.createElement('button', {
                    className: 'cb-btn cb-btn--sm cb-btn--attack',
                    disabled: attacking || attackBusy || rowIssues.length === 0,
                    title: 'Atacar este PR específico (sem precisar selecioná-lo antes)',
                    onClick: (e) => { e.stopPropagation(); setSelected(i); attackNow(r); },
                  }, attackBusy ? '…' : 'Atacar')));
            })
          )
        )
      )
    ),

    conflictPr && React.createElement('div', { className: 'drawer-ov open', style: { zIndex: 100 }, onClick: () => setConflictPr(null) }),
    conflictPr && React.createElement('div', { className: 'drawer open', style: { zIndex: 101, padding: '24px', width: '100%', maxWidth: '640px', overflowY: 'auto' } },
      React.createElement('h3', { style: { marginTop: 0 } }, 'Conflitos — PR #' + conflictPr.number),
      conflictLoading && React.createElement('div', { className: 'muted' }, 'Verificando…'),
      conflictData && !conflictData.ok && React.createElement('div', { style: { color: 'var(--critical)' } }, conflictData.error),
      conflictData && conflictData.ok && !conflictData.hasConflicts && React.createElement('div', { style: { color: 'var(--good)' } }, 'Sem conflitos — PR pode ser mergeado normalmente.'),
      conflictData && conflictData.ok && conflictData.hasConflicts && React.createElement('div', null,
        React.createElement('div', { style: { fontSize: '13px', marginBottom: '12px' } },
          conflictData.headBranch + ' → ' + conflictData.baseBranch + ' — ' + (conflictData.files || []).length + ' arquivo(s) em conflito'),
        (conflictData.files || []).map(f => React.createElement('div', { key: f.path, style: { marginBottom: '16px' } },
          React.createElement('div', { className: 'mono', style: { fontSize: '12px', fontWeight: 600, marginBottom: '4px' } }, f.path),
          React.createElement('pre', { className: 'mono', style: { fontSize: '10px', maxHeight: '220px', overflow: 'auto', background: 'var(--panel-2, rgba(0,0,0,0.2))', borderRadius: '8px', padding: '10px', whiteSpace: 'pre-wrap' } }, f.markers))),
        conflictAttempt && React.createElement('div', { style: { marginTop: '12px', marginBottom: '12px' } },
          React.createElement(StatusBadge, { status: conflictAttempt.status === 'done' ? 'good' : conflictAttempt.status === 'failed' ? 'critical' : 'info' }, conflictAttempt.status),
          React.createElement('span', { style: { marginLeft: 8, fontSize: '12px' } }, conflictAttempt.current_step),
          conflictAttempt.error && React.createElement('div', { style: { color: 'var(--critical)', fontSize: '12px', marginTop: '4px' } }, conflictAttempt.error)),
        React.createElement(Button, {
          size: 'sm', disabled: conflictAttempt && conflictAttempt.status === 'running',
          onClick: resolveConflict,
        }, conflictAttempt && conflictAttempt.status === 'running' ? 'Resolvendo…' : 'Corrigir conflitos automaticamente')),
      React.createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } },
        React.createElement(Button, { size: 'sm', variant: 'outline', onClick: () => setConflictPr(null) }, 'Fechar'))
    )
  );
}

function IssueList({ issues, tone, report, taskState, onCreateTask }) {
  return React.createElement('div', { className: 'alerts', style: { gap: 8 } },
    issues.map((it, i) => {
      const key = (report?.id || '0') + ':' + i + ':' + it.file;
      const state = taskState?.[key];
      return React.createElement('div', { key: i, className: cls('alert cr-issue', 'cr-issue--' + tone), style: { alignItems: 'flex-start' } },
        React.createElement('span', { className: 'alert__icon tone-' + tone, style: { marginTop: 2 } }, React.createElement(Icon, { name: tone === 'critical' ? 'xCircle' : 'alert', size: 14 })),
        React.createElement('div', { className: 'alert__body', style: { flex: 1 } },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 } },
            React.createElement('div', { className: 'alert__msg mono', style: { fontWeight: 600, marginBottom: 4 } },
              it.file + (it.line != null ? ':' + it.line : '') + (it.category ? '  [' + it.category + ']' : '')),
            onCreateTask && React.createElement('button', {
              className: 'cb-btn cb-btn--sm', disabled: state === 'creating' || state === 'done',
              onClick: () => onCreateTask(report, it, key),
              style: { flexShrink: 0, fontSize: '0.7rem', padding: '3px 8px' },
            }, state === 'done' ? 'Task criada ✓' : state === 'creating' ? '…' : state === 'error' ? 'Erro — tentar de novo' : 'Criar task')),
          React.createElement('div', { className: 'alert__meta', style: { marginBottom: 6, lineHeight: 1.4 } }, it.message),
          it.suggestion && React.createElement('div', { className: 'alert__meta mono', style: { color: 'var(--foreground)', background: 'var(--sidebar)', padding: '4px 8px', borderRadius: 4, whiteSpace: 'pre-wrap' } },
            React.createElement('b', { style: { color: 'var(--' + (tone === 'neutral' ? 'muted' : tone) + ')' } }, 'Sugestão: '), it.suggestion
          )
        )
      );
    })
  );
}

