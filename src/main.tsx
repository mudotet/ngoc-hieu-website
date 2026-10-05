import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/500.css';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/be-vietnam-pro/700.css';
import '@fontsource/be-vietnam-pro/800.css';
import App from './App';
import './style.css';
import { initializeTheme } from './theme';

const MenuPage = lazy(() => import('./MenuPage'));

initializeTheme();

if (window.location.pathname === '/' && (!window.location.hash || window.location.hash === '#home')) {
  window.history.scrollRestoration = 'manual';
  window.scrollTo({ top: 0, behavior: 'instant' });
}

createRoot(document.getElementById('root')!).render(<StrictMode>{window.location.pathname === '/thuc-don' ? <Suspense fallback={<p role="status">Đang mở thực đơn…</p>}><MenuPage /></Suspense> : <App />}</StrictMode>);
