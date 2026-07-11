import React from 'react';
import ReactDOM from 'react-dom/client';
window.React = React;
window.ReactDOM = ReactDOM;
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('app-root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
