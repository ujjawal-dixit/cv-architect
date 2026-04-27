// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  brief: {},
  cvText: '', cvMethod: 'paste',
  jdText: '', jdMethod: 'paste',
  jdImageB64: '', jdImageMediaType: '',  // for image JD extraction
  selectedPainPoints: [],
  answeredCount: 0,
  narrativeThread: '',
  writingSample: '',
  // Step 0 selection — drives entire flow
  selectedAssets: [],
  // Form answering state
  formMethod: 'paste',   // paste or image
  formImageB64: '',
  formImageMediaType: '',
  results: {}, evals: {},
  firstGenerate: true,
  contextVisible: false,
  applicationContext: {
    company_stage: '',
    career_situation: '',
    referral_name: '',
  },
  routingChoices: { opening: '', p3: '' },
  routingOptions: null,
  parsedCv: null,
  letterBrief: null,
  refineParagraphFocus: '',
  ratings: {},
};

// ── Dark mode ─────────────────────────────────────────────────────────────────
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
if (prefersDark) {
  document.documentElement.classList.add('dark');
  document.getElementById('dmBtn').textContent = 'Light mode';
}
function toggleDark() {
  document.documentElement.classList.toggle('dark');
  document.getElementById('dmBtn').textContent =
    document.documentElement.classList.contains('dark') ? 'Light mode' : 'Dark mode';
}

// ── Progress pips ─────────────────────────────────────────────────────────────
const stepLabels = {
  0: 'Start — Choose your assets',
  1: 'Step 1 — Your Story', 2: 'Step 2 — Set Role',
  3: 'Step 3 — Read Truth',
  3.5: 'Step 3.5 — Sharpen Truth', 4: 'Step 4 — Your Voice',
  4.25: 'Form Questions',
  4.5: 'Step 4.5 — Choose Path', 5: 'Step 5 — Build Assets',
};

function updateProgress(step) {
  [1,2,3,4,5].forEach((s, i) => {
    const pip  = document.getElementById(`pip${s}`);
    const line = document.getElementById(`line${s}`);
    if (!pip) return;
    const active = Math.ceil(step);
    pip.className = 'step-pip ' + (s < active ? 'done' : s === active ? 'active' : 'todo');
    pip.textContent = s < active ? '✓' : String(s);
    if (line) line.className = 'pip-line ' + (s < active ? 'done' : '');
  });
  const el = document.getElementById('stepLabelText');
  if (el) {
    el.style.opacity = '0';
    setTimeout(() => { el.textContent = stepLabels[step] || ''; el.style.opacity = '1'; }, 120);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const show = id => { const e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
const hide = id => { const e = document.getElementById(id); if (e) e.classList.add('hidden'); };
const val  = id => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
const setHtml = (id, h) => { const e = document.getElementById(id); if (e) e.innerHTML = h; };
const setText = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function collapseStep(stepId, collapsedId) {
  hide(stepId);
  show(collapsedId);
}
function activateStep(stepId) {
  const el = document.getElementById(stepId);
  if (!el) return;
  el.classList.remove('hidden');
  el.classList.add('active');
  setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}

// Allow user to go back and edit any completed step
function editStep(stepId, collapsedId) {
  hide(collapsedId);
  show(stepId);
  const el = document.getElementById(stepId);
  if (el) {
    el.classList.remove('hidden');
    setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }
}

// ── Momentum singleton — Von Restorff: ONE gold element at a time ──────────────
let momentumTimer = null;
function showMomentum(label, text, thread = '', autoDismiss = 4000) {
  const el = document.getElementById('momentumSingleton');
  if (!el) return;
  if (momentumTimer) { clearTimeout(momentumTimer); momentumTimer = null; }

  setText('momentumLabel', label);
  setText('momentumText', text);
  const threadEl = document.getElementById('momentumThread');
  if (thread) {
    threadEl.textContent = thread;
    threadEl.classList.remove('hidden');
  } else {
    threadEl.classList.add('hidden');
  }

  el.classList.remove('visible');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.classList.add('visible');
    });
  });

  if (autoDismiss > 0) {
    momentumTimer = setTimeout(() => {
      el.classList.remove('visible');
    }, autoDismiss);
  }
}

// ── Toast — Gulf of Evaluation: 3s visible, appears at content level ───────────
function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

// ── Staged loading — Doherty Threshold ───────────────────────────────────────
function runStages(stages, stageEl, substageEl, dotPrefix, intervalMs = 5000) {
  let i = 0;
  updateStageUI(stages, i, stageEl, substageEl, dotPrefix);
  const timer = setInterval(() => {
    i++;
    if (i >= stages.length) { clearInterval(timer); return; }
    updateStageUI(stages, i, stageEl, substageEl, dotPrefix);
  }, intervalMs);
  return timer;
}

function updateStageUI(stages, i, stageEl, substageEl, dotPrefix) {
  const stageE = document.getElementById(stageEl);
  const subE   = document.getElementById(substageEl);
  if (stageE) stageE.textContent = stages[i].stage;
  if (subE && stages[i].sub) subE.textContent = stages[i].sub;

  // Update dots
  for (let d = 0; d < 4; d++) {
    const dot = document.getElementById(`${dotPrefix}${d}`);
    if (!dot) continue;
    dot.className = 'stage-dot ' + (d < i ? 'done' : d === i ? 'active' : '');
  }
}

const researchStages = [
  { stage: 'Reading the job description…', sub: '' },
  { stage: 'Identifying the company…', sub: '' },
  { stage: 'Pulling company intelligence…', sub: 'Researching recent news and strategic context' },
  { stage: 'Decoding what they actually need…', sub: 'Finding the 5 real challenges this role exists to solve' },
];
const briefStages = [
  { stage: 'Reading your CV against this role…', sub: '' },
  { stage: 'Extracting your strongest signals…', sub: 'Achievements, undersold qualities, career narrative' },
  { stage: 'Finding the strategic intersection…', sub: 'Where your background meets their specific problem' },
  { stage: 'Writing the argument…', sub: 'The narrative thread that runs through every asset' },
];
const generateStages = (assets) => [
  { stage: 'Starting with the brief you approved…', sub: '' },
  { stage: `Building ${assets[0] || 'your assets'}…`, sub: 'Specific to this company and this argument' },
  { stage: assets[1] ? `Building ${assets[1]}…` : 'Evaluating specificity…', sub: '' },
  { stage: 'Scoring for specificity and alignment…', sub: 'Almost ready' },
];

// ── File upload — CV and JD ───────────────────────────────────────────────────
// ── STEP 0 — Asset selection ──────────────────────────────────────────────────

// Asset requirements map — union determines which steps appear
const ASSET_STEPS = {
  'Cover Letter':           { needsResearch: true,  needsBrief: true,  needsStep35: true,  needsRouting: true  },
  'Resume Bullets':         { needsResearch: false, needsBrief: false, needsStep35: true,  needsRouting: false },
  'Interview Prep':         { needsResearch: true,  needsBrief: true,  needsStep35: false, needsRouting: false },
  'Cold Outreach Email':    { needsResearch: true,  needsBrief: true,  needsStep35: false, needsRouting: false },
  'Answer Application Form':{ needsResearch: false, needsBrief: false, needsStep35: false, needsRouting: false, needsForm: true },
};

// Nudge copy per selection state
const ASSET_NUDGES = {
  single_cover:   'A cover letter built with company research is significantly stronger. We\'ll do both.',
  single_bullets: 'Bullets only — fast and focused. We\'ll sharpen them against this specific role.',
  single_interview:'Interview prep only — we\'ll pull the right questions from the JD and your CV.',
  single_email:   'Cold email only. We\'ll research the company so sentence one earns attention.',
  single_form:    'Form answering only — paste or screenshot your questions, we\'ll answer from your CV.',
  full_package:   'The complete stack for a role that matters. Every asset built from one brief.',
  multiple:       'We\'ll run the steps each selected asset needs. Nothing extra.',
};

function toggleAssetCard(card) {
  const asset = card.dataset.asset;
  const isSelected = card.classList.contains('selected');

  if (isSelected) {
    card.classList.remove('selected');
    state.selectedAssets = state.selectedAssets.filter(a => a !== asset);
  } else {
    card.classList.add('selected');
    if (!state.selectedAssets.includes(asset)) state.selectedAssets.push(asset);
  }

  // Deselect Full Package if individual cards are touched
  document.getElementById('fullPackageCard')?.classList.remove('selected');

  updateAssetNudge();
}

function toggleFullPackage() {
  const card = document.getElementById('fullPackageCard');
  const isSelected = card.classList.contains('selected');

  if (isSelected) {
    card.classList.remove('selected');
    // Deselect all individual cards
    document.querySelectorAll('.asset-select-card').forEach(c => c.classList.remove('selected'));
    state.selectedAssets = [];
  } else {
    card.classList.add('selected');
    // Select all individual cards
    const all = ['Cover Letter','Resume Bullets','Interview Prep','Cold Outreach Email','Answer Application Form'];
    document.querySelectorAll('.asset-select-card').forEach(c => c.classList.add('selected'));
    state.selectedAssets = [...all];
  }

  updateAssetNudge();
}

function updateAssetNudge() {
  const nudge = document.getElementById('assetNudge');
  if (!nudge) return;
  const n = state.selectedAssets;

  let msg = '';
  if (n.length === 0) {
    nudge.classList.add('hidden');
    return;
  } else if (n.length === 5 || document.getElementById('fullPackageCard')?.classList.contains('selected')) {
    msg = ASSET_NUDGES.full_package;
  } else if (n.length === 1) {
    const a = n[0];
    if (a === 'Cover Letter')            msg = ASSET_NUDGES.single_cover;
    else if (a === 'Resume Bullets')     msg = ASSET_NUDGES.single_bullets;
    else if (a === 'Interview Prep')     msg = ASSET_NUDGES.single_interview;
    else if (a === 'Cold Outreach Email')msg = ASSET_NUDGES.single_email;
    else if (a === 'Answer Application Form') msg = ASSET_NUDGES.single_form;
  } else {
    msg = ASSET_NUDGES.multiple;
  }

  nudge.textContent = msg;
  nudge.classList.remove('hidden');
}

function completeStep0() {
  if (state.selectedAssets.length === 0) {
    showToast('Please select at least one asset before continuing.');
    return;
  }

  // Compute required steps from union of asset requirements
  const needs = {
    research: false, brief: false, step35: false, routing: false, form: false,
  };
  state.selectedAssets.forEach(asset => {
    const req = ASSET_STEPS[asset] || {};
    if (req.needsResearch) needs.research = true;
    if (req.needsBrief)    needs.brief    = true;
    if (req.needsStep35)   needs.step35   = true;
    if (req.needsRouting)  needs.routing  = true;
    if (req.needsForm)     needs.form     = true;
  });
  state.flowNeeds = needs;

  // Collapse Step 0, show Step 1
  hide('step0');
  activateStep('step1');
  updateProgress(1);
}

