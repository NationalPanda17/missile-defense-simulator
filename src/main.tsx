import './preview'; // must run before the store loads any saved game
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import './index.css';
import { registerOfflineSupport } from './ui/pwa';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerOfflineSupport();
