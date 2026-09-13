import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted Hebrew font, so the PWA shell keeps working offline in Stage 10.
import '@fontsource/heebo/400.css';
import '@fontsource/heebo/500.css';
import '@fontsource/heebo/700.css';

import './styles/global.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container #root not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
