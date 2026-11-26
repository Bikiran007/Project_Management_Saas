import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { startRealtime } from './lib/realtime';
import { useApp } from './store/app';
import { syncFromServer } from './lib/api';
import { getToken } from './lib/auth';

const root = ReactDOM.createRoot(document.getElementById('root')!);

const boot = async () => {
  if (getToken()) {
    try {
      await syncFromServer();
    } catch (e) {
      console.warn('Initial sync failed', e);
    }
  }
  startRealtime();
  useApp.getState().bump();
  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );
};

boot();
