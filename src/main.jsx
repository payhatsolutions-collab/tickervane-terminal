import React from 'react';import{createRoot}from'react-dom/client';import{Analytics}from'@vercel/analytics/react';import App from './App.jsx';import { ThemeProvider } from './theme.jsx';import './styles.css';import './theme.css';
createRoot(document.getElementById('root')).render(<React.StrictMode><ThemeProvider><App/><Analytics/></ThemeProvider></React.StrictMode>);
