// Renderer entry. Built by build.mjs → dist/renderer/main.js (+ main.css, fonts in assets/).
import '@fontsource-variable/onest';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const el = document.getElementById('root');
if (el) createRoot(el).render(<App />);
