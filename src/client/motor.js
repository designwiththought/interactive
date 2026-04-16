// Motor simulator engine — vanilla JS.
//
// Behavior:
//   - User picks a mode (tremor, bumpy, both) and intensity (light, moderate, severe).
//   - Pressing Start animates the simulation surface with a transform loop that
//     layers tremor jitter and/or bumpy-ride shake on top of the interactive
//     targets. The surrounding chrome stays stable to avoid full-screen nausea.
//   - We listen for clicks at the document level. Clicks that miss interactive
//     targets are counted as misses and visualized with a ring marker.
//     Quick repeated taps on the same target within 500 ms count as re-taps.
//   - Tasks advance when the expected interaction succeeds.
//   - When all tasks complete, the stage switches to a done state and we render
//     stats. The debrief section below stays visible so the teachable moment is
//     right there on the page.
//
// All timing uses requestAnimationFrame so the transform only updates once per
// frame — cheap and smooth.

(function () {
  'use strict';

  const sim = document.querySelector('[data-motor-sim]');
  if (!sim) return;

  const stage   = sim.querySelector('[data-sim-stage]');
  const idle    = sim.querySelector('[data-sim-idle]');
  const surface = sim.querySelector('[data-sim-surface]');
  const done    = sim.querySelector('[data-sim-done]');
  const startBtn = sim.querySelector('[data-sim-start]');
  const resetBtn = sim.querySelector('[data-sim-reset]');

  const statTask  = sim.querySelector('[data-stat-task]');
  const statTime  = sim.querySelector('[data-stat-time]');
  const statMiss  = sim.querySelector('[data-stat-miss]');
  const statRetap = sim.querySelector('[data-stat-retap]');

  const doneTime  = sim.querySelector('[data-done-time]');
  const doneMiss  = sim.querySelector('[data-done-miss]');
  const doneRetap = sim.querySelector('[data-done-retap]');

  const progressSteps = sim.querySelectorAll('.task-progress-step');

  // ----- Config ------------------------------------------------------------
  const INTENSITY = {
    light:    { tremorAmp: 2,  tremorHz: 8,  bumpAmp: 4,  bumpHz: 1.6, jolt: 0.06 },
    moderate: { tremorAmp: 5,  tremorHz: 10, bumpAmp: 10, bumpHz: 1.9, jolt: 0.14 },
    severe:   { tremorAmp: 9,  tremorHz: 13, bumpAmp: 18, bumpHz: 2.2, jolt: 0.24 },
  };

  const state = {
    mode: 'tremor',
    intensity: 'moderate',
    running: false,
    task: 1,
    startedAt: 0,
    missed: 0,
    retaps: 0,
    lastTap: { target: null, at: 0 },
    rafId: null,
    timerId: null,
  };

  // ----- Control wiring ----------------------------------------------------
  sim.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mode = btn.getAttribute('data-mode');
      sim.querySelectorAll('[data-mode]').forEach(b => {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
    });
  });
  sim.querySelectorAll('[data-intensity]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.intensity = btn.getAttribute('data-intensity');
      sim.querySelectorAll('[data-intensity]').forEach(b => {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
    });
  });

  startBtn.addEventListener('click', start);
  resetBtn.addEventListener('click', reset);

  // ----- Transform loop ----------------------------------------------------
  // Returns a small random value biased toward zero to produce tremor-like
  // wobble rather than uniform noise.
  function triangular() {
    return (Math.random() + Math.random() - 1);
  }

  function tick(ts) {
    if (!state.running) return;
    const cfg = INTENSITY[state.intensity];

    let tx = 0, ty = 0, rot = 0;

    if (state.mode === 'tremor' || state.mode === 'both') {
      // High-frequency small jitter.
      tx += triangular() * cfg.tremorAmp;
      ty += triangular() * cfg.tremorAmp;
      rot += triangular() * (cfg.tremorAmp * 0.05);
    }

    if (state.mode === 'bumpy' || state.mode === 'both') {
      // Lower-frequency sway, plus the occasional pothole jolt.
      const t = ts / 1000;
      tx += Math.sin(t * cfg.bumpHz * 2 * Math.PI) * (cfg.bumpAmp * 0.6);
      ty += Math.sin(t * cfg.bumpHz * 2 * Math.PI + 1.3) * cfg.bumpAmp;
      if (Math.random() < cfg.jolt / 60) {
        ty += (Math.random() - 0.5) * cfg.bumpAmp * 3;
        tx += (Math.random() - 0.5) * cfg.bumpAmp * 2;
      }
    }

    surface.style.setProperty('--sim-tx', tx.toFixed(2) + 'px');
    surface.style.setProperty('--sim-ty', ty.toFixed(2) + 'px');
    surface.style.setProperty('--sim-rot', rot.toFixed(3) + 'deg');

    state.rafId = requestAnimationFrame(tick);
  }

  // ----- Timer meter -------------------------------------------------------
  function tickTimer() {
    if (!state.running) return;
    const elapsed = (performance.now() - state.startedAt) / 1000;
    statTime.textContent = elapsed.toFixed(1) + 's';
  }

  // ----- Click tracking ----------------------------------------------------
  // A tap on the simulation surface that lands outside an interactive element
  // is counted as a miss. We visualize it so the user can see how far off
  // their aim was — this is the learning moment.
  function isInteractive(el) {
    if (!el) return false;
    return !!el.closest('button, a, input, select, textarea, label, [role="button"]');
  }

  surface.addEventListener('click', (e) => {
    if (!state.running) return;
    if (!isInteractive(e.target)) {
      registerMiss(e.clientX, e.clientY);
    } else {
      // Detect re-taps: same target within 500 ms.
      const now = performance.now();
      const target = e.target.closest('button, a, input, label');
      if (target && target === state.lastTap.target && (now - state.lastTap.at) < 500) {
        state.retaps += 1;
        statRetap.textContent = state.retaps;
      }
      state.lastTap = { target, at: now };
    }
  }, true);

  function registerMiss(x, y) {
    state.missed += 1;
    statMiss.textContent = state.missed;

    const mark = document.createElement('span');
    mark.className = 'miss-marker';
    mark.style.left = x + 'px';
    mark.style.top  = y + 'px';
    document.body.appendChild(mark);
    setTimeout(() => mark.remove(), 650);
  }

  // ----- Tasks -------------------------------------------------------------
  // Task 1: "Agree" button (tracked by data-task-target="task1.agree")
  const task1Agree = sim.querySelector('[data-task-target="task1.agree"]');
  task1Agree.addEventListener('click', () => {
    if (state.running && state.task === 1) advanceTask();
  });

  // Task 2: Save profile with exact name "Alex Rivera"
  const task2Form = sim.querySelector('[data-task-form]');
  task2Form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!state.running || state.task !== 2) return;
    const name = task2Form.querySelector('#profile-name').value.trim();
    const email = task2Form.querySelector('#profile-email').value.trim();
    if (name.toLowerCase() === 'alex rivera' && email.length > 3) {
      advanceTask();
    } else {
      // Gentle hint. Not a real error — we don't want to gamify failure.
      const field = task2Form.querySelector('#profile-name');
      field.focus();
      field.select?.();
    }
  });

  // Task 3: Both required checkboxes ticked, then Pay button
  const task3Pay = sim.querySelector('[data-task-target="task3.pay"]');
  task3Pay.addEventListener('click', () => {
    if (!state.running || state.task !== 3) return;
    const terms = sim.querySelector('[data-task-check="terms"]');
    const receipts = sim.querySelector('[data-task-check="receipts"]');
    if (terms.checked && receipts.checked) advanceTask();
  });

  function advanceTask() {
    const current = sim.querySelector(`.task-card[data-task="${state.task}"]`);
    current.setAttribute('data-active', 'false');

    state.task += 1;
    if (state.task > 3) { finish(); return; }

    const next = sim.querySelector(`.task-card[data-task="${state.task}"]`);
    next.setAttribute('data-active', 'true');
    statTask.textContent = state.task + ' / 3';
    updateProgress();
  }

  function updateProgress() {
    progressSteps.forEach((step, i) => {
      const idx = i + 1;
      if (idx < state.task) step.setAttribute('data-status', 'done');
      else if (idx === state.task) step.setAttribute('data-status', 'active');
      else step.removeAttribute('data-status');
    });
  }

  // ----- Start / finish / reset --------------------------------------------
  function start() {
    if (state.running) return;
    state.running = true;
    state.task = 1;
    state.missed = 0;
    state.retaps = 0;
    state.startedAt = performance.now();

    // Reset form fields and task visibility.
    sim.querySelectorAll('.task-card').forEach((c, i) => {
      c.setAttribute('data-active', i === 0 ? 'true' : 'false');
    });
    sim.querySelectorAll('input[type="text"], input[type="email"]').forEach(i => {
      if (i.id === 'profile-email') i.value = 'alex@example.com';
      else i.value = '';
    });
    sim.querySelectorAll('input[type="checkbox"]').forEach(c => { c.checked = false; });

    statTask.textContent = '1 / 3';
    statTime.textContent = '0.0s';
    statMiss.textContent = '0';
    statRetap.textContent = '0';
    updateProgress();

    idle.hidden = true;
    surface.hidden = false;
    stage.setAttribute('data-state', 'running');
    resetBtn.hidden = false;

    state.rafId = requestAnimationFrame(tick);
    state.timerId = setInterval(tickTimer, 100);
  }

  function finish() {
    state.running = false;
    cancelAnimationFrame(state.rafId);
    clearInterval(state.timerId);
    surface.style.setProperty('--sim-tx', '0px');
    surface.style.setProperty('--sim-ty', '0px');
    surface.style.setProperty('--sim-rot', '0deg');

    const elapsed = (performance.now() - state.startedAt) / 1000;
    doneTime.textContent  = elapsed.toFixed(1) + 's';
    doneMiss.textContent  = state.missed;
    doneRetap.textContent = state.retaps;

    stage.setAttribute('data-state', 'done');

    // Nudge the user toward the debrief below so the payoff lands.
    const debrief = document.querySelector('[data-debrief]');
    debrief?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function reset() {
    state.running = false;
    cancelAnimationFrame(state.rafId);
    clearInterval(state.timerId);
    surface.style.setProperty('--sim-tx', '0px');
    surface.style.setProperty('--sim-ty', '0px');
    surface.style.setProperty('--sim-rot', '0deg');

    stage.setAttribute('data-state', 'idle');
    idle.hidden = false;
    surface.hidden = true;
    resetBtn.hidden = true;
  }
})();
