/**
 * Outreach Architect — app.js
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ARCHITECTURE
 * ────────────
 * Six sealed IIFE modules in dependency order. Each exposes only what it
 * needs to expose. Nothing leaks to global scope except the module refs.
 *
 *   1. STATE     — single source of truth, explicit read/write API
 *   2. DOM       — element access, safeText, escHtml, md
 *   3. UI        — toast, momentum, elevator, loading stages, dark mode
 *   4. API       — all fetch calls, error normalisation
 *   5. RENDERERS — pure functions: data → HTML string, zero side effects
 *   6. FLOW      — step orchestration, gating, generation, refinement
 *
 * RENDERER CONTRACT
 * ─────────────────
 * Every renderer takes explicit arguments. Never reads STATE directly.
 * Always returns an HTML string. Never writes to the DOM.
 * Internal LLM labels (ROLE:, BULLET:, VERDICT:, SUMMARY:, etc.)
 * are ALWAYS stripped before anything reaches the user's screen.
 *
 * SCALING PATH
 * ────────────
 * Each module maps 1:1 to an ES module file when a build step is added.
 * Renderers are already shaped correctly for React/Preact components.
 * STATE maps directly to a Zustand atom or Redux slice.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   1. STATE
   ═══════════════════════════════════════════════════════════════════════════ */

const STATE = (() => {
  const _s = {
    cvText: '', cvMethod: 'paste',
    jdText: '', jdMethod: 'paste',
    jdImageB64: '', jdImageMediaType: '',
    formMethod: 'paste', formImageB64: '', formImageMediaType: '',
    selectedAssets: [],
    flowNeeds: { research:false, brief:false, step35:false, routing:false, form:false, step4:false, voice:false },
    selectedPainPoints: [],
    writingSample: '',
    brief: {},
    parsedCv: null,
    narrativeThread: '',
    applicationContext: { referral_name:'', company_stage:'', career_situation:'', cv_register:'', situation:'' },
    routingChoices: { opening:'', p3:'' },
    routingOptions: null,
    results: {}, evals: {},
    letterBrief: null,
    firstGenerate: true,
    contextVisible: false,
    refineParagraphFocus: '',
    ratings: {},
    bulletDiagnosisRaw: '',
  };

  const ASSET_REQUIREMENTS = {
    'Cover Letter':           { needsResearch:true,  needsBrief:true,  needsStep35:true,  needsRouting:true  },
    'Resume Bullets':         { needsResearch:false, needsBrief:false, needsStep35:true,  needsRouting:false },
    'Interview Prep':         { needsResearch:true,  needsBrief:true,  needsStep35:false, needsRouting:false },
    'Cold Outreach Email':    { needsResearch:true,  needsBrief:true,  needsStep35:false, needsRouting:false },
    'Answer Application Form':{ needsResearch:false, needsBrief:false, needsStep35:false, needsRouting:false, needsForm:true },
  };

  function get(key) { return _s[key]; }
  function set(key, value) { _s[key] = value; }

  /** Merge partial fields into brief — never replaces wholesale */
  function enrichBrief(partial) {
    if (partial && typeof partial === 'object') Object.assign(_s.brief, partial);
  }

  /**
   * Replace brief safely — falls back to current brief if incoming is empty.
   * Pattern: state.brief = data.brief || state.brief
   */
  function replaceBriefSafe(incoming) {
    if (incoming && typeof incoming === 'object' && Object.keys(incoming).length > 0) {
      _s.brief = incoming;
    }
  }

  /** Recompute flowNeeds from selectedAssets. Call whenever selectedAssets changes. */
  function computeFlowNeeds() {
    const needs = { research:false, brief:false, step35:false, routing:false, form:false, step4:false, voice:false };
    _s.selectedAssets.forEach(asset => {
      const req = ASSET_REQUIREMENTS[asset] || {};
      if (req.needsResearch) needs.research = true;
      if (req.needsBrief)    needs.brief    = true;
      if (req.needsStep35)   needs.step35   = true;
      if (req.needsRouting)  needs.routing  = true;
      if (req.needsForm)     needs.form     = true;
    });
    needs.voice = _s.selectedAssets.includes('Cover Letter') || _s.selectedAssets.includes('Cold Outreach Email');
    needs.step4 = needs.voice || needs.form;
    _s.flowNeeds = needs;
    return needs;
  }

  function reset() {
    Object.assign(_s, {
      cvText:'', cvMethod:'paste', jdText:'', jdMethod:'paste',
      jdImageB64:'', jdImageMediaType:'',
      formMethod:'paste', formImageB64:'', formImageMediaType:'',
      selectedAssets:[], selectedPainPoints:[], writingSample:'',
      brief:{}, parsedCv:null, narrativeThread:'',
      applicationContext:{ referral_name:'', company_stage:'', career_situation:'', cv_register:'', situation:'' },
      routingChoices:{ opening:'', p3:'' }, routingOptions:null,
      results:{}, evals:{}, letterBrief:null,
      firstGenerate:true, contextVisible:false, refineParagraphFocus:'',
      ratings:{}, bulletDiagnosisRaw:'',
      flowNeeds:{ research:false, brief:false, step35:false, routing:false, form:false, step4:false, voice:false },
    });
  }

  return { get, set, enrichBrief, replaceBriefSafe, computeFlowNeeds, reset };
})();


/* ═══════════════════════════════════════════════════════════════════════════
   2. DOM
   ═══════════════════════════════════════════════════════════════════════════ */

const DOM = (() => {
  const el      = id => document.getElementById(id);
  const show    = id => { const e = el(id); if (e) e.classList.remove('hidden'); };
  const hide    = id => { const e = el(id); if (e) e.classList.add('hidden'); };
  const val     = id => { const e = el(id); return e ? e.value.trim() : ''; };
  const setText = (id, t) => { const e = el(id); if (e) e.textContent = String(t ?? ''); };
  const setHtml = (id, h) => { const e = el(id); if (e) e.innerHTML = h; };

  /** Escape raw string for safe HTML inclusion */
  function escHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  /**
   * Convert raw string to safely-rendered inline HTML.
   * Use for ALL LLM output displayed as text. Never use raw innerHTML on LLM output.
   */
  function safeText(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  /**
   * Minimal markdown renderer.
   * Only use on text that is known to contain markdown (e.g. company briefing).
   * Never use on raw generation output — use safeText() for that.
   */
  function md(text) {
    if (!text) return '';
    let s = safeText(text);
    s = s
      .replace(/\*\*(.+?)\*\*/g,   '<strong>$1</strong>')
      .replace(/\*([^*]+?)\*/g,    '<em>$1</em>')
      .replace(/^### (.+)$/gm,     '<h3 style="font-size:13px;font-weight:600;color:var(--text);margin:14px 0 6px;">$1</h3>')
      .replace(/^## (.+)$/gm,      '<h2 style="font-size:15px;font-weight:500;color:var(--text);margin:16px 0 8px;">$1</h2>')
      .replace(/^- (.+)$/gm,       '<li style="margin-bottom:4px;color:var(--text2);">$1</li>')
      .replace(/^(\d+)\. (.+)$/gm, '<li style="margin-bottom:4px;color:var(--text);">$1. $2</li>')
      .replace(/(<li[^>]*>.*?<\/li>\n?)+/gs, '<ul style="padding-left:18px;margin:6px 0 10px;">$&</ul>')
      .replace(/\n\n+/g, '</p><p style="margin:0 0 10px;line-height:1.7;color:var(--text2);">')
      .replace(/\n/g, '<br>');
    return `<p style="margin:0 0 10px;line-height:1.7;color:var(--text2);">${s}</p>`;
  }

  return { el, show, hide, val, setText, setHtml, escHtml, safeText, md };
})();


/* ═══════════════════════════════════════════════════════════════════════════
   3. UI
   ═══════════════════════════════════════════════════════════════════════════ */

const UI = (() => {

  // ── Dark mode ──────────────────────────────────────────────────────────────
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.classList.add('dark');
    const b = DOM.el('dmBtn'); if (b) b.textContent = 'Light mode';
  }
  function toggleDark() {
    document.documentElement.classList.toggle('dark');
    const b = DOM.el('dmBtn');
    if (b) b.textContent = document.documentElement.classList.contains('dark') ? 'Light mode' : 'Dark mode';
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  let _toastTimer = null;
  function showToast(msg) {
    const e = DOM.el('toast');
    if (!e) return;
    e.textContent = msg;
    e.classList.remove('hidden');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => e.classList.add('hidden'), 3000);
  }

  // ── Momentum singleton ─────────────────────────────────────────────────────
  let _momentumTimer = null;
  function showMomentum(label, text, thread = '', autoDismiss = 4000) {
    const e = DOM.el('momentumSingleton');
    if (!e) return;
    if (_momentumTimer) { clearTimeout(_momentumTimer); _momentumTimer = null; }
    DOM.setText('momentumLabel', label);
    DOM.setText('momentumText',  text);
    const threadEl = DOM.el('momentumThread');
    if (threadEl) {
      threadEl.textContent = thread || '';
      threadEl.classList.toggle('hidden', !thread);
    }
    e.classList.remove('visible');
    requestAnimationFrame(() => requestAnimationFrame(() => e.classList.add('visible')));
    if (autoDismiss > 0) _momentumTimer = setTimeout(() => e.classList.remove('visible'), autoDismiss);
  }

  // ── Loading stages ─────────────────────────────────────────────────────────
  function runStages(stages, stageElId, substageElId, dotPrefix, intervalMs = 5000) {
    let i = 0;
    _updateStage(stages, i, stageElId, substageElId, dotPrefix);
    const t = setInterval(() => {
      i++;
      if (i >= stages.length) { clearInterval(t); return; }
      _updateStage(stages, i, stageElId, substageElId, dotPrefix);
    }, intervalMs);
    return t;
  }
  function _updateStage(stages, i, stageElId, substageElId, dotPrefix) {
    DOM.setText(stageElId,    stages[i].stage);
    DOM.setText(substageElId, stages[i].sub || '');
    for (let d = 0; d < 4; d++) {
      const dot = DOM.el(`${dotPrefix}${d}`);
      if (dot) dot.className = 'stage-dot ' + (d < i ? 'done' : d === i ? 'active' : '');
    }
  }

  const RESEARCH_STAGES = [
    { stage: 'Reading the job description…',        sub: '' },
    { stage: 'Identifying the company…',            sub: '' },
    { stage: 'Pulling company intelligence…',       sub: 'Researching recent news and strategic context' },
    { stage: 'Decoding what they actually need…',   sub: 'Finding the 5 real challenges this role exists to solve' },
  ];
  const BRIEF_STAGES = [
    { stage: 'Reading your CV against this role…',  sub: '' },
    { stage: 'Extracting your strongest signals…',  sub: 'Achievements, undersold qualities, career narrative' },
    { stage: 'Finding the strategic intersection…', sub: 'Where your background meets their specific problem' },
    { stage: 'Writing the argument…',               sub: 'The narrative thread that runs through every asset' },
  ];

  /** Generate personalised stage messages using candidate name and company */
  const generateStages = assets => {
    const name    = STATE.get('brief')?.candidate_name || '';
    const company = STATE.get('brief')?.company || '';
    const firstName = name ? name.split(' ')[0] : '';
    return [
      { stage: 'Starting with the brief you approved…', sub: '' },
      { stage: assets[0] ? `Building ${assets[0]}…`    : 'Building your assets…', sub: firstName && company ? `Specific to ${firstName}'s case at ${company}` : 'Specific to this company and this argument' },
      { stage: assets[1] ? `Building ${assets[1]}…`    : 'Evaluating specificity…', sub: company ? `Traceable to the argument ${company} most needs to hear` : '' },
      { stage: 'Scoring for specificity and alignment…', sub: 'Almost ready' },
    ];
  };

  // ── Elevator navigation ────────────────────────────────────────────────────
  const STEP_ORDER = [1, 2, 3, 3.5, 4, 5];
  const STEP_CONSEQUENCES = {
    1:   'Going back to Step 1 will reset everything — all research and brief will need to be rebuilt.',
    2:   'Changing this will restart the process from Step 3 — the brief will be rebuilt.',
    3:   'Changing your brief approval will restart from Step 3.5.',
    3.5: 'Changing your bullet answers will update the brief before generation.',
  };

  function _currentStepIdx() {
    for (let i = STEP_ORDER.length - 1; i >= 0; i--) {
      const e = DOM.el('srail' + String(STEP_ORDER[i]).replace('.', ''));
      if (e && (e.classList.contains('active') || e.classList.contains('done'))) return i;
    }
    return 0;
  }

  function updateElevatorButtons() {
    const elevator = DOM.el('elevatorNav');
    if (!elevator) return;
    const idx = _currentStepIdx();
    let hasUp = false, hasDown = false;
    for (let i = 0; i < idx; i++) {
      const e = DOM.el('srail' + String(STEP_ORDER[i]).replace('.', ''));
      if (e && e.classList.contains('done')) { hasUp = true; break; }
    }
    for (let i = idx + 1; i < STEP_ORDER.length; i++) {
      const e = DOM.el('srail' + String(STEP_ORDER[i]).replace('.', ''));
      if (e && e.classList.contains('done')) { hasDown = true; break; }
    }
    const upBtn = DOM.el('elevatorUp'), downBtn = DOM.el('elevatorDown');
    if (upBtn)   upBtn.disabled   = !hasUp;
    if (downBtn) downBtn.disabled = !hasDown;
    elevator.classList.toggle('hidden', idx < 1);
  }

  function elevatorUp() {
    const idx = _currentStepIdx();
    if (idx <= 0) return;
    let targetIdx = idx - 1;
    while (targetIdx >= 0) {
      const e = DOM.el('srail' + String(STEP_ORDER[targetIdx]).replace('.', ''));
      if (e && e.classList.contains('done')) break;
      targetIdx--;
    }
    if (targetIdx < 0) return;
    const targetStep = STEP_ORDER[targetIdx];
    const consequence = STEP_CONSEQUENCES[targetStep];
    if (consequence && !confirm(consequence + '\n\nContinue?')) return;
    FLOW.sidebarStepClick(targetStep);
    updateElevatorButtons();
  }

  function elevatorDown() {
    const idx = _currentStepIdx();
    if (idx >= STEP_ORDER.length - 1) return;
    let targetIdx = idx + 1;
    while (targetIdx < STEP_ORDER.length) {
      const e = DOM.el('srail' + String(STEP_ORDER[targetIdx]).replace('.', ''));
      if (e && e.classList.contains('done')) break;
      targetIdx++;
    }
    if (targetIdx >= STEP_ORDER.length) return;
    FLOW.sidebarStepClick(STEP_ORDER[targetIdx]);
    updateElevatorButtons();
  }

  // ── Sidebar one-time tooltip ───────────────────────────────────────────────
  let _tooltipShown = false;
  function showSidebarTooltip() {
    if (_tooltipShown) return;
    _tooltipShown = true;
    const t = DOM.el('sidebarTooltip');
    if (!t) return;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 5000);
  }

  /**
   * Set a button into loading state — visual feedback that the click registered.
   * Returns a restore function — call it when the operation completes.
   * @param {HTMLElement|string} btnOrId
   * @param {string} [loadingText='Working…']
   * @returns {Function} restore
   */
  function setButtonLoading(btnOrId, loadingText = 'Working…') {
    const btn = typeof btnOrId === 'string' ? DOM.el(btnOrId) : btnOrId;
    if (!btn) return () => {};
    const original = btn.textContent;
    const wasDisabled = btn.disabled;
    btn.disabled = true;
    btn.textContent = loadingText;
    btn.classList.add('btn-loading');
    return () => {
      btn.disabled = wasDisabled;
      btn.textContent = original;
      btn.classList.remove('btn-loading');
    };
  }
  function showATSExtractionNote(wordCount) {
    const e = DOM.el('cvExtractionNote');
    if (!e) return;
    e.textContent = `This is your CV as an ATS reads it — plain text, no formatting. ${wordCount} words extracted. What you see here is what most application systems actually process. If it looks broken, your formatting may be working against you.`;
    e.classList.remove('hidden');
  }

  // Sidebar hover — done steps signal they're clickable
  document.querySelectorAll('.sidebar-step').forEach(e => {
    e.addEventListener('mouseenter', () => { if (e.classList.contains('done')) e.classList.add('hovering'); });
    e.addEventListener('mouseleave', () => e.classList.remove('hovering'));
  });

  return {
    toggleDark, showToast, showMomentum,
    runStages, RESEARCH_STAGES, BRIEF_STAGES, generateStages,
    updateElevatorButtons, elevatorUp, elevatorDown,
    showSidebarTooltip, showATSExtractionNote,
  };
})();


/* ═══════════════════════════════════════════════════════════════════════════
   4. API
   All fetch calls. Normalised errors. No business logic.
   Named exceptions from safeFetch():
     /api/extract-text  — soft errors {error:...}, not HTTP errors
     /api/download/pdf  — returns blob, not JSON
   ═══════════════════════════════════════════════════════════════════════════ */

const API = (() => {
  async function safeFetch(url, options) {
    const res = await fetch(url, options);
    let data;
    try { data = await res.json(); }
    catch (e) {
      const err = new Error(`Server error ${res.status} — could not parse response`);
      err.status = res.status; throw err;
    }
    if (!res.ok) {
      const err = new Error(data?.detail || `Server error ${res.status}`);
      err.status = res.status; err.detail = data?.detail; throw err;
    }
    return data;
  }

  const post = (url, body) => safeFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  function userMessage(e) {
    const isRate = e.message?.includes('429') || e.message?.includes('rate') ||
                   e.message?.includes('busy') || e.status === 429;
    return isRate ? 'The service is busy — wait 30 seconds and try again.' : (e.message || 'Something went wrong. Try again.');
  }

  const parseCv        = cv                      => post('/api/parse-cv',         { cv_text: cv, jd_text: '' });
  const runResearch    = (cv, jd, company)       => post('/api/research',          { cv_text: cv, jd_text: jd, manual_company: company });
  const buildBrief     = (brief, answers)        => post('/api/build-brief',       { brief, answers });
  const diagnoseBullets= brief                   => post('/api/diagnose-bullets',  { brief, bullet_context: '' });
  const getRouting     = brief                   => post('/api/routing',           { brief });
  const generate       = payload                 => post('/api/generate',          payload);
  const answerForm     = payload                 => post('/api/answer-form',       payload);
  const refine         = payload                 => post('/api/refine',            payload);
  const rethinkOpening = payload                 => post('/api/rethink-opening',   payload);
  const submitRating   = payload                 => post('/api/submit-rating',     payload);

  async function extractText(filename, contentB64) {
    const res = await fetch('/api/extract-text', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content_b64: contentB64 }),
    });
    return res.json();
  }
  async function extractJdImage(contentB64, mediaType) {
    const res = await fetch('/api/extract-jd-image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_b64: contentB64, media_type: mediaType }),
    });
    return res.json();
  }
  async function downloadPdf(text, candidateName, company) {
    return fetch('/api/download/pdf', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, candidate_name: candidateName, company, asset_type: 'cover_letter' }),
    });
  }

  return {
    userMessage, parseCv, runResearch, buildBrief, diagnoseBullets,
    getRouting, generate, answerForm, refine, rethinkOpening,
    submitRating, extractText, extractJdImage, downloadPdf,
  };
})();


