import { useReducer, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useMsal } from '@azure/msal-react';
import type { AppState, AppAction } from '../types/appState';
import { initialAppState } from '../types/appState';
import { appReducer } from '../reducers/appReducer';
import { AppContext } from './appContextValue';

// Lightweight dev logger prevents accidental prod noise
const devLogger = {
  enabled: import.meta.env.DEV,
  group(label: string) { if (this.enabled) console.group(label); },
  log: function (...args: unknown[]) { if (this.enabled) console.log(...args); },
  end() { if (this.enabled) console.groupEnd(); }
};

// Dev mode logging middleware (diff-based)
const logStateChange = (action: AppAction, prevState: AppState, nextState: AppState) => {
  if (!devLogger.enabled) return;
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  devLogger.group(`🔄 [${timestamp}] ${action.type}`);
  devLogger.log('Action:', action);
  const changes: Record<string, string> = {};
  
  // Track all meaningful state changes
  if (prevState.auth.status !== nextState.auth.status) {
    changes['auth.status'] = `${prevState.auth.status} → ${nextState.auth.status}`;
  }
  if (prevState.chat.status !== nextState.chat.status) {
    changes['chat.status'] = `${prevState.chat.status} → ${nextState.chat.status}`;
  }
  if (prevState.chat.messages.length !== nextState.chat.messages.length) {
    changes['chat.messages.length'] = `${prevState.chat.messages.length} → ${nextState.chat.messages.length}`;
  }
  if (prevState.chat.streamingMessageId !== nextState.chat.streamingMessageId) {
    changes['chat.streamingMessageId'] = `${prevState.chat.streamingMessageId} → ${nextState.chat.streamingMessageId}`;
  }
  if (prevState.ui.chatInputEnabled !== nextState.ui.chatInputEnabled) {
    changes['ui.chatInputEnabled'] = `${prevState.ui.chatInputEnabled} → ${nextState.ui.chatInputEnabled}`;
  }
  
  if (Object.keys(changes).length) {
    devLogger.log('Changes:', changes);
  } else {
    devLogger.log('(No state changes)');
  }
  devLogger.end();
};

/**
 * Enhanced reducer with logging middleware
 */
const reducerWithLogging = (state: AppState, action: AppAction): AppState => {
  const nextState = appReducer(state, action);
  logStateChange(action, state, nextState);
  return nextState;
};

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducerWithLogging, initialAppState);
  const { accounts } = useMsal();

  // Initialize auth state from MSAL
  useEffect(() => {
    if (accounts.length > 0) {
      dispatch({ type: 'AUTH_INITIALIZED', user: accounts[0] });
    }
  }, [accounts]);

  // Dev mode: Log when provider mounts and unmounts
  useEffect(() => {
    devLogger.log('🚀 AppProvider initialized');
    return () => {
      devLogger.log('🔌 AppProvider unmounted');
    };
  }, []);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo(() => ({ state, dispatch }), [state, dispatch]);

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
};

// useAppContext hook is in hooks/useAppContext.ts to satisfy react-refresh single-export rule
