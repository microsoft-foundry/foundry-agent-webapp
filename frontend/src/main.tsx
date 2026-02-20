import React from "react";
import ReactDOM from "react-dom/client";
import { PublicClientApplication, EventType, type AuthenticationResult } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";
import App from "./App";
import { msalConfig } from "./config/authConfig";
import "./index.css";
import { AppProvider } from './contexts/AppContext';
import { ThemeProvider } from './components/ThemeProvider';

// Initialize MSAL instance
const msalInstance = new PublicClientApplication(msalConfig);

// Handle redirect promise (required for PKCE flow)
msalInstance.initialize().then(() => {
  // Account selection logic (optional, handles multiple accounts)
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length > 0) {
    msalInstance.setActiveAccount(accounts[0]);
  }

  msalInstance.addEventCallback((event) => {
    if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
      const account = (event.payload as AuthenticationResult).account;
      msalInstance.setActiveAccount(account);
    }
  });

  const rootElement = document.getElementById("root");
  
  if (!rootElement) {
    console.error('Failed to find the root element');
    return;
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <MsalProvider instance={msalInstance}>
        <AppProvider>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </AppProvider>
      </MsalProvider>
    </React.StrictMode>
  );
});
