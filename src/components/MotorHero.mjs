import React from 'react';
import htm from 'htm';

const html = htm.bind(React.createElement);

export default function MotorHero() {
  return html`
    <section className="hero">
      <div className="container">
        <div className="hero-inner">
          <span className="hero-kicker">Experience · Motor & motion</span>
          <h1>Tremors. Bumpy commutes. Cold hands.</h1>
          <p className="hero-lede">
            Motor variability isn't rare — it's the default condition under many contexts.
            Try finishing three small tasks while your input is unsteady, then read guidance
            tailored to your role.
          </p>
          <div className="hero-actions">
            <span className="persona-badge" data-persona-badge>
              <span>Framed for <strong data-persona-focus>you</strong></span>
              <button
                className="btn btn-ghost"
                data-persona-trigger
                type="button"
                style=${{ minHeight: '2.25rem', padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--fs-sm)' }}
              >
                Change
              </button>
            </span>
          </div>
        </div>
      </div>
    </section>
  `;
}
