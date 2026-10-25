import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { LocationSharingProvider } from './context/LocationSharingContext.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <LocationSharingProvider>
          <App />
        </LocationSharingProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
