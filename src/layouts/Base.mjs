import React from 'react';
import htm from 'htm';
import Header from '../components/Header.mjs';
import Footer from '../components/Footer.mjs';
import PersonaDialog from '../components/PersonaDialog.mjs';

const html = htm.bind(React.createElement);

export default function Base({ title, description, bodyClass, children }) {
  const fullTitle = title ? `${title} · Accessibility Lab` : 'Accessibility Lab';
  return html`
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${fullTitle}</title>
        ${description && html`<meta name="description" content=${description} />`}
        <link rel="stylesheet" href="/styles/tokens.css" />
        <link rel="stylesheet" href="/styles/base.css" />
        <link rel="stylesheet" href="/styles/components.css" />
        <link rel="stylesheet" href="/styles/motor.css" />
      </head>
      <body className=${bodyClass || ''}>
        <a href="#main" className="skip-link">Skip to main content</a>
        <${Header} />
        <main id="main">${children}</main>
        <${Footer} />
        <${PersonaDialog} />
        <script src="/client/app.js" defer></script>
      </body>
    </html>
  `;
}
