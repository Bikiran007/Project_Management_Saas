import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { startRealtime } from './lib/realtime';
import { useApp } from './store/app';
import { adoptTabSession } from './lib/auth';

const root = ReactDOM.createRoot(document.getElementById('root')!);

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
