// Inline icons, drawn on a 24-unit grid with the current text colour.
import type { ReactElement } from 'react';

const S = (d: ReactElement) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

export const Icon = {
  open: S(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />),
  lay: S(<path d="M4 19h16M7 15l5-9 5 9Z" />),
  xray: S(<path d="M12 3 21 8v8l-9 5-9-5V8ZM12 3v18M3 8l9 5 9-5" />),
  fit: S(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />),
  overhang: S(<path d="M4 20h7V9h9M11 9 6 4" />),
  turn: S(<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4" />),
  chevron: S(<path d="m6 9 6 6 6-6" />),
  close: S(<path d="M6 6l12 12M18 6 6 18" />),
};
