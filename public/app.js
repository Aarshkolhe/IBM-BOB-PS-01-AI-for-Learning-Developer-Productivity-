'use strict';

(() => {
  // ═══ Memory-only key store ════════════════════════════════════════════════════
  // Keys live only in this closure. Never write to Web Storage, cookies, or URLs.
  const sessionKeys = { anthropic: null, openai: null, gemini: null };

  const PROVIDER_LABELS = { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini' };
  const PROVIDER_ORDER = ['anthropic', 'openai', 'gemini'];

  // Solver assignment: 3 providers → each gets a distinct solver role.
  // When <3 keys are configured, roles rotate across available providers.
  const SOLVER_CONFIGS = [
    { label: 'A', style: 'concise',        styleLabel: 'Concise approach',          preferredProvider: 'anthropic' },
    { label: 'B', style: 'first_principles', styleLabel: 'First-principles approach', preferredProvider: 'openai' },
    { label: 'C', style: 'example_driven', styleLabel: 'Example-driven approach',   preferredProvider: 'gemini' }
  ];

  // Critic preference: openai → anthropic → gemini
  const CRITIC_PREFERENCE = ['openai', 'anthropic', 'gemini'];
  // Judge preference:  anthropic → openai → gemini
  const JUDGE_PREFERENCE  = ['anthropic', 'openai', 'gemini'];

  // ═══ Application state ════════════════════════════════════════════════════════
  // States: idle | solving | reviewing | tutoring | done
  let appState = 'idle';
  let sessionId = 0;        // increments on each new run; stale responses check this
  let activeAbortControllers = [];

  // ═══ DOM refs ═════════════════════════════════════════════════════════════════
  const setupSection    = document.getElementById('setup-section');
  const questionSection = document.getElementById('question-section');
  const arenaSection    = document.getElementById('arena-section');
  const startBtn        = document.getElementById('start-btn');
  const resetBtn        = document.getElementById('reset-btn');
  const questionForm    = document.getElementById('question-form');
  const questionInput   = document.getElementById('question-input');
  const questionError   = document.getElementById('question-error');
  const charCount       = document.getElementById('char-count');
  const questionNote    = document.getElementById('question-provider-note');
  const arenaStatus     = document.getElementById('arena-status');
  const reviewRow       = document.getElementById('review-row');
  const allFailedBanner = document.getElementById('all-failed-banner');
  const allFailedMsg    = document.getElementById('all-failed-msg');
  const retryAllBtn     = document.getElementById('retry-all-btn');
  const retryJudgeBtn   = document.getElementById('retry-judge-btn');
  const judgeActions    = document.getElementById('judge-actions');
  const judgeRetryNote  = document.getElementById('judge-retry-note');
  const scoreGrid       = document.getElementById('score-grid');
  const winnerBox       = document.getElementById('winner-box');
  const cardJudgeMsg    = document.getElementById('card-judge-msg');

  // ── Tutor DOM refs ──
  const tutorSection      = document.getElementById('tutor-section');
  const tutorStatus       = document.getElementById('tutor-status');
  const tutorLoading      = document.getElementById('tutor-loading');
  const tutorErrorBanner  = document.getElementById('tutor-error-banner');
  const tutorErrorMsg     = document.getElementById('tutor-error-msg');
  const retryTutorBtn     = document.getElementById('retry-tutor-btn');
  const stepCard          = document.getElementById('step-card');
  const stepProgress      = document.getElementById('step-progress');
  const stepTitle         = document.getElementById('step-title');
  const stepExplanation   = document.getElementById('step-explanation');
  const reexplainLoading  = document.getElementById('reexplain-loading');
  const reexplainError    = document.getElementById('reexplain-error');
  const stepActions       = document.getElementById('step-actions');
  const gotItBtn          = document.getElementById('got-it-btn');
  const notClearBtn       = document.getElementById('not-clear-btn');
  const workedExampleBox  = document.getElementById('worked-example-box');
  const workedExampleText = document.getElementById('worked-example-text');
  const continueBtn       = document.getElementById('continue-btn');
  const recapSection      = document.getElementById('recap-section');
  const recapText         = document.getElementById('recap-text');
  const copyRecapBtn      = document.getElementById('copy-recap-btn');
  const copyConfirm       = document.getElementById('copy-confirm');
  const finalCheckText    = document.getElementById('final-check-text');

  // ═══ Utilities ════════════════════════════════════════════════════════════════

  function connectedProviders() {
    return PROVIDER_ORDER.filter(p => sessionKeys[p]);
  }

  /** Pick the best available provider from an ordered preference list. */
  function pickProvider(preferenceList) {
    for (const p of preferenceList) {
      if (sessionKeys[p]) return p;
    }
    return null;
  }

  /**
   * Assign a provider to each solver.
   * All-three: A=anthropic, B=openai, C=gemini.
   * Fewer: rotate available providers across solver slots.
   */
  function assignSolverProviders() {
    const available = connectedProviders();
    if (available.length === 0) return null;
    return SOLVER_CONFIGS.map((cfg, i) => ({
      ...cfg,
      provider: available[i % available.length]
    }));
  }

  // ═══ Provider setup UI (unchanged from Phase 2) ═══════════════════════════════

  function setFeedback(provider, message, kind = '') {
    const el = document.querySelector(`[data-feedback="${provider}"]`);
    el.textContent = message;
    el.classList.remove('success', 'error');
    if (kind) el.classList.add(kind);
  }

  function updateStatus(provider, state, message) {
    const pill = document.querySelector(`[data-status="${provider}"]`);
    pill.classList.remove('status-empty', 'status-connected', 'status-error');
    if (state === 'connected') {
      pill.classList.add('status-connected');
      pill.textContent = 'Connected · session only';
    } else if (state === 'error') {
      pill.classList.add('status-error');
      pill.textContent = 'Test failed';
    } else {
      pill.classList.add('status-empty');
      pill.textContent = 'Not connected';
    }
    if (message) {
      setFeedback(provider, message, state === 'connected' ? 'success' : state === 'error' ? 'error' : '');
    }
    updateSessionSummary();
  }

  function updateSessionSummary() {
    const count = connectedProviders().length;
    const summary = document.getElementById('session-summary');
    const detail  = document.getElementById('session-detail');
    if (count === 0) {
      summary.textContent = 'No providers connected';
      detail.textContent  = 'Connect at least one provider. Full cross-provider competition works best with all three.';
    } else if (count === 1) {
      const p = connectedProviders()[0];
      summary.textContent = `1 provider connected: ${PROVIDER_LABELS[p]}`;
      detail.textContent  = 'You can proceed with one provider. All three solver calls will use the same model with different prompts.';
    } else {
      const names = connectedProviders().map(p => PROVIDER_LABELS[p]);
      summary.textContent = `${count} providers connected: ${names.join(', ')}`;
      detail.textContent = count === 3
        ? 'All three providers are ready for cross-provider competition.'
        : 'Two providers available. Solvers will be spread across them.';
    }
    updateStartButton();
  }

  function updateStartButton() {
    const hasKey      = connectedProviders().length > 0;
    const isIdle      = appState === 'idle';
    startBtn.disabled = !hasKey || !isIdle;
    questionNote.textContent = hasKey
      ? `${connectedProviders().length} provider(s) connected. Enter a question to start.`
      : 'Connect at least one provider above to start.';
  }

  // ═══ Agent card helpers ════════════════════════════════════════════════════════

  function setCardState(id, state, statusText) {
    const card   = document.getElementById(`card-${id}`);
    const pill   = document.getElementById(`card-${id}-status`);
    if (!card || !pill) return;
    card.dataset.state = state;
    pill.textContent = statusText;
    pill.className = `agent-status-pill ${state}`;
  }

  /** Set body text safely — never innerHTML */
  function setCardBody(id, text, isPlaceholder = false) {
    if (id === 'judge') {
      const msgEl = cardJudgeMsg || document.getElementById('card-judge-msg');
      if (msgEl) {
        msgEl.textContent = text;
        msgEl.hidden = !text;
        if (isPlaceholder) {
          msgEl.classList.add('placeholder');
        } else {
          msgEl.classList.remove('placeholder');
        }
      }
      return;
    }
    const body = document.getElementById(`card-${id}-body`);
    if (!body) return;
    if (isPlaceholder) {
      body.classList.add('placeholder');
    } else {
      body.classList.remove('placeholder');
    }
    body.textContent = text;
  }

  function setCardProvider(id, provider) {
    const el = document.getElementById(`card-${id}-provider`);
    if (el) el.textContent = provider ? PROVIDER_LABELS[provider] || provider : '—';
  }

  function setCardStyle(id, text) {
    const el = document.getElementById(`card-${id}-style`);
    if (el) el.textContent = text || '';
  }

  function resetSolverCards(assignments) {
    for (const cfg of assignments) {
      const id = cfg.label;
      setCardState(id, 'thinking', 'Thinking…');
      setCardProvider(id, cfg.provider);
      setCardStyle(id, cfg.styleLabel);
      setCardBody(id, 'Waiting for response…', true);
    }
  }

  function resetReviewCards(criticProvider, judgeProvider) {
    setCardState('critic', 'thinking', 'Thinking…');
    setCardProvider('critic', criticProvider);
    setCardBody('critic', 'Reviewing drafts…', true);

    setCardState('judge', 'thinking', 'Thinking…');
    setCardProvider('judge', judgeProvider);
    setCardBody('judge', '', false);
    scoreGrid.hidden = true;
    scoreGrid.textContent = '';
    winnerBox.hidden = true;
    winnerBox.textContent = '';
    judgeActions.hidden = true;
  }

  // ═══ Safe fetch wrapper ════════════════════════════════════════════════════════

  async function apiFetch(path, body, abortController) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: abortController.signal
    });
    let data;
    try { data = await response.json(); } catch { data = null; }
    return { ok: response.ok, status: response.status, data };
  }

  // ═══ Score grid renderer ═════════════════════════════════════════════════════

  function renderScoreGrid(scores) {
    scoreGrid.textContent = ''; // clear safely

    const FIELDS = ['correctness', 'clarity', 'completeness'];
    const labels = Object.keys(scores);

    for (const label of labels) {
      const s = scores[label];
      if (!s) continue;

      const item = document.createElement('div');
      item.className = 'score-item';

      const title = document.createElement('div');
      title.className = 'score-item-label';
      title.textContent = `Solver ${label}`;
      item.appendChild(title);

      const bars = document.createElement('div');
      bars.className = 'score-bars';

      for (const field of FIELDS) {
        const val = s[field];
        if (typeof val !== 'number') continue;

        const row = document.createElement('div');
        row.className = 'score-bar-row';

        const name = document.createElement('span');
        name.className = 'score-bar-name';
        name.textContent = field.charAt(0).toUpperCase() + field.slice(1);

        const track = document.createElement('div');
        track.className = 'score-bar-track';
        const fill = document.createElement('div');
        fill.className = 'score-bar-fill';
        fill.style.width = `${val * 10}%`;
        track.appendChild(fill);

        const valEl = document.createElement('span');
        valEl.className = 'score-bar-val';
        valEl.textContent = String(val);

        row.appendChild(name);
        row.appendChild(track);
        row.appendChild(valEl);
        bars.appendChild(row);
      }
      item.appendChild(bars);

      if (s.reason) {
        const reason = document.createElement('div');
        reason.className = 'score-reason';
        reason.textContent = s.reason; // safe textContent
        item.appendChild(reason);
      }

      scoreGrid.appendChild(item);
    }

    scoreGrid.hidden = false;
  }

  function renderWinnerBox(winner, winnerText, degraded) {
    winnerBox.textContent = '';
    winnerBox.className = `winner-box${degraded ? ' degraded' : ''}`;

    const labelEl = document.createElement('div');
    labelEl.className = 'winner-label';
    labelEl.textContent = `${degraded ? '⚠ Degraded · ' : ''}Selected answer: Solver ${winner}`;

    const textEl = document.createElement('div');
    textEl.className = 'winner-text';
    textEl.textContent = winnerText; // safe textContent

    winnerBox.appendChild(labelEl);
    winnerBox.appendChild(textEl);

    if (degraded) {
      const note = document.createElement('div');
      note.className = 'degraded-note';
      note.textContent = 'Critic failed — judging was done without critique. Results may be less reliable.';
      winnerBox.appendChild(note);
    }

    winnerBox.hidden = false;
  }

  // ═══ Main pipeline ════════════════════════════════════════════════════════════

  async function runPipeline(question) {
    const mySessionId = ++sessionId;
    appState = 'solving';
    updateStartButton();

    const ac = new AbortController();
    activeAbortControllers.push(ac);
    const cleanup = () => {
      activeAbortControllers = activeAbortControllers.filter(c => c !== ac);
    };

    // Clear old arena state
    allFailedBanner.hidden   = true;
    allFailedMsg.textContent = '';
    judgeActions.hidden      = true;
    reviewRow.hidden         = true;
    tutorSection.hidden      = true;
    arenaSection.hidden      = false;
    resetBtn.hidden          = false;

    // Reset critic and judge cards so stale data from prior runs cannot persist
    setCardState('critic', 'waiting', 'Waiting');
    setCardBody('critic', '', true);
    setCardState('judge', 'waiting', 'Waiting');
    setCardBody('judge', '', true);
    scoreGrid.hidden         = true;
    scoreGrid.textContent    = '';
    winnerBox.hidden         = true;
    winnerBox.textContent    = '';
    if (cardJudgeMsg) {
      cardJudgeMsg.textContent = '';
      cardJudgeMsg.hidden = true;
    }

    const assignments = assignSolverProviders();
    if (!assignments) {
      cleanup();
      appState = 'idle';
      updateStartButton();
      return;
    }

    arenaStatus.textContent = 'Running three solvers in parallel…';
    resetSolverCards(assignments);

    // ── Phase: Solvers in parallel ─────────────────────────────────────────────
    const solverPromises = assignments.map(async (cfg) => {
      if (mySessionId !== sessionId) return { label: cfg.label, aborted: true };

      try {
        const { ok, data } = await apiFetch('/api/solver', {
          provider: cfg.provider,
          apiKey: sessionKeys[cfg.provider],
          question,
          style: cfg.style
        }, ac);

        if (mySessionId !== sessionId) return { label: cfg.label, aborted: true };

        if (ok && data && data.ok && typeof data.draft === 'string') {
          setCardState(cfg.label, 'done', 'Completed');
          setCardBody(cfg.label, data.draft);
          return { label: cfg.label, draft: data.draft, provider: cfg.provider, ok: true };
        }

        // Solver failed
        const msg = data && data.error && data.error.message
          ? data.error.message
          : 'This solver failed. Check the provider key.';
        setCardState(cfg.label, 'failed', 'Failed');
        setCardBody(cfg.label, msg, true);
        return { label: cfg.label, ok: false, error: msg };

      } catch (err) {
        if (mySessionId !== sessionId) return { label: cfg.label, aborted: true };
        const msg = err && err.name === 'AbortError'
          ? 'Cancelled.'
          : 'Network error reaching the server.';
        setCardState(cfg.label, 'failed', 'Failed');
        setCardBody(cfg.label, msg, true);
        return { label: cfg.label, ok: false, error: msg };
      }
    });

    const solverResults = await Promise.allSettled(solverPromises);
    if (mySessionId !== sessionId) { cleanup(); return; }

    const successfulDrafts = [];
    let allAborted = false;
    for (const r of solverResults) {
      if (r.status === 'fulfilled' && r.value) {
        if (r.value.aborted) { allAborted = true; break; }
        if (r.value.ok)      successfulDrafts.push(r.value);
      }
    }
    if (allAborted) { cleanup(); appState = 'idle'; updateStartButton(); return; }

    if (successfulDrafts.length === 0) {
      arenaStatus.textContent = 'All solvers failed.';
      allFailedBanner.hidden = false;
      reviewRow.hidden = true;
      judgeActions.hidden = true;
      const firstError = solverResults.find(r => r.status === 'fulfilled' && r.value && r.value.error)?.value?.error;
      allFailedMsg.textContent = firstError
        ? `All solvers failed: ${firstError}`
        : 'Check that at least one provider key is valid and the provider is reachable.';
      cleanup();
      appState = 'idle';
      updateStartButton();
      return;
    }

    // ── Phase: Critic ─────────────────────────────────────────────────────────
    appState = 'reviewing';
    arenaStatus.textContent = 'Reviewing drafts…';

    const criticProvider = pickProvider(CRITIC_PREFERENCE);
    const judgeProvider  = pickProvider(JUDGE_PREFERENCE);
    resetReviewCards(criticProvider, judgeProvider);
    reviewRow.hidden = false;

    const draftsPayload = successfulDrafts.map(d => ({ label: d.label, text: d.draft }));
    let critiqueText = null;
    let criticDegraded = false;

    try {
      const { ok, data } = await apiFetch('/api/review', {
        provider:  criticProvider,
        apiKey:    sessionKeys[criticProvider],
        stage:     'critic',
        question,
        drafts:    draftsPayload
      }, ac);

      if (mySessionId !== sessionId) { cleanup(); return; }

      if (ok && data && data.ok && typeof data.critique === 'string') {
        critiqueText = data.critique;
        setCardState('critic', 'done', 'Completed');
        setCardBody('critic', critiqueText);
      } else {
        const msg = data && data.error && data.error.message
          ? data.error.message
          : 'The critic failed.';
        setCardState('critic', 'degraded', 'Failed');
        setCardBody('critic', `Critic failed: ${msg}\nJudge will proceed without critique.`, true);
        criticDegraded = true;
      }
    } catch (err) {
      if (mySessionId !== sessionId) { cleanup(); return; }
      if (err && err.name === 'AbortError') { cleanup(); appState = 'idle'; updateStartButton(); return; }
      setCardState('critic', 'degraded', 'Failed');
      setCardBody('critic', 'Critic failed (network error). Judge will proceed without critique.', true);
      criticDegraded = true;
    }

    if (mySessionId !== sessionId) { cleanup(); return; }

    // ── Phase: Judge ──────────────────────────────────────────────────────────
    arenaStatus.textContent = 'Judging…';

    const judgePayload = {
      provider: judgeProvider,
      apiKey:   sessionKeys[judgeProvider],
      stage:    'judge',
      question,
      drafts:   draftsPayload,
      ...(critiqueText ? { critique: critiqueText } : {})
    };

    async function runJudge(retrying = false) {
      if (mySessionId !== sessionId) return;
      if (retrying) {
        setCardState('judge', 'thinking', 'Retrying…');
        setCardBody('judge', '', false);
        scoreGrid.hidden  = true;
        winnerBox.hidden  = true;
        judgeActions.hidden = true;
      }

      try {
        const { ok, data } = await apiFetch('/api/review', judgePayload, ac);
        if (mySessionId !== sessionId) return;

        if (ok && data && data.ok && data.winner && data.scores) {
          setCardBody('judge', '', false);
          renderScoreGrid(data.scores);
          renderWinnerBox(data.winner, data.winnerText, criticDegraded || data.degraded);
          setCardState('judge', 'done', 'Completed');
          judgeActions.hidden = true;
          arenaStatus.textContent = `Solver ${data.winner} selected. Starting tutor…`;
          // Hand off to tutor — pass judgeProvider as tutor provider (same preference)
          runTutor(question, data.winnerText, judgeProvider, mySessionId, ac, cleanup);
        } else {
          scoreGrid.hidden = true;
          scoreGrid.textContent = '';
          winnerBox.hidden = true;
          winnerBox.textContent = '';
          const msg = data && data.error && data.error.message
            ? data.error.message
            : 'The judge failed to return valid scores.';
          setCardState('judge', 'failed', 'Failed');
          setCardBody('judge', `Judge failed: ${msg}`, true);
          judgeActions.hidden = false;
          judgeRetryNote.textContent = 'Retry uses the same drafts and critique.';
          arenaStatus.textContent = 'Judging failed.';
          appState = 'reviewing';
          updateStartButton();
        }
      } catch (err) {
        if (mySessionId !== sessionId) return;
        if (err && err.name === 'AbortError') { cleanup(); appState = 'idle'; updateStartButton(); return; }
        scoreGrid.hidden = true;
        scoreGrid.textContent = '';
        winnerBox.hidden = true;
        winnerBox.textContent = '';
        setCardState('judge', 'failed', 'Failed');
        setCardBody('judge', 'Judge failed (network error).', true);
        judgeActions.hidden = false;
        judgeRetryNote.textContent = 'Retry uses the same drafts.';
        arenaStatus.textContent = 'Judging failed.';
        appState = 'reviewing';
        updateStartButton();
      }
    }

    retryJudgeBtn.onclick = () => {
      if (mySessionId !== sessionId) return;
      if (appState !== 'reviewing') return;
      runJudge(true);
    };
    await runJudge(false);
    // cleanup() is called by runTutor on completion or hard error.
    // If only the judge failed (no tutor started), we leave ac in
    // activeAbortControllers so resetArena can abort it on reset.
  }

  // ═══ Tutor pipeline ════════════════════════════════════════════════════════════

  async function runTutor(question, winnerText, provider, mySessionId, ac, cleanup) {
    if (mySessionId !== sessionId) { ac.abort(); cleanup(); return; }

    appState = 'tutoring';
    updateStartButton();

    tutorSection.hidden    = false;
    tutorLoading.hidden    = false;
    tutorErrorBanner.hidden = true;
    stepCard.hidden        = true;
    recapSection.hidden    = true;
    tutorStatus.textContent = 'Preparing your lesson…';

    // Scroll to tutor section
    tutorSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    let tutorData;
    try {
      const { ok, data } = await apiFetch('/api/tutor', {
        provider,
        apiKey: sessionKeys[provider],
        question,
        winnerText
      }, ac);

      if (mySessionId !== sessionId) { cleanup(); return; }

      if (ok && data && data.ok && Array.isArray(data.steps)) {
        tutorData = data;
      } else {
        const msg = data && data.error && data.error.message
          ? data.error.message
          : 'The tutor failed to prepare your lesson.';
        showTutorError(msg, question, winnerText, provider, mySessionId, ac, cleanup);
        return;
      }
    } catch (err) {
      if (mySessionId !== sessionId) { cleanup(); return; }
      if (err && err.name === 'AbortError') { cleanup(); appState = 'idle'; updateStartButton(); return; }
      showTutorError('Network error reaching the tutor. Check your connection.', question, winnerText, provider, mySessionId, ac, cleanup);
      return;
    }

    tutorLoading.hidden = true;
    tutorStatus.textContent = `Lesson ready — ${tutorData.steps.length} steps.`;

    // ── Step-by-step state ──
    let currentStep   = 0;
    let notClearCount = 0;

    function renderStep(index) {
      if (mySessionId !== sessionId) return;
      currentStep   = index;
      notClearCount = 0;

      const step = tutorData.steps[index];

      stepProgress.textContent = `Step ${index + 1} of ${tutorData.steps.length}`;
      stepTitle.textContent       = step.title;
      stepExplanation.textContent = step.explanation;

      // Reset auxiliary UI
      reexplainLoading.hidden  = true;
      reexplainError.hidden    = true;
      reexplainError.textContent = '';
      workedExampleBox.hidden  = true;
      stepActions.hidden       = false;
      gotItBtn.disabled        = false;
      notClearBtn.disabled     = false;
      stepCard.hidden          = false;
    }

    function advanceStep() {
      if (mySessionId !== sessionId) return;
      if (currentStep + 1 < tutorData.steps.length) {
        renderStep(currentStep + 1);
      } else {
        showRecap();
      }
    }

    function showRecap() {
      if (mySessionId !== sessionId) return;
      stepCard.hidden   = true;
      recapSection.hidden = false;
      tutorStatus.textContent = 'Lesson complete.';
      appState = 'done';
      updateStartButton();
      cleanup();

      recapText.textContent       = tutorData.recap;
      finalCheckText.textContent  = tutorData.final_check_question;

      copyRecapBtn.onclick = async () => {
        if (mySessionId !== sessionId) return;
        try {
          await navigator.clipboard.writeText(tutorData.recap);
          if (mySessionId !== sessionId) return;
          copyConfirm.hidden = false;
          setTimeout(() => {
            if (mySessionId === sessionId) {
              copyConfirm.hidden = true;
            }
          }, 1500);
        } catch {
          if (mySessionId !== sessionId) return;
          copyConfirm.hidden = false;
          copyConfirm.textContent = 'Copy failed — select and copy manually.';
          setTimeout(() => {
            if (mySessionId === sessionId) {
              copyConfirm.hidden = true;
              copyConfirm.textContent = 'Copied!';
            }
          }, 2500);
        }
      };
    }

    // ── Got it ──
    gotItBtn.onclick = () => {
      if (mySessionId !== sessionId) return;
      if (appState !== 'tutoring') return;
      advanceStep();
    };

    // ── Not clear ──
    notClearBtn.onclick = async () => {
      if (mySessionId !== sessionId) return;
      if (appState !== 'tutoring') return;

      notClearCount += 1;

      if (notClearCount >= 3) {
        // Third click: show pre-generated worked example, no API call
        const step = tutorData.steps[currentStep];
        workedExampleText.textContent = step.worked_example;
        workedExampleBox.hidden       = false;
        stepActions.hidden            = true;
        return;
      }

      // First or second click: fetch re-explanation
      gotItBtn.disabled    = true;
      notClearBtn.disabled = true;
      reexplainLoading.hidden = false;
      reexplainError.hidden   = true;
      reexplainError.textContent = '';

      const step = tutorData.steps[currentStep];
      try {
        const { ok, data } = await apiFetch('/api/reexplain', {
          provider,
          apiKey: sessionKeys[provider],
          stepTitle:       step.title,
          stepExplanation: step.explanation,
          notClearCount
        }, ac);

        if (mySessionId !== sessionId) return;

        reexplainLoading.hidden = true;

        if (ok && data && data.ok && typeof data.explanation === 'string') {
          stepExplanation.textContent = data.explanation;
        } else {
          // Re-explanation failed — do NOT consume the notClearCount
          notClearCount -= 1;
          const msg = data && data.error && data.error.message
            ? data.error.message
            : 'Re-explanation failed. Try again.';
          reexplainError.textContent = msg;
          reexplainError.hidden = false;
        }
      } catch (err) {
        if (mySessionId !== sessionId) return;
        reexplainLoading.hidden = true;
        if (err && err.name === 'AbortError') return;
        // Network error — do NOT consume the notClearCount
        notClearCount -= 1;
        reexplainError.textContent = 'Network error. Try again.';
        reexplainError.hidden = false;
      } finally {
        if (mySessionId === sessionId) {
          gotItBtn.disabled    = false;
          notClearBtn.disabled = false;
        }
      }
    };

    // ── Continue button (after worked example) ──
    continueBtn.onclick = () => {
      if (mySessionId !== sessionId) return;
      if (appState !== 'tutoring') return;
      workedExampleBox.hidden = true;
      stepActions.hidden      = false;
      advanceStep();
    };

    // Kick off the first step
    renderStep(0);
  }

  function showTutorError(message, question, winnerText, provider, mySessionId, ac, cleanup) {
    if (mySessionId !== sessionId) return;
    tutorLoading.hidden      = true;
    tutorErrorBanner.hidden  = false;
    tutorErrorMsg.textContent = message;
    tutorStatus.textContent  = 'Tutor failed.';
    appState = 'reviewing';  // allow re-running tutor without full pipeline reset
    updateStartButton();

    retryTutorBtn.onclick = () => {
      if (mySessionId !== sessionId) return;
      tutorErrorBanner.hidden = true;
      runTutor(question, winnerText, provider, mySessionId, ac, cleanup);
    };
  }

  // ═══ Question form ═════════════════════════════════════════════════════════════

  questionInput.addEventListener('input', () => {
    const len = questionInput.value.length;
    charCount.textContent = `${len.toLocaleString()} / 12,000`;
    charCount.classList.toggle('near-limit', len > 10000 && len <= 12000);
    charCount.classList.toggle('at-limit',   len > 12000);
  });

  questionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    questionError.textContent = '';

    if (appState !== 'idle') return;
    if (connectedProviders().length === 0) {
      questionError.textContent = 'Connect at least one provider before starting.';
      return;
    }

    const question = questionInput.value.trim();
    if (!question) {
      questionError.textContent = 'Enter a question before starting.';
      questionInput.focus();
      return;
    }
    if (question.length > 12000) {
      questionError.textContent = 'Question must be 12,000 characters or fewer.';
      questionInput.focus();
      return;
    }

    runPipeline(question);
  });

  // ═══ Reset ════════════════════════════════════════════════════════════════════

  function resetArena() {
    // Abort outstanding requests
    for (const ac of activeAbortControllers) { try { ac.abort(); } catch {} }
    activeAbortControllers = [];
    sessionId++; // invalidate any in-flight callbacks

    appState = 'idle';
    arenaSection.hidden      = true;
    reviewRow.hidden         = true;
    allFailedBanner.hidden   = true;
    allFailedMsg.textContent = '';
    resetBtn.hidden          = true;
    judgeActions.hidden      = true;
    scoreGrid.hidden         = true;
    scoreGrid.textContent    = '';
    winnerBox.hidden         = true;
    winnerBox.textContent    = '';
    if (cardJudgeMsg) {
      cardJudgeMsg.textContent = '';
      cardJudgeMsg.hidden = true;
    }
    questionError.textContent = '';

    // Reset tutor section
    tutorSection.hidden       = true;
    tutorLoading.hidden       = true;
    tutorErrorBanner.hidden   = true;
    stepCard.hidden           = true;
    recapSection.hidden       = true;
    workedExampleBox.hidden   = true;
    reexplainLoading.hidden   = true;
    reexplainError.hidden     = true;
    reexplainError.textContent = '';
    copyConfirm.hidden        = true;
    copyConfirm.textContent   = 'Copied!';
    tutorStatus.textContent   = 'Preparing your lesson…';

    // Reset all solver cards
    for (const cfg of SOLVER_CONFIGS) {
      setCardState(cfg.label, 'waiting', 'Waiting');
      setCardBody(cfg.label, '', true);
      setCardProvider(cfg.label, null);
      setCardStyle(cfg.label, '');
    }
    setCardState('critic', 'waiting', 'Waiting');
    setCardBody('critic', '', true);
    setCardState('judge', 'waiting', 'Waiting');
    setCardBody('judge', '', true);

    updateStartButton();
    questionInput.focus();
  }

  resetBtn.addEventListener('click', resetArena);

  retryAllBtn.addEventListener('click', () => {
    const question = questionInput.value.trim();
    if (!question || connectedProviders().length === 0) return;
    allFailedBanner.hidden = true;
    appState = 'idle';
    runPipeline(question);
  });

  // ═══ Provider key forms (same logic as Phase 2) ═══════════════════════════════

  document.querySelectorAll('.provider-form').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const provider    = form.dataset.provider;
      const input       = form.querySelector('input[name="apiKey"]');
      const submitBtn   = form.querySelector('button[type="submit"]');
      const apiKey      = input.value;

      if (!apiKey || apiKey.trim().length < 10 || apiKey.length > 512) {
        updateStatus(provider, 'error', 'Enter a key between 10 and 512 characters.');
        input.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Testing…';
      setFeedback(provider, 'Testing with a small API request. Your key is not saved by the server.');

      try {
        const res = await fetch('/api/keys/test', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider, apiKey }),
          signal: AbortSignal.timeout(35_000)
        });
        let result;
        try { result = await res.json(); } catch { result = null; }

        if (!res.ok || !result || result.ok !== true) {
          const msg = result && result.error && typeof result.error.message === 'string'
            ? result.error.message
            : 'Connection test failed. Check the provider key and try again.';
          sessionKeys[provider] = null;
          updateStatus(provider, 'error', msg);
          return;
        }

        sessionKeys[provider] = apiKey;
        input.value = '';
        input.type = 'password';
        const toggle = document.querySelector(`[data-toggle-visibility="${input.id}"]`);
        if (toggle) toggle.textContent = 'Show';
        updateStatus(provider, 'connected',
          `${PROVIDER_LABELS[provider]} connected for this page session. Input cleared; key stays in browser memory until cleared or refreshed.`);
      } catch (err) {
        sessionKeys[provider] = null;
        const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
        updateStatus(provider, 'error', timedOut
          ? 'Request timed out. Check your connection and try again.'
          : 'Could not reach TutorArena. Make sure the local server is running.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Test & keep in memory';
      }
    });
  });

  document.querySelectorAll('[data-toggle-visibility]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.toggleVisibility);
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? 'Show' : 'Hide';
      const provider = input.id.replace('key-', '');
      btn.setAttribute('aria-label', `${showing ? 'Show' : 'Hide'} ${PROVIDER_LABELS[provider] || provider} API key`);
    });
  });

  document.querySelectorAll('[data-clear-provider]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const provider = btn.dataset.clearProvider;
      sessionKeys[provider] = null;
      const input = document.getElementById(`key-${provider}`);
      input.value = '';
      input.type = 'password';
      const toggle = document.querySelector(`[data-toggle-visibility="${input.id}"]`);
      if (toggle) toggle.textContent = 'Show';
      updateStatus(provider, 'empty', `${PROVIDER_LABELS[provider]} key cleared from this page session.`);
    });
  });

  document.getElementById('clear-all').addEventListener('click', () => {
    PROVIDER_ORDER.forEach((provider) => {
      sessionKeys[provider] = null;
      const input = document.getElementById(`key-${provider}`);
      input.value = '';
      input.type = 'password';
      const toggle = document.querySelector(`[data-toggle-visibility="${input.id}"]`);
      if (toggle) toggle.textContent = 'Show';
      const pill = document.querySelector(`[data-status="${provider}"]`);
      pill.classList.remove('status-connected', 'status-error');
      pill.classList.add('status-empty');
      pill.textContent = 'Not connected';
      setFeedback(provider, 'Key cleared from this page session.');
    });
    updateSessionSummary();
  });

  // ═══ Init ═════════════════════════════════════════════════════════════════════
  updateSessionSummary();
})();
