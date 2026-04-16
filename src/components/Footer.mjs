import React from 'react';
import htm from 'htm';

const html = htm.bind(React.createElement);

export default function Footer() {
  return html`
    <footer className="site-footer">
      <div className="container">
        <p>
          Built as a practice ground for empathy-first accessibility design.
          Every simulation is an approximation — the real experience of disabled users
          is richer and more varied than any demo can show.
        </p>
      </div>
    </footer>
  `;
}
