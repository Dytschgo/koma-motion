import '@fontsource-variable/instrument-sans';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { followWindowErrors } from './lib/diagnostics';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('The application container is missing');
}

followWindowErrors();

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