// ── JD input — three modes: paste, image, PDF ─────────────────────────────────
function switchJdMethod(method) {
  state.jdMethod = method;
  ['paste','image','upload'].forEach(m => {
    document.getElementById(`jdPasteBtn`)?.classList.toggle('active', m === 'paste' && method === 'paste');
    document.getElementById(`jdImageBtn`)?.classList.toggle('active', m === 'image' && method === 'image');
    document.getElementById(`jdUploadBtn`)?.classList.toggle('active', m === 'upload' && method === 'upload');
    const areaMap = { paste: 'jdPasteArea', image: 'jdImageArea', upload: 'jdUploadArea' };
    document.getElementById(areaMap[m])?.classList.toggle('hidden', m !== method);
  });
}

async function handleJdImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  await extractJdFromImage(file);
}

function handleDropJdImage(event) {
  event.preventDefault();
  document.getElementById('jdImageZone')?.classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (file) extractJdFromImage(file);
}

async function extractJdFromImage(file) {
  const statusEl = document.getElementById('jdImageStatus');
  const previewEl = document.getElementById('jdImagePreview');
  const textEl = document.getElementById('jdImageText');

  if (statusEl) { statusEl.textContent = 'Reading your JD…'; statusEl.classList.remove('hidden'); }
  if (previewEl) previewEl.classList.add('hidden');

  const reader = new FileReader();
  reader.onload = async (e) => {
    const b64 = e.target.result.split(',')[1];
    const mediaType = file.type || 'image/jpeg';

    state.jdImageB64 = b64;
    state.jdImageMediaType = mediaType;

    try {
      const res = await fetch('/api/extract-jd-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_b64: b64, media_type: mediaType }),
      });
      const data = await res.json();

      if (data.error) {
        if (statusEl) statusEl.textContent = `⚠ ${data.error}`;
        showToast(data.error);
        return;
      }

      state.jdText = data.text;
      if (textEl) textEl.value = data.text;
      if (previewEl) previewEl.classList.remove('hidden');
      if (statusEl) statusEl.textContent = `✓ JD extracted — ${data.text.split(/\s+/).length} words. Review and edit above if needed.`;

    } catch (err) {
      if (statusEl) statusEl.textContent = '⚠ Extraction failed — please paste the JD text instead.';
      showToast('Image extraction failed. Please paste the JD text directly.');
    }
  };
  reader.readAsDataURL(file);
}

async function handleJdPdf(event) {
  const file = event.target.files[0];
  if (!file) return;
  await extractJdFromPdf(file);
}

async function extractJdFromPdf(file) {
  const statusEl = document.getElementById('jdFileStatus');
  const previewEl = document.getElementById('jdPdfPreview');
  const textEl = document.getElementById('jdPdfText');

  if (statusEl) { statusEl.textContent = 'Reading your JD…'; statusEl.classList.remove('hidden'); }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const b64 = e.target.result.split(',')[1];
    try {
      const res = await fetch('/api/extract-jd-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_b64: b64, media_type: 'application/pdf' }),
      });
      const data = await res.json();

      if (data.error) {
        if (statusEl) statusEl.textContent = `⚠ ${data.error}`;
        showToast(data.error);
        return;
      }

      state.jdText = data.text;
      if (textEl) textEl.value = data.text;
      if (previewEl) previewEl.classList.remove('hidden');
      if (statusEl) statusEl.textContent = `✓ PDF extracted — ${data.text.split(/\s+/).length} words. Review above if needed.`;

    } catch (err) {
      if (statusEl) statusEl.textContent = '⚠ PDF extraction failed — please paste the JD text instead.';
    }
  };
  reader.readAsDataURL(file);
}

// ── Form input — paste or image ───────────────────────────────────────────────
function switchFormMethod(method) {
  state.formMethod = method;
  document.getElementById('formPasteBtn')?.classList.toggle('active', method === 'paste');
  document.getElementById('formImageBtn')?.classList.toggle('active', method === 'image');
  document.getElementById('formPasteArea')?.classList.toggle('hidden', method !== 'paste');
  document.getElementById('formImageArea')?.classList.toggle('hidden', method !== 'image');
}

async function handleFormImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  storeFormImage(file);
}

function handleDropFormImage(event) {
  event.preventDefault();
  document.getElementById('formImageZone')?.classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (file) storeFormImage(file);
}

function storeFormImage(file) {
  const statusEl = document.getElementById('formImageStatus');
  if (statusEl) { statusEl.textContent = `✓ ${file.name} ready — we\'ll extract and answer at generation.`; statusEl.classList.remove('hidden'); }
  const reader = new FileReader();
  reader.onload = (e) => {
    state.formImageB64 = e.target.result.split(',')[1];
    state.formImageMediaType = file.type || 'image/jpeg';
  };
  reader.readAsDataURL(file);
}

function proceedFromForm() {
  // Validate — need either pasted text or an image
  if (state.formMethod === 'paste') {
    const text = document.getElementById('formText')?.value?.trim() || '';
    if (text.length < 10) {
      showToast('Please paste your form questions before continuing.');
      return;
    }
  } else {
    if (!state.formImageB64) {
      showToast('Please upload a screenshot of the form before continuing.');
      return;
    }
  }

  const summary = state.formMethod === 'paste' ? 'Questions pasted' : 'Screenshot uploaded';
  setText('step425Summary', summary);
  collapseStep('step425', 'step425Collapsed');
  activateStep('step4');
  updateProgress(4);
}

function switchMethod(type, method) {
  const isCV = type === 'cv';
  if (isCV) state.cvMethod = method;

  const paste    = `${type}PasteArea`;
  const upload   = `${type}UploadArea`;
  const pasteBtn = `${type}PasteBtn`;
  const upBtn    = `${type}UploadBtn`;

  document.getElementById(pasteBtn)?.classList.toggle('active', method === 'paste');
  document.getElementById(upBtn)?.classList.toggle('active', method === 'upload');
  document.getElementById(paste)?.classList.toggle('hidden', method !== 'paste');
  document.getElementById(upload)?.classList.toggle('hidden', method !== 'upload');
}

function handleFile(event, type) {
  const file = event.target.files[0];
  if (!file) return;
  readFile(file, type);
}

function handleDragOver(event, zoneId) {
  event.preventDefault();
  document.getElementById(zoneId)?.classList.add('drag-over');
}
function handleDragLeave(event, zoneId) {
  document.getElementById(zoneId)?.classList.remove('drag-over');
}
function handleDrop(event, type) {
  event.preventDefault();
  const zoneId = `${type}UploadZone`;
  document.getElementById(zoneId)?.classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (file) readFile(file, type);
}

function readFile(file, type) {
  const statusId = `${type}FileStatus`;
  const statusEl = document.getElementById(statusId);

  // For binary formats, extract text server-side
  const isBinary = file.name.toLowerCase().endsWith('.pdf') ||
                   file.name.toLowerCase().endsWith('.docx');

  if (isBinary) {
    if (statusEl) { statusEl.textContent = `Reading ${file.name}…`; statusEl.classList.remove('hidden'); }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const b64 = e.target.result.split(',')[1];
      try {
        const res = await fetch('/api/extract-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, content_b64: b64 }),
        });
        const data = await res.json();
        if (data.error) {
          if (statusEl) statusEl.textContent = `⚠ ${data.error}`;
          showToast(data.error);
          return;
        }
        if (type === 'cv') state.cvText = data.text;
        else               state.jdText = data.text;
        if (statusEl) statusEl.textContent = `✓ ${file.name} — ${data.text.split(/\s+/).length} words extracted`;
      } catch (err) {
        if (statusEl) statusEl.textContent = '⚠ Extraction failed — please paste the text instead.';
        showToast('File extraction failed. Please paste the text directly.');
      }
    };
    reader.readAsDataURL(file);
  } else {
    // Plain text files — read directly
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      if (type === 'cv') state.cvText = text;
      else               state.jdText = text;
      if (statusEl) {
        statusEl.textContent = `✓ ${file.name} loaded`;
        statusEl.classList.remove('hidden');
      }
    };
    reader.readAsText(file);
  }
}

// ── Skip rows ─────────────────────────────────────────────────────────────────
// ── Safe fetch — consistent error handling across all API calls ───────────────
async function safeFetch(url, options) {
  const res = await fetch(url, options);
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`Server error ${res.status} — could not parse response`);
  }
  if (!res.ok) {
    const detail = data?.detail || `Server error ${res.status}`;
    const err = new Error(detail);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return data;
}

// ── STEP 1 ────────────────────────────────────────────────────────────────────
async function completeStep1() {
  const cv = state.cvMethod === 'paste' ? val('cvText') : state.cvText;
  if (!cv || cv.length < 50) {
    showToast('Please add your CV before continuing — paste the text or upload a file.');
    return;
  }
  if (cv.startsWith('%PDF') || cv.includes('endobj') || cv.includes('xref\n')) {
    showToast('This looks like a raw PDF file — please use the upload button instead, or paste the text from your CV.');
    return;
  }
  state.cvText = cv;

  // Extract name from first short alphabetic line
  const lines = cv.split('\n').map(l => l.trim()).filter(l => l.length > 1);
  const nameLine = lines.find(l => l.length < 60 && /^[A-Za-z\s\.\-\']+$/.test(l)) || '';
  setText('step1Summary', nameLine.length > 2 ? `Story of ${nameLine}` : 'Story loaded');

  collapseStep('step1', 'step1Collapsed');
  activateStep('step2');
  updateProgress(2);

  // CV parsing — runs immediately in background, foundation of everything
  // User does not wait — they proceed to Step 2 while this runs
  try {
    const data = await safeFetch('/api/parse-cv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cv_text: cv, jd_text: '' }),
    });
    if (data.parsed_cv) {
      state.parsedCv = data.parsed_cv;
      // Store in brief for downstream prompts
      state.brief.parsed_cv = data.parsed_cv;
      // Update name in collapsed card from parsed CV if available
      const parsedName = data.parsed_cv.candidate_name;
      if (parsedName && parsedName !== 'NONE' && parsedName.length > 2) {
        setText('step1Summary', `Story of ${parsedName}`);
        state.brief.candidate_name = parsedName;
      }
    }
  } catch (e) {
    // CV parsing failure is non-blocking — pipeline continues with raw CV text
    console.warn('CV parsing failed silently:', e.message);
  }
}

// ── STEP 2: Research ──────────────────────────────────────────────────────────
function advanceFlowStage(n) {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`flowStage${i}`);
    if (!el) continue;
    el.classList.toggle('active', i === n);
    el.classList.toggle('done', i < n);
  }
}

