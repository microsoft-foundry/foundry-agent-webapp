import { useContext } from 'react';
import { AppContext } from '../contexts/appContextValue';

/**
 * Hook to access app state and dispatch
 * Throws error if used outside AppProvider
 */
export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return context;
};
