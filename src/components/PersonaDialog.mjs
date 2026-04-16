import React from 'react';
import htm from 'htm';
import { personas } from '../data/personas.mjs';

const html = htm.bind(React.createElement);

// A compact, site-wide persona picker rendered as a native <dialog>.
// app.js toggles it open when [data-persona-trigger] is clicked.
export default function PersonaDialog() {
  return html`
    <dialog
      data-persona-dialog
      aria-labelledby="persona-dialog-heading"
      style=${{
        border: 0,
        borderRadius: 'var(--radius-lg)',
        padding: 0,
        maxWidth: '36rem',
        width: 'calc(100% - 2rem)',
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <form method="dialog" style=${{ padding: 'var(--space-5)' }}>
        <div style=${{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
          <div>
            <p className="eyebrow" style=${{ marginBottom: 'var(--space-1) '}}>Perspective</p>
            <h2 id="persona-dialog-heading" style=${{ margin: 0, fontSize: 'var(--fs-xl)' }}>Pick your persona</h2>
          </div>
          <button className="btn btn-ghost" value="close" aria-label="Close">Close</button>
        </div>

        <ul className="persona-picker-list" role="list" style=${{ marginBottom: 0 }}>
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
      </form>
    </dialog>
  `;
}
