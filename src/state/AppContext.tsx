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
      return { ...initialState, ...saved, standaloneTokens: tokens, currentTurn: saved.currentTurn ?? 1, pendingPopulate: 0, pendingXTriggers: saved.pendingXTriggers ?? [], history: saved.history ?? [], undoStack: [] } as AppState;
    }
    return initialState;
  });

  // Debounced save to localStorage — only triggered by fields that are actually persisted.
  // Excludes undoStack, pendingPopulate, pendingXTriggers, history, importStatus (non-persistent).
  // stateRef always holds the latest state so the timer saves a fully up-to-date snapshot.
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (state.importStatus === 'fetching') return;
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => saveState(stateRef.current), 500);
    return () => clearTimeout(saveTimeout.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.battlefield, state.standaloneTokens, state.deckCards, state.currentTurn, state.tokenDeaths, state.rawDecklist, state.importStatus]);

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