async function runResearch() {
  // Get JD text from whichever mode was used
  let jd = '';
  if (state.jdMethod === 'paste') {
    jd = val('jdText');
  } else if (state.jdMethod === 'image') {
    // Use extracted text from preview if user edited it
    const previewText = document.getElementById('jdImageText')?.value?.trim();
    jd = previewText || state.jdText;
  } else if (state.jdMethod === 'upload') {
    const previewText = document.getElementById('jdPdfText')?.value?.trim();
    jd = previewText || state.jdText;
  }

  // Validate JD input
  if (!jd || jd.length < 30) {
    showToast('Please add the job description before continuing.');
    return;
  }
  if (jd.startsWith('%PDF') || jd.includes('endobj')) {
    showToast('This looks like a raw PDF — please use the upload button or paste the text.');
    return;
  }

  state.jdText = jd;
  const manualCompany = val('manualCompany');

  advanceFlowStage(2);
  show('loadingResearch');
  hide('orgRoleConfirm');
  hide('painPointsSection');
  document.getElementById('researchBtn').disabled = true;

  const stageTimer = runStages(researchStages, 'researchStage', 'researchSubstage', 'rs', 6000);

  try {
    const data = await safeFetch('/api/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cv_text: state.cvText, jd_text: jd, manual_company: manualCompany }),
    });

    clearInterval(stageTimer);
    hide('loadingResearch');
    document.getElementById('researchBtn').disabled = false;

    if (data.error === 'company_not_found') {
      advanceFlowStage(1);
      const orgField = document.getElementById('manualCompany');
      if (orgField) {
        orgField.style.borderColor = 'var(--warn)';
        orgField.style.boxShadow = '0 0 0 3px var(--warn-bg)';
        orgField.placeholder = 'Could not detect — enter company name and try again';
        orgField.focus();
      }
      showToast('Company not detected — enter the name above and try again.');
      return;
    }
    if (data.error) {
      advanceFlowStage(1);
      const msg = (data.error.includes('busy') || data.error.includes('rate'))
        ? 'The service is busy — wait 30 seconds and try again.'
        : 'Something went wrong. Check the JD and try again.';
      showToast(msg);
      return;
    }

    state.brief = data.brief || {};
    state.brief.jd_text = jd;

    const company  = state.brief.company || manualCompany || '';
    const jobTitle = state.brief.job_title || '';

    // Advance to confirm stage
    advanceFlowStage(3);

    // Populate confirmation fields — user sees and approves
    const confirmedCompany = document.getElementById('confirmedCompany');
    const confirmedRole    = document.getElementById('confirmedRole');
    if (confirmedCompany) confirmedCompany.value = company;
    if (confirmedRole)    confirmedRole.value    = jobTitle;

    // Show company briefing
    if (data.company_briefing) {
      document.getElementById('briefingBody').innerHTML = md(data.company_briefing);
    }

    // Show confirmation section
    show('orgRoleConfirm');

    // Show pain points
    if (data.pain_points?.length) {
      renderPainPoints(data.pain_points);
      advanceFlowStage(4);
      show('painPointsSection');
    } else {
      showToast('Could not decode pain points — try adding more detail to the JD, or enter the company name and retry.');
    }

    // Update manualCompany field too so it stays in sync
    const orgField = document.getElementById('manualCompany');
    if (orgField && !orgField.value) orgField.value = company;

    setText('step2Summary', `${company || '—'} · ${jobTitle || '—'}`);
    showMomentum('🔍 Decoded', `${company || 'Company'} · ${jobTitle || 'Role'} — here's what they actually need.`, '', 4000);

  } catch (e) {
    clearInterval(stageTimer);
    hide('loadingResearch');
    advanceFlowStage(1);
    document.getElementById('researchBtn').disabled = false;
    showToast('Network error — check your connection and try again.');
  }
}

// Pain points — constraint visualised, Hick's Law
function renderPainPoints(points) {
  const list = document.getElementById('painPointsList');
  list.innerHTML = '';
  state.selectedPainPoints = [];
  updatePainCounter(0);

  points.forEach((p) => {
    // Strip any leading "N. " numbering the backend may have added
    const clean = p.replace(/^\d+\.\s*/, '').replace(/\*\*([^*]+)\*\*/g, '$1').trim();
    if (!clean || clean.length < 10) return;

    const item = document.createElement('div');
    item.className = 'pain-item';
    item.innerHTML = `<span class="pain-item-text">${escHtml(clean)}</span>`;
    item.addEventListener('click', () => togglePainPoint(item, clean));
    list.appendChild(item);
  });
}

function togglePainPoint(item, text) {
  if (item.classList.contains('dimmed')) return;

  if (item.classList.contains('selected')) {
    item.classList.remove('selected');
    state.selectedPainPoints = state.selectedPainPoints.filter(p => p !== text);
    updatePainCounter(state.selectedPainPoints.length);
    updatePainDimming();
    if (state.selectedPainPoints.length < 1) { hide('contextTrigger'); }
  } else {
    if (state.selectedPainPoints.length >= 2) {
      // Constraint violation — shake to communicate (Gulf of Evaluation)
      item.classList.add('shake');
      setTimeout(() => item.classList.remove('shake'), 400);
      return;
    }
    item.classList.add('selected');
    state.selectedPainPoints.push(text);
    updatePainCounter(state.selectedPainPoints.length);
    updatePainDimming();
    if (state.selectedPainPoints.length >= 1) { show('contextTrigger'); }
  }
}

function updatePainCounter(n) {
  const pipA = document.getElementById('pip-a');
  const pipB = document.getElementById('pip-b');
  const text = document.getElementById('painCounterText');
  if (pipA) pipA.classList.toggle('filled', n >= 1);
  if (pipB) pipB.classList.toggle('filled', n >= 2);
  if (text) text.textContent = `${n} of 2 selected`;
}

function updatePainDimming() {
  const full = state.selectedPainPoints.length >= 2;
  document.querySelectorAll('.pain-item').forEach(item => {
    const isSelected = item.classList.contains('selected');
    item.classList.toggle('dimmed', full && !isSelected);
  });
}

function showContext() {
  hide('contextTrigger');
  show('contextArea');
  state.contextVisible = true;
}

async function confirmPainPoints() {
  if (state.selectedPainPoints.length === 0) {
    showToast('Please select at least one pain point before continuing.');
    return;
  }

  const confirmedCompany = val('confirmedCompany');
  const confirmedRole    = val('confirmedRole');
  if (confirmedCompany) state.brief.company   = confirmedCompany;
  if (confirmedRole)    state.brief.job_title = confirmedRole;

  state.brief.selected_pain_points = state.selectedPainPoints;
  state.brief.user_instruction     = val('userInstruction');

  show('loadingQuestions');
  document.getElementById('confirmPainBtn').disabled = true;
  showMomentum('✅ Argument set', 'These are your two. Everything we build will argue you can solve them.', '', 4000);

  // Build brief immediately — Step 2.5 is removed
  // Answers are empty at this stage — bullet Q&A from Step 3.5 flows in later
  const emptyAnswers = { bullet_qa: {}, anything_missed: '', open_field: '' };

  if (state.parsedCv) state.brief.parsed_cv = state.parsedCv;

  show('loadingBrief');
  const stageTimer = runStages(briefStages, 'briefStage', 'briefSubstage', 'bs', 5000);

  try {
    const data = await safeFetch('/api/build-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: state.brief, answers: emptyAnswers }),
    });
    clearInterval(stageTimer);
    hide('loadingBrief');
    hide('loadingQuestions');
    document.getElementById('confirmPainBtn').disabled = false;

    if (data.detail) {
      showToast('Something went wrong building the brief — try again.');
      return;
    }

    state.brief = data.brief || state.brief;
    state.narrativeThread = data.narrative_thread || '';

    if (state.narrativeThread) {
      setText('narrativeThread', state.narrativeThread);
      show('narrativeReveal');
    }
    if (data.gap_analysis) {
      document.getElementById('gapAnalysis').innerHTML = renderGapAnalysis(data.gap_analysis);
    }

    collapseStep('step2', 'step2Collapsed');
    activateStep('step3');
    show('approveBtn');
    updateProgress(3);

  } catch (e) {
    clearInterval(stageTimer);
    hide('loadingBrief');
    hide('loadingQuestions');
    document.getElementById('confirmPainBtn').disabled = false;
    const msg = (e.message.includes('429') || e.message.includes('rate'))
      ? 'The service is busy — wait 30 seconds and try again.'
      : 'Something went wrong building the brief. Try again.';
    showToast(msg);
  }
}

// ── STEP 3 ────────────────────────────────────────────────────────────────────
function renderGapAnalysis(text) {
  if (!text) return '';

  // Try structured parsing first — backend outputs **Matches**, **Gaps**, etc.
  const sectionPatterns = [
    { label: 'Matches',  regex: /\*\*(?:Key )?Matches\*\*[\s\S]*?(?=\*\*|$)/ },
    { label: 'Gaps',     regex: /\*\*(?:Experience )?Gaps\*\*[\s\S]*?(?=\*\*|$)/ },
    { label: 'Angle',    regex: /\*\*(?:Strategic )?Angle\*\*[\s\S]*?(?=\*\*|$)/ },
    { label: 'Evidence', regex: /\*\*Evidence[\s\S]*?\*\*[\s\S]*?(?=\*\*|$)/ },
    { label: 'Advice',   regex: /\*\*(?:Application )?Advice\*\*[\s\S]*?(?=\*\*|$)/ },
  ];

  let parsed = false;
  let html = '';
  for (const { label, regex } of sectionPatterns) {
    const match = text.match(regex);
    if (match) {
      parsed = true;
      const content = match[0].replace(/\*\*[^*]+\*\*/, '').trim();
      if (content) {
        html += `<div class="gap-section">
          <span class="gap-label">${label}</span>
          <div class="gap-content">${md(content)}</div>
        </div>`;
      }
    }
  }

  // Fallback: render as markdown if parsing fails
  return parsed ? html : `<div class="gap-content">${md(text)}</div>`;
}

async function approveBrief() {
  hide('approveBtn');

  showMomentum('✓ Approved', 'Good. Now we sharpen it.', '', 3000);

  // Step 3.5 only needed if research was selected and bullets need enrichment
  const needsStep35 = state.flowNeeds?.step35 !== false;

  if (needsStep35) {
    show('loadingBullets');
    try {
      const data = await safeFetch('/api/diagnose-bullets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: state.brief, bullet_context: '' }),
      });
      hide('loadingBullets');

      if (data.diagnosis) {
        state.bulletDiagnosisRaw = data.diagnosis;
        document.getElementById('bulletDiagnosis').innerHTML = renderBulletDiagnosisCards(data.diagnosis);
        show('bulletDiagnosis');
      }

      collapseStep('step3', 'step3Collapsed');
      activateStep('step35');
      updateProgress(3.5);
    } catch (e) {
      hide('loadingBullets');
      // Non-fatal — proceed to Step 3.5 without diagnosis
      collapseStep('step3', 'step3Collapsed');
      activateStep('step35');
      updateProgress(3.5);
    }
  } else {
    // Skip Step 3.5 — go directly to Step 4 or Step 4.25
    collapseStep('step3', 'step3Collapsed');
    if (state.flowNeeds?.form) {
      activateStep('step425');
      updateProgress(4.25);
    } else {
      activateStep('step4');
      updateProgress(4);
    }
  }
}

