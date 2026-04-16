import React from 'react';
import htm from 'htm';
import { motorDebrief } from '../data/motor-debrief.mjs';
import { personas } from '../data/personas.mjs';

const html = htm.bind(React.createElement);

// Server-renders one debrief block per persona. The client shows only
// the one matching the active persona.
export default function MotorDebrief() {
  return html`
    <section className="debrief" data-debrief>
      <p className="eyebrow">Debrief</p>
      <h2 className="section-title" style=${{ marginBottom: 'var(--space-5)' }}>
        What to take back to your team
      </h2>

      ${personas.map(p => {
        const d = motorDebrief[p.id];
        if (!d) return null;
        return html`
          <article
            key=${p.id}
            className="debrief-variant"
            data-persona=${p.id}
            data-active=${p.id === 'designer' ? 'true' : 'false'}
          >
            <p className="eyebrow">For ${p.name.toLowerCase()}s</p>
            <h3>${d.headline}</h3>
            <p>${d.summary}</p>

            <h4 style=${{ marginTop: 'var(--space-5)' }}>What to watch for</h4>
            <ul>
              ${d.watchFor.map((item, i) => html`<li key=${i}>${item}</li>`)}
            </ul>

            <h4 style=${{ marginTop: 'var(--space-5)' }}>What to do next</h4>
            <ul className="debrief-list" role="list">
              ${d.actions.map((a, i) => html`
                <li key=${i}>
                  <strong>${a.title}</strong>
                  <span>${a.detail}</span>
                </li>
              `)}
            </ul>
          </article>
        `;
      })}
    </section>
  `;
}
