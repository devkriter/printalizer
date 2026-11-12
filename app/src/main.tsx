import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import { App } from './App.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// Installable and usable offline once loaded (built app only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => { void navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}