// ── Bullet diagnosis cards — clean, professional, no internal labels ──────────
// Parses the structured diagnosis output and renders as cards
// ROLE / BULLET / RELEVANCE / VERDICT / QUESTIONS format
function renderBulletDiagnosisCards(raw) {
  if (!raw) return '';

  const blocks = raw.split('---').map(b => b.trim()).filter(b => b.length > 20);
  let html = `<p class="bullet-diag-eyebrow">Experiences selected for this role</p>`;

  let cardCount = 0;
  blocks.forEach(block => {
    const roleM       = block.match(/ROLE:\s*(.+?)(?=\n|$)/);
    const bulletM     = block.match(/BULLET:\s*(.+?)(?=\nSERVES:|(?=\nRELEVANCE:)|$)/s);
    const relevanceM  = block.match(/RELEVANCE:\s*(.+?)(?=\nVERDICT:|$)/s);
    const verdictM    = block.match(/VERDICT:\s*(\w+)/);
    const questionsM  = block.match(/QUESTIONS:\s*(.+?)(?=\n---|$)/s);

    const role      = roleM      ? roleM[1].trim()      : '';
    const bullet    = bulletM    ? bulletM[1].trim().replace(/\n/g,' ') : '';
    const relevance = relevanceM ? relevanceM[1].trim() : '';
    const verdict   = verdictM   ? verdictM[1].trim()   : '';
    const questions = questionsM ? questionsM[1].trim() : '';

    // Skip the summary line
    if (block.startsWith('SUMMARY:') || (!role && !bullet)) return;

    const needsEnrichment = verdict === 'NEEDS_ENRICHMENT';
    cardCount++;

    // Parse questions into individual fields
    let questionsHtml = '';
    if (needsEnrichment && questions && questions !== 'NONE') {
      const qLines = questions.split('\n').map(l => l.trim())
        .filter(l => l.length > 5 && !l.startsWith('QUESTIONS:'));
      qLines.forEach((q, qi) => {
        const cleanQ = q.replace(/^\d+[\.\)]\s*/, '').replace(/^[-•]\s*/, '');
        if (cleanQ) {
          // Create an inline answer field for each question
          const fieldId = `bulletQ_${cardCount}_${qi}`;
          questionsHtml += `
            <div class="bullet-question">
              <label class="bullet-question-text">${escHtml(cleanQ)}</label>
              <textarea class="textarea bullet-question-answer"
                id="${fieldId}"
                data-bullet="${escHtml(bullet)}"
                data-question="${escHtml(cleanQ)}"
                rows="2"
                placeholder="Your answer…"></textarea>
            </div>`;
        }
      });
    }

    html += `
      <div class="bullet-diag-card">
        ${role ? `<div class="bullet-diag-role">${escHtml(role)}</div>` : ''}
        <div class="bullet-diag-text">${safeText(bullet)}</div>
        ${relevance ? `<div class="bullet-diag-relevance">↳ ${safeText(relevance)}</div>` : ''}
        ${needsEnrichment && questionsHtml ? `
          <div class="bullet-diag-questions">
            <p class="bullet-diag-questions-label">Help us sharpen this</p>
            ${questionsHtml}
          </div>` : ''}
      </div>`;
  });

  if (cardCount === 0) {
    // Fallback — render raw if parsing produced nothing
    return `<div class="bullet-diag-eyebrow">Experiences selected</div>
      <div style="white-space:pre-wrap;font-size:13px;color:var(--text2);line-height:1.6;">${safeText(raw)}</div>`;
  }

  return html;
}

// ── Collect bullet Q&A answers from Step 3.5 ─────────────────────────────────
function collectBulletQA() {
  const qa = {};
  document.querySelectorAll('.bullet-question-answer').forEach(el => {
    const bullet   = el.dataset.bullet;
    const question = el.dataset.question;
    const answer   = el.value.trim();
    if (bullet && question) {
      if (!qa[bullet]) qa[bullet] = {};
      qa[bullet][question] = answer;
    }
  });
  return qa;
}

// ── STEP 3.5 ──────────────────────────────────────────────────────────────────
async function proceedToTexture() {
  const bulletQA      = collectBulletQA();
  const anythingMissed = val('anythingMissed');

  // Store in brief — these travel to generation prompts as candidate voice layer
  if (Object.keys(bulletQA).length > 0) state.brief.bullet_qa = bulletQA;
  if (anythingMissed) state.brief.anything_missed = anythingMissed;

  // If bullet Q&A was provided, enrich the brief with these answers
  // This updates narrative_thread and signals with the candidate's enriched evidence
  const hasAnswers = Object.keys(bulletQA).length > 0 || anythingMissed.length > 3;
  if (hasAnswers && state.flowNeeds?.brief) {
    try {
      const enrichAnswers = { bullet_qa: bulletQA, anything_missed: anythingMissed, open_field: anythingMissed };
      const data = await safeFetch('/api/build-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: state.brief, answers: enrichAnswers }),
      });
      if (data.brief) state.brief = { ...state.brief, ...data.brief };
      if (data.narrative_thread) {
        state.narrativeThread = data.narrative_thread;
        setText('narrativeThread', data.narrative_thread);
      }
    } catch (e) {
      // Non-fatal — continue with existing brief
      console.warn('Brief enrichment failed (non-fatal):', e.message);
    }
  }

  collapseStep('step35', 'step35Collapsed');

  // Route to Step 4.25 (form input) if form answering was selected and flow needs it
  if (state.flowNeeds?.form) {
    activateStep('step425');
    updateProgress(4.25);
  } else {
    activateStep('step4');
    updateProgress(4);
  }
}

// ── STEP 4 ────────────────────────────────────────────────────────────────────

// Referral name syncs to state on input
document.getElementById('referralName')?.addEventListener('input', (e) => {
  state.applicationContext.referral_name = e.target.value.trim();
});

// prefillContextChips no longer needed — company stage and career situation
// are derived from research and CV parsing, not from user chips

async function proceedToChoosePath() {
  state.writingSample = val('writingSample');

  const referralName = val('referralName');
  state.applicationContext = {
    referral_name:    referralName,
    company_stage:    state.brief.derived_company_stage    || '',
    career_situation: state.brief.derived_career_situation || 'growing',
  };
  state.brief.application_context = state.applicationContext;

  // Populate Step 4.5 asset options from Step 0 selection
  populateStep45Assets();

  collapseStep('step4', 'step4Collapsed');
  activateStep('step45');
  updateProgress(4.5);

  const selected = state.selectedAssets.filter(a => a !== 'Answer Application Form');
  if (selected.includes('Cover Letter') || selected.length === 0) {
    await loadRoutingOptions();
  }
}

// Populate Step 4.5 asset checkboxes from Step 0 selection — user can still adjust
function populateStep45Assets() {
  const container = document.getElementById('assetOptions');
  if (!container) return;

  const assetDefs = [
    { value: 'Cover Letter',            icon: '&#9998;', name: 'Cover Letter',            desc: 'Written from your profile for this job.' },
    { value: 'Resume Bullets',          icon: '&#9632;', name: 'Resume Bullets',          desc: 'Your bullets, rewritten to get selected.' },
    { value: 'Interview Prep',          icon: '&#9654;', name: 'Interview Prep',          desc: 'The right questions. Your best answers.' },
    { value: 'Cold Outreach Email',     icon: '&#9993;', name: 'Cold Outreach Email',     desc: 'Email to grab attention of recruiter.' },
    { value: 'Answer Application Form', icon: '&#9634;', name: 'Answer Application Form', desc: 'Personalized answers to application questions.' },
  ];

  container.innerHTML = '';
  assetDefs.forEach(def => {
    const isChecked = state.selectedAssets.includes(def.value);
    const label = document.createElement('label');
    label.className = 'asset-option' + (isChecked ? ' checked' : '');
    label.innerHTML = `
      <input type="checkbox" value="${def.value}"${isChecked ? ' checked' : ''}>
      <div class="asset-option-content">
        <span class="asset-icon">${def.icon}</span>
        <div><span class="asset-name">${def.name}</span><span class="asset-desc">${def.desc}</span></div>
      </div>
      <span class="asset-check">&#10003;</span>`;
    const cb = label.querySelector('input');
    label.addEventListener('click', (e) => {
      if (e.target === cb) return;
      e.preventDefault();
      cb.checked = !cb.checked;
      label.classList.toggle('checked', cb.checked);
    });
    cb.addEventListener('change', () => label.classList.toggle('checked', cb.checked));
    container.appendChild(label);
  });
}

// ── STEP 4.5 ──────────────────────────────────────────────────────────────────
document.querySelectorAll('.asset-option').forEach(label => {
  const cb = label.querySelector('input[type=checkbox]');
  label.addEventListener('click', (e) => {
    if (e.target === cb) return;
    e.preventDefault();
    cb.checked = !cb.checked;
    label.classList.toggle('checked', cb.checked);
  });
  cb.addEventListener('change', () => label.classList.toggle('checked', cb.checked));
});

function getSelectedAssets() {
  return Array.from(document.querySelectorAll('.asset-option input:checked')).map(cb => cb.value);
}

// ── Routing card — visible routing before generation ──────────────────────────
async function loadRoutingOptions() {
  const routingCard = document.getElementById('routingCard');
  const loadingRouting = document.getElementById('loadingRouting');
  if (!routingCard) return;

  show('routingCard');
  show('loadingRouting');

  // Attach context to brief for routing
  const briefWithContext = {
    ...state.brief,
    application_context: state.applicationContext,
  };

  try {
    const data = await safeFetch('/api/routing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: briefWithContext }),
    });
    hide('loadingRouting');

    if (!data.opening_options) return;

    state.routingOptions = data;

    // Pre-select recommended options
    state.routingChoices.opening = data.recommended_opening;
    state.routingChoices.p3 = data.recommended_p3;

    // Render opening options
    renderRoutingOptions(
      'routingOpeningOptions',
      data.opening_options,
      data.recommended_opening,
      (selectedId) => { state.routingChoices.opening = selectedId; }
    );

    // Render P3 options
    renderRoutingOptions(
      'routingP3Options',
      data.p3_options,
      data.recommended_p3,
      (selectedId) => { state.routingChoices.p3 = selectedId; }
    );

  } catch (e) {
    hide('loadingRouting');
    // Routing failure is non-fatal — generation continues with defaults
    console.warn('Routing failed (non-fatal):', e.message);
  }
}

function renderRoutingOptions(containerId, options, selectedId, onSelect) {
  const container = document.getElementById(containerId);
  if (!container || !options) return;
  container.innerHTML = '';

  options.forEach(opt => {
    const el = document.createElement('div');
    el.className = 'routing-option' + (opt.id === selectedId ? ' selected' : '');
    el.innerHTML = `
      <div class="routing-option-content">
        <span class="routing-option-label">${safeText(opt.label)}</span>
        <span class="routing-option-desc">${safeText(opt.description)}</span>
        <span class="routing-option-reason">${safeText(opt.reasoning)}</span>
      </div>`;
    el.addEventListener('click', () => {
      container.querySelectorAll('.routing-option').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
      onSelect(opt.id);
    });
    container.appendChild(el);
  });
}

