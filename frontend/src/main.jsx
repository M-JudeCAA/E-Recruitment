import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './models/AuthContext';
import { ConfirmProvider } from './components/ConfirmDialog';
import App from './App.jsx';
import './theme.css';
import './workspace.css';

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <AuthProvider>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </AuthProvider>
  </BrowserRouter>
);