/* ═══════════════════════════════════════════════════════════════════════════
   5. RENDERERS
   Pure functions: data in → HTML string out.
   ZERO side effects. ZERO DOM writes. ZERO STATE reads.
   Internal LLM labels NEVER reach the user's screen.
   ═══════════════════════════════════════════════════════════════════════════ */

const RENDERERS = (() => {
  const { safeText, escHtml, md } = DOM;

  // ── Eval block ─────────────────────────────────────────────────────────────
  function evalBlock(evalData) {
    if (!evalData || (!evalData.specificity_score && !evalData.alignment_score)) return '';
    const pill = (label, score) => {
      if (!score) return '';
      const cls = score >= 7 ? 'good' : score >= 5 ? 'mid' : 'low';
      return `<span class="eval-pill ${cls}">${label} ${score}/10</span>`;
    };
    const spacer = (evalData.specificity_score && evalData.alignment_score)
      ? '<span style="display:inline-block;width:6px;"></span>' : '';
    const suggestion = evalData.suggested_refinement &&
                       !['NONE NEEDED','NONE'].includes(evalData.suggested_refinement)
      ? `<p class="eval-suggestion">↳ ${escHtml(evalData.suggested_refinement)}</p>` : '';
    return `<div class="eval-block">
      <div class="eval-scores">${pill('Specificity',evalData.specificity_score)}${spacer}${pill('Alignment',evalData.alignment_score)}</div>
      ${suggestion}</div>`;
  }

  // ── Cover letter ───────────────────────────────────────────────────────────
  function coverLetter(text, evalData, tabId) {
    if (!text) return '';
    const words = text.split(/\s+/).length;
    const wc    = words < 180 ? `${words} words · below target` : words > 280 ? `${words} words · above target` : `${words} words`;
    const wcColor = (words >= 180 && words <= 280) ? 'var(--ok)' : 'var(--warn)';
    const LABELS = [
      { label:'P1', note:'Evidence — earns the read' },
      { label:'P2', note:'Proof — one specific moment' },
      { label:'P3', note:'Connection — your direction outward' },
      { label:'P4', note:'Close — assumes the conversation' },
    ];
    const paras = text.split(/\n\n+/).filter(p => p.trim()).map((p, i) => {
      const d = document.createElement('div'); d.textContent = p.trim();
      const lbl = LABELS[i];
      const lblHtml = lbl ? `<div class="para-label-row">
        <button class="para-label-btn" data-para="${lbl.label}"
          onclick="FLOW.setRefineFocus('${lbl.label}','${tabId}')">${lbl.label}</button>
        <span class="para-label-note">${lbl.note}</span></div>` : '';
      return `<div class="para-block">${lblHtml}<p class="para-text">${d.innerHTML}</p></div>`;
    }).join('');
    return `<div class="cl-header-row">
      <span class="cl-header-label">Cover Letter</span>
      <span class="cl-word-count" style="color:${wcColor};">${wc}</span>
    </div>${paras}${evalBlock(evalData)}`;
  }

  // ── Gap analysis ───────────────────────────────────────────────────────────
  /**
   * Returns { html, angle } — angle is surfaced separately by FLOW.
   */
  function gapAnalysis(text) {
    if (!text) return { html:'', angle:null };
    let angle = null;
    const angleM = text.match(/\*\*(?:Strategic )?Angle\*\*\s*([\s\S]*?)(?=\*\*|$)/);
    if (angleM) angle = angleM[1].replace(/\*\*[^*]+\*\*/, '').trim() || null;

    function parsePairs(raw) {
      if (!raw) return [];
      const pairs = []; let need = '';
      raw.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
        if (/^NEED:\s*/i.test(line)) { need = line.replace(/^NEED:\s*/i,'').replace(/\*\*([^*]+)\*\*/g,'$1').trim(); }
        else if (/^BRING:\s*/i.test(line) && need) {
          const bring = line.replace(/^BRING:\s*/i,'').replace(/\*\*([^*]+)\*\*/g,'$1').trim();
          if (bring) pairs.push({ need, bring }); need = '';
        }
      });
      return pairs;
    }
    function parseBulletList(raw) {
      return (raw || '').split('\n').map(l => l.replace(/^[-•*]\s*/,'').replace(/\*\*([^*]+)\*\*/g,'$1').trim()).filter(l => l.length > 5);
    }

    const matchesM  = text.match(/\*\*(?:Key )?Matches\*\*\s*([\s\S]*?)(?=\*\*(?:Gaps|Experience)|$)/);
    const gapsM     = text.match(/\*\*(?:Experience )?Gaps\*\*\s*([\s\S]*?)(?=\*\*|$)/);
    const evidenceM = text.match(/\*\*Evidence[^*]*\*\*\s*([\s\S]*?)(?=\*\*|$)/);
    const adviceM   = text.match(/\*\*(?:Application )?Advice\*\*\s*([\s\S]*?)(?=\*\*|$)/);

    const matchPairs   = parsePairs(matchesM?.[1] ?? '');
    const gapPairs     = parsePairs(gapsM?.[1]    ?? '');
    const matchBullets = matchPairs.length === 0 ? parseBulletList(matchesM?.[1] ?? '') : [];
    const gapBullets   = gapPairs.length   === 0 ? parseBulletList(gapsM?.[1]    ?? '') : [];
    const hasStructured= matchPairs.length > 0 || gapPairs.length > 0;
    const hasFallback  = matchBullets.length > 0 || gapBullets.length > 0;

    if (!hasStructured && !hasFallback) return { html:`<div class="gap-content">${md(text)}</div>`, angle };

    let rows = `<div class="fit-table-row fit-table-header">
      <div class="fit-col fit-col-need">What they need</div>
      <div class="fit-col fit-col-bring">What you bring</div></div>`;

    if (hasStructured) {
      matchPairs.forEach(p => {
        rows += `<div class="fit-table-row">
          <div class="fit-col fit-col-need">${escHtml(p.need)}</div>
          <div class="fit-col fit-col-bring"><span class="fit-signal fit-match"></span><span>${escHtml(p.bring)}</span></div></div>`;
      });
      gapPairs.forEach(p => {
        if (!p.bring || /^none$/i.test(p.bring)) return;
        const gapHandled = STATE.get('brief')?.gaps_to_address && !STATE.get('brief').gaps_to_address.toLowerCase().includes('none');
        rows += `<div class="fit-table-row">
          <div class="fit-col fit-col-need">${escHtml(p.need)}</div>
          <div class="fit-col fit-col-bring">
            <span class="fit-signal fit-gap"></span>
            <div><span class="fit-gap-text">${escHtml(p.bring)}</span>
            ${gapHandled ? '<br><span class="fit-gap-handled">↳ Addressed in your assets</span>' : ''}</div>
          </div></div>`;
      });
    } else {
      matchBullets.forEach(m => {
        rows += `<div class="fit-table-row">
          <div class="fit-col fit-col-need">${escHtml(m)}</div>
          <div class="fit-col fit-col-bring"><span class="fit-signal fit-match"></span><span>${escHtml(m)}</span></div></div>`;
      });
      gapBullets.forEach(g => {
        rows += `<div class="fit-table-row">
          <div class="fit-col fit-col-need">${escHtml(g)}</div>
          <div class="fit-col fit-col-bring"><span class="fit-signal fit-gap"></span><span class="fit-gap-text">${escHtml(g)}</span></div></div>`;
      });
    }

    let html = `<p class="fit-table-label">Fit analysis</p><div class="fit-table">${rows}</div>`;
    if (evidenceM) { const ev = evidenceM[1].replace(/\*\*[^*]+\*\*/g,'').trim(); if (ev) html += `<div class="fit-evidence">${md(ev)}</div>`; }
    if (adviceM)   { const av = adviceM[1].replace(/\*\*[^*]+\*\*/g,'').trim();   if (av) html += `<div class="fit-advice">${md(av)}</div>`; }
    return { html, angle };
  }

  // ── Bullet diagnosis cards ─────────────────────────────────────────────────
  /**
   * Strips ALL internal labels before rendering.
   * Users NEVER see ROLE:, BULLET:, RELEVANCE:, VERDICT:, SUMMARY:, QUESTIONS:.
   */
  function bulletDiagnosisCards(raw) {
    if (!raw) return '';

    // Strip internal meta labels — these are LLM scaffolding, not user content
    const INTERNAL_LABELS = /^(GAP_TYPE|VERDICT|SUMMARY)[^\n]*/gim;
    const cleaned = raw.replace(INTERNAL_LABELS, '').replace(/\n{3,}/g, '\n\n').trim();
    const blocks  = cleaned.split(/^---+$/m).map(b => b.trim()).filter(b => b.length > 10);

    let cardsHtml = '', cardCount = 0;

    blocks.forEach(block => {
      const roleM      = block.match(/^ROLE:\s*(.+?)(?=\n|$)/im);
      const bulletM    = block.match(/^BULLET:\s*([\s\S]+?)(?=^RELEVANCE:|^QUESTIONS:|$)/im);
      const relevanceM = block.match(/^RELEVANCE:\s*([\s\S]+?)(?=^QUESTIONS:|$)/im);
      const questionsM = block.match(/^QUESTIONS:\s*([\s\S]+?)$/im);

      const bulletText = bulletM ? bulletM[1].trim().replace(/\n/g,' ') : '';
      if (!bulletText || bulletText.length < 5) return;

      const role      = roleM      ? roleM[1].trim()      : '';
      const relevance = relevanceM ? relevanceM[1].trim() : '';
      const qRaw      = questionsM ? questionsM[1].trim() : '';

      // Read GAP_TYPE from original raw — determines placeholder and label
      const verdictSlice  = raw.indexOf(bulletText.slice(0, 30));
      const verdictSearch = verdictSlice >= 0 ? raw.slice(verdictSlice, verdictSlice + 600) : '';
      const verdictM      = verdictSearch.match(/VERDICT:\s*(\w+)/i);
      const gapTypeM      = verdictSearch.match(/GAP_TYPE:\s*([A-Z_]+)/i);
      const gapType       = gapTypeM ? gapTypeM[1].toUpperCase() : 'NONE';
      const needsEnrichment = verdictM ? verdictM[1].toUpperCase() === 'NEEDS_ENRICHMENT' : qRaw.length > 5;

      // Gap-type-specific placeholder — guides the candidate to answer what the pipeline needs
      const GAP_PLACEHOLDERS = {
        MISSING_METRIC:    'Even approximate — percentage, revenue figure, time saved, team size. Rough numbers are better than no numbers.',
        MISSING_MECHANISM: 'What specifically did you do to produce this? The decision, the action, the move that made the difference.',
        MISSING_SCOPE:     'What was the scale — budget, number of accounts, users, markets — that gives this its full weight?',
        VAGUE_CLAIM:       'What specifically did you do here that someone else in your position wouldn\'t have done?',
        NONE:              'Your answer…',
      };
      const placeholder = GAP_PLACEHOLDERS[gapType] || GAP_PLACEHOLDERS.NONE;

      cardCount++;

      let questionsHtml = '';
      if (needsEnrichment && qRaw && qRaw.toUpperCase() !== 'NONE') {
        const qLines = qRaw.split('\n')
          .map(l => l.replace(/^\d+[.)]\s*/,'').replace(/^[-•]\s*/,'').trim())
          .filter(l => l.length > 5);
        const firstQ = qLines[0];
        if (firstQ) {
          const fid = `bulletQ_${cardCount}_0`;
          questionsHtml = `<div class="bullet-question">
            <p class="bullet-question-text">${escHtml(firstQ)}</p>
            <textarea class="textarea bullet-question-answer" id="${fid}"
              data-bullet="${escHtml(bulletText)}" data-question="${escHtml(firstQ)}"
              data-gap-type="${escHtml(gapType)}"
              rows="2" placeholder="${escHtml(placeholder)}"></textarea>
          </div>`;
        }
      }

      cardsHtml += `
        <div class="bullet-diag-card${needsEnrichment ? ' needs-enrichment' : ''}">
          ${role ? `<div class="bullet-diag-role">${escHtml(role)}</div>` : ''}
          <div class="bullet-diag-text">${safeText(bulletText)}</div>
          ${relevance ? `<div class="bullet-diag-relevance">↳ ${safeText(relevance)}</div>` : ''}
          ${needsEnrichment && questionsHtml ? `
            <div class="bullet-diag-questions">
              <p class="bullet-diag-questions-label">One question — your answer strengthens the evidence in your cover letter</p>
              ${questionsHtml}
            </div>` : ''}
        </div>`;
    });

    if (cardCount === 0) {
      return `<p class="bullet-diag-eyebrow">Experiences selected for this role</p>
        <p style="font-size:13px;color:var(--text3);font-style:italic;">Review complete. Answer any questions below.</p>`;
    }

    return `<p class="bullet-diag-eyebrow">Experiences selected for this role</p>${cardsHtml}`;
  }

  // ── Resume bullets ─────────────────────────────────────────────────────────
  // ── PARSER TENET ─────────────────────────────────────────────────────────────
  // All LLM output parsers in this codebase follow these rules:
  // 1. Field label regexes are ALWAYS case-insensitive (/i flag)
  // 2. Separators match 2+ of the separator character, not exactly 3
  // 3. Every parser has a named fallback — never silently returns nothing
  // 4. Internal labels (ROLE:, VERDICT:, SUMMARY:) are NEVER shown to the user
  // These rules apply to every new parser added to this file.
  // ─────────────────────────────────────────────────────────────────────────────

  function _parseBullets(raw) {
    const result = { rewritten:[], summary:'' };
    if (!raw) return result;

    // Case-insensitive SUMMARY match
    const sm = raw.match(/^SUMMARY:\s*(.+)$/im);
    if (sm) result.summary = sm[1].trim();

    // Separator: 2+ dashes with optional whitespace — handles ----, ---, — variations
    raw.split(/^-{2,}\s*$/m).map(b => b.trim()).filter(Boolean).forEach(block => {
      if (/^SUMMARY:/i.test(block)) return;

      // Case-insensitive field matching — LLM may output Original: or ORIGINAL:
      const origM = block.match(/^ORIGINAL:\s*([\s\S]+?)(?=^REWRITTEN:|$)/im);
      const rewM  = block.match(/^REWRITTEN:\s*([\s\S]+?)(?=^ARGUES:|$)/im);
      const argM  = block.match(/^ARGUES:\s*([\s\S]+?)$/im);

      if (!origM || !rewM) return;
      result.rewritten.push({
        original:  origM[1].trim(),
        rewritten: rewM[1].trim(),
        proves:    argM ? argM[1].trim() : '',
      });
    });
    return result;
  }

  function bullets(raw) {
    if (!raw) return '<p style="color:var(--text3);">Bullets generating…</p>';
    if (raw.startsWith('ERROR:') || raw.startsWith('Could not'))
      return `<div class="bullet-error">${safeText(raw)}</div>`;
    const parsed = _parseBullets(raw);
    let html = '';
    if (parsed.summary) html += `<p class="bullets-summary">${safeText(parsed.summary)}</p>`;
    parsed.rewritten.forEach(b => {
      html += `<div class="bullet-card">
        <div class="bullet-rewritten">${safeText(b.rewritten)}</div>
        ${b.proves ? `<div class="bullet-argues">↳ ${safeText(b.proves)}</div>` : ''}
        <div class="bullet-original-row">
          <span class="bullet-original-label">Original</span>
          <span class="bullet-original-text">${safeText(b.original)}</span>
        </div></div>`;
    });
    return html || `<div style="white-space:pre-wrap;color:var(--text);font-size:13.5px;line-height:1.7;">${safeText(raw)}</div>`;
  }

  // ── Cold email ─────────────────────────────────────────────────────────────
  function coldEmail(text, evalData) {
    if (!text) return '';
    const lines = text.split('\n');
    let subject = ''; const bodyLines = [];
    lines.forEach(l => { if (l.toLowerCase().startsWith('subject:')) subject = l.split(':').slice(1).join(':').trim(); else bodyLines.push(l); });
    const body  = bodyLines.join('\n').trim();
    const chars = body.length;
    const color = chars <= 300 ? 'var(--ok)' : 'var(--warn)';
    const subjectHtml = subject ? `<div class="email-subject">
      <span class="email-subject-label">Subject</span>
      <span class="email-subject-text">${safeText(subject)}</span></div>` : '';
    const bodyHtml = body.split(/\n\n+/).filter(p => p.trim()).map(p => {
      const d = document.createElement('div'); d.textContent = p.trim();
      return `<p style="margin:0 0 1em;line-height:1.7;color:var(--text);">${d.innerHTML}</p>`;
    }).join('');
    return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;padding-bottom:.75rem;border-bottom:1px solid var(--divider);">
      <span style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text4);">Cold Outreach</span>
      <span style="font-size:11px;color:${color};">${chars} chars</span>
    </div>${subjectHtml}${bodyHtml}${evalBlock(evalData)}`;
  }

  // ── Interview prep ─────────────────────────────────────────────────────────
  function _field(label, value, extraClass = '') {
    return `<div class="interview-field ${extraClass}">
      <span class="interview-field-label">${escHtml(label)}</span>
      <span class="interview-field-value">${safeText(value)}</span></div>`;
  }

  function interviewPrep(text, evalData) {
    if (!text) return '<p style="color:var(--text3);">Interview prep generating…</p>';
    let sections = [];

    // Strategy 1: ━ dividers
    const divPat = /━{5,}\n(.*?)\n━{5,}/g;
    let lastIdx = 0, m;
    while ((m = divPat.exec(text)) !== null) {
      if (sections.length > 0) sections[sections.length - 1].body = text.slice(lastIdx, m.index).trim();
      sections.push({ title: m[1].trim(), body: '' });
      lastIdx = m.index + m[0].length;
    }
    if (sections.length > 0) sections[sections.length - 1].body = text.slice(lastIdx).trim();

    // Strategy 2: SECTION N — TITLE headers
    if (sections.length === 0) {
      const hPat = /^(SECTION \d+[^:\n]*|#{1,3}\s+.+)$/gm;
      const hMatches = [...text.matchAll(hPat)];
      hMatches.forEach((hm, i) => {
        const start = hm.index + hm[0].length;
        const end   = hMatches[i + 1]?.index ?? text.length;
        sections.push({ title: hm[1].replace(/^#+\s*/,'').replace(/^SECTION \d+ — /,'').trim(), body: text.slice(start, end).trim() });
      });
    }

    // Strategy 3: **Bold** headers
    if (sections.length === 0) {
      const parts = text.split(/\*\*(.+?)\*\*/g);
      for (let i = 1; i < parts.length; i += 2)
        sections.push({ title: parts[i].trim(), body: (parts[i+1] || '').trim() });
    }

    // Strategy 4: whole text as one section
    if (sections.length === 0) sections = [{ title:'Interview Preparation', body:text.trim() }];

    let html = '';
    sections.forEach(section => {
      const title = section.title.replace(/^SECTION \d+ — /, '');
      const body  = section.body;
      const titleUp = title.toUpperCase();

      html += `<div class="interview-section">
        <h3 class="interview-section-title">${escHtml(title)}</h3>
        <div class="interview-section-body">`;

      if (titleUp.includes('LIKELY QUESTIONS') || titleUp.includes('QUESTIONS')) {
        body.split(/(?=^Q:)/m).filter(b => b.trim()).forEach(block => {
          const qM    = block.match(/^Q:\s*(.+?)(?=\n|$)/);
          const evalM = block.match(/(?:WHAT THEY ARE ACTUALLY EVALUATING|What they(?:'re| are) evaluating)[:\s]+(.+?)(?=\n(?:HOW TO|How to)|$)/si);
          const howM  = block.match(/(?:HOW TO THINK[^:]*|How to think[^:]*)[:\s]+(.+?)(?=\n(?:YOUR STRONGEST|Your (?:strongest |evidence))|$)/si);
          const evM   = block.match(/(?:YOUR STRONGEST EVIDENCE[^:]*|Your (?:strongest )?evidence)[:\s]+(.+?)(?=\n(?:WHAT TO AVOID|What to avoid)|$)/si);
          const avM   = block.match(/(?:WHAT TO AVOID|What to avoid)[:\s]+(.+?)(?=\n\n|$)/si);
          if (!qM) return;
          html += `<div class="interview-qa"><div class="interview-q">
            <span class="interview-q-label">Q</span><span>${safeText(qM[1].trim())}</span></div>`;
          if (evalM) html += _field("What they're evaluating", evalM[1].trim());
          if (howM)  html += _field('How to think about it',   howM[1].trim());
          if (evM)   html += _field('Your evidence',           evM[1].trim(),  'interview-field-evidence');
          if (avM)   html += _field('What to avoid',           avM[1].trim(),  'interview-field-avoid');
          html += `</div>`;
        });

      } else if (titleUp.includes('HARD QUESTIONS') || titleUp.includes('HARD')) {
        const qBlocks = body.split(/(?=(?:THE QUESTION|The question)[:\s])/im).filter(b => b.trim());
        (qBlocks.length > 0 ? qBlocks : [body]).forEach(block => {
          const qM   = block.match(/(?:THE QUESTION|The question)[:\s]+(.+?)(?=\n(?:WHY IT IS|Why it|WHY IT'S)|$)/si);
          const whyM = block.match(/(?:WHY IT IS HARD|Why it(?:'s| is) hard)[:\s]+(.+?)(?=\n(?:HOW TO HANDLE|How to handle)|$)/si);
          const howM = block.match(/(?:HOW TO HANDLE IT|How to handle it)[:\s]+(.+?)(?=\n(?:WHAT NOT|What not)|$)/si);
          const notM = block.match(/(?:WHAT NOT TO SAY|What not to say)[:\s]+(.+?)(?=\n\n|$)/si);
          if (!qM) return;
          html += `<div class="interview-qa interview-qa-hard"><div class="interview-q">
            <span class="interview-q-label hard">!</span><span>${safeText(qM[1].trim())}</span></div>`;
          if (whyM) html += _field("Why it's hard",   whyM[1].trim(), 'interview-field-avoid');
          if (howM) html += _field('How to handle it', howM[1].trim(), 'interview-field-evidence');
          if (notM) html += _field('What not to say',  notM[1].trim());
          html += `</div>`;
        });

      } else if (titleUp.includes('QUESTIONS TO ASK') || titleUp.includes('ASK THEM') || titleUp.includes('ASK THE')) {
        body.split(/(?=^Q:)/m).filter(b => b.trim()).forEach(block => {
          const qM   = block.match(/^Q:\s*(.+?)(?=\n(?:WHY THIS WORKS|Why this works)|$)/si);
          const whyM = block.match(/(?:WHY THIS WORKS|Why this works)[:\s]+(.+?)(?=\n\n|$)/si);
          if (!qM) return;
          html += `<div class="interview-qa"><div class="interview-q">
            <span class="interview-q-label ask">?</span><span>${safeText(qM[1].trim())}</span></div>
            ${whyM ? _field('Why this works', whyM[1].trim()) : ''}</div>`;
        });

      } else {
        // Generic: First 4 Minutes, Closing, Note on Preparation
        const nonNegM = body.match(/YOUR \d+ NON-NEGOTIABLES?[:\s]*([\s\S]+)/i);
        if (nonNegM) {
          const openM = body.match(/OPENING STATEMENT[:\s]*([\s\S]+?)(?=YOUR \d+ NON|$)/i);
          if (openM) html += _field('Opening statement', openM[1].trim());
          nonNegM[1].split(/\n(?=(?:THE POINT|EVIDENCE|NATURAL MOMENT)[:\s])/i).filter(s => s.trim()).forEach(item => {
            const pointM  = item.match(/(?:THE POINT|The point)[:\s]+(.+?)(?=\n(?:EVIDENCE|Your evidence)|$)/si);
            const evidM   = item.match(/(?:EVIDENCE|Your evidence)[:\s]+(.+?)(?=\n(?:NATURAL MOMENT|Natural moment)|$)/si);
            const momentM = item.match(/(?:NATURAL MOMENT|Natural moment)[:\s]+(.+?)(?=\n\n|$)/si);
            if (!pointM && !evidM && !momentM) { if (item.trim()) html += `<p class="interview-para">${safeText(item.trim())}</p>`; return; }
            html += `<div class="interview-qa">`;
            if (pointM)  html += _field('The point',     pointM[1].trim());
            if (evidM)   html += _field('Evidence',       evidM[1].trim(), 'interview-field-evidence');
            if (momentM) html += _field('Natural moment', momentM[1].trim());
            html += `</div>`;
          });
        } else {
          body.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
            if (line.startsWith('- ') || line.startsWith('• '))
              html += `<div class="interview-bullet">${safeText(line.slice(2))}</div>`;
            else if (line.startsWith('"') || line.startsWith('\u201c'))
              html += `<blockquote class="interview-quote">${safeText(line)}</blockquote>`;
            else
              html += `<p class="interview-para">${safeText(line)}</p>`;
          });
        }
      }

      html += `</div></div>`;
    });

    return (html || `<div style="white-space:pre-wrap;color:var(--text);font-size:13.5px;line-height:1.7;">${safeText(text)}</div>`)
      + evalBlock(evalData);
  }

  // ── Form answers ───────────────────────────────────────────────────────────
  function formAnswers(raw) {
    if (!raw) return '';
    const blocks = raw.split(/^---$/m).map(b => b.trim()).filter(b => b.length > 5);
    if (!blocks.length)
      return `<div style="white-space:pre-wrap;font-size:13.5px;color:var(--text);line-height:1.7;">${safeText(raw)}</div>`;
    let html = `<div class="form-answers-list">`;
    blocks.forEach(block => {
      const fM = block.match(/^FIELD:\s*(.+?)(?=\nANSWER:|$)/s);
      const aM = block.match(/^ANSWER:\s*([\s\S]+?)$/s);
      if (!fM) return;
      const question = fM[1].trim();
      const answer   = aM ? aM[1].trim() : '';
      // Answer is the hero. Question is the label above it.
      // Deliberately inverted from the old all-caps label treatment.
      html += `<div class="form-answer-card">
        <p class="form-answer-question">${safeText(question)}</p>
        <div class="form-answer-body">${safeText(answer) || '<em style="color:var(--text4);">No answer generated.</em>'}</div>
      </div>`;
    });
    return html + `</div>`;
  }

  // ── Brief card ─────────────────────────────────────────────────────────────
  function briefCard(lb, tabId) {
    if (!lb) return '';
    const rows = [
      { icon:'↗', label:'Opening',           value: lb.opening_label   || '—' },
      { icon:'⬥', label:'Evidence used',      value: (lb.opening_evidence || '').slice(0, 90) + (lb.opening_evidence?.length > 90 ? '…' : '') || '—' },
      { icon:'⟳', label:'Argument',           value: (lb.argument || '').slice(0, 100) + (lb.argument?.length > 100 ? '…' : '') || '—' },
      { icon:'◎', label:'Company connection', value: lb.p3_label        || '—' },
      lb.gap_handled ? { icon:'△', label:'Gap handled', value: lb.gap_handled.slice(0,80) + (lb.gap_handled.length > 80 ? '…' : '') } : null,
      { icon:'#', label:'Word count',         value: `${lb.word_count   || '—'} words` },
    ].filter(Boolean);
    const rowsHtml = rows.map(r => `<div class="brief-card-row">
      <span class="brief-card-icon">${r.icon}</span>
      <span class="brief-card-label">${r.label}</span>
      <span class="brief-card-value">${safeText(r.value)}</span></div>`).join('');
    return `<div class="brief-card" id="briefCard-${tabId}">
      <div class="brief-card-header">
        <span class="brief-card-title">Why it's written this way</span>
        <button class="brief-card-toggle" onclick="FLOW.toggleBriefCard('briefCardBody-${tabId}',this)">▾</button>
      </div>
      <div class="brief-card-body" id="briefCardBody-${tabId}">
        ${rowsHtml}
        <p class="brief-card-footer">Every decision above came from the brief you approved.</p>
      </div></div>`;
  }

  // ── Refine chips ───────────────────────────────────────────────────────────
  function _chips(asset, cfgId) {
    const MAP = {
      'Cover Letter': [
        ["P1 doesn't hook me",    "The opening paragraph doesn't make me want to keep reading — the result isn't specific enough or the mechanism isn't interesting"],
        ['P2 reads as a list',    'Paragraph 2 lists accomplishments instead of telling one specific story — find the single moment and build around that'],
        ['P3 feels like flattery','Paragraph 3 sounds like I\'m telling them about their own company — rewrite it from my perspective, why I specifically want this'],
        ['Close is too hopeful',  'The closing paragraph sounds like a request not a statement — rewrite so it assumes the conversation is happening'],
        ['Not my voice',          'The language is too formal and polished — write it the way I actually talk, shorter sentences, less impressive-sounding'],
      ],
      'Resume Bullets': [
        ['Too vague',      'The metrics feel generic — make them more specific with actual numbers and context'],
        ['Too long',       'These bullets are too long — trim each one to one strong sentence'],
        ['Missing impact', 'The results aren\'t clear — end each bullet with a specific measurable outcome'],
      ],
      'Cold Outreach Email': [
        ['Weak subject','The subject line is too generic — make it specific to this company or person'],
        ['Too long',    'The body exceeds 300 characters — cut to the sharpest three sentences'],
        ['Vague ask',   'The call to action is too soft — add a specific time window for a call'],
      ],
      'Interview Prep': [
        ['More technical','Add more questions that probe the technical requirements of this role'],
        ['Richer stories','The story bank needs more specific situation details — add the context'],
        ['Honest gaps',   'Be more direct about the real gaps and how to handle them'],
      ],
    };
    return (MAP[asset] || []).map(([label, fb]) =>
      `<button class="chip" onclick="FLOW.setFeedback('feedback-${cfgId}','${escHtml(fb)}')">${label}</button>`
    ).join('');
  }

  // ── Full tab panel ─────────────────────────────────────────────────────────
  function tabPanel(asset, cfg, rawText, evalData, lb, routingOpts, currentOpening) {
    const lbHtml = asset === 'Cover Letter' && lb ? briefCard(lb, cfg.id) : '';
    const nt = STATE.get('brief')?.narrative_thread || '';
    let headerNote = '';
    if (!rawText) {
      headerNote = `<div class="output-brief">${cfg.briefDefault}</div>`;
    } else if (asset === 'Cover Letter' && nt) {
      const short = nt.length > 110 ? nt.slice(0, 110) + '…' : nt;
      headerNote = `<div class="output-brief">Argument: <em>${escHtml(short)}</em></div>`;
    } else if (asset === 'Cold Outreach Email') {
      headerNote = `<div class="output-brief">Cold Outreach · ${rawText.length} chars</div>`;
    } else {
      headerNote = `<div class="output-brief">${asset} ready.</div>`;
    }

    let outputHtml = '';
    if (rawText) {
      if      (asset === 'Cover Letter')            outputHtml = coverLetter(rawText, evalData, cfg.id);
      else if (asset === 'Resume Bullets')          outputHtml = bullets(rawText);
      else if (asset === 'Cold Outreach Email')     outputHtml = coldEmail(rawText, evalData);
      else if (asset === 'Interview Prep')          outputHtml = interviewPrep(rawText, evalData);
      else if (asset === 'Answer Application Form') outputHtml = formAnswers(rawText);
    }

    const copyBtn = `<button class="btn-ghost" onclick="FLOW.copyAsset('${cfg.rawId}')">Copy</button>`;
    const dlBtn   = asset === 'Cover Letter'
      ? `<button class="btn-ghost" onclick="FLOW.downloadPDF('${cfg.rawId}', this)">Download PDF</button>` : '';

    let rethinkSection = '';
    if (asset === 'Cover Letter' && routingOpts?.opening_options?.length > 1) {
      const otherOpts = routingOpts.opening_options.filter(o => o.id !== currentOpening)
        .map(o => `<button class="routing-option" style="margin-bottom:6px;"
            onclick="FLOW.rethinkOpening('${o.id}','${cfg.rawId}','${cfg.id}')">
          <div class="routing-option-content">
            <span class="routing-option-label">Try: ${safeText(o.label)}</span>
            <span class="routing-option-desc">${safeText(o.best_when)}</span>
          </div></button>`).join('');
      if (otherOpts) rethinkSection = `<div class="rethink-section">
        <span class="rethink-label">&#8635; Try a different opening</span>
        <p style="font-size:12px;color:var(--text3);margin-bottom:10px;font-family:var(--font-ui);">P2, P3, and P4 are preserved — only the opening changes.</p>
        <div class="rethink-options">${otherOpts}</div></div>`;
    }

    return `${lbHtml}${headerNote}
      <div class="output-doc" id="outputDoc-${cfg.id}">${outputHtml}</div>
      <textarea id="${cfg.rawId}" style="display:none">${escHtml(rawText)}</textarea>
      <div class="copy-row">${copyBtn}${dlBtn}</div>
      ${rethinkSection}
      <div class="refine-section">
        <p class="refine-label">Refine:</p>
        <div class="chip-row" id="chips-${cfg.id}">${_chips(asset, cfg.id)}</div>
        <div class="diagnosis-display hidden" id="diagDisplay-${cfg.id}"></div>
        <div class="refinement-note hidden" id="refineNote-${cfg.id}"></div>
        <textarea class="textarea" id="feedback-${cfg.id}" rows="2" placeholder="Or describe what to change…"></textarea>
        <button class="btn-secondary" style="margin-top:8px;"
          onclick="FLOW.refineAsset('${asset}','${cfg.id}','${cfg.rawId}',this)">&#8635; Refine</button>
      </div>`;
  }

  return {
    evalBlock, coverLetter, gapAnalysis, bulletDiagnosisCards,
    bullets, coldEmail, interviewPrep, formAnswers, briefCard, tabPanel,
  };
})();


/* ═══════════════════════════════════════════════════════════════════════════
   6. FLOW
   Step orchestration. Coordinates STATE, DOM, UI, API, RENDERERS.
   Only module that calls UI.showToast().
   ═══════════════════════════════════════════════════════════════════════════ */

const FLOW = (() => {
  const { show, hide, val, setText, setHtml, el } = DOM;

  const ASSET_CONFIG = {
    'Cover Letter':           { id:'coverLetter',   rawId:'coverRaw',    label:'✏ Cover Letter',  briefDefault:'Your cover letter is being written. It will open with your strongest result, not your job title.' },
    'Resume Bullets':         { id:'resumeBullets', rawId:'bulletsRaw',  label:'▪ Bullets',        briefDefault:'Your bullets are being rewritten — each one sharpened to prove a specific thing about your case.' },
    'Cold Outreach Email':    { id:'email',         rawId:'emailRaw',    label:'✉ Email',          briefDefault:'Your cold email is being written — three sentences, one specific company observation, one clear ask.' },
    'Interview Prep':         { id:'interviewPrep', rawId:'interviewRaw',label:'▶ Interview',      briefDefault:'Your interview prep is being built — questions from the JD, answers from your evidence, what to avoid.' },
    'Answer Application Form':{ id:'formAnswers',   rawId:'formRaw',     label:'☐ Form Answers',   briefDefault:'Answering every form field from the brief you approved — not from templates.' },
  };
  const RESULT_KEY = {
    'Cover Letter':'cover_letter', 'Resume Bullets':'resume_bullets',
    'Cold Outreach Email':'email', 'Interview Prep':'interview_prep', 'Answer Application Form':'form_answers',
  };
  const STEP_LABELS = {
    0:'Start — Choose your assets', 1:'Step 1 — Your Story', 2:'Step 2 — Set Role',
    3:'Step 3 — Read Truth', 3.5:'Step 3.5 — Sharpen Truth',
    4:'Step 4 — Your Voice', 4.25:'Step 4.25 — Form Questions', 5:'Step 5 — Build Assets',
  };

  // ── Dynamic step subtitles ────────────────────────────────────────────────────
  // Every step subtitle updates based on what we know about this candidate + company.
  // Called after key state changes — after CV parse, after research, after brief.
  // Personalisation makes the product feel like it's reading this specific situation,
  // not running a generic flow.
  function updateStepSubtitles() {
    const brief     = STATE.get('brief') || {};
    const parsedCv  = STATE.get('parsedCv') || {};
    const company   = brief.company    || '';
    const role      = brief.job_title  || '';
    const firstName = (brief.candidate_name || parsedCv.candidate_name || '').split(' ')[0];
    const assets    = STATE.get('selectedAssets') || [];
    const needs     = STATE.get('flowNeeds') || {};

    // Step 0 — after asset selection
    if (assets.length > 0) {
      DOM.setText('step0Sub', `${assets.length} asset${assets.length > 1 ? 's' : ''} selected.`);
    }

    // Step 1 — after CV parse
    if (firstName) {
      DOM.setText('step1Sub', `${firstName}'s CV loaded.`);
    }

    // Step 2 — after company detected
    if (company && role) {
      DOM.setText('step2Sub', `Decoding what ${company} needs for ${role}.`);
    } else if (company) {
      DOM.setText('step2Sub', `Decoding what ${company} needs.`);
    }

    // Step 3 — after brief assembled
    const nt = brief.narrative_thread || '';
    if (nt) {
      DOM.setText('step3Sub', 'Read the argument. Approve it to continue.');
    } else if (company) {
      DOM.setText('step3Sub', `The brief for ${company} is ready.`);
    }

    // Step 3.5 — bullet diagnosis context
    const gaps = brief.gaps_to_address || '';
    if (gaps && gaps.toUpperCase() !== 'NONE') {
      DOM.setText('step35Sub', 'One question per bullet. Each answer sharpens your evidence.');
    }

    // Step 4 — voice context
    if (!needs.voice) {
      DOM.setText('step4Sub', "These assets don't need a writing sample.");
    } else if (firstName) {
      DOM.setText('step4Sub', `Optional — but a sample makes ${firstName}'s voice specific.`);
    }

    // Step 5 — after generation
    if (company && assets.length > 0) {
      DOM.setText('step5Sub', `${assets.length} asset${assets.length > 1 ? 's' : ''} built for ${company}.`);
    }
  }
  function collapseStep(stepId, collapsedId) { hide(stepId); show(collapsedId); }

  function activateStep(stepId) {
    const e = el(stepId); if (!e) return;
    e.classList.remove('hidden'); e.classList.add('active');
    setTimeout(() => e.scrollIntoView({ behavior:'smooth', block:'start' }), 100);
  }

  function editStep(stepId, collapsedId) {
    hide(collapsedId);
    const e = el(stepId); if (!e) return;
    e.classList.remove('hidden');
    setTimeout(() => e.scrollIntoView({ behavior:'smooth', block:'start' }), 100);
  }

  function updateProgress(step) {
    const RAIL = { 1:'srail1', 2:'srail2', 3:'srail3', 3.5:'srail35', 4:'srail4', 4.25:'srail4', 5:'srail5' };
    const ORDER = [1, 2, 3, 3.5, 4, 5];
    let idx = -1;
    if (step > 0) { idx = ORDER.indexOf(step); if (idx === -1) idx = ORDER.findIndex(s => s >= step); }
    ORDER.forEach((s, i) => {
      const railEl = el(RAIL[s]); if (!railEl) return;
      const ds = railEl.getAttribute('data-step');
      const cls = idx === -1 ? 'todo' : i < idx ? 'done' : i === idx ? 'active' : 'todo';
      railEl.className = `sidebar-step ${cls}`;
      railEl.setAttribute('data-step', ds);
      const check = railEl.querySelector('.srail-check');
      if (check) check.classList.toggle('hidden', cls !== 'done');
    });
    UI.updateElevatorButtons();
  }

  function sidebarStepClick(step) {
    const MAP = {
      1:{ stepId:'step1', collapsedId:'step1Collapsed' }, 2:{ stepId:'step2', collapsedId:'step2Collapsed' },
      3:{ stepId:'step3', collapsedId:'step3Collapsed' }, 3.5:{ stepId:'step35', collapsedId:'step35Collapsed' },
      4:{ stepId:'step4', collapsedId:'step4Collapsed' }, 5:{ stepId:'step5', collapsedId:null },
    };
    const map = MAP[step]; if (!map) return;
    const railEl = el('srail' + String(step).replace('.',''));
    if (!railEl || !railEl.classList.contains('done')) return;
    if (map.collapsedId) editStep(map.stepId, map.collapsedId);
    else { show(map.stepId); activateStep(map.stepId); }
    setTimeout(() => { const se = el(map.stepId); if (se) se.scrollIntoView({ behavior:'smooth', block:'start' }); }, 100);
  }

  // ── Step 0 ─────────────────────────────────────────────────────────────────
  const ASSET_NUDGES = {
    single_cover:    'Company research, CV analysis, one argument, one letter. Not a template.',
    single_bullets:  'The bullets most relevant to this role, rewritten to prove something specific.',
    single_interview:'Questions from the JD. Answers from your CV. What each question is really testing.',
    single_email:    'Three sentences. One company observation. One result. One ask.',
    single_form:     'Every field answered from your brief — evidence, not templates.',
    full_package:    'One brief. Five assets. All arguing the same thing.',
    multiple:        'We\'ll ask only for what each asset needs.',
  };

  function toggleAssetCard(card) {
    const target = card.closest ? card.closest('.asset-card') : card;
    if (!target) return;
    const asset = target.dataset.asset; if (!asset) return;
    const sel = STATE.get('selectedAssets');
    if (target.classList.contains('selected')) {
      target.classList.remove('selected');
      STATE.set('selectedAssets', sel.filter(a => a !== asset));
    } else {
      target.classList.add('selected');
      if (!sel.includes(asset)) STATE.set('selectedAssets', [...sel, asset]);
    }
    el('fullPackageCard')?.classList.remove('selected');
    _updateAssetNudge();
  }

  function toggleFullPackage() {
    const card = el('fullPackageCard'); if (!card) return;
    const isSelected = card.classList.contains('selected');
    const all = ['Cover Letter','Resume Bullets','Interview Prep','Cold Outreach Email','Answer Application Form'];
    if (isSelected) {
      card.classList.remove('selected');
      document.querySelectorAll('.asset-card').forEach(c => c.classList.remove('selected'));
      STATE.set('selectedAssets', []);
    } else {
      card.classList.add('selected');
      document.querySelectorAll('.asset-card').forEach(c => c.classList.add('selected'));
      STATE.set('selectedAssets', [...all]);
    }
    _updateAssetNudge();
  }

  function _updateAssetNudge() {
    const nudge = el('assetNudge'); if (!nudge) return;
    const n = STATE.get('selectedAssets');
    if (!n.length) { nudge.classList.add('hidden'); return; }
    let msg = '';
    if (n.length === 5 || el('fullPackageCard')?.classList.contains('selected')) msg = ASSET_NUDGES.full_package;
    else if (n.length === 1) {
      const a = n[0];
      msg = a === 'Cover Letter' ? ASSET_NUDGES.single_cover
          : a === 'Resume Bullets' ? ASSET_NUDGES.single_bullets
          : a === 'Interview Prep' ? ASSET_NUDGES.single_interview
          : a === 'Cold Outreach Email' ? ASSET_NUDGES.single_email
          : ASSET_NUDGES.single_form;
    } else { msg = ASSET_NUDGES.multiple; }
    nudge.textContent = msg; nudge.classList.remove('hidden');
  }

  function completeStep0() {
    if (!STATE.get('selectedAssets').length) { UI.showToast('Please select at least one asset before continuing.'); return; }
    const needs = STATE.computeFlowNeeds();
    _gateVoiceFields(needs.voice);
    const summary = STATE.get('selectedAssets').join(' · ');
    const heroEl  = document.querySelector('.hero');
    if (heroEl) {
      let tag = document.getElementById('step0SelectedSummary');
      if (!tag) {
        tag = document.createElement('p'); tag.id = 'step0SelectedSummary';
        tag.style.cssText = 'font-family:var(--font-ui);font-size:11px;color:var(--text4);margin-top:6px;letter-spacing:0.04em;';
        heroEl.appendChild(tag);
      }
      tag.textContent = `Building: ${summary}`;
    }
    updateStepSubtitles();
    hide('step0'); activateStep('step1'); updateProgress(1);
  }

  function _gateVoiceFields(voiceNeeded) {
    document.querySelectorAll('.voice-field').forEach(e => e.classList.toggle('hidden', !voiceNeeded));
    el('noVoiceNote')?.classList.toggle('hidden', voiceNeeded);
  }

  // ── Step 1 ─────────────────────────────────────────────────────────────────
  function switchMethod(type, method) {
    if (type === 'cv') STATE.set('cvMethod', method);
    el(`${type}PasteBtn`)?.classList.toggle('active', method === 'paste');
    el(`${type}UploadBtn`)?.classList.toggle('active', method === 'upload');
    el(`${type}PasteArea`)?.classList.toggle('hidden', method !== 'paste');
    el(`${type}UploadArea`)?.classList.toggle('hidden', method !== 'upload');
  }

  function handleFile(event, type)     { const f = event.target.files[0]; if (f) _readFile(f, type); }
  function handleDragOver(ev, zoneId)  { ev.preventDefault(); el(zoneId)?.classList.add('drag-over'); }
  function handleDragLeave(ev, zoneId) { el(zoneId)?.classList.remove('drag-over'); }
  function handleDrop(ev, type)        { ev.preventDefault(); el(`${type}UploadZone`)?.classList.remove('drag-over'); const f = ev.dataTransfer.files[0]; if (f) _readFile(f, type); }

  async function _readFile(file, type) {
    const statusEl = el(`${type}FileStatus`);
    if (/\.(pdf|docx)$/i.test(file.name)) {
      if (statusEl) { statusEl.textContent = `Reading ${file.name}…`; statusEl.classList.remove('hidden'); }
      const reader = new FileReader();
      reader.onload = async (e) => {
        const b64  = e.target.result.split(',')[1];
        const data = await API.extractText(file.name, b64);
        if (data.error) { if (statusEl) statusEl.textContent = `⚠ ${data.error}`; UI.showToast(data.error); return; }
        if (type === 'cv') {
          STATE.set('cvText', data.text);
          const wc = data.text.split(/\s+/).length;
          if (statusEl) statusEl.textContent = `✓ ${file.name} — ${wc} words extracted`;
          UI.showATSExtractionNote(wc);
          // Show extracted text so user can verify - this is the ATS moment
          const previewEl = DOM.el('cvExtractedPreview');
          const previewText = DOM.el('cvExtractedText');
          if (previewEl && previewText) {
            previewText.value = data.text;
            previewEl.classList.remove('hidden');
            // Sync edits back to state
            previewText.addEventListener('input', () => STATE.set('cvText', previewText.value), { once: false });
          }
        } else {
          STATE.set('jdText', data.text);
          if (statusEl) statusEl.textContent = `✓ ${file.name} — ${data.text.split(/\s+/).length} words extracted`;
        }
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        STATE.set(type === 'cv' ? 'cvText' : 'jdText', e.target.result);
        if (statusEl) { statusEl.textContent = `✓ ${file.name} loaded`; statusEl.classList.remove('hidden'); }
      };
      reader.readAsText(file);
    }
  }

  async function completeStep1() {
    // ── Input resolution — active method always wins ──────────────────────────
    // Architecture decision: read from the active input at the moment of Continue.
    // This prevents stale state from a previous upload/paste session from
    // silently polluting the pipeline with the wrong CV.
    let cv = '';
    const method = STATE.get('cvMethod');
    if (method === 'paste') {
      const pasteVal = val('cvText');
      if (pasteVal.length >= 50) {
        cv = pasteVal;
        STATE.set('cvText', cv); // sync state to what user sees on screen
      } else {
        cv = STATE.get('cvText'); // empty paste — fall back to uploaded file if present
      }
    } else {
      cv = STATE.get('cvText'); // upload mode — trust state set by _readFile
    }
    if (!cv || cv.length < 50) { UI.showToast('Please add your CV before continuing — paste the text or upload a file.'); return; }
    if (cv.startsWith('%PDF') || cv.includes('endobj') || cv.includes('xref\n')) { UI.showToast('This looks like a raw PDF — please use the upload button or paste the text.'); return; }
    STATE.set('cvText', cv);
    const lines    = cv.split('\n').map(l => l.trim()).filter(l => l.length > 1);
    const nameLine = lines.find(l => l.length < 60 && /^[A-Za-z\s.\-']+$/.test(l)) || '';
    setText('step1Summary', nameLine.length > 2 ? nameLine : 'CV loaded');
    collapseStep('step1', 'step1Collapsed');
    activateStep('step2'); updateProgress(2); UI.showSidebarTooltip();
    try {
      const data = await API.parseCv(cv);
      if (data.parsed_cv) {
        STATE.set('parsedCv', data.parsed_cv); STATE.enrichBrief({ parsed_cv: data.parsed_cv });
        const pn = data.parsed_cv.candidate_name;
        if (pn && pn !== 'NONE' && pn.length > 2) { setText('step1Summary', pn); STATE.enrichBrief({ candidate_name: pn }); }
        updateStepSubtitles();
      }
    } catch (e) { console.warn('CV parsing failed (non-blocking):', e.message); }
  }

  // ── Step 2 ─────────────────────────────────────────────────────────────────
  function switchJdMethod(method) {
    STATE.set('jdMethod', method);
    ['paste','image','upload'].forEach(m => {
      el('jdPasteBtn')?.classList.toggle('active',  m === 'paste'  && method === 'paste');
      el('jdImageBtn')?.classList.toggle('active',  m === 'image'  && method === 'image');
      el('jdUploadBtn')?.classList.toggle('active', m === 'upload' && method === 'upload');
      const areaMap = { paste:'jdPasteArea', image:'jdImageArea', upload:'jdUploadArea' };
      el(areaMap[m])?.classList.toggle('hidden', m !== method);
    });
  }

  function handleJdImage(ev)     { const f = ev.target.files[0]; if (f) _extractJdFromFile(f, f.type || 'image/jpeg'); }
  function handleDropJdImage(ev) { ev.preventDefault(); el('jdImageZone')?.classList.remove('drag-over'); const f = ev.dataTransfer.files[0]; if (f) _extractJdFromFile(f, f.type || 'image/jpeg'); }
  function handleJdPdf(ev)       { const f = ev.target.files[0]; if (f) _extractJdFromFile(f, 'application/pdf'); }

  async function _extractJdFromFile(file, mediaType) {
    const isPdf = mediaType === 'application/pdf';
    const statusEl  = el(isPdf ? 'jdFileStatus' : 'jdImageStatus');
    const previewEl = el(isPdf ? 'jdPdfPreview' : 'jdImagePreview');
    const textEl    = el(isPdf ? 'jdPdfText'    : 'jdImageText');
    if (statusEl) { statusEl.textContent = 'Reading your JD…'; statusEl.classList.remove('hidden'); }
    if (previewEl) previewEl.classList.add('hidden');
    const reader = new FileReader();
    reader.onload = async (e) => {
      const b64  = e.target.result.split(',')[1];
      if (!isPdf) { STATE.set('jdImageB64', b64); STATE.set('jdImageMediaType', mediaType); }
      const data = await API.extractJdImage(b64, mediaType);
      if (data.error) { if (statusEl) statusEl.textContent = `⚠ ${data.error}`; UI.showToast(data.error); return; }
      STATE.set('jdText', data.text);
      if (textEl)    textEl.value = data.text;
      if (previewEl) previewEl.classList.remove('hidden');
      if (statusEl)  statusEl.textContent = `✓ Extracted — ${data.text.split(/\s+/).length} words. Review and edit above.`;
    };
    reader.readAsDataURL(file);
  }

  function advanceFlowStage(n) {
    for (let i = 1; i <= 4; i++) {
      const e = el(`flowStage${i}`); if (!e) continue;
      e.classList.toggle('active', i === n); e.classList.toggle('done', i < n);
    }
  }

  async function runResearch() {
    let jd = '';
    const jdMethod = STATE.get('jdMethod');
    if (jdMethod === 'paste')  jd = val('jdText');
    else if (jdMethod === 'image')  jd = el('jdImageText')?.value?.trim() || STATE.get('jdText');
    else if (jdMethod === 'upload') jd = el('jdPdfText')?.value?.trim()   || STATE.get('jdText');

    const isRoleOnly = !jd || jd.length < 30;
    if (isRoleOnly) {
      const company = val('manualCompany').trim();
      if (!company) { UI.showToast('Enter the company name and role — or paste the full job description.'); return; }
      UI.showToast('No JD — building from company research only. Outputs will be less targeted.');
      jd = `Role: ${company}. No job description provided. Build entirely from company research and candidate CV.`;
      STATE.enrichBrief({ jd_thin:true, jd_case:'no_jd' });
    }
    if (!isRoleOnly && (jd.startsWith('%PDF') || jd.includes('endobj'))) {
      UI.showToast('This looks like a raw PDF — please use the upload button or paste the text.'); return;
    }

    STATE.set('jdText', jd);
    const manualCompany = val('manualCompany');
    advanceFlowStage(2); show('loadingResearch'); hide('orgRoleConfirm'); hide('painPointsSection');
    const researchBtn = el('researchBtn');
    const restoreResearch = UI.setButtonLoading(researchBtn, 'Decoding this role…');
    const stageTimer = UI.runStages(UI.RESEARCH_STAGES, 'researchStage', 'researchSubstage', 'rs', 6000);

    try {
      const data = await API.runResearch(STATE.get('cvText'), jd, manualCompany);
      clearInterval(stageTimer); hide('loadingResearch');
      restoreResearch();

      if (data.error === 'company_not_found') {
        advanceFlowStage(1);
        const orgField = el('manualCompany');
        if (orgField) { orgField.style.borderColor = 'var(--warn)'; orgField.style.boxShadow = '0 0 0 3px var(--warn-bg)'; orgField.placeholder = 'Could not detect — enter company name and try again'; orgField.focus(); }
        UI.showToast('Company not detected — enter the name above and try again.'); return;
      }
      if (data.error) { advanceFlowStage(1); UI.showToast(data.error.includes('busy')||data.error.includes('rate') ? 'The service is busy — wait 30 seconds and try again.' : 'Something went wrong. Check the JD and try again.'); return; }

      STATE.replaceBriefSafe(data.brief);
      STATE.enrichBrief({ jd_text: jd });
      const company  = STATE.get('brief').company   || manualCompany || '';
      const jobTitle = STATE.get('brief').job_title || '';

      advanceFlowStage(3);
      const cc = el('confirmedCompany'), cr = el('confirmedRole');
      if (cc) cc.value = company; if (cr) cr.value = jobTitle;

      // Company briefing — shown expanded by default (valuable research, not hidden)
      if (data.company_briefing) { setHtml('briefingBody', DOM.md(data.company_briefing)); show('companyBriefing'); }

      show('orgRoleConfirm');
      if (data.pain_points?.length) { renderPainPoints(data.pain_points); advanceFlowStage(4); show('painPointsSection'); }
      else UI.showToast('Could not decode pain points — try adding more detail to the JD, or enter the company name and retry.');

      const orgField = el('manualCompany'); if (orgField && !orgField.value) orgField.value = company;
      setText('step2Summary', `${company||'—'} · ${jobTitle||'—'}`);
      updateStepSubtitles();
      UI.showMomentum('🔍 Decoded', `${company||'Company'} · ${jobTitle||'Role'} — here's what they actually need.`, '', 4000);

    } catch (e) {
      clearInterval(stageTimer); hide('loadingResearch'); advanceFlowStage(1);
      restoreResearch();
      UI.showToast(API.userMessage(e));
    }
  }

  function renderPainPoints(points) {
    const list = el('painPointsList'); if (!list) return;
    list.innerHTML = ''; STATE.set('selectedPainPoints', []); _updatePainCounter(0);

    // Build CV signal index for overlap detection
    // Uses parsedCv fields already in state — no extra LLM call
    const parsedCv   = STATE.get('parsedCv') || {};
    const brief      = STATE.get('brief')    || {};
    const cvSignals  = [
      parsedCv.top_achievement_1, parsedCv.top_achievement_2, parsedCv.top_achievement_3,
      parsedCv.strongest_skill, parsedCv.career_arc, parsedCv.skills_and_tools,
      parsedCv.all_metrics, brief.strongest_overlap,
    ].filter(Boolean).join(' ').toLowerCase();

    // Extract meaningful keywords from CV signals for matching
    // Strips common filler words, keeps domain terms
    const STOP_WORDS = new Set(['the','a','an','and','or','in','on','at','to','for',
      'of','with','by','from','this','that','have','has','is','are','was','were',
      'be','been','being','will','would','can','could','do','did','does']);

    function extractKeywords(text) {
      return text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !STOP_WORDS.has(w));
    }

    const cvKeywords = extractKeywords(cvSignals);

    function getOverlapStrength(painPoint) {
      if (!cvKeywords.length) return 0;
      const painKeywords = extractKeywords(painPoint);
      // Count how many pain point keywords appear in the CV signal set
      const matches = painKeywords.filter(kw =>
        cvKeywords.some(cvKw => cvKw.includes(kw) || kw.includes(cvKw))
      );
      return matches.length / Math.max(painKeywords.length, 1);
    }

    // Score and annotate each pain point
    const scored = points.map(p => {
      const clean = p.replace(/^\d+\.\s*/, '').replace(/\*\*([^*]+)\*\*/g, '$1').trim();
      return { clean, score: getOverlapStrength(clean) };
    }).filter(p => p.clean.length >= 10);

    // Only badge if there's meaningful overlap (score > 0.15 = at least 15% keyword overlap)
    // We surface strength only — never show "Weak evidence" or similar discouraging labels
    const STRONG_THRESHOLD = 0.25; // high confidence overlap
    const GOOD_THRESHOLD   = 0.15; // some overlap

    scored.forEach(({ clean, score }) => {
      const item = document.createElement('div');
      item.className = 'pain-item';

      let badgeHtml = '';
      if (score >= STRONG_THRESHOLD) {
        badgeHtml = '<span class="pain-evidence-badge pain-evidence-strong">Strong evidence in your CV</span>';
      } else if (score >= GOOD_THRESHOLD) {
        badgeHtml = '<span class="pain-evidence-badge pain-evidence-good">Evidence in your CV</span>';
      }
      // Below GOOD_THRESHOLD: no badge shown — user doesn't know we checked

      item.innerHTML = `<span class="pain-item-text">${DOM.escHtml(clean)}</span>${badgeHtml}`;
      item.addEventListener('click', () => _togglePainPoint(item, clean));
      list.appendChild(item);
    });
  }

  function _togglePainPoint(item, text) {
    if (item.classList.contains('dimmed')) return;
    const sel = STATE.get('selectedPainPoints');
    if (item.classList.contains('selected')) {
      item.classList.remove('selected');
      STATE.set('selectedPainPoints', sel.filter(p => p !== text));
      _updatePainCounter(STATE.get('selectedPainPoints').length);
      _updatePainDimming();
      if (STATE.get('selectedPainPoints').length < 1) hide('contextTrigger');
    } else {
      if (sel.length >= 2) { item.classList.add('shake'); setTimeout(() => item.classList.remove('shake'), 400); return; }
      item.classList.add('selected');
      STATE.set('selectedPainPoints', [...sel, text]);
      _updatePainCounter(STATE.get('selectedPainPoints').length); _updatePainDimming();
      if (STATE.get('selectedPainPoints').length >= 1) show('contextTrigger');
    }
  }

  function _updatePainCounter(n) {
    el('pip-a')?.classList.toggle('filled', n >= 1); el('pip-b')?.classList.toggle('filled', n >= 2);
    setText('painCounterText', `${n} of 2 selected`);
  }
  function _updatePainDimming() {
    const full = STATE.get('selectedPainPoints').length >= 2;
    document.querySelectorAll('.pain-item').forEach(i => i.classList.toggle('dimmed', full && !i.classList.contains('selected')));
  }
  function showContext() { hide('contextTrigger'); show('contextArea'); STATE.set('contextVisible', true); }

  async function confirmPainPoints() {
    if (!STATE.get('selectedPainPoints').length) { UI.showToast('Please select at least one pain point before continuing.'); return; }
    const cc = val('confirmedCompany'), cr = val('confirmedRole');
    if (cc) STATE.enrichBrief({ company: cc }); if (cr) STATE.enrichBrief({ job_title: cr });
    STATE.enrichBrief({ selected_pain_points: STATE.get('selectedPainPoints'), user_instruction: val('userInstruction') });
    show('loadingQuestions');
    const confirmBtn = el('confirmPainBtn');
    const restoreConfirm = UI.setButtonLoading(confirmBtn, 'Building your brief…');
    UI.showMomentum('✅ Argument set','These are your two. Everything we build will argue you can solve them.','',4000);
    if (STATE.get('parsedCv')) STATE.enrichBrief({ parsed_cv: STATE.get('parsedCv') });
    show('loadingBrief');
    const stageTimer = UI.runStages(UI.BRIEF_STAGES, 'briefStage', 'briefSubstage', 'bs', 5000);
    try {
      const data = await API.buildBrief(STATE.get('brief'), { bullet_qa:{}, anything_missed:'', open_field:'' });
      clearInterval(stageTimer); hide('loadingBrief'); hide('loadingQuestions');
      restoreConfirm();
      if (data.detail) { UI.showToast('Something went wrong building the brief — try again.'); return; }
      STATE.replaceBriefSafe(data.brief);
      const nt = data.narrative_thread || ''; STATE.set('narrativeThread', nt);
      if (nt) { setText('narrativeThread', nt); show('narrativeReveal'); }
      updateStepSubtitles();
      if (data.gap_analysis) {
        const { html, angle } = RENDERERS.gapAnalysis(data.gap_analysis);
        setHtml('gapAnalysis', html);
        if (angle) { const ac = el('angleCallout'), ae = el('angleText'); if (ac && ae) { ae.textContent = angle; ac.classList.remove('hidden'); } }
      }
      collapseStep('step2','step2Collapsed'); activateStep('step3'); show('approveBtn'); updateProgress(3);
    } catch (e) {
      clearInterval(stageTimer); hide('loadingBrief'); hide('loadingQuestions');
      restoreConfirm(); UI.showToast(API.userMessage(e));
    }
  }

  // ── Step 3 ─────────────────────────────────────────────────────────────────
  async function approveBrief() {
    hide('approveBtn'); UI.showMomentum('✓ Approved','Good. Now we sharpen it.','',3000);
    const needsStep35 = STATE.get('flowNeeds').step35;
    if (needsStep35) {
      show('loadingBullets');
      try {
        const data = await API.diagnoseBullets(STATE.get('brief'));
        hide('loadingBullets');
        if (data.diagnosis) { STATE.set('bulletDiagnosisRaw', data.diagnosis); setHtml('bulletDiagnosis', RENDERERS.bulletDiagnosisCards(data.diagnosis)); show('bulletDiagnosis'); }
      } catch (e) { hide('loadingBullets'); console.warn('Bullet diagnosis failed (non-fatal):', e.message); }
      collapseStep('step3','step3Collapsed'); activateStep('step35'); updateProgress(3.5);
    } else {
      collapseStep('step3','step3Collapsed');
      const needs = STATE.get('flowNeeds');
      if (needs.form) { activateStep('step425'); updateProgress(4.25); }
      else if (needs.step4) { activateStep('step4'); updateProgress(4); }
      else { show('generateSection'); activateStep('step5'); updateProgress(5); }
    }
  }

  // ── Step 3.5 ───────────────────────────────────────────────────────────────
  function _collectBulletQA() {
    const qa = {};
    document.querySelectorAll('.bullet-question-answer').forEach(e => {
      const { bullet, question } = e.dataset; const answer = e.value.trim();
      if (bullet && question) { if (!qa[bullet]) qa[bullet] = {}; qa[bullet][question] = answer; }
    });
    return qa;
  }

  async function proceedToTexture() {
    const bulletQA = _collectBulletQA(), anythingMissed = val('anythingMissed');
    if (Object.keys(bulletQA).length) STATE.enrichBrief({ bullet_qa: bulletQA });
    if (anythingMissed) STATE.enrichBrief({ anything_missed: anythingMissed });
    const hasAnswers = Object.keys(bulletQA).length > 0 || anythingMissed.length > 3;
    if (hasAnswers && STATE.get('flowNeeds').brief) {
      try {
        const data = await API.buildBrief(STATE.get('brief'), { bullet_qa:bulletQA, anything_missed:anythingMissed, open_field:anythingMissed });
        if (data.brief) STATE.replaceBriefSafe({ ...STATE.get('brief'), ...data.brief });
        if (data.narrative_thread) { STATE.set('narrativeThread', data.narrative_thread); setText('narrativeThread', data.narrative_thread); }
      } catch (e) { console.warn('Brief enrichment failed (non-fatal):', e.message); }
    }
    collapseStep('step35','step35Collapsed');
    const needs = STATE.get('flowNeeds');
    if (needs.form) { activateStep('step425'); updateProgress(4.25); }
    else if (needs.step4) { activateStep('step4'); updateProgress(4); }
    else { show('generateSection'); activateStep('step5'); updateProgress(5); }
  }

  // ── Step 4.25 ──────────────────────────────────────────────────────────────
  function switchFormMethod(method) {
    STATE.set('formMethod', method);
    el('formPasteBtn')?.classList.toggle('active', method === 'paste');
    el('formImageBtn')?.classList.toggle('active', method === 'image');
    el('formPasteArea')?.classList.toggle('hidden', method !== 'paste');
    el('formImageArea')?.classList.toggle('hidden', method !== 'image');
  }
  function handleFormImage(ev)     { const f = ev.target.files[0]; if (f) _storeFormImage(f); }
  function handleDropFormImage(ev) { ev.preventDefault(); el('formImageZone')?.classList.remove('drag-over'); const f = ev.dataTransfer.files[0]; if (f) _storeFormImage(f); }
  function _storeFormImage(file) {
    const s = el('formImageStatus'); if (s) { s.textContent = `✓ ${file.name} ready.`; s.classList.remove('hidden'); }
    const r = new FileReader();
    r.onload = e => { STATE.set('formImageB64', e.target.result.split(',')[1]); STATE.set('formImageMediaType', file.type || 'image/jpeg'); };
    r.readAsDataURL(file);
  }
  function proceedFromForm() {
    if (STATE.get('formMethod') === 'paste') { if ((el('formText')?.value?.trim() || '').length < 10) { UI.showToast('Please paste your form questions before continuing.'); return; } }
    else if (!STATE.get('formImageB64')) { UI.showToast('Please upload a screenshot of the form before continuing.'); return; }
    setText('step425Summary', STATE.get('formMethod') === 'paste' ? 'Questions pasted' : 'Screenshot uploaded');
    collapseStep('step425','step425Collapsed'); activateStep('step4'); updateProgress(4);
  }

  // ── Step 4 ─────────────────────────────────────────────────────────────────
  el('referralName')?.addEventListener('input', e => { STATE.get('applicationContext').referral_name = e.target.value.trim(); });

  async function proceedToChoosePath() {
    const needs = STATE.get('flowNeeds');
    STATE.set('writingSample', needs.voice ? val('writingSample') : '');
    const appCtx = {
      referral_name:    needs.voice ? val('referralName') : '',
      company_stage:    STATE.get('brief').derived_company_stage    || 'growing',
      career_situation: STATE.get('brief').derived_career_situation || 'standard',
      cv_register:      STATE.get('brief').parsed_cv?.cv_register   || 'standard',
    };
    const sitEl = el('situationSelect');
    if (sitEl?.value) { appCtx.situation = sitEl.value; STATE.enrichBrief({ situation: sitEl.value }); }
    STATE.set('applicationContext', appCtx); STATE.enrichBrief({ application_context: appCtx });
    collapseStep('step4','step4Collapsed');
    const sel = STATE.get('selectedAssets');
    if (sel.includes('Cover Letter') || !sel.length) { show('routingCard'); show('loadingRouting'); await _loadRoutingOptions(); }
    show('generateSection'); activateStep('step5'); updateProgress(5);
  }

  async function _loadRoutingOptions() {
    try {
      const data = await API.getRouting({ ...STATE.get('brief'), application_context: STATE.get('applicationContext') });
      hide('loadingRouting');
      if (!data.opening_options) return;
      STATE.set('routingOptions', data);
      STATE.set('routingChoices', { opening: data.recommended_opening, p3: data.recommended_p3 });
      _renderRoutingOpts('routingOpeningOptions', data.opening_options, data.recommended_opening, id => { STATE.get('routingChoices').opening = id; });
      _renderRoutingOpts('routingP3Options',      data.p3_options,      data.recommended_p3,      id => { STATE.get('routingChoices').p3     = id; });
    } catch (e) { hide('loadingRouting'); console.warn('Routing failed (non-fatal):', e.message); }
  }

  function _renderRoutingOpts(containerId, options, selectedId, onSelect) {
    const container = el(containerId); if (!container || !options) return;
    container.innerHTML = options.map(opt => `
      <div class="routing-option${opt.id === selectedId ? ' selected' : ''}" data-rid="${opt.id}">
        <div class="routing-option-content">
          <span class="routing-option-label">${DOM.safeText(opt.label)}</span>
          <span class="routing-option-desc">${DOM.safeText(opt.description)}</span>
          <span class="routing-option-reason">${DOM.safeText(opt.reasoning)}</span>
        </div></div>`).join('');
    container.querySelectorAll('.routing-option').forEach(optEl => {
      optEl.addEventListener('click', () => {
        container.querySelectorAll('.routing-option').forEach(o => o.classList.remove('selected'));
        optEl.classList.add('selected'); onSelect(optEl.dataset.rid);
      });
    });
  }

  // ── Generation ─────────────────────────────────────────────────────────────
  async function generateAssets() {
    const selected = STATE.get('selectedAssets');
    if (!selected.length) { UI.showToast('Please select at least one asset.'); return; }
    show('loadingGenerate');
    const generateBtn = el('generateBtn');
    const restoreGenerate = UI.setButtonLoading(generateBtn, 'Building your assets…');
    const regularAssets = selected.filter(a => a !== 'Answer Application Form');
    const formSelected  = selected.includes('Answer Application Form');
    const stageTimer = UI.runStages(UI.generateStages(regularAssets.length ? regularAssets : selected), 'generateStage','generateSubstage','gs',8000);
    try {
      if (regularAssets.length) {
        const data = await API.generate({ brief:STATE.get('brief'), selected_assets:regularAssets, writing_sample:STATE.get('writingSample'), application_context:STATE.get('applicationContext'), routing_choices:STATE.get('routingChoices') });
        STATE.set('results', data.results || {}); STATE.set('evals', data.evals || {});
        if (data.letter_briefs?.cover_letter) STATE.set('letterBrief', data.letter_briefs.cover_letter);
      }
      if (formSelected) {
        try {
          const fd = await API.answerForm({ brief:STATE.get('brief'), writing_sample:STATE.get('writingSample'), form_text:STATE.get('formMethod')==='paste'?(el('formText')?.value?.trim()||''):'', form_content_b64:STATE.get('formMethod')==='image'?STATE.get('formImageB64'):'', form_media_type:STATE.get('formMethod')==='image'?STATE.get('formImageMediaType'):'' });
          STATE.get('results')['form_answers'] = fd.answers || '';
        } catch (fe) { STATE.get('results')['form_answers'] = 'Form answering failed — please try again.'; }
      }
      clearInterval(stageTimer); hide('loadingGenerate'); restoreGenerate(); updateProgress(5);
      if (STATE.get('firstGenerate')) {
        STATE.set('firstGenerate', false);
        setText('momentumRevealText', `${selected.length} asset${selected.length!==1?'s':''} built from one brief. Specific to ${STATE.get('brief').company||'this company'} and traceable to the argument you approved.`);
        const rev = el('momentumReveal'); if (rev) { rev.classList.remove('hidden'); rev.classList.add('pulse-once'); }
      }
      updateStepSubtitles();
      _buildTabs(selected, STATE.get('results'), STATE.get('evals'));
      setTimeout(() => show('endMoment'), 600);
    } catch (e) {
      clearInterval(stageTimer); hide('loadingGenerate'); restoreGenerate();
      UI.showToast(API.userMessage(e));
    }
  }

  function _buildTabs(selected, results, evals) {
    const tabsRow = el('tabsRow'), tabPanels = el('tabPanels');
    if (!tabsRow || !tabPanels) return;
    tabsRow.innerHTML = ''; tabPanels.innerHTML = '';
    selected.forEach((asset, i) => {
      const cfg = ASSET_CONFIG[asset]; if (!cfg) return;
      const key = RESULT_KEY[asset] || 'interview_prep';
      const rawText = results[key] || '';
      const evalData = evals[key]  || {};
      const btn = document.createElement('button');
      btn.className = 'tab-btn' + (i === 0 ? ' active' : ''); btn.textContent = cfg.label; btn.dataset.tab = cfg.id;
      btn.addEventListener('click', () => _switchTab(cfg.id)); tabsRow.appendChild(btn);
      const panel = document.createElement('div');
      panel.className = 'tab-panel' + (i === 0 ? ' active' : ''); panel.id = `tab-${cfg.id}`;
      // Error boundary — a broken renderer cannot break sibling tabs
      try {
        panel.innerHTML = RENDERERS.tabPanel(asset, cfg, rawText, evalData, STATE.get('letterBrief'), STATE.get('routingOptions'), STATE.get('routingChoices').opening);
      } catch (renderErr) {
        console.error('Renderer failed for ' + asset + ':', renderErr);
        panel.innerHTML = '<div style="padding:20px;color:var(--text3);font-family:var(--font-ui);font-size:13px;">' +
          '<p style="margin-bottom:12px;">Something went wrong rendering this asset — raw text below.</p>' +
          '<textarea style="width:100%;min-height:200px;font-size:12px;line-height:1.6;padding:12px;background:var(--card-raised);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:var(--font-ui);" readonly>' +
          DOM.escHtml(rawText) + '</textarea>' +
          '<div style="margin-top:12px;"><button class="btn-ghost" onclick="navigator.clipboard.writeText(this.parentNode.querySelector(\'textarea\').value).then(()=>UI.showToast(\'Copied ✓\'))">Copy</button></div>' +
          '</div>';
      }
      tabPanels.appendChild(panel);
      const rawEl = el(cfg.rawId); if (rawEl) rawEl.value = rawText;
    });
  }

  function _switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.tab-panel').forEach(p => { p.classList.toggle('active', p.id === `tab-${tabId}`); p.classList.toggle('hidden', p.id !== `tab-${tabId}`); });
  }

  // ── Refinement ─────────────────────────────────────────────────────────────
  function setFeedback(fieldId, text) { const e = el(fieldId); if (e) { e.value = text; e.focus(); } }

  function setRefineFocus(paragraph, tabId) {
    STATE.set('refineParagraphFocus', paragraph);
    document.querySelectorAll('.para-label-btn').forEach(b => b.classList.toggle('active', b.dataset.para === paragraph));
    const fe = el(`feedback-${tabId}`); if (fe && !fe.value) fe.placeholder = `What do you want to change about ${paragraph}?`;
    UI.showToast(`Focused on ${paragraph} — describe what you want to change`);
  }

  async function refineAsset(asset, tabId, rawId, btnEl) {
    const feedback = val(`feedback-${tabId}`), currentText = el(rawId)?.value;
    if (!currentText) { UI.showToast('Nothing to refine yet.'); return; }
    if (!feedback)    { UI.showToast('Describe what you want changed first.'); return; }
    const docEl = el(`outputDoc-${tabId}`), diagEl = el(`diagDisplay-${tabId}`), noteEl = el(`refineNote-${tabId}`);
    const refineBtn = btnEl || null;
    if (docEl) docEl.classList.add('refining');
    if (refineBtn) { refineBtn.disabled = true; refineBtn.textContent = 'Diagnosing…'; }
    if (diagEl) { diagEl.innerHTML = `<div class="diag-loading">Reading to find exactly what to change…</div>`; diagEl.classList.remove('hidden'); }
    try {
      const data = await API.refine({ current_text:currentText, feedback, output_type:asset, brief:STATE.get('brief'), writing_sample:STATE.get('writingSample'), letter_brief:asset==='Cover Letter'?(STATE.get('letterBrief')||{}):{}, paragraph_focus:STATE.get('refineParagraphFocus')||'' });
      if (refineBtn) { refineBtn.disabled = false; refineBtn.textContent = '↺ Refine'; }
      if (docEl) docEl.classList.remove('refining');
      if (diagEl && data.diagnosis) {
        const d = data.diagnosis;
        diagEl.innerHTML = `<div class="diag-block">
          <div class="diag-row"><span class="diag-icon">⌖</span><span class="diag-label">Found</span><span class="diag-value">${DOM.safeText(d.target||'—')}</span></div>
          <div class="diag-row"><span class="diag-icon">◈</span><span class="diag-label">Issue</span><span class="diag-value">${DOM.safeText(d.issue||'—')}</span></div>
          <div class="diag-row diag-fix-row"><span class="diag-icon">✓</span><span class="diag-label">Changed</span><span class="diag-value">${DOM.safeText(d.fix||'—')}</span></div>
          ${d.preserve?`<div class="diag-row diag-preserve-row"><span class="diag-icon">⬡</span><span class="diag-label">Preserved</span><span class="diag-value">${DOM.safeText(d.preserve)}</span></div>`:''}</div>`;
        diagEl.classList.remove('hidden');
      }
      if (data.refined) {
        el(rawId).value = data.refined;
        if (data.letter_brief && asset === 'Cover Letter') { STATE.set('letterBrief', data.letter_brief); const wc = document.querySelector('.cl-word-count'); if (wc) wc.textContent = `${data.letter_brief.word_count||''} words`; }
        if (noteEl && data.evals) {
          const parts = [];
          if (data.evals.specificity_score) parts.push(`Specificity ${data.evals.specificity_score}/10`);
          if (data.evals.alignment_score)   parts.push(`Alignment ${data.evals.alignment_score}/10`);
          if (parts.length) { noteEl.textContent = `Refined. ${parts.join(' · ')}`; noteEl.classList.remove('hidden'); }
        }
        let newHtml = '';
        if      (asset==='Cover Letter')        newHtml = RENDERERS.coverLetter(data.refined, data.evals||{}, tabId);
        else if (asset==='Resume Bullets')      newHtml = RENDERERS.bullets(data.refined);
        else if (asset==='Cold Outreach Email') newHtml = RENDERERS.coldEmail(data.refined, data.evals||{});
        else if (asset==='Interview Prep')      newHtml = RENDERERS.interviewPrep(data.refined, data.evals||{});
        if (docEl && newHtml) docEl.innerHTML = newHtml;
        el(`feedback-${tabId}`).value = '';
        UI.showToast('Done ✓');
      }
    } catch (e) {
      if (refineBtn) { refineBtn.disabled = false; refineBtn.textContent = '↺ Refine'; }
      if (docEl) docEl.classList.remove('refining'); if (diagEl) diagEl.classList.add('hidden');
      UI.showToast(API.userMessage(e));
    }
  }

  async function rethinkOpening(newApproachId, rawId, tabId) {
    const currentLetter = el(rawId)?.value; if (!currentLetter) return;
    const docEl = el(`outputDoc-${tabId}`); if (docEl) docEl.classList.add('refining');
    UI.showToast('Rewriting the opening…');
    try {
      const data = await API.rethinkOpening({ current_letter:currentLetter, new_opening_approach:newApproachId, brief:STATE.get('brief'), writing_sample:STATE.get('writingSample') });
      if (docEl) docEl.classList.remove('refining');
      if (data.letter) {
        el(rawId).value = data.letter; STATE.get('routingChoices').opening = newApproachId;
        if (docEl) docEl.innerHTML = RENDERERS.coverLetter(data.letter, {}, tabId);
        UI.showToast('Opening updated — P2, P3, P4 unchanged ✓');
        const rOpts = STATE.get('routingOptions');
        if (rOpts) {
          const panel = el(`tab-${tabId}`); const rEl = panel?.querySelector('.rethink-options');
          if (rEl) rEl.innerHTML = rOpts.opening_options.filter(o => o.id !== newApproachId)
            .map(o => `<button class="routing-option" style="margin-bottom:6px;" onclick="FLOW.rethinkOpening('${o.id}','${rawId}','${tabId}')">
              <div class="routing-option-content"><span class="routing-option-label">Try: ${DOM.safeText(o.label)}</span><span class="routing-option-desc">${DOM.safeText(o.best_when)}</span></div></button>`).join('');
        }
      }
    } catch (e) { if (docEl) docEl.classList.remove('refining'); UI.showToast('Could not rewrite opening — try again.'); }
  }

  // ── Copy and download ──────────────────────────────────────────────────────
  function copyAsset(rawId) {
    const v = el(rawId)?.value; if (!v) return;
    navigator.clipboard.writeText(v).then(() => UI.showToast('Copied to clipboard ✓')).catch(() => UI.showToast('Copy failed — try selecting the text manually'));
  }

  async function downloadPDF(rawId, btnEl) {
    const rawEl = el(rawId); if (!rawEl?.value) { UI.showToast('Nothing to download yet.'); return; }
    const btn = btnEl || null; const orig = btn?.textContent;
    if (btn) { btn.textContent = 'Preparing…'; btn.disabled = true; }
    try {
      const res = await API.downloadPdf(rawEl.value, STATE.get('brief').candidate_name||'', STATE.get('brief').company||'');
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); const co = (STATE.get('brief').company||'application').replace(/\s+/g,'_').toLowerCase();
      a.href = url; a.download = `cover_letter_${co}.pdf`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      UI.showToast('Downloaded ✓');
    } catch (e) { UI.showToast('Download failed — try copying the text instead.'); }
    finally { if (btn) { btn.textContent = orig; btn.disabled = false; } }
  }

  // ── Brief card toggle ──────────────────────────────────────────────────────
  function toggleBriefCard(bodyId, btn) {
    const body = el(bodyId); if (!body) return;
    const collapsed = body.style.display === 'none';
    body.style.display = collapsed ? '' : 'none'; btn.textContent = collapsed ? '▾' : '▸';
  }

  // ── Rating ─────────────────────────────────────────────────────────────────
  function showRating() {
    hide('doneSection'); show('ratingSection');
    const re = el('assetRatings'); if (!re) return;
    const LABELS = { cover_letter:'✏ Cover Letter', resume_bullets:'▪ Resume Bullets', email:'✉ Cold Email', interview_prep:'▶ Interview Prep' };
    let html = '';
    Object.keys(STATE.get('results')||{}).forEach(key => {
      const label = LABELS[key]; if (!label) return;
      html += `<div class="asset-rating-row"><span class="asset-rating-label">${label}</span>
        <div class="star-rating" data-asset="${key}">${[1,2,3,4,5].map(n => `<button class="star-btn" data-value="${n}" onclick="FLOW.setRating('${key}',${n})">☆</button>`).join('')}</div></div>`;
    });
    re.innerHTML = html || '<p style="color:var(--text3);font-size:13px;">No assets to rate.</p>';
  }

  function setRating(assetKey, value) {
    STATE.get('ratings')[assetKey] = value;
    const row = document.querySelector(`.star-rating[data-asset="${assetKey}"]`); if (!row) return;
    row.querySelectorAll('.star-btn').forEach(b => { const v = parseInt(b.dataset.value); b.textContent = v <= value ? '★' : '☆'; b.classList.toggle('star-filled', v <= value); });
  }

  async function submitRating() {
    try {
      await API.submitRating({ ratings:STATE.get('ratings'), feedback:val('ratingFeedback'), company:STATE.get('brief').company||'', job_title:STATE.get('brief').job_title||'', narrative:STATE.get('brief').narrative_thread||'', timestamp:new Date().toISOString() });
    } catch(e) { /* silently fail — rating loss is better than blocking user */ }
    hide('ratingSection'); show('ratingPaths');
  }

  function showSuggestions() { show('suggestionsSection'); }

  function submitSuggestion() {
    const text = val('suggestionsText'); if (!text) { UI.showToast('Add your suggestion first.'); return; }
    API.submitRating({ ratings:{}, feedback:`FEATURE_REQUEST: ${text}`, company:STATE.get('brief').company||'', job_title:STATE.get('brief').job_title||'', narrative:'', timestamp:new Date().toISOString() }).catch(()=>{});
    hide('suggestionsSection'); UI.showToast("Thank you — noted. We'll reach out when it's live.");
  }

  function resetAll() { if (!confirm('Start a new application? This will clear everything.')) return; location.reload(); }

  // ── IntersectionObserver — step label ────────────────────────────────────
  if ('IntersectionObserver' in window) {
    [{ id:'step1',step:1},{id:'step2',step:2},{id:'step3',step:3},{id:'step35',step:3.5},{id:'step4',step:4},{id:'step5',step:5}].forEach(({ id, step }) => {
      const stepEl = el(id); if (!stepEl) return;
      new IntersectionObserver(entries => {
        if (!entries[0].isIntersecting) return;
        const le = el('stepLabelText'); if (!le) return;
        le.style.opacity = '0';
        setTimeout(() => { le.textContent = STEP_LABELS[step] || ''; le.style.opacity = '1'; }, 120);
      }, { threshold:0.1, rootMargin:'-52px 0px -50% 0px' }).observe(stepEl);
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  updateProgress(0);

  return {
    collapseStep, activateStep, editStep, updateProgress, sidebarStepClick, updateStepSubtitles,
    toggleAssetCard, toggleFullPackage, completeStep0,
    switchMethod, handleFile, handleDragOver, handleDragLeave, handleDrop, completeStep1,
    switchJdMethod, handleJdImage, handleDropJdImage, handleJdPdf, runResearch,
    renderPainPoints, showContext, confirmPainPoints,
    approveBrief,
    proceedToTexture,
    switchFormMethod, handleFormImage, handleDropFormImage, proceedFromForm,
    proceedToChoosePath,
    generateAssets,
    copyAsset, downloadPDF, setFeedback, setRefineFocus, refineAsset, rethinkOpening,
    toggleBriefCard,
    showRating, setRating, submitRating, showSuggestions, submitSuggestion, resetAll,
  };
})();
