import { createContext } from 'react';
import type { Dispatch } from 'react';
import type { AppState, AppAction } from '../types/appState';

export interface AppContextValue {
  state: AppState;
  dispatch: Dispatch<AppAction>;
}

export const AppContext = createContext<AppContextValue | undefined>(undefined);