async function generateAssets() {
  const selected = getSelectedAssets();
  if (selected.length === 0) { showToast('Please select at least one asset.'); return; }

  state.selectedAssets = selected;
  show('loadingGenerate');
  document.getElementById('generateBtn').disabled = true;

  const n = selected.length;
  setText('step45Summary', `${n} asset${n !== 1 ? 's' : ''} built`);

  // Separate form answering from other assets — different endpoint
  const formSelected    = selected.includes('Answer Application Form');
  const regularAssets   = selected.filter(a => a !== 'Answer Application Form');

  const stages = generateStages(regularAssets.length ? regularAssets : selected);
  const stageTimer = runStages(stages, 'generateStage', 'generateSubstage', 'gs', 8000);

  try {
    // Generate regular assets
    if (regularAssets.length > 0) {
      const data = await safeFetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief: state.brief,
          selected_assets: regularAssets,
          writing_sample: state.writingSample,
          application_context: state.applicationContext,
          routing_choices: state.routingChoices,
        }),
      });

      state.results = data.results || {};
      state.evals   = data.evals || {};
      if (data.letter_briefs?.cover_letter) {
        state.letterBrief = data.letter_briefs.cover_letter;
      }
    }

    // Generate form answers if selected
    if (formSelected) {
      try {
        const formPayload = {
          brief:            state.brief,
          writing_sample:   state.writingSample,
          form_text:        state.formMethod === 'paste' ? (document.getElementById('formText')?.value?.trim() || '') : '',
          form_content_b64: state.formMethod === 'image' ? state.formImageB64 : '',
          form_media_type:  state.formMethod === 'image' ? state.formImageMediaType : '',
        };
        const formData = await safeFetch('/api/answer-form', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formPayload),
        });
        state.results['form_answers'] = formData.answers || '';
      } catch (formErr) {
        console.warn('Form answering failed:', formErr.message);
        state.results['form_answers'] = 'Form answering failed — please try again.';
      }
    }

    clearInterval(stageTimer);
    hide('loadingGenerate');
    document.getElementById('generateBtn').disabled = false;

    collapseStep('step45', 'step45Collapsed');
    activateStep('step5');
    updateProgress(5);

    if (state.firstGenerate) {
      state.firstGenerate = false;
      const company = state.brief.company || 'this company';
      setText('momentumRevealText',
        `${n} asset${n !== 1 ? 's' : ''} built from one brief. Each one is specific to ${company} and traceable to the argument you approved.`);
      const rev = document.getElementById('momentumReveal');
      if (rev) { rev.classList.remove('hidden'); rev.classList.add('pulse-once'); }
    }

    buildTabs(selected, state.results, state.evals);
    setTimeout(() => show('endMoment'), 600);

  } catch (e) {
    clearInterval(stageTimer);
    hide('loadingGenerate');
    document.getElementById('generateBtn').disabled = false;
    const isRate = e.message?.includes('429') || e.message?.includes('rate') || e.status === 429;
    showToast(isRate
      ? 'The service is busy — wait 30 seconds and try again.'
      : 'Something went wrong generating assets. Try again.');
  }
}

// ── Dynamic tab builder — Hick's Law: only show generated tabs ─────────────────
const assetConfig = {
  'Cover Letter':           { id: 'coverLetter',   rawId: 'coverRaw',    label: '✏ Cover Letter',  briefDefault: 'Cover letter incoming. It argues from their pain point, not from your title.' },
  'Resume Bullets':         { id: 'resumeBullets', rawId: 'bulletsRaw',  label: '▪ Bullets',        briefDefault: 'Bullets arrive here. Each one rewritten to serve the specific role.' },
  'Cold Outreach Email':    { id: 'email',         rawId: 'emailRaw',    label: '✉ Email',          briefDefault: 'Your email comes here. Three sentences. Their attention earned, not requested.' },
  'Interview Prep':         { id: 'interviewPrep', rawId: 'interviewRaw',label: '▶ Interview',      briefDefault: 'Your interview prep lands here. Specific to this role, this company, and the argument you made.' },
  'Answer Application Form':{ id: 'formAnswers',   rawId: 'formRaw',     label: '☐ Form Answers',   briefDefault: 'Your form answers land here — every field answered from your CV and brief.' },
};

function buildTabs(selected, results, evals) {
  const tabsRow   = document.getElementById('tabsRow');
  const tabPanels = document.getElementById('tabPanels');
  tabsRow.innerHTML = '';
  tabPanels.innerHTML = '';

  selected.forEach((asset, i) => {
    const cfg = assetConfig[asset];
    if (!cfg) return;
    const key = asset === 'Cover Letter'            ? 'cover_letter'
               : asset === 'Resume Bullets'         ? 'resume_bullets'
               : asset === 'Cold Outreach Email'    ? 'email'
               : asset === 'Answer Application Form'? 'form_answers'
               : 'interview_prep';

    const rawText = results[key] || '';
    const evalData = evals[key] || evals[cfg.id] || {};

    // Tab button
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (i === 0 ? ' active' : '');
    btn.textContent = cfg.label;
    btn.dataset.tab = cfg.id;
    btn.addEventListener('click', () => switchTab(cfg.id));
    tabsRow.appendChild(btn);

    // Tab panel
    const panel = document.createElement('div');
    panel.className = 'tab-panel' + (i === 0 ? ' active' : '');
    panel.id = `tab-${cfg.id}`;
    panel.innerHTML = buildPanelHTML(asset, cfg, rawText, evalData);
    tabPanels.appendChild(panel);

    // Store raw text
    const rawEl = document.getElementById(cfg.rawId);
    if (rawEl) rawEl.value = rawText;
  });
}

function buildPanelHTML(asset, cfg, rawText, evalData) {
  // Brief card — only for cover letter, only when letterBrief exists
  // This is the black box transparency: shows every decision we made
  let briefCard = '';
  if (asset === 'Cover Letter' && state.letterBrief) {
    const lb = state.letterBrief;
    const situationLabels = {
      growing:    'Growing in your field',
      pivot:      'Industry pivot',
      level_jump: 'Stepping up',
      gap:        'Returning after a break',
    };
    const stageLabels = {
      early_startup: 'Early startup',
      growth:        'Growth stage',
      large:         'Large company',
      mnc:           'MNC / Global',
    };

    const rows = [
      { icon: '↗', label: 'Opening', value: lb.opening_label || '—' },
      { icon: '⬥', label: 'Evidence used', value: lb.opening_evidence ? (lb.opening_evidence.length > 90 ? lb.opening_evidence.slice(0,90)+'…' : lb.opening_evidence) : '—' },
      { icon: '⟳', label: 'Argument', value: lb.argument ? (lb.argument.length > 100 ? lb.argument.slice(0,100)+'…' : lb.argument) : '—' },
      { icon: '◎', label: 'Company connection', value: lb.p3_label || '—' },
      lb.gap_handled ? { icon: '△', label: 'Gap handled', value: lb.gap_handled.length > 80 ? lb.gap_handled.slice(0,80)+'…' : lb.gap_handled } : null,
      lb.career_situation ? { icon: '→', label: 'Situation', value: situationLabels[lb.career_situation] || lb.career_situation } : null,
      lb.company_stage ? { icon: '◈', label: 'Company register', value: stageLabels[lb.company_stage] || lb.company_stage } : null,
      { icon: '#', label: 'Word count', value: `${lb.word_count || '—'} words` },
    ].filter(Boolean);

    const rowsHtml = rows.map(r =>
      `<div class="brief-card-row">
        <span class="brief-card-icon">${r.icon}</span>
        <span class="brief-card-label">${r.label}</span>
        <span class="brief-card-value">${safeText(r.value)}</span>
      </div>`
    ).join('');

    briefCard = `<div class="brief-card" id="briefCard-${cfg.id}">
      <div class="brief-card-header">
        <span class="brief-card-title">Why it's written this way</span>
        <button class="brief-card-toggle" onclick="toggleBriefCard('briefCardBody-${cfg.id}',this)" aria-label="Toggle">▾</button>
      </div>
      <div class="brief-card-body" id="briefCardBody-${cfg.id}">
        ${rowsHtml}
        <p class="brief-card-footer">Every decision above came from the brief you approved. Disagree with one? Use the refinement chips below.</p>
      </div>
    </div>`;
  }

  const headerNote = rawText
    ? buildBriefNote(asset, rawText)
    : `<div class="output-brief">${cfg.briefDefault}</div>`;

  let outputHtml = '';
  if (rawText) {
    if (asset === 'Cover Letter') outputHtml = renderCoverLetter(rawText, evalData, cfg.id);
    else if (asset === 'Resume Bullets') outputHtml = renderBulletsHTML(rawText);
    else if (asset === 'Cold Outreach Email') outputHtml = renderEmailHTML(rawText, evalData);
    else if (asset === 'Interview Prep') outputHtml = renderInterviewHTML(rawText, evalData);
    else if (asset === 'Answer Application Form') outputHtml = renderFormAnswersHTML(rawText);
  }

  const chips   = getChips(asset, cfg);
  const copyBtn = `<button class="btn-ghost" onclick="copyAsset('${cfg.rawId}')">Copy</button>`;
  const dlBtn   = (asset === 'Cover Letter')
    ? `<button class="btn-ghost" onclick="downloadPDF('${cfg.rawId}')">Download PDF</button>`
    : '';

  const rawField = `<textarea id="${cfg.rawId}" style="display:none">${escHtml(rawText)}</textarea>`;

  let extraNote = '';

  // Rethink opening — only for cover letter, only if routing options exist
  let rethinkSection = '';
  if (asset === 'Cover Letter' && state.routingOptions?.opening_options?.length > 1) {
    const otherOptions = state.routingOptions.opening_options
      .filter(o => o.id !== state.routingChoices.opening)
      .map(o => `<button class="routing-option" style="margin-bottom:6px;" onclick="rethinkOpening('${o.id}','${cfg.rawId}','${cfg.id}')">
        <div class="routing-option-content">
          <span class="routing-option-label">Try: ${safeText(o.label)}</span>
          <span class="routing-option-desc">${safeText(o.best_when)}</span>
        </div>
      </button>`).join('');

    if (otherOptions) {
      rethinkSection = `
        <div class="rethink-section">
          <span class="rethink-label">&#8635; Try a different opening</span>
          <p style="font-size:12px;color:var(--text3);margin-bottom:10px;font-family:var(--font-ui);">P2, P3, and P4 are preserved — only the opening changes.</p>
          <div class="rethink-options">${otherOptions}</div>
        </div>`;
    }
  }

  return `
    ${briefCard}
    ${headerNote}
    <div class="output-doc" id="outputDoc-${cfg.id}">${outputHtml}</div>
    ${rawField}
    <div class="copy-row">${copyBtn}${dlBtn}</div>
    ${extraNote}
    ${rethinkSection}
    <div class="refine-section">
      <p class="refine-label">Refine:</p>
      <div class="chip-row" id="chips-${cfg.id}">${chips}</div>
      <div class="diagnosis-display hidden" id="diagDisplay-${cfg.id}"></div>
      <div class="refinement-note hidden" id="refineNote-${cfg.id}"></div>
      <textarea class="textarea" id="feedback-${cfg.id}" rows="2" placeholder="Or describe what to change…"></textarea>
      <button class="btn-secondary" style="margin-top:8px;" onclick="refineAsset('${asset}','${cfg.id}','${cfg.rawId}')">&#8635; Refine</button>
    </div>`;
}

