import { useMemo } from 'react';
import { useAppContext } from './useAppContext';

export const useAppState = () => {
  const { state, dispatch } = useAppContext();
  
  // Memoize computed values to prevent unnecessary recalculations
  const isAuthenticated = useMemo(
    () => state.auth.status === 'authenticated',
    [state.auth.status]
  );
  
  const isChatBusy = useMemo(
    () => ['sending', 'streaming'].includes(state.chat.status),
    [state.chat.status]
  );
  
  const canSendMessage = useMemo(
    () => state.ui.chatInputEnabled && state.chat.status === 'idle',
    [state.ui.chatInputEnabled, state.chat.status]
  );
  
  const isStreaming = useMemo(
    () => state.chat.status === 'streaming',
    [state.chat.status]
  );
  
  return useMemo(
    () => ({
      // State selectors for easy access
      auth: state.auth,
      chat: state.chat,
      ui: state.ui,
      
      // Full state for components that need everything
      state,
      
      // Dispatch for triggering actions
      dispatch,
      
      // Computed values (memoized for performance)
      isAuthenticated,
      isChatBusy,
      canSendMessage,
      isStreaming,
    }),
    [state, dispatch, isAuthenticated, isChatBusy, canSendMessage, isStreaming]
  );
};

export const useChatState = () => {
  const { state, dispatch } = useAppContext();
  
  return useMemo(
    () => ({ chat: state.chat, dispatch }),
    [state.chat, dispatch]
  );
};

export const useUIState = () => {
  const { state, dispatch } = useAppContext();
  
  return useMemo(
    () => ({ ui: state.ui, dispatch }),
    [state.ui, dispatch]
  );
};
