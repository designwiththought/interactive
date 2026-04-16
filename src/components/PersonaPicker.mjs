import React from 'react';
import htm from 'htm';
import { personas } from '../data/personas.mjs';

const html = htm.bind(React.createElement);

// Server-renders all persona chips; client JS in app.js toggles [aria-pressed]
// and persists the choice in localStorage.
export default function PersonaPicker() {
  return html`
    <section className="persona-picker" aria-labelledby="persona-heading" data-persona-picker>
      <div className="persona-picker-header">
        <div>
          <p className="eyebrow">Tailor your experience</p>
          <h2 id="persona-heading" style=${{ margin: 0, fontSize: 'var(--fs-xl)' }}>
            Pick your perspective
          </h2>
        </div>
        <p className="muted" style=${{ margin: 0, maxWidth: '22rem' }}>
          Your choice changes how scenarios are framed and which takeaways we surface.
          You can change it anytime.
        </p>
      </div>
      <ul className="persona-picker-list" role="list">
        ${personas.map(p => html`
          <li key=${p.id}>
            <button
              type="button"
              className="persona-chip"
              data-persona-choice=${p.id}
              aria-pressed="false"
            >
              <span className="persona-chip-name">${p.name}</span>
              <span className="persona-chip-lede">${p.lede}</span>
            </button>
          </li>
        `)}
      </ul>
    </section>
  `;
}
