import React from 'react';
import htm from 'htm';

const html = htm.bind(React.createElement);

export default function Header() {
  return html`
    <header className="site-header">
      <a className="brand" href="/">
        <span className="brand-mark" aria-hidden="true"></span>
        <span>Accessibility Lab</span>
      </a>
      <nav className="site-nav" aria-label="Primary">
        <a className="btn btn-ghost" href="/#experiences">Experiences</a>
        <button className="btn" type="button" data-persona-trigger aria-haspopup="dialog">
          Persona: <strong data-persona-label>Not set</strong>
        </button>
      </nav>
    </header>
  `;
}
