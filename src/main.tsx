import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './lib/theme'; // applies the saved theme before anything renders
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
