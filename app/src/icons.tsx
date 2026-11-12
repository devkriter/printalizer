// Inline icons, drawn on a 24-unit grid with the current text colour.
import type { ReactElement } from 'react';

const S = (d: ReactElement, w = 1.8) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
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
  undo: S(<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />),
  redo: S(<path d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />),
  back: S(<path d="M15 6l-6 6 6 6" />),
  eraser: S(<path d="M3 17.5 13.5 7l5 5L10 20.5H6ZM9.5 11l5 5M10 20.5h10" />, 1.7),
  edits: S(<path d="M4 6h16M4 12h16M4 18h10" />),
  history: S(<path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v3.5h3.5M12 8v4l3 2" />),
  trash: S(<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />),
  gear: S(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>, 1.7),
  file: S(<path d="M6 3h8l4 4v14H6ZM14 3v4h4" />),
};

/** The same icons as SVG markup, for the tutorial's drawings. */
export const IconMarkup = {
  tent: '<path d="M6.7 11.3 12 4l5.3 7.3a7 7 0 1 1-10.6 0Z"/>',
  thread: '<path d="M5 3v18M5 4h4l6 3-6 3 6 3-6 3 6 3-6 1H5"/>',
  cbore: '<circle cx="12" cy="12" r="9"/><rect x="8" y="8" width="8" height="8"/>',
};
