import React from 'react';
import htm from 'htm';
import { simulators } from '../data/simulators.mjs';

const html = htm.bind(React.createElement);

function Card({ sim }) {
  const isSoon = sim.status !== 'available';
  const inner = html`
    <${React.Fragment}>
      <span className="card-tag">${sim.tag}</span>
      <h3>${sim.title}</h3>
      <p>${sim.blurb}</p>
      <span className="card-cta">
        ${isSoon ? 'Coming soon' : html`Start simulation <span className="arrow" aria-hidden="true">→</span>`}
      </span>
    </>
  `;
  if (isSoon) {
    return html`<div className="card card-soon" aria-disabled="true">${inner}</div>`;
  }
  return html`<a className="card card-link card-feature" href=${sim.href}>${inner}</a>`;
}

export default function SimulatorGrid() {
  return html`
    <section className="section" id="experiences">
      <div className="container">
        <p className="eyebrow">Experiences</p>
        <h2 className="section-title">Choose a scenario</h2>
        <div className="card-grid">
          ${simulators.map(sim => html`<${Card} key=${sim.id} sim=${sim} />`)}
        </div>
      </div>
    </section>
  `;
}
