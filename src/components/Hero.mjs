import React from 'react';
import htm from 'htm';

const html = htm.bind(React.createElement);

export default function Hero() {
  return html`
    <section className="hero">
      <div className="container">
        <div className="hero-inner">
          <span className="hero-kicker">Accessibility Experience Lab</span>
          <h1>Feel what your users feel.</h1>
          <p className="hero-lede">
            Step into the shoes — and the hands — of people navigating real
            accessibility barriers. Pick a role, run a scenario, and walk away
            with guidance tailored to the decisions you make at work.
          </p>
          <div className="hero-actions">
            <a className="btn btn-primary btn-lg" href="#experiences">
              Pick a scenario <span className="arrow" aria-hidden="true">→</span>
            </a>
            <button className="btn btn-lg" type="button" data-persona-trigger>
              Set your persona
            </button>
          </div>
        </div>
      </div>
    </section>
  `;
}