function toggleBriefCard(bodyId, btn) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  const collapsed = body.style.display === 'none';
  body.style.display = collapsed ? '' : 'none';
  btn.textContent = collapsed ? '▾' : '▸';
}

function buildBriefNote(asset, rawText) {
  const nt = state.brief.narrative_thread || '';
  if (asset === 'Cover Letter' && nt) {
    const short = nt.length > 110 ? nt.slice(0, 110) + '…' : nt;
    return `<div class="output-brief">Argument: <em>${escHtml(short)}</em></div>`;
  }
  if (asset === 'Cold Outreach Email') return `<div class="output-brief">Cold Outreach · ${rawText.length} chars</div>`;
  return `<div class="output-brief">${asset} generated.</div>`;
}

// ── Feedback chip setter ──────────────────────────────────────────────────────
function setFeedback(fieldId, text) {
  const el = document.getElementById(fieldId);
  if (el) { el.value = text; el.focus(); }
}

// Set paragraph focus for targeted cover letter refinement
// Called when user taps P1/P2/P3/P4 label button
function setRefineFocus(paragraph, tabId) {
  state.refineParagraphFocus = paragraph;

  // Visual: highlight the selected paragraph label
  document.querySelectorAll('.para-label-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.para === paragraph);
  });

  // Pre-populate the feedback field with paragraph-specific chip prompt
  const paragraphHints = {
    'P1': `P1 doesn't hook me`,
    'P2': `P2 reads as a list`,
    'P3': `P3 feels like flattery`,
    'P4': `Close is too hopeful`,
  };
  const feedbackEl = document.getElementById(`feedback-${tabId}`);
  if (feedbackEl && !feedbackEl.value) {
    feedbackEl.placeholder = `What do you want to change about ${paragraph}?`;
  }

  showToast(`Focused on ${paragraph} — describe what you want to change`);
}

function getChips(asset, cfg) {
  const map = {
    // Cover letter chips are structural — each names a specific paragraph
    // so the diagnosis model knows exactly where to look
    'Cover Letter': [
      ['P1 doesn\'t hook me',    'The opening paragraph doesn\'t make me want to keep reading — the result isn\'t specific enough or the mechanism isn\'t interesting'],
      ['P2 reads as a list',     'Paragraph 2 lists accomplishments instead of telling one specific story — find the single moment and build around that'],
      ['P3 feels like flattery', 'Paragraph 3 sounds like I\'m telling them about their own company — rewrite it from my perspective, why I specifically want this'],
      ['Close is too hopeful',   'The closing paragraph sounds like a request not a statement — rewrite so it assumes the conversation is happening'],
      ['Not my voice',           'The language is too formal and polished — write it the way I actually talk, shorter sentences, less impressive-sounding'],
    ],
    'Resume Bullets': [
      ['Too vague',      'The metrics feel generic — make them more specific with actual numbers and context'],
      ['Too long',       'These bullets are too long — trim each one to one strong XYZ sentence'],
      ['Missing impact', 'The results aren\'t clear — end each bullet with a specific measurable outcome'],
    ],
    'Cold Outreach Email': [
      ['Weak subject', 'The subject line is too generic — make it specific to this company or person'],
      ['Too long',     'The body exceeds 300 characters — cut to the sharpest three sentences'],
      ['Vague ask',    'The call to action is too soft — add a specific time window for a call'],
    ],
    'Interview Prep': [
      ['More technical', 'Add more questions that probe the technical requirements of this role'],
      ['Richer stories', 'The story bank needs more specific situation details — add the context'],
      ['Honest gaps',    'Be Ready For is too gentle — name the real gaps more directly'],
    ],

  };
  const pairs = map[asset] || [];
  return pairs.map(([label, fb]) =>
    `<button class="chip" onclick="setFeedback('feedback-${cfg.id}','${escHtml(fb)}')">${label}</button>`
  ).join('');
}

// ── Renderers ─────────────────────────────────────────────────────────────────
function renderCoverLetter(text, evalData, tabId) {
  const words = text.split(/\s+/).length;
  const color = (words >= 180 && words <= 280) ? 'var(--ok)' : 'var(--warn)';
  const note  = words < 180 ? `${words} words · below target` : words > 280 ? `${words} words · above target` : `${words} words`;

  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());

  const paraLabels = [
    { label: 'P1', note: 'Evidence — earns the read' },
    { label: 'P2', note: 'Proof — one specific moment' },
    { label: 'P3', note: 'Connection — your direction outward' },
    { label: 'P4', note: 'Close — assumes the conversation' },
  ];

  const paraHtml = paragraphs.map((p, i) => {
    const d = document.createElement('div');
    d.textContent = p.trim();
    const labelInfo = paraLabels[i];
    const labelHtml = labelInfo
      ? `<div class="para-label-row">
           <button class="para-label-btn" data-para="${labelInfo.label}"
             onclick="setRefineFocus('${labelInfo.label}','${tabId || 'coverLetter'}')"
             title="Click to focus refinement on ${labelInfo.label}">
             ${labelInfo.label}
           </button>
           <span class="para-label-note">${labelInfo.note}</span>
         </div>`
      : '';
    return `<div class="para-block">
      ${labelHtml}
      <p class="para-text">${d.innerHTML}</p>
    </div>`;
  }).join('');

  return `<div class="cl-header-row">
    <span class="cl-header-label">Cover Letter</span>
    <span class="cl-word-count" style="color:${color};">${note}</span>
  </div>${paraHtml}${buildEvalBlock(evalData)}`;
}

function renderBulletsHTML(raw) {
  if (!raw) return '<p style="color:var(--text3);">Bullets generating…</p>';
  if (raw.startsWith('ERROR:') || raw.startsWith('Could not')) {
    return `<div class="bullet-error">${safeText(raw)}</div>`;
  }

  const parsed = parseBullets(raw);
  let html = '';

  if (parsed.summary) {
    html += `<p class="bullets-summary">${safeText(parsed.summary)}</p>`;
  }

  // Every bullet shown as rewritten — prominent, copy-ready
  // Original below in muted text, one line explaining the argument it makes
  parsed.rewritten.forEach(b => {
    html += `<div class="bullet-card">
      <div class="bullet-rewritten">${safeText(b.rewritten)}</div>
      ${b.proves ? `<div class="bullet-argues">↳ ${safeText(b.proves)}</div>` : ''}
      <div class="bullet-original-row">
        <span class="bullet-original-label">Original</span>
        <span class="bullet-original-text">${safeText(b.original)}</span>
      </div>
    </div>`;
  });

  return html || `<div style="white-space:pre-wrap;color:var(--text);font-size:13.5px;line-height:1.7;">${safeText(raw)}</div>`;
}

