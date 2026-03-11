import type { AppState } from '../types';

const STORAGE_KEY = 'mtg-token-tracker';
const SCHEMA_VERSION = 2;

interface StorageWrapper {
  version: number;
  state: AppState;
}

export function saveState(state: AppState): void {
  try {
    // Don't persist undoStack (too large) — it's session-only
    const toSave = { ...state, undoStack: [] };
    const wrapper: StorageWrapper = { version: SCHEMA_VERSION, state: toSave };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wrapper));
  } catch (err) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      console.error('localStorage quota exceeded. State not saved.');
    } else {
      console.warn('Failed to save state to localStorage:', err);
    }
  }
}

export function loadState(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    // Handle versioned wrapper
    if (parsed && typeof parsed === 'object' && 'version' in parsed && 'state' in parsed) {
      return validateState(parsed.state);
    }

    // Legacy unversioned data
    return validateState(parsed);
  } catch (err) {
    console.warn('Failed to load state from localStorage. Starting fresh.', err);
    return null;
  }
}

function migrateState(data: Record<string, unknown>): void {
  // v1 → v2: supportEffect (single) → supportEffects (array)
  if (Array.isArray(data.deckCards)) {
    for (const card of data.deckCards as Record<string, unknown>[]) {
      if ('supportEffect' in card && !('supportEffects' in card)) {
        const effect = card.supportEffect;
        card.supportEffects = effect ? [effect] : [];
        delete card.supportEffect;
      }
      if (!('supportEffects' in card)) {
        card.supportEffects = [];
      }
    }
  }
}

function validateState(data: unknown): AppState | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;

  // Check required fields exist
  if (!Array.isArray(obj.deckCards) || !Array.isArray(obj.battlefield)) return null;
  if (typeof obj.importStatus !== 'string') return null;

  // Migrate old schema
  migrateState(obj);

  return obj as unknown as AppState;
}

export function clearState(): void {
  localStorage.removeItem(STORAGE_KEY);
}
