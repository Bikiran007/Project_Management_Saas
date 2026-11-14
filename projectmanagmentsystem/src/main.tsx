import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { ensureSeeded } from './lib/seed';
import { startRealtime } from './lib/realtime';
import { useApp } from './store/app';
import { adoptTabSession } from './lib/auth';

const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
  <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading TaskForge…</div>,
);

ensureSeeded()
  .catch((e) => console.error('Seeding failed', e))
  .finally(() => {
    adoptTabSession();
    startRealtime();
    useApp.getState().bump();
    root.render(
      <React.StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </React.StrictMode>,
    );
  });