function renderEmailHTML(text, evalData) {
  const lines = text.split('\n');
  let subject = '', bodyLines = [];
  lines.forEach(l => {
    if (l.toLowerCase().startsWith('subject:')) subject = l.split(':').slice(1).join(':').trim();
    else bodyLines.push(l);
  });
  const body = bodyLines.join('\n').trim();
  const chars = body.length;
  const color = chars <= 300 ? 'var(--ok)' : 'var(--warn)';
  const subjectHtml = subject
    ? `<div class="email-subject"><span class="email-subject-label">Subject</span><span class="email-subject-text">${safeText(subject)}</span></div>`
    : '';
  const bodyParas = body.split(/\n\n+/).filter(p => p.trim()).map(p => {
    const d = document.createElement('div');
    d.textContent = p.trim();
    return `<p style="margin:0 0 1em;line-height:1.7;color:var(--text);">${d.innerHTML}</p>`;
  }).join('');
  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;padding-bottom:.75rem;border-bottom:1px solid var(--divider);">
    <span style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text4);">Cold Outreach</span>
    <span style="font-size:11px;color:${color};">${chars} chars</span>
  </div>${subjectHtml}${bodyParas}${buildEvalBlock(evalData)}`;
}

function renderInterviewHTML(text, evalData) {
  if (!text) return '<p style="color:var(--text3);">Interview prep generating…</p>';

  // Split on the section headers using the ━ divider pattern
  const sectionPattern = /━{10,}\n(.*?)\n━{10,}/g;
  let sections = [];
  let lastIndex = 0;
  let match;

  while ((match = sectionPattern.exec(text)) !== null) {
    if (lastIndex > 0 && sections.length > 0) {
      sections[sections.length - 1].body = text.slice(lastIndex, match.index).trim();
    }
    sections.push({ title: match[1].trim(), body: '', start: match.index + match[0].length });
    lastIndex = match.index + match[0].length;
  }
  if (sections.length > 0) {
    sections[sections.length - 1].body = text.slice(lastIndex).trim();
  }

  // Fallback — if no section dividers found, use ** headers
  if (sections.length === 0) {
    const parts = text.split(/\*\*(.+?)\*\*/g);
    for (let i = 1; i < parts.length; i += 2) {
      sections.push({ title: parts[i].trim(), body: (parts[i+1] || '').trim() });
    }
  }

  let html = '';

  sections.forEach(section => {
    const title = section.title.replace(/^SECTION \d+ — /, '');
    html += `<div class="interview-section">
      <h3 class="interview-section-title">${escHtml(title)}</h3>
      <div class="interview-section-body">`;

    const body = section.body;

    // Q&A section — parse Q: / WHAT THEY ARE ACTUALLY EVALUATING: / HOW TO THINK: / YOUR STRONGEST EVIDENCE: / WHAT TO AVOID:
    if (title.includes('LIKELY QUESTIONS') || title.includes('Likely Questions') || title.includes('Questions')) {
      // Split on Q: markers
      const qBlocks = body.split(/(?=^Q:)/m).filter(b => b.trim());
      qBlocks.forEach(block => {
        const qM    = block.match(/^Q:\s*(.+?)(?=\n|$)/);
        const evalM = block.match(/WHAT THEY ARE ACTUALLY EVALUATING:\s*(.+?)(?=\nHOW TO|$)/s);
        const howM  = block.match(/HOW TO THINK[^:]*:\s*(.+?)(?=\nYOUR STRONGEST|$)/s);
        const evM   = block.match(/YOUR STRONGEST EVIDENCE[^:]*:\s*(.+?)(?=\nWHAT TO AVOID|$)/s);
        const avM   = block.match(/WHAT TO AVOID:\s*(.+?)(?=\n\n|$)/s);

        if (!qM) return;

        html += `<div class="interview-qa">
          <div class="interview-q">
            <span class="interview-q-label">Q</span>
            <span>${safeText(qM[1].trim())}</span>
          </div>`;

        if (evalM) html += `<div class="interview-field">
          <span class="interview-field-label">What they're evaluating</span>
          <span class="interview-field-value">${safeText(evalM[1].trim())}</span>
        </div>`;

        if (howM) html += `<div class="interview-field">
          <span class="interview-field-label">How to think about it</span>
          <span class="interview-field-value">${safeText(howM[1].trim())}</span>
        </div>`;

        if (evM) html += `<div class="interview-field interview-field-evidence">
          <span class="interview-field-label">Your evidence</span>
          <span class="interview-field-value">${safeText(evM[1].trim())}</span>
        </div>`;

        if (avM) html += `<div class="interview-field interview-field-avoid">
          <span class="interview-field-label">What to avoid</span>
          <span class="interview-field-value">${safeText(avM[1].trim())}</span>
        </div>`;

        html += `</div>`;
      });

    } else if (title.includes('HARD QUESTIONS') || title.includes('Hard Questions')) {
      const qBlocks = body.split(/(?=THE QUESTION:)/m).filter(b => b.trim());
      qBlocks.forEach(block => {
        const qM   = block.match(/THE QUESTION:\s*(.+?)(?=\nWHY IT IS|$)/s);
        const whyM = block.match(/WHY IT IS HARD:\s*(.+?)(?=\nHOW TO|$)/s);
        const howM = block.match(/HOW TO HANDLE IT:\s*(.+?)(?=\nWHAT NOT|$)/s);
        const notM = block.match(/WHAT NOT TO SAY:\s*(.+?)(?=\n\n|$)/s);

        if (!qM) return;

        html += `<div class="interview-qa interview-qa-hard">
          <div class="interview-q">
            <span class="interview-q-label hard">!</span>
            <span>${safeText(qM[1].trim())}</span>
          </div>`;

        if (whyM) html += `<div class="interview-field interview-field-avoid">
          <span class="interview-field-label">Why it's hard</span>
          <span class="interview-field-value">${safeText(whyM[1].trim())}</span>
        </div>`;

        if (howM) html += `<div class="interview-field interview-field-evidence">
          <span class="interview-field-label">How to handle it</span>
          <span class="interview-field-value">${safeText(howM[1].trim())}</span>
        </div>`;

        if (notM) html += `<div class="interview-field">
          <span class="interview-field-label">What not to say</span>
          <span class="interview-field-value">${safeText(notM[1].trim())}</span>
        </div>`;

        html += `</div>`;
      });

    } else if (title.includes('QUESTIONS TO ASK') || title.includes('Questions to Ask')) {
      const qBlocks = body.split(/(?=^Q:)/m).filter(b => b.trim());
      qBlocks.forEach(block => {
        const qM   = block.match(/^Q:\s*(.+?)(?=\nWHY|$)/s);
        const whyM = block.match(/WHY THIS WORKS:\s*(.+?)(?=\n\n|$)/s);
        if (!qM) return;
        html += `<div class="interview-qa">
          <div class="interview-q">
            <span class="interview-q-label ask">?</span>
            <span>${safeText(qM[1].trim())}</span>
          </div>
          ${whyM ? `<div class="interview-field">
            <span class="interview-field-label">Why this works</span>
            <span class="interview-field-value">${safeText(whyM[1].trim())}</span>
          </div>` : ''}
        </div>`;
      });

    } else {
      // Generic section — render as readable paragraphs
      const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
      lines.forEach(line => {
        if (line.startsWith('THE POINT:') || line.startsWith('EVIDENCE:') || line.startsWith('NATURAL MOMENT:')) {
          const [label, ...rest] = line.split(':');
          html += `<div class="interview-field">
            <span class="interview-field-label">${escHtml(label)}</span>
            <span class="interview-field-value">${safeText(rest.join(':').trim())}</span>
          </div>`;
        } else if (line.startsWith('- ') || line.startsWith('• ')) {
          html += `<div class="interview-bullet">${safeText(line.slice(2))}</div>`;
        } else if (line.startsWith('"') || line.startsWith('"')) {
          html += `<blockquote class="interview-quote">${safeText(line)}</blockquote>`;
        } else {
          html += `<p class="interview-para">${safeText(line)}</p>`;
        }
      });
    }

    html += `</div></div>`;
  });

  return (html || `<div style="white-space:pre-wrap;color:var(--text);font-size:13.5px;line-height:1.7;">${safeText(text)}</div>`)
    + buildEvalBlock(evalData);
}

function renderStoryCard(card) {
  const rows = card.rows.map(r => {
    const [label, ...rest] = r.split(':');
    return `<div class="story-card-row"><span>${safeText(label)}:</span> ${safeText(rest.join(':').trim())}</div>`;
  }).join('');
  return `<div class="story-card"><div class="story-card-title">${safeText(card.title)}</div>${rows}</div>`;
}

// ── Form answers renderer ──────────────────────────────────────────────────────
function renderFormAnswersHTML(raw) {
  if (!raw) return '';

  // Parse FIELD: / ANSWER: / --- blocks
  const blocks = raw.split(/^---$/m).map(b => b.trim()).filter(b => b.length > 5);

  if (blocks.length === 0) {
    // Fallback — render raw
    return `<div style="white-space:pre-wrap;font-size:13.5px;color:var(--text);line-height:1.7;">${safeText(raw)}</div>`;
  }

  let html = `<div class="form-answers-list">`;
  blocks.forEach(block => {
    const fieldM  = block.match(/^FIELD:\s*(.+?)(?=\nANSWER:|$)/s);
    const answerM = block.match(/^ANSWER:\s*([\s\S]+?)$/s);

    if (!fieldM) return;

    const field  = fieldM[1].trim();
    const answer = answerM ? answerM[1].trim() : '';

    html += `<div class="form-answer-card">
      <div class="form-answer-field">${escHtml(field)}</div>
      <div class="form-answer-text">${safeText(answer)}</div>
    </div>`;
  });
  html += `</div>`;
  return html;
}


function buildEvalBlock(evalData) {
  if (!evalData || (!evalData.specificity_score && !evalData.alignment_score)) return '';
  const pill = (label, score) => {
    if (!score) return '';
    const cls = score >= 7 ? 'good' : score >= 5 ? 'mid' : 'low';
    return `<span class="eval-pill ${cls}">${label} ${score}/10</span>`;
  };
  return `<div class="eval-block">
    <div class="eval-scores">${pill('Specificity', evalData.specificity_score)}${pill('Alignment', evalData.alignment_score)}</div>
    ${evalData.one_line_verdict ? `<p class="eval-verdict">${escHtml(evalData.one_line_verdict)}</p>` : ''}
    ${evalData.suggested_refinement && !['NONE NEEDED','NONE'].includes(evalData.suggested_refinement)
      ? `<p class="eval-suggestion">↳ ${escHtml(evalData.suggested_refinement)}</p>` : ''}
  </div>`;
}

// ── Bullet parser — matches backend format: ORIGINAL/REWRITTEN/ARGUES/---/SUMMARY ──
function parseBullets(raw) {
  if (!raw) return { rewritten: [], summary: '' };

  const result = { rewritten: [], summary: '' };

  // Extract summary line (appears after all bullet blocks)
  const sm = raw.match(/^SUMMARY:\s*(.+)$/m);
  if (sm) result.summary = sm[1].trim();

  // Split into blocks on --- separator, filter empty
  const blocks = raw.split(/^---$/m).map(b => b.trim()).filter(Boolean);

  blocks.forEach(block => {
    // Skip the summary line if it ended up in its own block
    if (block.startsWith('SUMMARY:')) return;

    const origM = block.match(/^ORIGINAL:\s*([\s\S]+?)(?=^REWRITTEN:|$)/m);
    const rewM  = block.match(/^REWRITTEN:\s*([\s\S]+?)(?=^ARGUES:|$)/m);
    const argM  = block.match(/^ARGUES:\s*([\s\S]+?)$/m);

    if (!origM || !rewM) return;

    result.rewritten.push({
      original:  origM[1].trim(),
      rewritten: rewM[1].trim(),
      proves:    argM ? argM[1].trim() : '',
    });
  });

  return result;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${tabId}`);
    p.classList.toggle('hidden', p.id !== `tab-${tabId}`);
  });
}

// ── Copy — Gulf of Evaluation: toast visible 3s ───────────────────────────────
function copyAsset(rawId) {
  const el = document.getElementById(rawId);
  if (!el || !el.value) return;
  navigator.clipboard.writeText(el.value).then(() => {
    showToast('Copied to clipboard ✓');
  }).catch(() => {
    showToast('Copy failed — try selecting the text manually');
  });
}

