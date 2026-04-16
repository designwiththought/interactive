import React from 'react';
import htm from 'htm';

const html = htm.bind(React.createElement);

export default function Hero() {
  return html`
    <section className="hero">
      <div className="container hero-inner">
        <span className="hero-kicker">Accessibility Experience Lab</span>
        <h1>Feel what your users feel.</h1>
        <p className="hero-lede">
          Step into the shoes — and the hands — of people navigating real accessibility
          barriers. Pick a role, run a scenario, and walk away with guidance
          tailored to the decisions you make at work.
        </p>
      </div>
    </section>
  `;
}
