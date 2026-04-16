// Site-wide client behavior (vanilla JS).
// - Persists the active persona in localStorage
// - Syncs header badge, on-page badges, and debrief visibility
// - Opens a site-wide <dialog> for persona switching

(function () {
  'use strict';

  const STORAGE_KEY = 'a11yLab.persona';
  const DEFAULT_PERSONA = 'designer';

  // Kept in sync with src/data/personas.mjs. Tiny enough that duplicating here
  // keeps the client free of any build-time data fetching.
  const PERSONAS = {
    'designer':          { name: 'Designer',         focus: 'a designer' },
    'developer':         { name: 'Developer',        focus: 'a developer' },
    'product-manager':   { name: 'Product manager',  focus: 'a product manager' },
    'researcher':        { name: 'UX researcher',    focus: 'a researcher' },
    'content-designer':  { name: 'Content designer', focus: 'a content designer' },
  };

  function getPersona() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && PERSONAS[saved]) return saved;
    } catch (_) { /* storage may be unavailable */ }
    return DEFAULT_PERSONA;
  }

  function setPersona(id) {
    if (!PERSONAS[id]) return;
    try { localStorage.setItem(STORAGE_KEY, id); } catch (_) {}
    applyPersona(id);
  }

  function applyPersona(id) {
    const p = PERSONAS[id];

    // Header label(s)
    document.querySelectorAll('[data-persona-label]').forEach(el => {
      el.textContent = p.name;
    });

    // "Framed for <you>" phrase
    document.querySelectorAll('[data-persona-focus]').forEach(el => {
      el.textContent = p.focus;
    });

    // Persona chip selection state (landing page + dialog)
    document.querySelectorAll('[data-persona-choice]').forEach(btn => {
      const active = btn.getAttribute('data-persona-choice') === id;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    // Debrief variants: show only the matching one
    document.querySelectorAll('[data-debrief] .debrief-variant').forEach(node => {
      const match = node.getAttribute('data-persona') === id;
      node.setAttribute('data-active', match ? 'true' : 'false');
    });

    // Expose as document attribute for CSS if ever useful
    document.documentElement.setAttribute('data-persona', id);
  }

  // ----- Dialog open / close -----------------------------------------------
  function openDialog() {
    const dialog = document.querySelector('[data-persona-dialog]');
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  // ----- Wire events -------------------------------------------------------
  document.addEventListener('click', (e) => {
    const choice = e.target.closest('[data-persona-choice]');
    if (choice) {
      setPersona(choice.getAttribute('data-persona-choice'));
      // If inside the dialog, close it after a short delay so users see feedback.
      const dialog = choice.closest('dialog[data-persona-dialog]');
      if (dialog && typeof dialog.close === 'function') {
        setTimeout(() => dialog.close(), 180);
      }
      return;
    }

    const trigger = e.target.closest('[data-persona-trigger]');
    if (trigger) {
      e.preventDefault();
      openDialog();
    }
  });

  // Apply once on load.
  applyPersona(getPersona());
})();