// ── Download — proper PDF via backend ─────────────────────────────────────────
async function downloadPDF(rawId) {
  const el = document.getElementById(rawId);
  if (!el || !el.value) { showToast('Nothing to download yet.'); return; }

  const btn = event.target;
  const orig = btn.textContent;
  btn.textContent = 'Preparing…';
  btn.disabled = true;

  try {
    const res = await fetch('/api/download/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: el.value,
        candidate_name: state.brief.candidate_name || '',
        company: state.brief.company || '',
        asset_type: 'cover_letter',
      }),
    });

    if (!res.ok) throw new Error('Download failed');

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const company = (state.brief.company || 'application').replace(/\s+/g, '_').toLowerCase();
    a.href = url;
    a.download = `cover_letter_${company}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Downloaded ✓');

  } catch (e) {
    showToast('Download failed — try copying the text instead.');
  } finally {
    btn.textContent = orig;
    btn.disabled = false;
  }
}

// ── Refine — diagnostic-first, surgical, transparent ─────────────────────────
async function refineAsset(asset, tabId, rawId) {
  const feedbackId  = `feedback-${tabId}`;
  const feedback    = val(feedbackId);
  const currentText = document.getElementById(rawId)?.value;

  if (!currentText) { showToast('Nothing to refine yet.'); return; }
  if (!feedback)    { showToast('Describe what you want changed first.'); return; }

  const docEl    = document.getElementById(`outputDoc-${tabId}`);
  const diagEl   = document.getElementById(`diagDisplay-${tabId}`);
  const noteEl   = document.getElementById(`refineNote-${tabId}`);
  const refineBtn = event.target;

  // Immediate visual feedback — output dims
  if (docEl) docEl.classList.add('refining');
  refineBtn.disabled = true;
  refineBtn.textContent = 'Diagnosing…';

  // Show diagnosis loading state
  if (diagEl) {
    diagEl.innerHTML = `<div class="diag-loading">Reading the letter to find exactly what to change…</div>`;
    diagEl.classList.remove('hidden');
  }

  try {
    const data = await safeFetch('/api/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        current_text:    currentText,
        feedback,
        output_type:     asset,
        brief:           state.brief,
        writing_sample:  state.writingSample,
        letter_brief:    (asset === 'Cover Letter' ? state.letterBrief : null) || {},
        paragraph_focus: state.refineParagraphFocus || '',
      }),
    });

    refineBtn.disabled = false;
    refineBtn.textContent = '↺ Refine';
    if (docEl) docEl.classList.remove('refining');

    // Show diagnosis — what was found, what changed
    if (diagEl && data.diagnosis) {
      const d = data.diagnosis;
      diagEl.innerHTML = `
        <div class="diag-block">
          <div class="diag-row">
            <span class="diag-icon">⌖</span>
            <span class="diag-label">Found</span>
            <span class="diag-value">${safeText(d.target || '—')}</span>
          </div>
          <div class="diag-row">
            <span class="diag-icon">◈</span>
            <span class="diag-label">Issue</span>
            <span class="diag-value">${safeText(d.issue || '—')}</span>
          </div>
          <div class="diag-row diag-fix-row">
            <span class="diag-icon">✓</span>
            <span class="diag-label">Changed</span>
            <span class="diag-value">${safeText(d.fix || '—')}</span>
          </div>
          ${d.preserve ? `<div class="diag-row diag-preserve-row">
            <span class="diag-icon">⬡</span>
            <span class="diag-label">Preserved</span>
            <span class="diag-value">${safeText(d.preserve)}</span>
          </div>` : ''}
        </div>`;
      diagEl.classList.remove('hidden');
    }

    if (data.refined) {
      document.getElementById(rawId).value = data.refined;

      // Update letter brief if returned
      if (data.letter_brief && asset === 'Cover Letter') {
        state.letterBrief = data.letter_brief;
        // Update brief card word count live
        const wcEl = document.querySelector('.cl-word-count');
        if (wcEl) wcEl.textContent = `${data.letter_brief.word_count || ''} words`;
      }

      // Show eval scores
      if (noteEl && data.evals) {
        const spec  = data.evals.specificity_score;
        const align = data.evals.alignment_score;
        const parts = [];
        if (spec)  parts.push(`Specificity ${spec}/10`);
        if (align) parts.push(`Alignment ${align}/10`);
        if (parts.length) {
          noteEl.textContent = `Refined. ${parts.join(' · ')}`;
          noteEl.classList.remove('hidden');
        }
      }

      // Re-render the output
      let newHtml = '';
      if (asset === 'Cover Letter') newHtml = renderCoverLetter(data.refined, data.evals || {}, tabId);
      else if (asset === 'Resume Bullets') newHtml = renderBulletsHTML(data.refined);
      else if (asset === 'Cold Outreach Email') newHtml = renderEmailHTML(data.refined, data.evals || {});
      else if (asset === 'Interview Prep') newHtml = renderInterviewHTML(data.refined, data.evals || {});


      if (docEl && newHtml) docEl.innerHTML = newHtml;

      // Clear feedback field
      const fbEl = document.getElementById(feedbackId);
      if (fbEl) fbEl.value = '';

      showToast('Done ✓');
    }

  } catch (e) {
    refineBtn.disabled = false;
    refineBtn.textContent = '↺ Refine';
    if (docEl) docEl.classList.remove('refining');
    if (diagEl) diagEl.classList.add('hidden');
    const msg = e.message.includes('rate') || e.message.includes('429')
      ? 'Busy — wait 30 seconds and try again.'
      : 'Refinement failed — try again.';
    showToast(msg);
  }
}

// ── Rethink opening — targeted P1 regeneration, P2/P3/P4 preserved ────────────
async function rethinkOpening(newApproachId, rawId, tabId) {
  const currentLetter = document.getElementById(rawId)?.value;
  if (!currentLetter) return;

  const docEl = document.getElementById(`outputDoc-${tabId}`);
  if (docEl) docEl.classList.add('refining');

  showToast('Rewriting the opening…');

  try {
    const data = await safeFetch('/api/rethink-opening', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        current_letter:       currentLetter,
        new_opening_approach: newApproachId,
        brief:                state.brief,
        writing_sample:       state.writingSample,
      }),
    });

    if (docEl) docEl.classList.remove('refining');

    if (data.letter) {
      document.getElementById(rawId).value = data.letter;
      state.routingChoices.opening = newApproachId;

      // Re-render the cover letter
      if (docEl) {
        docEl.innerHTML = renderCoverLetter(data.letter, {}, tabId);
      }

      showToast('Opening updated — P2, P3, P4 unchanged ✓');

      // Update rethink options to reflect new current approach
      if (state.routingOptions) {
        const cfg = assetConfig['Cover Letter'];
        // Rebuild rethink section with updated selected approach
        const panel = document.getElementById(`tab-${tabId}`);
        if (panel) {
          const rethinkEl = panel.querySelector('.rethink-section');
          if (rethinkEl) {
            const otherOptions = state.routingOptions.opening_options
              .filter(o => o.id !== newApproachId)
              .map(o => `<button class="routing-option" style="margin-bottom:6px;" onclick="rethinkOpening('${o.id}','${rawId}','${tabId}')">
                <div class="routing-option-content">
                  <span class="routing-option-label">Try: ${safeText(o.label)}</span>
                  <span class="routing-option-desc">${safeText(o.best_when)}</span>
                </div>
              </button>`).join('');
            rethinkEl.querySelector('.rethink-options').innerHTML = otherOptions;
          }
        }
      }
    }
  } catch (e) {
    if (docEl) docEl.classList.remove('refining');
    showToast('Could not rewrite opening — try again.');
  }
}
function resetAll() {
  if (!confirm('Start a new application? This will clear everything.')) return;
  location.reload();
}

// ── Rating system ─────────────────────────────────────────────────────────────
function showRating() {
  hide('doneSection');
  show('ratingSection');

  // Build rating UI for each generated asset
  const assetRatingsEl = document.getElementById('assetRatings');
  if (!assetRatingsEl) return;

  const assetLabels = {
    'cover_letter':    '✏ Cover Letter',
    'resume_bullets':  '▪ Resume Bullets',
    'email':           '✉ Cold Email',
    'interview_prep':  '▶ Interview Prep',

  };

  let html = '';
  Object.keys(state.results || {}).forEach(key => {
    const label = assetLabels[key];
    if (!label) return;
    html += `
      <div class="asset-rating-row">
        <span class="asset-rating-label">${label}</span>
        <div class="star-rating" data-asset="${key}">
          ${[1,2,3,4,5].map(n =>
            `<button class="star-btn" data-value="${n}" onclick="setRating('${key}',${n})">☆</button>`
          ).join('')}
        </div>
      </div>`;
  });

  assetRatingsEl.innerHTML = html || '<p style="color:var(--text3);font-size:13px;">No assets to rate.</p>';
}

function setRating(assetKey, value) {
  state.ratings[assetKey] = value;

  // Update star display
  const row = document.querySelector(`.star-rating[data-asset="${assetKey}"]`);
  if (!row) return;
  row.querySelectorAll('.star-btn').forEach(btn => {
    const v = parseInt(btn.dataset.value);
    btn.textContent = v <= value ? '★' : '☆';
    btn.classList.toggle('star-filled', v <= value);
  });
}

function submitRating() {
  const feedback = val('ratingFeedback');
  const ratings  = state.ratings || {};

  // Store rating data — in future this feeds back into generation quality
  const ratingData = {
    ratings,
    feedback,
    company:   state.brief.company   || '',
    job_title: state.brief.job_title || '',
    narrative: state.brief.narrative_thread || '',
    timestamp: new Date().toISOString(),
  };

  // Store in sessionStorage for now — future: send to backend
  try {
    const existing = JSON.parse(sessionStorage.getItem('ratings') || '[]');
    existing.push(ratingData);
    sessionStorage.setItem('ratings', JSON.stringify(existing));
  } catch(e) {}

  hide('ratingSection');
  show('ratingPaths');
}

function showSuggestions() {
  show('suggestionsSection');
}

function submitSuggestion() {
  const text = val('suggestionsText');
  if (!text) { showToast('Add your suggestion first.'); return; }
  // Store suggestion
  try {
    const existing = JSON.parse(sessionStorage.getItem('suggestions') || '[]');
    existing.push({ text, timestamp: new Date().toISOString() });
    sessionStorage.setItem('suggestions', JSON.stringify(existing));
  } catch(e) {}
  hide('suggestionsSection');
  showToast('Thank you — noted.');
}

// ── Safe text — sets text content without HTML interpretation ─────────────────
// Use this for raw LLM output that should display as plain text
function safeText(str) {
  if (!str) return '';
  // Create a text node — browser handles all escaping correctly
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML; // returns properly escaped HTML
}

// ── Minimal markdown — for structured responses with markdown formatting ───────
// Only call this on text that is known to contain markdown from the LLM
function md(text) {
  if (!text) return '';
  // Step 1: escape HTML entities in the raw text first
  let safe = safeText(text);
  // Step 2: apply markdown formatting on the now-safe text
  safe = safe
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3 style="font-size:13px;font-weight:600;color:var(--text);margin:14px 0 6px;">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:15px;font-weight:500;color:var(--text);margin:16px 0 8px;">$1</h2>')
    .replace(/^- (.+)$/gm, '<li style="margin-bottom:4px;color:var(--text2);">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li style="margin-bottom:4px;color:var(--text);">$1. $2</li>')
    .replace(/(<li[^>]*>.*?<\/li>\n?)+/gs, '<ul style="padding-left:18px;margin:6px 0 10px;">$&</ul>')
    .replace(/\n\n+/g, '</p><p style="margin:0 0 10px;line-height:1.7;color:var(--text2);">')
    .replace(/\n/g, '<br>');
  return `<p style="margin:0 0 10px;line-height:1.7;color:var(--text2);">${safe}</p>`;
}

// escHtml is kept for backward compat but should only be used when
// building innerHTML strings — NOT on top of safeText() output
function escHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

// ── Intersection observer for step label ──────────────────────────────────────
if ('IntersectionObserver' in window) {
  [
    { id: 'step1', step: 1 }, { id: 'step2', step: 2 }, { id: 'step25', step: 2.5 },
    { id: 'step3', step: 3 }, { id: 'step35', step: 3.5 }, { id: 'step4', step: 4 },
    { id: 'step45', step: 4.5 }, { id: 'step5', step: 5 },
  ].forEach(({ id, step }) => {
    const el = document.getElementById(id);
    if (!el) return;
    new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        const labelEl = document.getElementById('stepLabelText');
        if (labelEl) { labelEl.style.opacity = '0'; setTimeout(() => { labelEl.textContent = stepLabels[step] || ''; labelEl.style.opacity = '1'; }, 120); }
      }
    }, { threshold: 0.1, rootMargin: '-52px 0px -50% 0px' }).observe(el);
  });
}

// Init
updateProgress(1);