// Persona-tailored debrief content for the Motor simulator.
// Shape: { [personaId]: { headline, summary, watchFor: [...], actions: [{title, detail}] } }

export const motorDebrief = {
  designer: {
    headline: 'Motor variability is a design problem before it is a coding problem.',
    summary:
      "When input is shaky, every pixel of target area, every unit of spacing, and every moment of feedback does real work. Small targets are the first thing to hurt.",
    watchFor: [
      'Targets smaller than 44×44 px near other controls',
      'Destructive actions placed next to benign ones',
      'Micro-interactions that only confirm success, not the moment of contact',
      'Hover-only affordances that assume steady pointing',
    ],
    actions: [
      { title: 'Meet the WCAG 2.5.8 minimum (24 px) — aim for 44 px', detail: 'Treat 44 px as the comfortable floor for anything the user must tap, including checkboxes.' },
      { title: 'Separate confirm and cancel in space and color', detail: 'A mis-tap between Accept and Decline should not be plausible. Keep 8 px+ between adjacent tappable elements.' },
      { title: 'Design for the moment of contact', detail: 'Give pressed/focus states, not just success states. The user wants to know their touch registered before the action commits.' },
      { title: 'Forgiveness by default', detail: 'Undo, confirmations, and debounced double-taps turn near-misses into recoverable moments.' },
    ],
  },

  developer: {
    headline: 'You can engineer a lot of this forgiveness into the code.',
    summary:
      "Motor variability is an input-layer problem. Hit areas, event handling, and recovery paths are where a developer moves the needle the most.",
    watchFor: [
      'Click handlers bound to icon-only elements smaller than 24 px',
      'onMouseDown handlers that fire before a user can steady their hand',
      'Drag gestures with no keyboard equivalent',
      'Debounce/throttle set too tight, dropping valid inputs',
    ],
    actions: [
      { title: 'Expand hit areas without enlarging visuals', detail: 'Use padding or ::before pseudo-elements so the interactive box reaches 44 px even when the visual is smaller.' },
      { title: 'Wait for the click, not the down', detail: 'Prefer click over mousedown/pointerdown for committing actions. It gives the user a cancel-by-slide-off lane.' },
      { title: 'Provide keyboard and voice paths', detail: 'Every custom gesture needs a plain alternative: a button, an Enter key, a command.' },
      { title: 'Add sensible debouncing for double-fires', detail: 'A 300–500 ms guard after a destructive action prevents tremor-driven double-taps from firing twice.' },
    ],
  },

  'product-manager': {
    headline: 'This is a reach problem, not a compliance problem.',
    summary:
      "Motor variability isn't just a permanent-disability issue. It's a user on a train, a parent holding a baby, a phone in cold hands. Fixes here pay out across huge chunks of your audience.",
    watchFor: [
      'Tickets labeled "nice to have" that are really "works at all for tremor users"',
      'Onboarding flows measured only on desktop with a mouse',
      'Error rates by device type — they often hide motor issues',
      'Support tickets about "accidentally" subscribing, deleting, or paying',
    ],
    actions: [
      { title: 'Put motor accessibility on the scorecard', detail: 'Track success rate of first-time form submission and "rage tap" frequency alongside usual funnel metrics.' },
      { title: 'Pair accessibility fixes with business wins', detail: 'Bigger targets usually raise conversion. Forgiveness flows cut support load. Frame the fix as both.' },
      { title: 'Invest in the recovery moment', detail: 'A great undo experience is a product feature — fund it, don\'t leave it to engineering scraps.' },
      { title: 'Recruit motor-impaired users into research', detail: 'Aim for 1 in every 5 participants to have a temporary or permanent motor condition. Their feedback travels across personas.' },
    ],
  },

  researcher: {
    headline: 'What you just felt — most of your users cannot narrate yet.',
    summary:
      "Motor frustration is pre-verbal. People blame themselves, quietly abandon, and never show up in the transcript. Research design has to draw these moments out.",
    watchFor: [
      'Silent hesitation before a tap — often a sign of aiming doubt',
      'Participants apologizing ("sorry, my hands") — a red flag for self-blame, not user error',
      '"Small re-taps" — two clicks in 400 ms on the same target',
      'Moments where users opt out instead of correct',
    ],
    actions: [
      { title: 'Instrument for near-misses in sessions', detail: 'Tag mis-taps, rapid re-taps, and cancel-after-submit — not just completions.' },
      { title: 'Ask about context, not ability', detail: '"Where were you sitting? What else was in your hands?" surfaces motor load without forcing disclosure.' },
      { title: 'Run studies in real environments', detail: 'A bus, a kitchen, a stroller-pushing walk. Lab studies systematically miss motor friction.' },
      { title: 'Share the felt experience with teams', detail: 'Clips of a participant missing a tap three times change a roadmap faster than any usability score.' },
    ],
  },

  'content-designer': {
    headline: 'Words are the safety net when the tap goes wrong.',
    summary:
      "When users mis-tap, the system's response — in microcopy, error text, and confirmation language — decides whether they feel cared for or judged.",
    watchFor: [
      'Error messages that blame the user for mis-entry',
      'Long, dense confirmation copy right before a destructive button',
      '"Are you sure?" dialogs without clear labels on each option',
      'Button labels that rely on position instead of meaning',
    ],
    actions: [
      { title: 'Label every button with the verb it does', detail: '"Delete account" beats "Yes". A tremor user who mis-taps still needs to know which option just got picked.' },
      { title: 'Write forgiving error microcopy', detail: 'Replace "Invalid input" with "Hmm, that doesn\'t look like an email — want to try again?"' },
      { title: 'Front-load the undo', detail: '"Message sent. Undo" beats "Your message has been sent successfully." Short, present-tense, recoverable.' },
      { title: 'Keep confirmation copy scannable', detail: 'One sentence of stakes, two clear buttons. Dense paragraphs penalize every kind of motor-impaired user.' },
    ],
  },
};
