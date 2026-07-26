import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Registers the app-shell cache so the tool keeps working with no network
// connection after the first load. Production-only: the dev server's own
// module graph would otherwise get pinned behind a stale cached response.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}
