import { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { AppState } from '../types';
import type { AppAction } from './appReducer';
import { appReducer, initialState } from './appReducer';
import { saveState, loadState } from '../services/localStorage';

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, undefined, () => {
    const saved = loadState();
    if (saved) {
      // Migrate old state missing new fields
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokens = (saved.standaloneTokens ?? []).map((t: any) => ({
        ...t,
        createdOnTurn: t.createdOnTurn ?? 0,
      }));
      return { ...initialState, ...saved, standaloneTokens: tokens, currentTurn: saved.currentTurn ?? 1, pendingPopulate: 0 } as AppState;
    }
    return initialState;
  });

  // Debounced save to localStorage
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (state.importStatus === 'fetching') return;
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => saveState(state), 500);
    return () => clearTimeout(saveTimeout.current);
  }, [state]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}
